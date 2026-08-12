// /walkthroughs/:walkthroughId — the review surface. Everything a human needs to judge a
// recorded walkthrough before an agent touches it: the takes as video + keyframes +
// narration, and the report.md the agent will actually read.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
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
  const finalUrl = walkthrough.kind === 'human' ? urlByPath.get('final.mp4') : undefined

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <WalkthroughHeader walkthrough={walkthrough} />
        <WalkthroughControls walkthrough={walkthrough} />
      </div>

      {finalUrl ? (
        <div className="rule pt-8">
          <FinalCut
            videoUrl={finalUrl}
            transcriptUrl={urlByPath.get('transcript.json')}
            downloadUrl={walkthrough.downloadUrl}
          />
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
