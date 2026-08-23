import { cn } from '~/lib/utils'
import type { WalkthroughStatus } from './types'

// Status inks are fixed by ui.md: open = cobalt, in_review = violet,
// resolved = green. The active segment wears its own wash. needs_info is the
// deliberate exception — no fourth loud hue, a muted grey — and it isn't a
// target you pick (see below), so it lives outside SEGMENTS.
const SEGMENTS: { value: WalkthroughStatus; label: string; active: string }[] = [
  { value: 'open', label: 'Open', active: 'bg-cobalt-wash text-cobalt' },
  { value: 'in_review', label: 'In review', active: 'bg-review-wash text-review' },
  { value: 'resolved', label: 'Resolved', active: 'bg-approve-wash text-approve' },
]

export function StatusControl({
  status,
  onChange,
  disabled,
}: {
  status: string
  onChange: (status: WalkthroughStatus) => void
  disabled?: boolean
}) {
  // While the walkthrough waits on an answer, a leading grey segment marks it.
  // You leave needs_info by answering (the return-path panel), never by clicking
  // here — so it's a readout, not a button, and it vanishes once status moves.
  const waiting = status === 'needs_info'
  return (
    <div
      role="group"
      aria-label="Walkthrough status"
      className="border-input inline-flex overflow-hidden rounded-md border">
      {waiting && (
        <span
          aria-current="true"
          className="bg-muted text-foreground flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium">
          <span className="bg-muted-foreground size-[7px] shrink-0 rounded-full" />
          needs info
        </span>
      )}
      {SEGMENTS.map((segment, i) => {
        const active = segment.value === status
        return (
          <button
            key={segment.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => !active && onChange(segment.value)}
            className={cn(
              'px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60',
              (i > 0 || waiting) && 'border-input border-l',
              active ? segment.active : 'text-muted-foreground hover:bg-accent/50'
            )}>
            {segment.label}
          </button>
        )
      })}
    </div>
  )
}
