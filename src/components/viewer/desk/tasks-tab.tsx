// What was carved out of this walkthrough, and the door to carving more. The
// children list renders itself away when there are none; the split flow stays
// behind an explicit button because proposing is a metered model call — a
// SplitPanel is never auto-mounted.

import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { SplitChildren, SplitPanel } from '../split-panel'
import type { Walkthrough } from '../types'

export function TasksTab({ walkthrough }: { walkthrough: Walkthrough }) {
  const [splitting, setSplitting] = useState(false)

  const canSplit =
    walkthrough.viewerIsMember && walkthrough.kind === 'agent' && walkthrough.briefMd === null

  return (
    <div className="min-w-0 space-y-6">
      <SplitChildren walkthrough={walkthrough} />

      {canSplit &&
        (splitting ? (
          <SplitPanel walkthrough={walkthrough} onClose={() => setSplitting(false)} />
        ) : (
          <div className="space-y-2">
            <Button type="button" variant="outline" onClick={() => setSplitting(true)}>
              Split into tasks…
            </Button>
            <p className="text-muted-foreground max-w-[560px] text-[13px] leading-relaxed">
              Carve this walkthrough into separate agent-ready tasks — you review the proposal before
              anything is created.
            </p>
          </div>
        ))}
    </div>
  )
}
