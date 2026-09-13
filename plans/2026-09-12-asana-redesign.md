# Asana-shaped redesign — web, portal, extension

- **Date:** 2026-09-12
- **Status:** done
- **Type:** plan
- **What:** the complete redesign Sal approved from the canvas (https://claude.ai/code/artifact/cc32b6a3-ea2c-4056-94c7-e578c3dd8afc): a work tool, not a magazine. Fable specs, Opus builds (≤3 concurrent).

## The direction (settled)

Sidebar + topbar shell. A project has List and Board views. A walkthrough opens as a right-hand
detail pane beside the list, and as a full page on its own URL. Inter at 13px density, one cobalt
accent, the four status inks (violet "Your call" · cobalt Open · grey Processing/Needs info · green
Done), 1px `#e6e7eb` borders, 6–10px radii, no shadows except the pane's edge, no serif, no stamps,
no editorial numerals, nothing orange, light only. The video player, timeline, slideshow, editor,
and watch page are reused unchanged in look (dark well is the one dark surface).

## Waves

- **0 — foundation** (1 Opus, blocking): fonts + tokens, app shell (topbar + sidebar), marketing
  chrome, ui primitives. Everything downstream imports these.
- **2A — /app List + Board + pane host** · **2B — walkthrough detail pane + page** · **2C —
  extension panel** (3 Opus, parallel; 2A and 2B share only the `?w=` contract).
- **3A — landing/docs/legal** · **3B — projects/team/usage/upgrade/connect/recorder** · **3C —
  upload/phone/record/auth/join/watch/admin shell** (3 Opus, parallel, class-level restyles).
- Gate: `bun run typecheck`, `bun run build`, `cd extension && npm run typecheck && npm run build`,
  one Opus quality pass, bx screenshots of /, /app, /walkthroughs/:id.

## Contracts every wave obeys

- URL params on `/app`: `view=list|board` (default list), `status=call|open|processing|done|all`
  (default all, grouped), `space=personal|<teamId>`, `project=<id>|general`, `q=<text>`,
  `w=<walkthroughId>` (the open pane). The sidebar links use `space`/`project`; the topbar search
  navigates to `/app?q=`.
- Groups (List sections / Board columns), in this order: **Needs your call** = status
  `in_review` or `needs_info`; **Processing** = `refineStatus === 'running'` (any status);
  **Open** = `open` and not processing; **Done** = `resolved`.
- Primitives live in `src/components/ui/`: `StatusPill`, `ProjectTag` + `projectColor(id)`,
  `Avatar`, `Tabs`, `Chip`, `PageHeader`, restyled `Button`/`Card`/`Input`.
- The detail body is ONE component (`WalkthroughDetail`) used by both the pane and the page.
- Extension keeps system fonts; tokens mirror the web palette in `sidepanel/styles.css`.

## Wave 0 spec — foundation

FILES: `index.html`, `src/styles/app.css`, `src/app/layout.tsx`, `src/components/ui/sidebar.tsx`,
`src/components/ui/{button,card,input,label}.tsx`, new `src/components/ui/{status-pill,project-tag,avatar,tabs,chip,page-header}.tsx`,
`src/components/logo.tsx` (Wordmark font only).

1. `index.html`: Google Fonts link → `Inter:wght@400;500;600;700` + `JetBrains+Mono:wght@400;500`.
   Drop Fraunces / Libre Franklin / IBM Plex Mono.
2. `app.css` `:root`: `--font-display: 'Inter', …sans`; `--font-body` same; `--font-mono:
   'JetBrains Mono', ui-monospace, monospace`. Colours (hex): background `#ffffff`, foreground
   `#1f2229`, card `#ffffff`, popover `#ffffff`, cobalt `#2f56d8`, cobalt-wash `#e9edfb`,
   secondary `#f7f8fa`, muted `#f1f2f5`, muted-foreground `#6b7280`, accent = cobalt-wash,
   destructive `#c8322b`, border `#e6e7eb`, input `#d9dbe1`, ring `rgb(47 86 216 / 45%)`, review
   `#6b45d6`, review-wash `#efe9fb`, approve `#128a3c`, approve-wash `#e4f4ea`, sidebar `#fafbfc`,
   sidebar-accent `#e9edfb`, sidebar-accent-foreground `#2f56d8`, `--radius: 0.5rem`. Base: h1–h3
   `font-weight: 600; letter-spacing: -0.01em` (Inter). `.stamp`: remove `transform`, keep the
   rest. `.rule`, `.ink-underline` unchanged. Body keeps `text-sm` default (14px); dense surfaces
   use `text-[13px]`.
3. `button.tsx`: `h-8 rounded-md px-3 text-[13px] font-medium`; variants `default` (bg-cobalt
   text-white hover:bg-cobalt/90), `outline` (border-input bg-card hover:bg-secondary),
   `ghost` (text-muted-foreground hover:bg-secondary hover:text-foreground), `approve`
   (bg-approve text-white), `destructive` (bg-destructive text-white), `link`; sizes `sm` h-7
   px-2.5 text-xs, `default` h-8, `lg` h-9 px-4, `icon` size-8. `card.tsx`: `rounded-lg border
   border-border bg-card` no shadow; CardHeader p-4, CardContent p-4 pt-0. `input.tsx`: `h-8
   rounded-md border-input bg-card px-2.5 text-[13px] focus-visible:ring-2 ring-ring`.
4. New primitives (each a default-export-free named component, props typed, no `any`):
   - `status-pill.tsx`: `export const STATUS_INK = { open: {label:'Open', text:'text-cobalt', dot:'bg-cobalt', wash:'bg-cobalt-wash'}, in_review: {label:'Your call', text:'text-review', dot:'bg-review', wash:'bg-review-wash'}, needs_info: {label:'Needs info', text:'text-muted-foreground', dot:'bg-muted-foreground', wash:'bg-muted'}, resolved: {label:'Done', text:'text-approve', dot:'bg-approve', wash:'bg-approve-wash'} } as const` keyed by `WalkthroughStatus`; `export function statusInk(status: string)` (falls back to open); `export function StatusPill({ status, processing = false, className }: { status: string; processing?: boolean; className?: string })` → `<span class="inline-flex h-[22px] items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap {wash} {text}"><i class="size-[7px] rounded-full {dot} {processing && 'animate-pulse'}"/>{processing ? 'Processing' : label}</span>`.
   - `project-tag.tsx`: `const PROJECT_COLORS = ['#2f56d8','#6b45d6','#128a3c','#0e7490','#4b5563','#b8236b']`; `export function projectColor(id: string | null): string` (null → `#9ca3af`; else sum of char codes mod 6); `export function ProjectTag({ id, name, className }: { id: string | null; name: string; className?: string })` → `<span class="inline-flex h-[22px] items-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium text-foreground/80"><i class="size-2 rounded-[2px]" style={{background: projectColor(id)}}/>{name}</span>`.
   - `avatar.tsx`: `export function Avatar({ name, size = 'md', className }: { name: string | null; size?: 'sm' | 'md'; className?: string })` → initials (first letter of first two words, uppercase, `?` when null) in a circle `bg-cobalt-wash text-cobalt font-semibold` sm = size-5 text-[9px], md = size-7 text-[11px].
   - `tabs.tsx`: `export function Tabs<K extends string>({ items, value, onChange, className }: { items: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void; className?: string })` → flex row `border-b border-border`, each a button `px-2.5 py-2 text-[13px] font-medium -mb-px border-b-2` active `border-foreground text-foreground`, else `border-transparent text-muted-foreground hover:text-foreground`; count in `ml-1.5 font-mono text-xs text-muted-foreground`.
   - `chip.tsx`: `export function Chip({ on = false, count, onClick, children, className }: { on?: boolean; count?: number; onClick?: () => void; children: ReactNode; className?: string })` → button `h-7 rounded-md border px-2.5 text-[13px] font-medium inline-flex items-center gap-1.5`, on = `bg-foreground border-foreground text-white`, off = `border-input bg-card text-foreground/80 hover:bg-secondary`; count `font-mono text-xs opacity-70`.
   - `page-header.tsx`: `export function PageHeader({ title, meta, actions, tabs, className }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; tabs?: ReactNode; className?: string })` → `<header class="flex flex-col gap-3 px-7 pt-5"><div class="flex items-center gap-3"><h1 class="text-xl font-semibold tracking-tight">{title}</h1>{meta && <span class="text-muted-foreground text-[13px]">{meta}</span>}<span class="flex-1"/>{actions}</div>{tabs}</header>`.
5. `sidebar.tsx`: keep the API and the collapse/mobile behaviour; restyle: width 232px, `bg-sidebar border-r`, items `h-8 rounded-md px-2.5 text-[13px] font-medium text-foreground/80 gap-2.5`, active `bg-sidebar-accent text-cobalt`, icons `size-4`, group labels `px-2.5 mt-3 mb-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground` (no mono). Add `SidebarMenuLink` prop `swatch?: string` (renders a `size-2 rounded-[2px]` square in that colour instead of an icon) and `trailing?: ReactNode` (right-aligned muted count).
6. `layout.tsx`: AppShell becomes topbar + (sidebar | inset):
   - `TopBar` (h-[52px] border-b bg-card px-4 flex items-center gap-3.5): `Wordmark` link → /app; a search `<form>` (`hidden md:flex`, w-[420px] h-8 rounded-md bg-muted px-3 text-muted-foreground, Search icon, input placeholder "Search walkthroughs, projects, people", submits `navigate('/app?q=' + encodeURIComponent(q))`); spacer; `<Link to="/record">` styled `buttonVariants()` with a `CircleDot` icon and label `Record`; `Upgrade` ghost link (only when `ent.data && !ent.data.pro`); `Avatar` button (name from `session.user.name ?? email`) opening a popover (usePopover from `~/components/viewer/overflow-menu`) with: email line (muted, truncated), `Usage` link, `Admin` link (adminStatus), divider, `Sign out` button (existing signOut). `session.user.name` — read from `RootLoaderData` (check routes.tsx's session shape; use `name ?? null`).
   - Sidebar content: menu items (no group label) `Walkthroughs` /app end (LayoutList), `Projects` /projects (FolderKanban), `Teams` /team (Users), `Connect` /connect (Plug). Group "Projects": `useQuery(trpc.projects.all)` — first 10 by name, each `SidebarMenuLink to={'/app?project=' + p.id} label={p.name} swatch={projectColor(p.id)}`; if more than 10 a muted `All projects →` link to /projects; `+ New project` muted link to /projects. Group "Spaces" (only when `teams.mine` has ≥1 team): `Personal` → `/app?space=personal`, each team → `/app?space=<id>` (icon: none, swatch `#9ca3af` for personal, `#2f56d8` teams). Group "Capture": Record /record (CircleDot), Upload /upload, Phone /phone, Extension /recorder (Puzzle). Footer: Usage (Gauge), Upgrade (non-pro, Sparkles), Admin (ShieldCheck). Remove the email/sign-out from the footer (they moved to the avatar menu). Active-link matching for query links: active when `location.pathname === '/app' && location.search` contains that exact param (write a tiny `isQueryActive(search, key, value)` helper).
   - `fullBleed = pathname === '/app' || pathname.startsWith('/walkthroughs/')` → main `w-full min-w-0`; else `mx-auto w-full max-w-6xl px-7 py-6`. Drop `forceCollapsed={desk}`; keep the mobile trigger row.
   - `MarketingHeader`: h-[60px] white border-b, Wordmark, links `text-[13px] font-medium text-muted-foreground hover:text-foreground`, right: Sign in (ghost) + `Get started` (buttonVariants default). `MarketingFooter`: `mt-20 border-t`, same links, `text-[13px]`.
7. `logo.tsx`: Wordmark uses `font-semibold tracking-[-0.01em]` (Inter) — the ReturnMark geometry is untouched.

DONE WHEN: `bun run typecheck` green; `grep -rn "Fraunces\|Libre Franklin\|IBM Plex" index.html src/styles` empty; every page still compiles (unchanged pages may look off — that's waves 2/3).

## Wave 2A spec — /app List + Board + pane host

FILES: `src/app/app.tsx` (rewrite), `src/components/inbox/card.tsx` → delete; new
`src/components/inbox/{list-view,board-view,row-menu,groups}.tsx`; `server/router.ts` (inbox only).

- `server/router.ts` inbox: add `score: { fixed: number; total: number } | null` = from the newest
  `WalkthroughNote` with `kind:'result'` and non-null `outcomesJson` (select notes
  `{ where: { kind: 'result' }, orderBy: { createdAt: 'desc' }, take: 1, select: { outcomesJson: true } }`),
  total = outcomes.length, fixed = count of status `'fixed'`; null when none. JSON-safe.
- `groups.ts`: `type Group = 'call' | 'processing' | 'open' | 'done'`; `groupOf(card)`; `GROUPS:
  { key, label ('Needs your call' | 'Processing' | 'Open' | 'Done'), dot colour class }[]` in the
  contract order.
- `app.tsx`: filters come from `useSearchParams` (contract above; the old localStorage memory is
  deleted). `PageHeader` title = project name when `project` set (with its swatch), else space
  name when `space` set, else `Walkthroughs`; meta = `N walkthroughs`; actions = `Upload` outline
  link → /upload and `Record` primary link → /record; tabs = `Tabs` List | Board (sets `view`).
  Tools row (`px-7 py-2.5 flex gap-2`): `Chip`s for `status` all/call/open/processing/done with
  counts (counts computed over the space/project/q-scoped set); spacer; existing Space and Project
  `FacetSelect`s (restyle as `Chip`-looking triggers), they write `space`/`project` params.
  Deep search (`walkthroughs.search`) stays. The connect line stays (restyled muted, under tools).
  Polling stays (5s while any `refineStatus==='running'`).
- `list-view.tsx`: a `<table class="w-full border-collapse text-[13px]">` with `thead` (Walkthrough
  46% · Status · Agent · Project · Recorded by · Age right) `th` `text-left text-xs font-medium
  text-muted-foreground px-3 py-1.5 border-b`. For each group with ≥1 row (or all four when
  `status=all`, skipping empty ones): a section row `td colspan=6 h-9 font-semibold border-b`
  `▾ {label} <span class="text-muted-foreground font-normal ml-1.5">{n}</span>` (Done collapsed by
  default: `▸`, click toggles, shows `archived · clears after 30 days` muted). Rows `h-11
  border-b border-border/60 hover:bg-secondary cursor-pointer`, selected (`w` param) `bg-cobalt-wash`.
  Cells: [1] `flex items-center gap-3`: the ✓ circle (`size-[18px] rounded-full border-[1.5px]
  border-input`; for `in_review` rows it is a button that calls `setStatus('resolved')` with title
  "Approve"; for `resolved` rows filled green with a check; otherwise decorative), thumbnail
  (`w-12 h-[30px] rounded object-cover` from `thumbUrl`, else a `bg-muted` block), title
  (`font-medium truncate`) over a muted sub line `{parts} · {m:ss} · {points} key points` (parts
  from `takesCount` if present else omit; points from `pointsCount`? — inbox lacks these: sub line
  = `{kind==='human' ? 'for a person' : 'screen recording'} · {mmss(durationMs)}` + (`· N console
  errors` when errorCount>0)); [2] `StatusPill` (processing when refineStatus running; label
  "Processing · {stage word}" where stage reading→"reading" frames→"watching frames"
  writing→"writing it up"); [3] Agent: `score` → a 56px bar (`h-1 rounded bg-border` with green
  fill `fixed/total`) + mono `fixed/total`; null → `—` muted; [4] `ProjectTag` (name or
  `General`); [5] `Avatar sm` + uploadedByName; [6] mono muted relative age (reuse the existing
  `relativeTime`/`shortDate` helpers from card.tsx before deleting it — move them to
  `src/lib/time.ts`). Row click → set `w` param (keep others). A row's `⋯` (`row-menu.tsx`, hover
  or focus visible) = Rename (inline input in the title cell, `walkthroughs.rename`), Mark
  resolved / Reopen (`walkthroughs.setStatus`), Open full page (Link to `/walkthroughs/:id`).
  Empty state: one muted line `Nothing here yet — record a walkthrough or upload one.` with the
  two links.
- `board-view.tsx`: `grid grid-cols-4 gap-3.5 px-7 pb-7`; each column `rounded-[10px] bg-secondary
  p-2.5 flex flex-col gap-2`, head `font-semibold flex items-center gap-2` with the group dot and
  muted count (Done: `clears in 30d` muted right). Cards `rounded-lg border bg-card p-2.5 flex
  flex-col gap-2 hover:border-foreground/25`: thumbnail `h-24 rounded-md object-cover` (skip for
  Done), title `font-medium leading-snug`, foot `flex items-center gap-2 text-xs
  text-muted-foreground`: `ProjectTag` (short: name only), score mono green (`7/8`), age, `Avatar
  sm` right. Click → `w`. Native HTML5 drag: cards `draggable` (member-only surfaces are all
  member here); drop on **Open** → `setStatus('open')`, on **Done** → `setStatus('resolved')`;
  the Needs-your-call and Processing columns are not drop targets (`dragover` not prevented).
  Optimistic: keep a local `pending: Map<id, status>` until the invalidated inbox lands.
- Pane host in `app.tsx`: when `w` is set render `<WalkthroughPane walkthroughId={w} onClose={…}/>`
  from `~/components/viewer/pane` (Wave 2B builds it; until then import type-check requires it —
  2A creates a placeholder `src/components/viewer/pane/index.tsx` exporting `WalkthroughPane`
  that renders a bordered `Loading…` column ONLY IF the file does not exist yet; 2B overwrites).
  Layout: `grid grid-cols-[minmax(0,1fr)_640px]` when open, list column keeps scrolling
  independently (`min-h-0 overflow-auto`), pane `border-l bg-card shadow-[-8px_0_24px_rgb(31_34_41/.06)]`
  sticky to the viewport height (`h-[calc(100vh-52px)] sticky top-[52px]`). Below `lg` the pane
  is a full-width overlay (`fixed inset-0 top-[52px] z-30`).

## Wave 2B spec — walkthrough detail pane + page

FILES: new `src/components/viewer/pane/{index.tsx (WalkthroughPane), detail.tsx (WalkthroughDetail),
header.tsx (DetailHeader), fields.tsx, key-points-checklist.tsx, result-card.tsx}`;
`src/app/walkthrough.tsx` (rewrite around WalkthroughDetail + deep tabs); `src/components/viewer/desk/{masthead.tsx, rail.tsx}` → delete;
`desk/overview-tab.tsx` (slim to the refining/open/resolved states without SectionHead/stamp),
`desk/review-actions.tsx`, `desk/conversation.tsx`, `desk/key-points.tsx`, `desk/status-chip.tsx`
(restyle to StatusPill visuals), `desk/recording-tab.tsx` etc. only for class-level restyle.

- `WalkthroughPane({ walkthroughId, onClose })`: fetches `walkthroughs.get` (poll while refining,
  same as the page), renders `DetailHeader` (pane mode: `×` close + `Open full page ↗` link) then
  `WalkthroughDetail` in a `overflow-auto` column; skeleton + error states.
- `DetailHeader({ walkthrough, mode: 'pane' | 'page', onClose? })`: `flex items-center gap-2 px-4
  py-2.5 border-b`: `Approve` (Button approve, ✓ icon; only member · in_review · has a result —
  same guard as `SignOff`) → `walkthroughs.setStatus resolved`; `Send back` outline → arms inline
  (reuse SignOff's send-back mutation + note input, rendered as a popover under the button);
  spacer; `Copy brief` ghost (while open, existing copy logic from masthead); `OverflowMenu`
  (existing); pane: `×`; page: nothing.
- `WalkthroughDetail({ walkthrough, urlByPath, mode })` — one scroll column `px-5 py-4 flex
  flex-col gap-5 max-w-[760px]`:
  1. Title: `h2 text-xl font-semibold` editable on click (existing rename mutation from masthead);
     the refine-suggested title row stays as a muted line with `use · dismiss`.
  2. `fields.tsx`: `grid grid-cols-[120px_1fr_120px_1fr] gap-x-2 gap-y-2.5 items-center text-[13px]`,
     keys `text-xs text-muted-foreground`: Status → `StatusChip` (the popover changer, restyled to
     pill); Project → the existing quiet project picker from masthead (rendered as `ProjectTag` +
     chevron); Recorded by → `Avatar sm` + name + `· {date, h:mm}`; Agent → latest result note's
     `authorName` + `· answered {relative}` or `—`; Parts → `{takes} · {mmss} · {frames} keyframes`;
     Intent → the existing intent pill control.
  3. `VideoStage` + its existing props exactly as the Recording tab wires it (multi-take via
     `useWalkthroughMedia`); NO transcript column in the pane (page Recording tab keeps it).
  4. `What you said` section (`h3 text-[13px] font-semibold`): `refineStatus==='running'` → the
     existing `ProgressHero` (restyled: pill + muted line); `digestMd` → `Markdown`; none → the
     `summaryMd` or the muted "run refine" / `ProUpsell` line as today.
  5. `Key points · N of M fixed` (`key-points-checklist.tsx`): rows `flex gap-2.5 py-2 border-t
     border-border/60`: icon circle 18px (`fixed` green filled ✓ · `partial` cobalt ring ◐ ·
     `skipped`/`not_applicable` muted – · no outcome: hollow ring), title `font-medium`, the
     outcome note muted xs below, mono cobalt `m:ss` seek chip right (existing onSeek). Severity
     shows as a 6px dot before the title (high red · medium ink · low muted) — from key-points.tsx.
  6. `Result from {authorName}` (`result-card.tsx`, only when a result note exists): bordered
     card: summary (`text-[13px]`), files as mono chips (max 6 + `+N more`), links row (PR ·
     `N evidence screenshots` → opens them as thumbs inline · `Full write-up` toggles `bodyMd`
     Markdown).
  7. `needs_info`: the agent's question card (ink left rule) + `AnswerForm` directly under it.
  8. `resolved`: a green `Done` pill line `Signed off {date} · clears {expiry}` + `Keep` link (from
     overview-tab) — no stamp.
  9. `Activity`: `Conversation` (restyled: avatars via `Avatar sm`, `who · time` header line
     `font-semibold text-xs`, system lines muted; comment box → a bordered composer with buttons
     row `Approve` (approve) · `Send back with notes` (outline) · spacer · `Record a reply` ghost
     (existing voice answer hook) — buttons only when the member can act; otherwise `Comment`).
- `walkthrough.tsx` page: normal app shell (sidebar not collapsed). Layout: `mx-auto max-w-[1100px]
  px-7 py-5`: `DetailHeader mode='page'` with a crumb above (`Walkthroughs / {project}`), then
  `Tabs`: Overview · Recording · Frames · Console · Brief · report.md · Tasks · Edit with AI (same
  gating as the old rail: Tasks for agent kind, Edit with AI agent non-child, Pro), no counts
  except Frames/Console. Overview = `WalkthroughDetail`. Other tabs = the existing tab components
  (hidden-not-unmounted rule for Recording stays). Human kind: header + FinalCut/CloudEditor as
  today. Child: header + TaskBrief + SignOff/AnswerForm + Conversation in the same column.
- Delete `rail.tsx`, `masthead.tsx`; move anything still needed (rename mutation, project picker,
  intent pill, copy brief) into `pane/header.tsx` / `pane/fields.tsx`.

## Wave 2C spec — extension panel

FILES: `extension/src/sidepanel/{styles.css, panel.css, Home.tsx, Parts.tsx, App.tsx, Outbox.tsx}`.
Tokens (`styles.css :root`): `--paper: #f7f8fa` (page behind), `--card: #fff`, `--ink: #1f2229`,
`--muted: #6b7280`, `--border: #e6e7eb`, `--input: #d9dbe1`, `--cobalt #2f56d8`, `--cobalt-wash
#e9edfb`, `--review #6b45d6`, `--review-wash #efe9fb`, `--approve #128a3c`, `--approve-wash
#e4f4ea`, `--danger #c8322b`, `--radius: 8px`, `--radius-sm: 6px`; type scale 12/13/14/16/20.
Panel body background `#fff`. Per the canvas "Recorder panel" artboard:
- Header 44px: wordmark (600 14px), right: `{space} · {project} ▾` muted 12px (opens the existing
  destination popover) + `Avatar`-style initials disc (from the linked account when known, else
  nothing); while recording: a red `REC m:ss` pill instead. Settings gear moves into the footer
  line.
- Home: full-width `Record a walkthrough` (40px, cobalt, radius 6); sections with 11px uppercase
  600 heads `Needs your call · N`, `In progress · N`, `On this machine · N`; rows 40px with a
  status pill dot at left, title 500 truncated, right mono score / muted stage / `1 part · not
  sent`; footer line `Open Handback ↗` left, `Settings` right (opens the drawer).
- Recording: mono clock 44px 500, muted line `N keyframes · N lines · tab audio on/off`, captions
  box (1px border radius 8, 15px text, the rough-captions note inside), `■ Stop` 40px black
  (`#1f2229`), the close-panel note in a `#f7f8fa` rounded box at the bottom.
- Review: header `← Walkthroughs` link left, `Discard` red right (arms inline as today); title
  input 17px 600; muted `N parts · m:ss`; each part a bordered card (thumb 56×34, `Part N · m:ss`
  500, muted status line, right: green ✓ disc when transcript ready or mono % + a 4px progress bar
  below while writing); `+ Record another part` 40px outline; footer: `This is` field row with
  the three chips (on = ink bg), `To` field row (destination trigger), `Send to Handback` cobalt
  40px, muted centred note `Uploads in the background once the transcript is done. You can close
  this.`; the transcript progress block (`.tprog`) is now the per-part bar — remove the footer one.
- Outbox rows: same idiom (13px, pills), `view your handback →` cobalt 600.
- No webfonts; keep every behaviour, message, and state from 1.11.0.

## Wave 3 specs — everything else (class-level restyles to the new idiom)

Common rules: no `font-display` serif looks (the token is Inter now, so the class is harmless but
sizes shrink: page h1 `text-xl font-semibold`, section h2 `text-base font-semibold`); replace
`.stamp` uses with `StatusPill`/plain pills; `SetupStep` numerals become plain `01`-less step
cards (`rounded-lg border p-5`, title 15px 600); every page gets `PageHeader` at the top instead
of a bespoke header; tables use the List idiom (13px, `th` xs muted, rows h-11, hover secondary);
cards `rounded-lg border bg-card p-5`; forms `Input` 32px + labels xs muted.
- **3A** landing + marketing: `src/app/home.tsx`, `src/components/landing/*`, `src/components/legal.tsx`,
  `src/app/docs.tsx`. Hero: left = `text-5xl font-semibold tracking-tight` headline (keep the
  copy), sub `text-lg text-muted-foreground`, two buttons; right = a CSS mock of the new List +
  pane (rebuild `mock.tsx` to the List/Detail artboards — sidebar, rows, a pane with a dark video
  block; no phone/paper motifs). How it works: three plain numbered cards in a row. Pricing:
  three bordered cards, the middle with a cobalt top border, no stamps. Final CTA: one bordered
  band. Docs/legal: `max-w-3xl`, h1 `text-2xl font-semibold`, h2 `text-base`, prose 15px.
- **3B** app pages: `projects.tsx` (a table like the List: swatch + name, space, walkthrough count,
  ⋯; create form in a card), `team.tsx`, `usage.tsx` (meters as thin bars), `upgrade.tsx` (three
  cards), `connect.tsx` + `recorder.tsx` (two step cards + reference sections), `setup-step.tsx`,
  `token-manager.tsx`, `pro-upsell.tsx`.
- **3C** intake/auth/admin: `upload.tsx`, `phone.tsx` + `components/phone/*`, `record.tsx`
  (chrome only — the recorder engine untouched), `sign-in/up`, `forgot/reset-password`, `join`,
  `watch.tsx` (centered column; title `text-xl font-semibold`), `admin/layout.tsx` sidebar to the
  same sidebar styles, `admin/shared.tsx` tables.
