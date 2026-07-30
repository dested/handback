# Inloop — Decisions

> ADR-lite: what was decided, why, what was rejected. Append-only.

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
