// Refine is a second, pro-gated read of an agent walkthrough: a plain-language
// summary, capture-QC health notes, and the spans it would drop. The pass runs
// server-side (server/refine.ts) and this panel both kicks it off and reports
// its outcome — while it's running it polls `get` on its own so the body fills
// in without a reload. It renders nothing for a human handback or a child task,
// and nothing at all for a free account that has never run it.

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ProUpsell } from '~/components/pro-upsell'
import { isProError } from '~/lib/pro'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { mmss } from './format'
import { SectionHead } from './section-head'
import type { Walkthrough } from './types'

export function RefinePanel({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const entitlements = useQuery(trpc.teams.entitlements.queryOptions())
  const refine = useMutation(
    trpc.walkthroughs.refine.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
        }),
    })
  )

  // While the pass is running the outcome lands on the server, not here — poll
  // the walkthrough until the status leaves 'running'. Gated on that status so a
  // settled walkthrough costs nothing.
  const status = walkthrough.refineStatus
  useEffect(() => {
    if (status !== 'running') return
    const id = setInterval(() => {
      queryClient.invalidateQueries({
        queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
      })
    }, 5000)
    return () => clearInterval(id)
  }, [status, walkthrough.id, queryClient, trpc])

  // Refine only exists for a finalized agent walkthrough; a child task is its
  // brief and has no recording to read.
  if (walkthrough.kind !== 'agent' || walkthrough.briefMd !== null) return null

  const summary = walkthrough.summaryMd
  const health = walkthrough.health
  const excluded = walkthrough.curation?.excluded ?? []
  const hasBody = Boolean(summary) || health.length > 0 || excluded.length > 0

  const pro = entitlements.data?.pro ?? false
  const entLoaded = entitlements.isSuccess

  // The right-aligned control cluster. Pro drives the run/re-run affordances off
  // the pass status. A free account gets no control — it can still read prior
  // output (the body below), but a fresh walkthrough shows nothing at all, so
  // the section never dangles an upsell on every free viewer's page.
  const run = () => refine.mutate({ walkthroughId: walkthrough.id })
  let control: React.ReactNode = null
  if (entLoaded && pro) {
    if (status === null) {
      control = (
        <button
          type="button"
          className="text-cobalt font-mono text-xs hover:underline disabled:opacity-60"
          disabled={refine.isPending}
          onClick={run}>
          run refine
        </button>
      )
    } else if (status === 'running') {
      control = <span className="text-muted-foreground font-mono text-xs">refining…</span>
    } else if (status === 'failed') {
      control = (
        <button
          type="button"
          className="text-destructive font-mono text-xs hover:underline disabled:opacity-60"
          disabled={refine.isPending}
          onClick={run}>
          refine failed · retry
        </button>
      )
    } else {
      control = (
        <span className="flex items-center gap-2 font-mono text-xs">
          <span className="text-muted-foreground">refined</span>
          <button
            type="button"
            className="text-cobalt hover:underline disabled:opacity-60"
            disabled={refine.isPending}
            onClick={run}>
            re-run
          </button>
        </span>
      )
    }
  }

  // Nothing to read and nothing to offer: stay out of the page entirely.
  if (!hasBody && control === null) return null

  const proError = isProError(refine.error)

  return (
    <section className="rule space-y-3 pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <SectionHead>refine</SectionHead>
        {control}
      </div>

      {refine.error &&
        (proError ? (
          <ProUpsell feature="Refine" />
        ) : (
          <p className="text-destructive text-sm">{refine.error.message}</p>
        ))}

      {summary && (
        <div className="text-sm leading-relaxed whitespace-pre-wrap">{summary}</div>
      )}

      {health.length > 0 && (
        <ul className="space-y-1.5">
          {health.map((note, i) => (
            <li
              key={`${note.atMs ?? 'x'}-${i}`}
              className={cn(
                'border-l-2 pl-2 font-mono text-xs',
                note.severity === 'warn' ? 'border-destructive' : 'border-border'
              )}>
              {note.atMs !== null && (
                <span className="text-muted-foreground">[{mmss(note.atMs)}] </span>
              )}
              <span className="text-foreground/80">{note.text}</span>
            </li>
          ))}
        </ul>
      )}

      {excluded.length > 0 && (
        <ul className="space-y-1">
          {excluded.map((span, i) => (
            <li key={i} className="text-muted-foreground font-mono text-xs">
              removed {mmss(span.startMs)}–{mmss(span.endMs)} — {span.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
