# Inloop — Updates

> Terse log of every task: what was asked → what was done. Newest first.

## 2026-07-29 — the extension, rebuilt from scratch
Asked: "REBUILD THE EXTENSION FROM SCRATCH… the timeline, the drawing, the shortcuts, the easy
use. Make it incredible." Done: `extension/` — MV3 side-panel recorder porting Gripe's proven
logic (64×64-cell dedup, forced keyframes, one-timeline math, interrupted-take recovery, Whisper
FIFO, dock key guards) with an all-new light/cobalt UI and cloud upload replacing local folders
(session:close carries uploadedUrl; no downloads permission). Worker + content dock/ink, capture
engine, Timeline editor, panel App + report/upload, preview harness with 10:18/150-frame
acceptance seed. tsc clean, both bundles build, gallery screenshots clean at 380/560/900/1500×400,
zero console errors, no orange. Five Opus agents in parallel against frozen lib contracts.
Touched: extension/** (src, scripts, public), ui.md, cliffnotes.md, decisions.md.

## 2026-07-29 — day one: the whole product, scaffold to sign-off
Asked: "Start a fresh repo and start building… web presence to manage your team and see gripes…
full gripe viewer, file storage… finish this project fully including a full website with marketing
and pitch and login." Done: repo from sal-starter (dested/inloop, private); Postgres schema
(orgs/memberships/invites/projects/gripes/takes/files/api-tokens); S3 bucket inloop-files +
scoped IAM + presigned two-phase ingest; `cli/push.ts` (verified with a real 36MB gripe, 172
files) + `cli/dev-bootstrap.ts`; light-only editorial brand (ui.md — paper/cobalt,
Fraunces/Libre Franklin/IBM Plex Mono, loop mark); landing page with pitch + pricing; auth; inbox
with first-run org creation; full viewer (video, filmstrip, transcript, events, report.md);
team/invites/tokens; projects with origin auto-routing; /join links; token REST + stdio MCP
(list_gripes/get_gripe/set_gripe_status); Playwright smoke suite, 4 passing, baselines committed.
Five Opus agents built the UI surfaces in parallel against a shared foundation.
Touched: everything — initial product commit series on main.
