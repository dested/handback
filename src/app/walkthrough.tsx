// /walkthroughs/:walkthroughId — the review desk. A masthead over two columns:
// the tab rail and the work area for the active tab. The review lives in tabs —
// the Overview/Verdict hero carries the state and its action (sign off, answer),
// the Conversation tab holds the thread, and Edit with AI is the assistant. A
// human handback and a split-out child task are simpler surfaces that share the
// same masthead but not the desk.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { CloudEditor } from '~/components/edit/cloud-editor'
import { Button } from '~/components/ui/button'
import { AssistantTab } from '~/components/viewer/desk/assistant'
import { BriefTab } from '~/components/viewer/desk/brief-tab'
import { ConsoleTab } from '~/components/viewer/desk/console-tab'
import { Conversation } from '~/components/viewer/desk/conversation'
import { FramesTab } from '~/components/viewer/desk/frames-tab'
import { Masthead } from '~/components/viewer/desk/masthead'
import { OverviewTab } from '~/components/viewer/desk/overview-tab'
import { DeskRail } from '~/components/viewer/desk/rail'
import { RecordingTab } from '~/components/viewer/desk/recording-tab'
import { ReportTab } from '~/components/viewer/desk/report-tab'
import { AnswerForm, SignOff } from '~/components/viewer/desk/review-actions'
import { TasksTab } from '~/components/viewer/desk/tasks-tab'
import type { DeskTab } from '~/components/viewer/desk/types'
import { useWalkthroughMedia } from '~/components/viewer/desk/use-walkthrough-media'
import { FinalCut } from '~/components/viewer/final-cut'
import { SectionHead } from '~/components/viewer/section-head'
import { ViewerSkeleton } from '~/components/viewer/skeleton'
import { TaskBrief } from '~/components/viewer/split-panel'
import type { Walkthrough } from '~/components/viewer/types'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

export function WalkthroughPage() {
  const { walkthroughId } = useParams<{ walkthroughId: string }>()
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const walkthroughQuery = useQuery({
    ...trpc.walkthroughs.get.queryOptions({ walkthroughId: walkthroughId! }),
    enabled: Boolean(walkthroughId),
  })
  /** The inline edit mode. It replaces the takes while it's up. */
  const [editing, setEditing] = useState(false)

  const walkthrough = walkthroughQuery.data

  // Every file arrives with its own presigned url; one lookup table serves the
  // video, all the keyframes, recording.json and report.md.
  const urlByPath = useMemo(
    () => new Map((walkthrough?.files ?? []).map((file) => [file.path, file.url])),
    [walkthrough]
  )

  // Refine runs server-side; while it's going the outcome lands there, not here,
  // so poll `get` until the status leaves 'running'. Costs nothing once settled.
  const refineStatus = walkthrough?.refineStatus
  useEffect(() => {
    if (refineStatus !== 'running' || !walkthroughId) return
    const id = setInterval(() => {
      queryClient.invalidateQueries({
        queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId }),
      })
    }, 5000)
    return () => clearInterval(id)
  }, [refineStatus, walkthroughId, queryClient, trpc])

  // The app shell serves this route full-bleed (the desk owns its padding), so
  // every simpler surface — skeleton, error, child, editor, human — brings back
  // the ordinary page container itself.
  const CONTAINER = 'mx-auto w-full max-w-6xl px-6 py-8'

  // A disabled query stays pending forever, so the id guard comes first.
  if (walkthroughId && walkthroughQuery.isPending) {
    return (
      <div className={CONTAINER}>
        <ViewerSkeleton />
      </div>
    )
  }

  if (!walkthrough) {
    return (
      <div className={CONTAINER}>
        <div className="bg-card max-w-md space-y-3 rounded-md border p-6">
          <p className="text-sm">Couldn't load this walkthrough.</p>
          <Link to="/app" className="text-cobalt text-sm hover:underline">
            ← Walkthroughs
          </Link>
        </div>
      </div>
    )
  }

  const human = walkthrough.kind === 'human'
  // A split-out task is its brief; there is no recording of its own to review.
  const isChild = walkthrough.briefMd !== null
  // An extension human handback arrives as raw takes and gets tightened here;
  // /record's arrives already rendered. Whether the raws are present decides both
  // whether there is an edit to make and whether a render can be re-cut.
  const hasRawTakes =
    walkthrough.takes.length > 0 &&
    walkthrough.takes.every((take) =>
      urlByPath.has(take.videoPath ?? `${take.dir}/walkthrough.webm`)
    )
  const canEdit = hasRawTakes && walkthrough.viewerIsMember

  // A child is its brief, the conversation, and the way back to the parent
  // recording — no rail, no tabs. The sign-off / answer controls ride above the
  // thread since there's no Overview hero to carry them.
  if (isChild) {
    return (
      <div className={cn(CONTAINER, 'space-y-6')}>
        <Masthead walkthrough={walkthrough} />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <TaskBrief walkthrough={walkthrough} />
          <div className="space-y-6">
            <SignOff walkthrough={walkthrough} />
            {walkthrough.status === 'needs_info' && walkthrough.viewerIsMember && (
              <AnswerForm walkthrough={walkthrough} />
            )}
            <Conversation walkthrough={walkthrough} playheadMs={0} onSeek={() => {}} />
          </div>
        </div>
      </div>
    )
  }

  // Editing takes the whole surface for both kinds — the CloudEditor is the page
  // while it's up.
  if (editing && canEdit) {
    return (
      <div className={cn(CONTAINER, 'space-y-6')}>
        <Masthead walkthrough={walkthrough} />
        <CloudEditor
          walkthroughId={walkthrough.id}
          recordedAt={walkthrough.recordedAt}
          takes={walkthrough.takes}
          urlByPath={urlByPath}
          onClose={() => setEditing(false)}
        />
      </div>
    )
  }

  if (human) {
    return (
      <div className={cn(CONTAINER, 'space-y-6')}>
        <Masthead walkthrough={walkthrough} />
        <HumanBody
          walkthrough={walkthrough}
          urlByPath={urlByPath}
          canEdit={canEdit}
          onEdit={() => setEditing(true)}
        />
      </div>
    )
  }

  return (
    <AgentDesk
      walkthrough={walkthrough}
      urlByPath={urlByPath}
      canEdit={canEdit}
      onEdit={() => setEditing(true)}
    />
  )
}

/** A human handback: its tight cut if it has one, otherwise the raw recording
 *  with the one-time CTA to tighten it. No rail, no exchange — it's for a
 *  person, not an agent. */
function HumanBody({
  walkthrough,
  urlByPath,
  canEdit,
  onEdit,
}: {
  walkthrough: Walkthrough
  urlByPath: Map<string, string>
  canEdit: boolean
  onEdit: () => void
}) {
  const media = useWalkthroughMedia(walkthrough, urlByPath)
  const finalUrl = urlByPath.get('final.mp4')

  if (finalUrl) {
    return (
      <div className="space-y-4">
        <FinalCut
          videoUrl={finalUrl}
          transcriptUrl={urlByPath.get('transcript.json')}
          downloadUrl={walkthrough.downloadUrl}
        />
        {/* The raws survived the render, so the cut is not final. */}
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4">
            re-edit this cut
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Recorded for a person, uploaded raw, never tightened: the edit is the
          one thing anyone wants from this page. */}
      {canEdit && (
        <div className="border-border bg-muted/20 space-y-3 rounded-md border p-5">
          <SectionHead>for a person</SectionHead>
          <p className="text-sm leading-relaxed">
            This was recorded as a video to hand to someone. Cut the dead air out of it here and it
            becomes one MP4 with a share link — the raw takes stay put, so you can re-cut it any
            time.
          </p>
          <Button type="button" onClick={onEdit}>
            Tighten &amp; share
          </Button>
        </div>
      )}
      <RecordingTab walkthrough={walkthrough} media={media} />
    </div>
  )
}

/** The agent review desk: masthead, then rail · work. */
function AgentDesk({
  walkthrough,
  urlByPath,
  canEdit,
  onEdit,
}: {
  walkthrough: Walkthrough
  urlByPath: Map<string, string>
  canEdit: boolean
  onEdit: () => void
}) {
  const trpc = useTRPC()
  const media = useWalkthroughMedia(walkthrough, urlByPath)
  const [tab, setTab] = useState<DeskTab>('overview')
  const playerRef = useRef<HTMLDivElement>(null)

  const entitlements = useQuery(trpc.teams.entitlements.queryOptions())
  const pro = entitlements.data?.pro ?? false
  const entLoaded = entitlements.isSuccess

  // Leaving the recording for another tab stops the sound playing behind it.
  const goTab = useCallback(
    (next: DeskTab) => {
      if (next !== 'recording' && media.player.playing) media.player.togglePlay()
      setTab(next)
    },
    [media.player]
  )

  // A timestamp anywhere on the desk seeks the recording and brings it up: the
  // player is hidden (not unmounted) on other tabs, so switch first, then scroll
  // on the next frame once it's visible.
  const onSeek = useCallback(
    (ms: number) => {
      setTab('recording')
      media.player.seekOutput(ms, true)
      requestAnimationFrame(() =>
        playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      )
    },
    [media.player]
  )

  const takesExist = media.takes.length > 0

  return (
    <div>
      {/* Full-bleed: the masthead is a bar across the desk, not a block in a
          centered column. */}
      <div className="px-6 pt-5">
        <Masthead walkthrough={walkthrough} onTab={goTab} />
      </div>

      <div className="lg:grid lg:grid-cols-[208px_minmax(0,1fr)]">
        <DeskRail walkthrough={walkthrough} tab={tab} onTab={goTab} media={media} />

        <div className="min-w-0 px-6 py-6 lg:px-8">
          {/* Recording is hidden, never unmounted, so playback survives a tab
              switch and a seek from elsewhere lands on a live player. */}
          {takesExist && (
            <div ref={playerRef} className={cn('scroll-mt-4', tab !== 'recording' && 'hidden')}>
              <RecordingTab walkthrough={walkthrough} media={media} onEdit={canEdit ? onEdit : undefined} />
            </div>
          )}
          {tab === 'recording' && !takesExist && (
            <p className="text-muted-foreground text-sm">No takes were uploaded.</p>
          )}

          {tab === 'overview' && (
            <OverviewTab
              walkthrough={walkthrough}
              urlByPath={urlByPath}
              onSeek={onSeek}
              onTab={goTab}
              pro={pro}
              entLoaded={entLoaded}
            />
          )}
          {tab === 'conversation' && (
            <Conversation
              walkthrough={walkthrough}
              playheadMs={media.player.outputMs}
              onSeek={onSeek}
            />
          )}
          {tab === 'frames' && (
            <FramesTab walkthrough={walkthrough} media={media} onPlayFrom={onSeek} />
          )}
          {tab === 'brief' && <BriefTab walkthrough={walkthrough} urlByPath={urlByPath} />}
          {tab === 'console' && <ConsoleTab media={media} />}
          {tab === 'report' && <ReportTab walkthrough={walkthrough} urlByPath={urlByPath} />}
          {tab === 'tasks' && <TasksTab walkthrough={walkthrough} />}
          {tab === 'assistant' && (
            <AssistantTab walkthrough={walkthrough} pro={pro} entLoaded={entLoaded} />
          )}
        </div>
      </div>
    </div>
  )
}
