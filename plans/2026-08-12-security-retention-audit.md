# Security audit + retention & liability posture

- **Date:** 2026-08-12
- **Status:** active
- **Type:** analysis
- **What:** Pre-go-wide audit — can media leak, what the policy promises vs reality, and the
  retention design that keeps stored data (and liability) minimal. Findings feed fixes; nothing
  here is applied yet.

## Framing

Owner's directives (2026-08-12): auto-expire resolved walkthroughs (tiered windows), "get it out
of my system as quickly as possible but let's be safe," and processors/models must be visible —
"not in your face but available." Retention is simultaneously the #1 cost lever (storage-forever
compounds; see /admin/costs) and the #1 liability lever (screen recordings can contain anything).

## Policy vs reality (from /privacy + /terms, read 2026-08-12)

| Policy says | Reality | Gap |
| --- | --- | --- |
| "Walkthroughs are kept until someone deletes them" | True today; auto-expiry will change it | Privacy page must change in the SAME release as expiry ships (standing rule) |
| Who-can-see-it: members + token holders, "nobody else" | `/w/:shareToken` public watch pages shipped 2026-08-12 and are not mentioned at all | **Must fix before share links go wide** — the page promises a boundary the product now optionally opens |
| "Organizations" wording throughout | Model is Teams + personal spaces since 2026-08-02 | Stale copy; low risk, fix with the same edit |
| Processors named (AWS, Groq, Anthropic, Resend) | Correct list | Models not named (whisper-large-v3-turbo, claude-haiku-4-5); no anchor link; nothing near the transcription toggle / upload surfaces points here |
| Account deletion = email Sal | True (admin.deleteUser exists, admin-only) | Acceptable for alpha; self-serve delete is the durable fix |

## Retention design (proposed)

**Model.** `Walkthrough.expiresAt DateTime?` — null means no expiry scheduled.

- Setting status → `resolved` stamps `expiresAt = now + window` (both tRPC `setStatus` and the
  shared `walkthroughs-api` path, so MCP `set_walkthrough_status` behaves identically).
- Flipping back to `open`/`in_review` clears it. An explicit **Keep** control (viewer overflow)
  clears it too.
- Window comes from the space's tier, checked at Team.owner via the existing entitlement pattern
  (`server/features.ts`): **Free 30d · Pro 90d · Business 365d · Enterprise custom**. Alpha
  default (everyone unbilled): 90d, announced before the first sweep ever runs.

**Sweep.** An hourly `setInterval` in `server.ts` (one ECS task — same reasoning as the in-memory
rate limiter): find `expiresAt < now`, delete **S3 prefix first, rows second** (the
`admin.deleteUser` ordering — a failed wipe leaves the record intact rather than orphaning
unlistable objects). Same sweep reaps unfinalized walkthroughs older than 7 days (the go-live
doc's "abandoned prefixes" item — an app-level sweep, since S3 lifecycle rules can't see the DB).
Plus one real S3 lifecycle rule for incomplete multipart uploads as a safety net.

**UI.** Viewer masthead meta line gains `expires in 23d` on resolved walkthroughs; overflow gains
**Keep** (clears expiry, one inline arm like every other overflow action). Inbox rows show a quiet
mono expiry tag on resolved items. No countdown anywhere else — quiet, not naggy.

**Human-handback raws.** Today raws survive after `final.mp4` renders so re-edit works, and quota
keeps paying for them (flagged "deliberate, undecided" in cliffnotes). Proposal: raws expire 14
days after a successful render (the share link serves `final.mp4` only; re-edit past 14d is rare
and re-recordable). This is the single biggest per-walkthrough byte saving for human kind.

**Transparency ("available, not in your face").**
- /privacy: name the exact models (Groq `whisper-large-v3-turbo`; Anthropic `claude-haiku-4-5`),
  add `#processors` anchor, add a Share-links section, rewrite retention section around expiry,
  fix Teams wording.
- Product: a quiet "where your recording goes" link → `/privacy#processors` beside the
  transcription toggle (extension settings), on /record, /phone, and /upload.

**Deletion surfaces.** Walkthrough delete exists (viewer overflow → S3-first wipe). Team delete
exists (admin). Account deletion: keep the email path for alpha, add self-serve delete
(re-using `admin.deleteUser`'s refusal rules: not while owning a team, not while platform admin)
before public launch.

## Attack-surface findings (evidence sweep 2026-08-12)

**The headline: media cannot leak by knowing or guessing a URL.** The bucket blocks all public
access; every read is a 1-hour presigned GET; every ID is UUIDv4 (~122 bits); share tokens are
144-bit `randomBytes(18)`; `hb_` tokens 192-bit, stored sha256-only, revocation immediate. Every
URL-minting path is gated (`requireViewAccess` / `inScope` / `requireAdmin` / the share token
itself). `isSafePath` + the 3-value `presignEdit` allowlist close path traversal — no escape
found. Presigned URLs never appear in SSR HTML or logs. **No IDOR anywhere in `walkthroughs.*`,
`teams.*`, `tokens.*`, `projects.*`; every `admin.*` procedure calls `requireAdmin`; SSR loaders
prefetch no admin data.** No stored-XSS path (no `dangerouslySetInnerHTML`, report.md rendered
as escaped text); no SSRF; no open redirect. The `walkthroughs.shared` ip-null limiter skip is
unreachable by real traffic (no SSR loader on `/w`) — but is a trap if SSR prefetch is ever
added there.

**Ranked findings (all Medium or below — nothing High):**

1. **No security headers at the app layer** — no helmet/CSP/HSTS/X-Frame-Options/nosniff; only
   `x-powered-by` disabled (`server.ts:31`). Clickjackable; no CSP defense-in-depth. **Med.**
2. **Cost-abuse of `/transcribe` (Groq) + `/polish` (Anthropic)** — any open-signup, unverified
   account mints a working `hb_` token; limits are per-token and `tokens.create` has no per-user
   cap, so budgets multiply with minted tokens (`ingest.ts:168-177`, `router.ts:528`). **Med.**
3. **A platform admin's token is platform-wide** — `isAdmin` drops the scope filter including
   status writes (`walkthroughs-api.ts:41`). One leaked admin token = every customer's
   recordings. Design choice, documented — but the daily-driver token being an admin token is the
   trap. **Med (design).**
4. **No self-serve account/team deletion + unbounded retention** — only `admin.deleteUser` /
   `admin.deleteTeam`; nothing expires. The retention design below is the fix. **Med/low.**
5. **Email verification not required to sign in** (`auth.ts:31-34`) — throwaway accounts unlock
   finding 2. **Med as multiplier.**
6. Low/info: tRPC `onError` logs procedure input, so failed `shared`/`fileUrl` calls write share
   tokens into server logs (`server.ts:101-104`); client-declared `contentType` stored and served
   inline from the bucket origin (cross-origin to the app, so no scripting of handback.dev);
   `invites.peek` discloses the invited email to the invite-link holder; session cookie flags /
   `trustedOrigins` not explicitly pinned.

## Near-zero-cost free tier (owner directive 2026-08-12: "degraded but not horrible")

After R2 (egress $0) the only real free-tier costs are the AI passes. Design:

- **First walkthrough gets the full magic** — cloud transcribe + polish, once, so the first-run
  experience is the real product. Then:
- **Extension: on-device transcription becomes the free default** (already built —
  `transcribeWorker.ts`, model downloads once). No polish on free; the raw transcript is fine —
  the reading agent copes. Framed as a feature: "your audio never leaves your machine."
- **Web/phone recorders** (no on-device path today): a metered **15 cloud-minutes/mo per USER**;
  past that, uploads still work (video + frames, no transcript) with a nudge to the extension.
- **Slim media on free**: agent-kind bitrate cap (~1 Mbps), raw agent video expires after 7 days
  (frames + transcript live the full 30d window), 2 GB space cap.
- Worst-case maxed free user ≈ **$0.02/mo**; typical ≈ pennies. True zero isn't worth the UX
  damage — pennies is the target.
- Mechanics: tier entitlements in `features.ts` (cloudMinutes, polish, retentionDays, rawVideoDays,
  bitrate profile) surfaced through `GET /api/ingest/context` so every recorder self-configures; a
  per-user monthly usage row (cloud seconds used) checked/incremented by `/transcribe`.

## Anti-abuse stack (the 10,000-accounts question)

The economics do most of the work — after R2 + local transcription a fake account costs ~nothing
until it uploads, uploads are quota'd, and cloud minutes are per-user — so mass signup has no
payoff. Belt and suspenders, in order:

1. **Email verification required** before token mint / upload / cloud transcribe (existing audit
   finding; kills throwaways at the gate) + a disposable-email-domain blocklist.
2. **Per-USER budgets on cost endpoints** (not per-token) + cap active tokens per user (~10).
3. **Cloudflare Turnstile on sign-up** — free, invisible to humans, murders signup scripts;
   natural fit once R2 puts us in the Cloudflare console anyway. (Sign-up is already 5/hr/IP.)
4. Free-tier caps enforced server-side via entitlements (never client).
5. Note for later: the in-memory rate limiter is per-process — correct for one ECS task, must
   move to Postgres/Redis if the service ever scales out.

## Fix list (ordered)

1. **Helmet-or-Caddy security headers** (X-Frame-Options/frame-ancestors, nosniff, HSTS, a
   starter CSP) — small, ships alone. [finding 1]
2. **Cost-endpoint hardening**: per-USER (not per-token) budgets on transcribe/polish + require
   verified email before `tokens.create` + a per-user token cap — before public sign-up.
   [findings 2+5]
3. **Retention** (design above): schema + stamping + sweep + Keep + privacy page in the same
   release. [finding 4]
4. **Privacy page truth-up** (share-links section, named models + `#processors` anchor, teams
   wording) — with or before promoting share links.
5. **Redact tRPC error-log input** for `shared`/`fileUrl` (log a hash, not the token). [finding 6]
6. **Self-serve account deletion** — pre-public-launch. [finding 4]
7. ~~Admin token scoping~~ — **declined by owner 2026-08-12** ("don't do that token thing, it's
   fine"). Admin tokens stay platform-wide; risk accepted. Do not reintroduce without reopening.
8. Pin session cookie flags + `trustedOrigins` explicitly; force `Content-Disposition:
   attachment` (or a fixed safe content-type) on non-media file serves. [finding 6]
