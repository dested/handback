# Inloop — Updates

> Terse log of every task: what was asked → what was done. Newest first.

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
