# Handback — Decisions

> ADR-lite: what was decided, why, what was rejected. Append-only.

## 2026-08-12 — Free tier is enforced server-side: verified email + monthly budgets + first-walkthrough magic
**Why:** cost control has to hold against 10k throwaway accounts, so the enforcement is entirely
server-side where the recorders can't route around it: `emailVerified` gates uploads, token minting
and both AI passes (reads stay open — an agent keeps pulling its queue); `MonthlyUsage`
(user × 'YYYY-MM') meters cloud transcribe seconds (free 900s/mo, pro 72 000s abuse ceiling) and
polish calls (free none, pro 1 000/mo ceiling) via atomic reserve-then-call; max 10 active tokens.
The first walkthrough is deliberately unmetered ("magic") — the first-run experience is the
product. `pro` is a hand-granted `User.features` flag like `team`; platform admins are fully
unmetered. Recorders degrade gracefully on the 403/429s they already handle (non-2xx transcribe →
on-device, polish → raw transcript), and `GET /context` now tells future recorders their allowance
(`cloud` block). No Turnstile yet (no keys), no disposable-email blocklist (deferred).
**Rejected:** client-side enforcement (trivially bypassed), better-auth `requireEmailVerification`
(blocks sign-in outright — alpha users with bounced mail would be locked out), a daily token
(owner declined), metering by walltime instead of audio seconds (WAV byte length is exact enough).

## 2026-08-12 — Cost levers: R2 for media, throttled capture bitrates, local-first free tier
**Why:** egress + AI passes are ~90% of per-user cost (storage with 30d retention is cents —
see /admin/costs). R2 = $0.015/GB-mo + zero egress, S3-compatible presigned URLs. Agent-kind
capture drops to ~1 Mbps (the agent reads frames/transcript, not the video); pristine halves to
~2 bits/px clamped 3–8 Mbps. Free tier: first walkthrough gets full cloud transcribe+polish,
then on-device Whisper (extension) / 15 cloud-min/mo (web+phone); no polish on free. Maxed free
user lands ≈ $0.02/mo.
**⚠️ Cutover is owner-gated (2026-08-12: "don't migrate until I'm ready, people use this every
day").** The code ships inert: prod stays on S3 until Sal sets S3_ENDPOINT + R2 keys in SSM and
runs cli/migrate-storage.ts himself. Safe order when ready: run migration copy while live
(idempotent) → re-run to catch stragglers → flip SSM + redeploy → one final re-run. Presigned
GETs minted before the flip keep working for their 1h TTL against old S3.
**Rejected:** Backblaze B2 (cheaper still, but R2's S3 compat + Turnstile/CDN adjacency wins),
CloudFront in front of S3 (egress still billed), literal-zero free tier (gutting first-run magic
to save pennies).

## 2026-08-12 — Admin tokens stay platform-wide (no scoped tokens)
**Why:** owner declined the mint-time scoping option outright ("don't do that token thing, it's
fine") after the audit flagged the blast radius (a platform admin's `hb_` token reaches every
space, `walkthroughs-api.ts` `isAdmin` drops the filter). Risk accepted; revocation is immediate
and tokens are sha256-stored, which bounds the damage window.
**Rejected:** per-token scope (personal / one team) with admin reach as opt-in.

## 2026-08-12 — Pricing = seats + hour quotas + tiered retention windows
**Why:** owner's call while preparing to go wide. Storage-forever plus egress is the entire cost
story (~$0.33/recorded-hour at 30d retention; measured ~1.0 GB/hr agent-kind — see /admin/costs);
retention windows bound cost per user, keep the bill predictable for buyers, and double as the
liability lever ("get it out of my system as quickly as possible"). Ladder: Free 1h/mo · 30d,
Pro $20 3h · 90d, Business $40 10h · 1y, Enterprise custom. Margins verified in /admin/costs.
**Rejected:** usage-based overage (metering + Stripe complexity, unpredictable bills), flat seats
with generous quotas (margin hostage to expiry defaults).

## 2026-08-12 — Resolved walkthroughs auto-expire
**Why:** owner: "once the thing is done there's probably no reason to keep them" + minimal-data
liability posture. Resolve stamps `expiresAt = now + tier window`; flipping back to open, or an
explicit Keep, clears it; hourly sweep deletes S3-first (design:
plans/2026-08-12-security-retention-audit.md). Privacy page changes in the SAME release — it
currently promises "kept until someone deletes them."
**Rejected:** keep-forever with only the storage cap (COGS grow with every account forever),
per-team-configurable windows (more surface than the alpha needs; the ladder can gain a knob
later without a migration).

## 2026-08-12 — Arbitrary section cuts (⇧-drag carve + in/out), and the editor serves every kind
**Why:** owner: "I should be able to just cut out a big section — person mode or not." Two ways
to carve, both committing instantly (the no-selection rule survives because nothing ever *stays*
selected): **⇧-drag** on the editor's timeline sweeps a cobalt-tinted span and commits it as a
`source: 'manual'` cut on release (bare drag still scrubs; the fork is decided once at
pointerdown; <250 ms is dropped as a shift-click); and **"cut from here / to here"** on the
readout row for trackpads/touch, with the pending in-point drawn as a dashed cobalt line
(`Timeline.markMs`). A carve may cross take seams — `addManualCut` splits it into per-take cuts.
**A manual cut's tag DELETES it** (silence cuts linger vetoed so re-tighten remembers; line cuts
belong to the transcript; a vetoed manual cut would be an immortal ghost with no other owner).
**Editing is kind-agnostic**: `walkthroughs.presignEdit`/`finalizeEdit` never checked kind, so
an agent walkthrough gets a quiet "cut this video down" entry under the viewer timeline into the
SAME cloud editor; its render sits ABOVE the review surface as "the tight cut" (the raw takes,
frames and report stay — they're what the agent reads), while a human walkthrough's render still
replaces the take view. `/w` already served final.mp4 kind-blind. Known wrinkle, accepted:
`finalizeEdit` sets `Walkthrough.durationMs` to the render's length for agent kind too — the
deliverable's duration wins the meta line.
**Rejected:** a marquee/action-bar selection model (still dead), a second inline editor on the
review page (one editor to maintain), kind-gating the server procedures (no security value — the
caller already holds the space).

## 2026-08-12 — The viewer and editor share one scrubber chassis; the editor is scrubber-first (supersedes "transcript-first" below)
**Why:** owner verdict on the shipped viewer ("the whole UI is terrible… the human part is
supposed to be like a video scrubber, not a word thing — redesign from scratch"), settled
through a mock-first pass (plans/2026-08-12-viewer-redesign.md, merged direction). One chassis
now serves /walkthroughs/:id, the cloud editor, and /w: a masthead header that absorbs every
control (segmented status, quiet project popover, ONE kind-appropriate primary action, `⋯`
overflow with inline arming — no native selects, no window.confirm), one continuous player
(`useSegmentPlayer`, the editor's old preview hook generalized), and one `Timeline` scrubber on
a SOURCE-GLOBAL axis (takes end to end at full length; cuts drawn ON the axis as hatched spans
with −N.Ns tags — the tags are the only cut toggle; toggling never moves the material around a
cut). The editor keeps the same transcript strike/restore but the timeline is now the primary
surface, with client-extracted thumbnails (`src/lib/edit/thumbs.ts`) and envelope-driven voice
bars; the agent viewer's voice lane is a deterministic pseudo-waveform from transcript density
(no decoded audio on that path, on purpose). **The 2026-08-01 no-selection rule still stands**:
scrubbing is one gesture, and nothing on the track drag-selects.
**Rejected:** keeping transcript-first as the editor's primary surface (the words remain as the
rail, demoted), per-take stacked players (the old viewer's shape — the thing being redesigned),
decoding audio in the agent viewer just to draw a real waveform (cost without judgment value).

## 2026-08-12 — Extension human handback rides the cloud; the web is the editor
**Why:** owner's directive ("record in extension and resolve on web — make it"). A page can
never read the extension's IndexedDB (chrome-extension:// origin) and external messaging
JSON-serializes, so raw takes MUST travel through ingest: the extension (1.8.0) records
pristine and declares `kind: 'human'` with raw `rec-NN/walkthrough.webm` + recording.json +
transcript.txt (no frames/report), and the viewer's cloud editor downloads them, cuts, renders
`final.mp4` in the browser, and attaches it via `walkthroughs.presignEdit`/`finalizeEdit`
(session-authed tRPC, path allowlist of exactly final.mp4/transcript.json/edit.json).
**Consequence, embraced:** these walkthroughs are re-editable — raws + edit.json live
server-side, unlike /record's local-only flow. **Caps raised with it:** 512 MB/file was
already too small for a real 20-minute webm; now 2 GB/file, 4 GB/walkthrough — the 20 GB
space quota stays the actual backstop.
**Rejected:** extension→page blob handoff (impossible), panel-side editing (two editors to
maintain), base64 chunking through messaging (hundreds of MB through JSON).

## 2026-08-12 — `kind` is a judgement, switchable from the viewer
**Why:** owner ("I should be able to switch it… why not"). Nothing structural separates the
kinds — `walkthroughs.setKind` just writes the column. agent→human hides it from agent queues
and (raws present) makes it tightenable; human→agent surfaces it, with report.md degrading to
null in the brief. No file mutations either way.

## 2026-08-12 — Human handback is a Walkthrough `kind`, not a second model
**Why:** owner's call (asked directly). A video recorded *for a person* shares everything an
agent walkthrough has — spaces, quota, inbox, S3 layout, admin — and differs only in artifact
(pristine `final.mp4` instead of distill) and audience (hidden from agent lists; `get` by id
still answers so one can be pointed at an agent deliberately). `kind: 'agent' | 'human'` on the
row keeps one pipeline and one review surface.
**Rejected:** a separate "clip" model (duplicate quota/admin/S3 plumbing), not storing it at all
(share links need a server).

## 2026-08-12 — mediabunny is the media engine; the editor UI is ours
**Why:** the in-browser editor needs demux/decode/encode/mux (read MediaRecorder webm, render a
cut list to H.264+AAC MP4, remux cueless webm so previews can seek). mediabunny does exactly that
over WebCodecs — pure TS, zero deps, ~20 KB tree-shaken, hardware encode. No npm library exists
for the editor UI itself (the auto-jump-cut world is SaaS apps), so the timeline/transcript
surface is built here.
**Rejected:** ffmpeg.wasm (~30 MB, needs cross-origin isolation, software-slow), server-side
ffmpeg (576 MiB container hard cap), off-the-shelf editor UIs (none exist as libraries).

## 2026-08-12 — The editor is transcript-first; there is still no timeline selection
**Why:** the 2026-08-01 verdict ("just the scrobble… no selection") killed the panel timeline's
selection model as unusable. The web editor doesn't reintroduce it: the *transcript* is the edit
surface — delete a line to cut its seconds, silences are chips between lines, one Tighten slider
(threshold) re-runs the silence pass. Cuts are proposed only where the RMS envelope is silent
AND no words overlap, so app sound effects survive tightening. Preview plays the EDL by skipping
cuts; the render is exact.
**Rejected:** a classic NLE timeline with range selection (the exact interaction the owner
named unusable), auto-only editing (no way to remove *content*).

## 2026-08-12 — A human handback uploads its render, never its raw takes
**Why:** the deliverable is the tight cut. Raw 30 fps pristine takes are huge against the
2 GB/walkthrough · 20 GB/org caps, and they stay in the browser's IDB for the session anyway.
Upload = `final.mp4` + `transcript.json` (lines re-timed onto the edited clock) + `edit.json`
(the EDL, order-capable, so re-editing is possible the day raw sources are retained). The EDL
`segments` array is the render's input in output order — full segment reorder is already legal
downstream; the UI just doesn't produce it yet (owner: "remove only + take reorder, but get
ready for the full thing soon").
**Rejected:** uploading raw takes alongside (quota), re-encoding nothing and uploading webm
(doesn't play everywhere a link gets pasted; Safari).

## 2026-08-12 — The website records on its own; the extension keeps the on-page half
**Why:** owner's directive — "make it so users can run a Handback recording straight from the
website, where they don't have to open up the Chrome extension… but they can do it without the
extension if they so choose." The extension is a real install barrier for the person who *saw* the
bug, who is usually not the person who set Handback up. Screen capture in a desktop tab is the same
web platform the extension's recorder already uses, so `/record` runs a port of it
(`src/lib/capture/live.ts`) and hands the result to the pipeline `/phone` and `/upload` already
share: same dedup constants, same `frameBudget`, same audio mix + mic-only shadow for Whisper, same
`report.md`/`MANIFEST.txt`/`recording.json`, same declare/PUT/finalize. **This does not soften the
2026-08-02 mobile verdict** — that was about phones, and it still holds.
**The gap is accepted, not worked around:** console/network events, pointer crosshairs and
click/nav forced keyframes come from scripts injected into the *recorded* page, which no page can do
to another origin. A web take ships `events: []`, `errorCount: 0`, no `pointer`, and only
`start`/`change`/`beat` — the set /phone already produces, which everything downstream reads.
/recorder now says this out loud above its install steps, so nobody picks the weaker tool by
accident.
**Rejected:** a same-origin content-script-ish shim that only records handback.dev (the thing people
need to record is their *own* app); reimplementing live dictation with `webkitSpeechRecognition`
(it never wrote the shipped transcript — Whisper does — and a mic level tap answers the question it
really answered); making `/record` replace `/recorder` (the extension is still strictly better where
it can run); reusing the extension's `handback-recorder` IndexedDB (same origin, and its worker owns
that schema — `/record` gets `handback-web-recorder`).

## 2026-08-12 — A web take is persisted chunk-by-chunk, unlike a /upload distill
**Why:** `/upload` deliberately has no pending store, on the reasoning that a desktop tab doesn't get
OOM-killed and a clip can always be re-distilled. Recording breaks that reasoning in half: the
narration happened *once*, and twenty minutes of capture is hundreds of MB that must not sit in the
JS heap. So `/record` writes every MediaRecorder chunk and every keyframe to IndexedDB as it
arrives, exactly as the extension does, and a take found still marked `recording` on the next visit
is reassembled from its chunks into the video it never got (`recoverTake`) rather than discarded.
Deletion happens in exactly two places — after `finalize` returns, and on an explicit discard —
which is the same rule the phone's share stash follows.
**Rejected:** holding chunks in memory until Stop (a long take dies before it can upload); no
recovery path at all (the one thing a recorder must never do is lose the take); auto-resuming a
recovered take without asking (after a crash the person decides — /phone's rule).

## 2026-08-12 — The floating HUD is Document PiP, opened by its own click
**Why:** the extension's panel is browser chrome, so it stays on screen while you drive the app
you're narrating; a tab does not, and the clock, frame count and Stop button vanish the moment you
switch to the thing you're recording. Document PiP is a real same-origin document that floats above
everything, and React renders straight into it. It is opened by a separate `pop out` button because
**`requestWindow()` needs its own user gesture and the Record click is spent on the share picker** —
the exact constraint the puck hit (2026-08-01). Sharing the entire screen captures the PiP window,
but it captures the extension's side panel too (it lives inside the Chrome window), so that is
parity rather than a regression.
**Rejected:** auto-opening it on Record (the gesture is already spent — this is written down);
keeping the HUD only in the page (the recorder is invisible during the actual recording, which is
most of the session); a `position: fixed` in-page overlay (still dies the moment the tab loses
focus — it solves nothing).

## 2026-08-12 — Takes record app audio + raw mic, mixed; transcription hears a mic-only shadow
**Why:** a walkthrough's evidence is often *sound* — the app's own audio (what's in the narrator's
headphones), the narrator, and the room/second voice. Chrome's default mic pipeline (echo
cancellation, noise suppression, auto gain) exists to isolate one call voice and deliberately
shreds everything else, and `getDisplayMedia({audio:false})` threw the app audio away entirely. So:
display capture now requests audio (`systemAudio:'include'`, raw constraints), the mic runs raw
(AEC/NS/AGC off), and a Web Audio graph mixes them into the single track MediaRecorder can record.
Because Whisper must hear narration and not the mix (song lyrics/app speech would land in the
transcript, the report, and the agent brief), a take with system audio also runs a mic-only shadow
MediaRecorder — persisted crash-safe exactly like the video chunks (`micchunk:*`, reassembled on
recover) — and transcription prefers `<id>:mic` over the webm. Headphones are the assumed setup;
on speakers the app audio leaks into the mic slightly phased, which is livable.
**Rejected:** transcribing the mixed track (transcript pollution); keeping AEC on (kills the room —
the very thing asked for); uploading the mic-only webm as a walkthrough file (internal artifact,
storage cost, nothing consumes it); handing MediaRecorder two audio tracks without a mixer (it
silently records only the first).

## 2026-08-07 — The Web Store build has its OWN id; /recorder pings both ids (supersedes the ID claim in 2026-07-30)
**Why:** the 2026-07-30 handshake decision assumed the extension's `key`-pinned id
(`gmggnebbenlmpakojgocnjfcnpmifdci`) would carry into the Web Store "on first upload". That was
wrong: `pack-store.mjs` strips `key` (the Web Store rejects it), so Chrome generated the published
listing its own id **`bdhajcllnjcnihcbobhaecldgjlhfdhd`**. A page hardcoding only `gmggneb…` can't
reach a store install at all — the ping never answers, the one-click link silently no-ops.
The fix keeps both installs first-class: `src/app/recorder.tsx` holds `EXTENSION_IDS = [store,
self-hosted]`, pings each until one answers, and links whichever id responded (the winning id rides
back with the presence). The self-hosted zip / load-unpacked build still resolves to `gmggneb…` via
the retained `key`, so dev and `/download/recorder` are unaffected.
**Rejected:** re-pointing the single hardcoded id at the store id (breaks dev + self-hosted
load-unpacked, which keep `key`); shipping the store build WITHOUT stripping `key` to force the
`gmggneb…` id (the Web Store hard-rejects a `key` field — not an option); a content-script handshake
on handback.dev to sidestep ids (the very thing 2026-07-30 already rejected).

## 2026-08-06 — The distill pipeline is extracted to dested/video-to-prompt (public); Handback's copy stays for now
**Why:** the video→prompt logic (probe, keyframe dedup, contact sheets, audio→WAV, unified-timeline
report/MANIFEST builders) is wanted in other projects, so it now lives as a standalone browser-only
library at github.com/dested/video-to-prompt (`G:\code\video-to-prompt`) with pluggable
Transcriber/Polisher hooks and report wording behind `ReportOptions` (npm publish later).
`src/lib/capture/` is NOT deleted: the phone pipeline just stabilized and swapping it for the
package deserves its own on-device QA pass. Until that swap, the mirror rule triples — any pipeline
change must land in `src/lib/capture/`, the extension, AND the library. **The standing plan is to
delete the generic halves of `src/lib/capture/` and consume the package**; Handback-specific
plumbing (upload/api/context/pending, the transcribe/polish HTTP clients) stays here either way.
**Rejected:** cutting Handback over to the package immediately (re-QA cost now, for zero feature
gain), a private monorepo package (the library is meant to be public and eventually npm).

## 2026-08-03 — Space is an attribute, not a mode
**Why:** the header SpaceSwitcher forced everyone to browse one space at a time, and the owner —
who has many teams and projects — called the resulting inbox unusable and the switching senseless
("stop making me switch space at the top"). Now every read surface spans everything the session
reaches: `walkthroughs.inbox`/`projects.all` (membership IS the access check), filters instead of
context, Teams and Projects pages grouped by space, team creation on the Teams page. The only
place a space is *chosen* is where it must be: the destination of an upload (extension picker,
/phone, /upload) — `useActiveSpace` survives solely as that default.
**Rejected:** keeping the switcher alongside the cross-space inbox (two sources of truth for
"what am I looking at"); server-side filter params on the inbox query (≤200 rows — client-side
filtering makes every rail count free and instant); per-space routes like /t/:slug (deep-linkable
but resurrects the mode).
## 2026-08-02 — The phone records with the OS recorder; the PWA is a share target, not a recorder
**Why:** no mobile browser exposes screen capture — `getDisplayMedia` is `version_added: false`
on Chrome Android (exposed 72–88 but always `NotAllowedError`, then hidden), Safari iOS, Firefox
Android (MDN compat data, checked 2026-08-02). So "press record in the PWA" is physics, not
product. The OS recorders are *better* at the wanted UX anyway (mic narration, app switching,
notification-shade stop, no browser battery/tab-kill risk). Handback's half is everything after
capture: `/phone` + `src/lib/capture/*` distill a shared/picked clip in the browser and upload
through the unchanged ingest API with a page-minted `hb_` token.
**Also decided:** `src/lib/capture/` is a **duplicated port** of the extension pipeline (dedup
constants, report/MANIFEST/recording.json builders, WAV chunking, two-phase upload) — not a
shared package. The extension is its own npm workspace; a cross-workspace shared lib costs more
than the drift risk while there are exactly two clients. **A pipeline change in either place
must be mirrored in the other** (extension/src/{sidepanel/recorder.ts,lib/report.ts,lib/upload.ts}
↔ src/lib/capture/*). Revisit if a third client appears. The SW (`public/sw.js`) caches
nothing, deliberately — SSR app, staleness would be worse than no offline; its only job is the
share-target POST stash.
**Rejected:** live capture in the PWA / PiP recorder chrome (platform-impossible, above);
wasm Whisper fallback on the phone (battery + minutes of wait; a 503 just ships without a
transcript); session-cookie auth on ingest (token mint reuses every existing limit/quota path);
a `/phone`-specific upload API (the extension's declare/PUT/finalize already fits).

## 2026-08-02 — The recorder destination is ONE grouped control; "General" is the project-less row
**Why:** the send-view "to [space] · [project]" was two native selects the owner disliked ("i
dont liek the double drop down... just make it one and make it clean and cool"). It's now one
trigger + one panel grouped by space (`DestinationPicker` in `App.tsx`): mono-uppercase space
headers, a `General` row then that space's projects under each, one click sets space AND project
together (switching space drops the project — a project belongs to exactly one). Only the active
link's teams/projects are known, so other linked servers show just their Personal space until
selected. The panel opens **upward** because the row sits at the foot of the panel. `no project`
was renamed **General** (owner: "dont call it no project. give it a name") — the server still
routes by origin when General is chosen, so nothing about routing changed, only the label.
**Rejected:** two selects (the thing being replaced); project-first with space as a tag (owner
picked the space-grouped panel); an actual default "General" Project row in the DB (General is a
UI label for `projectId: null`, not a real project — avoids a migration and a magic row).

## 2026-08-02 — /admin is a console with its own sidebar; the sidebar primitive is hand-rolled
**Why:** admin outgrew one page ("a 3 screen mess" — owner asked for a full real admin with a
shadcn sidebar). It's now a nested route section (`src/app/admin/*`) behind one gate in
layout.tsx, so a new admin page = one file + one route child. The sidebar is shadcn's sidebar
re-cut by hand in `src/components/ui/sidebar.tsx` because the repo's primitives are radix-free
and no-`asChild` — installing radix (Slot/Sheet/Tooltip) for one component would have broken
that convention. Collapse persists to localStorage but is read in an effect, never the useState
initializer (SSR hydration).
**Rejected:** upstream shadcn sidebar via CLI (drags in radix + asChild); keeping admin inside
the shared max-w-6xl main (the shell needs full bleed — layout.tsx special-cases /admin).

## 2026-08-02 — Workspaces don't exist: Teams + one implicit Personal space
**Why:** the workspace abstraction "fucked me time and time again" (owner) — a hidden personal
org behind every account leaked into switchers, token scoping, invites, and the extension's
link juggling. Personal is now the *absence* of a team (`teamId null, userId = owner` on
Walkthrough/Project); Teams are the only explicit, paid thing (`ownerId` transferable,
`seatLimit` enforced on invites; Stripe later plugs into those fields). Tokens are user-scoped:
one `hb_` token reaches personal + every team, and the recorder picks the destination per
upload. Guests (Membership.scope/ProjectAccess) were deleted outright — the one prod guest was
promoted to member.
**Rejected:** keeping a hidden personal Team row (that IS the old model); per-team tokens (the
extension's per-workspace link juggling was the pain); building Stripe now (modeled instead);
keeping guests (biggest single simplification available).
**Consequences accepted:** slug uniqueness per space is code-enforced (Prisma can't
partial-index the nullable ownership pair); recorder ≤1.5.x declares carry no teamId, so their
uploads land in the uploader's personal space until the install updates.

## 2026-08-01 — Pointing outside Chrome is a PiP window (the puck), not a native helper
**Why:** "draw all over the screen, not just the Chrome window" (gripe `3f491ef7`, 2:21 —
"really, really important"), aimed at people narrating over Excel and other native apps. MV3
cannot paint a pixel outside a tab, so the puck stops trying: a Document Picture-in-Picture
window is always-on-top over any app and — the whole trick — is *captured by `getDisplayMedia`
for free*. It's drawn as a cursor (opaque window with a minimum size → cobalt arrow, tip at the
top-left inner pixel, body hangs off-target) whose body doubles as the out-of-Chrome dock:
clock, live captions, mark/stop, arrow-click/`p` drops numbered **pins** that are painted onto
keyframes. Tip telemetry rides the existing `PointerSample` pipe (second slot, fresh page
sample wins, parked puck never stale); parking forces a mark like an ink stroke ending; dedup
signatures mask the puck's window rect (union of both compared frames' rects) so its ticking
clock can't burn the frame budget. **The opener is the CONTENT SCRIPT, not the panel:** the API
object exists in the side panel but `requestWindow()` there hangs/rejects `undefined` — Chrome
honours it only in real tabs (learned the hard way; chromium-extensions list confirms). So the
page dock grew a `point` (`p`) button, the PiP document inherits the page's CSP and is therefore
built with zero innerHTML and zero `<style>` tags (Trusted Types / style-src — everything is
createElement + `.style` writes), and the puck talks over two new messages: `recording:puck`
(150ms heartbeat, geometry up / `PuckBeat` readout down) and `recording:pin`, answered by the
panel while the worker explicitly stays off their reply channel. Cost accepted: the puck dies if
its host tab navigates; the dock button brings it back.
**Rejected:** encode-time-only compositing (user draws blind — dead once the puck existed); an
Electron/Tauri transparent-overlay helper (second install, signing, Web Store story — revisit
only if the puck proves insufficient); freehand ink outside Chrome (impossible without the
helper; pointer + pins + narration resolves the reference); auto-opening the puck on Record
(`requestWindow` needs its own user gesture — the Record click is spent on the share picker).

## 2026-08-01 — The product noun is "walkthrough"; "gripe" is dead everywhere but two frozen edges
**Why:** the owner, on record (walkthrough `212801d8`): "this whole term gripe is — it's bad… I
want you to change the database name and all throughout the code base." Renamed in the DB (tables
`walkthrough`/`walkthrough_file`, columns in place via `ALTER … RENAME`, never `db push` drops),
tRPC (`walkthroughs.*`), MCP tools (`list_walkthroughs`/`get_walkthrough`/`set_walkthrough_status`,
no old-name aliases), web routes (`/walkthroughs/:id`, old `/gripes/:id` 302s), UI copy, CLI, and
the report.md the recorder emits. Two edges deliberately keep the old spelling: the **S3 key
prefix** `orgs/<orgId>/gripes/<id>/` (every uploaded object already lives there; renaming the path
orphans them all) and the **/api/ingest/gripes\*** REST aliases (shipped recorders ≤1.2.x post
them). The extension's *internal* identifiers also stay `Gripe*` for now — another session had
in-flight edits there, so only emitted strings changed.
**Rejected:** "note"/"handoff"/"brief" (owner picked walkthrough — it's literally what the recorder
makes and half the vocabulary already); migrating S3 keys (copy of every object for a cosmetic
path); MCP alias tools (three clean tools beat six, and only one user exists to break).

## 2026-08-01 — Every account owns a personal workspace; a team is a workspace you create on purpose
**Why:** the recorded sign-up run died on "Name your workspace / Organization name" ("I just
signed up, suddenly I'm thrust into this thing"). Now a better-auth `databaseHooks.user.create`
hook auto-creates "<First>'s workspace" (`Org.personal = true`, owner membership), sign-up lands
straight in the inbox, and `orgs.ensurePersonal` is the idempotent repair path. Personal
workspaces take no invites (server-refused) and show no Team nav; a **team** is created explicitly
from the header's workspace switcher, gated on the `team` entitlement, and is where
members/invites live. API tokens left the Team page for /connect — they exist to connect things,
and the connect page is where that story is told. Project origin-hints left the UI (the recorder's
project picker routes uploads now); the column and auto-routing stay.
**Rejected:** keeping one org type and hiding tabs by member-count (lies as soon as an invite
lands); a separate Team entity nested under Org (the org IS the team; one concept, one table);
backfilling nothing (existing single-member orgs were flipped `personal = true` so current
accounts get the new shape).

## 2026-08-01 — In the timeline, a bare drag scrubs; multi-select is modifier-only
**Why:** every drag surface — ruler, filmstrip cell, empty track — started a range sweep or a
marquee, so the gesture that reads as "move along and look" instead highlighted a batch and put a
destructive bar on screen. Reported first-hand in gripe `3f491ef7`: "I don't want to multi-select,
just let me drag… it's more just visual, you can click one, see whatever, but I just want to drag."
Plain drag now scrubs the playhead everywhere; shift-drag sweeps a range (ruler) or marquees
(tracks), shift-click extends, ctrl/cmd-click toggles. Sweeping a junk stretch to delete it is
still a first-class feature — it just isn't what an unmodified drag means.
**Rejected:** removing sweep-select entirely (it's how a bad stretch gets cut, and the editor's
whole point is pruning before handoff); a mode toggle (a mode you must set is a mode you will
forget, and the destructive one would be the sticky one).

## 2026-08-01 — The axis is the elastic member, not the monitor
**Why:** `.tl-monitor` was `flex: 1 100` — it absorbed every spare pixel — over a `.tl-scroll` of
`flex: 0 1 auto`, which had no floor. On a side panel the result was a tall blank picture above a
ruler and two lanes squeezed to a sliver ("this down here at the bottom doesn't make any sense…
there's nothing here"). Inverted: the axis grows and holds a floor of one ruler plus two lanes, the
monitor is capped at 50% of the stacked panel and collapses to a single line when it has no frame
to show. The 50% is the number the report asked for out loud.
**Rejected:** a fixed monitor height (breaks across the side rail, the popped strip and every
breakpoint); a draggable splitter (one more thing to discover and persist, for a panel with one
sensible ratio). Both rules are scoped `:not(.wide)` so the popped-out strip, where the monitor is
a fixed column beside the axis, is untouched.

## 2026-07-31 — Keyframe budget scales with take length, not a flat 150
**Why:** the flat `MAX_FRAMES = 150` was wrong at both ends — a 90-second walkthrough never
approached it, a twenty-minute one lost real detail to uniform thinning. `frameBudget(durationMs)`
is 40 frames/min clamped to [150, 600]: the floor means no short take regresses, the ceiling keeps
a marathon take inside the 2 GB/gripe quota (~200-400 KB a frame → ~180 MB of frames at the top).
The dedup pass upstream is untouched — this only changes how much of what dedup already kept
survives. The agent brief's sample moved with it (`briefFrameLimit`, 8/min clamped to [30, 120],
was a flat 30) so a long gripe's frame list isn't truncated to a tenth of itself; every frame is
still presigned in the files list either way, the cap is only about what the brief inlines.
**Rejected:** removing the cap entirely (upload size becomes unbounded by anything but dedup and
the org quota, and the Timeline's batched blob reads assume a bounded count); raising the flat
constant to 400 (same wrong-at-both-ends shape, just shifted).

## 2026-07-31 — An admin's API token spans every workspace, writes included
**Why:** /admin can show every user's gripes, so the agent surface had to match — pulling a gripe
you can see in the UI shouldn't 404 over MCP. `authenticateToken` now resolves `isAdmin` from the
token's owner and `gripes-api.ts` drops the org filter for it (`orgScope`/`inScope`, two helpers so
a future query can't forget the rule). Unlike the web bypass this includes `set_gripe_status`:
an agent's loop is pull → fix → mark in_review, and a read-only half of it strands the agent at
the last step. Uploads stay pinned to the token's own org — declare/finalize never take the
bypass. Every list row and brief carries `workspace`, and the MCP tool descriptions grow a
scope sentence, because the model needs to know its queue spans customers.
**Rejected:** an `allWorkspaces: true` opt-in flag on `list_gripes` (keeps the everyday loop
narrow, but Sal's own token *is* the admin token and he wants the wide view by default — the
trade-off is that a normal Handback session now lists every workspace's gripes); read-only parity
with the web bypass (breaks the agent loop mid-way); a separate "platform token" type (a second
credential kind to mint, revoke and explain).

## 2026-07-31 — Platform admins can read any workspace's gripes, and only read
**Why:** /admin gained a per-user drill-down of every gripe an account can see, and a list whose
links 403 is a list that lies. Membership stays the gate for everything that *writes*: the bypass
lives in one function (`requireViewAccess` in `server/membership.ts`), used by exactly
`gripes.get` and `gripes.fileUrl`. `gripes.get` reports `viewerIsMember: false` on that path, and
the viewer swaps its controls for an "admin view · read only" chip — so support can watch a
recording and copy an agent brief, but cannot retriage, retitle, move or delete someone else's
gripe, and never sees a control that would 403. Presigned S3 URLs are handed out on this path;
that is the actual privilege, and it is deliberate — a support surface that can't play the video
isn't one.
**Rejected:** list-without-links (the common case is "show me what this user is looking at", which
needs the viewer); granting admins a synthetic membership row (pollutes `orgs.mine`, the org
switcher, and every member roster); a full bypass inside `requireMembership` (would silently hand
admins delete on every workspace — one helper for reads keeps the blast radius readable).

## 2026-07-30 — The recorder links by handshake, not by pasted token
**Why:** installing the extension ended at a settings pane asking for a server URL and an `hb_`
token from Team → API tokens — the recorder's whole audience is the person *least* likely to
tolerate that. The extension now pins its identity with a `key` in `manifest.json` (ID
`gmggnebbenlmpakojgocnjfcnpmifdci`, same unpacked and in the Web Store — the store keeps a
manifest-key ID on first upload) and declares `externally_connectable` for `https://handback.dev`
+ `http://localhost`. The new **/recorder** page pings that ID to detect the install live, mints a
token server-side on one click, and hands it over via `chrome.runtime.sendMessage`; the
background stamps `serverUrl` from **`sender.origin`**, never from the payload, so a matched page
can only ever link the workspace it is. Fresh installs open `/recorder` themselves
(`onInstalled`), closing the loop from either end. Manual server+token fields survive in the
panel's settings as the dev/edge path.
**Rejected:** keeping token-paste as the primary flow (the friction this exists to kill); a
custom protocol/deep-link URL (extensions can't register one); reading the page's session cookie
from the extension (silent auth a user never sees — the click on /recorder *is* the consent);
content-script-based handshake on handback.dev (needs host permissions on our own site and is
invisible to the "is it installed?" check `externally_connectable` gives for free).

## 2026-07-30 — The MCP server is hosted at `/mcp`; stdio becomes the fallback
**Why:** the setup instructions were the product's real bottleneck. Connecting an agent meant
`claude mcp add handback -- bun <repo>/cli/mcp.ts` — which requires cloning a private repo and
having bun, so the only person who could ever follow it was someone who already had the source.
The person who fixes a gripe is usually not the person who deployed Handback. Handback is already
an HTTP server, so it now speaks MCP directly: `StreamableHTTPServerTransport` mounted at `/mcp`,
authed by the same `hb_` bearer token as `/api/ingest`, and setup collapses to one copy-paste line
with nothing installed. **Stateless** (`sessionIdGenerator: undefined`, fresh McpServer per POST):
a session id would pin a client to one process, and this runs as a single ECS service that is
replaced on every deploy — a promise we can't keep. `enableJsonResponse: true` so replies are
plain JSON, not an SSE stream held open through Caddy; none of the three tools stream. Both
servers call one implementation (`server/gripes-api.ts`) so they can't drift.
**Rejected:** publishing an npm `handback-mcp` package for `npx` (a release pipeline and a version
skew problem to solve a problem HTTP doesn't have); OAuth on the MCP endpoint (the `hb_` token
model already exists, is revocable, and is what the CLI and extension use — a second auth system
for one endpoint is not worth it); deleting `cli/mcp.ts` (still the right tool against a local dev
server, and for anyone who'd rather their agent talk to a process they can read); stateful
sessions (see above).

## 2026-07-30 — Renamed to "Handback" at handback.dev (supersedes 2026-07-29 "Named Inloop")
**Why:** Sal bought handback.dev and called the rename same-day. The name states the product's
moment more precisely than the loop metaphor: the agent does the work and *hands it back* for a
human sign-off. Everything machine-facing renamed with it while nobody has signed up and breakage
is free: `hb_` token prefix, `HANDBACK_TOKEN`/`HANDBACK_SERVER`, IndexedDB `handback-recorder`,
localStorage `handback.activeOrgId`, e2e DB `handback_test`, MCP name `handback`, bucket
`handback-files` (Drydock will provision it — spec in `G:\code\drydock\plans\2026-07-30-s3-buckets.md`),
GitHub dested/handback. New identity: **the return mark** — one stroke out in ink, back in cobalt
with an arrowhead (Sal picked "A — the return" from four candidates); `LoopDiagram` became
`ReturnDiagram`. Copy dropped the loop language: title "Handback — agents fix it, humans sign
off", stamp "SIGNED OFF BY A HUMAN", footer "Every fix, handed back.", CTA "Nothing ships without
you."
**Rejected:** keeping `ilp_`/`INLOOP_*` for compatibility (zero users to be compatible with; a
half-renamed codebase forever), keeping the interlocked-circles mark under the new name (it
illustrates the old name), renaming the local folder `G:\code\inloop` (deferred by Sal),
migrating `inloop-files` data (nothing in it worth moving).

## 2026-07-30 — Landing examples are live DOM, keyframes are SVG, one demo gripe throughout
**Why:** Sal wanted screenshots and examples ("go hard man, examples"). There is no real gripe
folder on disk to screenshot, and a committed PNG goes stale the first time `ui.md` moves.
Building the mocks as real components keeps them crisp at any density, selectable, responsive,
and permanently in sync with the tokens. Keyframes specifically are SVG because the same frame has
to stay legible as a 3×3 contact-sheet tile and blown up in the hero. One demo gripe (promo code
applies to nothing) carries every section so a fast scroller recognises the same bug each time
rather than parsing a new example. Inside a frame only the reviewer's cobalt has colour — the
recorded app is grey — which is what makes nine tiles readable at thumbnail size.
**Rejected:** real screenshots (blocked on a human doing a live record→upload run, and stale on
every redesign); a per-section variety of examples (five bugs reads as five products); publishing
the dedup parameters — the landing page names the mechanism and prints results, never the tuning.

## 2026-07-30 — The landing page sells the distillation, not the install
**Why:** the frame distillation is what makes an agent able to read a recording at all, and it was
nowhere on the page; meanwhile two install commands had a section to themselves. `distill.tsx` is
now the largest section (raw footage → survivors → contact sheet), and `cli-strip.tsx` was replaced
by `agent-view.tsx`, which shows the brief the agent receives and demotes setup to one line.
**Rejected:** keeping a setup-focused section (plumbing on a page that should be selling); folding
MCP into how-it-works (loses the rendered report, which is the most persuasive artifact there is).

## 2026-07-29 — Named "Inloop", not a Gripe-branded cloud
**Why:** Sal wanted the human-in-the-loop idea in the name ("we're putting the human into the
review process"); "Humanloop" is a known LLM-evals company.
**Rejected:** gripe-cloud/gripehq (ties the platform to the extension's branding, which Sal
explicitly rejected), Looped/Signoff/Reins (Sal picked Inloop from the shortlist).

## 2026-07-29 — Light-only editorial UI; total break from the extension's look
**Why:** Sal: "completely rebuilt UI from scratch, not a single div can come over… no more of this
fucking dark mode and orange." Identity: paper + ink + cobalt (reviewer's pen), Fraunces/Libre
Franklin/IBM Plex Mono, the loop mark. Statuses fixed: open=cobalt, in_review=violet,
resolved=green.
**Rejected:** any dark variant, any orange/amber hue, porting Gripe's UI or tokens.

## 2026-07-29 — sal-starter as the base, mutated in place
**Why:** Sal's own starter (Express 5 SSR + RR7 + tRPC + Prisma + better-auth); porting its
conventions faithfully beats a from-scratch stack. Render blueprint kept in-tree but deploy target
is Drydock.
**Rejected:** Next.js/Vercel, Tauri/native (explicitly deferred — recording-side overlay questions
are the extension's problem, not this repo's).

## 2026-07-29 — S3 + presigned URLs from day one; DB stores metadata only
**Why:** "Gripes have to go to remote day one because I'm releasing day one." Bucket inloop-files
(us-west-2, dested account), scoped IAM user, public access blocked; presigned PUT/GET so video
bytes never transit the app server. File payloads (report.md, recording.json, frames, webm) stay
files; Postgres holds listing/routing rows.
**Rejected:** disk-with-abstraction (Sal overrode), R2 (Sal said use AWS), storing frames/blobs in
Postgres, proxying media through Express.

## 2026-07-29 — Two-phase token-authed ingest (declare → presigned PUTs → finalize)
**Why:** The uploader knows the folder; the server hands out scoped PUT urls and only shows
gripes after finalize, so half-uploads never appear. Bearer ApiTokens (`ilp_`, sha256 stored,
shown once) pin the org — the same tokens serve the CLI, the future extension upload, and the MCP.
Re-declaring a slug replaces the old gripe wholesale (rows + S3 prefix) so re-pushes can't
duplicate.
**Rejected:** multipart upload through Express (double-moves 30MB+ webms), trusting client-sent
"uploaded" flags per file (finalize is all-or-nothing instead), session-cookie ingest.

## 2026-07-29 — Hand-rolled orgs (Org/Membership/Invite), not better-auth's organization plugin
**Why:** Three small tables and one `requireMembership()` gate, fully visible in our own
router; invite id doubles as the join-link token, no email infra needed v1.
**Rejected:** better-auth organization plugin (opaque schema + client API for something this
small).

## 2026-07-29 — Extension: port Gripe's logic verbatim, rebuild every surface; cloud-only output
**Why:** the recorder's behavior (64×64-cell dedup thresholds, forced-keyframe rules, one-timeline
position math, interrupted-take recovery, Whisper FIFO, dock key guards) is battle-tested — its
look wasn't. So `extension/` ports the logic contracts (lib/timeline.ts near-verbatim) under an
all-new light/cobalt UI, and the done-flow uploads straight to `/api/ingest` with the panel's
saved `ilp_` token — no local folders, no File System Access, no `downloads` permission at all.
Fresh IndexedDB (`inloop-recorder` v1), no migration from Gripe's DB.
**Rejected:** reusing Gripe's UI (Sal: "not a single div"), keeping local-folder output alongside
upload (two sinks, double the failure modes; the CLI covers offline pushes), migrating Gripe's
IndexedDB (different product, zero users to migrate).

## 2026-07-29 — Agents pull over MCP against token REST, not tRPC
**Why:** Sal chose the pull model. A stdio MCP (`cli/mcp.ts`) wraps three REST endpoints under
/api/ingest so agent auth = the same ilp_ tokens; tRPC stays cookie-session-only for humans.
**Rejected:** push model (cloud-dispatched agents — needs infra Sal didn't pick), MCP hitting tRPC
with a synthetic session.

## 2026-07-30 — Deployed on Drydock (own AWS box), not Render; render.yaml deleted
**Why:** Drydock already runs the fleet on one shared ARM EC2 box (~$30/mo for everything) with
Caddy auto-TLS, a shared Postgres container and OIDC CI — inloop costs no new infrastructure, and
`inloop.dested.com` lives in the same Route53 zone as the rest. `drydock.yaml` is now the deploy
manifest and the portal is its source of truth; the old `render.yaml` was consumed once as a
detection seed and removed.
**Rejected:** Render (a paid service per app for something the box already does), a hand-written
Dockerfile (Drydock regenerates the managed files on every re-wire and would overwrite it).

## 2026-07-30 — Pre-deploy is `bunx prisma db push`, without `--accept-data-loss`
**Why:** the pre-deploy task runs before every deploy, so the flag would let a schema edit silently
drop a production column. Without it, a destructive change fails the deploy loudly and prod keeps
serving the old image — the right failure. There are no `prisma/migrations` yet; push is the model.
**Rejected:** `--accept-data-loss` (what render.yaml carried), running migrations by hand.

## 2026-07-30 — The app keeps its own IAM keys in SSM rather than using the ECS task role
**Why:** `inloop-app` is scoped to exactly the `inloop-files` bucket, and `server/env.ts` requires
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` as a hard zod contract that holds identically in dev and
prod. The box's instance role is a fleet-wide credential — a much wider blast radius for presigning.
**Rejected:** dropping the keys and letting the SDK fall back to the task role (widens what a
compromised container can reach, and makes local dev and prod behave differently).

## 2026-07-30 — Transcription moves server-side by default; on-device becomes the escape hatch
**Why:** on-device `whisper-small.en` made every user download ~250 MB of weights once and then pin
their GPU or CPU after *every* recording — minutes of waiting in the worst possible place, between
finishing the walkthrough and being done. Hosted `whisper-large-v3-turbo` returns in seconds, is a
better model, and costs fractions of a cent per gripe. Keeping the local path as an opt-in isn't a
compromise — it's the free/paid split (their hardware vs ours) and the answer for anyone who can't
send audio to a third party.
**Rejected:** Deepgram Nova-3 first (better — word timestamps, keyterm biasing — but ~10× the
price; Sal chose cheapest-first, and the provider lives behind one module so swapping forward is
easy while un-swapping wouldn't be), `gpt-4o-transcribe` (no timestamps, and the transcript drives
timeline seeking), self-hosting whisper.cpp on the Drydock box (one t4g.large already runs 26 tasks;
CPU inference would starve the fleet).

## 2026-07-30 — Re-encode the decoded audio as WAV rather than record a parallel mic track
**Why:** an opus track from a second `MediaRecorder` would be ~1 MB per 10 minutes instead of
~19 MB of WAV, but it means touching the capture engine — the one part that must never break — and
it wouldn't exist for takes recovered from IndexedDB after a crash. Re-encoding audio the panel has
already decoded works for every take, including recovered ones, with zero risk to recording. Long
takes are split into 8-minute chunks client-side and the timings offset back onto the recording's
clock, because only the client knows where it cut.
**Rejected:** parallel mic recorder (revisit only if upload time becomes the complaint), sending
the whole webm (36 MB and over provider limits), server-side chunking (the server would have to
reconstruct offsets it never saw).

## 2026-07-30 — `GROQ_API_KEY` is optional, and its absence degrades instead of failing
**Why:** a missing provider key must never be a boot crash or a broken recorder. Unset, the
endpoint answers 503 and the extension falls back to the on-device pass — a dev with no key gets
the old slow path, not a dead feature. The cost is that "transcription is slow" now has a silent
cause, which is why it's written down in cliffnotes' gotchas.
**Rejected:** requiring the key in the zod env schema (every dev and the e2e suite would need one),
failing the request loudly (the recorder can't do anything useful with the error).

## 2026-07-30 — /privacy and /terms are real pages, under Arizona law
**Why:** the Chrome Web Store requires a privacy policy URL for an extension that captures screen
and microphone, and a product that stores recordings of people's screens owes them a plain
statement of what's kept and how to delete it. Governing law is Arizona (Sal's call), contact is
sal@dested.com. The policy names every processor (AWS and Groq at first; Anthropic and Resend added
the same day, in the release that introduced them) and describes both transcription modes — so it
stays true whichever way the toggle is set.
**Rejected:** a generated boilerplate policy (it would describe a product we don't have), deferring
until the Web Store rejects us (the policy is on the critical path for submission), publishing a
personal gmail as the contact.

## 2026-07-30 — Email is Resend, and no email failure may block a person
**Why:** the app needed account recovery before strangers could sign up, and Resend is a REST call
with no SDK weight. `sendEmail` never throws — it returns a boolean and, with no `RESEND_API_KEY`,
logs the whole message (reset link included) so a dev can click it out of the terminal. Sign-up
sends a verification mail but does **not** require it (`requireEmailVerification` deliberately off):
an undeliverable address must not be able to lock someone out of a product they just paid attention
to. Invites are emailed best-effort and `invites.create` still returns the link, so a failed send
degrades to copy-paste rather than a lost invitation.
**Rejected:** SES (a second AWS surface to configure for the same job), requiring verification to
sign in (breaks the alpha for anyone whose mail bounces), throwing on send failure (a 500 on
sign-up because an email didn't go is the wrong trade).

## 2026-07-30 — Upload size is enforced by *signing* it, not by trusting the declared bytes
**Why:** `presignPut` now signs `ContentLength`, which puts the length into SignedHeaders, so S3
itself rejects an upload whose `Content-Length` differs from what was declared. Checking the
declared size server-side only proves the client was honest; signing it makes the number binding at
the bucket. On top of that: 512 MB per file, 2 GB per gripe, and a per-org quota (20 GB, 500 gripes)
checked at declare time, subtracting the gripe being replaced so a re-push doesn't count its
predecessor twice.
**Rejected:** presigned POST with `ContentLengthRange` (a second upload shape for the CLI and the
extension to implement, for the same guarantee), verifying at finalize (the bytes are already on
our bill by then), trusting the declared `bytes` (that was the hole).

## 2026-07-30 — Rate limiting lives in memory, on purpose
**Why:** the service runs as a single ECS task, so one process sees every request; Redis would be
ceremony with an extra failure mode. `server/ratelimit.ts` is a fixed-window counter keyed per
route, with a per-IP limit ahead of authentication (so a bad-token flood can't hammer the token
lookup) and per-token limits behind it. If the service ever runs two tasks the limits become
per-task — half as strict, still working. Swap in a shared store *then*.
**Rejected:** Redis/Postgres-backed counters now (a dependency for a problem we don't have),
a single global limit (a burst of agent reads would starve a legitimate upload).

## 2026-07-30 — Alpha pricing may not imply a charge
**Why:** the pricing section advertised $20 and $40 seats with a "Get started" button and no billing
behind it. Charging copy with no charge path is the kind of thing people screenshot. The prices stay
visible — they're the real intention and worth telling people — but in muted ink, under a "Free in
alpha" / "Coming soon" badge, with a CTA that says "Use it free in alpha" and a line under the
heading stating outright that nothing is billed yet and we'll ask before a card is needed.
**Rejected:** deleting the paid tiers (they're the honest roadmap and the reason the free tier has
a shape), wiring billing first (weeks of work in front of a link we want to send now).

## 2026-07-30 — The transcript cleanup pass edits words by index, never timings
**Why:** Groq hears audio, not software: "handbag" for Handback, "cores" for CORS, "you are ell"
for URL. `server/polish.ts` sends the lines to `claude-haiku-4-5` with the page's own evidence — the
recorded origin and its console errors — and asks for corrections keyed by line index. Three rules
make it safe to run unattended: timings never cross the boundary (`t`/`d`/`tl` stay the recorder's),
a line the model doesn't return is kept verbatim, and every failure path returns the original
transcript. The report says when a transcript was polished, because a reader is deciding how far to
trust the words. Haiku rather than Opus: this is spelling against a glossary the prompt already
contains, on every take.
**Rejected:** having the model return the whole transcript (one hallucinated timestamp corrupts the
timeline), running it on-device (the thing we just moved off the user's machine), doing it inside
`/transcribe` (a cleanup failure would then cost the transcript itself).

## 2026-07-30 — Team is entitled per user, checked at the org's owner
**Why:** "team" (inviting members and guests) is a paid feature with no billing behind it yet, so
it's a hand-granted entitlement: `User.features` contains `'team'`, and a workspace has the feature
when its **owner** does (`server/features.ts` → `orgHasFeature`). Granting Sal's customer one flag
lights up every workspace they own — matches "turn it on for particular users" without inventing
org-level plans before billing exists. Platform admins (`User.isAdmin` OR the `ADMIN_EMAILS` env
list — the prod bootstrap, since prod has no shell) implicitly hold every feature. The only gate is
`invites.create`; accepted members, invite revocation, and existing teams keep working if the flag
is later withdrawn — turning team off stops growth, it doesn't amputate.
**Rejected:** an org-level flag (would need granting per workspace instead of per customer),
gating reads for existing members (punishes people who did nothing), a better-auth admin plugin
(two tRPC procedures and one boolean did the job).
