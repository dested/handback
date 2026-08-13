// /walkthroughs/:walkthroughId — the review surface. Everything a human needs to judge a
// recorded walkthrough before an agent touches it: the takes as video + keyframes +
// narration, and the report.md the agent will actually read.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { CloudEditor } from '~/components/edit/cloud-editor'
import { Button } from '~/components/ui/button'
import { FinalCut } from '~/components/viewer/final-cut'
import { WalkthroughControls } from '~/components/viewer/walkthrough-controls'
import { WalkthroughHeader } from '~/components/viewer/walkthrough-header'
import { ReportPanel } from '~/components/viewer/report-panel'
import { ViewerSkeleton } from '~/components/viewer/skeleton'
import { TakeSection } from '~/components/viewer/take-section'
import { useTRPC } from '~/lib/trpc'

export function WalkthroughPage() {
  const { walkthroughId } = useParams<{ walkthroughId: string }>()
  const trpc = useTRPC()
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

  // A disabled query stays pending forever, so the id guard comes first.
  if (walkthroughId && walkthroughQuery.isPending) return <ViewerSkeleton />

  if (!walkthrough) {
    return (
      <div className="bg-card max-w-md space-y-3 rounded-md border p-6">
        <p className="text-sm">Couldn't load this walkthrough.</p>
        <Link to="/app" className="text-cobalt text-sm hover:underline">
          ← Inbox
        </Link>
      </div>
    )
  }

  // A human handback's artifact is its edited render — one player, the
  // narration beside it, no filmstrip/report scaffolding (there is no distill
  // to show). Falls through to the take view if the render never uploaded.
  const human = walkthrough.kind === 'human'
  const finalUrl = human ? urlByPath.get('final.mp4') : undefined
  // An extension human handback arrives as raw takes and gets tightened here;
  // /record's arrives already rendered and has none. Whether the raws are
  // present is therefore the whole question — it decides both whether there is
  // an edit to make and whether the render can be re-cut.
  const hasRawTakes =
    human &&
    walkthrough.takes.length > 0 &&
    walkthrough.takes.every((take) =>
      urlByPath.has(take.videoPath ?? `${take.dir}/walkthrough.webm`)
    )
  const canEdit = hasRawTakes && walkthrough.viewerIsMember

  if (editing && canEdit) {
    return (
      <div className="space-y-8">
        <div className="space-y-5">
          <WalkthroughHeader walkthrough={walkthrough} />
        </div>
        <div className="rule pt-8">
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
    <div className="space-y-8">
      <div className="space-y-5">
        <WalkthroughHeader walkthrough={walkthrough} />
        <WalkthroughControls walkthrough={walkthrough} />
      </div>

      {/* Recorded for a person, uploaded raw, never tightened: the edit is the
          only thing anyone wants from this page, so it is the page. */}
      {canEdit && !finalUrl && (
        <div className="border-border bg-muted/20 space-y-3 rounded-md border p-5">
          <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
            For a person
          </p>
          <p className="text-sm leading-relaxed">
            This was recorded as a video to hand to someone. Cut the dead air out of it here and it
            becomes one MP4 with a share link — the raw takes stay put, so you can re-cut it any
            time.
          </p>
          <Button type="button" onClick={() => setEditing(true)}>
            Tighten &amp; share
          </Button>
        </div>
      )}

      {finalUrl ? (
        <div className="rule space-y-4 pt-8">
          <FinalCut
            videoUrl={finalUrl}
            transcriptUrl={urlByPath.get('transcript.json')}
            downloadUrl={walkthrough.downloadUrl}
          />
          {/* The raws survived the render, so the cut is not final. */}
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4">
              re-edit this cut
            </button>
          )}
        </div>
      ) : (
        <>
          {walkthrough.takes.map((take) => (
            <div key={take.id} className="rule pt-8">
              <TakeSection take={take} urlByPath={urlByPath} />
            </div>
          ))}

          {walkthrough.takes.length === 0 && (
            <p className="rule text-muted-foreground pt-8 text-sm">No takes were uploaded.</p>
          )}

          <div className="rule pt-8">
            <ReportPanel walkthroughId={walkthrough.id} url={urlByPath.get('report.md')} />
          </div>
        </>
      )}
    </div>
  )
}
