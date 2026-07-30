# Inloop — CliffNotes

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

Brand: **Inloop** — humans in the loop. Light-only editorial UI (`ui.md`), nothing orange, nothing
dark, nothing visually inherited from the Gripe extension.

## Quick Reference

- **Dev:** `bun run dev` → http://localhost:3995 (needs `.env`; see Env below)
- **Type-check:** `bun run typecheck` (`tsgo --noEmit`)
- **DB:** local Postgres 18 service; `bun run db:push` after schema edits (+`db:generate`)
- **E2E:** `E2E_DATABASE_URL=postgres://postgres:<pw>@localhost:5432/inloop_test bun run test:e2e`
  (isolated DB + port 3100; screenshots committed; `test:e2e:update` to re-baseline)
- **Seed a dev login:** `bun cli/dev-bootstrap.ts [email] [password] [org]` → prints an `ilp_` token
- **Push a gripe:** `bun cli/push.ts <gripe-folder> --server http://localhost:3995 --token ilp_…`
- **Extension:** `bun run build:extension` (root) or `cd extension && npm run build` →
  load-unpacked `extension/dist`;
  `npm run preview` → http://localhost:8777/gallery.html (layout harness, no Chrome needed)
- **MCP:** `claude mcp add inloop --env INLOOP_TOKEN=ilp_… --env INLOOP_SERVER=<url> -- bun <repo>/cli/mcp.ts`
- **GitHub:** dested/inloop (private). **Deploy: live at https://inloop.dested.com** — Drydock,
  auto-deploys on every push to `main` (see Deploy below).

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
  env.ts                zod env: DATABASE_URL, BETTER_AUTH_*, AWS_REGION, S3_BUCKET, AWS keys
  auth.ts               better-auth instance (email+password, autoSignIn)
  trpc.ts               context (session from headers) + public/protectedProcedure
  membership.ts         requireMembership(user, org, atLeast) role gate + slugify
  router.ts             THE tRPC API: orgs, invites, tokens, projects, gripes
  ingest.ts             Token-authed REST (Bearer ilp_…): two-phase upload + agent reads
  storage.ts            S3: presignPut/Get, getObjectText, deletePrefix, key layout, isSafePath
  prisma.ts / logger.ts PrismaClient singleton · ANSI request logger
cli/
  push.ts               `inloop push` — walks a gripe folder, declare → PUT xN → finalize
  mcp.ts                stdio MCP server: list_gripes / get_gripe / set_gripe_status
  dev-bootstrap.ts      idempotent dev seed: user + org + fresh API token (prints it)
prisma/schema.prisma    better-auth models + Org/Membership/Invite/Project/Gripe/Take/GripeFile/ApiToken
src/
  app/
    routes.tsx          All routes + loaders (appLoader guards session, prefetches orgs.mine)
    layout.tsx          Shell: marketing chrome vs app chrome (org switcher, Inbox/Projects/Team)
    home.tsx            Landing page (assembles src/components/landing/*)
    sign-in/up.tsx      Auth cards (better-auth client flows)
    app.tsx             InboxPage: first-run org creation, filters, gripe list
    gripe.tsx           GripePage: the viewer (assembles src/components/viewer/*)
    projects.tsx        Projects list + create (origin hints)
    team.tsx            Members / Invites / API tokens tabs
    join.tsx            /join/:inviteId — peek + accept
  components/
    logo.tsx            LoopMark + Wordmark — THE identity, never redraw
    ui/                 button, card, input, label (shadcn new-york style, no asChild)
    landing/            hero, how-it-works, gripe-manifest, cli-strip, pricing, final-cta, …
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
extension/              Inloop Recorder — the Chrome MV3 extension (own npm workspace)
  public/manifest.json  MV3: sidePanel + activeTab/scripting/storage/tabs; hotkeys Alt+Shift+M/D
  src/lib/              Shared contracts: types, messages (worker protocol), timeline math,
                        db (IndexedDB 'inloop-recorder'), report.md builder, upload (to /api/ingest)
  src/background/       Service worker: hotkeys, dock routing, IndexedDB writes, strip docking
  src/content/          On-page dock (d/c/m/s keys), ink drawing, telemetry; injected.js relay
  src/sidepanel/        Panel app: recorder (getDisplayMedia + dedup), Whisper transcription,
                        Timeline editor, grids contact sheets, App.tsx orchestration
  scripts/              make-icons, copy-ort, prune-dist, preview.mjs + preview/ (layout harness)
```

## Routes / URLs

| Route | Serves | File |
| --- | --- | --- |
| `/` | Landing (marketing) | `src/app/home.tsx` |
| `/sign-in` · `/sign-up` | Auth | `src/app/sign-{in,up}.tsx` |
| `/join/:inviteId` | Invite accept | `src/app/join.tsx` |
| `/app` | Inbox (gripe list, first-run org creation) | `src/app/app.tsx` |
| `/gripes/:gripeId` | The viewer | `src/app/gripe.tsx` |
| `/projects` · `/team` | Projects · Members/Invites/Tokens | `src/app/{projects,team}.tsx` |
| `/dashboard` | redirect → /app (legacy) | `routes.tsx` |
| `/healthz` | DB probe | `server.ts` |
| `/api/auth/*` · `/api/trpc/*` | better-auth · tRPC | `server.ts` |
| `/api/ingest/*` | Token-authed REST (below) | `server/ingest.ts` |

### /api/ingest (Bearer `ilp_…` token; org comes from the token)

| Endpoint | Does |
| --- | --- |
| `POST /gripes` | Declare: metadata + file list → gripe/take/file rows + presigned PUT per file. Re-declaring an existing (org, slug) deletes the old gripe + S3 prefix first |
| `POST /gripes/:id/finalize` | Marks files uploaded + sets `finalizedAt` (list only shows finalized) |
| `GET /gripes` | List for agents (MCP `list_gripes`) |
| `GET /gripes/:id` | Detail + `reportMd` text + presigned GET for every file (MCP `get_gripe`) |
| `POST /gripes/:id/status` | open / in_review / resolved (MCP `set_gripe_status`) |

## Data model (Postgres via Prisma)

better-auth's User/Session/Account/Verification, plus: **Org** ← Membership(role
owner/admin/member, unique org+user) · Invite (id IS the join-link token, 7-day expiry) · Project
(originHints[] auto-routes uploads by recorded origin) · **Gripe** (unique org+slug; slug = the
recorder's folder name; status open/in_review/resolved; finalizedAt gates visibility) ← Take
(rec-NN) + GripeFile (path unique per gripe; S3 key = `orgs/<orgId>/gripes/<gripeId>/<path>`) ·
ApiToken (sha256 hash only; `ilp_` prefix; lastUsedAt stamped on ingest auth).

## Storage (S3)

Bucket **inloop-files**, us-west-2, AWS account 114394156384 (profile `dested`), public access
blocked, CORS allows localhost:3995/3210 + inloop.dested.com. IAM user `inloop-app` scoped to this
bucket; its keys live in `.env` only. Everything moves via presigned URLs (PUT 1h, GET 1h) —
`gripes.get` presigns every file in one call so the viewer never round-trips per frame.

## Deploy (Drydock → https://inloop.dested.com)

Deployed by **Drydock** (`G:\code\drydock`, local portal at http://localhost:4400) onto the shared
ARM EC2 box: ECS service `drydock-inloop`, Caddy auto-TLS, shared Postgres container, Route53 A
record → the box's EIP `52.24.94.83`. **Push to `main` = deploy** — the generated workflow builds an
arm64 image via OIDC (no AWS keys in GitHub), runs `bunx prisma db push` as a one-off pre-deploy
task, then rolls the service.

| Setting | Value |
| --- | --- |
| project / db name | `inloop` (Postgres db + user `inloop` on the shared container) |
| container port | 3995 (`PORT` is injected; `server.ts` reads it) |
| size | `m` — 192 MiB reservation / 576 MiB hard limit |
| build / start | `bun run build` / `bun run start` |
| predeploy | `bunx prisma db push` (no `--accept-data-loss`, on purpose) |
| domain / zone | `inloop.dested.com` in the shared `dested.com` zone |

**Env lives in SSM**, not `.env`: `DATABASE_URL` + `BETTER_AUTH_SECRET` are generated by Drydock,
`BETTER_AUTH_URL=https://inloop.dested.com`, and `AWS_REGION` / `S3_BUCKET` /
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are the `inloop-app` IAM user's keys, copied up from
the local `.env`. Change any of them in the portal (Project → Environment) and hit
**Apply + redeploy** — CI's task-def registration copies the *previous* revision's secret list, so a
new key never reaches the container on a plain push.

## Gotchas & hard rules

- **ui.md is law**: light only, no dark mode, no orange. Status colors fixed (open=cobalt,
  in_review=violet, resolved=green).
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
- **Prisma 7**: no `--skip-generate` flag; `prisma.config.ts` hand-loads `.env` — keep that block.
- **The e2e suite boots its own server** on :3100 against `inloop_test` with dummy S3 creds — any
  test that actually touches S3 will fail loudly (none do today).
- **Playwright locators**: the empty-inbox guide contains a "Team → API tokens" link; use
  `exact: true` for the nav's "Team".
- **Extension is its own npm workspace** (`extension/`, npm not bun — vite CRX builds): two ordered
  vite builds (panel+worker ESM, then content IIFE with `emptyOutDir:false`). Chrome won't bind
  bare-letter commands, so the dock keys (d/c/m/s) are a window keydown listener in the content
  script; only Alt+Shift+M/D are real `commands`.
- **Preview harness seeds real IndexedDB** ('inloop-recorder') and stubs `chrome.*` — it shares the
  origin's DB, so a preview tab and the real panel fight if both run on the same profile. Port 8777
  (`PORT` env to move it; the old gripe repo's harness also used 8777).
- **`Dockerfile`, `drydock.yaml` and `.github/workflows/drydock.yml` are Drydock's** — it overwrites
  all three on every wire/re-wire. Change the deploy in the portal, not in the repo.
- **`env.ts` parses at import time**, so a missing S3/auth var is a boot crash, not a runtime error —
  and a crash-looping container burns Let's Encrypt's duplicate-cert budget. Set env in SSM *before*
  the deploy that needs it.
- **S3 CORS is an allowlist of exact origins** (`http://localhost:3995`, `http://localhost:3210`,
  `https://inloop.dested.com`, `chrome-extension://*`). Browser uploads from any other origin fail at
  the presigned PUT — update the bucket CORS when a new origin appears.
- **Extension uploads with the panel's saved `ilp_` token** (settings → serverUrl+apiToken,
  defaults to https://inloop.dested.com) through the same two-phase `/api/ingest` flow as the CLI.

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
- **Done (2026-07-30)** — **shipped to https://inloop.dested.com via Drydock** (see Deploy above):
  project created, repo wired (Dockerfile + workflow + drydock.yaml), S3/auth env in SSM, schema
  pushed by the pre-deploy task, CI green, TLS valid, `/healthz` ok. `render.yaml` deleted; the
  dev port moved 3000 → 3995 everywhere.
- **Not built** — a prod account/API token (no one has signed up yet, so no S3 round-trip has run
  against prod), a real in-Chrome record→upload run (needs a human), share links / public
  gripe URLs, email sending for invites, billing, server-side transcription, org deletion,
  pagination past 200 gripes, Chrome Web Store listing.
- **Next** — load-unpacked QA of the extension, then **the go-live blockers in
  `plans/2026-07-30-go-live.md`** (Chrome Web Store submission first — it's the only queue we don't
  control), then the strategy backlog in
  `G:\code\gripe\plans\2026-07-29-enterprise-strategy.md`.

## Plans

- `plans/2026-07-30-go-live.md` — **active**. What's required before strangers can sign up:
  password reset/email, upload size caps + quotas, the untested prod S3 round trip, and a full
  Chrome Web Store submission guide (cost, review time, why `<all_urls>` is the slow part).
