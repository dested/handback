// /gripes/:gripeId — the review surface. Everything a human needs to judge a
// recorded gripe before an agent touches it: the takes as video + keyframes +
// narration, and the report.md the agent will actually read.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { GripeControls } from '~/components/viewer/gripe-controls'
import { GripeHeader } from '~/components/viewer/gripe-header'
import { ReportPanel } from '~/components/viewer/report-panel'
import { ViewerSkeleton } from '~/components/viewer/skeleton'
import { TakeSection } from '~/components/viewer/take-section'
import { useTRPC } from '~/lib/trpc'

export function GripePage() {
  const { gripeId } = useParams<{ gripeId: string }>()
  const trpc = useTRPC()
  const gripeQuery = useQuery({
    ...trpc.gripes.get.queryOptions({ gripeId: gripeId! }),
    enabled: Boolean(gripeId),
  })

  const gripe = gripeQuery.data

  // Every file arrives with its own presigned url; one lookup table serves the
  // video, all the keyframes, recording.json and report.md.
  const urlByPath = useMemo(
    () => new Map((gripe?.files ?? []).map((file) => [file.path, file.url])),
    [gripe]
  )

  // A disabled query stays pending forever, so the id guard comes first.
  if (gripeId && gripeQuery.isPending) return <ViewerSkeleton />

  if (!gripe) {
    return (
      <div className="bg-card max-w-md space-y-3 rounded-md border p-6">
        <p className="text-sm">Couldn't load this gripe.</p>
        <Link to="/app" className="text-cobalt text-sm hover:underline">
          ← Inbox
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <GripeHeader gripe={gripe} />
        <GripeControls gripe={gripe} />
      </div>

      {gripe.takes.map((take) => (
        <div key={take.id} className="rule pt-8">
          <TakeSection take={take} urlByPath={urlByPath} />
        </div>
      ))}

      {gripe.takes.length === 0 && (
        <p className="rule text-muted-foreground pt-8 text-sm">No takes were uploaded.</p>
      )}

      <div className="rule pt-8">
        <ReportPanel gripeId={gripe.id} url={urlByPath.get('report.md')} />
      </div>
    </div>
  )
}
