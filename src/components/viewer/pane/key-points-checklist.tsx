// The key-point ledger as a checklist — refine's points paired with the newest
// agent result's per-point outcome. A fixed circle marks each row's outcome, a
// severity dot fronts the title, and the m:ss chip seeks the recording.

import { cn } from '~/lib/utils'
import { mmss } from '~/components/viewer/format'
import type { KeyPointRow, OutcomeByPoint } from '~/components/viewer/desk/key-points'

const SEVERITY_DOT: Record<KeyPointRow['severity'], string> = {
  high: 'bg-destructive',
  medium: 'bg-foreground',
  low: 'bg-muted-foreground',
}

const ICON = 'grid size-[18px] shrink-0 place-items-center rounded-full text-[10px]'

/** The outcome glyph: fixed = filled green ✓ · partial = cobalt ring ◐ ·
 *  skipped/n-a = muted dash · no outcome = hollow ring. */
function OutcomeIcon({ status }: { status: string | undefined }) {
  if (status === 'fixed')
    return <span className={cn(ICON, 'bg-approve text-white')}>✓</span>
  if (status === 'partial')
    return <span className={cn(ICON, 'border-cobalt text-cobalt border-[1.5px]')}>◐</span>
  if (status === 'skipped' || status === 'not_applicable')
    return <span className={cn(ICON, 'border-border text-muted-foreground border-[1.5px] text-[11px]')}>–</span>
  return <span className={cn(ICON, 'border-input border-[1.5px]')} />
}

export function KeyPointsChecklist({
  points,
  outcomes,
  onSeek,
}: {
  points: KeyPointRow[]
  outcomes: OutcomeByPoint
  onSeek: (ms: number) => void
}) {
  if (points.length === 0) return null
  const hasOutcomes = outcomes.size > 0
  const fixed = [...outcomes.values()].filter((o) => o.status === 'fixed').length

  return (
    <section>
      <h3 className="text-foreground mb-1 text-[13px] font-semibold">
        Key points
        {hasOutcomes && (
          <span className="text-muted-foreground font-normal">
            {' '}
            · {fixed} of {points.length} fixed
          </span>
        )}
      </h3>
      <div>
        {points.map((point) => {
          const outcome = outcomes.get(point.id)
          return (
            <div key={point.id} className="border-border/60 flex gap-2.5 border-t py-2">
              <OutcomeIcon status={outcome?.status} />
              <div className="min-w-0 flex-1 space-y-0.5">
                <span className="flex items-baseline gap-1.5 text-[13px] font-medium">
                  <span
                    className={cn('size-[6px] shrink-0 translate-y-[-1px] rounded-full', SEVERITY_DOT[point.severity])}
                    aria-hidden
                  />
                  <span className="min-w-0">{point.title}</span>
                </span>
                {outcome?.note ? (
                  <p className="text-muted-foreground text-xs">{outcome.note}</p>
                ) : (
                  !outcome && point.detail && <p className="text-muted-foreground text-xs">{point.detail}</p>
                )}
              </div>
              {point.atMs !== null && (
                <button
                  type="button"
                  onClick={() => onSeek(point.atMs ?? 0)}
                  className="text-cobalt shrink-0 font-mono text-[11px] hover:underline">
                  {mmss(point.atMs)}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
