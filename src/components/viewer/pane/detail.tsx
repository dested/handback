// The one detail body used by both the right-hand pane on /app and the Overview
// tab on /walkthroughs/:id. One scroll column: title, the field grid, the video
// (pane only — the page owns a dedicated Recording tab), what refine heard, the
// key-point checklist, the agent's result, the open question, the resolved line,
// and the activity thread. Sign-off moved to the header, so this body never
// carries the Approve/Send back controls.

import { useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ProUpsell } from '~/components/pro-upsell'
import { StatusPill } from '~/components/ui/status-pill'
import { AnswerForm } from '~/components/viewer/desk/review-actions'
import { Conversation } from '~/components/viewer/desk/conversation'
import type { OutcomeByPoint } from '~/components/viewer/desk/key-points'
import { Markdown } from '~/components/viewer/desk/markdown'
import type { useWalkthroughMedia } from '~/components/viewer/desk/use-walkthrough-media'
import { TaskBrief } from '~/components/viewer/split-panel'
import type { Walkthrough } from '~/components/viewer/types'
import { useSingleVideoPlayer } from '~/components/viewer/use-segment-player'
import { VideoStage } from '~/components/viewer/video-stage'
import { isProError } from '~/lib/pro'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { DetailFields, utcDay } from './fields'
import { useInvalidateWalkthrough } from './header'
import { KeyPointsChecklist } from './key-points-checklist'
import { ResultCard } from './result-card'

type Note = Walkthrough['notes'][number]
type Media = ReturnType<typeof useWalkthroughMedia>

/** Proof screenshots attached to a note, resolved through the presigned list. */
function Thumbs({ paths, urlByPath }: { paths: string[]; urlByPath: Map<string, string> }) {
  const shots = paths
    .map((path) => ({ path, url: urlByPath.get(path) }))
    .filter((s): s is { path: string; url: string } => s.url !== undefined)
  if (shots.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {shots.map((shot) => (
        <a key={shot.path} href={shot.url} target="_blank" rel="noreferrer">
          <img src={shot.url} alt="" className="border-border h-20 rounded border object-cover" />
        </a>
      ))}
    </div>
  )
}

/** The refine progress placeholder — a pulsing pill, a stage line, grey bars. */
function ProgressHero({ walkthrough }: { walkthrough: Walkthrough }) {
  const line =
    walkthrough.refineStage === 'reading'
      ? 'reading your walkthrough'
      : walkthrough.refineStage === 'frames'
        ? 'watching the frames'
        : walkthrough.refineStage === 'writing'
          ? 'writing it up'
          : 'processing'
  return (
    <div className="space-y-3">
      <StatusPill status={walkthrough.status} processing />
      <p className="text-muted-foreground text-[13px]">{line} — this page updates itself</p>
      <div className="max-w-[600px] space-y-2">
        <div className="bg-muted h-4 w-full animate-pulse rounded" />
        <div className="bg-muted h-4 w-[90%] animate-pulse rounded" />
        <div className="bg-muted h-4 w-[60%] animate-pulse rounded" />
      </div>
    </div>
  )
}

/** The title, editable on click, with refine's suggested title beneath it. */
function TitleBlock({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const invalidate = useInvalidateWalkthrough(walkthrough.id)
  const rename = useMutation(trpc.walkthroughs.rename.mutationOptions({ onSettled: invalidate }))
  const dismissSuggested = useMutation(
    trpc.walkthroughs.dismissSuggestedTitle.mutationOptions({ onSettled: invalidate })
  )

  const title = rename.isPending ? (rename.variables?.title ?? walkthrough.title) : walkthrough.title
  const member = walkthrough.viewerIsMember
  const suggested = walkthrough.suggestedTitle

  function commit(next: string) {
    const trimmed = next.trim()
    if (!trimmed || trimmed === walkthrough.title) return
    rename.mutate({ walkthroughId: walkthrough.id, title: trimmed })
  }

  return (
    <div className="space-y-1">
      {member ? (
        <input
          key={title}
          defaultValue={title}
          aria-label="Title"
          className="focus-visible:border-input -mx-2 w-[calc(100%+1rem)] rounded-md border border-transparent px-2 py-0.5 text-xl font-semibold outline-none focus-visible:bg-card"
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              e.currentTarget.value = title
              e.currentTarget.blur()
            }
          }}
        />
      ) : (
        <h2 className="text-xl font-semibold">{title}</h2>
      )}
      {rename.error && <p className="text-destructive text-xs">{rename.error.message}</p>}
      {suggested && member && (
        <p className="text-muted-foreground text-[13px]">
          Suggested: &ldquo;{suggested}&rdquo;{' '}
          <button
            type="button"
            className="text-cobalt hover:underline"
            disabled={rename.isPending}
            onClick={() => rename.mutate({ walkthroughId: walkthrough.id, title: suggested })}>
            use
          </button>{' '}
          <span className="opacity-50">·</span>{' '}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            disabled={dismissSuggested.isPending}
            onClick={() => dismissSuggested.mutate({ walkthroughId: walkthrough.id })}>
            dismiss
          </button>
        </p>
      )}
    </div>
  )
}

/** What refine heard: its progress while running, the digest once written, or the
 *  run-refine / upsell prompt when it hasn't run. */
function WhatYouSaid({
  walkthrough,
  pro,
  entLoaded,
}: {
  walkthrough: Walkthrough
  pro: boolean
  entLoaded: boolean
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const refine = useMutation(
    trpc.walkthroughs.refine.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
        }),
    })
  )
  const canRun = walkthrough.viewerIsMember && pro && entLoaded && !refine.isPending
  const run = () => refine.mutate({ walkthroughId: walkthrough.id })
  const runButton = (label: string, tone: string) => (
    <button type="button" className={cn('hover:underline disabled:opacity-60', tone)} disabled={!canRun} onClick={run}>
      {label}
    </button>
  )

  const { digestMd, refineStatus, summaryMd } = walkthrough

  let body: React.ReactNode
  if (refineStatus === 'running') {
    body = <ProgressHero walkthrough={walkthrough} />
  } else if (digestMd) {
    body = <Markdown className="text-[13px]">{digestMd}</Markdown>
  } else if (refineStatus === 'failed') {
    body = (
      <p className="text-destructive text-[13px]">
        Refine failed. {canRun && runButton('Retry', 'text-destructive')}
      </p>
    )
  } else if (refineStatus === null) {
    if (!entLoaded) body = null
    else if (!pro) body = <ProUpsell feature="Refine" />
    else if (walkthrough.viewerIsMember)
      body = (
        <p className="text-muted-foreground text-[13px]">
          {runButton('Run refine', 'text-cobalt')} to get the digest and key points.
        </p>
      )
    else body = null
  } else if (summaryMd) {
    body = <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{summaryMd}</p>
  } else {
    body = null
  }

  if (body === null) return null

  return (
    <section>
      <h3 className="text-foreground mb-1 text-[13px] font-semibold">What you said</h3>
      {body}
      {isProError(refine.error) && <p className="text-muted-foreground mt-1 text-xs">Refine is a Pro feature.</p>}
    </section>
  )
}

/** The agent's open question, with the answer box under it. */
function QuestionCard({
  walkthrough,
  question,
  urlByPath,
}: {
  walkthrough: Walkthrough
  question: Note
  urlByPath: Map<string, string>
}) {
  return (
    <section className="space-y-3">
      <div className="border-l-muted-foreground space-y-1.5 border-l-2 pl-3">
        <span className="text-muted-foreground text-xs">{question.authorName} is asking</span>
        <p className="text-[13px] leading-relaxed">{question.summary}</p>
        <Thumbs paths={question.evidencePaths} urlByPath={urlByPath} />
      </div>
      {walkthrough.viewerIsMember && <AnswerForm walkthrough={walkthrough} />}
    </section>
  )
}

/** The signed-off line — a Done pill, the retention note, and Keep. */
function ResolvedLine({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const invalidate = useInvalidateWalkthrough(walkthrough.id)
  const keep = useMutation(trpc.walkthroughs.keep.mutationOptions({ onSettled: invalidate }))
  return (
    <section className="flex flex-wrap items-center gap-3 text-[13px]">
      <StatusPill status="resolved" />
      <span className="text-muted-foreground">
        Signed off{walkthrough.expiresAt ? ` · clears ${utcDay(walkthrough.expiresAt)}` : ''}
      </span>
      {walkthrough.expiresAt && walkthrough.viewerIsMember && (
        <button
          type="button"
          className="text-cobalt hover:underline disabled:opacity-60"
          disabled={keep.isPending}
          onClick={() => keep.mutate({ walkthroughId: walkthrough.id })}>
          Keep
        </button>
      )}
    </section>
  )
}

/** A human handback in the pane: the edited cut's player if it rendered, else the
 *  raw takes. The single-video hook is always called (empty src is inert). */
function HumanVideo({ finalUrl, media }: { finalUrl: string | undefined; media: Media }) {
  const single = useSingleVideoPlayer(finalUrl ?? '')
  return (
    <div className="overflow-hidden rounded-lg">
      {finalUrl ? (
        <VideoStage player={single} />
      ) : (
        <VideoStage player={media.player} frames={media.frames} />
      )}
    </div>
  )
}

export function WalkthroughDetail({
  walkthrough,
  urlByPath,
  media,
  mode,
  onSeek,
}: {
  walkthrough: Walkthrough
  urlByPath: Map<string, string>
  media: Media
  mode: 'pane' | 'page'
  /** The page passes its own seek (switch to the Recording tab, then seek the
   *  shared player); the pane seeks its own inline player. */
  onSeek?: (ms: number) => void
}) {
  const trpc = useTRPC()
  const entitlements = useQuery(trpc.teams.entitlements.queryOptions())
  const pro = entitlements.data?.pro ?? false
  const entLoaded = entitlements.isSuccess

  const videoRef = useRef<HTMLDivElement>(null)
  const seekInline = useCallback(
    (ms: number) => {
      media.player.seekOutput(ms, true)
      requestAnimationFrame(() =>
        videoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      )
    },
    [media.player]
  )
  const seek = onSeek ?? seekInline

  const isChild = walkthrough.briefMd !== null
  const human = walkthrough.kind === 'human'
  // The page renders the recording in its own tab; only the pane inlines a player.
  const showVideo = mode === 'pane' && !isChild

  const result = [...walkthrough.notes]
    .reverse()
    .find((n) => n.role === 'agent' && n.kind === 'result')
  const outcomes: OutcomeByPoint = new Map(
    (result?.outcomes ?? []).map((o) => [o.point, { status: o.status, note: o.note }])
  )
  const question = [...walkthrough.notes].reverse().find((n) => n.kind === 'question')

  return (
    <div className={cn('flex max-w-[760px] flex-col gap-5', mode === 'pane' ? 'px-5 py-4' : 'py-1')}>
      <TitleBlock walkthrough={walkthrough} />
      <DetailFields walkthrough={walkthrough} />

      {isChild ? (
        <TaskBrief walkthrough={walkthrough} />
      ) : (
        <>
          {showVideo &&
            (human ? (
              <HumanVideo finalUrl={urlByPath.get('final.mp4')} media={media} />
            ) : (
              <div ref={videoRef} className="scroll-mt-4 overflow-hidden rounded-lg">
                <VideoStage player={media.player} frames={media.frames} />
              </div>
            ))}

          {!human && <WhatYouSaid walkthrough={walkthrough} pro={pro} entLoaded={entLoaded} />}

          {!human && (
            <KeyPointsChecklist points={walkthrough.points} outcomes={outcomes} onSeek={seek} />
          )}

          {result && <ResultCard note={result} urlByPath={urlByPath} />}
        </>
      )}

      {walkthrough.status === 'needs_info' && question && (
        <QuestionCard walkthrough={walkthrough} question={question} urlByPath={urlByPath} />
      )}

      {walkthrough.status === 'resolved' && <ResolvedLine walkthrough={walkthrough} />}

      <section>
        <h3 className="text-foreground mb-2 text-[13px] font-semibold">Activity</h3>
        <Conversation walkthrough={walkthrough} playheadMs={media.player.outputMs} onSeek={seek} />
      </section>
    </div>
  )
}
