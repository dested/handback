# Inloop — Decisions

> ADR-lite: what was decided, why, what was rejected. Append-only.

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
sal@dested.com. The policy names AWS and Groq as the only processors and describes both
transcription modes — so it stays true whichever way the toggle is set.
**Rejected:** a generated boilerplate policy (it would describe a product we don't have), deferring
until the Web Store rejects us (the policy is on the critical path for submission), publishing a
personal gmail as the contact.
