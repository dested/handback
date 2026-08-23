// What the recording is about, for an agent-kind handback: the tag the brief
// reads to frame the work — something broken, something new, or a thought that
// isn't work yet. Optional by design; null leaves the brief to presume nothing.
// Sits directly under KindControl and only when the kind is agent-facing — a
// human walkthrough is watched, not briefed.

import { cn } from '~/lib/utils'

export type Intent = 'bug' | 'feature' | 'idea'

export function IntentControl({
  value,
  onChange,
}: {
  value: Intent | null
  onChange: (v: Intent | null) => void
}) {
  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label="What is this recording about?"
        className="grid grid-cols-3 gap-2">
        {(
          [
            { value: 'bug', label: 'bug' },
            { value: 'feature', label: 'feature' },
            { value: 'idea', label: 'idea' },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            // Clicking the active chip clears the tag — a second thought is how
            // you say "actually, don't presume".
            onClick={() => onChange(value === option.value ? null : option.value)}
            className={cn(
              'rounded-md border px-3 py-2 font-mono text-xs transition-colors',
              value === option.value
                ? 'border-primary bg-accent text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}>
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {value === 'bug'
          ? 'Framed for the agent as something broken to fix.'
          : value === 'feature'
            ? 'Framed as something new to build.'
            : value === 'idea'
              ? 'Framed as a thought to assess — not yet work.'
              : "Untagged — the brief won't presume."}
      </p>
    </div>
  )
}
