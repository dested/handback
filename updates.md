# Inloop — Updates

> Terse log of every task: what was asked → what was done. Newest first.

## 2026-07-30 — landing page rebuilt around one worked example
Asked: "website's really cool but it needs screenshots and examples… these people are lazy and
scrolling fast… harp on the smartness of the video processing into images, that's the key part…
the two commands part isn't great." Done: every section now shows the thing instead of describing
it, and one demo gripe (a promo code that applies to nothing at checkout) runs through all of them
so a fast scroller meets one bug, not five. New `demo-shot.tsx` draws a keyframe as SVG (grey app,
cobalt pointer + ink) so the same component serves the hero, the filmstrip, a contact-sheet tile
and the report's inline still; `demo-data.ts` holds the transcript/events/report blocks in the
shapes `buildReport` really emits; `mock.tsx` holds Pane / ContactSheet / Filmstrip / PlayerStrip /
RecordingViewport. Hero now opens on the capture moment (draw-mode frame, dock, live caption)
instead of the loop diagram — which moved to the final CTA as a watermark. New `distill.tsx` is
the centrepiece: raw footage → the frames that survived → a 3×3 sheet, with the mechanism named
(compared against every frame already kept, clicks force a frame, survivors spread across the
take) and no parameters published. "What's in a gripe" dropped its file-path table for four
plain-English cards each carrying the real artifact, with the paths demoted to pane captions.
`cli-strip.tsx` deleted and replaced by `agent-view.tsx` — the MCP call plus a rendered markdown
report.md viewer, setup reduced to one line at the bottom. Sign-off step gained a real before/after
(`FIXED_SHOT`, discount lands, $102.40). Verified in Chrome at 1512px and under Playwright at 390px:
typecheck clean, doc `scrollWidth` 390 with no section overflowing after a `min-w-0` pass.
Touched: src/components/landing/{demo-shot,demo-data,mock,distill,agent-view}.tsx (new),
{hero,how-it-works,gripe-manifest,final-cta}.tsx, cli-strip.tsx (deleted), src/app/home.tsx,
cliffnotes.md, decisions.md.
Note: commit `8dfa40a web1` swept in three temp Playwright scripts (`.mobile-check.mjs`,
`.pw-probe.mjs`, `.pw-w.mjs`); they're deleted in the worktree, uncommitted.

## 2026-07-30 — legal pages, and transcription off the user's laptop
Asked: "i do want the privacy and terms pages on the website... i hate whisper. is there a better
solution to not spin up the users machine... it has to be perfect." Done: `/privacy` and `/terms`
as real routes (`src/components/legal.tsx` shell + the two pages, footer links, Arizona law,
sal@dested.com) stating what's collected, the two transcription modes, AWS + Groq as the only
processors, and the honest gaps (account deletion is manual, no password reset). Then replaced the
on-device Whisper wait as the default: `server/transcribe.ts` (Groq whisper-large-v3-turbo, segments
in ms), `POST /api/ingest/transcribe` (raw WAV body, token-authed, 503s without `GROQ_API_KEY`),
`extension/src/sidepanel/transcribeCloud.ts` (hand-rolled WAV encode, 8-minute chunks, timings
offset back onto the recording clock), the shared decode feeding either engine, `TranscriberId` on
the take + message + report trust line, and a "Transcribe on this device" toggle defaulting off.
Every failure falls back to the worker. tsc clean both workspaces; web + extension bundles build.
Still open: a `GROQ_API_KEY` in prod SSM (without it prod silently stays on-device) and an
end-to-end run against a real recording.
Touched: src/app/{privacy,terms,routes,layout}.tsx, src/components/legal.tsx, server/{transcribe,
ingest,env}.ts, extension/src/{lib/{types,messages,report},background/index,sidepanel/{transcribe,
transcribeCloud,App}}.ts(x), .env.example, cliffnotes.md, decisions.md,
plans/2026-07-30-transcription.md, plans/2026-07-30-go-live.md.

## 2026-07-30 — go-live audit: what's required before strangers can sign up
Asked: "are we all good to send this out to other people to sign up?" → "note that all in a doc
that is known by cliffnotes." Done: audited the deployed app and wrote
`plans/2026-07-30-go-live.md` — four blockers (no password reset or email at all in `auth.ts`;
`presignPut` signs no size limit and there are no per-org quotas; the extension is load-unpacked
only; no S3 round trip has run on prod), the should-fixes (no rate limiting, pricing sells tiers
with no billing, no ToS/privacy, no error tracking), an explicit "already fine" list so the tenant
boundary doesn't get re-audited, and a Chrome Web Store section (the $5 + zip is easy; `<all_urls>`
plus screen/mic capture is what makes the review slow, and the reviewer needs test credentials).
Verdict: fine for people you can text, not for a public link.
Touched: plans/2026-07-30-go-live.md (new), cliffnotes.md (header pointer + Plans section).

## 2026-07-30 — shipped: inloop.dested.com, deployed by Drydock
Asked: "can you deploy this with drydock." Done: pushed the pending 3000 → 3995 port change and
deleted `render.yaml` (Drydock read it once as a detection seed); created the `inloop` project in
the portal (ssr · bun · prisma · database, size `m`, port 3995, predeploy `bunx prisma db push`,
domain inloop.dested.com in the shared dested.com zone), which wired the repo (Dockerfile,
`.github/workflows/drydock.yml`, `drydock.yaml`) in one commit; copied the `inloop-app` S3 keys +
AWS_REGION/S3_BUCKET into SSM and applied so the task def carried all 7 secrets before CI's deploy;
fixed the bucket's CORS origin 3000 → 3995. CI green on the first run, schema pushed by the
pre-deploy task, service steady on rev 3, TLS valid, `/healthz` → ok, landing SSRs.
Touched: cli/push.ts, server.ts, server/env.ts, src/entry-server.tsx, scripts/init.ts, .env.example,
README.md, CLAUDE.md, render.yaml (deleted), cliffnotes.md, decisions.md.

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
