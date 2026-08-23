# Handback — UI

> Visual-language source of truth. Follow exactly; deviations are bugs.
> Last updated: 2026-08-23.

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

Status mapping is fixed: **open = cobalt, in_review = violet, resolved = green,
needs_info = grey (muted ink — `bg-muted-foreground` dot, muted word).** needs_info
(2026-08-23) deliberately takes NO new hue: "waiting on you" is quiet, not an alarm.
Never invent a fifth status color.

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
uppercase group labels, cobalt-wash active item; collapse persists (`storageKey`
prop), mobile is an overlay. **It is THE app chrome since 2026-08-23** — the top
tab nav is deleted. `layout.tsx`'s AppShell renders it on every signed-in page
except /admin (which keeps its own sidebar shell; the two never nest): groups
Review (Walkthroughs · Projects · Usage), Capture (Record · Upload · Phone ·
Extension), Team (Teams · Connect); the footer carries Upgrade (non-pro only),
Admin (admins), the account email + Sign out. No new sidebar variants — reuse
it. Buttons: `default` variant is cobalt; `outline` for secondary actions;
destructive only for deletes. Marketing chrome on public pages is unchanged.
Pro-gated surfaces refuse with the exact string `Pro feature`; clients render
`ProUpsell` (`src/components/pro-upsell.tsx`) linking /upgrade — never a raw
error. The viewer's new panels: **RefinePanel** (summary ledger, health notes
as 2px-left-tick mono lines — warn red, info grey — removed-span lines, and a
quiet right-aligned run/re-run control) sits under the review thread;
**AssistantPanel** (the chat: mono-headed turns, action chips as mono `·` lines,
one input + cobalt Send) sits at the page's foot. An agent's question renders as
a left-ruled card ("agent asked"), the inline answer form under it; evidence
screenshots are h-20 bordered thumbnails. /upload's working screen carries a
violet-left-ruled "stay on this page" notice — the beforeunload guard can't
catch sidebar navigation, the sentence has to.

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
- **Parts list** (`Parts.tsx`, panel.css): the review screen. A walkthrough is a
  vertical list of **parts** — one card per recording, in recorded order, divided
  by hairline rules, never boxes. The word "take" never reaches the user; the noun
  is **part** (or "recording" where that reads better). Each card: a mono head row
  (`part N · m:ss`) with a quiet `×` that **arms inline in the same row**
  (`delete part 1 (2:19)? yes / keep`, the yes in `--danger`, the row never
  grows — never a browser `confirm()`); the **video in a dark well** (the one dark
  surface, because a video needs it) that plays on click; a control row under it —
  a small cobalt play/pause glyph, a slim 4px seek bar with a cobalt played fill,
  and a mono tabular clock `0:04 / 2:19` — drawn only once the video has loaded; a
  mono muted meta line (`N frames captured` / `full-rate video`, `· N console
  errors`, `· recovered after the panel closed`, `· transcribing…`); and the
  **transcript in its own scroll region** so a long part stays a compact card:
  cobalt mono times, the active line cobalt-washed with an inset bar, click seeks,
  double-click fixes a line in place. A recording whose video isn't on this machine
  (recovered, or the preview harness) shows the first keyframe dimmed with
  `video isn't on this machine` — never a broken player. At the foot of the list, a
  full-width cobalt-*outline* ghost button (`● record another part`) is the only
  add/record control on the screen; empty, the list is one muted line.
- **Intent chips** (1.9.0): one row directly above the destination row — muted
  lowercase `this is` + three mono pill chips `bug / feature / idea`, hairline
  off, cobalt border + cobalt-wash on. Clicking the active chip clears it.
  Hidden on the empty review screen. The web intake pages share the same
  three-chip control as `IntentControl` (`src/components/phone/intent.tsx`),
  shown only for agent-kind sends.
- **On-page dock** (`content/ui.ts`): white pill, hairline border, mono keycaps
  for its three keys — **draw `d`**, **clear `c`**, **stop `s`**; ink strokes
  draw in cobalt. Never dark, never orange.
- **Draw mode says so**: while ink owns the pointer the viewport wears a cobalt
  inset frame with one top tag (`drawing · esc to click`), and the dock never
  fades. The frame is captured in the recording on purpose.
- Judged in the preview harness (`npm run preview` → `:8777/gallery.html`),
  acceptance seed is `mode=long` (10:18, two parts, 150 frames). `mode=fresh` is
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
- **The player** (`video-stage.tsx`, `VideoStage`): every viewer surface (agent
  view, final cut, `/w`) plays through ONE custom-chrome player — **never native
  `<video controls>`**. A dark video well over a paper transport bar: play/pause,
  a seek bar (subtle buffered gutter, cobalt played fill, a grip that swells on
  hover, a mono time bubble that tracks the cursor), volume (hover-reveal slider),
  a mono speed menu, fullscreen. The seek bar reads the player's OUTPUT clock
  (every take as one continuous recording) so it never jumps back to zero at a
  take seam the way native controls do. Keyboard: space/k, ←→ (±5s), j/l (±10s),
  ↑↓ volume, m mute, f fullscreen, 0-9 seek, Home/End. **Capture tells** (agent
  kind, Camera toggle in the bar, default on): each keyframe is a hairline tick on
  the seek bar, and as playback crosses one the well gives a brief white shutter
  flash and holds a small corner thumbnail of that keyframe — the exact still the
  agent reads, grabbed right here. Keep the well dark (video needs it); everything
  else stays light paper + cobalt.
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
- **The viewer's main area is a two-way view switch** (2026-08-14): a segmented
  **Video / Frames** control (status-control anatomy, cobalt-wash active) as the
  first thing under the masthead. **Video** = player + transcript/console rail +
  Timeline + the `cut this video down` link; **Frames** = the slideshow,
  full-width. The video view is hidden, never unmounted (playback position
  survives the switch); switching to Frames pauses playback. Comments and the
  report sit below in both views.
- **Frames view** is a shot-by-shot **slideshow** (`slideshow.tsx` — replaced
  the contact sheet + lightbox 2026-08-14; thousands of tiles were unreadable):
  one big still on a dark well with overlay ←/→ arrows (arrow keys work while
  the stage has focus), a mono `frame N / total · m:ss` readout with quiet
  `play from here` / `edit frames` mono links on its right, a horizontal
  filmstrip that auto-centres the selected thumb — **legible size on purpose**
  (`h-24 sm:h-28`, each thumb numbered with a tiny mono chip): before/after
  must be judgeable at a glance for delete decisions, never a 56px scrubber
  (cobalt ring = the shot you're on; a 2px cobalt bottom tick = where the video
  playhead is — two different facts, keep both), and the dialog in a **right
  rail** (lg+): stage + filmstrip take a 2/3 column and the full transcript
  scrolls in a bordered strip beside them — absolute-positioned so it borrows
  the left column's height instead of stretching the row; below lg it stacks
  beneath the filmstrip. The line spoken at this shot is cobalt-washed and
  auto-centred.
  Both auto-scroll containers are `relative` on purpose — offsetTop/offsetLeft
  read from the nearest positioned ancestor, and without it the strips clamp.
  Clicking a transcript line jumps the slideshow, never the player;
  `play from here` is the bridge back (switches to Video, seeks, scroll-reveals).
  **Edit mode** (members only): `delete this frame` (destructive mono, white
  chip on the stage) deletes with NO confirm — deletes are **staged** locally
  with **infinite undo** (`undo (N)` link, Cmd/Ctrl+Z, Delete key deletes the
  current shot) and commit as one batch via `done — delete N`; a mono
  `saving… / couldn't save — retry` line reports the commit. Every filmstrip
  thumb also carries its own ✕ (hover-revealed; always shown on the current
  one) so neighbours die without navigating to them — deleting one before the
  current shot re-indexes to keep the big view on the same image. Same position
  shows the next shot after a delete, so pruning near-duplicates is
  delete-delete-delete.
- **Transcript** (`transcript-panel.tsx`) is a borderless list: cobalt mono
  times, the playing line cobalt-washed, click seeks. **Console**
  (`events-panel.tsx`): mono lines with a 2px left tick — red error, violet
  warn, never amber.
- **Editor** (`components/edit/editor.tsx`): readout `orig → tight · N cuts`,
  **Undo/Redo** buttons, and the tighten slider on the top row; `VideoStage`
  player + transcript rail (strike a line to cut its seconds); the Timeline with
  cuts; footer `Render & share` + quiet `discard edit`. Voice bars come from the
  real RMS envelope there; the agent viewer fakes them from transcript density
  (no decoded audio — deliberate). **The editor Timeline has a selection now**
  (reverses the old no-selection rule — owner directive 2026-08-13, decisions.md):
  a **drag paints a persistent cobalt selection**, a **click moves the playhead**,
  and a floating **Remove Ns** button (or **Delete**; **Esc** clears) cuts it. No
  modifier keys, no in-point dance. Undo/redo is ⌘/Ctrl+Z · ⇧+Z (a Tighten-slider
  drag is one undo step). The **viewer** Timeline stays a pure scrubber — drag
  still scrubs there.
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
