// What an agent actually reads when it pulls this walkthrough. Refine writes an
// intent-aware working brief (refinedBriefMd) that supersedes the raw report;
// until it has run, the agent reads report.md as-is, so this tab shows whichever
// one is live — rendered, because here it's for a human to check, not to copy.

import { useQuery } from '@tanstack/react-query'
import { Markdown } from './markdown'
import type { Walkthrough } from '../types'

export function BriefTab({
  walkthrough,
  urlByPath,
}: {
  walkthrough: Walkthrough
  urlByPath: Map<string, string>
}) {
  const reportUrl = urlByPath.get('report.md')
  const report = useQuery({
    queryKey: ['handback.report-brief', walkthrough.id],
    enabled: walkthrough.refinedBriefMd === null && reportUrl !== undefined,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const res = await fetch(reportUrl!)
      if (!res.ok) throw new Error(`report.md failed (${res.status})`)
      return res.text()
    },
  })

  if (walkthrough.refinedBriefMd) {
    return (
      <div className="min-w-0 space-y-3">
        <p className="text-muted-foreground font-mono text-[11px]">
          the working brief — written by refine; agents read this instead of the raw report
        </p>
        <Markdown className="max-w-[720px]">{walkthrough.refinedBriefMd}</Markdown>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-3">
      <p className="text-muted-foreground font-mono text-[11px]">
        no refined brief yet — agents read the raw report.md
      </p>
      {reportUrl === undefined ? (
        <p className="text-muted-foreground text-sm">No report was uploaded.</p>
      ) : report.data !== undefined ? (
        <Markdown className="max-w-[720px]">{report.data}</Markdown>
      ) : report.isError ? (
        <p className="text-muted-foreground text-sm">Couldn't load report.md.</p>
      ) : (
        <div className="max-w-[720px] space-y-2">
          <div className="bg-muted h-4 w-full animate-pulse rounded" />
          <div className="bg-muted h-4 w-[80%] animate-pulse rounded" />
        </div>
      )}
    </div>
  )
}
