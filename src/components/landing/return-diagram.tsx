// An oversized, quiet restatement of the return mark: the work goes out from
// YOU in ink, turns at the AGENT, and comes back in cobalt — the wash marks
// where it lands back in your hand for sign-off. Decoration only; the mark
// itself lives in components/logo.tsx and is never redrawn for chrome.

export function ReturnDiagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 260" fill="none" aria-hidden="true" className={className}>
      {/* The landing spot — sign-off happens where the stroke returns. */}
      <circle cx="106" cy="156" r="24" fill="var(--cobalt-wash)" />
      {/* Out in ink… */}
      <path
        d="M100 104 H250 A26 26 0 0 1 276 130"
        stroke="var(--ink)"
        strokeOpacity="0.22"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* …back in cobalt. */}
      <path
        d="M276 130 A26 26 0 0 1 250 156 H114"
        stroke="var(--cobalt)"
        strokeOpacity="0.55"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M122 146 L108 156 L122 166"
        stroke="var(--cobalt)"
        strokeOpacity="0.7"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g className="font-mono" fill="currentColor" fontSize="10" letterSpacing="0.2em">
        <text x="62" y="134" textAnchor="middle">
          YOU
        </text>
        <text x="312" y="134" textAnchor="middle">
          AGENT
        </text>
      </g>
    </svg>
  )
}
