// report.md verbatim — what the recorder wrote, deliberately unrendered. Agents
// read the refined brief; this tab is here so a human can see the raw source.

import { ReportPanel } from '../report-panel'
import type { Walkthrough } from '../types'

export function ReportTab({
  walkthrough,
  urlByPath,
}: {
  walkthrough: Walkthrough
  urlByPath: Map<string, string>
}) {
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground font-mono text-[11px]">
        raw report.md — what the recorder wrote; agents read the refined brief
      </p>
      <ReportPanel walkthroughId={walkthrough.id} url={urlByPath.get('report.md')} />
    </div>
  )
}
