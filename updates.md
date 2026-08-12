# Handback — Updates

> Terse log of every task: what was asked → what was done. Newest first.

## 2026-08-12 — Human handback: pristine video, in-browser tight edit, share links
Asked: record video *for a person* (not an agent), auto-tighten pauses in a browser editor, share
it. Built per plans/2026-08-12-human-handback.md: `Walkthrough.kind` + token-guarded share links
(`/w/:token` public watch page, `walkthroughs.share/unshare/shared`, human walkthroughs hidden
from agent/MCP lists); /record kind picker with pristine capture (30 fps, area-scaled bitrate, no
keyframe sampling); transcript-first editor (delete lines to cut, silence chips from RMS+transcript
agreement, Tighten slider, EDL preview, take reorder); mediabunny render → final.mp4 + edit.json +
re-timed transcript.json upload; done screen mints share link + downloads the MP4 locally.
Typecheck + build green. NOT live-verified (`.env` still points at prod — same hazard as the
web-recorder plan); local + `handback_test` DBs still need `db:push` for kind/shareToken.
Touched: prisma/schema.prisma, server/{router,ingest,walkthroughs-api,storage,trpc,ratelimit}.ts,
src/app/{routes,watch,walkthrough,record,app}.tsx, src/components/{viewer/*,edit/editor,record/*,
phone/stages}.tsx, src/lib/capture/{live,live-store,live-upload,upload}.ts, src/lib/edit/*

## 2026-08-12 — /record: recording from the website, no extension
Asked: run a Handback recording straight from the site, the same way the extension does, for people
who won't install it. Built `/record` — `capture/live.ts` (the extension's `Recorder` ported to a
page: same picker constraints, 64×64 dedup, audio mix + mic-only shadow, frameBudget, chunks to
IDB), `live-store.ts` (IDB `handback-web-recorder`, take recovery), `live-upload.ts` (takes → the
same file set → declare/PUT/finalize). Multi-take, per-take delete + renumber, discard arming,
resume-after-crash, always-on-top Document PiP HUD (its own click — the puck's gesture rule). The
content-script half is absent by construction: no events/pointer/click+nav frames, documented
everywhere. Nav split "Recorder" → **Record** (/record) + **Extension** (/recorder); /recorder and
the empty inbox link across. Extracted the thrice-copied token helper to `lib/capture-token.ts`;
exported the dedup constants + `cellDiff` from `frames.ts` so live.ts shares one copy.
Touched: src/app/{record,recorder,upload,phone,app,layout,routes}.tsx, src/components/record/*,
src/components/phone/stages.tsx, src/lib/capture-token.ts, src/lib/capture/{live,live-store,
live-upload,frames}.ts. typecheck + build + prettier green. **Not verified live** — `.env`'s
`DATABASE_URL` is pointed at PROD, so no dev server was started; see
plans/2026-08-12-web-recorder.md.

## 2026-08-12 — silent-loopback detection + PickGate share-dialog portrait (extension 1.7.2)
Asked (after testing 1.7.0): system audio still missing → diagnosed as Windows loopback routing,
not code; then "remove the diag stuff, make the picking screen better". Kept as product: a level
tap on the system source drives a 3-state HUD line (`none`/`silent`/`live` — "app audio is shared
but silent" catches a granted-but-dead loopback); mixer source nodes held as fields (GC hazard).
Removed: console.info track/graph logs. PickGate 'choosing' redesigned: a dark ShareDialogMock
portrait of Chrome's dialog with the "Also share tab audio" row cobalt-ringed + copy about
headphones/tab-vs-window. Both typechecks + build green.
Touched: extension/src/sidepanel/{recorder.ts,App.tsx,panel.css}, extension/{package,public/manifest}.json

## 2026-08-12 — recorder captures app audio + raw mic (extension 1.7.0)
Asked: takes must carry the headphone/app audio AND the narrator's voice AND the room — was
`getDisplayMedia({audio:false})` + processed mic. Now: display audio requested (raw constraints,
`systemAudio:'include'`), mic raw (AEC/NS/AGC off so the room survives), both mixed via Web Audio
into the webm's one track; a mic-only shadow recording (`<id>:micchunk:*` → `<id>:mic`, crash-safe
like the video chunks) is what Whisper transcribes so app sound never pollutes the transcript. HUD
warns when "share audio" wasn't ticked. Both typechecks + build green. NOT yet published to
releases/ or the Web Store. See decisions.md 2026-08-12.
Touched: extension/src/sidepanel/{recorder.ts,App.tsx,transcribe.ts}, extension/src/lib/{types.ts,
messages.ts,db.ts}, extension/src/background/index.ts, extension/{package,public/manifest}.json

## 2026-08-07 — Web Store live: dual extension-id handshake + set STORE_URL; inbox inline rename
Asked: extension is deployed to the Chrome Web Store — update the website; make it easy to
name/rename handbacks. Found the published store id is `bdhajcll…`, NOT the `key`-pinned
`gmggneb…` the /recorder page hardcoded (pack-store strips `key` → Chrome mints a fresh id), so a
store install could never answer the one-click link. Fixed: `recorder.tsx` now pings `EXTENSION_IDS`
= [store, self-hosted] and links whichever answers; `STORE_URL` set → "Add to Chrome" button, zip
walk collapses. Rename: `walkthroughs.rename` already shipped in the viewer — added inline rename to
each inbox row (hover-revealed "Rename", stretched-link overlay keeps the row navigable). typecheck
green. Extension NOT re-published (no extension/ behavior change). See decisions.md 2026-08-07.
Touched: src/app/recorder.tsx, src/app/app.tsx, extension/scripts/pack-store.mjs, cliffnotes.md,
decisions.md

## 2026-08-06 — extract video-to-prompt library (new repo)
Asked: move the video→prompt logic into a standalone public repo for reuse; leave Handback's copy
in place with notes. Created github.com/dested/video-to-prompt (`G:\code\video-to-prompt`): the
generic pipeline from src/lib/capture (probe/media/frames/grids/audio/timeline/report/container/
format/slug) with upload/auth stripped, pluggable Transcriber/Polisher, ReportOptions for product
wording; typecheck+build green, full cliffnotes kit + README. Handback unchanged except notes —
see decisions.md 2026-08-06 (triple-mirror rule until the cutover).
Touched: decisions.md, cliffnotes.md, src/lib/capture/types.ts (extraction note)

## 2026-08-05 — Chrome Web Store listing packet (copy + images)
Asked: go to the dev console and "fill this out fully — images, descriptions, all that." The console
can't be driven (Chrome blocks scripting the Web Store: "extensions gallery cannot be scripted"), so
built a paste-ready packet instead at `extension/store-listing/`: `LISTING.md` (summary, description,
single purpose, per-permission justifications drawn from the real background/content code, data
disclosures mapped from `src/app/privacy.tsx`, the three certifications, privacy URL) + 6 images. The
4× 1280×800 screenshots are the actual side-panel build (`preview.mjs` harness modes home/long/rec)
captured with Playwright (`channel:chrome`) and framed on-brand (ReturnMark, Fraunces, cobalt/paper);
plus 440×280 tile and 1440×560 marquee. Render script kept in scratchpad. Left the console fill for
the owner to do by hand.

## 2026-08-05 — Chrome Web Store upload fixes (manifest key + description)
Asked: Web Store push rejected — "description too long: 150 (max 132)" and "key field is not
allowed in manifest"; make the changes and re-bundle. Done: shortened `manifest.description` to
128 chars (kept the "you sign off" arc). Left `key` in `public/manifest.json` on purpose — it pins
the local/self-hosted ID to the published `gmggneb…ifdci` that `src/app/recorder.tsx` hardcodes as
`EXTENSION_ID`. Added `extension/scripts/pack-store.mjs` + `pack:store` script that stages `dist`,
strips only `key`, guards description ≤132, and zips → `extension/handback-recorder-store.zip`
(the file to upload). Existing `zip:extension`/self-host flow keeps the key untouched.

## 2026-08-03 — the app rethought: space is an attribute, not a mode
Asked: "this page fucking sucks and its the main page… i have so many teams and projects…
stop making me switch space at the top… i need this rebuilt… make sure the ui looks incredible."
Plus: upload progress proportional (the 50 MB video stalled a file-counted bar) and a straight-up
upload feature in the inbox.
Done: **header SpaceSwitcher deleted.** New no-input `walkthroughs.inbox` + `projects.all`
(server/router.ts — everything the session reaches across Personal + member teams, one query
each, no N+1). Inbox rebuilt (`app.tsx` + `components/inbox/rail.tsx`): filter rail with honest
counts (status "Needs attention" default / spaces incl. empty ones / projects incl. General,
capped 8 + more), search, hairline rows (status ink · title · mono meta with space chip on
All-spaces), skeleton/error/filtered-empty/first-run states, status+space persisted to
`handback.inbox.filters`. **/upload** — desktop drop-zone intake reusing the capture pipeline +
phone components (watchdog/cancel kept; pending-store/wake-lock deliberately not; caps mirror
ingest 2/4 GB). Projects page cross-space grouped (create w/ space select); /team is now
**Teams** — every team as a disclosure (roster/invites/seats, admin gates preserved), New team
moved here from the dead switcher. Nav: Teams always visible. Extension 1.6.3: presigned PUTs
fetch→XHR, byte-true bar + `41.2 of 180.5 MB` detail, 3 retries — published separately. e2e
smoke.spec locators updated to the new copy but **UNVERIFIED** (.env still points at prod, so
the suite wasn't run — run it after flipping DATABASE_URL back and re-baseline screenshots).
Touched: server/router.ts, src/app/{app,layout,routes,upload,projects,team}.tsx,
src/components/inbox/rail.tsx, extension/src/lib/upload.ts, extension/src/sidepanel/App.tsx +
panel.css, extension/{package.json,public/manifest.json}, e2e/smoke.spec.ts, cliffnotes.md

## 2026-08-03 — extension upload progress is byte-true (1.6.3)
Asked: the panel counted files ("part 97 of 100") so the bar sat at ~99% for minutes while the
last 50 MB video went up. Make progress byte-proportional and live during the big PUT.
Done: presigned PUTs moved from fetch to XHR, ported BACK from `src/lib/capture/upload.ts` —
`xhr.upload.onprogress` per file into an in-flight loaded map (bytesDone = settled sizes +
in-flight loaded, so a retry never double-counts), emits throttled to 250 ms, 3 attempts with
1s/3s backoff on a dead socket or 5xx and never on a 4xx (an expired presign won't heal).
Declare/finalize stay on fetch; every request/response shape and error string unchanged.
Panel label is now `uploading — 23%` with a right-aligned mono `41.2 of 180.5 MB`; the existing
cobalt bar's width was already byte-driven and now actually moves. Version 1.6.2 → 1.6.3.
Touched: extension/src/lib/upload.ts, extension/src/sidepanel/{App.tsx,panel.css},
extension/{package.json,public/manifest.json}, cliffnotes.md

## 2026-08-03 — /phone: keyframes best-effort + the iOS speed pass
Asked: second iPhone run died in frame extraction ("that file can't be read as a recording on
this phone") after a slow "reading" stage; "it can't be this slow for a 30 second video…
i think we have to offload it". Desktop run of the same flow worked end to end.
Done: **frame extraction can no longer kill or block a run** — extractFrames+makeGrids sit in
an atomic try/catch (frame files truncated back out on failure) and the take degrades to zero
frames; video + transcript + report always ship, done screen says so. Speed: distill now REUSES
the row's probe via `ClipInput.probe` (the clip was being fully decoded twice — the 1-minute
"reading"), candidate cadence 500 ms → 1 s floor (post-hoc seeks pay real decode latency;
60/min candidates still feed the 40/min budget; MANIFEST wording follows), per-seek
requestVideoFrameCallback dropped for seeked+one rAF (150 ms hidden-tab grace kept). iOS
readiness: `readyVideo` primes with muted play/pause and accepts canplay|loadeddata; one failed
seek skips the candidate, three consecutive rethrow into the degrade. Cliffnotes gotcha updated:
the 1 s cadence is a LEGITIMATE divergence from the extension's 500 ms live sampling. The
durable iOS answer — raw clip up first, server-side ffmpeg keyframes — needs a Drydock change
(ffmpeg in the image, 576 MiB ceiling) and is parked pending Sal's call.
Touched: src/lib/capture/{types,distill,media,frames,report}.ts, src/app/phone.tsx,
src/components/phone/clip-list.tsx, cliffnotes.md

## 2026-08-02 — /phone capture made un-losable
Asked: a real phone walkthrough was lost — the client died during local processing. Harden the
flow so a clip that reached us can't be lost short of explicit discard.
Done: share stash no longer deletes on read (`peekSharedMedia`/`clearSharedMedia`); new
`capture/pending.ts` persists the whole run (files included) to IDB `handback-phone` on every
intake change and at send start, cleared only after finalize or a discard. A share now
auto-starts the run instead of showing a second Send button (working screen gained the
`to {space} · {title}` line; Cancel returns to intake); a reload with no `?shared=1` offers a
violet "didn't finish uploading" resume callout — resume or discard, never automatic. S3 PUTs
moved from fetch to XHR for real byte progress (throttled ~4/s across the 4-way pool) with 3
attempts on network/5xx and 1s/3s backoff, never on 403; abort tears down in-flight XHRs. Added
a screen wake lock (re-acquired on visibilitychange), a beforeunload guard, and a 15s watchdog
that fails a run silent for 2 min instead of spinning forever. Memory-order fix in distill.ts:
audio decode + transcribe + polish now run BEFORE frame extraction so the ArrayBuffer spike
never coexists with 600 JPEGs (stage rows reordered to match); frames report `m:ss of m:ss` and
upload reports MB-of-MB. Per-seek timeout 10s → 20s for slow phone decoders. Also: return-to-
visible resets the watchdog clock (a thawed iOS tab must not be killed before the pipeline
resumes), /recorder on a mobile UA redirects to /phone, and the iOS picker step explains
Photos' "Preparing…" dialog. Root cause of the lost run (iPhone, 5-min clip): prod logs show
context fetched then silence — the client died in local processing, almost certainly a WebKit
memory kill; bucket CORS verified fine (PUT allowed for handback.dev). Typecheck + build clean.
Touched: src/lib/pwa.ts, src/lib/capture/{pending,upload,distill,media}.ts, src/app/phone.tsx,
src/components/phone/{stages,guide}.tsx, src/app/recorder.tsx

## 2026-08-02 — app header works on a phone
Asked: "the header doesnt work on mobile" (found while taking /phone live).
Done: `AppHeader` was one non-wrapping flex row (wordmark + switcher + up to six tabs + sign
out) that overflowed any phone viewport. The nav is now `flex-wrap`: on `md+` nothing changes;
below it the tab list takes `order-last w-full` and becomes its own swipeable second row
(`overflow-x-auto`, scrollbar hidden, `whitespace-nowrap` tabs). Tabs render ONCE — a hidden
duplicate row would break the e2e "Team" locator and double the DOM. Space name in the switcher
trigger truncates at `max-w-32`. Typecheck clean.
Touched: src/app/layout.tsx

## 2026-08-02 — Handback on the phone: PWA + share-target intake at /phone
Asked: run Handback on the phone — install from mobile Chrome as a PWA, "turn on recording",
narrate over any app, stop, upload a walkthrough; "go hard, PiP??".
Done: live in-PWA screen capture is **impossible** (getDisplayMedia never shipped on any mobile
browser — verified via MDN compat data; PiP dies with it), so the shipped design rides the OS
recorder: Android/iOS screen recorders capture with mic, and Handback became an installable PWA
that is an **Android share target** — record → Share → Handback → the browser itself distills the
clip (extension-identical dedup keyframes + contact sheets → `/transcribe` → `/polish` →
report.md/MANIFEST/recording.json) and two-phase-uploads it via the existing ingest API. Zero
server API changes; the page mints an `hb_` token (`Phone — Android, Aug 2`) and re-mints
silently on 401. New: `public/manifest.webmanifest` (standalone, maskable return-mark icons,
"New walkthrough" shortcut, share_target) · `public/sw.js` (share-POST stash → IndexedDB
`handback-share`, **caches nothing**) · `cli/make-pwa-icons.mjs` · `src/lib/pwa.ts` (register,
install prompt, share pickup) · `src/lib/capture/*` (the ported pipeline, 17 modules) ·
`src/app/phone.tsx` + `src/components/phone/*` (guide per platform / intake / staged distill /
done / failed) · `POST /share-target` Express fallback · `/phone` route + APP_PREFIXES ·
autoTokenName knows iPhone/iPad. Multi-clip = rec-NN takes (ordered by file mtime); voice-note
mode records mic-only in page; iOS = A2HS + Photos picker (no share target there, ever). Client
size guards mirror ingest (2 GB/file, 4 GB/walkthrough). Typecheck clean. Design + limitations:
`plans/2026-08-02-phone-pwa.md`. Not yet done on purpose: on-device QA (needs a real phone),
inbox/landing links to /phone.
Touched: public/*, cli/make-pwa-icons.mjs, index.html, src/index.tsx, src/lib/pwa.ts,
src/lib/capture/*, src/app/phone.tsx, src/components/phone/*, src/app/routes.tsx,
src/app/layout.tsx, src/components/setup-step.tsx, server.ts, cliffnotes.md, decisions.md

## 2026-08-02 — recorder mic/screen-picker moments as full-panel gates (1.6.2)
Asked: the first-time microphone step and Chrome's "which window" screen-share dialog should take
over the whole extension panel with an explanation instead of leaving it sitting "like a lump"; on
mic-grant it should return to record on its own.
Done: two new full-container takeovers in `App.tsx`. `micGate` — first-run mic: pressing Record with
the mic ungranted now raises an in-panel screen ("First, turn on your microphone") with an *Enable
the microphone* button (opens `micperm.html`) and a *skip — record without narration* link, instead
of the old one-line flash + silent tab. A `useEffect` watches `navigator.permissions` mic state
while the gate is up and, the moment it flips to `granted`, closes the gate and starts recording
via a `startRef` (no second click). `picking` — the screen-share dialog: set `'choosing'` right
before `getDisplayMedia` (panel says "Pick what to record" behind Chrome's popup), flipped to
`'refused'` on cancel ("Nothing picked yet" + *Choose a screen* / *not now*), cleared on success
after seeding a live-readout so Home never flashes between. Both gate the body via an `overlay`
flag so Home/editor/footer don't render underneath. Dropped the old `micTabOpened` ref. New `.gate*`
CSS block (reuses cobalt/paper tokens). Version 1.6.1 → 1.6.2. Typecheck clean, both bundles build,
zip rebuilt (`extension/handback-recorder.zip`); MicGate + refused-PickGate verified in the preview
harness (mode=home). **Needs republish** (`bun run publish:extension`) to reach installs.
Touched: extension/src/sidepanel/App.tsx, extension/src/sidepanel/panel.css,
extension/{package.json,public/manifest.json}

## 2026-08-02 — /connect: Windows-correct `claude mcp add` command
Asked: make "Create my command" detect Windows and emit a command that actually runs there.
Done: the `mcpCommand` builder used Unix `\` line-continuations, which cmd/PowerShell treat as
literal (they'd run only the first line). `ConnectPage` now detects the OS on mount
(`/win/i.test(navigator.userAgent)`, SSR-safe like `origin`) and threads `isWindows` into
`mcpCommand`, which returns the command on a single line for Windows and keeps the readable
multi-line POSIX form otherwise. Typecheck clean.

## 2026-08-02 — recorder upload 404 fix + destination/header UI cleanup
Asked: extension upload failed at finalize (404 "Unknown walkthrough"); make the header space
dropdown legible; reword "record a take"; rename "no project" and merge the space+project double
dropdown into one clean control.
Done: fixed the finalize 404 — `upload.ts` still destructured `gripeId` from declare, but the
server renamed that field to `walkthroughId`, so it was undefined and finalize hit
`/gripes/undefined/finalize` → "Unknown walkthrough". EVERY extension upload was broken (CLI
unaffected — it reads `walkthroughId`); aligned the declare/finalize URLs to `/walkthroughs*` too.
Merged the send-view space + project selects into one grouped `DestinationPicker` (trigger
"to <space> · <project>", one upward panel grouped by space, `General` = project-less, one click
sets both); "no project" → **General**. "record a take" → "add another recording". Header
`SpaceSwitcher` now shows a muted "Space" label. Extension 1.6.0 → 1.6.1 — **needs republish**
(`bun run publish:extension`) to reach installs; verified in the preview harness (mode=long).
Touched: extension/src/lib/upload.ts, extension/src/sidepanel/App.tsx,
extension/src/sidepanel/panel.css, extension/{package.json,public/manifest.json}, src/app/layout.tsx

## 2026-08-02 — admin team-page member management
Asked: "i need to be able to add and remove members and stuff" on /admin/teams/:id.
Done: admin.addTeamMember (by email of an existing account, seats enforced) / removeTeamMember
(owner blocked, inline-armed) / setTeamMemberRole (instant select, owner immutable) /
revokeInvite; team page grew the add form, per-row role select + remove, invite revoke links.
Touched: server/router.ts, src/app/admin/team.tsx

## 2026-08-02 — admin deletes, admin move, walkthrough debug page
Asked: "delete user (keeps teams), delete team, move walkthroughs between teams, and a pretty
debug view — I want to see the cutting and prompt stuff".
Done: admin.deleteUser/deleteTeam (typed-confirm danger zones, S3-prefix-first, guards: self/
admin/owner), relocate() extracted and shared with admin.moveWalkthrough (any team or uploader's
personal, quota kept), /admin/walkthroughs/:id — exact MCP brief (real pipeline), frame-cap
line, takes, full file inventory w/ presigned links + pending flags, raw report.md, move control.
Touched: server/router.ts, src/app/admin/{user,team,walkthroughs,walkthrough-debug}.tsx,
src/app/routes.tsx, cliffnotes.md
Asked: "show me the list of teams, make admin expandable, shadcn sidebar, full real admin" +
"usage stats per user per team".
Done: hand-rolled sidebar primitive (ui/sidebar.tsx + tokens); admin split into nested pages —
overview, users(+detail: tokens/teams/toggles/walkthroughs), teams(+detail: roster, invites,
projects, seat-limit editor), platform walkthrough feed, usage vs quota; adminRouter grew
overview/user/teams/team/walkthroughs/usage/setSeatLimit. Typecheck green.
Touched: server/router.ts, src/components/ui/sidebar.tsx, src/app/admin/* (9 files),
src/app/{routes,layout}.tsx, src/styles/app.css (admin.tsx deleted)

## 2026-08-02 — cross-account cache leak on re-login
Asked: "when i log out and log back in it keeps the header... it had the other user's teams".
Done: `clearIdentity()` in space.tsx (queryClient.clear + drop handback.activeSpace), called at
all three identity boundaries — sign-out, sign-in, sign-up. e2e 4/4.
Touched: src/lib/space.tsx, src/app/{layout,sign-in,sign-up}.tsx

## 2026-08-02 — workspaces removed: Teams + your one Personal space
Asked: "no more workspaces at all... just teams and your personal", per-seat teams paid by a
transferable owner, migration with zero data loss, change everywhere incl. extension.
Done: Org→Team (ownerId/seatLimit/transfer), personal = teamId null owned by user, guests
deleted, tokens user-scoped, ingest/MCP re-scoped (`space`, `?team=`, declare teamId), Space
context + switcher client-wide, extension 1.6.0 (one link per server, destination picker),
`cli/migrate-teams.ts`. Migration hit PROD early (.env pointed at prod) — ~15 min of 500s until
the deploy rolled; audit confirmed zero loss. e2e 4/4. Per plans/2026-08-01-teams-restructure.md.
Touched: prisma/schema.prisma, server/* (access.ts new; membership/orgs deleted), src/lib/space.tsx,
src/app/*, extension/src/*, cli/*, e2e/*

## 2026-08-01 — the walkthrough panel, rebuilt ("i hate this ui. god i hate it so much")
Asked: the recorder panel's walkthrough surface — four bands of chrome, a timeline nobody could
use, no way to drop a take, no way to pick a project.
Done: **deleted** the puck (content/puck.ts + every message/type/CSS behind it), the popped editor
strip (`?pop`, `strip:track`, the whole `wide` layout), **mark** (hotkey, dock key, `reason`
member, report ★ annotations + counts, the never-thin carve-out), the timeline's **entire
selection model** (sweep, marquee, modifier clicks, `delete N items`, drag-to-move — and the now
callerless `timeline:move`/`timeline:delete`/`recording:frame:delete`/`recording:line:delete`),
and the transcript's `reads right` pill. **Built**: the timeline as a pure scrubber (one gesture,
pointer-down anywhere on the axis); a **take lane** with per-take delete (`take:delete` — drops
row/frames/blobs, renumbers the rest 1..N) arming inline and clamped into the viewport; an
empty-timeline branch (`.tl.bare` — one line, no ruler/well/scrollbar); a two-row header
(crumb+meta, then title + `record a take`); zoom folded small and right-aligned into the readout
row; and a **project picker that never hides** (`no project` / `projects unavailable · retry`, plus
a route to /projects). Harness gained `mode=fresh` and `?ctx=none|fail`. Verified: root typecheck
and `extension: tsc` green, both vite builds green, all modes walked at 380/560 in the harness
(take delete → renumber → last-take-gone → fresh empty state). Nothing under server/ or src/ reads
`reason`, so dropping `mark` from recording.json is safe.
Touched: extension/src/{lib/{types,messages,report}.ts, background/index.ts, content/{index,ui}.ts,
sidepanel/{App,Timeline,Home}.tsx, sidepanel/{recorder.ts,panel.css,timeline.css}},
extension/public/manifest.json, extension/scripts/preview*

## 2026-08-01 — /connect is one button and one paste ("i hate it, i need it to be better")
Asked: /connect demanded ~9 interactions — name a token, create it, then reason about "you already
have 2 active tokens" before a command with `hb_your_token_here` in it became copyable.
Done: collapsed the mint + command into **one cobalt "Create my command"** button — auto-names the
token (`Claude Code — <OS>, <date>`, `autoTokenName` in setup-step.tsx) and renders the real
`claude mcp add` line with Copy in place. Before the click the command is a visibly **inert
preview** (dimmed, `select-none`, no Copy). Killed the token-inventory paragraph and the second
create form; "Your API tokens" is now list + revoke only. Steps 01–04 → **01/02**, with tools,
"Putting it to work", disconnecting and tokens demoted to unnumbered reference. /recorder: 03
"Record" → unnumbered "Then just record"; dropped the removed **Alt+Shift+M mark** hotkey; fixed
two stale "Team → API tokens" links to /connect; recorder tokens auto-named too.
Server: `tokens.create` also returns `{ id, name }`; new `tokens.rename` behind the optional
rename link. Verified: typecheck green, both pages walked in Chrome (one click → real command).
Touched: src/app/connect.tsx, src/app/recorder.tsx, src/components/setup-step.tsx, server/router.ts

## 2026-08-01 — the puck earns its pixels ("this looks like shit haha")
Asked: first live run worked but the body was tall, empty, and mute about its purpose.
Done: inner window 320×118 (was 300×170; Chrome's PiP title bar sits on top regardless). Body is
now one card: cobalt-wash **rail** under a bigger drop-shadowed arrow (tip still the content's
(0,0)), one status row (pulse · mono clock · **pin-count chip** · mic · compact mark/stop pills),
and a ruled caption well that, when idle, **rotates the sales pitch** ("park the tip on it —
parking marks the moment" / "click the arrow to drop a numbered pin" / "this card is in the
recording. that's the point"). `app-region: drag` on the body so the whole card drags, buttons
no-drag (best-effort — falls back to the title bar). Parking now flashes "parked — moment kept";
pins flash "pin N dropped" and feed the chip. All still CSSOM-only styling (page CSP).
Verified: extension typecheck green, builds (content.js 21.6 kB). Live look still Sal's call.

## 2026-08-01 — the puck escapes the side panel (re-plumb of the entry below)
Asked: puck button just said "couldn't open the pointer" (then `undefined`, then hangs).
Found: **`documentPictureInPicture.requestWindow()` only works from extension pages in real
tabs** — side panel / popup / offscreen all hang or reject `undefined`, even though the API
object exists there (chromium-extensions list confirms; the "verified in side panel" check
only proved the property, not the call). Rebuilt the opener where the gesture is real: the
**page dock** gained `point` (`p`); `content/puck.ts` (new) builds the PiP doc CSP-proof —
no innerHTML (Trusted Types), no `<style>` (style-src), everything createElement + `.style`
writes, dot-pulse via interval not keyframes. Two new messages: `recording:puck` (~150ms
heartbeat: geometry up, `PuckBeat` clock/captions/onFrame/active down; 3 unanswered beats =
close) and `recording:pin` — panel answers both, worker explicitly returns false so it can't
race the reply channel. Recorder: puck slot got 1.2s staleness (messaging can die silently),
`liveStats()`, `MicState`/`PuckTelemetry`/`PuckBeat` moved to lib/types. Panel: puck button
gone, replaced by a cobalt note pointing at the dock when the capture is screen-shaped.
`sidepanel/puck.ts` deleted. Trade-off recorded in decisions.md: puck dies if its host tab
navigates; dock button reopens it.
Touched: extension/src/content/{puck.ts (new),index.ts,ui.ts}, extension/src/lib/{types,messages}.ts,
extension/src/{background/index.ts,sidepanel/{App.tsx,recorder.ts,panel.css}}, decisions.md,
plans/2026-08-01-draw-anywhere.md
Verified: extension builds (content.js 14→20 kB); typecheck clean except two unused-var
errors in the other session's in-flight Home refactor (App.tsx `dateTime`, Home.tsx
`openSessionId`) — not touched. Still needs the live run: record entire screen → `p` on the
dock → Excel → park/pin.

## 2026-08-01 — a way out of an open walkthrough (back + discard)
Asked: "i need a way when im in a workflow to like discard it and go back and stuff. its super hard
to navigate. its cool that you save it but like come on."
Done: the open walkthrough gained a crumb row above its title — **← all walkthroughs** on the left,
**discard** on the right, neither of them anywhere near Send. Back is pure view state
(`browsing` in App.tsx): the session stays active in the worker, so the next take still lands in
it, reopening the panel lands back in the work, and its row on the home screen sorts first with a
cobalt rule and an `open · resume` tag. Discard arms first (`discard 2 takes? yes, discard / keep`,
one line so nothing shifts), deletes the session + takes + blobs, and lands on the home screen
rather than dropping you into whatever walkthrough the worker falls back to; disabled while
recording or uploading. Record from the home screen clears `browsing` — a take belongs to the open
walkthrough. Removed the old foldable "earlier walkthroughs · N" list and its `.sessions`/`.srow`
CSS: two competing lists of walkthroughs was the navigation problem. Typecheck green; round trip
verified in the preview harness (editor → back → home → resume → editor).

## 2026-08-01 — the recorder's empty screen becomes the workspace
Asked: "the look and feel of this empty screen is pretty terrible. make this 10x better. show the
previous walkthroughs and stuff, teams, projects, everything."
Done: new `extension/src/sidepanel/Home.tsx` — the panel with nothing open is now the workspace
seen from the recorder. Record stays the loudest thing on it; below it, in hairline-divided
sections: the **destination row** (active workspace + host + project count, click = switcher over
every linked workspace + "link another"), the **workspace's queue** pulled live from
`GET /api/ingest/walkthroughs` (`extension/src/lib/walkthroughs.ts` — status dot in the three fixed
inks, duration/takes/project/`ago`, console-error count, click opens the viewer; status *and*
project chips filter it, counts included; six rows then "show all N"), **on this machine** (every
local session with takes/duration/origin, drafts sorted first, draft/closed/handed-over tags, ↗ to
the uploaded copy, × to forget), and a footer line to `/connect`. Supporting: `sessions:summary`
message + background handler (its own message, not a `state:get` field — that lands on every
broadcast and this walks all takes' metadata), `ago`/`dateOnly`/`hostOf` in `lib/format.ts`,
~330 lines of panel.css. Every failure degrades to a line of text — an unreachable workspace still
leaves a recorder you can record with; unlinked shows a link callout and the local list. Visible
"gripe" strings in the panel → "walkthrough". Preview harness gained `?mode=home` (+`&unlinked=1`,
both in the gallery bar), a stubbed `fetch` for `/api/ingest/context` and `/api/ingest/walkthroughs`
in the server's real shapes, and a `sessions:summary` handler; verified at 360/420/460px.
Recorder bumped 1.4.0 → **1.5.0** — needs `bun run publish:extension` to reach installs.
Note: `tsc` reports one unused `puckLive` in `recorder.ts` from another session's in-flight puck
heartbeat refactor, untouched here.

## 2026-08-01 — the website walkthrough lands: rename, personal workspaces, honest landing (walkthrough 212801d8)
Asked: 10:40 recorded pass over handback.dev — rename "gripe", kill the org-naming screen, rethink
workspace/team, de-bug the narrative, fix the hero, pricing quotas, drop origins, FOUC.
Done, four Opus agents + review: **gripe → walkthrough** across DB (`ALTER … RENAME` on local +
`handback_test`; prod pending — see below), tRPC (`walkthroughs.*`), MCP tools
(`list/get/set_walkthrough*`), routes (`/walkthroughs/:id`, old path 302s), UI, CLI, README, and
the recorder's emitted report.md (strings only; extension identifiers untouched — other session
owns that workspace). S3 prefix + `/api/ingest/gripes*` aliases frozen on purpose. **Workspace
model**: `Org.personal`, sign-up hook auto-creates "<First>'s workspace", `orgs.ensurePersonal`
repair, teams created from the new header switcher (entitlement-gated), invites refused on
personal orgs, Team page split into personal/member/guest cards, tokens moved to /connect,
origin-hints out of the Projects UI. **Landing**: H1 "Debug and review your app in your own
words.", RecorderPanelMock beside the hero frame, step 04 = notified + sign off, `claude mcp add`
block removed, pricing per-tier hour quotas. **FOUC**: dev injects `app.css?direct` link before
first paint. Typecheck green; e2e 4/4 (baselines re-shot); MCP tools/list + ingest aliases
verified live. ⚠️ Prod: run the four `ALTER TABLE` renames on the prod DB, then push `main`
back-to-back (walkthrough reads 500 in the gap); `.env` was flipped back from the prod DB to
local Postgres deliberately.

## 2026-08-01 — the puck: pointing outside Chrome, designed AND built (gripe 3f491ef7, 2:21)
Asked: revisit draw-anywhere ("really important") for the Excel-outside-Chrome case; make it great.
Done: design in `plans/2026-08-01-draw-anywhere.md` (supersedes the three-path analysis; decision
recorded), then built same day after Sal confirmed `documentPictureInPicture` IS in the side panel.
Core move: a Document PiP window is always-on-top and captured by getDisplayMedia for free — so a
cobalt **arrow-tip puck** (tip at the window's top-left inner pixel, body = out-of-Chrome dock with
clock/live captions/mark/stop) is the pointer over any app. Tip coords feed the existing
`PointerSample`→`mapPointer`→crosshair pipe (second slot, fresh page sample wins, parked puck never
stale); parking forces a mark like stroke-end; **pins** (arrow-click or `p`) paint numbered
hold-then-fade dots onto keyframes ("these three cells"); dedup sigs carry the puck rect and
`cellDiff` masks the union so its ticking clock can't burn the frame budget; off-recorded-monitor
⇒ puck greys out with "off the recording". Zero new messages/worker/server changes; captions
always-on per Sal.
Touched: extension/src/sidepanel/{puck.ts (new),recorder.ts,App.tsx,panel.css},
extension/{package.json,public/manifest.json} (1.3.1→1.4.0), plans/2026-08-01-draw-anywhere.md,
decisions.md, cliffnotes.md
Verified: both typechecks green, extension builds. NOT yet driven in a live take — needs a manual
run (record entire screen → open puck → Excel → park/pin) before `bun run publish:extension`.

## 2026-08-01 — the panel stops fighting back (gripe 3f491ef7)
Asked: gripe "Walkthrough" — a 2:39 narrated pass over the recorder panel, eight complaints. Built:
drag now **scrubs** everywhere (sweep/marquee moved behind shift); `delete` + `clear` → `delete N
items` + `deselect`; the **axis** takes the slack and holds a floor of ruler + two lanes while the
**monitor** caps at 50% and collapses when it has no frame; the gear is labelled `⚙ settings` with
an active state and the drawer got a header + close (it read as "content just streamed in"); the
live block regrouped with a real two-line dictation well; `1 lines` → `1 line`; "record another
take" → "add more". Also **un-broke the preview harness** — blank since the multi-workspace change,
because its `SETTINGS` stub predates `settings.links` and `activeLink()` threw on render.
Not built: draw-over-the-whole-screen (2:21) — impossible in MV3, forked in
`plans/2026-08-01-draw-anywhere.md`, needs Sal's call.
Touched: extension/src/sidepanel/{App.tsx,Timeline.tsx,panel.css,timeline.css},
extension/src/lib/format.ts, extension/scripts/preview/preview.html, cliffnotes.md, decisions.md
Verified: both typechecks + both bundles build; driven in the preview harness at 400px — plain
drag scrubs with no selection bar, shift-click extends a range, bar reads `delete 2 items` /
`deselect`, lanes never crushed, settings drawer labelled. Rides unpublished 1.3.0; needs
`bun run publish:extension` to reach installs.

## 2026-08-01 — one command publishes the recorder
Asked: "how is the extension deployed to s3 — i have the build but not the deploy, add it to
package.json". Built: `zip:extension` (pwsh `Compress-Archive` of `extension/dist/*` →
`extension/handback-recorder.zip`, gitignored) and `publish:extension` = build → zip →
`bun cli/publish-recorder.ts`, which uploads to `releases/recorder/<version>.zip`. Zipping stays a
shell step because bun can't write a zip and spawning Compress-Archive *from* bun hangs — via a
package script it doesn't (verified). Windows-only as written.
Touched: package.json, cliffnotes.md
Verified: `bun run zip:extension` produced a 6.1 MB zip newer than `dist/`; versions agree at 1.3.0
across extension package.json / public manifest / dist manifest, so publish's guards pass. Upload
itself not run — 1.3.0 is still unpublished, say the word.

## 2026-07-31 — the keyframe cap scales with take length
Asked: "is there a cap at 150 key frames? there shouldn't be" → scale it by duration, and move the
agent brief's cap with it. Built: `frameBudget(durationMs)` in the recorder — 40 frames/min clamped
to [150, 600], so short takes are unchanged and a 15-min take keeps 600 instead of 150; marks are
still never thinned and survivors are still spread uniformly. Server side, `briefFrameLimit()` in
mcp-format scales the brief's frame sample 8/min clamped to [30, 120] (was a flat 30). Extension
bumped 1.2.0 → 1.3.0 — **needs build + zip + `bun cli/publish-recorder.ts`**, a push to main won't
ship it.
Touched: extension/src/sidepanel/{recorder.ts,Timeline.tsx}, extension/{package.json,public/manifest.json}, server/mcp-format.ts
Verified: `bun run typecheck` + `cd extension && npm run typecheck` both clean.

## 2026-07-31 — an admin token sees every workspace over MCP
Asked: "if i use an admin token in the mcp server it should work too" (confirmed: always
cross-workspace, no opt-in flag). Built: `authenticateToken` resolves `isAdmin` off the token's
owner; `gripes-api.ts` gained `orgScope()`/`inScope()` and now takes the whole `TokenAuth` —
`listGripes`/`getGripeDetail`/`setGripeStatus` span every workspace for an admin, including the
status write. New **`workspace`** field on every list row and brief; MCP tool descriptions carry an
admin-scope sentence and 404 copy reads "on this Handback". Uploads unchanged — declare/finalize
still pin `auth.orgId`. Both surfaces (`/api/ingest`, `/mcp`) inherit it from the shared module.
Touched: server/{gripes-api,ingest,mcp}.ts
Verified: `bun run typecheck` clean. No live token round-trip — local `.env` points at prod.

## 2026-07-31 — /admin can open any user's gripes
Asked: "let me see all the gripes for each user" (confirmed: everything in the workspaces they
belong to, not just their own uploads; admins may open them in the viewer). Built:
**`admin.userGripes`** — grouped by workspace, guest scoping honoured so it's "what this user
sees", unfinalized gripes included and flagged `unfinished`; a **view/hide** column on /admin
expands into that list (status pill, project, origin, who uploaded, duration, size, date, link to
the viewer). **`requireViewAccess`** (`server/membership.ts`) is the read-only platform-admin
escape hatch, wired into `gripes.get` + `gripes.fileUrl` only; `gripes.get` returns
`viewerIsMember`, and `GripeControls` renders an "admin view · read only" chip plus the agent-brief
copy instead of the status/project/move/delete row. See decisions.md.
Touched: server/{membership,router}.ts, src/app/admin.tsx, src/components/viewer/gripe-controls.tsx
Verified: `bun run typecheck` clean; dev server boots, `/healthz` 200, `/admin` 302s signed out.
Not click-tested signed in — local `.env` still points `DATABASE_URL` at the prod box.

## 2026-07-31 — the roster goes private, and everything gets a rename
Asked: "I shouldn't be able to see other people in the team… keep it clean" + "rename walkthroughs
and change workspace and projects and stuff" (confirmed scope: roster admin-only; rename all the
things; full cross-workspace gripe moves). Built: **`orgs.members` now requires admin** — members
and guests get FORBIDDEN and the Team page shows them only their own tokens (no tab strip when
there's one tab; header reads "Your API tokens for X"); **`orgs.rename`** (inline on the Team
header, admin+, slug stable); **`projects.update`** (name + originHints, inline editor on
/projects, org-scope); **`gripes.rename`** (same access bar as setStatus; optimistic inline edit
in the viewer header, invalidates get + list); **`gripes.moveToOrg`** — whole-workspace membership
on BOTH orgs, destination quota via ingest's exported constants, slug suffixed on collision,
S3 objects copied server-side 8-at-a-time (`storage.copyObject`, CopySource segment-encoded),
copy → row flip (project cleared) → best-effort old-prefix delete; viewer gains a
"Move to workspace…" select with confirm that follows the gripe by switching the active org.
⚠ Found while verifying: **local `.env` DATABASE_URL points at the prod box** (52.24.94.83/inloop)
— flagged to Sal, not changed; e2e skipped for exactly that reason.
Touched: server/{router,storage,ingest}.ts, src/app/{team,projects}.tsx,
src/components/viewer/{gripe-header,gripe-controls}.tsx, cliffnotes.md, updates.md.

## 2026-07-31 — the recorder learns to hold more than one workspace (1.2.0)
Asked: an invitee's walkthrough landed in *their* workspace and nothing let them re-point the
recorder at ours, or pick a project — "make it incredible". Root causes: /recorder linked whatever
org was active with no picker on the page, the extension stored exactly one server+token, and
projects didn't exist in the panel at all. Built, across all three halves: **extension 1.2.0** —
`Settings.links: WorkspaceLink[]` (id `${serverUrl}::${orgId}`, one slot per server+org, active
link switchable; 1.1.x flat fields migrate on first read), a **destination row above Send**
("to [workspace] · [project]" — project defaults to `auto → <hint match>`, hides when the list
can't be fetched or is empty), Workspaces list in settings (click to activate, × to unlink,
hand-paste adds a link whose org name self-heals), per-gripe `Session.projectId`; **server** —
`GET /api/ingest/context` (org + projects for the token) and `projectId` on declare (validated
against the token's org *before* the destructive slug replace — review caught that ordering,
a bad projectId would have deleted the old gripe first); **web /recorder** — inline workspace
picker in step 02, `handback:link` now carries orgId, banners keyed per-org ("linking adds a
destination", never "replaces"), legacy single-link pings still read correctly. Quality gate
traced every hop, found no contract mismatches; its one "bug" (stale LinkStep phase across org
switches) was a false positive — `<Recorder key={org.id}>` remounts the subtree. ui.md's panel
section rewritten to match. Both typechecks green; extension builds. **Not yet published to
`releases/recorder/`** — build + zip + `bun cli/publish-recorder.ts` must ship with the deploy,
or 1.1.x installs meet a server they half-understand.
Touched: server/ingest.ts, src/app/recorder.tsx, extension/src/{lib/{types,messages,upload,
context},background/index,sidepanel/{App,transcribe,panel.css}}, extension/{package,public/
manifest}.json, ui.md, cliffnotes.md, updates.md.

## 2026-07-31 — the recorder ships from our own bucket, not from a private repo
Asked: "what if we self host the release.. im not ready for it to go public yet" → picked the
login-gated download. Context that shaped it: **you can't self-host a `.crx` anymore** — Chrome has
blocked off-store installs on Windows/macOS for ~a decade, so the only real alternatives were an
**Unlisted** Web Store listing (not searchable, still one-click + auto-update) or enterprise policy.
Built the interim: **`GET /download/recorder`** (better-auth session or bounce to /sign-in; 302 to a
presigned S3 GET, so bytes never cross the 576 MiB container), **`server/releases.ts`** — the newest
zip under `releases/recorder/` *is* the release, no constant to bump, 60s cache, S3 failure degrades
to "no build" rather than taking the page down — and **`recorder.release`** tRPC. `/recorder` now
links the authenticated download instead of the private GitHub release (which 404s for every
teammate) and, since nothing off-store auto-updates, **compares `handback:ping`'s reported version
against the published one and nags** with a re-download. 1.1.1 uploaded and verified end to end:
signed-out → /sign-in, signed-in → 200 + a valid 17-entry zip whose manifest reads 1.1.1; version
compare unit-checked over 8 cases. Also `cli/publish-recorder.ts` (refuses a missing/stale zip or
one whose version disagrees with package.json). Two bun traps found and written down: a **streamed
S3 `Body` hangs forever** (buffer instead) and **spawning `Compress-Archive` from bun hangs**, so
zipping stays a shell step. Corrected stale copy claiming the listing was "in review". e2e 4/4.
Touched: server.ts, server/{releases,storage,router}.ts, cli/publish-recorder.ts,
src/app/recorder.tsx, cliffnotes.md, updates.md.

## 2026-07-31 — S3 moved to handback-files, and /recorder stops repeating itself
Asked: pull gripe `85142440` over the hosted MCP as a real download test, then act on it.
`get_gripe` round-tripped fine (report.md + presigned URLs for all 33 files; read the 3 contact
sheets + the marked stills). The gripe's own content was two defects on `/recorder`, both fixed:
step 01 rendered the three-step zip walkthrough unconditionally, so a green "Recorder 1.1.0 is
installed" sat *under* instructions to install it — the steps now collapse behind a
"Reinstall or update it" disclosure once a ping answers (`InstallInstructions` extracted); and the
Link button stayed primary/"Link <Org>" directly beneath the green "Linked." banner, because
`alreadyHere` required `phase === 'idle'` — split into `detectedHere` (banner, still phase-keyed)
and `linkedHere` (button → outline "Re-link" the moment linking succeeds). Step 02's blurb goes
past-tense once linked.
Infra, by hand rather than by Drydock: created **`handback-files`** (BPA on, CORS copied forward)
+ IAM user **`handback-app`** with a bucket-scoped inline policy, new access key; verified
PUT/LIST/presigned-GET, CORS preflight, and AccessDenied on any other bucket, then re-ran the same
round trip through `server/storage.ts` itself (presignPut → PUT → presignGet → getObjectText →
deletePrefix). Deleted `inloop-files` (234 objects, ~51 MB — the two test gripes, no data worth
keeping) and IAM user `inloop-app` + its key. Updated `/drydock/inloop/{S3_BUCKET,
AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY}` in SSM and forced a new ECS deployment; the running task
started 56s after the SSM write, so it holds the new values. Deploy target confirmed along the
way: the Drydock project is **still named `inloop`** (SSM `/drydock/inloop/*`, ECR `drydock/inloop`,
service `drydock-inloop`) — the cliffnotes' open question, now closed.
Local `.env` keys rotated too (backup at `.env.bak-preS3`).
Touched: src/app/recorder.tsx, cliffnotes.md (Storage + Deploy)

## 2026-07-31 — an invite now survives sign-up
Asked: "invited a friend, they got the email, created an account, but it doesn't seem to have linked
us" (had to generate a second link and click it again). `/join` sent signed-out visitors to a bare
`/sign-up` and told them "then reopen this link" — nobody does, so the account was created and the
invitation orphaned. The invite id now rides through auth: `/join/:id` links to
`/sign-{up,in}?invite=<id>`, both pages return to `/join/:id?accept=1` on success (and
`redirectIfSignedIn` bounces there too instead of `/app`), and `/join` auto-accepts once on that
flag. Sign-up prefills the invited address and reads "Then you'll join <Org>." Then, asked: block a
mismatched address — an **addressed** invite now only accepts from that address (`invites.accept`,
403, case-insensitive), because invite mail gets forwarded; `/join` says so up front instead of
after the click and skips auto-accept. A **link with no address stays open** — that's the copy-a-link
invite.
Verified in a clean browser: signed-out join → create account → landed `/app` with a `member`/`org`
membership and `acceptedAt` stamped; signed-in `/sign-up?invite=` 302s straight into accept; direct
`invites.accept` POSTs → wrong address 403, no-address 200, `DESTED@Gmail.com` vs `dested@gmail.com`
200. Test rows cleaned out of the dev DB.
Touched: src/app/{join,sign-up,sign-in,routes}.tsx, server/router.ts

## 2026-07-31 — eventCount → errorCount, and droppedCount reaches the agent
Asked: "why was event count 0" → then "yes both" to the two fixes it surfaced. **The 0 was correct**:
`PageEvent` is only `error|warn|network` (console tap in `extension/public/injected.js`), so it never
counted clicks — those become forced keyframes (`recording:force`, `why:'click'`), which is why 26
frames sat next to 0 events and proves the tap was alive. The name was the bug. Renamed
`eventCount` → **`errorCount`** across schema/ingest/gripes-api/router/push CLI/extension uploader/
inbox badge/viewer header, and added **`droppedCount`** (errors seen on a non-recorded tab, already
counted by the recorder and printed in report.md but never reaching the brief) so an agent can tell
"the page was clean" from "we weren't watching that tab". Ingest still honours a bare `eventCount`
from Recorder ≤1.1.0 — verified both wire shapes declare→finalize→`list_gripes`/`get_gripe` against
a live local server (new: 4/7, legacy `eventCount:9` → `errorCount:9`, `droppedCount:0`).
**DB renamed by SQL, not by db push** (`ALTER TABLE "gripe" RENAME COLUMN`) — a drop-and-add would
fail Drydock's flagless predeploy — on `handback`, `handback_test`, **and prod** (asked: "run db
push on local and prod, its fine"). Prod has no public DB port, so it went through
`aws ssm send-command` → `docker exec … psql -U drydock -d inloop`; both gripes survived with
`error_count` 0. Learned on the way: the Drydock project/db is **still `inloop`**, ECS exec is off,
the PG superuser is `drydock`. **Prod is mid-migration** — the running container is the old image
and every gripe read errors on `gripe.event_count` until `main` deploys; `/healthz` still 200s so
nothing will page. typecheck green both workspaces, extension rebuilt, e2e 4/4.
Touched: prisma/schema.prisma, server/{ingest,gripes-api,router}.ts, cli/push.ts,
extension/src/lib/upload.ts, src/app/app.tsx, src/components/viewer/gripe-header.tsx,
cliffnotes.md, updates.md.

## 2026-07-30 — inloop→handback doc sweep + first full e2e run since /connect
Asked: "its handback.dev. update all the inloop shit. whats e2e database??" Swept the stale
references: cliffnotes (`handback push`, "Handback Recorder", deploy table rewritten — handback.dev
is live, project/db name flagged as portal-unconfirmed, "today still inloop" parentheticals gone)
and the **active** transcription plan (`ilp_`→`hb_`, inloop.dested.com→handback.dev, "Inloop knows
the context"→Handback). Deliberately left: updates/decisions (append-only history), the rename
plan (inloop IS its subject), real AWS names `inloop-files`/`inloop-app` (still exist, slated for
deletion), and `drydock.yaml` + `.github/workflows/drydock.yml` (Drydock-owned — the ECS/ECR names
are a portal re-wire, not an edit). Ran `bun run test:e2e` with E2E_DATABASE_URL derived from .env
→ **4/4 green**, including the new /connect click-through. Still open: the local folder is still
`G:\code\inloop` (Sal deferred once; `reproject` skill renames it without losing session history).
Touched: cliffnotes.md, plans/2026-07-30-transcription.md, updates.md.

## 2026-07-30 — shipped: commit + push (deploy) + Recorder 1.1.0 release
Asked: "commit, push and run a build of the extension and tag a release." Done: everything pending
committed (`67d64ae` — hosted MCP + /connect + /recorder + panel redesign) and pushed → Drydock
deploy rolling; extension bumped to **1.1.0** (`fda426f`, old Inloop tags v1.0.0/v1.0.1 already
held the low numbers), rebuilt, and released as **v1.1.0** with `handback-recorder.zip` attached —
`releases/latest` (what /recorder links) verified pointing at it.
Touched: extension/{public/manifest.json,package.json}, updates.md.

## 2026-07-30 — /recorder one-click extension link + panel redesign
Asked: "the extension has to be easier to link… deep link it after install, no generating keys.
And the panel UI is pretty bad — record too small, done confusing." Done (3 Opus agents + Fable):
**stable extension ID** (`key` in manifest → `gmggnebbenlmpakojgocnjfcnpmifdci`) +
`externally_connectable` (handback.dev, localhost) + background `onMessageExternal`
(ping/link — serverUrl always `sender.origin`) + fresh install opens `/recorder`. **/recorder
page** (nav: Recorder): install step (Web Store button behind a `STORE_URL` constant, zip +
load-unpacked until then), live "extension installed" ping indicator, one-click **Link
{workspace}** (mints `hb_` token → handshake, no copy-paste), guest notice, CLI aside; inbox
empty state now points there instead of printing the CLI. **Panel redesign**: hero Record button,
full-width stop, "done" → "send to Handback" (+ uploads-to sub-line), unlinked state links to
/recorder instead of demanding a token, human-readable upload errors (status-mapped line +
details toggle), settings behind a header gear with linked-to/unlink, return mark replaces the
old two-rings logo. Fixed in review: chrome.runtime absence ≠ not-Chrome (UA detect), token-blur
wiping orgName. e2e: `handback_test` needed `db:push` (pre-existing; User.isAdmin), spec updated,
baselines re-shot, 4/4 green; both typechecks + extension build green; panel states eyeballed in
the preview harness.
Touched: extension/public/manifest.json, extension/src/{background/index,lib/{messages,types},sidepanel/{App.tsx,panel.css}},
src/app/{recorder,connect,app,routes,layout}.tsx, src/components/setup-step.tsx, e2e/smoke.spec.ts.

## 2026-07-30 — hosted MCP at /mcp + the /connect page ("are you the engineer who fixes these?")
Asked: "how can you access this — is there an mcp server that is spun up?" → then "this needs to
be made crystal clear right now on the webpage… a whole thing on how to link your claude code to
handback, with api token generation and everything… openai codex coming soon." Done:
**hosted MCP** (`server/mcp.ts`) — StreamableHTTP at `/mcp`, stateless, `hb_` bearer auth, the
same three tools, so setup is one line with no clone and no bun (see decisions.md). Read side
extracted to **`server/gripes-api.ts`** and the formatter to **`server/mcp-format.ts`**, both now
shared by `ingest.ts` and both MCP servers. **`/connect`** — four numbered steps in the editorial
style: mint a token inline, a command block with that token already interpolated, a live
"connected" indicator polling `tokens.connection`, and a paste-in prompt for working a gripe;
Claude Code / OpenAI Codex ("soon") picker, guest notice, tool reference. **Inbox** gets a
dismissible "Are you the engineer who's going to fix these?" banner that disappears once a token
has actually been used, and its empty state now teaches both halves (get one in / get one out).
Nav gained Connect. Verified live: initialize + tools/list + list_gripes over HTTP, 401 on a bad
token, 405 on GET; token minted in-browser and the command filled itself in. typecheck green.
Touched: server/{mcp,gripes-api,mcp-format,ingest,router}.ts, server.ts, cli/mcp.ts,
src/app/{connect,app,routes,layout}.tsx, e2e/smoke.spec.ts, cliffnotes.md, decisions.md.

## 2026-07-30 — member access editor, team as a paid switch, and a real /admin
Asked: "change project/projects assigned to each member… team is a paid feature, but I want to
turn it on for particular users, via the admin (I need a full admin)." Done (2 Opus agents +
Fable): **orgs.setAccess** (entire workspace ↔ chosen project set; owner-only when restricting an
admin, demotes to member, revokes the target's hb_ tokens) + inline Access editor on Team members.
**Entitlements**: `User.features` ('team') + `User.isAdmin` + `ADMIN_EMAILS` env; a workspace has
team when its OWNER does (server/features.ts); `invites.create` gated, upsell card replaces only
the invite form (revoke stays reachable), per-project Invite buttons hidden. **/admin**: stats
strip (users/workspaces/gripes/storage), user search, workspace chips, per-user team + admin
toggles (no self-revoke; admins show implicit team), admin nav link, `cli/make-admin.ts`,
dev-bootstrap seeds admin+team. Quality-gate fixes folded in (honest display for env-bootstrapped
admins, guest role clamped in orgs.mine, editor loading state). db push'd, typecheck green,
committed + pushed (deploys via Drydock).
Touched: prisma/schema.prisma, server/{env,features,router}.ts, cli/{make-admin,dev-bootstrap}.ts,
src/lib/org.tsx, src/app/{admin,team,projects,routes,layout}.tsx, decisions.md, cliffnotes.md.

## 2026-07-30 — the go-live batch: email, caps, limits, pricing, cleanup pass, store copy
Asked: "let me know what i need to do next" → "do all that for me please", with Groq, Resend and
Anthropic keys pasted in chat. Done, all six:
**Email (Resend)** — `server/email.ts` (sender + reset/verify/invite templates, never throws; with
no key it logs the message so a dev can click the link), better-auth `sendResetPassword` +
`sendVerificationEmail`, `invites.create` emails the link, new `/forgot-password` +
`/reset-password` pages. Sending domain created in Resend, DKIM/SPF written into Route53, verified,
and a real message delivered from noreply@handback.dev.
**Upload caps** — `presignPut` signs `ContentLength` (S3 itself rejects a mismatch); 512 MB/file,
2 GB/gripe, 20 GB + 500 gripes per org checked at declare, minus the gripe being replaced.
**Rate limiting** — better-auth per-route rules + `server/ratelimit.ts` (per-IP ahead of auth,
per-token per route) across `/api/ingest`; `trust proxy` set so `req.ip` is the caller, not Caddy.
**Pricing** — paid tiers relabelled "Free in alpha"/"Coming soon", muted prices, and a line saying
nothing is billed yet.
**Transcript cleanup** — `server/polish.ts` (`claude-haiku-4-5`) + `POST /api/ingest/polish` +
`extension/src/sidepanel/polish.ts`: edits keyed by line index, grounded in the recorded origin and
the page's console errors, timings never cross the boundary, every failure keeps the raw lines.
Verified live: "handbag"→"Handback", "cores"→"CORS", "you are ell"→"URL", "use effect"→"useEffect".
The report names it (`engineName`), and `/privacy` now names Anthropic and Resend as processors.
**Web Store** — `plans/2026-07-30-web-store-listing.md`: listing copy, single-purpose statement, a
justification per permission (including the `<all_urls>` answer), the data-use disclosure table,
reviewer notes, screenshot list. Go-live doc updated: blockers 1–2 closed, what's left is Sal's.
Touched: server/{email,polish,ratelimit,ingest,storage,auth,env,router}.ts, server.ts,
src/app/{forgot-password,reset-password,privacy,terms,sign-in,routes}.tsx,
src/components/landing/pricing.tsx, extension/src/{sidepanel/{polish,transcribe,App},
lib/{types,messages,report},background/index}.ts, plans/*, cliffnotes/decisions.

## 2026-07-30 — project-scoped guest invites
Asked: "create projects and invite people to be part of my project and they can see my project's
stuff — is that built? if not scope and build it." Projects + org invites existed; project-scoped
visibility didn't. Done (2 Opus agents + Fable, per plans/2026-07-30-project-guests.md):
`Membership.scope` org|projects + `ProjectAccess` + `Invite.projectId`; `requireMembership` now
returns `Access{role, projectIds}` and every gripe/project procedure enforces it (guests: own
projects only, no unassigned gripes, no project create/assign, no API tokens, filtered members
list; org-wide invite upgrades a guest); removeMember revokes the target's tokens. UI: Access
select on the Team invite form, per-project Invite button + copy link on /projects, guest chips +
"Only: …" on members, project name on /join, tokens tab and viewer project-assign hidden for
guests. db push'd, typecheck green.
Touched: prisma/schema.prisma, server/{membership,router}.ts, src/lib/org.tsx,
src/app/{team,projects,join}.tsx, src/components/viewer/gripe-controls.tsx.

## 2026-07-30 — renamed Inloop → Handback (handback.dev)
Asked: "change the name from inloop to handback. its handback.dev" (+ rename all identifiers, new
bucket via Drydock, GitHub rename, redesign the logo now). Done: full sweep by 3 Opus agents +
Fable (hb_ tokens, HANDBACK_* env, handback-recorder/handback_test/handback.activeOrgId, MCP name,
all copy de-looped); new return mark (logo.tsx, return-diagram.tsx, regenerated icons); GitHub →
dested/handback; dev DB reseeded; Drydock S3 spec written (drydock repo); both typechecks green.
Per plans/2026-07-30-handback-rename.md — infra checklist pending on Sal.
Touched: ~55 files across server/, cli/, src/, extension/, docs kit.

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
