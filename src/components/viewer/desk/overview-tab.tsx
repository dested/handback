// The work area's hero — one tab that reads the walkthrough's whole state back
// to the reviewer. In review with an agent result it's the verdict (the mock's
// "what you raised → what came back"); waiting on an answer it's the question;
// resolved it's the sign-off; otherwise it's the open state — the digest, the
// key points, the curated frames, and refine's progress while it runs. The
// sign-off buttons live in the exchange pane, not here.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ProUpsell } from '~/components/pro-upsell'
import { Button } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { mmss } from '../format'
import { SectionHead } from '../section-head'
import type { Walkthrough } from '../types'
import { KeyPointsTable, type OutcomeByPoint } from './key-points'
import { Markdown } from './markdown'
import type { DeskTab } from './types'

type Note = Walkthrough['notes'][number]

/** Coarse relative time — the page cares about "just now" vs "yesterday". */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Days until an expiry, floored at 0. */
function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
}

/** Proof screenshots an agent attached, resolved through the presigned file
 *  list; a path with no file is dropped rather than rendered broken. */
function Thumbs({
  paths,
  urlByPath,
  imgClass,
}: {
  paths: string[]
  urlByPath: Map<string, string>
  imgClass: string
}) {
  const shots = paths
    .map((path) => ({ path, url: urlByPath.get(path) }))
    .filter((s): s is { path: string; url: string } => s.url !== undefined)
  if (shots.length === 0) return null
  return (
    <div className="flex flex-wrap gap-3">
      {shots.map((shot) => (
        <a key={shot.path} href={shot.url} target="_blank" rel="noreferrer">
          <img src={shot.url} alt="" className={cn('border-border rounded-md border', imgClass)} />
        </a>
      ))}
    </div>
  )
}

/** While refine runs the digest and points are replaced by a labelled skeleton;
 *  the page polls itself, so this stands in until the real content lands. */
function ProgressHero({ stage }: { stage: Walkthrough['refineStage'] }) {
  const heading =
    stage === 'reading'
      ? 'Reading your walkthrough…'
      : stage === 'frames'
        ? 'Watching the frames…'
        : stage === 'writing'
          ? 'Writing it up…'
          : 'Refining…'
  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl font-semibold">{heading}</h2>
      <p className="text-muted-foreground font-mono text-xs">
        the digest and key points land here — the page updates itself
      </p>
      <div className="max-w-[680px] space-y-2">
        <div className="bg-muted h-4 w-full animate-pulse rounded" />
        <div className="bg-muted h-4 w-[90%] animate-pulse rounded" />
        <div className="bg-muted h-4 w-[60%] animate-pulse rounded" />
      </div>
      <div className="bg-muted/50 h-24 max-w-[680px] animate-pulse rounded" />
    </div>
  )
}

/** The open-state body — digest, key points, curated frames, capture notes,
 *  removed spans, the full ledger. Reused under the "in review, no result yet"
 *  and "needs info" states as context beneath the primary block. */
function OpenStateBody({
  walkthrough,
  urlByPath,
  onSeek,
  onTab,
  pro,
  entLoaded,
}: {
  walkthrough: Walkthrough
  urlByPath: Map<string, string>
  onSeek: (ms: number) => void
  onTab: (t: DeskTab) => void
  pro: boolean
  entLoaded: boolean
}) {
  const { digestMd, refineStatus, refineStage, points, health, curation, summaryMd } = walkthrough
  const frames = curation?.frames ?? []
  const excluded = curation?.excluded ?? []

  return (
    <>
      {refineStatus === 'running' ? (
        <ProgressHero stage={refineStage} />
      ) : (
        <>
          {digestMd ? (
            <Markdown className="max-w-[680px] text-[15px]">{digestMd}</Markdown>
          ) : refineStatus === null ? (
            entLoaded ? (
              pro ? (
                <p className="text-muted-foreground font-mono text-xs">
                  run refine (in the rail) to get the digest and key points.
                </p>
              ) : (
                <ProUpsell feature="Refine" />
              )
            ) : null
          ) : refineStatus === 'failed' ? (
            <p className="text-destructive font-mono text-xs">refine failed — retry from the rail.</p>
          ) : null}

          {points.length > 0 && (
            <section className="space-y-2.5">
              <SectionHead>the key points</SectionHead>
              <KeyPointsTable points={points} onSeek={onSeek} />
            </section>
          )}
        </>
      )}

      {frames.length > 0 && (
        <section className="space-y-2.5">
          <SectionHead>curated frames</SectionHead>
          <div className="flex gap-3 overflow-x-auto">
            {frames.slice(0, 8).map((frame, i) => {
              const url = urlByPath.get(frame.path)
              const atMs = frame.atMs
              return (
                <figure key={`${frame.path}-${i}`} className="w-40 shrink-0 space-y-1.5">
                  {url && (
                    <img
                      src={url}
                      alt=""
                      className="border-border h-24 w-full rounded-md border object-cover"
                    />
                  )}
                  {frame.caption && (
                    <figcaption className="text-muted-foreground line-clamp-2 font-mono text-[10px]">
                      {frame.caption}
                    </figcaption>
                  )}
                  {atMs !== null && (
                    <button
                      type="button"
                      onClick={() => onSeek(atMs)}
                      className="text-cobalt font-mono text-[10px] hover:underline">
                      {mmss(atMs)}
                    </button>
                  )}
                </figure>
              )
            })}
            {frames.length > 8 && (
              <button
                type="button"
                onClick={() => onTab('frames')}
                className="text-cobalt shrink-0 self-center font-mono text-xs whitespace-nowrap hover:underline">
                +{frames.length - 8} more →
              </button>
            )}
          </div>
        </section>
      )}

      {health.length > 0 && (
        <section className="space-y-2.5">
          <SectionHead>capture notes</SectionHead>
          <ul className="space-y-1.5">
            {health.map((note, i) => {
              const atMs = note.atMs
              return (
                <li
                  key={`${atMs ?? 'x'}-${i}`}
                  className={cn(
                    'border-l-2 pl-2 font-mono text-[11px]',
                    note.severity === 'warn' ? 'border-destructive' : 'border-border'
                  )}>
                  {atMs !== null && (
                    <button
                      type="button"
                      onClick={() => onSeek(atMs)}
                      className="text-muted-foreground hover:text-cobalt">
                      [{mmss(atMs)}]{' '}
                    </button>
                  )}
                  <span className="text-foreground/80">{note.text}</span>
                </li>
              )
            })}
          </ul>
        </section>
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

      {summaryMd && (
        <details className="group">
          <summary className="text-muted-foreground flex cursor-pointer list-none items-center gap-2 font-mono text-[11px] tracking-widest uppercase [&::-webkit-details-marker]:hidden">
            <span className="transition-transform group-open:rotate-90">▸</span>
            the full ledger
          </summary>
          <div className="border-border mt-3 border-l-2 pl-3 text-[13px] leading-relaxed whitespace-pre-wrap">
            {summaryMd}
          </div>
        </details>
      )}
    </>
  )
}

export function OverviewTab({
  walkthrough,
  urlByPath,
  onSeek,
  onTab,
  pro,
  entLoaded,
}: {
  walkthrough: Walkthrough
  urlByPath: Map<string, string>
  onSeek: (ms: number) => void
  onTab: (t: DeskTab) => void
  pro: boolean
  entLoaded: boolean
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const keep = useMutation(
    trpc.walkthroughs.keep.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
        }),
    })
  )

  const points = walkthrough.points
  const latestResult = walkthrough.notes
    .filter((n): n is Note => n.role === 'agent' && n.kind === 'result')
    .at(-1)
  const latestQuestion = walkthrough.notes.filter((n) => n.kind === 'question').at(-1)
  const outcomeMap: OutcomeByPoint | null = latestResult
    ? new Map(latestResult.outcomes.map((o) => [o.point, { status: o.status, note: o.note }]))
    : null

  const openBody = (
    <OpenStateBody
      walkthrough={walkthrough}
      urlByPath={urlByPath}
      onSeek={onSeek}
      onTab={onTab}
      pro={pro}
      entLoaded={entLoaded}
    />
  )

  // The verdict — an agent handed the walkthrough back with a result.
  if (walkthrough.status === 'in_review' && latestResult) {
    const nFixed = outcomeMap
      ? [...outcomeMap.values()].filter((o) => o.status === 'fixed').length
      : 0
    return (
      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-review font-mono text-[11px] font-medium tracking-widest uppercase">
            handed back
          </span>
          <span className="text-muted-foreground font-mono text-[11px]">
            {latestResult.authorName} · {ago(latestResult.createdAt)}
          </span>
          <span className="ml-auto flex items-baseline gap-x-4">
            {latestResult.filesTouched.length > 0 && (
              <span className="text-muted-foreground font-mono text-[11px]">
                {latestResult.filesTouched.length} files
              </span>
            )}
            {latestResult.prUrl && (
              <a
                href={latestResult.prUrl}
                target="_blank"
                rel="noreferrer"
                className="text-cobalt font-mono text-xs hover:underline">
                view the PR ↗
              </a>
            )}
          </span>
        </div>

        <h2 className="font-display max-w-[700px] text-[23px] font-semibold">
          {latestResult.summary}
        </h2>

        {latestResult.bodyMd && <Markdown className="max-w-[680px]">{latestResult.bodyMd}</Markdown>}

        {points.length > 0 && (
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <SectionHead>what you raised → what came back</SectionHead>
              <span
                className={cn(
                  'font-mono text-[11px]',
                  nFixed === points.length && nFixed > 0
                    ? 'text-approve'
                    : 'text-muted-foreground'
                )}>
                {nFixed} of {points.length} addressed
              </span>
            </div>
            <KeyPointsTable points={points} outcomes={outcomeMap} onSeek={onSeek} />
          </section>
        )}

        {latestResult.evidencePaths.length > 0 && (
          <section className="space-y-2.5">
            <SectionHead>evidence</SectionHead>
            <Thumbs
              paths={latestResult.evidencePaths}
              urlByPath={urlByPath}
              imgClass="h-28 object-cover"
            />
          </section>
        )}

        {latestResult.filesTouched.length > 0 && (
          <p className="text-muted-foreground font-mono text-xs break-all">
            {latestResult.filesTouched.join(' · ')}
          </p>
        )}
      </div>
    )
  }

  // In review, but no agent result has landed yet.
  if (walkthrough.status === 'in_review') {
    return (
      <div className="min-w-0 space-y-6">
        <p className="text-muted-foreground font-mono text-sm">
          marked in review — no agent result yet.
        </p>
        {openBody}
      </div>
    )
  }

  // The agent is waiting on an answer.
  if (walkthrough.status === 'needs_info' && latestQuestion) {
    return (
      <div className="min-w-0 space-y-6">
        <div className="space-y-3">
          <SectionHead>the agent is asking</SectionHead>
          <div className="border-l-muted-foreground max-w-[680px] space-y-2 border-l-2 pl-4">
            <p className="text-[17px] leading-relaxed">{latestQuestion.summary}</p>
            <span className="text-muted-foreground font-mono text-[11px]">
              {latestQuestion.authorName} · {ago(latestQuestion.createdAt)}
            </span>
          </div>
          {latestQuestion.evidencePaths.length > 0 && (
            <Thumbs
              paths={latestQuestion.evidencePaths}
              urlByPath={urlByPath}
              imgClass="h-20 object-cover"
            />
          )}
          <p className="text-muted-foreground font-mono text-xs">answer it in the exchange →</p>
        </div>
        <div className="rule space-y-6 pt-6">{openBody}</div>
      </div>
    )
  }

  // Signed off.
  if (walkthrough.status === 'resolved') {
    return (
      <div className="min-w-0 space-y-6">
        <span className="stamp text-approve">signed off</span>
        {latestResult && (
          <>
            <p className="max-w-[680px] text-[15px]">{latestResult.summary}</p>
            {points.length > 0 && (
              <KeyPointsTable points={points} outcomes={outcomeMap} onSeek={onSeek} />
            )}
          </>
        )}
        {walkthrough.expiresAt && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground font-mono text-[11px]">
              expires in {daysUntil(walkthrough.expiresAt)}d — kept recordings never expire
            </span>
            {walkthrough.viewerIsMember && (
              <Button
                variant="outline"
                size="sm"
                disabled={keep.isPending}
                onClick={() => keep.mutate({ walkthroughId: walkthrough.id })}>
                Keep
              </Button>
            )}
          </div>
        )}
      </div>
    )
  }

  // Open (or needs_info with no question) — the plain body.
  return <div className="min-w-0 space-y-6">{openBody}</div>
}
