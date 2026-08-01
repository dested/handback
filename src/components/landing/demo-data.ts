/**
 * The demo walkthrough, one story told everywhere on the landing page: a promo code
 * that applies to nothing. The hero, the filmstrip, the transcript, the contact
 * sheet, the report and the sign-off are all the same ninety seconds — a visitor
 * scrolling fast should recognise the same bug in each section rather than parse
 * a new example every time.
 *
 * Shapes mirror what the recorder really emits (see `extension/src/lib/report.ts`):
 * spoken lines cover a window and name the frames they are about, events carry the
 * timeline position they fired at, keyframes are `NN-mmss.jpg`.
 */

export type Line = {
  /** Position on the walkthrough's single timeline. */
  at: string
  text: string
  /** Frame range this line is actually about — people narrate what just happened. */
  about?: string
}

export const TRANSCRIPT: Line[] = [
  { at: '0:06', text: "Okay, so this is the checkout — I'm on the cart with three items." },
  { at: '0:11', text: 'I paste in SAVE20, which is the code we emailed out this morning.' },
  { at: '0:14', text: 'Hit apply…', about: '0:14–0:17' },
  {
    at: '0:19',
    text: 'and nothing. No error, no discount, the total is still a hundred and twenty-eight.',
    about: '0:17–0:22',
  },
  {
    at: '0:24',
    text: "It doesn't tell you it failed, which is the part that's killing us — people just assume it worked and bail at the total.",
  },
  { at: '0:31', text: 'Second try, same thing. Watch the total.', about: '0:31–0:38' },
]

export type Event = {
  at: string
  kind: 'network' | 'console'
  text: string
}

export const EVENTS: Event[] = [
  { at: '0:15', kind: 'network', text: 'POST /api/coupons/apply → 500 (118 ms)' },
  { at: '0:15', kind: 'console', text: "TypeError: Cannot read properties of null (reading 'id')" },
  { at: '0:31', kind: 'network', text: 'POST /api/coupons/apply → 500 (104 ms)' },
]

/** Counts quoted around the page. One recording, so one set of numbers. */
export const WALKTHROUGH = {
  title: 'Promo code applies to nothing at checkout',
  slug: '2026-07-29-1215-promo-code-checkout',
  origin: 'shop.northwind.test',
  duration: '1:34',
  keyframes: 41,
  sheets: 5,
  spoken: 24,
  errors: 3,
  project: 'Northwind Storefront',
} as const

/**
 * The report as the agent receives it. Kept as structured blocks rather than a
 * markdown string so the viewer can render it without shipping a parser to the
 * landing page — the shapes match what `buildReport` emits, block for block.
 */
export type ReportBlock =
  | { kind: 'h1'; text: string }
  | { kind: 'meta'; chips: string[]; tail: string }
  | { kind: 'quote'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'sheet'; alt: string }
  | { kind: 'h2'; text: string }
  | { kind: 'frames'; files: string[] }
  | { kind: 'still'; caption: string; shot: number }
  | { kind: 'event'; text: string }
  | { kind: 'rule' }

export const REPORT: ReportBlock[] = [
  { kind: 'h1', text: `Walkthrough — ${WALKTHROUGH.title}` },
  {
    kind: 'meta',
    chips: [
      `walkthrough ${WALKTHROUGH.duration}`,
      `${WALKTHROUGH.keyframes} keyframes`,
      `${WALKTHROUGH.spoken} spoken lines`,
      '1 marked',
      `${WALKTHROUGH.errors} errors captured`,
    ],
    tail: `recorded 29 Jul 2026 12:15–12:17 · ${WALKTHROUGH.origin}`,
  },
  {
    kind: 'quote',
    text: 'You are reading a walkthrough — a human using the running app, saying what’s wrong or what they’d change. Everything below sits on one timeline, in the order it happened. Read the images: they are the primary evidence, and the words are shorthand that assumes you looked.',
  },
  { kind: 'h3', text: 'Contact sheets — read these first' },
  {
    kind: 'p',
    text: `${WALKTHROUGH.keyframes} keyframes across ${WALKTHROUGH.sheets} sheets, nine per image, in order, each tile labeled with its filename.`,
  },
  { kind: 'sheet', alt: `contact sheet 1 of ${WALKTHROUGH.sheets} — 0:04–0:31` },
  { kind: 'rule' },
  { kind: 'h2', text: '0:14 — "Hit apply…"' },
  { kind: 'still', caption: 'rec-01/frames/01-0014.jpg · 0:14 · the click', shot: 3 },
  { kind: 'event', text: 'POST /api/coupons/apply → 500 · 0:15' },
  { kind: 'event', text: "TypeError: Cannot read properties of null (reading 'id') · 0:15" },
  { kind: 'frames', files: ['01-0017.jpg', '01-0019.jpg', '01-0022.jpg'] },
  {
    kind: 'p',
    text: '"and nothing. No error, no discount, the total is still a hundred and twenty-eight." — 0:19, about 0:17–0:22',
  },
]
