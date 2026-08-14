// The split flow, and the two faces a split leaves behind.
//
// SplitPanel is the mode itself: opened from the ⋯ menu, it asks the server's
// structuring pass for a proposal (one metered model call), lets the human
// veto tasks off the list, and only writes rows on the explicit confirm —
// the pass proposes, the person decides. TaskBrief is how a child renders (its
// brief is its whole content; the evidence lives on the parent), and
// SplitChildren is the parent's list of what was carved out of it.

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { mmss } from './format'
import { SectionHead } from './section-head'
import type { Walkthrough } from './types'

type Proposed = {
  title: string
  severity: 'low' | 'medium' | 'high'
  repro: string[]
  acceptance: string[]
  startMs: number | null
  endMs: number | null
}

const SEVERITY_STYLE: Record<Proposed['severity'], string> = {
  high: 'text-destructive',
  medium: 'text-foreground',
  low: 'text-muted-foreground',
}

function rangeLabel(task: Proposed): string | null {
  if (task.startMs === null) return null
  return task.endMs !== null && task.endMs > task.startMs
    ? `${mmss(task.startMs)}–${mmss(task.endMs)}`
    : mmss(task.startMs)
}

export function SplitPanel({
  walkthrough,
  onClose,
}: {
  walkthrough: Walkthrough
  onClose: () => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  // Which proposals the human vetoed, by index into the proposal.
  const [excluded, setExcluded] = useState<Set<number>>(new Set())

  const propose = useMutation(trpc.walkthroughs.proposeSplit.mutationOptions())
  const apply = useMutation(
    trpc.walkthroughs.applySplit.mutationOptions({
      onSuccess: () => {
        // The children are new inbox rows and the parent's `get` now lists them.
        queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
        })
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
      },
    })
  )

  // One proposal per opening — the call is metered, so strict-mode's double
  // mount must not buy two.
  const asked = useRef(false)
  const proposeMutate = propose.mutate
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    proposeMutate({ walkthroughId: walkthrough.id })
  }, [proposeMutate, walkthrough.id])

  const tasks = propose.data?.tasks ?? []
  const kept = tasks.filter((_, i) => !excluded.has(i))

  const toggle = (i: number) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  if (apply.isSuccess) {
    return (
      <section className="space-y-4">
        <SectionHead>split into tasks</SectionHead>
        <div className="border-approve/40 bg-approve-wash space-y-3 rounded-md border p-5">
          <div className="flex items-center gap-3">
            <span className="bg-approve size-2 shrink-0 rounded-full" />
            <p className="font-display text-xl font-semibold">
              {apply.data.children.length === 1
                ? 'One task created.'
                : `${apply.data.children.length} tasks created.`}
            </p>
          </div>
          <ul className="space-y-1.5">
            {apply.data.children.map((child) => (
              <li key={child.id}>
                <Link
                  to={`/walkthroughs/${child.id}`}
                  className="text-cobalt text-sm underline underline-offset-4">
                  {child.title}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Each one is an open walkthrough an agent can pull on its own — its brief points back
            here for the recording.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onClose}>
          Back to the walkthrough
        </Button>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <SectionHead>split into tasks</SectionHead>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground text-sm underline underline-offset-4">
          ← back to the walkthrough
        </button>
      </div>

      {propose.isPending && (
        <p className="text-muted-foreground font-mono text-sm">
          reading the walkthrough — the transcript, the frames, the console…
        </p>
      )}

      {propose.isError && (
        <div className="border-border border-l-destructive bg-card space-y-3 rounded-md border border-l-2 p-5">
          <p className="text-sm leading-relaxed">{propose.error.message}</p>
          <button
            type="button"
            onClick={() => propose.mutate({ walkthroughId: walkthrough.id })}
            className="text-primary text-sm underline underline-offset-4">
            try again
          </button>
        </div>
      )}

      {propose.isSuccess && (
        <>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {tasks.length === 1
              ? 'The recording reads as one issue. Confirm to file it as its own task, or go back.'
              : `The recording raises ${tasks.length} distinct issues. Untick any that don't belong; nothing is created until you confirm.`}
          </p>

          <ul className="space-y-3">
            {tasks.map((task, i) => {
              const dropped = excluded.has(i)
              const range = rangeLabel(task)
              return (
                <li
                  key={i}
                  className={cn(
                    'border-border bg-card rounded-md border p-4',
                    dropped && 'opacity-50'
                  )}>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={!dropped}
                      onChange={() => toggle(i)}
                      className="accent-cobalt mt-1"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-sm font-medium">{task.title}</span>
                        <span
                          className={cn('font-mono text-xs', SEVERITY_STYLE[task.severity])}>
                          {task.severity}
                        </span>
                        {range && (
                          <span className="text-muted-foreground font-mono text-xs">
                            at {range}
                          </span>
                        )}
                      </div>
                      {task.repro.length > 0 && (
                        <ol className="text-muted-foreground list-decimal space-y-0.5 pl-5 text-sm">
                          {task.repro.map((step, n) => (
                            <li key={n}>{step}</li>
                          ))}
                        </ol>
                      )}
                      {task.acceptance.length > 0 && (
                        <p className="text-muted-foreground text-sm">
                          <span className="font-mono text-xs">done when: </span>
                          {task.acceptance.join(' · ')}
                        </p>
                      )}
                    </div>
                  </label>
                </li>
              )
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={kept.length === 0 || apply.isPending}
              onClick={() => apply.mutate({ walkthroughId: walkthrough.id, tasks: kept })}>
              {apply.isPending
                ? 'creating…'
                : kept.length === 1
                  ? 'Create 1 task'
                  : `Create ${kept.length} tasks`}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
          {apply.isError && <p className="text-destructive text-sm">{apply.error.message}</p>}
        </>
      )}
    </section>
  )
}

/** How a child reads: its brief verbatim (fidelity over prettiness, same as
 *  report.md), with the way back to the recording above it. */
export function TaskBrief({ walkthrough }: { walkthrough: Walkthrough }) {
  if (!walkthrough.briefMd) return null
  return (
    <section className="space-y-3">
      {walkthrough.parent && (
        <p className="text-muted-foreground text-sm">
          Split from{' '}
          <Link
            to={`/walkthroughs/${walkthrough.parent.id}`}
            className="text-cobalt underline underline-offset-4">
            {walkthrough.parent.title}
          </Link>{' '}
          — the recording, frames and console live there.
        </p>
      )}
      <SectionHead>the task</SectionHead>
      <pre className="border-border bg-card overflow-x-auto rounded-md border p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {walkthrough.briefMd}
      </pre>
    </section>
  )
}

/** The parent's ledger of what was carved out of it. Status colors are the
 *  fixed triad (open=cobalt, in_review=violet, resolved=green). */
const CHILD_DOT: Record<string, string> = {
  open: 'bg-cobalt',
  in_review: 'bg-review',
  resolved: 'bg-approve',
}

export function SplitChildren({ walkthrough }: { walkthrough: Walkthrough }) {
  if (walkthrough.children.length === 0) return null
  return (
    <section className="space-y-3">
      <SectionHead>split into {walkthrough.children.length} tasks</SectionHead>
      <ul className="divide-border divide-y">
        {walkthrough.children.map((child) => (
          <li key={child.id} className="flex items-center gap-3 py-2">
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                CHILD_DOT[child.status] ?? 'bg-cobalt'
              )}
            />
            <Link
              to={`/walkthroughs/${child.id}`}
              className="hover:text-cobalt min-w-0 flex-1 truncate text-sm transition-colors">
              {child.title}
            </Link>
            <span className="text-muted-foreground shrink-0 font-mono text-xs">
              {child.status.replace('_', ' ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
