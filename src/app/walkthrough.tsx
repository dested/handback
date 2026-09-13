// /walkthroughs/:walkthroughId — the full page for one walkthrough. A crumb and
// the shared DetailHeader sit above the body. An agent walkthrough is a tab set
// whose Overview IS the shared WalkthroughDetail (the same body the /app pane
// renders); Recording, Frames, Console, Brief, report.md, Tasks and Edit with AI
// are the deep tabs. A human handback and a split-out child are simpler surfaces
// that share the crumb and header but not the tabs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { CloudEditor } from '~/components/edit/cloud-editor'
import { Button } from '~/components/ui/button'
import { ProjectTag } from '~/components/ui/project-tag'
import { Tabs } from '~/components/ui/tabs'
import { AssistantTab } from '~/components/viewer/desk/assistant'
import { BriefTab } from '~/components/viewer/desk/brief-tab'
import { ConsoleTab } from '~/components/viewer/desk/console-tab'
import { FramesTab } from '~/components/viewer/desk/frames-tab'
import { RecordingTab } from '~/components/viewer/desk/recording-tab'
import { ReportTab } from '~/components/viewer/desk/report-tab'
import { TasksTab } from '~/components/viewer/desk/tasks-tab'
import type { DeskTab } from '~/components/viewer/desk/types'
import { useWalkthroughMedia } from '~/components/viewer/desk/use-walkthrough-media'
import { FinalCut } from '~/components/viewer/final-cut'
import { WalkthroughDetail } from '~/components/viewer/pane/detail'
import { DetailHeader } from '~/components/viewer/pane/header'
import { SectionHead } from '~/components/viewer/section-head'
import { ViewerSkeleton } from '~/components/viewer/skeleton'
import type { Walkthrough } from '~/components/viewer/types'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

const SHELL = 'mx-auto w-full max-w-[1100px]'

export function WalkthroughPage() {
  const { walkthroughId } = useParams<{ walkthroughId: string }>()
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const walkthroughQuery = useQuery({
    ...trpc.walkthroughs.get.queryOptions({ walkthroughId: walkthroughId ?? '' }),
    enabled: Boolean(walkthroughId),
  })
  const [editing, setEditing] = useState(false)

  const walkthrough = walkthroughQuery.data

  const urlByPath = useMemo(
    () => new Map((walkthrough?.files ?? []).map((file) => [file.path, file.url])),
    [walkthrough]
  )

  // Refine runs server-side; poll get until the status leaves 'running'.
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

  if (walkthroughId && walkthroughQuery.isPending) {
    return (
      <div className={cn(SHELL, 'px-7 py-6')}>
        <ViewerSkeleton />
      </div>
    )
  }

  if (!walkthrough) {
    return (
      <div className={cn(SHELL, 'px-7 py-6')}>
        <div className="bg-card border-border max-w-md space-y-3 rounded-lg border p-6">
          <p className="text-[13px]">Couldn't load this walkthrough.</p>
          <Link to="/app" className="text-cobalt text-[13px] hover:underline">
            ← Walkthroughs
          </Link>
        </div>
      </div>
    )
  }

  const human = walkthrough.kind === 'human'
  const isChild = walkthrough.briefMd !== null
  const hasRawTakes =
    walkthrough.takes.length > 0 &&
    walkthrough.takes.every((take) =>
      urlByPath.has(take.videoPath ?? `${take.dir}/walkthrough.webm`)
    )
  const canEdit = hasRawTakes && walkthrough.viewerIsMember

  // Editing takes the whole surface for both kinds — the CloudEditor is the page
  // while it's up.
  if (editing && canEdit) {
    return (
      <div className={SHELL}>
        <Crumb walkthrough={walkthrough} />
        <DetailHeader walkthrough={walkthrough} mode="page" urlByPath={urlByPath} />
        <div className="px-7 py-5">
          <CloudEditor
            walkthroughId={walkthrough.id}
            recordedAt={walkthrough.recordedAt}
            takes={walkthrough.takes}
            urlByPath={urlByPath}
            onClose={() => setEditing(false)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className={SHELL}>
      <Crumb walkthrough={walkthrough} />
      {isChild ? (
        <ChildPage walkthrough={walkthrough} urlByPath={urlByPath} />
      ) : human ? (
        <HumanPage
          walkthrough={walkthrough}
          urlByPath={urlByPath}
          canEdit={canEdit}
          onEdit={() => setEditing(true)}
        />
      ) : (
        <AgentPage
          walkthrough={walkthrough}
          urlByPath={urlByPath}
          canEdit={canEdit}
          onEdit={() => setEditing(true)}
        />
      )}
    </div>
  )
}

function Crumb({ walkthrough }: { walkthrough: Walkthrough }) {
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 px-7 pt-4 text-[13px]">
      <Link to="/app" className="hover:text-foreground">
        Walkthroughs
      </Link>
      <span className="opacity-50">/</span>
      <ProjectTag
        id={walkthrough.project?.id ?? null}
        name={walkthrough.project?.name ?? 'General'}
      />
    </div>
  )
}

/** The agent review page: the shared detail body as Overview, then the deep tabs. */
function AgentPage({
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

  // A timestamp anywhere on the page seeks the recording and brings it up: the
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
  const tabs: { key: DeskTab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'recording', label: 'Recording' },
    { key: 'frames', label: 'Frames', count: walkthrough.frameCount },
    { key: 'console', label: 'Console', count: walkthrough.errorCount },
    { key: 'brief', label: 'Brief' },
    { key: 'report', label: 'report.md' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'assistant', label: 'Edit with AI' },
  ]

  return (
    <>
      <DetailHeader
        walkthrough={walkthrough}
        mode="page"
        urlByPath={urlByPath}
        onSplit={() => goTab('tasks')}
      />
      <div className="px-7 py-5">
        <Tabs items={tabs} value={tab} onChange={goTab} className="mb-5" />

        {/* Recording is hidden, never unmounted, so playback survives a tab switch
            and a seek from elsewhere lands on a live player. */}
        {takesExist && (
          <div ref={playerRef} className={cn('scroll-mt-4', tab !== 'recording' && 'hidden')}>
            <RecordingTab
              walkthrough={walkthrough}
              media={media}
              onEdit={canEdit ? onEdit : undefined}
            />
          </div>
        )}
        {tab === 'recording' && !takesExist && (
          <p className="text-muted-foreground text-sm">No takes were uploaded.</p>
        )}

        {tab === 'overview' && (
          <WalkthroughDetail
            walkthrough={walkthrough}
            urlByPath={urlByPath}
            media={media}
            mode="page"
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
    </>
  )
}

/** A split-out child: the shared body renders its brief, answer and thread. */
function ChildPage({
  walkthrough,
  urlByPath,
}: {
  walkthrough: Walkthrough
  urlByPath: Map<string, string>
}) {
  const media = useWalkthroughMedia(walkthrough, urlByPath)
  return (
    <>
      <DetailHeader walkthrough={walkthrough} mode="page" urlByPath={urlByPath} />
      <div className="px-7 py-5">
        <WalkthroughDetail
          walkthrough={walkthrough}
          urlByPath={urlByPath}
          media={media}
          mode="page"
        />
      </div>
    </>
  )
}

/** A human handback: the crumb and header, then the edited cut or the raw
 *  recording with the one-time CTA to tighten it. */
function HumanPage({
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
  return (
    <>
      <DetailHeader walkthrough={walkthrough} mode="page" urlByPath={urlByPath} />
      <div className="px-7 py-5">
        <HumanBody walkthrough={walkthrough} urlByPath={urlByPath} canEdit={canEdit} onEdit={onEdit} />
      </div>
    </>
  )
}

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
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-muted-foreground hover:text-foreground text-[13px] underline underline-offset-4">
            re-edit this cut
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {canEdit && (
        <div className="border-border bg-secondary space-y-3 rounded-lg border p-5">
          <SectionHead>For a person</SectionHead>
          <p className="text-[13px] leading-relaxed">
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
