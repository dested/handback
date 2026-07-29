// An oversized, quiet restatement of the loop mark: the human loop in ink, the
// agent loop in cobalt, meshed like gears, with the overlap — where sign-off
// happens — washed pale blue. Decoration only; the mark itself lives in
// components/logo.tsx and is never redrawn for chrome.

// Both circles: r = 96, centres 80 apart, so they intersect at x = 180,
// y = 130 ± 87.27. Those two points bound the lens.
const LENS = 'M180 42.73 A96 96 0 0 1 180 217.27 A96 96 0 0 1 180 42.73'

export function LoopDiagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 260" fill="none" aria-hidden="true" className={className}>
      <path d={LENS} fill="var(--cobalt-wash)" />
      <circle cx="140" cy="130" r="96" stroke="var(--ink)" strokeOpacity="0.22" strokeWidth="1.5" />
      <circle
        cx="220"
        cy="130"
        r="96"
        stroke="var(--cobalt)"
        strokeOpacity="0.55"
        strokeWidth="1.5"
      />
      {/* Arrowheads set the loops turning against each other. */}
      <path
        d="M132 27 L140 34 L132 41"
        stroke="var(--ink)"
        strokeOpacity="0.35"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M228 219 L220 226 L228 233"
        stroke="var(--cobalt)"
        strokeOpacity="0.7"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g className="font-mono" fill="currentColor" fontSize="10" letterSpacing="0.2em">
        <text x="80" y="134" textAnchor="middle">
          YOU
        </text>
        <text x="280" y="134" textAnchor="middle">
          AGENT
        </text>
      </g>
    </svg>
  )
}
