# Inloop — Updates

> Terse log of every task: what was asked → what was done. Newest first.

## 2026-07-29 — root script for the extension build
Asked: "put it in the main node script." Done: `bun run build:extension` at the repo root
(`npm --prefix extension run build`); deliberately NOT chained into `build` — the server deploy
and the extension are different artifacts on different lifecycles.
Touched: package.json, cliffnotes.md

## 2026-07-29 — final UI revision: transcript in full, draw mode that says so, banner dead
Asked: "i dont see that im in draw mode… its not super easy to see the transcript… i dont like
that make sure we got it right banner. final revision update for the ui before production." Done:
draw mode now frames the whole viewport in cobalt with a `drawing · esc to click` tag and the dock
never fades while armed (dock also slightly larger); a full transcript list lives under the
timeline (cobalt mono times, current line follows the playhead, click seeks, double-click edits,
collapsed in the popped strip); the tl-nag banner and tl-ok callout are deleted — the read-back
confirm is one small `reads right` pill in the transcript header (reviewed flag still feeds
report.md's trust line). Verified end-to-end in a real Chromium with the extension loaded
(record → dock → draw frame → ink → stop → take on the timeline, Whisper fetching); preview
harness re-screenshotted; tsc + both builds clean.
Touched: extension/src/sidepanel/{Timeline.tsx,timeline.css}, extension/src/content/{index,ui}.ts, ui.md

## 2026-07-29 — post-review fixes from the panel agent's findings
Asked: (review pass) verify A2-panel's 4 findings; Sal asked for a testable build. Done: wired
`Dictation` into the Recorder's ticker slot (live interim line was dead UI); ported gripe's
micperm.html/js flow restyled to Inloop light (side panel can't render the getUserMedia prompt —
first Record opens the page in a tab; blocked-mic ticker is now a clickable fix); deleted dead
`gridFileName` (lib/report.ts `sheetFile` is the one owner). Findings 2/3 were already resolved in
the final App.tsx. tsc clean, rebuilt, preview CLEAN. dist/ ready for load-unpacked.
Touched: extension/src/sidepanel/{App.tsx,grids.ts,panel.css}, extension/public/micperm.{html,js}

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
