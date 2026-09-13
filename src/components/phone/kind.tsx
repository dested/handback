// Who the walkthrough is for — the choice that decides everything downstream:
// distilled into keyframes + report for an agent, or shipped whole for a person
// to watch and tightened up in the viewer afterwards. Shared by /upload and
// /phone's manual intake; /record carries its own three-way version of this
// control (it also offers "just talk"), and the extension panel its own.
//
// The phone share sheet never sees this: sharing was the send (a settled
// decision), so a shared clip always ships as an agent walkthrough.

import { cn } from '~/lib/utils'

export function KindControl({
  value,
  onChange,
}: {
  value: 'agent' | 'human'
  onChange: (kind: 'agent' | 'human') => void
}) {
  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label="Who is this recording for?"
        className="grid grid-cols-2 gap-2">
        {(
          [
            { value: 'agent', label: 'for an agent' },
            { value: 'human', label: 'for a person' },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-8 items-center justify-center rounded-md border px-2.5 text-[13px] font-medium transition-colors',
              value === option.value
                ? 'bg-foreground border-foreground text-white'
                : 'text-foreground/80 hover:bg-secondary border-input bg-card'
            )}>
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        {value === 'human'
          ? 'The video ships whole for a person to watch — nothing is distilled. Tighten it up in the viewer, then share the link.'
          : 'Distilled for your coding agent — keyframes, transcript and a report it can read.'}
      </p>
    </div>
  )
}
