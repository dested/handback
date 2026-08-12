# Handback — CliffNotes

> Living map of the project. Read this before any coding session.
> Last updated: 2026-08-06. Visual language → `ui.md` · why → `decisions.md` ·
> log → `updates.md`.
>
> **Naming:** the product noun is **walkthrough** (renamed from "gripe" 2026-08-01, owner's
> directive on record). Older log entries below say "gripe" historically — same object. The word
> survives in exactly two frozen places: the S3 key prefix and the `/api/ingest/gripes*` aliases.
>
> **Before opening sign-up to anyone you can't text: read
> [`plans/2026-07-30-go-live.md`](plans/2026-07-30-go-live.md)** — the audit of what's still
> missing (no password reset, unbounded presigned PUTs, no Web Store listing) and the Chrome Web
> Store submission notes.

> **Model note (2026-08-01): workspaces no longer exist.** A user has one implicit **Personal
> space** (rows with `teamId: null, userId: <owner>`) and zero or more **Teams** (`team` table,
> `ownerId` + `seatLimit`). The word "workspace" is banned from code and copy.
>
> **UI note (2026-08-03): space is an attribute, not a mode.** The header SpaceSwitcher is
> DELETED. The inbox spans every space (`walkthroughs.inbox`, client-side filters), Projects and
> Teams pages are cross-space, team creation lives on /team ("Teams"). `useActiveSpace` survives
> only as the destination default for /phone and /upload. Don't reintroduce a global "current
> space".

## What this is

The cloud half of the recording workflow: the place where recorded **walkthroughs** — narrated
screen recordings (a bug, review notes, a change request) produced by the bundled recorder
extension — are uploaded, reviewed by humans, routed to projects, and pulled by coding agents. A
walkthrough folder (report.md + MANIFEST.txt +
`rec-NN/` takes holding walkthrough.webm, keyframes, transcript, recording.json) is pushed via CLI
into S3 + Postgres; the web app is the review surface; an MCP server lets any Claude Code session
pull the queue. Pitch: **see it → say it → agent fixes it → a human signs off.**

Brand: **Handback** (handback.dev, renamed from Inloop 2026-07-30 — see
`plans/2026-07-30-handback-rename.md`) — the agent hands the work back; a human signs off.
Light-only editorial UI (`ui.md`), nothing orange, nothing dark, nothing visually inherited from
the Gripe extension.

## Quick Reference

- **Dev:** `bun run dev` → http://localhost:3995 (needs `.env`; see Env below)
- **Type-check:** `bun run typecheck` (`tsgo --noEmit`)
- **DB:** local Postgres 18 service; `bun run db:push` after schema edits (+`db:generate`)
- **E2E:** `E2E_DATABASE_URL=postgres://postgres:<pw>@localhost:5432/handback_test bun run test:e2e`
  (isolated DB + port 3100; screenshots committed; `test:e2e:update` to re-baseline)
- **Seed a dev login:** `bun cli/dev-bootstrap.ts [email] [password] [team]` → prints an `hb_` token
- **Push a walkthrough:** `bun cli/push.ts <folder> --server http://localhost:3995 --token hb_…`
  (`--team <teamId>` targets a team; default is the token owner's personal space)
- **Publish a recorder build:** `bun run publish:extension` (build → zip → upload) →
  `releases/recorder/`; `/recorder` serves the newest within 60s. Steps also run standalone:
  `build:extension` / `zip:extension` / `bun cli/publish-recorder.ts`
- **Chrome Web Store zip:** `bun run pack:store` → `extension/handback-recorder-store.zip`.
  Same build, but `scripts/pack-store.mjs` strips the manifest `key` (Web Store rejects it) into a
  staging copy — source/`dist` keep `key` so the local + self-hosted ID stays `gmggneb…ifdci`.
  **Stripping `key` means the Web Store assigned the store build its OWN id
  `bdhajcllnjcnihcbobhaecldgjlhfdhd` — NOT `gmggneb…`** (the pre-submission assumption was wrong;
  see decisions.md 2026-08-07). `src/app/recorder.tsx` now pings BOTH ids (`EXTENSION_IDS`) and
  links whichever answers. Also guards description ≤132 chars.
- **Web Store listing packet:** `extension/store-listing/` — `LISTING.md` (all form fields:
  summary, description, single purpose, per-permission justifications, data disclosures) + 4×
  1280×800 screenshots, 440×280 + 1440×560 promo tiles, 128 icon. Images are the real side-panel
  build framed on-brand, rendered by `scratchpad/render-store.mjs` (Playwright via `channel:chrome`
  over the `preview.mjs` harness). Dev console can't be automated — Chrome blocks scripting it.
- **Extension:** `bun run build:extension` (root) or `cd extension && npm run build` →
  load-unpacked `extension/dist`;
  `npm run preview` → http://localhost:8777/gallery.html (layout harness, no Chrome needed)
- **MCP (the real one):** `claude mcp add --transport http handback https://handback.dev/mcp --header "Authorization: Bearer hb_…"`
  — hosted, nothing installed; **/connect** in the app walks a user through it and mints the token
  inline. Local stdio fallback: `claude mcp add handback --env HANDBACK_TOKEN=hb_… --env HANDBACK_SERVER=<url> -- bun <repo>/cli/mcp.ts`
- **GitHub:** dested/handback (private; renamed from dested/inloop — redirect holds). **Deploy:
  https://handback.dev is live and serving** (`/healthz` 200, verified 2026-07-30 night);
  `inloop.dested.com` no longer answers — its TLS handshake fails, so treat it as gone. Drydock,
  auto-deploys on push to `main`. The rest of the re-wire checklist (S3 provisioning, SSM, cleanup)
  is still Sal's — `plans/2026-07-30-handback-rename.md`.

## Stack

Bun ≥1.3 · Express 5 + Vite SSR (one `server.ts` dev+prod) · React Router 7 (explicit
`RouteObject[]`) · tRPC v11 (`@trpc/tanstack-react-query`, `.queryOptions()`) · Prisma 7 + Postgres
(pg adapter) · better-auth (email+password) · Tailwind v4 tokens-in-CSS + shadcn-style primitives ·
AWS S3 (`@aws-sdk/client-s3`, presigned URLs) · `@modelcontextprotocol/sdk` (stdio MCP) ·
`mediabunny` (WebCodecs demux/mux — the human-handback editor's engine) · Playwright e2e. Inherited from dested/sal-starter — its conventions (server-only `./server/*`,
`~/*`→`src/*` alias, JSON-safe tRPC returns) still hold.

## Directory structure

```
server.ts               Express entry: /healthz, auth, ingest, tRPC, vite/SSR, 404s
server/
  env.ts                zod env: DATABASE_URL, BETTER_AUTH_*, AWS_REGION, S3_BUCKET, AWS keys,
                        GROQ_API_KEY / ANTHROPIC_API_KEY / RESEND_API_KEY + EMAIL_FROM (all
                        optional — each unset one disables its feature, nothing crashes),
                        ADMIN_EMAILS (comma-separated bootstrap platform admins)
  auth.ts               better-auth: email+password, autoSignIn, reset/verify email, rate limits.
                        No sign-up hook — a personal space needs no provisioning, it just exists
  trpc.ts               context (session from headers) + public/protectedProcedure
  access.ts             requireTeamRole / requireSpaceAccess(user, {teamId,userId}, atLeast) /
                        requireViewAccess (read-only platform-admin bypass) / memberTeamIds /
                        spaceId (teamId ?? userId — the S3 path segment) / slugify
  features.ts           entitlements: isPlatformAdmin (User.isAdmin OR ADMIN_EMAILS env),
                        teamHasFeature('team') checked at Team.owner, requireAdmin
  router.ts             THE tRPC API: teams (incl. get/transferOwnership), invites (seat-capped),
                        tokens (user-scoped, no team input), projects, walkthroughs — space inputs
                        are `teamId: string | null` (null = the caller's personal space)
  ingest.ts             Token-authed REST (Bearer hb_…): two-phase upload, size caps + per-org
                        quota, /transcribe and /polish; read side delegates to walkthroughs-api.
                        Every route registered under /walkthroughs* AND legacy /gripes* aliases
  walkthroughs-api.ts   THE agent-facing surface: token auth + list/get/setStatus. Shared by
                        ingest.ts AND both MCP servers so they can't drift. A token reaches its
                        owner's personal space + every team they're in; a platform admin's token
                        reaches everything. Items carry `space` (team name or "Personal")
  mcp.ts                Hosted MCP at /mcp — StreamableHTTP, stateless, hb_ bearer auth
  mcp-format.ts         Pure formatter for a walkthrough brief; shared with cli/mcp.ts
  storage.ts            S3: presignPut/Get, getObjectText, deletePrefix, key layout, isSafePath
  transcribe.ts         speech-to-text via Groq whisper-large-v3-turbo; segments in ms
  polish.ts             transcript cleanup via claude-haiku-4-5 — text only, timings untouched
  email.ts              Resend sender + reset/verify/invite templates; never throws
  ratelimit.ts          in-memory fixed-window limiter (one ECS task, so one process sees all)
  prisma.ts / logger.ts PrismaClient singleton · ANSI request logger
cli/
  push.ts               `handback push` — declare → PUT xN → finalize; `--team <id>` or personal
  mcp.ts                stdio MCP server — the LOCAL fallback; prod uses server/mcp.ts at /mcp
  dev-bootstrap.ts      idempotent dev seed: user (admin + team feature) + owned Team + token
  migrate-teams.ts      the one-shot workspace→teams data migration (raw SQL + S3 re-prefixing;
                        idempotent/resumable). ALREADY RUN on prod 2026-08-02 — keep for reference
  make-admin.ts         promote an account to platform admin by email (dev; prod uses ADMIN_EMAILS)
prisma/schema.prisma    better-auth models + Team(ownerId, seatLimit)/Membership/Invite/Project/
                        Walkthrough/Take/WalkthroughFile/ApiToken — Project/Walkthrough carry the
                        ownership pair `teamId | userId` (exactly one set; null teamId = personal)
src/
  app/
    routes.tsx          All routes + loaders (appLoader guards session, prefetches orgs.mine)
    layout.tsx          Shell: marketing chrome vs app chrome. SpaceSwitcher dropdown (Personal
                        first, then teams, "New team…" modal gated on teams.entitlements); the
                        Team nav renders only on a team space
    home.tsx            Landing page (assembles src/components/landing/*)
    sign-in/up.tsx      Auth cards (better-auth client flows)
    app.tsx             InboxPage: filters + walkthrough list. No provisioning state — Personal
                        always exists, the space is never null
    walkthrough.tsx     WalkthroughPage: the viewer (assembles src/components/viewer/*)
    projects.tsx        Projects list + create (origin-hints field removed from the UI)
    team.tsx            Members / Invites for team spaces (seat line, owner-only role select +
                        ownership transfer); a lone personal card otherwise. No guests
    connect.tsx         /connect — THE agent onboarding, one button + one paste: "Create my
                        command" mints an auto-named token and renders the real `claude mcp add`
                        with Copy in place (before the click the command is an inert dimmed
                        preview). Two numbered steps; tools, "Putting it to work", disconnect
                        instructions and "Your API tokens" (list + revoke, no create form) are
                        unnumbered reference below. Codex is a "soon" tab.
    record.tsx          /record — THE extension-free recorder: hero → live HUD → takes list +
                        destination + send. Resumes whatever is still in IDB on mount (a take
                        left mid-recording is rebuilt from its chunks). Nav label "Record"
    recorder.tsx        /recorder — THE recorder onboarding: install (STORE_URL now set → "Add to
                        Chrome" button; zip/load-unpacked collapses behind a disclosure), live
                        install ping across BOTH extension ids (`EXTENSION_IDS`: store + self-hosted),
                        one-click Link to whichever id answered (token minted + handed over, nothing
                        pasted). Two numbered steps; "Then just record" is unnumbered
    watch.tsx           /w/:shareToken — public watch page (walkthroughs.shared, rate-limited)
    phone.tsx           /phone — Handback on the phone: guide (per-OS: Android install+share,
                        iOS A2HS+Photos picker, desktop "open this on your phone") AND the
                        share-target intake: clips → in-browser distill → upload. Mints its own
                        hb_ token (localStorage handback.phone.token), silent re-mint on 401
    join.tsx            /join/:inviteId — peek + accept
    admin/              /admin — the platform-admin console, its own sidebar shell (nested routes):
                        layout.tsx (gate + sidebar frame), overview.tsx (counts, status mix,
                        latest accounts/uploads), users.tsx + user.tsx (search, team/admin
                        toggles, per-account detail: tokens, teams, walkthroughs by space),
                        teams.tsx + team.tsx (all teams w/ seats·storage; roster, invites,
                        projects, seat-limit editor, add/remove members + role switch + invite
                        revoke, delete team), walkthroughs.tsx (platform
                        feed, status filter, debug links), walkthrough-debug.tsx (full anatomy
                        of one walkthrough: the EXACT MCP brief via getWalkthroughDetail+
                        formatWalkthrough, frame-cap math, takes, all files incl. pending,
                        report.md, move-to-any-space control), usage.tsx (per-space bytes/
                        recordings vs quota), shared.tsx. user.tsx also carries delete account
    forgot-password.tsx /forgot-password — same answer whether or not the account exists
    reset-password.tsx  /reset-password?token=… — the link better-auth emails
    privacy.tsx         /privacy — what's collected, where it lives, subprocessors
    terms.tsx           /terms — alpha status, recording consent, Arizona law
  components/
    logo.tsx            ReturnMark + Wordmark — THE identity (the returning stroke), never redraw
    setup-step.tsx      the numbered editorial Step shared by /connect and /recorder, plus
                        `autoTokenName(kind, ua, now)` — the name both pages mint under so
                        neither has to ask for one
    legal.tsx           LegalPage/Section/Terms/Notice — shared chrome for /privacy + /terms
    ui/                 button, card, input, label, sidebar (shadcn new-york style, no asChild;
                        sidebar is hand-rolled — no radix — collapse persisted, mobile overlay)
    phone/              guide, clip-list (+AddClips/voice note), destination (one grouped
                        control), stages (distill progress rows) — /phone's pieces
    landing/            hero, how-it-works, distill, walkthrough-manifest, agent-view, pricing,
                        final-cta · demo-shot.tsx (a keyframe as SVG) + demo-data.ts (the one
                        demo walkthrough) + mock.tsx (Pane/ContactSheet/Filmstrip/PlayerStrip/
                        RecorderPanelMock — the hero's extension panel)
    viewer/             take-section, filmstrip, transcript-panel, events-panel, report-panel,
                        walkthrough-header, walkthrough-controls, status-control, types, format,
                        use-copy · final-cut.tsx (the human handback's player: final.mp4 +
                        transcript.json, shared by viewer and /w) · share-control.tsx (mint/copy/
                        revoke the /w link)
    edit/               editor.tsx — THE transcript-first editor for human handbacks: delete a
                        line to cut its seconds, silence gap chips (veto-able), Tighten slider,
                        EDL preview player (skips cuts live), take ↑/↓ reorder. No timeline
                        selection — that stays dead (decisions.md 2026-08-01 + 2026-08-12)
  lib/
    space.tsx           SpaceProvider/useActiveSpace — Personal + teams; active space in
                        localStorage `handback.activeSpace` ('personal' | teamId); never null
    pwa.ts              SW registration, deferred install prompt, share-stash pickup
                        (peekSharedMedia reads WITHOUT deleting; clearSharedMedia is the only
                        delete, called once the walkthrough is uploaded or discarded)
    capture/            THE phone distill pipeline — a deliberate PORT of the extension's
                        (see decisions.md 2026-08-02): frames (dedup+budget), grids, audio→WAV,
                        transcribe/polish clients, report/MANIFEST/recording.json builders,
                        two-phase upload (XHR PUTs — byte progress + 3-try retry), distill.ts
                        orchestrator, pending.ts (the crash-survivable run: IDB 'handback-phone').
                        Public surface: types/probe/context/distill/pending. Mirror any extension
                        pipeline change here. **Its generic half is extracted to
                        github.com/dested/video-to-prompt (G:\code\video-to-prompt) and will
                        eventually be consumed from there instead — until then any pipeline change
                        mirrors THREE ways: here, extension, library (decisions.md 2026-08-06)**
                        live.ts / live-store.ts / live-upload.ts are the WEB RECORDER (/record):
                        the extension's capture engine ported to a page (no content script, so no
                        events/pointer/click+nav frames), its IDB `handback-web-recorder`, and the
                        take-set → file-set → upload tail. live.ts imports the dedup constants and
                        `cellDiff` from frames.ts — one copy on this side of the repo
    capture-token.ts    useCaptureToken(kind) — the mint/re-mint-on-401 hb_ token helper shared by
                        /phone, /upload and /record (was copy-pasted in each)
    edit/               THE human-handback edit engine (web-only, NOT part of the mirrored
                        distill pipeline): edl.ts (EditState = takeOrder + cuts; derived
                        EditSegment[] is order-capable — full reorder is legal downstream even
                        though the UI only removes + reorders takes), silence.ts (RMS envelope
                        ∩ no-words → proposed cuts), remux.ts (mediabunny stream-copy so cueless
                        MediaRecorder webm can seek), render.ts (EDL → H.264+AAC final.mp4 via
                        mediabunny/WebCodecs, hardware encode, odd-dimension canvas fallback)
    trpc.tsx / auth-client.ts / utils.ts
  styles/app.css        ALL design tokens (light only) + .rule/.stamp/.ink-underline utilities
public/                 manifest.webmanifest (PWA: standalone, share_target, shortcut) · sw.js
                        (share-POST stash ONLY — caches nothing, keep it that way) · icons/
                        (return-mark PWA icons, regenerate via `node cli/make-pwa-icons.mjs`)
e2e/                    smoke.spec.ts + committed screenshots (landing, sign-up, app flow)
index.html              SSR template; Google Fonts (Fraunces/Libre Franklin/IBM Plex Mono);
                        manifest + apple-touch-icon links
Dockerfile              DRYDOCK-OWNED — regenerated on every wire/re-wire, never hand-edit
drydock.yaml            DRYDOCK-OWNED — the deploy manifest (portal is source of truth)
.github/workflows/
  drydock.yml           DRYDOCK-OWNED — OIDC build → ECR → predeploy → ECS deploy on push to main
extension/              Handback Recorder — the Chrome MV3 extension (own npm workspace)
  public/manifest.json  MV3: sidePanel + activeTab/scripting/storage/tabs; hotkey Alt+Shift+D
  src/lib/              Shared contracts: types, messages (worker protocol), timeline math,
                        db (IndexedDB 'handback-recorder'), report.md builder, upload (to /api/ingest
                        — XHR PUTs: live byte progress + 3-try retry, mirrors src/lib/capture/upload.ts),
                        context (GET /api/ingest/context), walkthroughs (GET /api/ingest/walkthroughs
                        — the workspace's queue, read back into the panel's home screen)
  src/background/       Service worker: hotkeys, dock routing, IndexedDB writes, strip docking
  src/content/          On-page dock (d/c/s keys), ink drawing, click ripples, telemetry;
                        injected.js relay
  src/sidepanel/        Panel app: Home.tsx (the nothing-open screen = the workspace: destination
                        row + switcher, the workspace's queue with status/project filters, sessions
                        still on this machine), recorder (getDisplayMedia incl. system audio + raw
                        mic, Web Audio mix + dedup — see the audio gotcha), transcription
                        (transcribeCloud.ts → the workspace; transcribeWorker.ts → on-device),
                        polish.ts (the cleanup pass, after transcription), Timeline editor
                        (a scrubber — see the gotcha), grids contact sheets, App.tsx orchestration
  scripts/              make-icons, copy-ort, prune-dist, preview.mjs + preview/ (layout harness)
```

## Routes / URLs

| Route | Serves | File |
| --- | --- | --- |
| `/` | Landing (marketing) | `src/app/home.tsx` |
| `/sign-in` · `/sign-up` | Auth | `src/app/sign-{in,up}.tsx` |
| `/join/:inviteId` | Invite accept | `src/app/join.tsx` |
| `/forgot-password` · `/reset-password` | Password recovery (better-auth emails the link) | `src/app/{forgot,reset}-password.tsx` |
| `/privacy` · `/terms` | Legal pages (linked from the marketing footer) | `src/app/{privacy,terms}.tsx` |
| `/app` | Inbox — ALL spaces, filter rail (status/space/project/search over one `walkthroughs.inbox` query); rows rename inline (hover-revealed "Rename", stretched-link overlay so the row still navigates) via `walkthroughs.rename` | `src/app/app.tsx` + `src/components/inbox/rail.tsx` |
| `/upload` | Desktop intake: drop a clip → distill → upload (reuses capture lib + phone components) | `src/app/upload.tsx` |
| `/walkthroughs/:walkthroughId` | The viewer (`/gripes/:id` 302s here) | `src/app/walkthrough.tsx` |
| `/projects` · `/team` | Projects (ALL spaces, grouped; create w/ space select) · "Teams" — every team (roster/invites/seats per team, New team lives HERE) | `src/app/{projects,team}.tsx` |
| `/connect` | Connect a coding agent — one button mints a token and fills in `claude mcp add`; tokens/disconnect are reference below | `src/app/connect.tsx` |
| `/record` | **Record with no extension** — live `getDisplayMedia` capture in the page. Kind picker: **for an agent** (distill pipeline) or **for a person** (pristine 30 fps capture → transcript-first editor → mediabunny MP4 render → share link). Multi-take, crash-recoverable, optional always-on-top Document PiP HUD | `src/app/record.tsx` |
| `/w/:shareToken` | **Public watch page** for a shared walkthrough — no session, the token IS the credential; plays `final.mp4` + transcript (falls back to takes) | `src/app/watch.tsx` |
| `/recorder` | Install + one-click-link the extension (detects install, mints token, handshake). Nav label is **"Extension"**; the nav's "Record" is `/record` | `src/app/recorder.tsx` |
| `/phone` | Phone guide + share-target intake — OS-recorded clips distilled in-browser and uploaded | `src/app/phone.tsx` |
| `POST /share-target` | PWA share sheet target — SW intercepts + stashes; Express fallback 303s to /phone | `public/sw.js` · `server.ts` |
| `/admin` (+ `/users[/:id]`, `/teams[/:id]`, `/walkthroughs`, `/usage`) | Platform-admin console — sidebar shell, overview stats, users + drill-down, teams + seat editor, platform feed, per-space usage (admins only; nav link hidden otherwise) | `src/app/admin/*` |
| `/dashboard` | redirect → /app (legacy) | `routes.tsx` |
| `/healthz` | DB probe | `server.ts` |
| `/api/auth/*` · `/api/trpc/*` | better-auth · tRPC | `server.ts` |
| `/api/ingest/*` | Token-authed REST (below) | `server/ingest.ts` |
| `/mcp` | **Hosted MCP** (POST only, `hb_` bearer). What agents connect to | `server/mcp.ts` |
| `/download/recorder` | The extension zip — **session-gated**, 302s to a presigned S3 GET | `server.ts` |

### /api/ingest (Bearer `hb_…` token; org comes from the token)

| Endpoint | Does |
| --- | --- |
| `GET /context` | Who the token speaks for: `{ user, personal: {projects}, teams: [{id,name,slug,projects}] }`. Feeds the recorder's destination picker |
| `POST /walkthroughs` | Declare: metadata + file list → rows + presigned PUT per file. Optional `teamId` targets a team (member-validated; absent = personal), optional `projectId` pins a project in that space (else originHints route it). Re-declaring an existing (space, slug) deletes the old walkthrough + S3 prefix first |
| `POST /walkthroughs/:id/finalize` | Marks files uploaded + sets `finalizedAt` (list only shows finalized) |
| `GET /walkthroughs` | List for agents (MCP `list_walkthroughs`): everything the token reaches, `?team=personal\|<id>` filters. Platform-wide when the owner is a platform admin |
| `GET /walkthroughs/:id` | Detail + `reportMd` text + presigned GET for every file (MCP `get_walkthrough`) |
| `POST /walkthroughs/:id/status` | open / in_review / resolved (MCP `set_walkthrough_status`) |

All five walkthrough routes also answer under the legacy `/gripes*` spellings — same handlers,
same rate-limit keys — because shipped recorders ≤1.2.x still post them. Don't remove the aliases
until no old install remains.
| `POST /transcribe` | 16 kHz mono WAV body in, `{segments:[{t,d?,text}]}` out. Stateless — the recorder chunks and offsets. 503 when `GROQ_API_KEY` is unset |
| `POST /polish` | `{lines:[{text}], context:{origin,title,errors}}` in, the same number of lines back with product nouns spelled right. Text only — no timings cross this boundary. 503 when `ANTHROPIC_API_KEY` is unset |

Every route is rate-limited: one per-IP limit ahead of authentication, then a per-token limit per
route (`server/ratelimit.ts`). Declare also enforces 512 MB/file, 2 GB/walkthrough, 20 GB + 500
walkthroughs per org, and the presigned PUT signs `ContentLength` so S3 rejects an upload that
doesn't match.

## Data model (Postgres via Prisma)

better-auth's User/Session/Account/Verification, plus: **Team** (`ownerId` — authoritative,
transferable; `seatLimit` default 5, enforced on invites/accept; created from the switcher behind
the `team` entitlement; the owner also holds a Membership row role `admin`, effective role is
computed) ← Membership (role admin/member, unique team+user — no scope, no guests) · Invite (id
IS the join-link token, 7-day expiry, team-only) · Project and **Walkthrough** both carry the
**ownership pair `teamId | userId`** — exactly one set, `userId` = someone's personal space; slug
uniqueness per space is **code-enforced** (findFirst + suffix loop; no DB unique — Prisma can't
partial-index a nullable pair). Walkthrough keeps slug/status/finalizedAt/errorCount/droppedCount
semantics ← Take (rec-NN) + WalkthroughFile (path unique per walkthrough; S3 key =
`orgs/<spaceId>/gripes/<walkthroughId>/<path>` where spaceId = teamId ?? userId — both segments
frozen) · ApiToken (**user-scoped**, no team column; sha256 hash only; `hb_` prefix; lastUsedAt
stamped on ingest auth).

## Storage (S3)

Bucket **handback-files** — **live** (us-west-2, account 114394156384, profile `dested`), created
by hand 2026-07-30 night, not by Drydock: public access fully blocked, CORS allowing
handback.dev / www / `http://localhost:3995` / `http://localhost:3210` / `chrome-extension://*`.
Its writer is IAM user **`handback-app`** with one inline policy `handback-files-rw` scoped to
that bucket and nothing else (verified: it gets AccessDenied on any other bucket). The old pair
`inloop-files` + `inloop-app` is **deleted** — bucket emptied (234 objects, ~51 MB, the two test
gripes) and removed, user and access key removed. Anything that still remembers an
`inloop-files` URL is dead; the presigned links inside an old `get_gripe` response 404.
Everything moves via presigned URLs (PUT 1h, GET 1h) — `gripes.get` presigns every file in one
call so the viewer never round-trips per frame.

## Deploy (Drydock — handback.dev is serving; re-wire partly done)

**State (2026-07-31):** read the migration warning below before anything else — prod's DB is a
release ahead of prod's container. Deploy target confirmed: project/db are **still named `inloop`**.

**State (2026-07-30 night):** **https://handback.dev answers** — `/healthz` returns 200 — and
`inloop.dested.com` no longer completes a TLS handshake. So the domain half of the move has
landed. S3 is settled too: `handback-files` + `handback-app` exist and prod points at them (see
Storage), done by hand rather than by Drydock — so `G:\code\drydock\plans\2026-07-30-s3-buckets.md`
no longer has anything to provision here. SSM (`/drydock/inloop/*`) carries the new bucket and
keys, applied 2026-07-30 night. The rest of Sal's checklist (zone + delegation, project
recreate, cleanup) lives in `plans/2026-07-30-handback-rename.md`.
`Dockerfile`/`drydock.yaml`/`.github/workflows/drydock.yml` may still carry inloop names — Drydock
regenerates all three on re-wire, so don't hand-fix them.

Deployed by **Drydock** (`G:\code\drydock`, local portal at http://localhost:4400) onto the shared
ARM EC2 box: Caddy auto-TLS, shared Postgres container, Route53 A record → the box's EIP
`52.24.94.83`. **Push to `main` = deploy** — the generated workflow builds an arm64 image via OIDC
(no AWS keys in GitHub), runs `bunx prisma db push` as a one-off pre-deploy task, then rolls the
service.

| Setting | Value |
| --- | --- |
| domain | **`handback.dev`** — live and serving |
| project / db name | **still `inloop`** — confirmed 2026-07-31 from AWS: ECS service `drydock-inloop` (cluster `drydock`), SSM prefix `/drydock/inloop/*`, Postgres database `inloop`. `handback` was intended but the re-wire never happened, so the name only lives in the domain. Renaming it is a portal job (and would move the SSM prefix + DB), not a repo edit. |
| container port | 3995 (`PORT` is injected; `server.ts` reads it) |
| size | `m` — 192 MiB reservation / 576 MiB hard limit |
| build / start | `bun run build` / `bun run start` |
| predeploy | `bunx prisma db push` (no `--accept-data-loss`, on purpose) |

> **PROD MIGRATED (2026-08-02).** `cli/migrate-teams.ts` + `db push` ran against prod (org→team,
> tokens de-org'd, guest promoted; audit after: 16 walkthroughs / 1381 files / 1.45 GB, zero
> orphans). It ran *before* the code deploy — dev `.env` was pointing at prod again — so prod
> 500'd for signed-in users until commit `3207be1` rolled. **The `.env` prod flip is a standing
> hazard: it has now bitten twice. Check `DATABASE_URL` before ANY db/migration command.**

**Reaching the prod DB** (there is no public port — it's `172.17.0.1:5432` on the Docker bridge):
the EC2 box is SSM-managed, so `aws ssm send-command --instance-ids i-082378e80e708f4f2
--document-name AWS-RunShellScript` → `docker exec ecs-drydock-system-postgres-1-postgres-…
psql -U drydock -d inloop`. The superuser role is **`drydock`**, not `postgres`, and local socket
auth is trust, so no password is needed (keep it that way — an SSM command's text is retained in
the console). ECS exec is **disabled** on the service, so the container itself is not shell-able.

**Env lives in SSM**, not `.env`: `DATABASE_URL` + `BETTER_AUTH_SECRET` are generated by Drydock,
`BETTER_AUTH_URL` must equal the serving origin (→ `https://handback.dev`), and `AWS_REGION` /
`S3_BUCKET` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` come from the S3 provisioning (see
Storage). Change any of them in the portal (Project → Environment) and hit **Apply + redeploy** —
CI's task-def registration copies the *previous* revision's secret list, so a new key never
reaches the container on a plain push.

## Gotchas & hard rules

- **ui.md is law**: light only, no dark mode, no orange. Status colors fixed (open=cobalt,
  in_review=violet, resolved=green).
- **No *mobile* browser can capture the screen — settled, don't revisit.** `getDisplayMedia` is
  `version_added: false` on Chrome Android / Safari iOS / everything mobile (checked 2026-08-02).
  /phone therefore rides the OS screen recorders; any "record live in the PWA" idea is dead on
  arrival. **This is a statement about phones, not about the API**: a desktop tab has had screen
  capture for years, which is what `/record` is (`src/lib/capture/live.ts`, 2026-08-12). Don't read
  this bullet as "the website never captures". `src/lib/capture/` is a deliberate duplicated port of the extension pipeline —
  **change the pipeline anywhere, mirror it everywhere: capture/, the extension, AND the
  extracted dested/video-to-prompt library** (decisions.md 2026-08-02 + 2026-08-06) —
  with ONE legitimate divergence: candidate cadence. The extension samples live at 500 ms
  (free); the phone seek-steps at a 1 s floor (each candidate costs a real decode on iOS), and
  its MANIFEST says "1s candidates" accordingly. Phone keyframes are also **best-effort**: a
  frame-extraction failure degrades the take to zero frames (video + transcript still ship),
  never fails the run.
  The SW caches nothing and must stay that way (SSR staleness > offline); its share stash
  (IDB `handback-share`/`pending`/`current`) is a contract between `public/sw.js` and
  `src/lib/pwa.ts` — change both together. `externally_connectable` etc. are unaffected; the
  phone token lives in `localStorage handback.phone.token` and re-mints itself on 401.
- **The web recorder is the extension's engine minus the content script, and the gap is a fixed
  list.** `src/lib/capture/live.ts` is a port of `extension/src/sidepanel/recorder.ts` — same picker
  constraints, same 64×64 dedup, same Web Audio mix + mic-only shadow, same length-scaled
  `frameBudget`, same chunk-to-IDB persistence. What a page cannot have, because it comes from
  scripts injected into the *recorded* origin: console/network `events` (so `errorCount` is always
  0 and polish gets no error context), `pointer` on frames and the crosshair drawn from it, and the
  `click`/`nav` forced keyframes — leaving `start`/`change`/`beat`, exactly /phone's set. **A fourth
  client now mirrors the pipeline**: any dedup/report/upload change lands in `src/lib/capture/`, the
  extension, the video-to-prompt library, AND `live.ts` — though `live.ts` at least imports its
  dedup constants and `cellDiff` from `frames.ts` rather than copying them, so keep that.
  Its IDB is **`handback-web-recorder`**, deliberately not the extension's `handback-recorder`:
  same origin, and the extension's worker owns that schema.
- **A clip that reached /phone must be un-losable short of explicit discard** (2026-08-02, after
  a real walkthrough died mid-distill). Two stores hold it and **neither is consumed by reading**:
  the share stash (`handback-share`, written by the SW) and the pending run
  (`handback-phone`/`run`/`current`, written by `src/lib/capture/pending.ts` on every intake change
  and at send start). Both are deleted in exactly two places — after `finalize` returns, and on an
  explicit discard/start-over. A share auto-starts the run (sharing *was* sending; a second
  "Send to Handback" button is what made people think it had already gone), so the working screen
  carries the `to {space} · {title}` line and Cancel is the way back to intake. A reload with no
  `?shared=1` offers **resume**, never auto-resumes — after a crash the person decides. Don't add
  a read path that deletes, and don't make either store the sole copy.
- **The rename has two frozen edges.** S3 keys stay `orgs/<orgId>/gripes/<id>/…`
  (`server/storage.ts` — renaming the prefix orphans every uploaded object) and
  `/api/ingest/gripes*` aliases stay registered (Recorder ≤1.2.x posts them). MCP tools have NO
  old-name aliases — old report.md files that say `get_gripe` predate the rename. The extension's
  internal identifiers are still `Gripe*` on purpose (only its emitted strings changed); rename
  them in a quiet moment, not while panel work is in flight. **But the extension's ingest *client*
  must speak the server's current *field* names** — `upload.ts` kept reading `gripeId` off the
  declare response after the server renamed it to `walkthroughId`, so finalize POSTed to
  `/gripes/undefined/finalize` and 404'd every extension upload until it was fixed 2026-08-02
  (the CLI was fine — it read `walkthroughId`). Internal `Gripe*` type *names* are free; the JSON
  keys crossing the wire are not.
- **A personal space is the absence of a team, not a row.** `teamId: null` in a tRPC input means
  "the caller's own personal space" and nothing else — it cannot be spoofed (server/router.ts
  `toSpace`). Nothing provisions it, nothing can fail to provision it, and it takes no invites by
  construction. `teams.create` still requires the `team` entitlement (platform admins pass).
  Exactly one of a Walkthrough/Project's `teamId`/`userId` is set — a code invariant, not a DB
  constraint; keep it true in every new write path.
- **Dev FOUC fix lives in server.ts, not index.html.** Dev injects
  `<link rel="stylesheet" href="/src/styles/app.css?direct">` after `transformIndexHtml`
  (`?direct` = compiled CSS, not a JS module). Prod builds emit a hashed CSS link and don't need
  it — don't move the link into index.html or prod double-loads the sheet.
- **The landing page's screenshots are live DOM, not images.** One demo gripe (`demo-data.ts` —
  a promo code that applies to nothing) runs through every section; a keyframe is
  `CheckoutShot` in `demo-shot.tsx`, an SVG so it survives both a 3×3 contact-sheet tile and the
  hero. Inside a frame the recorded app is **grey** and only the reviewer's cobalt (pointer
  crosshair, ink) has colour — keep that, it's what makes nine tiles readable at thumbnail size.
  The contact sheet is the one black surface on the site, because it is a photograph of a JPEG.
- **Landing grid items need `min-w-0`.** Grid items default to min-content, and the mock panes
  contain `<pre>` and mono lines that never wrap — a missing `min-w-0` drags the whole page
  wider than a phone (doc `scrollWidth` 510 at a 390 viewport). Re-check `scrollWidth` at 390
  after touching any landing grid.
- **A gripe's `errorCount` is not "how much happened".** `PageEvent` is only `error | warn |
  network` — the console/fetch tap in `extension/public/injected.js`, forwarded only while a
  recording is live (`content/index.ts:93`), and `console.log` is never captured. Clicks and
  navigation are NOT events: they become forced keyframes (`recording:force`), so a busy
  walkthrough legitimately reads `errorCount: 0` with a high `frameCount` — that pairing is
  evidence the tap worked, not that it died. `droppedCount` is errors that fired on a tab other
  than the recorded one (`inScope()` in `recorder.ts`), which is what separates "the page was
  clean" from "we weren't watching". The field was called `eventCount` until 2026-07-31 and read
  as an interaction counter to every agent that saw it; **ingest still accepts a bare `eventCount`**
  from Recorder ≤1.1.0 and stores it as `errorCount`, so don't delete that fallback until the
  Web Store build is past 1.1.0 everywhere.
- **A take's audio is three sources, two artifacts** (extension 1.7.0, 2026-08-12): the webm's one
  audio track is app/system audio (getDisplayMedia `audio` + `systemAudio:'include'`) mixed with a
  RAW mic (AEC/NS/AGC off, so the room and second voices survive — headphones assumed) through a
  Web Audio graph, because MediaRecorder silently records only the first audio track it's handed.
  Transcription must NOT hear that mix: takes with system audio run a mic-only shadow recorder
  whose chunks (`<id>:micchunk:*`) are crash-persisted like the video's and assembled into
  `<id>:mic`, which `runWhisper` prefers over `<id>:video`. Keep the three lifecycles in sync —
  delete (db.ts), recover (background), finish/cancel (recorder.ts) all know both chunk families.
  Chrome only offers "share audio" on tab/entire-screen pickers (never a window) and its absence
  is silent — so the PickGate 'choosing' screen carries a dark ShareDialogMock portrait pointing
  at the switch, and the HUD's app-audio line is 3-state (`none`/`silent`/`live`, an analyser tap
  on the sys source): "shared but silent" = Windows is playing the sound on a device Chrome isn't
  looping back. Don't remove either tell.
- **Leaving a walkthrough is not ending one.** The panel has exactly two states now — the home
  screen and the open walkthrough — and `browsing` (App.tsx) is which one you're looking at. It is
  view state only: the session stays active in the worker, so a take started from the home screen
  still lands in it and reopening the panel lands back in the work. **Discard** is the only
  destructive control in the panel: it arms, names how many takes it will take with it, deletes
  session + takes + blobs, and then forces `browsing` back on, because the worker's `resumeOpen`
  fallback would otherwise drop the human into an unrelated walkthrough. Don't add a second list
  of walkthroughs anywhere — the foldable "earlier walkthroughs" one was removed for exactly that
  reason, and `Home.tsx`'s `.lrow` list is the one.
- **The panel's home screen is a read of the workspace, and nothing on it is load-bearing.**
  `Home.tsx` pulls `GET /api/ingest/walkthroughs` (and leans on the context fetch App already runs)
  to show the queue, the projects and the workspace switcher. Every failure degrades to one line
  of text with a retry — an unreachable or unlinked workspace must still leave a recorder you can
  record with, and the local session list is drawn either way. Session takes/durations come from
  the **`sessions:summary`** message, deliberately *not* a `state:get` field: `state:get` answers
  every broadcast and this walks every take's frame metadata.
- **The keyframe cap is length-scaled, and it lives in two places.** `frameBudget(durationMs)`
  (`extension/src/sidepanel/recorder.ts`) is 40 frames/min clamped to **[150, 600]** per *take* —
  applied once in `finish()`, after dedup, as a **uniform** thin with nothing carved out of it
  (the `reason === 'mark'` exemption went with the mark feature, 2026-08-01); survivors are
  renumbered ascending (`t` survives, so transcript citations stay valid). It was a flat 150 until 2026-07-31. Server-side, `briefFrameLimit()`
  (`server/mcp-format.ts`) caps how many frame URLs the agent's brief *inlines* — 8/min clamped to
  [30, 120] — which is a display cap only: `gripes.get` presigns every frame regardless. Raising
  either has real cost: a frame is ~200–400 KB, against 2 GB/gripe and 20 GB/org.
- **Renaming a column is a SQL job, not a `db push` job.** Predeploy runs `bunx prisma db push`
  **without** `--accept-data-loss` on purpose, so any drop stalls the deploy. Rename in place first
  (`ALTER TABLE "gripe" RENAME COLUMN "old" TO "new"`), then push — it sees no drift. Remember
  `handback_test` needs the same statement or the e2e suite 500s.
- **Two MCP servers, one implementation.** `server/mcp.ts` (hosted, `/mcp`) and `cli/mcp.ts`
  (stdio) both go through `server/gripes-api.ts` + `server/mcp-format.ts`. Change what an agent
  sees in those two files, never in one server. `/api/ingest`'s read routes are thin wrappers over
  the same functions.
- **`/mcp` is stateless and POST-only.** Fresh `McpServer` + transport per request
  (`sessionIdGenerator: undefined`, `enableJsonResponse: true`); GET/DELETE answer 405. Don't add
  a tool that streams or sends server-initiated notifications without revisiting that — there's no
  session to send them on. It's mounted before the SSR catch-all on purpose; move it after and a
  JSON-RPC client gets a page of HTML.
- **The inbox's connect banner is gated on `tokens.connection.lastUsedAt`**, which
  `authenticateToken` stamps on every ingest/MCP call. So "has an agent connected?" means "has a
  token ever completed a request", not "does a token exist". `tokens.connection` takes no input
  now — tokens are account-wide.
- **An invite must survive the auth round trip.** `/join/:id` is the only page a signed-out stranger
  lands on; its auth links carry `?invite=<id>`, `/sign-up` and `/sign-in` return to
  `/join/:id?accept=1`, and `redirectIfSignedIn` (routes.tsx) honours the same param. Drop any one
  of those and the account gets created while the invitation is orphaned — the failure is silent,
  because sign-up itself succeeds. Accept is idempotent, so a stale `?accept=1` is harmless.
- **An addressed invite is bound to its address; an unaddressed one is an open link.** `invites.create`
  with an `email` sends mail and `invites.accept` 403s anyone signed in as someone else (invite mail
  gets forwarded). Omit the email and the link is the whole credential — that's the deliberate
  copy-a-link path, and it is *not* rate-limited by address. Keep both branches when touching accept.
- **`./server/*` never imports into `src/*`** except `import type` (starter rule; leaks secrets).
- **tRPC returns must be JSON-safe** — Dates → ISO strings at the procedure, `bytes` BigInt →
  Number, or SSR/hydration markup diverges.
- **better-auth origin check**: sign-in fails with "Invalid origin" unless `BETTER_AUTH_URL`
  matches the URL you're browsing on. Dev on a non-3995 port needs
  `PORT=X BETTER_AUTH_URL=http://localhost:X bun server.ts`.
- **Ingest paths are validated** (`isSafePath`) — never widen it casually; those strings become S3
  keys.
- **Re-pushing a slug replaces the gripe wholesale** (rows + S3 prefix). Viewer links keep working
  only because gripe ids change — don't cache ids across re-pushes.
- **`gripes.list` only shows finalized gripes**; a declare without finalize is invisible in the UI
  by design.
- **Raw API tokens are shown once** — only the sha256 lands in the DB. The dev-bootstrap script
  prints a fresh one each run. This is *why* /connect and /recorder never ask "do you already have
  one?": nobody can answer it, so both pages just mint a fresh token on the single click and let
  the old ones sit until they're revoked. Don't reintroduce a token-inventory prompt on the primary
  path — that phrasing is what got the flow rewritten on 2026-08-01. `tokens.create` returns
  `{ token, id, name }` so the caller can offer `tokens.rename` without a `list` round trip.
- **The roster is admin-only** (2026-07-31): `teams.members` requires `admin` — plain members get
  FORBIDDEN and the Team page doesn't render the tabs for them. Don't add a procedure that returns
  member names/emails without that gate; the only sanctioned leak is a walkthrough's
  `uploadedByName`. Ownership is `Team.ownerId` (never a stored role) — effective role is computed,
  and `teams.transferOwnership` is the only way it moves.
- **Admin deletes are S3-first, and both are prefix wipes.** `admin.deleteUser` refuses self,
  platform admins (demote first) and team owners (transfer first — the DB's `Restrict` on
  `Team.ownerId` backs it), then wipes `orgs/<userId>/` and deletes the row (cascades take
  memberships/tokens/personal content; team uploads survive with `uploadedById` nulled).
  `admin.deleteTeam` is the same shape on `orgs/<teamId>/`. S3 goes first on purpose: a failed
  wipe leaves the account/team intact rather than orphaning unlistable objects.
- **`walkthroughs.move` is copy → flip → delete, in that order.** Source and destination are
  spaces (Personal included); the caller must hold both. Objects are copied server-side
  (`copyObject` — bytes never cross the container), then the row flips (ownership pair +
  `projectId: null` + slug suffixed if taken), then the old prefix is deleted best-effort. A crash
  mid-copy loses nothing; after the flip, worst case is orphaned source objects. Destination quota
  reuses ingest's exported `SPACE_QUOTA_BYTES`/`SPACE_MAX_WALKTHROUGHS` — quota is per space.
  The core lives in `relocate()` (router.ts), shared with `admin.moveWalkthrough` (any team, or
  the uploader's personal space; quotas still apply — an admin move is not a quota bypass).
  **`relocate` refuses unfinalized walkthroughs**: pending file rows can hide real S3 objects
  the copy would skip and the source wipe would destroy — delete is their only exit.
  `/admin/walkthroughs/:id` renders the exact agent brief through the same
  `getWalkthroughDetail` + `formatWalkthrough` pipeline MCP uses — change those and the debug
  page follows for free; never re-implement the brief for display.
- **Every `hb_` token is account-wide; a platform admin's is platform-wide** (2026-08-01).
  `TokenAuth` has no org: a token reaches its owner's personal space + every team they belong to
  (`scopeWhere`/`inScope` in walkthroughs-api.ts), and `isAdmin` drops the filter entirely —
  including status writes (deliberate). Every list item and brief carries **`space`** (team name,
  'Personal', or '<name> (personal)' on the admin path). **Uploads are never cross-space without
  membership** — declare validates `teamId` against the uploader's memberships, admins included.
  The practical trap stands: your own everyday token is an admin token, so your agent's queue is
  the whole platform.
- **Platform admins bypass membership on reads only** (2026-07-31): `requireViewAccess`
  (server/access.ts) falls back to a synthetic owner role for a platform admin with no access,
  wired into exactly `walkthroughs.get` and `walkthroughs.fileUrl` — so /admin's drill-down can
  open the viewer anywhere. Every mutation still goes through `requireSpaceAccess`. `get` returns
  **`viewerIsMember: false`** on that path and the controls collapse to a read-only chip; don't
  render a control that ignores it, and don't move the bypass into `requireSpaceAccess`.
- **Guests no longer exist** (2026-08-01, deleted with the restructure): no Membership.scope, no
  ProjectAccess, no project-scoped invites, no `canSeeWalkthrough` filtering. Don't reintroduce a
  partial-visibility member without reopening the decision in decisions.md.
- **"team" is a paid entitlement checked at Team.owner** (server/features.ts): gates
  `teams.create` and `invites.create`; seats (`Team.seatLimit`, members + pending invites) gate
  both `invites.create` and `invites.accept`. Billing is modeled, not charged — Stripe later
  plugs into `ownerId`/`seatLimit` without another migration. Platform admins implicitly hold
  every feature — `ADMIN_EMAILS` in SSM bootstraps prod admin, then grant from `/admin`.
- **Prisma 7**: no `--skip-generate` flag; `prisma.config.ts` hand-loads `.env` — keep that block.
- **The e2e suite boots its own server** on :3100 against `handback_test` with dummy S3 creds — any
  test that actually touches S3 will fail loudly (none do today).
- **Playwright locators**: the empty-inbox guide contains a "Team → API tokens" link; use
  `exact: true` for the nav's "Team".
- **Extension is its own npm workspace** (`extension/`, npm not bun — vite CRX builds): two ordered
  vite builds (panel+worker ESM, then content IIFE with `emptyOutDir:false`). Chrome won't bind
  bare-letter commands, so the dock keys (**d** draw / **c** clear / **s** stop) are a window keydown
  listener in the content script; only **Alt+Shift+D** is a real `command`.
- **Preview harness seeds real IndexedDB** ('handback-recorder') and stubs `chrome.*` — it shares the
  origin's DB, so a preview tab and the real panel fight if both run on the same profile. Port 8777
  (`PORT` env to move it; the old gripe repo's harness also used 8777). **Its `SETTINGS` stub must
  track `DEFAULT_SETTINGS` in `lib/types.ts`** — the panel calls `activeLink(settings)`, which
  reaches into `settings.links`, so a stub still carrying the flat 1.1.x `serverUrl`/`apiToken`
  fields throws on first render and the harness comes up **blank with no clue why**. That is exactly
  how it sat broken from the multi-workspace change until 2026-08-01.
  Modes: `rec` (one 2:19 take) · `long` (the acceptance seed) · **`fresh`** (a take still running
  with no frame kept yet — the empty-timeline case) · `home` · `empty`, plus `?unlinked=1` and
  **`?ctx=none|fail`** (a workspace with no projects / a dead context fetch — the two states the
  destination row's project control has to survive on screen).
- **The panel's timeline is a scrubber and nothing else** (2026-08-01, owner's directive: "just the
  scrobble please with dragging. no selection"). Pointer-down anywhere on the ruler, the filmstrip,
  the voice lane or bare track scrubs, and holding keeps scrubbing — **one gesture, no modifiers, no
  click-vs-drag fork**. There is no selection model at all: the range sweep, the marquee, the
  shift/ctrl clicks, the `delete N items` bar and the drag-to-move are gone, and with them the
  `timeline:move` / `timeline:delete` / `recording:frame:delete` / `recording:line:delete` messages.
  What is left that mutates: **fixing a line** (`recording:line:update`, from the readout row or the
  transcript list — an emptied line is a deleted line) and **deleting a take**. Don't reintroduce a
  selection; it is the single thing the owner named as unusable.
- **A take is deletable, and deleting one renumbers the rest.** `take:delete` (`lib/messages.ts` →
  `background/index.ts`, modelled on `session:delete`) drops the recording row, its frames and its
  blobs, then re-lays the survivors as `index` 1..N in `createdAt` order and sets
  `Session.recCount` to their count — `rec-NN` is a position in the walkthrough, not a serial, and
  a hole in it would put a hole in the axis `lib/timeline.ts` walks. The control is the take's own
  label in the filmstrip (`.tl-take`); it arms into an inline question that is **clamped into the
  scroll viewport** rather than anchored to a take that may be four seconds wide, and it is disabled
  while recording or uploading (`busy` prop). Deleting the last take leaves exactly the fresh-session
  empty state.
- **The empty timeline has its own branch.** With no frames *and* no transcript the whole component
  renders one muted line (`.tl.bare`) — no monitor, no ruler, no well, no zoom, no scrollbar. The
  `.tl-scroll` floor and `.tl-monitor` cap below exist to protect the *populated* layout; letting the
  empty case inherit them is what put ~500px of dead grey track and an orphan scrollbar under a
  walkthrough three seconds old. Judge it at `?mode=fresh` in the harness.
- **The axis takes the slack; the monitor gives it up.** `.tl-scroll` is `flex: 1 1 auto` with a
  floor of one ruler + the take lane + two lanes, and `.tl-monitor` is capped at 50% of the panel and
  collapses outright (`.bare`) when there is no frame to show. It used to be the reverse — a monitor
  that grew unbounded over a `flex: 0 1 auto` axis — which crushed the ruler and both lanes to a
  sliver under a tall blank picture. **There is only one shape now**: the popped-out editor strip and
  its `wide` layout are gone (2026-08-01), so nothing is scoped `:not(.wide)` any more.
- **`Dockerfile`, `drydock.yaml` and `.github/workflows/drydock.yml` are Drydock's** — it overwrites
  all three on every wire/re-wire. Change the deploy in the portal, not in the repo.
- **`env.ts` parses at import time**, so a missing S3/auth var is a boot crash, not a runtime error —
  and a crash-looping container burns Let's Encrypt's duplicate-cert budget. Set env in SSM *before*
  the deploy that needs it.
- **S3 CORS is an allowlist of exact origins** (`http://localhost:3995`, `https://handback.dev`,
  `chrome-extension://*` once `handback-files` exists). Browser uploads from any other origin fail
  at the presigned PUT — CORS is Drydock-regenerated from config after the S3 provisioning lands;
  extra origins go in the project's `s3CorsOrigins`, never hand-edited on the bucket.
- **Transcription is server-side by default** (`transcribeCloud.ts` → `/api/ingest/transcribe` →
  Groq). On-device Whisper is the fallback and the privacy escape hatch, not the normal path — see
  `plans/2026-07-30-transcription.md`. Audio leaving the machine is a **privacy-policy fact**: if
  the provider changes, `/privacy` changes in the same release.
- **`GROQ_API_KEY` is optional everywhere.** Unset → the endpoint 503s → every recorder silently
  falls back to on-device. Nothing errors, it just gets slow — so "why is transcription taking
  minutes" is a missing-key question first.
- **Every third-party key degrades the same way.** `ANTHROPIC_API_KEY` unset → `/polish` 503s → the
  raw transcript ships. `RESEND_API_KEY` unset → `sendEmail` logs the message (link included) and
  returns false, so a dev can click a reset link straight out of the terminal. The pattern is
  deliberate: **a missing key must never be able to lose someone's work or block sign-up.**
- **The cleanup pass edits words, never timings.** `/polish` takes text and returns the same number
  of lines; `t`/`d`/`tl` never cross the boundary. Any change there has to keep that true, or the
  timeline, the frames, and the report stop agreeing. The report says when a transcript was
  polished (`report.ts` → `engineName`) because a reader is deciding how far to trust the words.
- **The extension holds one link per SERVER** (since 1.6.0): `Settings.links: ServerLink[]` —
  `{ id: serverUrl, serverUrl, apiToken }` — plus `activeLinkId` + **`activeTeamId`** ('' =
  personal) choosing where uploads go; the destination row is "to <space> · <project>" fed by the
  new `/context`. `handback:link` carries only `apiToken` (origin from `sender.origin`, never the
  payload); `handback:ping` answers `linkedOrigins`. `getSettings()` folds BOTH legacy shapes —
  1.1.x flat fields and 1.2.x per-workspace rows (deduped per server, activeLinkId's row wins) —
  don't remove either fold until no old installs remain. **Recorder ≤1.5.x uploads land in the
  uploader's PERSONAL space** (their declares carry no teamId): teammates won't see them until the
  install updates — `walkthroughs.move` is the fix-up, /recorder's version nag is the cure.
- **The extension ships under TWO ids, and `/recorder` must speak to both.** The `key` in
  `manifest.json` pins the local-unpacked + self-hosted zip build to
  `gmggnebbenlmpakojgocnjfcnpmifdci`; the **Web Store build has its own id
  `bdhajcllnjcnihcbobhaecldgjlhfdhd`** because `pack-store.mjs` strips the `key` (Web Store rejects
  it) and Chrome then generates a fresh id. The pre-submission belief that both would be `gmggneb…`
  was wrong (decisions.md 2026-08-07). So `recorder.tsx` holds `EXTENSION_IDS = [store, self-hosted]`,
  pings each in turn (`chrome.runtime.sendMessage(id, handback:ping)`), and links whichever answered —
  never a single hardcoded id again. Both are answered by `onMessageExternal` in the background, which
  stamps `serverUrl` from **`sender.origin`** — never trust a URL in the payload. `externally_connectable`
  allows only handback.dev + localhost; a new origin (staging etc.) must be added there or the page
  can't see the extension at all. `chrome.runtime` is *absent* on the page until a matching extension
  is installed — absence means "not installed", not "not Chrome". If Chrome ever reassigns the store id
  (e.g. a fresh listing), add the new one to `EXTENSION_IDS`.
- **`STORE_URL` is set** in `src/app/recorder.tsx` (the live listing) → the install step renders the
  "Add to Chrome" button and the zip/load-unpacked walk collapses behind a disclosure automatically.
- **A push to `main` does NOT ship the extension.** Deploy only moves the web app/server; the
  recorder reaches users through `releases/recorder/` in the bucket. So before (or right after) any
  push that touched `extension/`: bump the version if behavior changed, then
  `bun run publish:extension` (build → zip → upload; the zip step shells out to `pwsh`
  `Compress-Archive`, so it's Windows-only — see the Bun gotcha). Skipping
  this leaves every install nagged as outdated — or worse, a server expecting a handshake the
  shipped recorder doesn't speak.
- **The bucket is the release channel.** `/recorder` links `/download/recorder`, not GitHub — the
  repo is private, so its release URLs 404 for exactly the people we hand them to. The route needs
  a session and 302s to a presigned GET; the bytes never touch the container. **The newest zip
  under `releases/recorder/` IS the current release** (`server/releases.ts`, 60s cache) — there is
  no version constant to bump. Publish with `bun cli/publish-recorder.ts` after building and
  zipping `extension/dist` (the script refuses a zip that's missing, or older than the build in
  `dist/`, or whose version disagrees with `package.json`). Off-store Chrome installs never
  auto-update, so `/recorder` compares the version the extension reports over `handback:ping`
  against this and nags — that comparison is the only update mechanism there is until the Web
  Store listing exists; don't drop it when adding one.
- **Bun hangs on a streamed S3 `Body`.** `createReadStream` into `PutObjectCommand` never resolves
  and prints nothing — buffer the file instead (`cli/publish-recorder.ts`). Spawning
  `Compress-Archive` from bun hangs the same way, which is why zipping is a documented shell step
  and not part of the script.
- **The e2e DB needs its own `db:push`.** `handback_test` is truncated, never migrated, by the
  suite — after any schema change run
  `DATABASE_URL=postgres://…/handback_test bunx prisma db push` or sign-up 500s with a
  ColumnNotFound that surfaces as a blank "Sign up failed".

## Gotchas & hard rules (continued — 2026-08-12 human handback)

- **A walkthrough has a `kind`, and 'human' changes the contract.** `kind: 'human'` = the edited
  video IS the deliverable: declare carries `kind` (absent = 'agent' — every old recorder),
  agent lists (`listWalkthroughs`, MCP, ingest GET) filter it out while `get` by id still
  answers, the viewer renders `final.mp4` + `transcript.json` via `FinalCut` instead of takes,
  and its upload carries NO raw takes, NO report.md, NO frames (decisions.md 2026-08-12 ×4).
  `walkthroughs.get/list/inbox` all return `kind` — don't add a surface that ignores it.
- **The share token is the whole credential.** `Walkthrough.shareToken` (18 random bytes,
  base64url) unlocks `/w/<token>` via the public `walkthroughs.shared` procedure — same trust
  model as an unaddressed invite. Re-sharing ROTATES the token (that's the leak recovery);
  `unshare` nulls it. The procedure is IP rate-limited via `checkLimit` (ratelimit.ts's
  tRPC-callable face) using `Context.ip` — SSR's loopback caller has `ip: null`, which SKIPS
  the limit; don't route real user traffic through a null-ip context.
- **Pristine capture is the same engine with three switches.** `LiveRecorder`'s `pristine` flag:
  30 fps ideal (vs 10), `videoBitsPerSecond` ≈ 4 bits/px/s clamped [6, 16] Mbps, and NO keyframe
  sampling loop. Everything else (mix, mic shadow, chunk persistence, recovery) is byte-identical
  — `src/lib/edit/` is deliberately NOT mirrored into the extension/phone/library pipeline.
- **The editor's cut proposals need both silences AND no words.** `silence.ts` proposes a cut
  only where the RMS envelope (adaptive threshold from the take's own distribution — raw audio,
  no NS, every room differs) is quiet AND no padded transcript line overlaps. Words always win.
  Vetoed silence chips stay vetoed across Tighten re-runs (matched by take + ~position).
- **final.mp4 downloads through a second presign.** `presignGet(key, { downloadAs })` signs a
  `ResponseContentDisposition` — the `download` attribute is ignored cross-origin, so the
  Download button needs the URL itself to say attachment. `get`/`shared` return it as
  `downloadUrl`.

## Status

- **Done (2026-07-29, day one)** — schema + S3 + two-phase ingest + push CLI (verified with a real
  36MB gripe, 172 files); tRPC API for orgs/invites/tokens/projects/gripes; full web app (landing,
  auth, inbox with first-run onboarding, viewer with video/filmstrip/transcript/events/report,
  team, projects, join); token REST reads + stdio MCP (`list_gripes`/`get_gripe`/
  `set_gripe_status`); e2e smoke suite with committed baselines; README.
- **Done (2026-07-29, evening)** — the extension, rebuilt from scratch in `extension/`: MV3
  side-panel recorder (screen + mic, 64×64-cell dedup keyframes, Whisper transcription in a
  worker), on-page dock + cobalt ink drawing, the one-timeline editor (drag across take seams,
  popped strip), report.md builder, and **direct cloud upload** to `/api/ingest` (no local
  folders, no downloads permission). Typechecked, both bundles build, layout verified against the
  10:18/150-frame acceptance seed via the preview harness.
- **Done (2026-07-30)** — **first ship via Drydock**, then at inloop.dested.com, now handback.dev:
  project created, repo wired (Dockerfile + workflow + drydock.yaml), S3/auth env in SSM, schema
  pushed by the pre-deploy task, CI green, TLS valid, `/healthz` ok. `render.yaml` deleted; the
  dev port moved 3000 → 3995 everywhere.
- **Done (2026-07-30, later)** — `/privacy` and `/terms` (real pages, Arizona law, sal@dested.com);
  **server-side transcription on Groq** replacing the on-device Whisper wait, with an on-device
  toggle kept as the privacy path (`plans/2026-07-30-transcription.md`).
- **Not built** — a prod account/API token (no one has signed up yet, so no S3 round-trip has run
  against prod), a real in-Chrome record→upload run (needs a human), share links / public
  gripe URLs, billing, org deletion, error tracking / alerting, pagination past 200 gripes,
  the Chrome Web Store listing itself (its copy is written — see Plans).
- **Done (2026-07-30, night)** — **renamed Inloop → Handback (handback.dev)**: full sweep of code,
  extension, copy (`hb_` tokens, `HANDBACK_*` env, `handback-recorder` DB, `handback_test`,
  `handback.activeOrgId`, MCP name); new identity — the **return mark** (`ReturnMark`,
  `return-diagram.tsx`, regenerated extension icons); GitHub repo renamed dested/handback; e2e
  baselines re-shot. Infra handoff pending on Sal — `plans/2026-07-30-handback-rename.md`.
- **Done (2026-07-30, night, after the rename)** — the go-live batch: **email on Resend**
  (`server/email.ts` + reset/verify/invite flows, `/forgot-password`, `/reset-password`),
  **upload size caps + per-org quota** (signed `ContentLength`, so S3 enforces it),
  **rate limiting** (better-auth rules + `server/ratelimit.ts` over ingest), **alpha pricing copy**
  (nothing implies a charge), and the **Haiku transcript cleanup pass** (`server/polish.ts` +
  `extension/src/sidepanel/polish.ts` — "handbag" → "Handback", "cores" → "CORS", verified against
  real mangled speech). Privacy page updated in the same pass: Anthropic and Resend named as
  processors. Web Store listing copy written in full.
- **Done (2026-07-30, night, later still)** — **the agent onboarding path**: a hosted MCP server at
  **`/mcp`** (`server/mcp.ts` — StreamableHTTP, stateless, `hb_` bearer) so connecting an agent is
  one copy-paste line with no clone and no bun, and **`/connect`** (`src/app/connect.tsx`) — mint a
  token inline, get a command with that token already in it, watch a live "connected" indicator,
  and read how to disconnect (remove the server ≠ revoke the token). Inbox gained a dismissible
  "Are you the engineer who's going to fix these?" banner that retires itself once a token has
  actually been used. Read side refactored into `server/gripes-api.ts` + `server/mcp-format.ts`,
  shared by REST and both MCP servers. Verified against a live server: initialize, tools/list,
  a real `list_gripes` call, 401 on a bad token, 405 on GET.
- **Done (2026-08-01)** — **the website walkthrough (`212801d8`)**: gripe → **walkthrough**
  everywhere (DB tables/columns renamed in place, tRPC `walkthroughs.*`, MCP
  `list/get/set_walkthrough*`, `/walkthroughs/:id` + legacy redirect, CLI, README, recorder
  report.md strings); **personal workspaces** (`Org.personal`, sign-up hook, ensurePersonal,
  switcher dropdown + entitlement-gated "New team…", Team page split, tokens → /connect, origin
  hints out of the UI); **landing redo** (new tagline "Debug and review your app in your own
  words.", RecorderPanelMock in the hero, de-bugged step copy, honest sign-off step, pricing hour
  quotas, MCP terminal block removed); **dev FOUC fix**. e2e re-baselined, 4/4. Prod DB migration
  pending — see the ⚠️ above.
- **Done (2026-08-01, later)** — **the recorder panel's walkthrough UI, rebuilt** on the owner's
  verdict ("clean up that walkthrough ui... i hate this ui"). Deleted outright: the **puck** (the PiP
  pointer, `content/puck.ts` and every message, type and CSS rule behind it), the **popped-out editor
  strip** (`?pop`, `strip:track`, the whole `wide` timeline layout), **mark** (hotkey, dock key,
  `KeyFrame.reason` member, report annotations, the never-thin carve-out), the timeline's **entire
  selection model**, and the transcript's **"reads right"** pill. Added: **per-take delete**
  (`take:delete`, arming inline on the take's own label, renumbering the rest), an **empty-timeline
  branch**, a **two-row walkthrough header** (crumb+meta, then title+`record a take`), an inline
  right-aligned **zoom** control, and a **project picker that never hides** — `no project` /
  `projects unavailable · retry`, with a way through to `/projects`.
- **Done (2026-08-02)** — **workspaces removed: Teams + one implicit Personal space**
  (`plans/2026-08-01-teams-restructure.md`, commit `3207be1`). Org→Team (ownerId transferable via
  `teams.transferOwnership`, seatLimit enforced on invites), personal = `teamId null` owned by
  userId, guests/ProjectAccess deleted, tokens user-scoped, ingest/MCP re-scoped (`space` field,
  `?team=` filter, declare `teamId`), client Space context + switcher, extension 1.6.0 (one link
  per server, Personal/team destination picker). `cli/migrate-teams.ts` ran against prod (before
  the deploy, by accident — dev `.env` pointed at prod; ~15 min of signed-in 500s until the
  deploy rolled; zero data lost, audit in the Deploy section). e2e 4/4 re-verified.
- **Done (2026-08-02, later)** — **Handback on the phone**: PWA (manifest + share_target +
  no-cache SW + return-mark icons), `/phone` guide+intake, and `src/lib/capture/` — the
  extension pipeline ported to distill OS-recorded clips in the browser and upload through the
  unchanged ingest API (multi-clip → rec-NN, voice-note mode, iOS picker path). Live in-PWA
  screen capture confirmed impossible on mobile; design + limitations in
  `plans/2026-08-02-phone-pwa.md`. On-device QA still pending (needs a real phone).
- **Done (2026-08-12, later)** — **human handback** (`plans/2026-08-12-human-handback.md`, all
  four waves): `Walkthrough.kind` + `shareToken` (schema pushed NOWHERE yet — prod gets it via
  predeploy `db push` on the next main push; local dev + `handback_test` need it by hand),
  token-guarded `/w/:shareToken` watch page, share/unshare/shared procedures, /record kind
  picker + pristine capture, transcript-first editor (`src/lib/edit/`, `components/edit/`),
  mediabunny MP4 render + upload (`final.mp4`/`transcript.json`/`edit.json`), share-on-success.
  Typecheck + build green; **no live browser run** (the `.env`-points-at-prod hazard again) —
  the whole record→edit→render→share loop wants a human at a keyboard.
- **Next** — **deploy, then re-test the loop**: `/mcp` and `/connect` only exist locally until the
  next push to `main`, so the command `/connect` prints for handback.dev 404s until then. Sal's
  Drydock/DNS checklist in the rename plan (zone, project, S3 via
  `G:\code\drydock\plans\2026-07-30-s3-buckets.md`), load-unpacked QA of the extension, then **the
  go-live blockers in `plans/2026-07-30-go-live.md`** (Chrome Web Store submission first — it's
  the only queue we don't control), then the strategy backlog in
  `G:\code\gripe\plans\2026-07-29-enterprise-strategy.md`.

## Plans

- `plans/2026-07-30-transcription.md` — **active**. Why on-device Whisper stopped being the
  default, what shipped on Groq, and what's left (Deepgram if keyterm biasing is ever needed). The
  Haiku cleanup pass it proposed is built — `server/polish.ts`.
- `plans/2026-07-30-go-live.md` — **active**. What's required before strangers can sign up. Blockers
  1 and 2 (email, upload caps) and most should-fixes are ticked off; what's left is Sal's — Resend
  domain verification, the Web Store submission, the prod S3 round trip, and rotating the keys that
  were pasted in chat. Also carries the deferred `<all_urls>` → `activeTab` migration, written out
  file by file for the day Google asks.
- `plans/2026-07-30-web-store-listing.md` — **active**. Every field the Web Store form asks for,
  written to paste: description, single-purpose statement, a justification per permission, the
  data-use disclosure table, reviewer notes with test-account steps, and the screenshot shot list.
- `plans/2026-07-30-handback-rename.md` — **active**. The Inloop → Handback rename: settled
  decisions table + Sal's Drydock/DNS checklist (zone, S3, project recreate, SSM, cleanup).
- `plans/2026-08-01-teams-restructure.md` — **done**. Workspaces removed: the target model,
  pinned contracts, migration steps, and wave plan for the Teams + Personal restructure.
- `plans/2026-08-02-phone-pwa.md` — **done** (code); on-device QA outstanding. The platform
  verdict (no mobile screen capture, ever), the OS-recorder + share-target design, and the
  honest limitations list for /phone.
- `plans/2026-08-12-web-recorder.md` — **done**. The extension-free `/record` path: what ports,
  the two accepted divergences, the pop-out gesture rule.
- `plans/2026-08-12-human-handback.md` — **done** (code; live run pending). The kind split,
  share links, the transcript-first editor, the mediabunny decision, and the four waves.
