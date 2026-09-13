// The walkthrough's triage status as a StatusPill. A member clicks it to open a
// popover of all four statuses; a non-member (a platform admin looking in) gets a
// static pill, since every mutation would 403 anyway.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { STATUS_INK, StatusPill } from '~/components/ui/status-pill'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { usePopover } from '../overflow-menu'
import type { Walkthrough, WalkthroughStatus } from '../types'

const ORDER: WalkthroughStatus[] = ['open', 'in_review', 'needs_info', 'resolved']

function asStatus(value: string): WalkthroughStatus {
  return ORDER.find((status) => status === value) ?? 'open'
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

  // In-flight variables stand in for the server's answer, so the pill reads as
  // written the instant it's clicked and snaps back on its own if the write fails.
  const status = asStatus(
    setStatus.isPending ? (setStatus.variables?.status ?? walkthrough.status) : walkthrough.status
  )

  if (!walkthrough.viewerIsMember) return <StatusPill status={status} />

  function choose(next: WalkthroughStatus) {
    setOpen(false)
    if (next === status) return
    setStatus.mutate({ walkthroughId: walkthrough.id, status: next })
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label="Status"
        aria-expanded={open}
        disabled={setStatus.isPending}
        onClick={() => setOpen(!open)}
        className="transition-opacity disabled:opacity-60">
        <StatusPill status={status} />
      </button>

      {open && (
        <div className="bg-card border-border absolute left-0 top-full z-30 mt-1.5 min-w-40 rounded-md border p-1 shadow-sm">
          {ORDER.map((value) => {
            const ink = STATUS_INK[value]
            return (
              <button
                key={value}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-accent/50',
                  value === status && 'bg-cobalt-wash text-cobalt'
                )}
                onClick={() => choose(value)}>
                <span className={cn('size-[7px] shrink-0 rounded-full', ink.dot)} />
                {ink.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
