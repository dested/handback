# Handback — CliffNotes

> Living map of the project. Read this before any coding session.
> Last updated: 2026-07-30. Visual language → `ui.md` · why → `decisions.md` ·
> log → `updates.md`.
>
> **Before opening sign-up to anyone you can't text: read
> [`plans/2026-07-30-go-live.md`](plans/2026-07-30-go-live.md)** — the audit of what's still
> missing (no password reset, unbounded presigned PUTs, no Web Store listing) and the Chrome Web
> Store submission notes.

## What this is

The cloud half of the gripe workflow: a workspace where recorded **gripes** — narrated screen
walkthroughs produced by the Gripe extension (`G:\code\gripe`) — are uploaded, reviewed by humans,
routed to projects, and pulled by coding agents. A gripe folder (report.md + MANIFEST.txt +
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
- **Seed a dev login:** `bun cli/dev-bootstrap.ts [email] [password] [org]` → prints an `hb_` token
- **Push a gripe:** `bun cli/push.ts <gripe-folder> --server http://localhost:3995 --token hb_…`
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
Playwright e2e. Inherited from dested/sal-starter — its conventions (server-only `./server/*`,
`~/*`→`src/*` alias, JSON-safe tRPC returns) still hold.

## Directory structure

```
server.ts               Express entry: /healthz, auth, ingest, tRPC, vite/SSR, 404s
server/
  env.ts                zod env: DATABASE_URL, BETTER_AUTH_*, AWS_REGION, S3_BUCKET, AWS keys,
                        GROQ_API_KEY / ANTHROPIC_API_KEY / RESEND_API_KEY + EMAIL_FROM (all
                        optional — each unset one disables its feature, nothing crashes),
                        ADMIN_EMAILS (comma-separated bootstrap platform admins)
  auth.ts               better-auth: email+password, autoSignIn, reset/verify email, rate limits
  trpc.ts               context (session from headers) + public/protectedProcedure
  membership.ts         requireMembership(user, org, atLeast) → Access{role, projectIds} + slugify
  features.ts           entitlements: isPlatformAdmin (User.isAdmin OR ADMIN_EMAILS env),
                        orgHasFeature('team') checked at the org's OWNER, requireAdmin
  router.ts             THE tRPC API: orgs, invites, tokens, projects, gripes
  ingest.ts             Token-authed REST (Bearer hb_…): two-phase upload, size caps + per-org
                        quota, /transcribe and /polish; read side delegates to gripes-api
  gripes-api.ts         THE agent-facing surface: token auth + list/get/setStatus. Shared by
                        ingest.ts AND both MCP servers so they can't drift
  mcp.ts                Hosted MCP at /mcp — StreamableHTTP, stateless, hb_ bearer auth
  mcp-format.ts         Pure formatter for a gripe brief; shared with cli/mcp.ts
  storage.ts            S3: presignPut/Get, getObjectText, deletePrefix, key layout, isSafePath
  transcribe.ts         speech-to-text via Groq whisper-large-v3-turbo; segments in ms
  polish.ts             transcript cleanup via claude-haiku-4-5 — text only, timings untouched
  email.ts              Resend sender + reset/verify/invite templates; never throws
  ratelimit.ts          in-memory fixed-window limiter (one ECS task, so one process sees all)
  prisma.ts / logger.ts PrismaClient singleton · ANSI request logger
cli/
  push.ts               `handback push` — walks a gripe folder, declare → PUT xN → finalize
  mcp.ts                stdio MCP server — the LOCAL fallback; prod uses server/mcp.ts at /mcp
  dev-bootstrap.ts      idempotent dev seed: user (admin + team) + org + fresh API token (prints it)
  make-admin.ts         promote an account to platform admin by email (dev; prod uses ADMIN_EMAILS)
prisma/schema.prisma    better-auth models + Org/Membership/Invite/Project/Gripe/Take/GripeFile/ApiToken
src/
  app/
    routes.tsx          All routes + loaders (appLoader guards session, prefetches orgs.mine)
    layout.tsx          Shell: marketing chrome vs app chrome (org switcher, Inbox/Projects/
                        Team/Connect)
    home.tsx            Landing page (assembles src/components/landing/*)
    sign-in/up.tsx      Auth cards (better-auth client flows)
    app.tsx             InboxPage: first-run org creation, filters, gripe list
    gripe.tsx           GripePage: the viewer (assembles src/components/viewer/*)
    projects.tsx        Projects list + create (origin hints)
    team.tsx            Members / Invites / API tokens tabs
    connect.tsx         /connect — THE agent onboarding: mint a token, one copy-paste
                        `claude mcp add` with the token baked in, live "connected" check,
                        disconnect instructions. Codex is a "soon" tab.
    recorder.tsx        /recorder — THE recorder onboarding: install (Web Store button behind
                        a STORE_URL constant, zip/load-unpacked until then), live install ping,
                        one-click Link (token minted + handed over, nothing pasted)
    join.tsx            /join/:inviteId — peek + accept
    admin.tsx           /admin — platform admin: stats, user search, team/admin toggles
    forgot-password.tsx /forgot-password — same answer whether or not the account exists
    reset-password.tsx  /reset-password?token=… — the link better-auth emails
    privacy.tsx         /privacy — what's collected, where it lives, subprocessors
    terms.tsx           /terms — alpha status, recording consent, Arizona law
  components/
    logo.tsx            ReturnMark + Wordmark — THE identity (the returning stroke), never redraw
    setup-step.tsx      the numbered editorial Step shared by /connect and /recorder
    legal.tsx           LegalPage/Section/Terms/Notice — shared chrome for /privacy + /terms
    ui/                 button, card, input, label (shadcn new-york style, no asChild)
    landing/            hero, how-it-works, distill, gripe-manifest, agent-view, pricing,
                        final-cta · demo-shot.tsx (a keyframe as SVG) + demo-data.ts (the one
                        demo gripe) + mock.tsx (Pane/ContactSheet/Filmstrip/PlayerStrip)
    viewer/             take-section, filmstrip, transcript-panel, events-panel, report-panel,
                        gripe-header, gripe-controls, status-control, types, format, use-copy
  lib/
    org.tsx             OrgProvider/useActiveOrg — active org id in localStorage
    trpc.tsx / auth-client.ts / utils.ts
  styles/app.css        ALL design tokens (light only) + .rule/.stamp/.ink-underline utilities
e2e/                    smoke.spec.ts + committed screenshots (landing, sign-up, app flow)
index.html              SSR template; Google Fonts (Fraunces/Libre Franklin/IBM Plex Mono)
Dockerfile              DRYDOCK-OWNED — regenerated on every wire/re-wire, never hand-edit
drydock.yaml            DRYDOCK-OWNED — the deploy manifest (portal is source of truth)
.github/workflows/
  drydock.yml           DRYDOCK-OWNED — OIDC build → ECR → predeploy → ECS deploy on push to main
extension/              Handback Recorder — the Chrome MV3 extension (own npm workspace)
  public/manifest.json  MV3: sidePanel + activeTab/scripting/storage/tabs; hotkeys Alt+Shift+M/D
  src/lib/              Shared contracts: types, messages (worker protocol), timeline math,
                        db (IndexedDB 'handback-recorder'), report.md builder, upload (to /api/ingest)
  src/background/       Service worker: hotkeys, dock routing, IndexedDB writes, strip docking
  src/content/          On-page dock (d/c/m/s keys), ink drawing, telemetry; injected.js relay
  src/sidepanel/        Panel app: recorder (getDisplayMedia + dedup), transcription
                        (transcribeCloud.ts → the workspace; transcribeWorker.ts → on-device),
                        polish.ts (the cleanup pass, after transcription), Timeline editor,
                        grids contact sheets, App.tsx orchestration
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
| `/app` | Inbox (gripe list, first-run org creation) | `src/app/app.tsx` |
| `/gripes/:gripeId` | The viewer | `src/app/gripe.tsx` |
| `/projects` · `/team` | Projects · Members/Invites/Tokens | `src/app/{projects,team}.tsx` |
| `/connect` | Connect a coding agent (token + `claude mcp add` + disconnect) | `src/app/connect.tsx` |
| `/recorder` | Install + one-click-link the extension (detects install, mints token, handshake) | `src/app/recorder.tsx` |
| `/admin` | Platform admin (admins only; nav link hidden otherwise) | `src/app/admin.tsx` |
| `/dashboard` | redirect → /app (legacy) | `routes.tsx` |
| `/healthz` | DB probe | `server.ts` |
| `/api/auth/*` · `/api/trpc/*` | better-auth · tRPC | `server.ts` |
| `/api/ingest/*` | Token-authed REST (below) | `server/ingest.ts` |
| `/mcp` | **Hosted MCP** (POST only, `hb_` bearer). What agents connect to | `server/mcp.ts` |

### /api/ingest (Bearer `hb_…` token; org comes from the token)

| Endpoint | Does |
| --- | --- |
| `POST /gripes` | Declare: metadata + file list → gripe/take/file rows + presigned PUT per file. Re-declaring an existing (org, slug) deletes the old gripe + S3 prefix first |
| `POST /gripes/:id/finalize` | Marks files uploaded + sets `finalizedAt` (list only shows finalized) |
| `GET /gripes` | List for agents (MCP `list_gripes`) |
| `GET /gripes/:id` | Detail + `reportMd` text + presigned GET for every file (MCP `get_gripe`) |
| `POST /gripes/:id/status` | open / in_review / resolved (MCP `set_gripe_status`) |
| `POST /transcribe` | 16 kHz mono WAV body in, `{segments:[{t,d?,text}]}` out. Stateless — the recorder chunks and offsets. 503 when `GROQ_API_KEY` is unset |
| `POST /polish` | `{lines:[{text}], context:{origin,title,errors}}` in, the same number of lines back with product nouns spelled right. Text only — no timings cross this boundary. 503 when `ANTHROPIC_API_KEY` is unset |

Every route is rate-limited: one per-IP limit ahead of authentication, then a per-token limit per
route (`server/ratelimit.ts`). Declare also enforces 512 MB/file, 2 GB/gripe, 20 GB + 500 gripes per
org, and the presigned PUT signs `ContentLength` so S3 rejects an upload that doesn't match.

## Data model (Postgres via Prisma)

better-auth's User/Session/Account/Verification, plus: **Org** ← Membership(role
owner/admin/member, unique org+user; **scope** org|projects — "projects" = a **guest** who sees
only granted projects and is clamped to member) ← ProjectAccess(membership+project grant, unique
pair) · Invite (id IS the join-link token, 7-day expiry; optional **projectId** = guest invite,
role forced to member; an org-wide invite upgrades an existing guest) · Project
(originHints[] auto-routes uploads by recorded origin) · **Gripe** (unique org+slug; slug = the
recorder's folder name; status open/in_review/resolved; finalizedAt gates visibility;
**errorCount**/**droppedCount** — see the events gotcha) ← Take
(rec-NN) + GripeFile (path unique per gripe; S3 key = `orgs/<orgId>/gripes/<gripeId>/<path>`) ·
ApiToken (sha256 hash only; `hb_` prefix since the rename — old `ilp_` tokens are dead;
lastUsedAt stamped on ingest auth).

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

> **⚠️ PROD IS MID-MIGRATION (2026-07-31) — push `main` to finish it.** The `errorCount` rename was
> applied straight to the prod DB (`error_count` renamed, `dropped_count` added), but the running
> container is still the *old* image, which selects `gripe.event_count`. **Every gripe read on
> handback.dev errors right now** ("The column `gripe.event_count` does not exist") — `/healthz`
> still 200s, so a probe won't catch it. Deploying the current `main` fixes it; nothing else is
> needed (predeploy `db push` finds no drift). Local `handback` + `handback_test` already renamed.

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
  token ever completed a request", not "does a token exist". Guests get `canConnect: false` and
  never see it.
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
  prints a fresh one each run.
- **Guest scoping is enforced in `requireMembership`** (server/membership.ts): it returns
  `Access { role, projectIds }` (`null` = whole workspace). Any NEW tRPC procedure returning
  org data must respect `access.projectIds` (`canSeeGripe` / `requireOrgScope`) or guests leak.
  `hb_` tokens are org-wide, so guests can't mint them, and both `orgs.removeMember` and a
  restricting `orgs.setAccess` revoke the target's tokens.
- **"team" is a paid entitlement checked at the org's owner** (server/features.ts): the only gate
  is `invites.create`; the UI reads `orgs.mine → teamEnabled`. Platform admins (`User.isAdmin` or
  `ADMIN_EMAILS` env, comma-separated) implicitly hold every feature — set `ADMIN_EMAILS` in SSM
  to bootstrap prod admin, then grant from `/admin`.
- **Prisma 7**: no `--skip-generate` flag; `prisma.config.ts` hand-loads `.env` — keep that block.
- **The e2e suite boots its own server** on :3100 against `handback_test` with dummy S3 creds — any
  test that actually touches S3 will fail loudly (none do today).
- **Playwright locators**: the empty-inbox guide contains a "Team → API tokens" link; use
  `exact: true` for the nav's "Team".
- **Extension is its own npm workspace** (`extension/`, npm not bun — vite CRX builds): two ordered
  vite builds (panel+worker ESM, then content IIFE with `emptyOutDir:false`). Chrome won't bind
  bare-letter commands, so the dock keys (d/c/m/s) are a window keydown listener in the content
  script; only Alt+Shift+M/D are real `commands`.
- **Preview harness seeds real IndexedDB** ('handback-recorder') and stubs `chrome.*` — it shares the
  origin's DB, so a preview tab and the real panel fight if both run on the same profile. Port 8777
  (`PORT` env to move it; the old gripe repo's harness also used 8777).
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
- **Extension uploads with the panel's saved `hb_` token** (settings → serverUrl+apiToken,
  defaults to https://handback.dev) through the same two-phase `/api/ingest` flow as the CLI.
- **The extension's ID is pinned** by the `key` in `manifest.json` →
  `gmggnebbenlmpakojgocnjfcnpmifdci`, identical unpacked and (on first upload) in the Web Store.
  `/recorder` deep-links through it: page → `chrome.runtime.sendMessage(ID, handback:ping|link)`,
  answered by `onMessageExternal` in the background, which stamps `serverUrl` from
  **`sender.origin`** — never trust a URL in the payload. `externally_connectable` allows only
  handback.dev + localhost; a new origin (staging etc.) must be added there or the page can't see
  the extension at all. `chrome.runtime` is *absent* on the page until a matching extension is
  installed — absence means "not installed", not "not Chrome".
- **When the Web Store listing lands, set `STORE_URL`** in `src/app/recorder.tsx` — the zip/
  load-unpacked instructions collapse behind it automatically.
- **The e2e DB needs its own `db:push`.** `handback_test` is truncated, never migrated, by the
  suite — after any schema change run
  `DATABASE_URL=postgres://…/handback_test bunx prisma db push` or sign-up 500s with a
  ColumnNotFound that surfaces as a blank "Sign up failed".

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
