// The walkthrough's triage status, read twice — a 7px dot and the word — in the
// three fixed inks (open cobalt, in_review violet, resolved green) plus the
// deliberately quiet grey for needs_info. A member clicks it to open a popover of
// all four statuses; a non-member (a platform admin looking in) gets a static
// readout, since every mutation would 403 anyway.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { usePopover } from '../overflow-menu'
import type { Walkthrough, WalkthroughStatus } from '../types'

const STATUS: Record<WalkthroughStatus, { label: string; dot: string; text: string }> = {
  open: { label: 'open', dot: 'bg-cobalt', text: 'text-cobalt' },
  in_review: { label: 'in review', dot: 'bg-review', text: 'text-review' },
  needs_info: { label: 'needs info', dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
  resolved: { label: 'resolved', dot: 'bg-approve', text: 'text-approve' },
}

const ORDER: WalkthroughStatus[] = ['open', 'in_review', 'needs_info', 'resolved']

function asStatus(value: string): WalkthroughStatus {
  return value in STATUS ? (value as WalkthroughStatus) : 'open'
}

export function StatusChip({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { open, setOpen, ref } = usePopover()

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
    })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
  }

  const setStatus = useMutation(
    trpc.walkthroughs.setStatus.mutationOptions({ onSettled: invalidate })
  )

  // In-flight variables stand in for the server's answer, so the chip reads as
  // written the instant it's clicked and snaps back on its own if the write fails.
  const status = asStatus(
    setStatus.isPending ? (setStatus.variables?.status ?? walkthrough.status) : walkthrough.status
  )
  const meta = STATUS[status]

  if (!walkthrough.viewerIsMember) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', meta.text)}>
        <span className={cn('size-[7px] shrink-0 rounded-full', meta.dot)} />
        {meta.label}
      </span>
    )
  }

  function choose(next: WalkthroughStatus) {
    setOpen(false)
    if (next === status) return
    setStatus.mutate({ walkthroughId: walkthrough.id, status: next })
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Status"
        aria-expanded={open}
        disabled={setStatus.isPending}
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 text-sm font-medium transition-opacity disabled:opacity-60',
          meta.text
        )}>
        <span className={cn('size-[7px] shrink-0 rounded-full', meta.dot)} />
        {meta.label}
      </button>

      {open && (
        <div className="bg-card border-border absolute left-0 z-20 mt-2 min-w-40 rounded-md border p-1 shadow-sm">
          {ORDER.map((value) => {
            const active = value === status
            const s = STATUS[value]
            return (
              <button
                key={value}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent/50',
                  active && 'bg-cobalt-wash text-cobalt'
                )}
                onClick={() => choose(value)}>
                <span className={cn('size-[7px] shrink-0 rounded-full', s.dot)} />
                {s.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
