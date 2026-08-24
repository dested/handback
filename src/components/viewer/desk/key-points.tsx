// The key-point ledger refine extracted from a recording. Two faces: on its own
// (the open state) it's a list of what the recording raised, each row seekable;
// with outcomes (the verdict) it becomes the "what you raised → what came back"
// grid, each point paired with what the agent reported against it. The seek
// buttons are the only interactive elements — the rows themselves are read.

import { cn } from '~/lib/utils'
import { mmss } from '../format'
import type { Walkthrough } from '../types'

export type KeyPointRow = Walkthrough['points'][number]
export type OutcomeByPoint = Map<string, { status: string; note: string }>

const SEVERITY_DOT: Record<KeyPointRow['severity'], string> = {
  high: 'bg-destructive',
  medium: 'bg-foreground',
  low: 'bg-muted-foreground',
}

/** The seekable m:ss chip. Hidden when the point carries no moment. */
function TimeButton({ atMs, onSeek }: { atMs: number | null; onSeek: (ms: number) => void }) {
  if (atMs === null) return null
  return (
    <button
      type="button"
      onClick={() => onSeek(atMs)}
      className="text-cobalt font-mono text-[11px] hover:underline">
      {mmss(atMs)}
    </button>
  )
}

function Dot({ severity }: { severity: KeyPointRow['severity'] }) {
  return (
    <span
      className={cn('mt-1 size-[7px] shrink-0 rounded-full', SEVERITY_DOT[severity])}
      aria-hidden
    />
  )
}

/** The agent's answer for one point — glyph + word in mono, then the note. */
function Outcome({ outcome }: { outcome: { status: string; note: string } | undefined }) {
  const face =
    outcome === undefined
      ? { label: '· unanswered', tone: 'text-muted-foreground/60' }
      : outcome.status === 'fixed'
        ? { label: '✓ fixed', tone: 'text-approve' }
        : outcome.status === 'partial'
          ? { label: '◐ partial', tone: 'text-foreground' }
          : outcome.status === 'skipped'
            ? { label: '— skipped', tone: 'text-muted-foreground' }
            : { label: '— n/a', tone: 'text-muted-foreground' }
  return (
    <span className="flex items-baseline gap-2 text-[13px]">
      <span className={cn('shrink-0 font-mono text-[12px]', face.tone)}>{face.label}</span>
      {outcome && outcome.note && <span className="text-muted-foreground">{outcome.note}</span>}
    </span>
  )
}

export function KeyPointsTable({
  points,
  outcomes,
  onSeek,
}: {
  points: KeyPointRow[]
  outcomes?: OutcomeByPoint | null
  onSeek: (ms: number) => void
}) {
  if (points.length === 0) return null

  return (
    <div className="bg-card overflow-hidden rounded-md border">
      {points.map((point) =>
        outcomes ? (
          <div
            key={point.id}
            className="border-border grid grid-cols-[minmax(0,1fr)_54px_minmax(0,1fr)] items-baseline gap-4 border-b px-[18px] py-[13px] last:border-b-0">
            <div className="min-w-0 space-y-1">
              <span className="flex items-baseline gap-[9px] text-[14px] font-medium">
                <Dot severity={point.severity} />
                <span className="min-w-0">{point.title}</span>
              </span>
              {point.detail && <p className="text-muted-foreground pl-4 text-[13px]">{point.detail}</p>}
            </div>
            <TimeButton atMs={point.atMs} onSeek={onSeek} />
            <Outcome outcome={outcomes.get(point.id)} />
          </div>
        ) : (
          <div
            key={point.id}
            className="border-border space-y-1 border-b px-[18px] py-[13px] last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-[9px] text-[14px] font-medium">
                <Dot severity={point.severity} />
                <span className="min-w-0">{point.title}</span>
              </span>
              <TimeButton atMs={point.atMs} onSeek={onSeek} />
            </div>
            {point.detail && <p className="text-muted-foreground pl-4 text-[13px]">{point.detail}</p>}
          </div>
        )
      )}
    </div>
  )
}
