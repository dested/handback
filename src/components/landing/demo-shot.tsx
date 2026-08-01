/**
 * One keyframe from the demo walkthrough, drawn as SVG.
 *
 * Everything on the landing page that shows "a frame from a recording" renders
 * this: the hero, the filmstrip, the contact sheet, the report's inlined still.
 * It is SVG because it stands in for an image — it has to stay legible scaled
 * down to a 3x3 grid tile and stay crisp blown up in the hero, and a photograph
 * of a UI can't do both.
 *
 * The recorded app is drawn in neutral grey on purpose. The only colour in a
 * frame is the reviewer's cobalt — the pointer crosshair the recorder composites
 * in, and the ink they drew while narrating. That is the actual hierarchy of the
 * product (the app is evidence, the human's pen is the point), and it is what
 * makes nine of these read as one story at thumbnail size.
 */

const PAPER = '#ffffff'
const CHROME = '#f4f4f5'
const LINE = '#e4e4e7'
const EDGE = '#d4d4d8'
const FAINT = '#a1a1aa'
const TEXT = '#52525b'
const DARK = '#27272a'
const PRESSED = '#111114'

export type Shot = {
  /** Filename the recorder would have written — `NN-mmss.jpg`, take-relative. */
  file: string
  /** Position on the walkthrough's single timeline. */
  at: string
  /** Why the frame survived: what the recorder logs in `recording.json`. */
  reason: 'moved' | 'clicked' | 'typed' | 'marked'
  /** Text of the promo field, or null for the placeholder. */
  code: string | null
  /** Field carries the focus ring. */
  focus?: boolean
  /** Apply button state. */
  button?: 'idle' | 'pressed' | 'busy'
  /** Spinner sweep, so two consecutive busy frames aren't identical. */
  spin?: number
  /** Composited pointer position in shot coordinates. */
  pointer?: { x: number; y: number }
  /** The human drew on the total. */
  ink?: boolean
  /** The fixed build: the discount actually lands. Only ever the sign-off frame. */
  fixed?: boolean
}

/** The same checkout after the agent's fix — the frame a reviewer signs off against. */
export const FIXED_SHOT: Shot = {
  file: 'after — build #418',
  at: '0:19',
  reason: 'clicked',
  code: 'SAVE20',
  fixed: true,
  // No pointer: this is the reviewer checking the fixed build, not a keyframe
  // pulled out of a recording.
}

/** The demo recording: a coupon that applies to nothing, in nine kept frames. */
export const SHOTS: Shot[] = [
  { file: '01-0004.jpg', at: '0:04', reason: 'moved', code: null, pointer: { x: 96, y: 258 } },
  {
    file: '01-0008.jpg',
    at: '0:08',
    reason: 'clicked',
    code: null,
    focus: true,
    pointer: { x: 300, y: 91 },
  },
  {
    file: '01-0011.jpg',
    at: '0:11',
    reason: 'typed',
    code: 'SAVE20',
    focus: true,
    pointer: { x: 300, y: 91 },
  },
  {
    file: '01-0014.jpg',
    at: '0:14',
    reason: 'clicked',
    code: 'SAVE20',
    button: 'pressed',
    // On the button's corner, not its middle: a cobalt crosshair centred on near
    // black is a crosshair nobody can see.
    pointer: { x: 402, y: 101 },
  },
  {
    file: '01-0015.jpg',
    at: '0:15',
    reason: 'moved',
    code: 'SAVE20',
    button: 'busy',
    spin: 20,
    pointer: { x: 402, y: 101 },
  },
  {
    file: '01-0017.jpg',
    at: '0:17',
    reason: 'moved',
    code: 'SAVE20',
    button: 'busy',
    spin: 260,
    pointer: { x: 402, y: 101 },
  },
  { file: '01-0019.jpg', at: '0:19', reason: 'moved', code: 'SAVE20', pointer: { x: 300, y: 130 } },
  {
    file: '01-0022.jpg',
    at: '0:22',
    reason: 'marked',
    code: 'SAVE20',
    ink: true,
    // Left off where the stroke ended, clear of the number it circles.
    pointer: { x: 372, y: 210 },
  },
  {
    file: '01-0031.jpg',
    at: '0:31',
    reason: 'clicked',
    code: 'SAVE20',
    focus: true,
    button: 'pressed',
    ink: true,
    pointer: { x: 402, y: 101 },
  },
]

const ITEMS: Array<[string, string]> = [
  ['Ceramic mug ×2', '$36.00'],
  ['Pour-over kettle', '$74.00'],
  ['Filters (100)', '$18.00'],
]

/**
 * Hand-drawn ellipse around the total — one continuous stroke that overshoots
 * where it started, the way a real one does. Sized to the number, not the row.
 */
const INK_RING =
  'M406 200 C 378 199, 366 208, 372 218 C 380 231, 424 236, 452 231 C 470 227, 474 214, 462 206 C 448 196, 418 195, 396 199 C 388 200, 382 202, 378 205'

export function CheckoutShot({ shot, className }: { shot: Shot; className?: string }) {
  const button = shot.button ?? 'idle'
  const press = button === 'pressed' ? 1 : 0

  return (
    <svg
      viewBox="0 0 480 300"
      className={className}
      role="img"
      aria-label={`Recorded frame at ${shot.at} — the promo code field and an unchanged total`}>
      <rect width="480" height="300" fill={PAPER} />

      {/* Store chrome */}
      <rect width="480" height="36" fill={CHROME} />
      <line x1="0" y1="36" x2="480" y2="36" stroke={LINE} />
      <text x="16" y="23" fontSize="12" fontWeight="700" letterSpacing="1.6" fill={TEXT}>
        NORTHWIND
      </text>
      <text x="464" y="23" fontSize="10" fill={FAINT} textAnchor="end">
        Checkout · 3 items
      </text>

      {/* Order summary */}
      <text x="16" y="62" fontSize="8" letterSpacing="1.2" fill={FAINT}>
        ORDER SUMMARY
      </text>
      {ITEMS.map(([name, price], i) => (
        <g key={name}>
          <text x="16" y={90 + i * 28} fontSize="11" fill={TEXT}>
            {name}
          </text>
          <text x="236" y={90 + i * 28} fontSize="11" fill={TEXT} textAnchor="end">
            {price}
          </text>
          <line x1="16" y1={100 + i * 28} x2="236" y2={100 + i * 28} stroke={LINE} />
        </g>
      ))}

      {/* Promo code */}
      <text x="252" y="62" fontSize="8" letterSpacing="1.2" fill={FAINT}>
        PROMO CODE
      </text>
      <rect
        x="252"
        y="76"
        width="138"
        height="30"
        rx="4"
        fill={PAPER}
        stroke={shot.focus ? 'var(--cobalt)' : EDGE}
        strokeWidth={shot.focus ? 1.6 : 1}
      />
      <text
        x="264"
        y="96"
        fontSize="12"
        fontFamily="ui-monospace, monospace"
        letterSpacing="0.6"
        fill={shot.code ? DARK : FAINT}>
        {shot.code ?? 'Enter code'}
      </text>
      {shot.focus && shot.code && (
        <rect
          x={264 + shot.code.length * 7.9}
          y="84"
          width="1.4"
          height="14"
          fill="var(--cobalt)"
        />
      )}

      <rect
        x="398"
        y={76 + press}
        width="66"
        height="30"
        rx="4"
        fill={button === 'pressed' ? PRESSED : DARK}
      />
      {button === 'busy' ? (
        <path
          d="M431 84 A 7 7 0 1 1 424 91"
          fill="none"
          stroke={PAPER}
          strokeWidth="2"
          strokeLinecap="round"
          transform={`rotate(${shot.spin ?? 0} 431 91)`}
        />
      ) : (
        <text
          x="431"
          y={96 + press}
          fontSize="11"
          fontWeight="600"
          fill={PAPER}
          textAnchor="middle">
          Apply
        </text>
      )}

      {/* Totals — the row that never changes */}
      <text x="252" y="150" fontSize="11" fill={TEXT}>
        Subtotal
      </text>
      <text x="464" y="150" fontSize="11" fill={TEXT} textAnchor="end">
        $128.00
      </text>
      <text x="252" y="174" fontSize="11" fill={shot.fixed ? 'var(--approve)' : FAINT}>
        {shot.fixed ? 'Discount · SAVE20' : 'Discount'}
      </text>
      <text
        x="464"
        y="174"
        fontSize="11"
        fill={shot.fixed ? 'var(--approve)' : FAINT}
        textAnchor="end">
        {shot.fixed ? '−$25.60' : '—'}
      </text>
      <line x1="252" y1="190" x2="464" y2="190" stroke={EDGE} />
      <text x="252" y="216" fontSize="12" fontWeight="600" fill={DARK}>
        Total
      </text>
      <text x="464" y="219" fontSize="19" fontWeight="700" fill={DARK} textAnchor="end">
        {shot.fixed ? '$102.40' : '$128.00'}
      </text>

      <rect x="252" y="242" width="212" height="34" rx="4" fill={DARK} />
      <text x="358" y="264" fontSize="12" fontWeight="600" fill={PAPER} textAnchor="middle">
        Place order
      </text>

      {shot.ink && (
        <path
          d={INK_RING}
          fill="none"
          stroke="var(--cobalt)"
          strokeWidth="2.6"
          strokeLinecap="round"
          opacity="0.9"
        />
      )}

      {shot.pointer && <Pointer x={shot.pointer.x} y={shot.pointer.y} />}
    </svg>
  )
}

/**
 * The pointer is drawn into the frame, not overlaid by the viewer — a keyframe
 * has to carry where the human was pointing or the agent is reading a still with
 * the subject missing. Dark pass under the cobalt so it survives a white page.
 */
function Pointer({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g stroke={PRESSED} strokeOpacity="0.35" strokeWidth="3.4" strokeLinecap="round">
        <path d="M-9 0 H-3 M3 0 H9 M0 -9 V-3 M0 3 V9" />
      </g>
      <g stroke="var(--cobalt)" strokeWidth="1.6" strokeLinecap="round">
        <path d="M-9 0 H-3 M3 0 H9 M0 -9 V-3 M0 3 V9" />
      </g>
      <circle r="3.2" fill="none" stroke="var(--cobalt)" strokeWidth="1.6" />
    </g>
  )
}
