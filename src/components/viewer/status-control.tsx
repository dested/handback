import { cn } from '~/lib/utils'
import type { WalkthroughStatus } from './types'

// Status inks are fixed by ui.md: open = cobalt, in_review = violet,
// resolved = green. The active segment wears its own wash.
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
  return (
    <div
      role="group"
      aria-label="Walkthrough status"
      className="border-input inline-flex overflow-hidden rounded-md border">
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
              i > 0 && 'border-input border-l',
              active ? segment.active : 'text-muted-foreground hover:bg-accent/50'
            )}>
            {segment.label}
          </button>
        )
      })}
    </div>
  )
}
