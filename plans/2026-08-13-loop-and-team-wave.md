# Close the loop + team productivity + capture quality (3 waves)

- **Date:** 2026-08-13
- **Status:** active
- **Type:** plan
- **What:** the picked backlog — A1 result post-back, A2 send-back, A5 activity trace, B1–B4
  (email notify, comments, search, digest), C1 structuring, C3 voice capture — specced as three
  independently shippable waves.

## Why

The pitch is "see it → say it → agent fixes it → human signs off," but today the loop has no
return path (an agent's fix is a bare status flip; sign-off has nothing to look at) and no
doorbell (nothing notifies anyone when a walkthrough lands). Waves in order of leverage.

Owner's forks, settled 2026-08-13: A1 = structured fields **plus** optional markdown body ·
B1 = **email only** (no Slack) · C1 = **on-demand** from the viewer, never auto ·
C2 (repo vocabulary) = dropped.

## Wave 1 — return path + doorbell (A1 + A2 + A5 + B1)

### Schema

- **`WalkthroughNote`** — the review exchange, one chronological thread per walkthrough:
  `role: 'agent' | 'reviewer'`, `summary` (agent: what was done; reviewer: the send-back note),
  `prUrl?`, `filesTouched: string[]`, `bodyMd?`, `authorName` (denormalized token/user name —
  tokens get revoked, users deleted), `createdAt`. Cascade-deletes with the walkthrough.
- **`WalkthroughAccess`** — the trace: `tokenName`, `action: 'pulled' | 'status' | 'result'`,
  `detail?` (the status value), `createdAt`. Written fire-and-forget; `pulled` rows are deduped
  (skip if the same token pulled < 10 min ago). Cascades with the walkthrough, which caps growth
  (retention already deletes walkthroughs).
- **`User.notifyUploads Boolean @default(true)`** — the B1 mute.

### A1 — post_result

- `postWalkthroughResult(auth, id, input)` in `walkthroughs-api.ts` (shared by both MCP servers +
  ingest REST, like every agent-facing read/write). Input: `summary` required, `prUrl?`,
  `filesTouched?`, `body?` (markdown). Creates the `role:'agent'` note, logs `action:'result'`,
  and **auto-flips status open → in_review** (via the same `expiryFor` write path — a result
  posted IS the fix going up). `TokenAuth` gains `tokenName` for authorship.
- MCP tool `post_result` on `server/mcp.ts` and `cli/mcp.ts`; REST `POST
  /api/ingest/walkthroughs/:id/result` (no `/gripes` alias — no shipped client posts it).
- Brief: `formatWalkthrough` renders a `--- review thread ---` section (chronological, roles
  labeled) so an agent re-pulling after a send-back reads the reviewer's note in place.
- Viewer: `viewer/agent-answer.tsx` — "agent's answer" section under the header when the thread
  has an agent note: author + time, summary, PR link, mono files list, body verbatim in a `<pre>`
  (same treatment as report.md — no markdown renderer exists in the repo and the point is
  fidelity). Sign-off row: **Approve & resolve** (→ setStatus resolved) and **Send back** (arms
  an inline note input — ui.md arming rule, no confirm()).

### A2 — send-back

- tRPC `walkthroughs.sendBack { walkthroughId, note }` — requireSpaceAccess, creates the
  `role:'reviewer'` note, sets status → open through the `expiryFor` path (clears any expiry).
  The agent sees the note in the brief's review thread; the walkthrough reappears in its open
  queue. No new agent-side surface needed.

### A5 — activity trace

- Logged in `getWalkthroughDetail` (pulled), `setWalkthroughStatus` (status), `postWalkthroughResult`
  (result) — token surfaces only; the web viewer's own reads are not agent activity.
- `walkthroughs.get` returns `activity` (latest 5) + `notes`; the viewer renders one quiet mono
  line ("pulled by <token> 12m ago") in the agent-answer section (or alone when there's activity
  but no answer yet).

### B1 — email notify on upload

- Hook: ingest FINALIZE, only on the null→set transition of `finalizedAt` (a re-finalize or
  re-push replacement must not re-mail). Fire-and-forget `notifyUpload(id)` in new
  `server/notify.ts`.
- Recipients: **team spaces only** — members except the uploader, `notifyUploads` true,
  `emailVerified` true. Personal-space uploads are always self-uploads; nobody to tell.
- Template in `email.ts`: "<uploader> added a walkthrough to <team>" + title, duration, kind,
  view link — plus a one-click unsubscribe footer link.
- Unsubscribe: `GET /api/notifications/unsubscribe?u=<userId>&sig=<hmac-sha256(userId,
  BETTER_AUTH_SECRET)>` in server.ts (before the SSR catch-all) → flips `notifyUploads` off,
  answers a tiny HTML page. Re-enable: checkbox on /team's personal card via a small `prefs`
  tRPC router (`get` / `setNotifyUploads`).

### Non-negotiables honored

- Status writes go through `expiryFor` (retention gotcha).
- Both MCP servers change only via `walkthroughs-api.ts` / `mcp-format.ts` (two-servers gotcha).
- JSON-safe tRPC returns (ISO dates). Admin debug brief follows for free (same pipeline).
- `handback_test` + local dev need `db push` after the schema change; **check DATABASE_URL
  first** (the prod-flip hazard).

## Wave 2 — team productivity (B2 + B3 + B4)

- **B2 comments**: `WalkthroughComment { walkthroughId, userId, authorName, atMs?, text,
  createdAt }` — optional timeline anchor; panel under the transcript (click a time seeks);
  included in the brief as `--- comments ---`; tRPC add/list/delete (own comments only).
- **B3 search**: generated `tsvector` column on Walkthrough (title + a `searchText` column
  filled at finalize from report.md + transcript lines, capped ~50 KB) — raw SQL migration in
  place (rename-in-place rule applies to adding the column via `db push`, the index via
  `CREATE INDEX ... USING gin` predeploy-safe); `walkthroughs.inbox` accepts `q` and merges
  ranked ids; /app search box queries server-side past the client filter.
- **B4 digest**: weekly per-user email (their spaces: open count, oldest open age, resolved this
  week), sent by an hourly-swept "due" check like retention (no cron infra exists); mute rides
  the same `notifyUploads`-style flag (`notifyDigest`).

## Wave 3 — capture quality (C1 + C3)

- **C1 structuring**: overflow "Split into tasks…" (agent kind, finalized) → server pass
  (`server/structure.ts`, ANTHROPIC_API_KEY, 503-degrades like polish) reads report.md +
  transcript → proposes N children (title, severity, repro steps, acceptance criteria, source
  time ranges) → confirm screen → creates N child walkthroughs sharing the parent's files?
  **No** — children are metadata-only rows pointing at the parent (`parentId`), agents get the
  child's brief = its slice of the report + the parent's files. Human confirms before any row
  is written; metered like polish.
- **C3 voice capture**: third mode on /record — "just talk": mic-only MediaRecorder, no
  getDisplayMedia, straight into the existing voice-note pipeline from /phone (`src/lib/capture`),
  one take, kind agent, no frames. The recorder card copy says what it's for: "describe it in
  words; your agent reads the transcript."

## Sequencing

Wave 1 → ship → Wave 2 → ship → Wave 3. Each wave ends: typecheck green, e2e db pushed,
cliffnotes/updates appended, extension untouched (nothing here needs a republish).
