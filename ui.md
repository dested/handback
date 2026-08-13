# Handback — UI

> Visual-language source of truth. Follow exactly; deviations are bugs.
> Last updated: 2026-08-12.

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
  how-it-works flows and setup pages (`src/components/setup-step.tsx`).
  **Only number what the person actually does on this page**; reference
  material (tool lists, disconnect instructions, token management, "what
  happens next") takes a plain `font-display` heading over a hairline rule
  instead. A shorter numbered run reads lighter, and an inflated one reads as
  work — /connect went 01–04 → 01/02 for exactly that reason.
- **Inert command blocks** — a copyable block whose contents aren't yet real
  (a placeholder token) renders dimmed (`bg-muted/30 opacity-60`),
  `select-none`, and with the Copy button replaced by a mono `preview` label.
  Never ship a Copy button on something that must not be pasted.

## Components

shadcn primitives live in `src/components/ui/` (button, card, input, label,
sidebar — add more there as needed, new-york style, no `asChild`). The sidebar
is shadcn's re-cut without radix: paper ground, hairline right rule, mono
uppercase group labels, cobalt-wash active item; used by the /admin console
(collapse persists, mobile is an overlay). No new sidebar variants — reuse it. Buttons: `default`
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
  With nothing open the hero sits over the **home screen** (`Home.tsx`): the
  destination row (workspace + host + project count, click opens the switcher),
  then the workspace's queue, then what's still on this machine — each an
  editorial section with a mono uppercase head and the one action it offers on
  the right, divided by hairlines, never boxes. Status reads twice on a queue
  row, as a 7px dot and as the word, in the three fixed inks; filter chips are
  pills that go from hairline to that same ink when on. Nothing below the hero
  may be louder than it. An open walkthrough is **two rows of
  chrome and then content, never more**: a **crumb row** (`← all walkthroughs`
  muted, the mono meta line as a caption on the same row, `discard` on the
  right), then a **title row** (the name, with `● add another recording` as the
  cobalt ghost beside it). Discard arms into one line
  (`discard 2 takes? yes, discard / keep`, the yes in `--destructive`) so the
  row never grows and shoves the timeline down mid-decision.
  Above the send button sits the destination row — **one** control, "to [space] ·
  [project]", not two selects. Its trigger is a single hairline button with a
  drawn chevron (`appearance: none`, never Chrome's stock arrow); clicking opens
  **one panel that opens upward** (the row lives at the foot of the panel),
  grouped by space — mono-uppercase space headers, and under each a `General` row
  (the project-less choice — the server still routes by origin) then that space's
  projects. One click sets space *and* project together; the active row is
  cobalt-washed with a filled cobalt dot, the rest carry a hairline ring so the
  names align. A space with no projects shows just `General` + `+ new project…`; a
  failed context fetch shows `projects unavailable · retry` under the current
  space; a foot row carries `manage projects` / `+ link a server`. With keys to
  more than one server the spaces group under a mono host header. The take button
  is the cobalt *outline* ghost — never louder than send. Settings live behind the
  header gear and lead
  with the Workspaces list (one row per linked workspace, cobalt border + filled
  dot on the active one, whole row clickable, `×` to unlink); unlinked states
  point at `/recorder` (cobalt-wash callout), they never demand a pasted token. Upload errors are a
  white card with a 2px danger left rule: mono `UPLOAD FAILED` head, one human
  sentence, `try again`/`details` links — never a raw server body.
- **Timeline** (`timeline.css`): white track on paper, mono ruler, a cobalt
  playhead (the only cobalt on the axis), dashed hairline take seams, thumbnail
  filmstrip, voice lane as ink-gray density bars. **It is a scrubber**:
  pointer-down anywhere on the ruler, filmstrip, voice lane or bare track scrubs
  and dragging keeps scrubbing — one gesture, no modifiers, and **no selection of
  any kind** (no sweep, no marquee, no selected-cell outline, no action bar).
  Above the filmstrip runs the **take lane**: one mono `take N · m:ss` label per
  take over the stretch it owns, each with a quiet `×` that arms into one inline
  question clamped into the viewport (`delete take 2 (3:38)? yes / keep`, the yes
  in `--danger`) — never a browser `confirm()`, never a row that grows. Zoom is
  `− ▭ + fit`, small and muted at the right end of the readout row, never a
  full-width band of its own. With no frames and no words the whole component
  collapses to one muted line: an empty editor draws no ruler, no well, no
  scrollbar.
- **Transcript list** (`.tl-script`): the whole transcript under the timeline —
  cobalt mono times, current line cobalt-washed with an inset bar, click seeks,
  double-click edits in place. Open by default — it is the readable surface, and
  the axis above it is deliberately terse.
- **On-page dock** (`content/ui.ts`): white pill, hairline border, mono keycaps
  for its three keys — **draw `d`**, **clear `c`**, **stop `s`**; ink strokes
  draw in cobalt. Never dark, never orange.
- **Draw mode says so**: while ink owns the pointer the viewport wears a cobalt
  inset frame with one top tag (`drawing · esc to click`), and the dock never
  fades. The frame is captured in the recording on purpose.
- Judged in the preview harness (`npm run preview` → `:8777/gallery.html`),
  acceptance seed is `mode=long` (10:18, two takes, 150 frames). `mode=fresh` is
  the other one that has to hold: a walkthrough seconds old must be one quiet
  line, not a stack of empty scaffolding.

## Viewer & editor (web) — the walkthrough chassis (2026-08-12 redesign)

`/walkthroughs/:id`, the cloud editor, and `/w` share one chassis
(`src/components/viewer/*`, mocks: `plans/2026-08-12-viewer-redesign.md`):

- **Masthead header** (`walkthrough-header.tsx`): crumb, Fraunces title with quiet
  Rename, then on the same row right-aligned: segmented **StatusControl**, the
  **project picker as quiet text** (name + chevron opening a popover — never a
  native `<select>`), ONE kind-appropriate primary action (agent → cobalt "Copy
  agent brief"; human → the ShareControl pill `url · copy · revoke`), and the
  `⋯` **OverflowMenu**. Everything rare or irreversible lives in the overflow
  (kind switch, share for agent-kind, move, delete) and **arms into one inline
  `question? yes / keep` row** — no `window.confirm`, no growing rows. One mono
  meta line under the title says everything (slug · origin · date · duration ·
  takes · frames · errors · size · uploader); frames/errors only for agent kind.
- **Section heads** are `SectionHead` (small-caps mono) — transcript, console,
  frames, report, for a person. Sections divide with `.rule` hairlines, never
  boxes.
- **One player, one Timeline** (`timeline.tsx`): the takes play back to back
  through `useSegmentPlayer`; beneath, the scrubber — mono ruler, filmstrip
  lane, take lane (labels `take N · m:ss`, ↑/↓ reorder in the editor), voice
  lane (ink-grey bars, SVG), cobalt playhead. The axis is **SOURCE-GLOBAL**:
  cuts render ON it as hatched spans with mono `−N.Ns` tags above — enabled =
  cobalt-wash tag + hatch, vetoed = hollow struck tag. **Tags are the only
  toggle for an existing cut; bare drag only scrubs.** Where carving is enabled
  (the editor), **⇧-drag sweeps a cobalt-tinted span that commits as a manual
  cut on release** — nothing ever persists selected, so the 2026-08-01
  no-selection rule stands — and a hint line under the lanes says so; the
  readout row's "cut from here / to here" pair is the modifier-free path, its
  pending in-point a dashed cobalt line. A manual cut's tag deletes it outright
  (silence cuts stay vetoed, line cuts belong to the transcript). Empty
  timeline collapses to one muted mono line.
- **Frames** are a numbered contact sheet (`frames-grid.tsx`): mono `N m:ss`
  caption over each keyframe, the current one cobalt-ringed, click seeks.
- **Transcript** (`transcript-panel.tsx`) is a borderless list: cobalt mono
  times, the playing line cobalt-washed, click seeks. **Console**
  (`events-panel.tsx`): mono lines with a 2px left tick — red error, violet
  warn, never amber.
- **Editor** (`components/edit/editor.tsx`): readout `orig → tight · N cuts` +
  tighten slider, player + transcript rail (strike a line to cut its seconds),
  the Timeline with cuts, footer `Render & share` + quiet `discard edit`.
  Voice bars come from the real RMS envelope there; the agent viewer fakes
  them from transcript density (no decoded audio — deliberate).
- **Watch page** (`/w`): centered column — title, mono date · duration, player,
  centered Download link, transcript, and the one-line sign-off
  "Recorded with Handback → handback.dev". No controls, no metadata soup.

## Walkthroughs grid (`/app`)

`/app` is a **card grid**, not a list — "the walkthroughs available to you," never
an inbox or a queue. Responsive CSS grid (1 col phone / 2 mid / 3 wide), every
grid item `min-w-0` (the landing gotcha — mono lines never wrap). Card anatomy
(`src/components/inbox/card.tsx`):

- **Visual header** (aspect-video, hairline bottom rule). Agent-kind walkthroughs
  with frames show a **real keyframe thumbnail** (`object-cover`) with a small
  mono duration pill bottom-right (white/backdrop-blur, hairline). Human handbacks
  and frameless walkthroughs get a **paper title-card**, never a grey box: paper
  ground, a hairline inner frame, a mono small-caps kind label
  (`For a person` / `Screen recording`) over the duration set large in Fraunces —
  the duration is the hero so the placeholder reads as a designed cover.
- **Body**: status chip (7px dot + word in the fixed ink) with the ⋯ menu on the
  right; Fraunces title (2-line clamp); a mono `space · project` line; a mono
  footer of `uploader · time` left and `duration · N err · Nd` (expiry) right.
- The **whole card is a stretched `<Link>`**; the only thing above it is the ⋯
  menu, whose single job is **Rename** — it arms the inline title editor in the
  card body (usePopover from `viewer/overflow-menu`), no native select, no
  `confirm()`.

The **filter toolbar** is a light row over a hairline, not a rail: a search
input, the status filter as a **segmented control** (each segment carries its
mono count), and quiet **Space/Project popover selects** (label + value +
chevron) that appear only when the account has more than one space / any
projects. Summary counts are one quiet mono meta line under the "Walkthroughs"
title (`N available · N open · N in review`), never a dashboard row. Thumbnails
come from `walkthroughs.inbox`'s `thumbUrl` (one presigned keyframe per card).

## Don'ts

- No dark mode, no `.dark`, no `color-scheme: dark`.
- No orange, amber, or warm-yellow hues. Warning states use violet or red.
- No purple-gradient hero, no glassmorphism, no drop-shadow soup — shadows stay
  `shadow-sm` or none; depth comes from rules and card/paper contrast.
- No new font families, no icon libraries beyond `lucide-react`.
- Nothing copied from the Gripe extension UI — not a div, not a class list.
- Don''t center whole app pages; app surfaces are left-aligned with a max-width
  container (`max-w-6xl`), landing sections may center.
