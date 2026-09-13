# Handback — UI

> Visual-language source of truth. Follow exactly; deviations are bugs.
> Last updated: 2026-09-13 (the Asana-shaped redesign — plans/2026-09-12-asana-redesign.md,
> canvas https://claude.ai/code/artifact/cc32b6a3-ea2c-4056-94c7-e578c3dd8afc).

## The one law

**Light only. No dark mode. Nothing orange.** Sal's words: "no more of this
fucking dark mode and orange." There is no `.dark` variant, no
`prefers-color-scheme` handling, no orange or near-orange hue anywhere.

## Concept

**A work tool, not a magazine.** Handback replaces Asana for the loop between a
person and a coding agent, so it looks like the tool you keep open all day: a
sidebar and a topbar, a project with List and Board views, a detail pane that
slides in beside the list, one accent, dense 13px type, 1px borders. Sal on the
previous rounds: "built for an accountant" (the old editorial paper) and "too
cute" (serif/stamps/hard shadows). Neither comes back. The recordings are the
loud part; the chrome is quiet and functional.

## Tokens (`src/styles/app.css`)

| Token | Value | Use |
| --- | --- | --- |
| `--background` / `--card` / `--popover` | `#ffffff` | page and surfaces are white |
| `--secondary` | `#f7f8fa` | board columns, composer/notice wells, hover rows |
| `--muted` | `#f1f2f5` | tags, search pill, disabled |
| `--foreground` / `--ink` | `#1f2229` | text, the ON state of chips/Stop |
| `--muted-foreground` | `#6b7280` | secondary text, labels |
| `--border` | `#e6e7eb` | every 1px rule and card edge |
| `--input` | `#d9dbe1` | control borders (chips, inputs, outline buttons) |
| `--cobalt` (= `--primary`) | `#2f56d8` | THE accent: links, primary buttons, active nav, open status |
| `--cobalt-wash` | `#e9edfb` | selected row, active nav, open-status pill |
| `--review` / `--review-wash` | `#6b45d6` / `#efe9fb` | "Your call" (in_review) only |
| `--approve` / `--approve-wash` | `#128a3c` / `#e4f4ea` | Done (resolved), Approve, fixed ✓ |
| `--destructive` | `#c8322b` | delete/discard, REC badge, error ticks |
| `--sidebar` / `--sidebar-accent` | `#fafbfc` / `#e9edfb` | the sidebar and its active item |
| `--radius` | `0.5rem` | cards 8px (`rounded-lg`), controls 6px (`rounded-md`), board columns 10px |

Status mapping is fixed and is the whole status vocabulary everywhere (List,
Board, pane, extension, emails): **in_review = violet "Your call" · open = cobalt
"Open" · needs_info = grey "Needs info" · resolved = green "Done"**, plus
**Processing** (grey pill, pulsing dot) which overrides the label while
`refineStatus === 'running'`. Rendered ONLY by `StatusPill`
(`src/components/ui/status-pill.tsx`, `STATUS_INK`); never hand-roll a status
colour, never invent a fifth hue. Project colours come from `projectColor(id)`
(`ui/project-tag.tsx`): six fixed inks hashed by id (cobalt, violet, green, teal,
slate, magenta), a grey square for General.

## Type

- **Inter** for everything (`--font-display` and `--font-body` both resolve to
  it; the `font-display` class is harmless but adds nothing). Headings are
  `font-semibold tracking-[-0.01em]`: page h1 `text-xl`, pane title `text-xl`,
  section h2/h3 `text-base` / `text-[13px]`, landing h1 `text-5xl`.
- **JetBrains Mono** (`font-mono`): timestamps, counts and scores (`7/8`),
  slugs, tokens, file paths, transcript times, code. Tabular numerals on clocks.
- Density: body `text-sm` (14px) for prose; tables, rows, pills, fields and the
  extension run at **13px**; labels and meta at `text-xs`.
- Loaded via Google Fonts in `index.html`. Do not add other font families; the
  extension stays on the system stack.

## Components (`src/components/ui/`)

shadcn-style primitives, new-york, no `asChild`: `button` (h-8 default, h-7
`sm`, h-9 `lg`; variants `default` cobalt · `outline` · `ghost` · `approve`
green · `destructive` · `link`; `text-[13px] font-medium`, no shadows), `card`
(`rounded-lg border bg-card`, no shadow), `input` (h-8, `border-input`), `label`,
`sidebar` (hand-rolled, no radix; collapse persisted; mobile overlay). Plus the
redesign's six:

- `StatusPill({status, processing})` — 22px washed pill, 7px ink dot, the label.
- `ProjectTag({id, name})` — 22px muted pill with the project's colour square.
- `Avatar({name, size})` — initials in a cobalt-wash disc (`sm` 20px, `md` 28px).
- `Tabs({items, value, onChange})` — underline tabs, 2px ink bar on the active
  one, optional mono count.
- `Chip({on, count})` — 28px filter chip, `border-input`; ON = ink background,
  white text. Also the look of every popover trigger (Space/Project facets,
  destination).
- `PageHeader({title, meta, actions, tabs})` — h1 + muted meta + right actions,
  tabs row under it.

**Motifs that survive:** the return mark (`logo.tsx` `ReturnMark` + lowercase
`handback` wordmark, never redrawn; extension icons share the geometry); 1px
rules; inert command blocks (`opacity-60 select-none` + a mono `preview` label
until the contents are real — never a Copy button on something that must not be
pasted). **Motifs that are gone:** `.stamp` (the class exists without its tilt;
do not use it), `.ink-underline`, editorial `01/02` numerals, paper ground,
serif anything, hard offset shadows, black slabs.

## The shell (`src/app/layout.tsx`)

Signed-in pages render inside **topbar + (sidebar | content)**:

- **Topbar** — sticky, 52px, white, `border-b`: wordmark → /app; a 420px grey
  search pill (`Search walkthroughs, projects, people`, submits to `/app?q=`);
  spacer; `● Record` (default button → /record); `Upgrade` ghost (non-pro);
  the `Avatar` menu (email · Usage · Admin · Sign out).
- **Sidebar** — 232px, `bg-sidebar`, `border-r`, 13px items with 16px icons,
  active = cobalt-wash + cobalt text. Top: Walkthroughs · Projects · Teams ·
  Connect. Group **Projects**: the live project list (colour square + name →
  `/app?project=<id>`), `All projects →` past 10, `+ New project`. Group
  **Spaces** (only with ≥1 team): Personal → `/app?space=personal`, each team →
  `/app?space=<id>`. Group **Capture**: Record · Upload · Phone · Extension.
  Footer: Usage · Upgrade (non-pro) · Admin (admins). Group labels are 11px
  semibold uppercase — not mono. No email/sign-out here (they moved to the
  avatar menu). `/admin` keeps its own sidebar shell in the same styles.
- **Content** — `/app` and `/walkthroughs/*` are full-bleed (the pages own their
  `px-7`); every other page sits in `mx-auto max-w-6xl px-7 py-6` and opens with
  `PageHeader`.
- Marketing chrome (public pages): 60px white header (wordmark, How it works ·
  Pricing · Docs, Sign in ghost + Get started primary), footer `mt-20 border-t`.

## Walkthroughs — List, Board, pane (`/app`)

`src/app/app.tsx` + `src/components/inbox/*`. Filters are **URL params**
(`view=list|board`, `status=all|call|open|processing|done`, `space`, `project`,
`q`, `w` = the open pane) — the sidebar and topbar link into them; nothing is
remembered in localStorage.

- **Groups** (`inbox/groups.ts`), in this order everywhere: **Needs your call**
  (in_review + needs_info, violet dot) · **Processing** (refine running, grey
  pulsing) · **Open** (cobalt) · **Done** (resolved, green — the archive, auto-
  expires in 30 days).
- **Header**: `PageHeader` — title is the project (with its swatch) or the space
  when filtered, else "Walkthroughs"; meta `N walkthroughs`; actions `Upload`
  outline + `Record` primary; tabs `List | Board`. Tools row: status `Chip`s with
  mono counts, spacer, Space/Project facet triggers styled as chips.
- **List** (`list-view.tsx`): a 13px table — Walkthrough · Status · Agent ·
  Project · Recorded by · Age. Section rows per group (`▾ Needs your call 3`;
  Done collapsed by default with `archived · clears after 30 days`). Rows h-11,
  hover `bg-secondary`, selected `bg-cobalt-wash`. Cell 1 = the **✓ circle**
  (approves an in_review row; filled green on Done; decorative otherwise), a
  48×30 keyframe thumb, the title over a muted sub line (`2 parts · 3:57 · 31
  keyframes`). Agent = a 56px green score bar + mono `fixed/total` from the
  newest result's outcomes, or `—`. Row click opens the pane (`?w=`); the row
  `⋯` = Rename (inline) · Mark resolved / Reopen · Open full page.
- **Board** (`board-view.tsx`): four `bg-secondary` rounded-[10px] columns,
  compact cards (thumb, title, `ProjectTag`, green score, age, `Avatar sm`).
  HTML5 drag: drop on Open or Done changes status (optimistic); Needs your call
  and Processing are not drop targets.
- **Pane host**: with `w` set the page becomes `grid [1fr_640px]`; the pane is
  sticky under the topbar, `border-l`, and the one shadow in the app
  (`-8px 0 24px rgb(31 34 41 / .06)`). Below `lg` it is a full-screen overlay.
- Empty state: one muted line with the Record and Upload links. Never a card
  grid, never a dashboard row of stats.

## Walkthrough detail — pane and page (`src/components/viewer/pane/*`)

ONE body, `WalkthroughDetail`, renders in the pane (`/app?w=`) and as the
Overview of the full page (`/walkthroughs/:id`). The old desk (masthead + rail +
tabbed hero) is deleted.

- **Header** (`pane/header.tsx`): `✓ Approve` (approve green; member ·
  in_review · has a result) · `Send back` (outline → popover textarea) · spacer ·
  `Copy brief` ghost (agent kind, open) / `ShareControl` (human) · `OverflowMenu`
  · pane: `Open full page ↗` + `×`. Page mode adds a crumb `Walkthroughs /
  {ProjectTag}` above.
- **Body**, in order: editable title (`text-xl font-semibold`; the refine-
  suggested title as a muted `use · dismiss` line) → **fields grid**
  (`120px 1fr 120px 1fr`: Status `StatusChip` popover · Project picker as a
  `ProjectTag` + chevron · Recorded by `Avatar sm` + name + UTC stamp · Agent
  `author · answered 2h ago` · Parts `2 · 3:57 · 31 keyframes` · Intent) → the
  **video** (`VideoStage`, pane only — the page's Recording tab owns the single
  player and Overview seeks jump to it) → **What you said** (`digestMd`, or the
  refining pill + stage line, or the run-refine / `ProUpsell` line) → **Key
  points · N of M fixed** (`key-points-checklist.tsx`: 18px disc — green ✓ fixed
  · cobalt ring ◐ partial · grey – skipped · hollow when unanswered; severity
  dot; mono cobalt `m:ss` seek chip) → **Result from {agent}**
  (`result-card.tsx`: summary, ≤6 mono file chips, PR · evidence thumbs · full
  write-up toggles) → the question card + `AnswerForm` (needs_info) → the Done
  line (`StatusPill` + `Signed off … · clears …` + Keep; no stamp) →
  **Activity** (`desk/conversation.tsx`: `Avatar sm` + `who · time` lines,
  system lines muted, a bordered composer with one `Comment` button).
- **Page tabs** (`Tabs`): Overview · Recording · Frames (count) · Console
  (count) · Brief · report.md · Tasks · Edit with AI (agent kind non-child; Pro
  gating unchanged). Recording stays mounted across tabs; leaving it pauses
  sound. Human kind = header + FinalCut/CloudEditor; child = the detail body
  with `TaskBrief`.
- Section heads are `text-[13px] font-semibold` (`SectionHead`), never
  small-caps mono.

The bullets below describe components the pane and page reuse unchanged:
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
- (The 2026-08-14 Video/Frames two-way switch is superseded by the desk's rail
  tabs; the hidden-not-unmounted rule survives — the Recording tab stays mounted
  across tab switches so playback position holds, and leaving it pauses sound.)
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

## Extension (`extension/`)

The side panel obeys the same law on **system fonts** (no webfonts in an
extension): `'Segoe UI', system-ui` body, `Cascadia Mono / Consolas` mono.
Tokens mirror the web palette as plain CSS custom properties in
`extension/src/sidepanel/styles.css` (white ground, `--paper #f7f8fa` for wells,
`--input`, the four status inks, `--danger`); type scale 12/13/14/16/20; radius
8 (cards) / 6 (controls).

- **Header** (44px, white, 1px rule): mark + `handback` (600 14px). Right: while
  recording a red pill `● REC m:ss`; otherwise a muted `space · project` label
  (the destination control itself stays in the review footer — its popover
  opens upward). No settings gear here.
- **Home**: `● Record a walkthrough` — full-width, 40px, cobalt (the one primary
  per screen). Sections with 11px semibold uppercase heads (`Needs your call ·
  N`, `In progress · N`, `On this machine · N`), rows 40px with a 7px status
  dot, 500 title, right-aligned mono score / muted stage / `1 part · not sent`.
  Filter chips = `.chip` (28px, ON = ink). Footer line: `Open Handback ↗` left,
  `Settings` right (opens the drawer).
- **Recording** — the panel is the live block and nothing else (1.11.0): mono
  clock 44px, muted `N keyframes · N lines · tab audio on`, the captions box
  (1px border, radius 8, 15px text, with the muted line `rough live captions —
  the real transcript is written after you stop` inside it), `■ Stop` 40px ink,
  and pinned to the bottom in a grey well: `you can close this panel — recording
  keeps going. reopen it from the toolbar icon, or press s on the page, to stop`.
  The toolbar badge is red `REC` (the one red besides discard/delete).
- **Review**: crumb `← Walkthroughs` (cobalt) left, `Discard` (danger red,
  arms inline — never a browser confirm) right; title input 17px 600; muted `N
  parts · m:ss`; each **part** a bordered card: 56×34 thumb, `Part N · m:ss`,
  muted status line (`N keyframes · transcript ready` / `writing the transcript ·
  62%` / `recovered after the panel closed`), a green ✓ disc when the transcript
  is in or mono `%` + a 4px cobalt bar while it's written (indeterminate slide
  when no real fraction); the video well, controls and transcript list live
  inside the card. `+ Record another part` = 40px outline. Footer: `This is` +
  three chips (ON = ink) · `To` + the destination trigger · `Send to Handback`
  cobalt 40px · muted `Uploads in the background once the transcript is done.
  You can close this.` Send is never disabled by transcription and never ships
  the live dictation (the upload waits).
- **Outbox rows** (13px): `waiting for the transcript…` · `uploading … 71%` +
  bar · done = `"title" uploaded`, **`view your handback →`** (cobalt 600 14px),
  `Handback is processing it`.
- Gates (mic, picker), the settings drawer and the link card are bordered
  cards with 32px buttons. Nothing orange, no shadows, no dark surface but the
  video well.
- **On-page dock** (`content/ui.ts`): white pill, 1px border, mono keycaps for
  **draw `d`**, **clear `c`**, **stop `s`**; ink strokes draw in cobalt. **Draw
  mode says so**: a cobalt inset frame with one top tag (`drawing · esc to
  click`); the frame is captured in the recording on purpose.
- Judged in the preview harness (`npm run preview` → `:8777/gallery.html`),
  acceptance seed `mode=long`; `mode=fresh` must read as one quiet line.

## Landing, docs, legal

Landing (`src/components/landing/*`): hero = headline `text-5xl font-semibold`
+ `text-lg` sub + two buttons on the left, `AppMock` (a CSS rendering of the
List + pane, `rounded-xl border shadow-sm`) on the right; How it works = three
bordered cards with a cobalt-wash number badge; Pricing = three bordered cards,
the middle with a `border-t-2 border-t-cobalt` and a `Most popular` chip; final
CTA = one `bg-secondary` band. Docs/privacy/terms (`legal.tsx`): `max-w-3xl`,
h1 `text-2xl font-semibold`, h2 `text-base`, prose 15px, command blocks
`rounded-md border bg-secondary font-mono text-[13px]`.

## Secondary app pages

Every page: `PageHeader` first, then bordered cards (`rounded-lg border bg-card
p-5`) and List-idiom tables (13px, `th` xs muted, rows h-10/11, hover
`bg-secondary`). Setup pages (`/connect`, `/recorder`) use `SetupStep` cards
with a cobalt-wash number badge for the steps the person actually does;
reference material is a plain `text-base font-semibold` heading over a card.
Meters (`/usage`) are 4px bars (cobalt, destructive at ≥90%). Pro-gated
surfaces refuse with the exact string `Pro feature`; clients render `ProUpsell`
(`bg-secondary` notice + `Upgrade`), never a raw error. `/upload`'s "stay on this
page" notice stays violet-ruled.

## Don'ts

- No dark mode, no `.dark`, no `color-scheme: dark`.
- No orange, amber, or warm-yellow hues. Warning states use violet or red.
- No serif, no stamps, no editorial numerals, no paper/ledger motifs, no hard
  offset shadows, no black slabs, no glassmorphism — the pane edge is the one
  shadow.
- No new font families, no icon libraries beyond `lucide-react`.
- No status colour outside `StatusPill`/`STATUS_INK`; no fifth status hue.
- No card grid on `/app`; no separate "inbox" or dashboard.
- Don't center whole app pages; app surfaces are left-aligned (`max-w-6xl` or
  full-bleed), landing sections may center.
- Nothing copied from the Gripe extension UI — not a div, not a class list.
