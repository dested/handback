# Handback — UI

> Visual-language source of truth. Follow exactly; deviations are bugs.
> Last updated: 2026-07-30.

## The one law

**Light only. No dark mode. Nothing orange.** Sal's words: "no more of this
fucking dark mode and orange." There is no `.dark` variant, no
`prefers-color-scheme` handling, no orange or near-orange hue anywhere. Handback
must never resemble the Gripe extension's dark/orange look.

## Concept

Editorial review — blue ink on paper. The product is a human reviewing work and
signing off, so the UI reads like a well-set proof: warm paper ground, near-black
ink, hairline rules, generous margins, one confident cobalt accent (the
reviewer's pen), monospace for anything technical. Quiet pages; the recordings
and reports are the loud part.

## Tokens (`src/styles/app.css`)

| Token | Value | Use |
| --- | --- | --- |
| `--background` | warm paper `oklch(0.985 0.004 95)` | page ground |
| `--foreground` / `--ink` | cool near-black | text |
| `--card` | pure white | cards sit brighter than the page |
| `--cobalt` (= `--primary`) | `oklch(0.485 0.195 262)` | THE accent: links, primary buttons, active states, open status |
| `--cobalt-wash` | pale blue | selected/hover washes, accent chips |
| `--review` / `--review-wash` | violet | "in review" status only |
| `--approve` / `--approve-wash` | green | "resolved"/success only |
| `--destructive` | red | delete/danger only |
| `--radius` | 0.375rem | tight, print-like corners |

Status mapping is fixed: **open = cobalt, in_review = violet, resolved = green.**
Never invent a fourth status color.

## Type

- **Display — Fraunces** (`font-display`): h1–h3, the wordmark, hero copy.
  Weights 500–700. Tight tracking.
- **Body — Libre Franklin** (`font-sans`): everything else. 400/500/600.
- **Mono — IBM Plex Mono** (`font-mono`): timestamps, slugs, tokens, file
  paths, transcript times, code, the stamp.

Loaded via Google Fonts in `index.html`. Do not add other font families.

## Motifs

- **The return mark** — `src/components/logo.tsx` (`ReturnMark`): one
  returning stroke — out along the top in ink, U-turn, back in cobalt with an
  arrowhead landing left — beside the lowercase Fraunces wordmark `handback`.
  Never redraw it ad hoc; import it. Oversized restatement for the landing
  watermark: `landing/return-diagram.tsx`. Extension icons render the same
  geometry (`extension/scripts/make-icons.mjs` maps the 28×20 viewBox).
- **Hairline rules** — sections divide with 1px `--border` lines (`.rule`),
  like ledger paper. Prefer rules over boxes; prefer boxes over shadows.
- **The stamp** (`.stamp`) — tilted, letterspaced, bordered mono label. Used
  sparingly: landing-page flourishes, the "signed off" moment. Max one per view.
- **Ink underline** (`.ink-underline`) — cobalt underline stroke for one key
  word in a headline. Landing only.
- **Numbered sections** — editorial `01 / 02 / 03` mono numerals for
  how-it-works flows.

## Components

shadcn primitives live in `src/components/ui/` (button, card, input, label —
add more there as needed, new-york style, no `asChild`). Buttons: `default`
variant is cobalt; use `outline` for secondary actions; destructive only for
deletes. Page shells and nav come from `src/app/layout.tsx` — marketing chrome
on public pages, app chrome (org switcher, Inbox/Projects/Team nav) when signed
in.

## Extension (`extension/`)

The Chrome side panel and on-page surfaces obey the same law — light paper,
cobalt, nothing orange, no dark mode — but run on **system fonts** (no Google
Fonts inside an extension): `ui-sans-serif` body, `ui-monospace` for
timestamps/keycaps/transcript times. Tokens are duplicated as plain CSS custom
properties in `extension/src/sidepanel/styles.css` (no Tailwind there).

- **Panel** (`panel.css`): paper ground, white cards, hairline rules. One big
  cobalt action per state: idle = the full-width `Record a walkthrough` hero,
  recording = full-width `stop recording`, review = `send to Handback` (46px).
  Above the send button sits the destination row — "to [workspace] · [project]",
  two hairline selects with a drawn chevron (`appearance: none`, never Chrome's
  stock arrow); the project select hides rather than renders dead when the list
  can't be fetched or is empty. "Record another take" is the cobalt *outline*
  ghost — never louder than send. Settings live behind the header gear and lead
  with the Workspaces list (one row per linked workspace, cobalt border + filled
  dot on the active one, whole row clickable, `×` to unlink); unlinked states
  point at `/recorder` (cobalt-wash callout), they never demand a pasted token. Upload errors are a
  white card with a 2px danger left rule: mono `UPLOAD FAILED` head, one human
  sentence, `try again`/`details` links — never a raw server body.
- **Timeline** (`timeline.css`): white track on paper, mono ruler, cobalt mark
  carets and selection, dashed hairline take seams, thumbnail filmstrip with
  stamped `take·m:ss` labels, voice lane as ink-gray density bars.
- **Transcript list** (`.tl-script`): the whole transcript under the timeline —
  cobalt mono times, current line cobalt-washed with an inset bar, click seeks,
  double-click edits in place. Collapsed by default in the popped strip. The
  read-back confirm is one small green outline pill in its header (`reads
  right`) — never a banner; lecturing callouts are banned.
- **On-page dock** (`content/ui.ts`): white pill, hairline border, mono
  keycaps for its keys; ink strokes draw in cobalt. Never dark, never orange.
- **Draw mode says so**: while ink owns the pointer the viewport wears a cobalt
  inset frame with one top tag (`drawing · esc to click`), and the dock never
  fades. The frame is captured in the recording on purpose.
- Judged in the preview harness (`npm run preview` → `:8777/gallery.html`),
  acceptance seed is `mode=long` (10:18, two takes, 150 frames).

## Don'ts

- No dark mode, no `.dark`, no `color-scheme: dark`.
- No orange, amber, or warm-yellow hues. Warning states use violet or red.
- No purple-gradient hero, no glassmorphism, no drop-shadow soup — shadows stay
  `shadow-sm` or none; depth comes from rules and card/paper contrast.
- No new font families, no icon libraries beyond `lucide-react`.
- Nothing copied from the Gripe extension UI — not a div, not a class list.
- Don''t center whole app pages; app surfaces are left-aligned with a max-width
  container (`max-w-6xl`), landing sections may center.
