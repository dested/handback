# Handback — Decisions

> ADR-lite: what was decided, why, what was rejected. Append-only.

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
