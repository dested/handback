# Handback — CliffNotes

> Living map of the project. Read this before any coding session.
> Last updated: 2026-08-23. Visual language → `ui.md` · why → `decisions.md` ·
> log → `updates.md`.
>
> **2026-08-23 mega-wave** (plans/2026-08-23-fable5-mega-wave.md): sidebar app
> shell · `Walkthrough.intent` (bug|feature|idea, null default) · the **Refine
> pass** (`server/refine.ts`) · the **walkthrough assistant** (`server/agent.ts`,
> chat with real mutation tools) · **needs_info** status + `ask_reviewer` ·
> evidence screenshots on `post_result` · notify-on-result/question/health ·
> watch-page comments · /usage · /upgrade (pro is admin-granted) · extension
> 1.9.0 intent chips — superseded by **1.10.0, PUBLISHED 2026-08-25** (outbox background
> upload + JPEG 0.8 + speaker plumbing; zipped on macOS with `zip -r`, see the publish gotcha).
>
> **Naming:** the product noun is **walkthrough** (renamed from "gripe" 2026-08-01, owner's
> directive on record). Older log entries below say "gripe" historically — same object. The word
> survives in exactly two frozen places: the S3 key prefix and the `/api/ingest/gripes*` aliases.
>
> **Before opening sign-up to anyone you can't text: read
> [`plans/2026-07-30-go-live.md`](plans/2026-07-30-go-live.md)** — the audit of what's still
> missing (no password reset, unbounded presigned PUTs, no Web Store listing) and the Chrome Web
> Store submission notes.

> **Model note (2026-08-01): workspaces no longer exist.** A user has one implicit **Personal
> space** (rows with `teamId: null, userId: <owner>`) and zero or more **Teams** (`team` table,
> `ownerId` + `seatLimit`). The word "workspace" is banned from code and copy.
>
> **UI note (2026-08-03): space is an attribute, not a mode.** The header SpaceSwitcher is
> DELETED. The inbox spans every space (`walkthroughs.inbox`, client-side filters), Projects and
> Teams pages are cross-space, team creation lives on /team ("Teams"). `useActiveSpace` survives
> only as the destination default for /phone and /upload. Don't reintroduce a global "current
> space".

## What this is

The cloud half of the recording workflow: the place where recorded **walkthroughs** — narrated
screen recordings (a bug, review notes, a change request) produced by the bundled recorder
extension — are uploaded, reviewed by humans, routed to projects, and pulled by coding agents. A
walkthrough folder (report.md + MANIFEST.txt +
`rec-NN/` takes holding walkthrough.webm, keyframes, transcript, recording.json) is pushed via CLI
into S3 + Postgres; the web app is the review surface; an MCP server lets any Claude Code session
pull the queue. Pitch: **see it → say it → agent fixes it → a human signs off.**

Brand: **Handback** (handback.dev, renamed from Inloop 2026-07-30 — see
`plans/2026-07-30-handback-rename.md`) — the agent hands the work back; a human signs off.
Light-only editorial UI (`ui.md`), nothing orange, nothing dark, nothing visually inherited from
the Gripe extension.

## Quick Reference

- **Dev:** `bun run dev` → **https://handback.localhost** (portless proxy — no fixed port; it
  injects `PORT`/`HOST`, server still honors `PORT` for e2e/prod). `portless.json` = `{"name":
  "handback"}`; TLS CA at `~/.portless/ca.pem`. `.env` `BETTER_AUTH_URL` must equal this origin
  (HTTPS also flips on Secure cookies — see `server/auth.ts`). Needs `.env`; see Env below.
  **Caveat:** browser→R2 direct fetches (recording.json, presigned PUT uploads) need this origin in
  the R2 bucket CORS — not yet added (only handback.dev/www/localhost:3995/3210/chrome-extension
  are), so viewer frame-loads / uploads fail in dev until R2 CORS includes `https://handback.localhost`.
- **Type-check:** `bun run typecheck` (`tsgo --noEmit`)
- **DB:** local Postgres 18 service; `bun run db:push` after schema edits (+`db:generate`)
- **E2E:** `E2E_DATABASE_URL=postgres://postgres:<pw>@localhost:5432/handback_test bun run test:e2e`
  (isolated DB + port 3100; screenshots committed; `test:e2e:update` to re-baseline)
- **Seed a dev login:** `bun cli/dev-bootstrap.ts [email] [password] [team]` → prints an `hb_` token
- **Push a walkthrough:** `bun cli/push.ts <folder> --server http://localhost:3995 --token hb_…`
  (`--team <teamId>` targets a team; default is the token owner's personal space)
- **Publish a recorder build:** `bun run publish:extension` (build → zip → upload) →
  `releases/recorder/`; `/recorder` serves the newest within 60s. Steps also run standalone:
  `build:extension` / `zip:extension` / `bun cli/publish-recorder.ts`
- **Chrome Web Store zip:** `bun run pack:store` → `extension/handback-recorder-store.zip`.
  Same build, but `scripts/pack-store.mjs` strips the manifest `key` (Web Store rejects it) into a
  staging copy — source/`dist` keep `key` so the local + self-hosted ID stays `gmggneb…ifdci`.
  **Stripping `key` means the Web Store assigned the store build its OWN id
  `bdhajcllnjcnihcbobhaecldgjlhfdhd` — NOT `gmggneb…`** (the pre-submission assumption was wrong;
  see decisions.md 2026-08-07). `src/app/recorder.tsx` now pings BOTH ids (`EXTENSION_IDS`) and
  links whichever answers. Also guards description ≤132 chars.
- **Web Store listing packet:** `extension/store-listing/` — `LISTING.md` (all form fields:
  summary, description, single purpose, per-permission justifications, data disclosures) + 4×
  1280×800 screenshots, 440×280 + 1440×560 promo tiles, 128 icon. Images are the real side-panel
  build framed on-brand, rendered by `scratchpad/render-store.mjs` (Playwright via `channel:chrome`
  over the `preview.mjs` harness). Dev console can't be automated — Chrome blocks scripting it.
- **Extension:** `bun run build:extension` (root) or `cd extension && npm run build` →
  load-unpacked `extension/dist`;
  `npm run preview` → http://localhost:8777/gallery.html (layout harness, no Chrome needed)
- **MCP (the real one):** `claude mcp add --transport http handback https://handback.dev/mcp --header "Authorization: Bearer hb_…"`
  — hosted, nothing installed; **/connect** in the app walks a user through it and mints the token
  inline. Local stdio fallback: `claude mcp add handback --env HANDBACK_TOKEN=hb_… --env HANDBACK_SERVER=<url> -- bun <repo>/cli/mcp.ts`
- **GitHub:** dested/handback (private; renamed from dested/inloop — redirect holds). **Deploy:
  https://handback.dev is live and serving** (`/healthz` 200, verified 2026-07-30 night);
  `inloop.dested.com` no longer answers — its TLS handshake fails, so treat it as gone. Drydock,
  auto-deploys on push to `main`. The rest of the re-wire checklist (S3 provisioning, SSM, cleanup)
  is still Sal's — `plans/2026-07-30-handback-rename.md`.

## Stack

Bun ≥1.3 · Express 5 + Vite SSR (one `server.ts` dev+prod) · React Router 7 (explicit
`RouteObject[]`) · tRPC v11 (`@trpc/tanstack-react-query`, `.queryOptions()`) · Prisma 7 + Postgres
(pg adapter) · better-auth (email+password) · Tailwind v4 tokens-in-CSS + shadcn-style primitives ·
AWS S3 (`@aws-sdk/client-s3`, presigned URLs) · `@modelcontextprotocol/sdk` (stdio MCP) ·
`mediabunny` (WebCodecs demux/mux — the human-handback editor's engine) · Playwright e2e. Inherited from dested/sal-starter — its conventions (server-only `./server/*`,
`~/*`→`src/*` alias, JSON-safe tRPC returns) still hold.

## Directory structure

```
server.ts               Express entry: /healthz, auth, ingest, tRPC, vite/SSR, 404s
server/
  env.ts                zod env: DATABASE_URL, BETTER_AUTH_*, AWS_REGION, S3_BUCKET, AWS keys,
                        optional S3_ENDPOINT (point at R2 without code changes),
                        GROQ_API_KEY / DEEPGRAM_API_KEY (preferred for transcribe when set —
                        it diarizes) / ANTHROPIC_API_KEY / RESEND_API_KEY + EMAIL_FROM (all
                        optional — each unset one disables its feature, nothing crashes),
                        ADMIN_EMAILS (comma-separated bootstrap platform admins),
                        STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_PRO / STRIPE_PRICE_BIZ
                        (all optional via optionalSecret — empty = unset; unset disables billing)
  auth.ts               better-auth: email+password, autoSignIn, reset/verify email, rate limits.
                        No sign-up hook — a personal space needs no provisioning, it just exists
  trpc.ts               context (session from headers) + public/protectedProcedure
  access.ts             requireTeamRole / requireSpaceAccess(user, {teamId,userId}, atLeast) /
                        requireViewAccess (read-only platform-admin bypass) / memberTeamIds /
                        spaceId (teamId ?? userId — the S3 path segment) / slugify
  features.ts           entitlements: isPlatformAdmin (User.isAdmin OR ADMIN_EMAILS env),
                        teamHasFeature('team') checked at Team.owner, userIsPro ('pro' feature or
                        admin — biz grants 'pro' too so this stays true), requireAdmin.
                        Features are 'team'|'pro'|'biz'. THE billing-entitlement math lives here:
                        featuresForPlan/applyPlanFeatures (idempotent; billing owns pro/biz/team)
                        + tierOfUser → 'admin'|'biz'|'pro'|'free' (the one tier resolver)
  limits.ts             tier ceilings (2026-08-24 final: free tier BACK — tiny counts, full
                        treatment): free 2 walkthroughs + 3 600s transcribe + 20 polish; pro
                        54 000s (15h) + 80 walkthroughs + 1 000 polish (abuse bound) +
                        PRO_ASSISTANT_TURNS=30/mo (real quota, Pro-only);
                        MAX_REFINE_RUNS_PER_WALKTHROUGH=4, MAX_ACTIVE_TOKENS=10, monthKey().
                        Business tier (biz): 30h transcribe (108 000s) + 130 walkthroughs +
                        1 600 polish; ceiling helpers transcribe/polish/walkthrough/assistantCeiling
                        (tier) are the single source for usage.ts + /usage
  pricing.ts            the pricing PLANNING model: zod schema + LOCKED_PRICING_MODEL (owner's
                        2026-08-24 bench lock: $29/$49, 15h+80/30h+130, free 2, cost assumptions).
                        Saved edits live in AdminSetting 'pricing-model' (admin.pricingModel/
                        setPricingModel; admin.costTrend feeds /admin/costs). Planning only —
                        enforcement constants stay in limits.ts
  usage.ts              MonthlyUsage metering: checkAndReserveTranscribe/Polish/AssistantTurn/
                        Walkthrough (atomic upsert+increment; tiered free/pro ceilings — assistant
                        is the one Pro-only pass), cloudStatus for GET /context. Admins fully
                        unmetered. Walkthrough creates 429 at ingest declare past the tier cap
                        (re-push of a slug exempt). First-walkthrough magic stays dead
                        (decisions.md)
  stripe.ts             THE Stripe boundary (only module that imports the SDK): typed client (null
                        when unconfigured), billingConfigured, getOrCreateCustomer (race-safe),
                        price⇆plan mapping, and reconcileByCustomer/reconcileByUser — THE ONLY
                        writer of billing state, which PULLS live subscriptions and re-derives
                        User.features (idempotent; safe against dup/out-of-order/missed events)
  stripe-webhook.ts     POST /api/stripe/webhook — express.raw + signature verify → reconcile.
                        Mounted before any parser (needs the raw body). 400 bad-sig, 500 on
                        transient failure so Stripe retries, 503 when billing unconfigured
  router.ts             THE tRPC API: teams (incl. get/transferOwnership), invites (seat-capped),
                        tokens (user-scoped, no team input), projects (incl. `instructions`),
                        walkthroughs (incl. setIntent, answerQuestion/routeQuestion, refine, chat/
                        chatHistory, sharedAddComment), usage.mine — space inputs are
                        `teamId: string | null` (null = the caller's personal space). Pro gates
                        throw FORBIDDEN with the LITERAL message 'Pro feature' (client contract).
                        billing.* (status/checkout/portal/sync) — Stripe Checkout + Customer Portal
                        + the instant-sync-on-return path; admin.setFeature now toggles team|pro|biz
                        (pro/biz = a hand comp, no Stripe)
  refine.ts             THE Refine pass (budget-gated, free tier included; manual re-run
                        walkthroughs.refine stays Pro): capture-health checks → Haiku vision
                        curation (frames downscaled 800px JPEG, dHash near-dup dedup with
                        click/nav/start immune, narration prompt-cached; batches of 12, ≤84,
                        ≤20 keepers) →
                        Sonnet 5 synthesis (Opus→Sonnet 2026-08-24, decisions.md): digestMd
                        (2–4 human sentences) + pointsJson KeyPoint[]
                        (kpN ids, severity, atMs — THE structured spine) + summaryMd ledger +
                        refinedBriefMd (sections headed per KP). Titles: Session-class defaults
                        replaced outright; human-chosen ones only get suggestedTitle. Live
                        refineStage reading|frames|writing for the viewer's progress hero.
                        NEVER throws; refineStatus running|done|failed; payer = uploader on
                        auto-run, the CALLER on manual ({byUserId}); meters one polish call;
                        refineRuns capped at 4 total per walkthrough (router gate).
                        Original report.md in S3 is never rewritten
  agent.ts              THE walkthrough assistant (walkthroughs.chat): Sonnet 5 tool loop (≤12
                        iterations) over read_walkthrough / update_title / update_summary /
                        update_brief / edit_transcript_lines (text only, timings frozen) /
                        remove_span (strikes lines + deletes frames + records an excluded-span
                        MARKER — video is never re-encoded) / set_curated_frames /
                        update_digest / update_key_points (re-ids kp1..N). Every mutation
                        logged to walkthrough_revision; thread persisted in walkthrough_chat;
                        never throws into the router
  ingest.ts             Token-authed REST (Bearer hb_…): two-phase upload, size caps + per-org
                        quota, /transcribe and /polish; read side delegates to walkthroughs-api.
                        Every route registered under /walkthroughs* AND legacy /gripes* aliases
  walkthroughs-api.ts   THE agent-facing surface: token auth + list/get/setStatus/postResult
                        (the review thread) + the WalkthroughAccess trace. Shared by ingest.ts
                        AND both MCP servers so they can't drift. A token reaches its
                        owner's personal space + every team they're in; a platform admin's token
                        reaches everything. Items carry `space` (team name or "Personal")
  notify.ts             the doorbell: emails a team (minus uploader; verified + unmuted only)
                        when a walkthrough finalizes, + the HMAC unsubscribe-link signing
                        (per NotifyKind 'uploads' | 'digest')
  search.ts             full-text: fills Walkthrough.searchText at finalize (report.md /
                        transcript.json), query-time to_tsvector search (no GIN index yet)
  digest.ts             the Monday digest: hourly sweep, fires in ONE UTC window (Mon 15:00),
                        digestSentAt stamped BEFORE send (idempotency)
  mcp.ts                Hosted MCP at /mcp — StreamableHTTP, stateless, hb_ bearer auth
  mcp-format.ts         Pure formatter for a walkthrough brief; shared with cli/mcp.ts
  storage.ts            S3: presignPut/Get, getObjectText, deletePrefix, deleteKeys, key layout,
                        isSafePath. Honors optional S3_ENDPOINT (R2/S3-compatible, forcePathStyle)
  retention.ts          THE deletion clocks: RETENTION_DAYS=30 (resolved auto-expire via
                        expiryFor), RAW_TTL_DAYS=14 (human raw takes post-render), 7d unfinalized
                        reap; hourly S3-first sweep (startRetentionSweep in server.ts)
  transcribe.ts         speech-to-text: Deepgram nova-3 (diarize → segments carry `speaker`,
                        provider-local per chunk) when DEEPGRAM_API_KEY set, else Groq
                        whisper-large-v3-turbo; segments in ms
  polish.ts             transcript cleanup via claude-haiku-4-5 — text only, timings untouched
  structure.ts          the split pass: report.md + comments → 1–10 proposed tasks via
                        claude-sonnet-5 structured outputs (no prefill); every
                        failure degrades to null like polish. childBriefMd() writes a child's
                        brief_md (steps, done-when, "Source: get_walkthrough(parent)")
  email.ts              Resend sender + reset/verify/invite templates; never throws
  alerts.ts             self-hosted error alerting: reportError (dedup 1/sig/hr, 20/day cap →
                        ADMIN_EMAILS via Resend), installProcessAlerts (uncaught/unhandled, no
                        exit), clientErrorRouter (POST /api/client-error). Never throws, never
                        alerts on itself. (A smoke.yml cron probe shipped 2026-08-23 and was
                        deleted same day on Sal's order — don't reintroduce it)
  ratelimit.ts          in-memory fixed-window limiter (one ECS task, so one process sees all)
  prisma.ts / logger.ts PrismaClient singleton · ANSI request logger
cli/
  push.ts               `handback push` — declare → PUT xN → finalize; `--team <id>` or personal
  mcp.ts                stdio MCP server — the LOCAL fallback; prod uses server/mcp.ts at /mcp
  stripe-setup.ts       idempotent Stripe provisioning: Pro $29 + Business $49 products/prices
                        (matched by metadata / lookup_key) + a 100%-off comp coupon (promo
                        HANDBACK100). Prints the price ids for .env. Run once per Stripe account/mode
  dev-bootstrap.ts      idempotent dev seed: user (admin + team feature) + owned Team + token
  migrate-teams.ts      the one-shot workspace→teams data migration (raw SQL + S3 re-prefixing;
                        idempotent/resumable). ALREADY RUN on prod 2026-08-02 — keep for reference
  make-admin.ts         promote an account to platform admin by email (dev; prod uses ADMIN_EMAILS)
  backfill-expiry.ts    ONE-SHOT: stamp expiresAt on already-resolved walkthroughs (never make it
                        recurring — Keep clears expiresAt on purpose). NOT YET RUN on prod
  migrate-storage.ts    S3→R2 copy CLI (SRC_*/DEST_* env, --dry-run, size-skip idempotent).
                        OWNER-GATED — do not run until Sal says cutover day (decisions.md)
prisma/schema.prisma    better-auth models + Team(ownerId, seatLimit)/Membership/Invite/Project/
                        Walkthrough/Take/WalkthroughFile/ApiToken — Project/Walkthrough carry the
                        ownership pair `teamId | userId` (exactly one set; null teamId = personal)
src/
  app/
    routes.tsx          All routes + loaders (appLoader guards session, prefetches orgs.mine)
    layout.tsx          Shell: marketing chrome vs app chrome. SpaceSwitcher dropdown (Personal
                        first, then teams, "New team…" modal gated on teams.entitlements); the
                        Team nav renders only on a team space
    home.tsx            Landing page (assembles src/components/landing/*)
    sign-in/up.tsx      Auth cards (better-auth client flows)
    app.tsx             InboxPage (route /app, header reads "Walkthroughs"): a card GRID of every
                        walkthrough you can reach + a light filter toolbar (search · status
                        segments with mono counts · Space/Project popover selects that only appear
                        when you have >1 space / any projects). One `walkthroughs.inbox` query,
                        client-side filtering. No provisioning state — Personal always exists
    walkthrough.tsx     WalkthroughPage: THE REVIEW DESK (2026-08-24 rethink — assembles
                        src/components/viewer/desk/*): full-bleed masthead over
                        [tab rail | work]; state-driven hero tab; the review is TABBED
                        (exchange 3rd column deleted 2026-08-24pm — Conversation tab + Edit
                        with AI tab + sign-off/answer on the Overview hero). Modes: editing
                        (CloudEditor), human (edit→share, no desk), child task (TaskBrief +
                        SignOff/AnswerForm + Conversation). App sidebar forced to icon rail here
    projects.tsx        Projects list + create (origin-hints field removed from the UI)
    team.tsx            Members / Invites for team spaces (seat line, owner-only role select +
                        ownership transfer); a lone personal card otherwise. No guests
    connect.tsx         /connect — THE agent onboarding, one button + one paste: "Create my
                        command" mints an auto-named token and renders the real `claude mcp add`
                        with Copy in place (before the click the command is an inert dimmed
                        preview). Two numbered steps; tools, "Putting it to work", disconnect
                        instructions and "Your API tokens" (list + revoke, no create form) are
                        unnumbered reference below. Codex is a "soon" tab.
    record.tsx          /record — THE extension-free recorder: hero → live HUD → takes list +
                        destination + send. Resumes whatever is still in IDB on mount (a take
                        left mid-recording is rebuilt from its chunks). Nav label "Record".
                        Third kind "just talk": mic-only voice note (in-memory blob, NO IDB)
                        sent through the phone distill pipeline with a pre-supplied probe
    recorder.tsx        /recorder — THE recorder onboarding: install (STORE_URL now set → "Add to
                        Chrome" button; zip/load-unpacked collapses behind a disclosure), live
                        install ping across BOTH extension ids (`EXTENSION_IDS`: store + self-hosted),
                        one-click Link to whichever id answered (token minted + handed over, nothing
                        pasted). Two numbered steps; "Then just record" is unnumbered
    watch.tsx           /w/:shareToken — public watch page (walkthroughs.shared, rate-limited)
    phone.tsx           /phone — Handback on the phone: guide (per-OS: Android install+share,
                        iOS A2HS+Photos picker, desktop "open this on your phone") AND the
                        share-target intake: clips → in-browser distill → upload. Mints its own
                        hb_ token (localStorage handback.phone.token), silent re-mint on 401
    join.tsx            /join/:inviteId — peek + accept
    admin/              /admin — the platform-admin console, its own sidebar shell (nested routes):
                        layout.tsx (gate + sidebar frame), overview.tsx (counts, status mix,
                        latest accounts/uploads), users.tsx + user.tsx (search, team/admin
                        toggles, per-account detail: tokens, teams, walkthroughs by space),
                        teams.tsx + team.tsx (all teams w/ seats·storage; roster, invites,
                        projects, seat-limit editor, add/remove members + role switch + invite
                        revoke, delete team), walkthroughs.tsx (platform
                        feed, status filter, debug links), walkthrough-debug.tsx (full anatomy
                        of one walkthrough: the EXACT MCP brief via getWalkthroughDetail+
                        formatWalkthrough, frame-cap math, takes, all files incl. pending,
                        report.md, move-to-any-space control), pricing.tsx (the lever bench:
                        edits the AdminSetting-saved planning model live), usage.tsx (per-space bytes/
                        recordings vs quota), costs.tsx (THE cost estimator: measured GB/hr
                        anchors via admin.costStats, editable unit prices, scenario sliders,
                        retention as the storage lever, tier-margin table — pricing constants
                        live at the top of the file), shared.tsx. user.tsx also carries
                        delete account
    docs.tsx            /docs — how it works with Claude Code (legal.tsx chrome; facts only)
    forgot-password.tsx /forgot-password — same answer whether or not the account exists
    reset-password.tsx  /reset-password?token=… — the link better-auth emails
    privacy.tsx         /privacy — what's collected, where it lives, subprocessors
    terms.tsx           /terms — alpha status, recording consent, Arizona law
  components/
    logo.tsx            ReturnMark + Wordmark — THE identity (the returning stroke), never redraw
    setup-step.tsx      the numbered editorial Step shared by /connect and /recorder, plus
                        `autoTokenName(kind, ua, now)` — the name both pages mint under so
                        neither has to ask for one
    token-manager.tsx   THE token-management surface, shared by every mint page: TokenList
                        (list + per-row revoke), TokenManager (the /connect reference section),
                        TokenLimitNotice (the inline "revoke one to continue" panel) and
                        `isTokenLimitError(err|string)`. The cap error ("Too many active tokens")
                        renders TokenLimitNotice inline on /connect·/recorder·/phone·/record·/upload
                        AND the viewer's re-transcribe control (recording-tab.tsx)
                        so a stuck user can revoke where they are, not on a buried settings page
    legal.tsx           LegalPage/Section/Terms/Notice — shared chrome for /privacy + /terms
    inbox/              card.tsx — THE /app walkthrough card (WalkthroughCard + InboxCard type):
                        keyframe thumbnail for agent-kind-with-frames, a paper title-card set in
                        type (kind + big mono duration) otherwise; status chip, space·project,
                        uploader·time, mono duration/errors/expiry, whole-card stretched Link, and
                        a per-card ⋯ menu whose one job is Rename (arms the inline title editor,
                        usePopover from viewer/overflow-menu). Filter state + toolbar live in
                        app.tsx. (rail.tsx — the old filter rail — DELETED 2026-08-12)
    ui/                 button, card, input, label, sidebar (shadcn new-york style, no asChild;
                        sidebar is hand-rolled — no radix — collapse persisted, mobile overlay)
    phone/              guide, clip-list (+AddClips/voice note), destination (one grouped
                        control), kind (KindControl — the 2-way agent/person picker shared by
                        /upload + /phone manual intake; /record keeps its own 3-way), stages
                        (distill progress rows; VOICE_RECORD_ROWS feeds /record's voice mode,
                        HUMAN_ROWS the clip-based human path) — /phone's pieces
    landing/            hero, how-it-works, distill, walkthrough-manifest, agent-view, pricing,
                        final-cta · demo-shot.tsx (a keyframe as SVG) + demo-data.ts (the one
                        demo walkthrough) + mock.tsx (Pane/ContactSheet/Filmstrip/PlayerStrip/
                        RecorderPanelMock — the hero's extension panel)
    viewer/             desk/ is THE viewer (2026-08-24 rethink, plans/2026-08-23-viewer-rethink.md):
                        masthead (crumb·title·StatusChip·intent pill·project·Copy-brief-when-open·⋯;
                        suggested-title use/dismiss row) · status-chip (dot+word, popover) ·
                        rail (vertical tabs w/ counts + refine control footer; horizontal <lg) ·
                        overview-tab (state-driven hero + the reviewer's ACTION inline:
                        refining progress / digest+key points / THE VERDICT w/ per-point
                        outcomes + SignOff card / question + AnswerForm / signed-off+Keep) ·
                        key-points (the table, seek chips) · conversation (ONE thread: notes+
                        comments+activity+refine lines + a single comment box; NO assistant,
                        NO sign-off) · review-actions (SignOff card + AnswerForm+voice, rendered
                        on the Overview hero; self-guarding) · assistant (AssistantTab — the
                        "Edit with AI" tab, Pro-gated, pulled out of the thread) · markdown
                        (react-markdown+gfm) ·
                        recording-tab (stage + fixed 300px transcript col + Timeline +
                        the re-transcribe control: use-retranscribe.ts decodes take audio
                        in-browser → /transcribe(+polish) → walkthroughs.applyTranscript
                        rewrites recording.json; report.md untouched, re-run Refine after) ·
                        frames-tab
                        (slideshow + staged deletes) · console-tab · report-tab (raw on purpose) ·
                        brief-tab (refined brief rendered; report.md fallback) · tasks-tab
                        (SplitChildren + gated SplitPanel) · use-walkthrough-media (recordings/
                        frames/player/staged-deletes hook) · use-voice-answer · types.
                        DELETED 2026-08-24: walkthrough-header, agent-view, agent-answer,
                        assistant-panel, refine-panel, comments-panel, status-control; then
                        exchange (the single merged pane) DELETED 2026-08-24pm — split into
                        conversation + review-actions + assistant.
                        Still live beside desk/: overflow-menu (usePopover +
                        kind/move/share/delete, inline arming, no window.confirm; also
                        "Export video (MP4)" for agent kind — export-video.ts fetches the
                        take webms and re-encodes via renderEdit, dynamic import, state
                        survives the popover closing) ·
                        timeline (THE scrubber: source-global axis, cut tags are the only cut
                        toggle, one-gesture drag, empty→one muted line) · use-segment-player
                        (multi-take playback, rAF playhead) · slideshow (shot-by-shot
                        frames: big still + filmstrip + synced dialog strip, edit-mode frame
                        deletion via walkthroughs.deleteFrames; replaced frames-grid
                        2026-08-14) · transcript-panel (borderless, live active line) · events-panel
                        (mono, red/violet ticks) · section-head · report-panel ·
                        share-control (url·copy·revoke pill) · final-cut · skeleton · types ·
                        format · use-copy · split-panel (SplitPanel — the propose/apply split
                        flow, + TaskBrief child page + SplitChildren parent ledger).
                        take-section/filmstrip/walkthrough-controls DELETED
    edit/               editor.tsx — THE scrubber-first editor for human handbacks: the viewer's
                        Timeline over a source-global axis (takes at FULL length) with every cut
                        as a toggleable tag, client-extracted thumbs (lib/edit/thumbs.ts) and
                        envelope-driven voice bars, useSegmentPlayer beside a transcript rail
                        (strike a line to cut its seconds), Tighten slider, take reorder in the
                        timeline's take lane. Two clocks: the player's output clock (cuts removed)
                        and the timeline's source-global one — `outputToSource`/`sourceToOutput`
                        are the only bridges. No timeline selection — that stays dead
                        (decisions.md 2026-08-01 + 2026-08-12) ·
                        cloud-editor.tsx — the same editor over an UPLOADED walkthrough
                        (extension human handbacks): downloads raws via presigned GETs, takes
                        keyed by `take.dir`, renders + attaches via presignEdit/finalizeEdit;
                        "Tighten & share" / "re-edit this cut" on the viewer
  lib/
    space.tsx           SpaceProvider/useActiveSpace — Personal + teams; active space in
                        localStorage `handback.activeSpace` ('personal' | teamId); never null
    pwa.ts              SW registration, deferred install prompt, share-stash pickup
                        (peekSharedMedia reads WITHOUT deleting; clearSharedMedia is the only
                        delete, called once the walkthrough is uploaded or discarded)
    capture/            THE phone distill pipeline — a deliberate PORT of the extension's
                        (see decisions.md 2026-08-02): frames (dedup+budget), grids, audio→WAV,
                        transcribe/polish clients, report/MANIFEST/recording.json builders,
                        two-phase upload (XHR PUTs — byte progress + 3-try retry), distill.ts
                        orchestrator (`kind: 'human'` skips keyframes/sheets/report.md — the
                        live-upload human contract), pending.ts (the crash-survivable run:
                        IDB 'handback-phone'; PendingRun.kind, absent = 'agent').
                        Public surface: types/probe/context/distill/pending. Mirror any extension
                        pipeline change here. **Its generic half is extracted to
                        github.com/dested/video-to-prompt (G:\code\video-to-prompt) and will
                        eventually be consumed from there instead — until then any pipeline change
                        mirrors THREE ways: here, extension, library (decisions.md 2026-08-06)**
                        live.ts / live-store.ts / live-upload.ts are the WEB RECORDER (/record):
                        the extension's capture engine ported to a page (no content script, so no
                        events/pointer/click+nav frames), its IDB `handback-web-recorder`, and the
                        take-set → file-set → upload tail. live.ts imports the dedup constants and
                        `cellDiff` from frames.ts — one copy on this side of the repo
    capture-token.ts    useCaptureToken(kind) — the mint/re-mint-on-401 hb_ token helper shared by
                        /phone, /upload and /record (was copy-pasted in each). Stores `{token,id}`
                        in localStorage `handback.phone.token` (back-compat: an old bare `hb_`
                        value has no id) and best-effort REVOKES the dead token on a 401 re-mint —
                        so a browser replaces its key rather than piling revoked rows against
                        MAX_ACTIVE_TOKENS. Same replace-on-relink invariant on /recorder
                        (localStorage `handback.recorder.tokenId`, revoked before each re-link).
    edit/               THE human-handback edit engine (web-only, NOT part of the mirrored
                        distill pipeline): edl.ts (EditState = takeOrder + cuts; derived
                        EditSegment[] is order-capable — full reorder is legal downstream even
                        though the UI only removes + reorders takes), silence.ts (RMS envelope
                        ∩ no-words → proposed cuts), remux.ts (mediabunny stream-copy so cueless
                        MediaRecorder webm can seek), render.ts (EDL → H.264+AAC final.mp4 via
                        mediabunny/WebCodecs, hardware encode, odd-dimension canvas fallback),
                        transcript.ts (edited-clock line re-timing, shared by both send paths),
                        transfer.ts (XHR GET/PUT with byte progress + 3-try retry)
    trpc.tsx / auth-client.ts / utils.ts
  styles/app.css        ALL design tokens (light only) + .rule/.stamp/.ink-underline utilities
public/                 manifest.webmanifest (PWA: standalone, share_target, shortcut) · sw.js
                        (share-POST stash ONLY — caches nothing, keep it that way) · icons/
                        (return-mark PWA icons, regenerate via `node cli/make-pwa-icons.mjs`) ·
                        og.png (the social card, 2400×1260 — regenerate via `bun run make:og`
                        (scripts/make-og.mjs, Playwright); og:image:width/height in index.html
                        must match dsf×viewport) · sitemap.xml · robots.txt (Sitemap: line)
e2e/                    smoke.spec.ts + committed screenshots (landing, sign-up, app flow)
index.html              SSR template; Google Fonts (Fraunces/Libre Franklin/IBM Plex Mono);
                        manifest + apple-touch-icon links
Dockerfile              DRYDOCK-OWNED — regenerated on every wire/re-wire, never hand-edit
drydock.yaml            DRYDOCK-OWNED — the deploy manifest (portal is source of truth)
.github/workflows/
  drydock.yml           DRYDOCK-OWNED — OIDC build → ECR → predeploy → ECS deploy on push to main
extension/              Handback Recorder — the Chrome MV3 extension (own npm workspace)
  public/manifest.json  MV3: sidePanel + activeTab/scripting/storage/tabs; hotkey Alt+Shift+D
  src/lib/              Shared contracts: types, messages (worker protocol), timeline math,
                        db (IndexedDB 'handback-recorder', v2 adds the `outbox` store),
                        bundle (buildFileSet — the in-memory gripe file set, moved out of
                        App.tsx for the offscreen uploader), grids (contact sheets, moved
                        from sidepanel/), report.md builder, upload (to /api/ingest
                        — XHR PUTs: live byte progress + 3-try retry, mirrors src/lib/capture/upload.ts),
                        context (GET /api/ingest/context), walkthroughs (GET /api/ingest/walkthroughs
                        — the workspace's queue, read back into the panel's home screen)
  src/background/       Service worker: hotkeys, dock routing, IndexedDB writes, strip docking,
                        offscreen-doc lifecycle (ensureOffscreen/kickDrain + onStartup resume)
  src/offscreen/        THE UPLOADER (1.10.0): drains the outbox oldest-first — buildFileSet
                        → pushGripe — so "send to Handback" enqueues and returns; panel
                        follows along via `outbox:changed` broadcasts (sidepanel/Outbox.tsx)
  src/content/          On-page dock (d/c/s keys), ink drawing, click ripples, telemetry;
                        injected.js relay
  src/sidepanel/        Panel app: Home.tsx (the nothing-open screen = the workspace: destination
                        row + switcher, the workspace's queue with status/project filters, sessions
                        still on this machine), recorder (getDisplayMedia incl. system audio + raw
                        mic, Web Audio mix + dedup — see the audio gotcha), transcription
                        (transcribeCloud.ts → the workspace; transcribeWorker.ts → on-device),
                        polish.ts (the cleanup pass, after transcription), Parts list
                        (the review screen — one card per recording, see the gotcha),
                        grids contact sheets, App.tsx orchestration
  scripts/              make-icons, copy-ort, prune-dist, preview.mjs + preview/ (layout harness)
```

## Routes / URLs

| Route | Serves | File |
| --- | --- | --- |
| `/` | Landing (marketing) | `src/app/home.tsx` |
| `/sign-in` · `/sign-up` | Auth | `src/app/sign-{in,up}.tsx` |
| `/join/:inviteId` | Invite accept | `src/app/join.tsx` |
| `/forgot-password` · `/reset-password` | Password recovery (better-auth emails the link) | `src/app/{forgot,reset}-password.tsx` |
| `/privacy` · `/terms` | Legal pages (linked from the marketing footer) | `src/app/{privacy,terms}.tsx` |
| `/docs` | **How Handback works** — the loop, the hosted `claude mcp add` line, all six MCP tools, teams, FAQ. Public, legal-page chrome, linked from marketing nav + footer | `src/app/docs.tsx` |
| `POST /api/client-error` | Browser error beacon (prod only) → alert email pipeline; per-IP rate-limited | `server/alerts.ts` |
| `POST /api/stripe/webhook` | Stripe billing webhook — raw-body signature verify → reconcile the customer's entitlements from live subscriptions | `server/stripe-webhook.ts` |
| `/app` | **Walkthroughs** — ALL spaces as a card GRID (not a list), light filter toolbar (search · status segments w/ mono counts · Space/Project popover selects, shown only when >1 space / any projects) over one `walkthroughs.inbox` query, client-side filtered. Cards carry a keyframe thumbnail (agent kind) or a paper title-card; rename lives in a per-card ⋯ menu via `walkthroughs.rename` | `src/app/app.tsx` + `src/components/inbox/card.tsx` |
| `/upload` | Desktop intake: drop a clip → **for an agent** (distill) or **for a person** (ships whole, `kind: 'human'`, edit in the viewer) → upload (reuses capture lib + phone components) | `src/app/upload.tsx` |
| `/walkthroughs/:walkthroughId` | The viewer (`/gripes/:id` 302s here) | `src/app/walkthrough.tsx` |
| `/projects` · `/team` | Projects (ALL spaces, grouped; create w/ space select) · "Teams" — every team (roster/invites/seats per team, New team lives HERE) | `src/app/{projects,team}.tsx` |
| `/connect` | Connect a coding agent — one button mints a token and fills in `claude mcp add`; tokens/disconnect are reference below | `src/app/connect.tsx` |
| `/record` | **Record with no extension** — live `getDisplayMedia` capture in the page. Kind picker: **for an agent** (distill pipeline), **for a person** (pristine 30 fps capture → transcript-first editor → mediabunny MP4 render → share link), or **just talk** (mic-only voice note, in-memory, through the phone distill pipeline). Multi-take, crash-recoverable, optional always-on-top Document PiP HUD | `src/app/record.tsx` |
| `/w/:shareToken` | **Public watch page** for a shared walkthrough — no session, the token IS the credential; plays `final.mp4` + transcript (falls back to takes) | `src/app/watch.tsx` |
| `/recorder` | Install + one-click-link the extension (detects install, mints token, handshake). Nav label is **"Extension"**; the nav's "Record" is `/record` | `src/app/recorder.tsx` |
| `/phone` | Phone guide + share-target intake — OS-recorded clips distilled in-browser and uploaded. Manual intake carries the agent/person kind choice; a share always ships 'agent' (decisions.md 2026-08-18) | `src/app/phone.tsx` |
| `POST /share-target` | PWA share sheet target — SW intercepts + stashes; Express fallback 303s to /phone | `public/sw.js` · `server.ts` |
| `/admin` (+ `/users[/:id]`, `/teams[/:id]`, `/walkthroughs`, `/usage`, `/costs`) | Platform-admin console — sidebar shell, overview stats, users + drill-down, teams + seat editor, platform feed, per-space usage, cost estimator (live anchors from `admin.costStats` + client-side scenario sliders → per-user cost + tier margins) | `src/app/admin/*` |
| `/usage` | The account's own meters: storage per space vs 20 GB/500, cloud budgets, tokens n/10, expiring ≤7d — `usage.mine` | `src/app/usage.tsx` |
| `/upgrade` | Pro/Business pricing wall → Stripe Checkout (`billing.checkout`), Manage subscription → Customer Portal (`billing.portal`); syncs on `?checkout=success`. Falls back to the invite-only mailto card when billing is unconfigured; comped accounts see the stamp | `src/app/upgrade.tsx` |
| `/dashboard` | redirect → /app (legacy) | `routes.tsx` |
| `/healthz` | DB probe | `server.ts` |
| `/api/auth/*` · `/api/trpc/*` | better-auth · tRPC | `server.ts` |
| `/api/notifications/unsubscribe` | One-click mute for upload emails (HMAC-signed link, no session) | `server.ts` · `server/notify.ts` |
| `/api/ingest/*` | Token-authed REST (below) | `server/ingest.ts` |
| `/mcp` | **Hosted MCP** (POST only, `hb_` bearer). What agents connect to | `server/mcp.ts` |
| `/download/recorder` | The extension zip — **session-gated**, 302s to a presigned S3 GET | `server.ts` |

### /api/ingest (Bearer `hb_…` token; org comes from the token)

| Endpoint | Does |
| --- | --- |
| `GET /context` | Who the token speaks for: `{ user, personal: {projects}, teams: [{id,name,slug,projects}] }`. Feeds the recorder's destination picker |
| `POST /walkthroughs` | Declare: metadata + file list → rows + presigned PUT per file. Optional `teamId` targets a team (member-validated; absent = personal), optional `projectId` pins a project in that space (else originHints route it). Re-declaring an existing (space, slug) deletes the old walkthrough + S3 prefix first |
| `POST /walkthroughs/:id/finalize` | Marks files uploaded + sets `finalizedAt` (list only shows finalized) |
| `GET /walkthroughs` | List for agents (MCP `list_walkthroughs`): everything the token reaches, `?team=personal\|<id>` filters. Platform-wide when the owner is a platform admin |
| `GET /walkthroughs/:id` | Detail + `reportMd` text + presigned GET for every file (MCP `get_walkthrough`) |
| `POST /walkthroughs/:id/status` | open / in_review / resolved (MCP `set_walkthrough_status`) |
| `POST /walkthroughs/:id/result` | The agent's answer (MCP `post_result`): summary + optional prUrl/filesTouched/body **+ evidence[] (paths from /evidence — flips those rows uploaded, lands on the note)** → review-thread note; auto-flips open → in_review. No `/gripes` alias (nothing old posts it) |
| `POST /walkthroughs/:id/question` | MCP `ask_reviewer`: agent asks instead of guessing → WalkthroughNote kind 'question', status → needs_info, uploader emailed. No `/gripes` alias |
| `POST /walkthroughs/:id/evidence` | MCP `attach_evidence`: ≤4 proof screenshots (png/jpeg/webp ≤5 MB) → pending rows + presigned PUTs at `evidence/<ts>-<name>`; cite the paths in post_result |

All five walkthrough routes also answer under the legacy `/gripes*` spellings — same handlers,
same rate-limit keys — because shipped recorders ≤1.2.x still post them. Don't remove the aliases
until no old install remains.
| `POST /transcribe` | 16 kHz mono WAV body in, `{segments:[{t,d?,text}]}` out. Stateless — the recorder chunks and offsets. 503 when `GROQ_API_KEY` is unset |
| `POST /polish` | `{lines:[{text}], context:{origin,title,errors}}` in, the same number of lines back with product nouns spelled right. Text only — no timings cross this boundary. 503 when `ANTHROPIC_API_KEY` is unset |

Every route is rate-limited: one per-IP limit ahead of authentication, then a per-token limit per
route (`server/ratelimit.ts`). Declare also enforces 512 MB/file, 2 GB/walkthrough, 20 GB + 500
walkthroughs per org, and the presigned PUT signs `ContentLength` so S3 rejects an upload that
doesn't match.

## Data model (Postgres via Prisma)

better-auth's User/Session/Account/Verification, plus: **Team** (`ownerId` — authoritative,
transferable; `seatLimit` default 5, enforced on invites/accept; created from the switcher behind
the `team` entitlement; the owner also holds a Membership row role `admin`, effective role is
computed) ← Membership (role admin/member, unique team+user — no scope, no guests) · Invite (id
IS the join-link token, 7-day expiry, team-only) · Project and **Walkthrough** both carry the
**ownership pair `teamId | userId`** — exactly one set, `userId` = someone's personal space; slug
uniqueness per space is **code-enforced** (findFirst + suffix loop; no DB unique — Prisma can't
partial-index a nullable pair). Walkthrough keeps slug/status/finalizedAt/errorCount/droppedCount
semantics ← Take (rec-NN) + WalkthroughFile (path unique per walkthrough; S3 key =
`orgs/<spaceId>/gripes/<walkthroughId>/<path>` where spaceId = teamId ?? userId — both segments
frozen) · **WalkthroughNote** (the review thread: role 'agent' — post_result's summary/prUrl/
filesTouched/bodyMd — or 'reviewer' — the send-back note; authorName denormalized so revoked
tokens/deleted users still read) · **WalkthroughAccess** (the agent trace: tokenName + action
pulled/status/result, 'pulled' deduped per 10 min) · ApiToken (**user-scoped**, no team column;
sha256 hash only; `hb_` prefix; lastUsedAt stamped on ingest auth) · **WalkthroughComment**
(margin notes, optional `atMs` on the output clock; rides into the brief; own-delete only) ·
User billing columns (Stripe): `stripeCustomerId` (plain, code-unique, indexed — NOT a DB
@unique, so the prod predeploy needs no --accept-data-loss), `stripeSubscriptionId`, `plan`
('pro'|'biz'|null), `subscriptionStatus`, `currentPeriodEnd` — a display mirror; `features` stays
the enforcement truth · User.notifyUploads / notifyDigest (email mutes) + digestSentAt · Walkthrough.searchText (the
FTS corpus, filled at finalize) · **Walkthrough.parentId / briefMd** (a split-out task: a
metadata-only child row — no files, takes, or bytes; `briefMd` IS its report; self-relation
"split" with `onDelete: SetNull` so children outlive a deleted parent as standalone tasks) ·
**Walkthrough.intent** ('bug'|'feature'|'idea'|null — null presumes nothing; drives the brief's
framing) · **the Refine columns** (`summaryMd` ledger, `refinedBriefMd` — the brief serves
`briefMd ?? refinedBriefMd ?? S3 report.md` — `healthJson` [{severity,text,atMs}],
`curationJson` {frames:[{path,caption,atMs}], excluded:[{startMs,endMs,reason}]},
`refineStatus` running|done|failed, `refinedAt`) · **WalkthroughNote.kind**
('result'|'question'|'answer'; default 'result' — a reviewer 'result' is a send-back) +
**WalkthroughNote.evidencePaths** + **WalkthroughNote.outcomesJson** (PointOutcome[]:
`{point 'kpN', status fixed|partial|skipped|not_applicable, note}` — how a result answered
each key point; null from old agents) · **the key-point columns (2026-08-24)**:
`Walkthrough.digestMd` (the human digest), `pointsJson` (KeyPoint[] `{id 'kpN', title, detail,
severity, atMs|null}` — the spine the brief numbers and post_result answers), `suggestedTitle`
(refine's title when a human-chosen one was kept; rename/dismiss clear it), `refineStage`
('reading'|'frames'|'writing' while running) · **WalkthroughChat** (the assistant thread; userId is a
plain column, no FK) · **WalkthroughRevision** (append-only mutation log of every assistant
edit) · **Project.instructions** (standing agent context, prepended to every brief from that
project) · **User.notifyResults** (+ unsubscribe kind 'results'). Statuses are now
open | in_review | **needs_info** | resolved (needs_info = agent asked, answer flips back
to open; expiry cleared like open).

## Storage (Cloudflare R2 since 2026-08-13; S3 before that)

**LIVE: Cloudflare R2** bucket **handback-files** (account `0a38b0…f0f`, endpoint
`https://<account>.r2.cloudflarestorage.com`, region `auto`) — cut over 2026-08-13: all 4,602
objects copied from S3 and byte-verified, SSM flipped (`S3_ENDPOINT` + R2 keypair +
`AWS_REGION=auto`), CORS mirrored from the S3 bucket (same 5 origins). Egress is $0 — the reason
for the move. **The R2 S3 keypair is derived from a Cloudflare API token — deleting that token in
the dashboard kills the server's storage access.** Steady-state cleanup (pending): mint an
Object-R&W-only token, swap its keypair into SSM, then delete the admin token used for the
migration (it's over-privileged and was pasted in chat).
**The old AWS S3 bucket still holds a full copy** as a cold fallback — nothing deletes it; retire
it deliberately once R2 has been quiet for a while (it bills ~$0.10/mo while it sits).

The paragraph below describes that S3 bucket (historical + fallback):

Bucket **handback-files** — (us-west-2, account 114394156384, profile `dested`), created
by hand 2026-07-30 night, not by Drydock: public access fully blocked, CORS allowing
handback.dev / www / `http://localhost:3995` / `http://localhost:3210` / `chrome-extension://*`.
Its writer is IAM user **`handback-app`** with one inline policy `handback-files-rw` scoped to
that bucket and nothing else (verified: it gets AccessDenied on any other bucket). The old pair
`inloop-files` + `inloop-app` is **deleted** — bucket emptied (234 objects, ~51 MB, the two test
gripes) and removed, user and access key removed. Anything that still remembers an
`inloop-files` URL is dead; the presigned links inside an old `get_gripe` response 404.
Everything moves via presigned URLs (PUT 1h, GET 1h) — `gripes.get` presigns every file in one
call so the viewer never round-trips per frame.

## Deploy (Drydock — handback.dev is serving; re-wire partly done)

**State (2026-07-31):** read the migration warning below before anything else — prod's DB is a
release ahead of prod's container. Deploy target confirmed: project/db are **still named `inloop`**.

**State (2026-07-30 night):** **https://handback.dev answers** — `/healthz` returns 200 — and
`inloop.dested.com` no longer completes a TLS handshake. So the domain half of the move has
landed. S3 is settled too: `handback-files` + `handback-app` exist and prod points at them (see
Storage), done by hand rather than by Drydock — so `G:\code\drydock\plans\2026-07-30-s3-buckets.md`
no longer has anything to provision here. SSM (`/drydock/inloop/*`) carries the new bucket and
keys, applied 2026-07-30 night. The rest of Sal's checklist (zone + delegation, project
recreate, cleanup) lives in `plans/2026-07-30-handback-rename.md`.
`Dockerfile`/`drydock.yaml`/`.github/workflows/drydock.yml` may still carry inloop names — Drydock
regenerates all three on re-wire, so don't hand-fix them.

Deployed by **Drydock** (`G:\code\drydock`, local portal at http://localhost:4400) onto the shared
ARM EC2 box: Caddy auto-TLS, shared Postgres container, Route53 A record → the box's EIP
`52.24.94.83`. **Push to `main` = deploy** — the generated workflow builds an arm64 image via OIDC
(no AWS keys in GitHub), runs `bunx prisma db push` as a one-off pre-deploy task, then rolls the
service.

| Setting | Value |
| --- | --- |
| domain | **`handback.dev`** — live and serving |
| project / db name | **still `inloop`** — confirmed 2026-07-31 from AWS: ECS service `drydock-inloop` (cluster `drydock`), SSM prefix `/drydock/inloop/*`, Postgres database `inloop`. `handback` was intended but the re-wire never happened, so the name only lives in the domain. Renaming it is a portal job (and would move the SSM prefix + DB), not a repo edit. |
| container port | 3995 (`PORT` is injected; `server.ts` reads it) |
| size | `m` — 192 MiB reservation / 576 MiB hard limit |
| build / start | `bun run build` / `bun run start` |
| predeploy | `bunx prisma db push` (no `--accept-data-loss`, on purpose) |

> **PROD MIGRATED (2026-08-02).** `cli/migrate-teams.ts` + `db push` ran against prod (org→team,
> tokens de-org'd, guest promoted; audit after: 16 walkthroughs / 1381 files / 1.45 GB, zero
> orphans). It ran *before* the code deploy — dev `.env` was pointing at prod again — so prod
> 500'd for signed-in users until commit `3207be1` rolled. **The `.env` prod flip is a standing
> hazard: it has now bitten twice. Check `DATABASE_URL` before ANY db/migration command.**

**Reaching the prod DB** (there is no public port — it's `172.17.0.1:5432` on the Docker bridge):
the EC2 box is SSM-managed, so `aws ssm send-command --instance-ids i-082378e80e708f4f2
--document-name AWS-RunShellScript` → `docker exec ecs-drydock-system-postgres-1-postgres-…
psql -U drydock -d inloop`. The superuser role is **`drydock`**, not `postgres`, and local socket
auth is trust, so no password is needed (keep it that way — an SSM command's text is retained in
the console). ECS exec is **disabled** on the service, so the container itself is not shell-able.

**Env lives in SSM**, not `.env`: `DATABASE_URL` + `BETTER_AUTH_SECRET` are generated by Drydock,
`BETTER_AUTH_URL` must equal the serving origin (→ `https://handback.dev`), and `AWS_REGION` /
`S3_BUCKET` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` come from the S3 provisioning (see
Storage). Change any of them in the portal (Project → Environment) and hit **Apply + redeploy** —
CI's task-def registration copies the *previous* revision's secret list, so a new key never
reaches the container on a plain push.

## Gotchas & hard rules

- **ui.md is law**: light only, no dark mode, no orange. Status colors fixed (open=cobalt,
  in_review=violet, resolved=green).
- **No *mobile* browser can capture the screen — settled, don't revisit.** `getDisplayMedia` is
  `version_added: false` on Chrome Android / Safari iOS / everything mobile (checked 2026-08-02).
  /phone therefore rides the OS screen recorders; any "record live in the PWA" idea is dead on
  arrival. **This is a statement about phones, not about the API**: a desktop tab has had screen
  capture for years, which is what `/record` is (`src/lib/capture/live.ts`, 2026-08-12). Don't read
  this bullet as "the website never captures". `src/lib/capture/` is a deliberate duplicated port of the extension pipeline —
  **change the pipeline anywhere, mirror it everywhere: capture/, the extension, AND the
  extracted dested/video-to-prompt library** (decisions.md 2026-08-02 + 2026-08-06) —
  with ONE legitimate divergence: candidate cadence. The extension samples live at 500 ms
  (free); the phone seek-steps at a 1 s floor (each candidate costs a real decode on iOS), and
  its MANIFEST says "1s candidates" accordingly. Phone keyframes are also **best-effort**: a
  frame-extraction failure degrades the take to zero frames (video + transcript still ship),
  never fails the run.
  The SW caches nothing and must stay that way (SSR staleness > offline); its share stash
  (IDB `handback-share`/`pending`/`current`) is a contract between `public/sw.js` and
  `src/lib/pwa.ts` — change both together. `externally_connectable` etc. are unaffected; the
  phone token lives in `localStorage handback.phone.token` and re-mints itself on 401.
- **The web recorder is the extension's engine minus the content script, and the gap is a fixed
  list.** `src/lib/capture/live.ts` is a port of `extension/src/sidepanel/recorder.ts` — same picker
  constraints, same 64×64 dedup, same Web Audio mix + mic-only shadow, same length-scaled
  `frameBudget`, same chunk-to-IDB persistence. What a page cannot have, because it comes from
  scripts injected into the *recorded* origin: console/network `events` (so `errorCount` is always
  0 and polish gets no error context), `pointer` on frames and the crosshair drawn from it, and the
  `click`/`nav` forced keyframes — leaving `start`/`change`/`beat`, exactly /phone's set. **A fourth
  client now mirrors the pipeline**: any dedup/report/upload change lands in `src/lib/capture/`, the
  extension, the video-to-prompt library, AND `live.ts` — though `live.ts` at least imports its
  dedup constants and `cellDiff` from `frames.ts` rather than copying them, so keep that.
  Its IDB is **`handback-web-recorder`**, deliberately not the extension's `handback-recorder`:
  same origin, and the extension's worker owns that schema.
- **A clip that reached /phone must be un-losable short of explicit discard** (2026-08-02, after
  a real walkthrough died mid-distill). Two stores hold it and **neither is consumed by reading**:
  the share stash (`handback-share`, written by the SW) and the pending run
  (`handback-phone`/`run`/`current`, written by `src/lib/capture/pending.ts` on every intake change
  and at send start). Both are deleted in exactly two places — after `finalize` returns, and on an
  explicit discard/start-over. A share auto-starts the run (sharing *was* sending; a second
  "Send to Handback" button is what made people think it had already gone), so the working screen
  carries the `to {space} · {title}` line and Cancel is the way back to intake. A reload with no
  `?shared=1` offers **resume**, never auto-resumes — after a crash the person decides. Don't add
  a read path that deletes, and don't make either store the sole copy.
- **The rename has two frozen edges.** S3 keys stay `orgs/<orgId>/gripes/<id>/…`
  (`server/storage.ts` — renaming the prefix orphans every uploaded object) and
  `/api/ingest/gripes*` aliases stay registered (Recorder ≤1.2.x posts them). MCP tools have NO
  old-name aliases — old report.md files that say `get_gripe` predate the rename. The extension's
  internal identifiers are still `Gripe*` on purpose (only its emitted strings changed); rename
  them in a quiet moment, not while panel work is in flight. **But the extension's ingest *client*
  must speak the server's current *field* names** — `upload.ts` kept reading `gripeId` off the
  declare response after the server renamed it to `walkthroughId`, so finalize POSTed to
  `/gripes/undefined/finalize` and 404'd every extension upload until it was fixed 2026-08-02
  (the CLI was fine — it read `walkthroughId`). Internal `Gripe*` type *names* are free; the JSON
  keys crossing the wire are not.
- **A personal space is the absence of a team, not a row.** `teamId: null` in a tRPC input means
  "the caller's own personal space" and nothing else — it cannot be spoofed (server/router.ts
  `toSpace`). Nothing provisions it, nothing can fail to provision it, and it takes no invites by
  construction. `teams.create` still requires the `team` entitlement (platform admins pass).
  Exactly one of a Walkthrough/Project's `teamId`/`userId` is set — a code invariant, not a DB
  constraint; keep it true in every new write path.
- **Dev FOUC fix lives in server.ts, not index.html.** Dev injects
  `<link rel="stylesheet" href="/src/styles/app.css?direct">` after `transformIndexHtml`
  (`?direct` = compiled CSS, not a JS module). Prod builds emit a hashed CSS link and don't need
  it — don't move the link into index.html or prod double-loads the sheet.
- **The landing page's screenshots are live DOM, not images.** One demo gripe (`demo-data.ts` —
  a promo code that applies to nothing) runs through every section; a keyframe is
  `CheckoutShot` in `demo-shot.tsx`, an SVG so it survives both a 3×3 contact-sheet tile and the
  hero. Inside a frame the recorded app is **grey** and only the reviewer's cobalt (pointer
  crosshair, ink) has colour — keep that, it's what makes nine tiles readable at thumbnail size.
  The contact sheet is the one black surface on the site, because it is a photograph of a JPEG.
- **Landing grid items need `min-w-0`.** Grid items default to min-content, and the mock panes
  contain `<pre>` and mono lines that never wrap — a missing `min-w-0` drags the whole page
  wider than a phone (doc `scrollWidth` 510 at a 390 viewport). Re-check `scrollWidth` at 390
  after touching any landing grid.
- **A gripe's `errorCount` is not "how much happened".** `PageEvent` is only `error | warn |
  network` — the console/fetch tap in `extension/public/injected.js`, forwarded only while a
  recording is live (`content/index.ts:93`), and `console.log` is never captured. Clicks and
  navigation are NOT events: they become forced keyframes (`recording:force`), so a busy
  walkthrough legitimately reads `errorCount: 0` with a high `frameCount` — that pairing is
  evidence the tap worked, not that it died. `droppedCount` is errors that fired on a tab other
  than the recorded one (`inScope()` in `recorder.ts`), which is what separates "the page was
  clean" from "we weren't watching". The field was called `eventCount` until 2026-07-31 and read
  as an interaction counter to every agent that saw it; **ingest still accepts a bare `eventCount`**
  from Recorder ≤1.1.0 and stores it as `errorCount`, so don't delete that fallback until the
  Web Store build is past 1.1.0 everywhere.
- **A take's audio is three sources, two artifacts** (extension 1.7.0, 2026-08-12): the webm's one
  audio track is app/system audio (getDisplayMedia `audio` + `systemAudio:'include'`) mixed with a
  RAW mic (AEC/NS/AGC off, so the room and second voices survive — headphones assumed) through a
  Web Audio graph, because MediaRecorder silently records only the first audio track it's handed.
  Transcription must NOT hear that mix: takes with system audio run a mic-only shadow recorder
  whose chunks (`<id>:micchunk:*`) are crash-persisted like the video's and assembled into
  `<id>:mic`, which `runWhisper` prefers over `<id>:video`. Keep the three lifecycles in sync —
  delete (db.ts), recover (background), finish/cancel (recorder.ts) all know both chunk families.
  Chrome only offers "share audio" on tab/entire-screen pickers (never a window) and its absence
  is silent — so the PickGate 'choosing' screen carries a dark ShareDialogMock portrait pointing
  at the switch, and the HUD's app-audio line is 3-state (`none`/`silent`/`live`, an analyser tap
  on the sys source): "shared but silent" = Windows is playing the sound on a device Chrome isn't
  looping back. Don't remove either tell.
- **Leaving a walkthrough is not ending one.** The panel has exactly two states now — the home
  screen and the open walkthrough — and `browsing` (App.tsx) is which one you're looking at. It is
  view state only: the session stays active in the worker, so a take started from the home screen
  still lands in it and reopening the panel lands back in the work. **Discard** is the only
  destructive control in the panel: it arms, names how many takes it will take with it, deletes
  session + takes + blobs, and then forces `browsing` back on, because the worker's `resumeOpen`
  fallback would otherwise drop the human into an unrelated walkthrough. Don't add a second list
  of walkthroughs anywhere — the foldable "earlier walkthroughs" one was removed for exactly that
  reason, and `Home.tsx`'s `.lrow` list is the one.
- **The panel's home screen is a read of the workspace, and nothing on it is load-bearing.**
  `Home.tsx` pulls `GET /api/ingest/walkthroughs` (and leans on the context fetch App already runs)
  to show the queue, the projects and the workspace switcher. Every failure degrades to one line
  of text with a retry — an unreachable or unlinked workspace must still leave a recorder you can
  record with, and the local session list is drawn either way. Session takes/durations come from
  the **`sessions:summary`** message, deliberately *not* a `state:get` field: `state:get` answers
  every broadcast and this walks every take's frame metadata.
- **"send to Handback" is an enqueue; the offscreen document is the only uploader** (1.10.0,
  decisions.md 2026-08-25). finish() writes an `OutboxEntry` (IDB `outbox`, target
  server+token SNAPSHOTTED), closes the session, and returns — the offscreen doc drains the
  queue sequentially (buildFileSet in lib/bundle.ts → pushGripe) and the panel's OutboxStrip
  renders queued/uploading/failed(retry)/done(link + copy-brief) off `outbox:changed`
  broadcasts. Blobs delete never — the session outlives the upload; a failed entry retries
  safely because re-declaring a slug replaces wholesale. A fresh offscreen doc re-queues
  entries stuck 'uploading' (the old uploader died); `onStartup` resumes a queue a browser
  restart interrupted. Don't put an upload back in the panel, and don't let two uploads run
  at once — they fight for the same wifi.
- **The keyframe cap is length-scaled, and it lives in two places.** `frameBudget(durationMs)`
  (`extension/src/sidepanel/recorder.ts`) is 40 frames/min clamped to **[150, 600]** per *take* —
  applied once in `finish()`, after dedup, as a **uniform** thin with nothing carved out of it
  (the `reason === 'mark'` exemption went with the mark feature, 2026-08-01); survivors are
  renumbered ascending (`t` survives, so transcript citations stay valid). It was a flat 150 until 2026-07-31. Server-side, `briefFrameLimit()`
  (`server/mcp-format.ts`) caps how many frame URLs the agent's brief *inlines* — 8/min clamped to
  [30, 120] — which is a display cap only: `gripes.get` presigns every frame regardless. Raising
  either has real cost: a frame is ~150–300 KB (JPEG quality 0.8 since 2026-08-25 — was 0.9;
  mirrored in capture/frames.ts and video-to-prompt), against 2 GB/gripe and 20 GB/org.
- **Renaming a column is a SQL job, not a `db push` job.** Predeploy runs `bunx prisma db push`
  **without** `--accept-data-loss` on purpose, so any drop stalls the deploy. Rename in place first
  (`ALTER TABLE "gripe" RENAME COLUMN "old" TO "new"`), then push — it sees no drift. Remember
  `handback_test` needs the same statement or the e2e suite 500s.
- **Two MCP servers, one implementation.** `server/mcp.ts` (hosted, `/mcp`) and `cli/mcp.ts`
  (stdio) both go through `server/gripes-api.ts` + `server/mcp-format.ts`. Change what an agent
  sees in those two files, never in one server. `/api/ingest`'s read routes are thin wrappers over
  the same functions.
- **`/mcp` is stateless and POST-only.** Fresh `McpServer` + transport per request
  (`sessionIdGenerator: undefined`, `enableJsonResponse: true`); GET/DELETE answer 405. Don't add
  a tool that streams or sends server-initiated notifications without revisiting that — there's no
  session to send them on. It's mounted before the SSR catch-all on purpose; move it after and a
  JSON-RPC client gets a page of HTML.
- **The inbox's connect banner is gated on `tokens.connection.lastUsedAt`**, which
  `authenticateToken` stamps on every ingest/MCP call. So "has an agent connected?" means "has a
  token ever completed a request", not "does a token exist". `tokens.connection` takes no input
  now — tokens are account-wide.
- **An invite must survive the auth round trip.** `/join/:id` is the only page a signed-out stranger
  lands on; its auth links carry `?invite=<id>`, `/sign-up` and `/sign-in` return to
  `/join/:id?accept=1`, and `redirectIfSignedIn` (routes.tsx) honours the same param. Drop any one
  of those and the account gets created while the invitation is orphaned — the failure is silent,
  because sign-up itself succeeds. Accept is idempotent, so a stale `?accept=1` is harmless.
- **An addressed invite is bound to its address; an unaddressed one is an open link.** `invites.create`
  with an `email` sends mail and `invites.accept` 403s anyone signed in as someone else (invite mail
  gets forwarded). Omit the email and the link is the whole credential — that's the deliberate
  copy-a-link path, and it is *not* rate-limited by address. Keep both branches when touching accept.
- **`./server/*` never imports into `src/*`** except `import type` (starter rule; leaks secrets).
- **tRPC returns must be JSON-safe** — Dates → ISO strings at the procedure, `bytes` BigInt →
  Number, or SSR/hydration markup diverges.
- **better-auth origin check**: sign-in fails with "Invalid origin" unless `BETTER_AUTH_URL`
  matches the URL you're browsing on. Dev on a non-3995 port needs
  `PORT=X BETTER_AUTH_URL=http://localhost:X bun server.ts`.
- **Ingest paths are validated** (`isSafePath`) — never widen it casually; those strings become S3
  keys.
- **Re-pushing a slug replaces the gripe wholesale** (rows + S3 prefix). Viewer links keep working
  only because gripe ids change — don't cache ids across re-pushes.
- **`gripes.list` only shows finalized gripes**; a declare without finalize is invisible in the UI
  by design.
- **Raw API tokens are shown once** — only the sha256 lands in the DB. The dev-bootstrap script
  prints a fresh one each run. This is *why* /connect and /recorder never ask "do you already have
  one?": nobody can answer it, so both pages just mint a fresh token on the single click and let
  the old ones sit until they're revoked. Don't reintroduce a token-inventory prompt on the primary
  path — that phrasing is what got the flow rewritten on 2026-08-01. `tokens.create` returns
  `{ token, id, name }` so the caller can offer `tokens.rename` without a `list` round trip.
- **The roster is admin-only** (2026-07-31): `teams.members` requires `admin` — plain members get
  FORBIDDEN and the Team page doesn't render the tabs for them. Don't add a procedure that returns
  member names/emails without that gate; the only sanctioned leak is a walkthrough's
  `uploadedByName`. Ownership is `Team.ownerId` (never a stored role) — effective role is computed,
  and `teams.transferOwnership` is the only way it moves.
- **Admin deletes are S3-first, and both are prefix wipes.** `admin.deleteUser` refuses self,
  platform admins (demote first) and team owners (transfer first — the DB's `Restrict` on
  `Team.ownerId` backs it), then wipes `orgs/<userId>/` and deletes the row (cascades take
  memberships/tokens/personal content; team uploads survive with `uploadedById` nulled).
  `admin.deleteTeam` is the same shape on `orgs/<teamId>/`. S3 goes first on purpose: a failed
  wipe leaves the account/team intact rather than orphaning unlistable objects.
- **`walkthroughs.move` is copy → flip → delete, in that order.** Source and destination are
  spaces (Personal included); the caller must hold both. Objects are copied server-side
  (`copyObject` — bytes never cross the container), then the row flips (ownership pair +
  `projectId: null` + slug suffixed if taken), then the old prefix is deleted best-effort. A crash
  mid-copy loses nothing; after the flip, worst case is orphaned source objects. Destination quota
  reuses ingest's exported `SPACE_QUOTA_BYTES`/`SPACE_MAX_WALKTHROUGHS` — quota is per space.
  The core lives in `relocate()` (router.ts), shared with `admin.moveWalkthrough` (any team, or
  the uploader's personal space; quotas still apply — an admin move is not a quota bypass).
  **`relocate` refuses unfinalized walkthroughs**: pending file rows can hide real S3 objects
  the copy would skip and the source wipe would destroy — delete is their only exit.
  `/admin/walkthroughs/:id` renders the exact agent brief through the same
  `getWalkthroughDetail` + `formatWalkthrough` pipeline MCP uses — change those and the debug
  page follows for free; never re-implement the brief for display.
- **Every `hb_` token is account-wide; a platform admin's is platform-wide** (2026-08-01).
  `TokenAuth` has no org: a token reaches its owner's personal space + every team they belong to
  (`scopeWhere`/`inScope` in walkthroughs-api.ts), and `isAdmin` drops the filter entirely —
  including status writes (deliberate). Every list item and brief carries **`space`** (team name,
  'Personal', or '<name> (personal)' on the admin path). **Uploads are never cross-space without
  membership** — declare validates `teamId` against the uploader's memberships, admins included.
  The practical trap stands: your own everyday token is an admin token, so your agent's queue is
  the whole platform.
- **Platform admins bypass membership on reads only** (2026-07-31): `requireViewAccess`
  (server/access.ts) falls back to a synthetic owner role for a platform admin with no access,
  wired into exactly `walkthroughs.get` and `walkthroughs.fileUrl` — so /admin's drill-down can
  open the viewer anywhere. Every mutation still goes through `requireSpaceAccess`. `get` returns
  **`viewerIsMember: false`** on that path and the controls collapse to a read-only chip; don't
  render a control that ignores it, and don't move the bypass into `requireSpaceAccess`.
- **Guests no longer exist** (2026-08-01, deleted with the restructure): no Membership.scope, no
  ProjectAccess, no project-scoped invites, no `canSeeWalkthrough` filtering. Don't reintroduce a
  partial-visibility member without reopening the decision in decisions.md.
- **"team" is a paid entitlement checked at Team.owner** (server/features.ts): gates
  `teams.create` and `invites.create`; seats (`Team.seatLimit`, members + pending invites) gate
  both `invites.create` and `invites.accept`. Billing is modeled, not charged — Stripe later
  plugs into `ownerId`/`seatLimit` without another migration. Platform admins implicitly hold
  every feature — `ADMIN_EMAILS` in SSM bootstraps prod admin, then grant from `/admin`.
- **Prisma 7**: no `--skip-generate` flag; `prisma.config.ts` hand-loads `.env` — keep that block.
- **The e2e suite boots its own server** on :3100 against `handback_test` with dummy S3 creds — any
  test that actually touches S3 will fail loudly (none do today).
- **Playwright locators**: the empty-inbox guide contains a "Team → API tokens" link; use
  `exact: true` for the nav's "Team".
- **Extension is its own npm workspace** (`extension/`, npm not bun — vite CRX builds): two ordered
  vite builds (panel+worker ESM, then content IIFE with `emptyOutDir:false`). Chrome won't bind
  bare-letter commands, so the dock keys (**d** draw / **c** clear / **s** stop) are a window keydown
  listener in the content script; only **Alt+Shift+D** is a real `command`.
- **Preview harness seeds real IndexedDB** ('handback-recorder') and stubs `chrome.*` — it shares the
  origin's DB, so a preview tab and the real panel fight if both run on the same profile. Port 8777
  (`PORT` env to move it; the old gripe repo's harness also used 8777). **Its `SETTINGS` stub must
  track `DEFAULT_SETTINGS` in `lib/types.ts`** — the panel calls `activeLink(settings)`, which
  reaches into `settings.links`, so a stub still carrying the flat 1.1.x `serverUrl`/`apiToken`
  fields throws on first render and the harness comes up **blank with no clue why**. That is exactly
  how it sat broken from the multi-workspace change until 2026-08-01.
  Modes: `rec` (one 2:19 part) · `long` (the acceptance seed) · **`fresh`** (a part still running
  with no frame kept yet — the live/collapse case) · `home` · `empty`, plus `?unlinked=1` and
  **`?ctx=none|fail`** (a workspace with no projects / a dead context fetch — the two states the
  destination row's project control has to survive on screen).
- **The panel review screen is a parts list, not a timeline** (2026-08-14, owner directive;
  decisions.md). The scrubber `Timeline` (monitor + ruler + filmstrip + voice lane + zoom) is
  **deleted** — `Parts.tsx` renders one `PartCard` per finished recording, in `createdAt` order,
  divided by hairlines. A card is: a head row (`part N · m:ss`, its quiet `×`), the **video in a dark
  well** (`blobs.get('<id>:video')`), a control row (play/pause + a slim cobalt seek bar + a mono
  clock, drawn only once the video loads), a mono meta line (frames captured / `full-rate video`, ·
  console errors, · recovered, · transcribing…), and the transcript in **its own scroll region**
  (click a line seeks, double-click fixes it, active line cobalt-washed). The word **"take" is banned
  from extension UI copy** — the noun is **part** (or "recording" where that reads better); internal
  identifiers (`take:delete`, `Recording`, `rec-NN`, report.md, upload fields) are unchanged.
- **MediaRecorder webm has no duration** — a fresh `<video>` reports `duration === Infinity` and
  won't seek. On `loadedMetadata`, `PartCard` sets `currentTime = 1e9` and, on the resulting `seeked`,
  snaps it back to 0; that forces Chrome to index the file so the seek bar works. The seek scale is
  `rec.meta.durationMs` (the video's own duration stays unreliable), and the clock display is clamped
  because the hack briefly reports a garbage `currentTime`.
- **A part is deletable, and deleting one renumbers the rest.** `take:delete` (`lib/messages.ts` →
  `background/index.ts`, modelled on `session:delete`; the message name is unchanged) drops the
  recording row, its frames and its blobs, then re-lays the survivors as `index` 1..N in `createdAt`
  order and sets `Session.recCount` to their count — `rec-NN` is a position in the walkthrough, not a
  serial. The control is the card's quiet `×` (`.part-kill`); it arms **inline in the head row**
  (fixed height, so the row never grows) and is disabled while recording or uploading (`busy` prop).
- **The empty review screen is one muted line.** With no finished part and nothing live-recording,
  `.parts` renders a single `.parts-empty` line — no card, no well. The video well is the only dark
  surface, and a recording with no `:video` blob on this machine (a recovered session, or the preview
  harness, which seeds only frame blobs) shows the first keyframe dimmed with `video isn't on this
  machine`, never a broken player. Judge it at `?mode=fresh`/`?mode=long` in the harness.
- **`Dockerfile`, `drydock.yaml` and `.github/workflows/drydock.yml` are Drydock's** — it overwrites
  all three on every wire/re-wire. Change the deploy in the portal, not in the repo.
- **`env.ts` parses at import time**, so a missing S3/auth var is a boot crash, not a runtime error —
  and a crash-looping container burns Let's Encrypt's duplicate-cert budget. Set env in SSM *before*
  the deploy that needs it.
- **S3 CORS is an allowlist of exact origins** (`http://localhost:3995`, `https://handback.dev`,
  `chrome-extension://*` once `handback-files` exists). Browser uploads from any other origin fail
  at the presigned PUT — CORS is Drydock-regenerated from config after the S3 provisioning lands;
  extra origins go in the project's `s3CorsOrigins`, never hand-edited on the bucket.
- **Transcription is server-side by default** (`transcribeCloud.ts` → `/api/ingest/transcribe` →
  Groq). On-device Whisper is the fallback and the privacy escape hatch, not the normal path — see
  `plans/2026-07-30-transcription.md`. Audio leaving the machine is a **privacy-policy fact**: if
  the provider changes, `/privacy` changes in the same release.
- **`GROQ_API_KEY` is optional everywhere.** Unset → the endpoint 503s → every recorder silently
  falls back to on-device. Nothing errors, it just gets slow — so "why is transcription taking
  minutes" is a missing-key question first.
- **Every third-party key degrades the same way.** `ANTHROPIC_API_KEY` unset → `/polish` 503s → the
  raw transcript ships. `RESEND_API_KEY` unset → `sendEmail` logs the message (link included) and
  returns false, so a dev can click a reset link straight out of the terminal. The pattern is
  deliberate: **a missing key must never be able to lose someone's work or block sign-up.**
- **The cleanup pass edits words, never timings.** `/polish` takes text and returns the same number
  of lines; `t`/`d`/`tl` never cross the boundary. Any change there has to keep that true, or the
  timeline, the frames, and the report stop agreeing. The report says when a transcript was
  polished (`report.ts` → `engineName`) because a reader is deciding how far to trust the words.
- **The extension holds one link per SERVER** (since 1.6.0): `Settings.links: ServerLink[]` —
  `{ id: serverUrl, serverUrl, apiToken }` — plus `activeLinkId` + **`activeTeamId`** ('' =
  personal) choosing where uploads go; the destination row is "to <space> · <project>" fed by the
  new `/context`. `handback:link` carries only `apiToken` (origin from `sender.origin`, never the
  payload); `handback:ping` answers `linkedOrigins`. `getSettings()` folds BOTH legacy shapes —
  1.1.x flat fields and 1.2.x per-workspace rows (deduped per server, activeLinkId's row wins) —
  don't remove either fold until no old installs remain. **Recorder ≤1.5.x uploads land in the
  uploader's PERSONAL space** (their declares carry no teamId): teammates won't see them until the
  install updates — `walkthroughs.move` is the fix-up, /recorder's version nag is the cure.
- **The extension ships under TWO ids, and `/recorder` must speak to both.** The `key` in
  `manifest.json` pins the local-unpacked + self-hosted zip build to
  `gmggnebbenlmpakojgocnjfcnpmifdci`; the **Web Store build has its own id
  `bdhajcllnjcnihcbobhaecldgjlhfdhd`** because `pack-store.mjs` strips the `key` (Web Store rejects
  it) and Chrome then generates a fresh id. The pre-submission belief that both would be `gmggneb…`
  was wrong (decisions.md 2026-08-07). So `recorder.tsx` holds `EXTENSION_IDS = [store, self-hosted]`,
  pings each in turn (`chrome.runtime.sendMessage(id, handback:ping)`), and links whichever answered —
  never a single hardcoded id again. Both are answered by `onMessageExternal` in the background, which
  stamps `serverUrl` from **`sender.origin`** — never trust a URL in the payload. `externally_connectable`
  allows only handback.dev + localhost; a new origin (staging etc.) must be added there or the page
  can't see the extension at all. `chrome.runtime` is *absent* on the page until a matching extension
  is installed — absence means "not installed", not "not Chrome". If Chrome ever reassigns the store id
  (e.g. a fresh listing), add the new one to `EXTENSION_IDS`.
- **`STORE_URL` is set** in `src/app/recorder.tsx` (the live listing) → the install step renders the
  "Add to Chrome" button and the zip/load-unpacked walk collapses behind a disclosure automatically.
- **A push to `main` does NOT ship the extension.** Deploy only moves the web app/server; the
  recorder reaches users through `releases/recorder/` in the bucket. So before (or right after) any
  push that touched `extension/`: bump the version if behavior changed, then
  `bun run publish:extension` (build → zip → upload; the zip step shells out to `pwsh`
  `Compress-Archive`, so it's Windows-only — on macOS zip by hand instead:
  `cd extension/dist && zip -r ../handback-recorder.zip .` then `bun cli/publish-recorder.ts`;
  the publish script's checks make either path safe). Skipping
  this leaves every install nagged as outdated — or worse, a server expecting a handshake the
  shipped recorder doesn't speak.
- **The bucket is the release channel.** `/recorder` links `/download/recorder`, not GitHub — the
  repo is private, so its release URLs 404 for exactly the people we hand them to. The route needs
  a session and 302s to a presigned GET; the bytes never touch the container. **The newest zip
  under `releases/recorder/` IS the current release** (`server/releases.ts`, 60s cache) — there is
  no version constant to bump. Publish with `bun cli/publish-recorder.ts` after building and
  zipping `extension/dist` (the script refuses a zip that's missing, or older than the build in
  `dist/`, or whose version disagrees with `package.json`). Off-store Chrome installs never
  auto-update, so `/recorder` compares the version the extension reports over `handback:ping`
  against this and nags — that comparison is the only update mechanism there is until the Web
  Store listing exists; don't drop it when adding one.
- **Bun hangs on a streamed S3 `Body`.** `createReadStream` into `PutObjectCommand` never resolves
  and prints nothing — buffer the file instead (`cli/publish-recorder.ts`). Spawning
  `Compress-Archive` from bun hangs the same way, which is why zipping is a documented shell step
  and not part of the script.
- **The e2e DB needs its own `db:push`.** `handback_test` is truncated, never migrated, by the
  suite — after any schema change run
  `DATABASE_URL=postgres://…/handback_test bunx prisma db push` or sign-up 500s with a
  ColumnNotFound that surfaces as a blank "Sign up failed".

## Gotchas & hard rules (continued — 2026-08-12 human handback)

- **A walkthrough has a `kind`, and 'human' changes the contract.** `kind: 'human'` = the edited
  video IS the deliverable: declare carries `kind` (absent = 'agent' — every old recorder),
  agent lists (`listWalkthroughs`, MCP, ingest GET) filter it out while `get` by id still
  answers, the viewer renders `final.mp4` + `transcript.json` via `FinalCut` instead of takes,
  and its upload carries NO raw takes, NO report.md, NO frames (decisions.md 2026-08-12 ×4).
  `walkthroughs.get/list/inbox` all return `kind` — don't add a surface that ignores it.
- **The share token is the whole credential.** `Walkthrough.shareToken` (18 random bytes,
  base64url) unlocks `/w/<token>` via the public `walkthroughs.shared` procedure — same trust
  model as an unaddressed invite. Re-sharing ROTATES the token (that's the leak recovery);
  `unshare` nulls it. The procedure is IP rate-limited via `checkLimit` (ratelimit.ts's
  tRPC-callable face) using `Context.ip` — SSR's loopback caller has `ip: null`, which SKIPS
  the limit; don't route real user traffic through a null-ip context.
- **Pristine capture is the same engine with three switches.** `LiveRecorder`'s `pristine` flag:
  30 fps ideal (vs 10), `videoBitsPerSecond` ≈ 4 bits/px/s clamped [6, 16] Mbps, and NO keyframe
  sampling loop. Everything else (mix, mic shadow, chunk persistence, recovery) is byte-identical
  — `src/lib/edit/` is deliberately NOT mirrored into the extension/phone/library pipeline.
- **The editor's cut proposals need both silences AND no words.** `silence.ts` proposes a cut
  only where the RMS envelope (adaptive threshold from the take's own distribution — raw audio,
  no NS, every room differs) is quiet AND no padded transcript line overlaps. Words always win.
  Vetoed silence chips stay vetoed across Tighten re-runs (matched by take + ~position).
- **An extension human handback is raw takes + a promise.** The extension (1.8.0) can't edit
  and the page can't read its IDB, so it uploads pristine raws (`kind: 'human'`, no frames/
  report/MANIFEST) and the VIEWER is the editor: `cloud-editor.tsx` → `walkthroughs.presignEdit`
  (path allowlist EXACTLY `final.mp4|transcript.json|edit.json` — never widen it, those become
  S3 keys) → PUTs → `finalizeEdit` (recomputes `bytes` from uploaded rows, `durationMs` = the
  render). Raws stay after the render, so re-edit works — and quota keeps paying for them
  (deliberate, undecided). `kind` itself is switchable per viewer select (`walkthroughs.setKind`,
  pure reclassification). File caps are 2 GB/file, 4 GB/walkthrough since 2026-08-12 (512 MB
  couldn't hold a real 20-minute pristine webm).
- **Prettier never touches markdown here** — `*.md` is in `.prettierignore` because it rewrote
  `*`-bearing inline code spans and emphasis across updates.md (recovered). Format code, not prose.
- **Retention is stamped at status-write time, swept hourly** (2026-08-12): `expiryFor(status)`
  (server/retention.ts) is called by BOTH status paths (tRPC `setStatus` and the shared
  `setWalkthroughStatus`) — resolved stamps `expiresAt` now+30d, any other status CLEARS it, and
  the viewer's Keep control (`walkthroughs.keep`) clears it too. The sweep is S3-first like every
  delete here. A new status-write path that skips `expiryFor` silently makes walkthroughs
  immortal; a recurring backfill silently makes Keep meaningless — `cli/backfill-expiry.ts` is
  one-shot for exactly that reason. Human raws (`rec-*` files) purge 14d after `renderedAt`
  (stamped in finalizeEdit); the shipped final.mp4 stays until the walkthrough expires.
- **Bitrate is throttled, and it's mirrored.** Pristine = 2 bits/px clamped [3, 8] Mbps; agent/
  non-pristine = explicit 1 Mbps `videoBitsPerSecond`. Lives in BOTH
  `extension/src/sidepanel/recorder.ts` and `src/lib/capture/live.ts` (the mirror rule) —
  extension 1.8.1 carries it and still needs `bun run publish:extension`. Measured effect:
  ~1.0 → ~0.45 GB/recorded-hr agent-kind; the /admin/costs fallbacks assume the throttled rates.
- **R2 cutover is owner-gated and code-inert.** `S3_ENDPOINT` unset = plain AWS S3, nothing
  changed. The cutover (SSM env flip + CORS + `cli/migrate-storage.ts`) runs ONLY when Sal says
  so — order and checklist in decisions.md 2026-08-12. Don't "helpfully" set S3_ENDPOINT.
- **Uploads and AI passes require a verified email; budgets are per-USER per-month** (2026-08-12):
  declare, `/transcribe`, `/polish` and `tokens.create` all 403 on `emailVerified: false` (admins
  exempt; reads stay open so existing agents keep pulling their queue). Budgets ride
  `monthly_usage` (user × 'YYYY-MM'): since 2026-08-24 there is NO free cloud budget (0s, no
  polish) and the first-walkthrough magic is REMOVED (owner killed the free tier — supersedes the
  "don't fix the magic" rule; decisions.md). `GET /context` returns the
  `cloud` block so recorders can self-configure. **Deploy ordering matters**: the `monthly_usage`
  table must exist before this code serves (Drydock predeploy `db push` handles a normal push;
  `handback_test` needs its own `DATABASE_URL=…/handback_test bunx prisma db push` like any
  schema change). Existing unverified alpha accounts hit the upload gate — flip `email_verified`
  or have them verify; check RESEND_API_KEY is set in prod first.
- **Security headers live in server.ts** (one middleware): X-Frame-Options DENY, nosniff,
  Referrer-Policy, Permissions-Policy (camera/geolocation denied — mic and display-capture
  deliberately untouched, the recorder needs them), HSTS only when serving https. There is NO CSP
  yet (inline Vite scripts) — adding one is its own task, don't bolt it onto this middleware
  casually.
- **The review thread is the return path, and status rides it** (2026-08-13): `post_result`
  (4th MCP tool, REST `/walkthroughs/:id/result`) writes a `WalkthroughNote` role 'agent' and
  auto-flips an **open** walkthrough to in_review; `walkthroughs.sendBack` writes role 'reviewer'
  and forces status back to open. BOTH go through `expiryFor` like every status write. The brief
  renders the thread (`--- review thread ---` in mcp-format.ts) so a re-pulling agent reads the
  send-back note — don't add a result/send-back write that skips the note table, or the two sides
  stop seeing each other. The viewer's AgentAnswer panel (Approve & resolve / Send back) is the
  sign-off surface; approve is just setStatus resolved.
- **The agent trace logs token surfaces only.** `traceAccess` (walkthroughs-api.ts) fires on
  token get/status/result — never on web-viewer reads, and /admin's debug brief passes
  `{trace: false}` so an admin looking isn't "agent activity". 'pulled' dedupes per token per
  10 min. Fire-and-forget by design: a trace failure must never slow or fail an agent call.
- **Comments are part of the brief, and their clock is the output clock.** `WalkthroughComment.atMs`
  is the walkthrough-wide playback clock (same axis as transcript/frames in the viewer), rendered
  in the brief as `[m:ss] name: text` — an agent reads a comment as an instruction keyed into the
  transcript. Delete is own-comments-only (`deleteMany` where userId = me). The panel lives in
  AgentView only; a human-kind final-cut page has no comments surface (deliberate, v1).
- **Search is a corpus column + query-time tsvector, and there is NO index yet.**
  `Walkthrough.searchText` (≤50 KB, URLs stripped) fills fire-and-forget at ingest finalize and
  `finalizeEdit` — never at read time. `searchWalkthroughIds` runs `websearch_to_tsquery` over
  title+corpus with a seq scan; at hundreds of rows that's fine. When it stops being fine, the
  fix is a raw-SQL `CREATE INDEX ... USING gin (to_tsvector(...))` migration — predeploy
  `db push` can't create it, plan it as its own step. /app unions server ids with its client-side
  title matching (300 ms debounce); walkthroughs uploaded before this feature match on title only
  until re-finalized.
- **The digest stamps BEFORE it sends.** `server/digest.ts` fires only in Mon 15:00–15:59 UTC,
  guards on `digestSentAt < now-6d`, and writes the stamp before `sendEmail` — a crash costs one
  digest; the other order can spam hourly. No walkthroughs at all → stamp, no mail. Unsubscribe
  links are per-kind now (`?kind=uploads|digest`, HMAC covers the kind).
- **Upload email fires on finalize's null→set transition only, team spaces only.**
  `notifyUpload` (server/notify.ts, called from ingest FINALIZE): recipients = team members
  minus the uploader, `emailVerified` AND `notifyUploads` true. A finalize retry or slug
  re-push must not re-mail — the guard is the pre-update `finalizedAt`. The unsubscribe link is
  sessionless (HMAC of userId, BETTER_AUTH_SECRET-keyed, timing-safe compare); re-enable is the
  checkbox on /team (prefs router). Personal-space uploads never notify (always self-uploads).
- **final.mp4 downloads through a second presign.** `presignGet(key, { downloadAs })` signs a
  `ResponseContentDisposition` — the `download` attribute is ignored cross-origin, so the
  Download button needs the URL itself to say attachment. `get`/`shared` return it as
  `downloadUrl`.
- **A split-out task is metadata, not media** (2026-08-13): `applySplit` children have NO S3
  objects, zero takes/files/bytes, `finalizedAt` at birth (so they list everywhere), kind
  'agent', slug `<parent>-task-N` (suffix-until-free per space), and `searchText` filled inline
  from the brief. `briefMd` IS the report — `getWalkthroughDetail` serves it as `reportMd`
  before reaching for S3, so MCP agents read a child like any walkthrough; the brief tells them
  the evidence lives on the parent (`get_walkthrough(parentId)`). The split is gated hard
  (`requireSplittable`): agent kind, finalized, not itself a child — and `proposeSplit` is
  METERED via `checkAndReservePolish` and human-confirmed before any row is written (the
  propose/apply split exists so the model never creates tasks unreviewed). The viewer's
  child page renders TaskBrief only — don't hand a zero-file walkthrough to AgentView.
- **A voice note lives in memory until it's sent** (2026-08-13, deliberate): /record's "just
  talk" holds the MediaRecorder blob in component state — no IDB, a reload loses it, and the
  UI says so. Thirty seconds of talking isn't worth the crash-recovery machinery. It uploads
  through the UNCHANGED phone pipeline (`distillAndUpload`) with a pre-supplied probe
  (`hasVideo: false` skips frame extraction and the webm-duration hack); the audio-only path
  already existed for /phone voice notes. Don't add persistence and don't fork the pipeline.

## Gotchas & hard rules (continued — 2026-08-23 mega-wave)

- **'Pro feature' is a wire contract.** Every pro-gated procedure throws FORBIDDEN with that
  LITERAL message; `src/lib/pro.ts` `isProError` string-matches it and the UI swaps the error
  for `ProUpsell` → /upgrade. Change the string anywhere and every upsell becomes a raw error.
- **Refine and the assistant never mutate the ground truth.** report.md in S3 is immutable;
  refine writes columns, the assistant edits recording.json transcript TEXT only (timings
  frozen — the polish contract), and `remove_span` deletes keyframes + records a marker but
  NEVER re-encodes video (owner: "fuck ffmpeg"). The brief's removed-spans section tells
  agents to ignore video inside those windows — that's the whole mechanism.
- **runRefine's payer is the uploader on auto-run, the caller on manual.** `{byUserId}` exists
  so a pro teammate can refine a non-pro teammate's upload; both paths meter one polish call
  and bail silently when not pro / not configured / already running. It never throws — a
  failure is `refineStatus 'failed'` and a log line.
- **The assistant is authorized by the router, trusted by agent.ts.** walkthroughs.chat does
  requireSpaceAccess + pro gate + polish metering; server/agent.ts assumes clean ids. Don't
  call runWalkthroughChat from anywhere that hasn't done that dance.
- **needs_info ripples through z.enums via WALKTHROUGH_STATUSES.** router.ts imports the
  tuple; don't reintroduce an inline `z.enum(['open','in_review','resolved'])` or the new
  status 400s at that surface. Status color: grey/muted — ui.md, never a new hue.
- **Evidence paths are the third path allowlist.** `evidence/<ts>-<name>` via
  requestEvidenceUploads only (name /^[a-z0-9._-]{1,80}$/i, image types, ≤5 MB, ≤4);
  post_result flips only paths starting `evidence/`. Like EDIT_PATHS, never widen casually —
  these strings become S3 keys.
- **The app sidebar and the admin sidebar never nest.** layout.tsx renders AppShell for every
  signed-in APP_PREFIXES path except /admin, which keeps its own shell; both share
  `ui/sidebar` with different `storageKey`s ('handback.appSidebar' / 'handback.adminSidebar').
- **Intent is web + extension, not the CLI.** cli/push.ts sends no intent (null = untagged is
  correct); the extension (1.9.0) and the three web intakes send it. The video-to-prompt
  library mirror does NOT carry the field yet — flagged, not forgotten.
- **The e2e landing spec tracks committed reality.** The marketing wave's in-flight hero
  rewrite breaks `landing page renders` until that session commits + re-baselines; the app
  flow asserts the h1 'Walkthroughs' (was 'Inbox' — stale since 2026-08-12).

## Status

> **🚀 Launch runway — standing reminder.** The marketing foundation is built (OG card, /docs,
> homepage fixes, error alerts — all shipped 2026-08-23); launch is **blocked on the owner's
> recording day**. When Sal says he's ready (or asks "what's next for launch"), open
> `plans/2026-08-12-marketing-plan.md` → the "⏭ Next actions" section at the top is the ordered
> checklist: ① record the real demo loop (beat sheet: `plans/2026-08-23-demo-video.md`) → Claude
> cuts the ~60s Remotion version; ② submit the MCP directory pack
> (`plans/2026-08-23-mcp-directory-pack.md`); ③ rotate the pasted keys + R2 token cleanup;
> ④ verify the OG card renders before any announcement; ⑤ community groundwork starts now
> (2–3 weeks lead time). X posts come from @dested in Sal's voice (memory: sal-twitter-voice).

- **Done (2026-07-29, day one)** — schema + S3 + two-phase ingest + push CLI (verified with a real
  36MB gripe, 172 files); tRPC API for orgs/invites/tokens/projects/gripes; full web app (landing,
  auth, inbox with first-run onboarding, viewer with video/filmstrip/transcript/events/report,
  team, projects, join); token REST reads + stdio MCP (`list_gripes`/`get_gripe`/
  `set_gripe_status`); e2e smoke suite with committed baselines; README.
- **Done (2026-07-29, evening)** — the extension, rebuilt from scratch in `extension/`: MV3
  side-panel recorder (screen + mic, 64×64-cell dedup keyframes, Whisper transcription in a
  worker), on-page dock + cobalt ink drawing, the one-timeline editor (drag across take seams,
  popped strip), report.md builder, and **direct cloud upload** to `/api/ingest` (no local
  folders, no downloads permission). Typechecked, both bundles build, layout verified against the
  10:18/150-frame acceptance seed via the preview harness.
- **Done (2026-07-30)** — **first ship via Drydock**, then at inloop.dested.com, now handback.dev:
  project created, repo wired (Dockerfile + workflow + drydock.yaml), S3/auth env in SSM, schema
  pushed by the pre-deploy task, CI green, TLS valid, `/healthz` ok. `render.yaml` deleted; the
  dev port moved 3000 → 3995 everywhere.
- **Done (2026-07-30, later)** — `/privacy` and `/terms` (real pages, Arizona law, sal@dested.com);
  **server-side transcription on Groq** replacing the on-device Whisper wait, with an on-device
  toggle kept as the privacy path (`plans/2026-07-30-transcription.md`).
- **Not built** — a prod account/API token (no one has signed up yet, so no S3 round-trip has run
  against prod), a real in-Chrome record→upload run (needs a human), share links / public
  gripe URLs, billing, org deletion, error tracking / alerting, pagination past 200 gripes,
  the Chrome Web Store listing itself (its copy is written — see Plans).
- **Done (2026-07-30, night)** — **renamed Inloop → Handback (handback.dev)**: full sweep of code,
  extension, copy (`hb_` tokens, `HANDBACK_*` env, `handback-recorder` DB, `handback_test`,
  `handback.activeOrgId`, MCP name); new identity — the **return mark** (`ReturnMark`,
  `return-diagram.tsx`, regenerated extension icons); GitHub repo renamed dested/handback; e2e
  baselines re-shot. Infra handoff pending on Sal — `plans/2026-07-30-handback-rename.md`.
- **Done (2026-07-30, night, after the rename)** — the go-live batch: **email on Resend**
  (`server/email.ts` + reset/verify/invite flows, `/forgot-password`, `/reset-password`),
  **upload size caps + per-org quota** (signed `ContentLength`, so S3 enforces it),
  **rate limiting** (better-auth rules + `server/ratelimit.ts` over ingest), **alpha pricing copy**
  (nothing implies a charge), and the **Haiku transcript cleanup pass** (`server/polish.ts` +
  `extension/src/sidepanel/polish.ts` — "handbag" → "Handback", "cores" → "CORS", verified against
  real mangled speech). Privacy page updated in the same pass: Anthropic and Resend named as
  processors. Web Store listing copy written in full.
- **Done (2026-07-30, night, later still)** — **the agent onboarding path**: a hosted MCP server at
  **`/mcp`** (`server/mcp.ts` — StreamableHTTP, stateless, `hb_` bearer) so connecting an agent is
  one copy-paste line with no clone and no bun, and **`/connect`** (`src/app/connect.tsx`) — mint a
  token inline, get a command with that token already in it, watch a live "connected" indicator,
  and read how to disconnect (remove the server ≠ revoke the token). Inbox gained a dismissible
  "Are you the engineer who's going to fix these?" banner that retires itself once a token has
  actually been used. Read side refactored into `server/gripes-api.ts` + `server/mcp-format.ts`,
  shared by REST and both MCP servers. Verified against a live server: initialize, tools/list,
  a real `list_gripes` call, 401 on a bad token, 405 on GET.
- **Done (2026-08-01)** — **the website walkthrough (`212801d8`)**: gripe → **walkthrough**
  everywhere (DB tables/columns renamed in place, tRPC `walkthroughs.*`, MCP
  `list/get/set_walkthrough*`, `/walkthroughs/:id` + legacy redirect, CLI, README, recorder
  report.md strings); **personal workspaces** (`Org.personal`, sign-up hook, ensurePersonal,
  switcher dropdown + entitlement-gated "New team…", Team page split, tokens → /connect, origin
  hints out of the UI); **landing redo** (new tagline "Debug and review your app in your own
  words.", RecorderPanelMock in the hero, de-bugged step copy, honest sign-off step, pricing hour
  quotas, MCP terminal block removed); **dev FOUC fix**. e2e re-baselined, 4/4. Prod DB migration
  pending — see the ⚠️ above.
- **Done (2026-08-01, later)** — **the recorder panel's walkthrough UI, rebuilt** on the owner's
  verdict ("clean up that walkthrough ui... i hate this ui"). Deleted outright: the **puck** (the PiP
  pointer, `content/puck.ts` and every message, type and CSS rule behind it), the **popped-out editor
  strip** (`?pop`, `strip:track`, the whole `wide` timeline layout), **mark** (hotkey, dock key,
  `KeyFrame.reason` member, report annotations, the never-thin carve-out), the timeline's **entire
  selection model**, and the transcript's **"reads right"** pill. Added: **per-take delete**
  (`take:delete`, arming inline on the take's own label, renumbering the rest), an **empty-timeline
  branch**, a **two-row walkthrough header** (crumb+meta, then title+`record a take`), an inline
  right-aligned **zoom** control, and a **project picker that never hides** — `no project` /
  `projects unavailable · retry`, with a way through to `/projects`.
- **Done (2026-08-02)** — **workspaces removed: Teams + one implicit Personal space**
  (`plans/2026-08-01-teams-restructure.md`, commit `3207be1`). Org→Team (ownerId transferable via
  `teams.transferOwnership`, seatLimit enforced on invites), personal = `teamId null` owned by
  userId, guests/ProjectAccess deleted, tokens user-scoped, ingest/MCP re-scoped (`space` field,
  `?team=` filter, declare `teamId`), client Space context + switcher, extension 1.6.0 (one link
  per server, Personal/team destination picker). `cli/migrate-teams.ts` ran against prod (before
  the deploy, by accident — dev `.env` pointed at prod; ~15 min of signed-in 500s until the
  deploy rolled; zero data lost, audit in the Deploy section). e2e 4/4 re-verified.
- **Done (2026-08-02, later)** — **Handback on the phone**: PWA (manifest + share_target +
  no-cache SW + return-mark icons), `/phone` guide+intake, and `src/lib/capture/` — the
  extension pipeline ported to distill OS-recorded clips in the browser and upload through the
  unchanged ingest API (multi-clip → rec-NN, voice-note mode, iOS picker path). Live in-PWA
  screen capture confirmed impossible on mobile; design + limitations in
  `plans/2026-08-02-phone-pwa.md`. On-device QA still pending (needs a real phone).
- **Done (2026-08-12, later)** — **human handback** (`plans/2026-08-12-human-handback.md`, all
  four waves): `Walkthrough.kind` + `shareToken` (schema pushed NOWHERE yet — prod gets it via
  predeploy `db push` on the next main push; local dev + `handback_test` need it by hand),
  token-guarded `/w/:shareToken` watch page, share/unshare/shared procedures, /record kind
  picker + pristine capture, transcript-first editor (`src/lib/edit/`, `components/edit/`),
  mediabunny MP4 render + upload (`final.mp4`/`transcript.json`/`edit.json`), share-on-success.
  Typecheck + build green; **no live browser run** (the `.env`-points-at-prod hazard again) —
  the whole record→edit→render→share loop wants a human at a keyboard.
- **Done (2026-08-12, later that night)** — **the viewer/editor/watch redesign**
  (`plans/2026-08-12-viewer-redesign.md`, mock-first: 3 directions → owner merged all three →
  anchored suite → approved; built fable-opus, 5 Opus agents + gate): the masthead header
  (controls absorbed, ⋯ overflow, inline arming — walkthrough-controls.tsx deleted), the shared
  `Timeline` scrubber + `useSegmentPlayer` chassis, agent view rebuilt as one player + rail +
  timeline + numbered frames grid (take-section/filmstrip deleted), the human editor rebuilt
  scrubber-first (thumbs.ts, envelope voice bars; supersedes transcript-first — decisions.md),
  /w restyled as a centered screening page. Typecheck + build green; no live browser run yet.
- **Done (2026-08-12, night)** — **extension human handback**
  (`plans/2026-08-12-extension-human-handback.md`, built by an Opus subagent, reviewed): panel
  "for a person" picker + pristine capture (extension 1.8.0 — REMEMBER: needs
  `bun run publish:extension`, a push ships only the server), raw-take human uploads,
  `presignEdit`/`finalizeEdit`/`setKind`, the viewer's cloud editor with re-edit, kind switch
  select in the controls row. Typecheck/build/extension-build green; still no live run.
- **Done (2026-08-12, go-wide prep wave 1)** — retention + cost levers + hardening surface
  (`plans/2026-08-12-security-retention-audit.md`): `server/retention.ts` (30d resolved expiry,
  14d raw purge, 7d unfinalized reap, hourly sweep) + Keep control + "expires in Nd" in
  viewer/inbox, `cli/backfill-expiry.ts` (NOT yet run on prod), R2-ready storage
  (`S3_ENDPOINT` + `cli/migrate-storage.ts`, cutover owner-gated), bitrate throttle mirrored
  (extension 1.8.1 — publish pending), security headers, /privacy rewrite (#processors names
  models), /admin/costs estimator. Typecheck + build green; local live run blocked on a
  `db push --accept-data-loss` only Sal can run.
- **Done (2026-08-12, go-wide prep wave 2)** — server-side free tier + auth hardening (audit
  items 2/5/7/8): email-verification gates (uploads/AI/token-mint; reads open), `monthly_usage`
  budgets + first-walkthrough magic + `pro` feature, 10-token cap, `cloud` block in /context,
  share-token log redaction, trustedOrigins + cookie pinning. Live-verified locally (403 gate,
  magic, 900s free block). Turnstile deferred (no keys).
- **Done (2026-08-13, later)** — **Wave 2**: timestamped comments (WalkthroughComment → viewer
  panel in AgentView + `--- comments ---` in the brief), full-text search (searchText corpus at
  finalize + `walkthroughs.search` + /app deep-search union), Monday digest (server/digest.ts +
  notifyDigest mute + per-kind unsubscribe). Typecheck green; same schema-push caveat as Wave 1.
- **Done (2026-08-13)** — **Wave 1 of the picked backlog** (`plans/2026-08-13-loop-and-team-wave.md`):
  the return path + the doorbell. `post_result` MCP tool → WalkthroughNote review thread →
  viewer AgentAnswer panel (Approve & resolve / Send back with note → reopens + note joins the
  brief), WalkthroughAccess agent trace ("pulled by <token> 12m ago"), team upload emails
  (User.notifyUploads + HMAC unsubscribe + /team toggle). Typecheck + build green. **Schema is
  pushed NOWHERE** — `.env` points at prod (the standing hazard), so local dev/`handback_test`
  need `db push` by hand and prod gets it via predeploy on the next main push. No live run yet.
- **Done (2026-08-13, later still)** — **Wave 3** (`plans/2026-08-13-loop-and-team-wave.md`,
  closes the picked backlog): **split into tasks** — `server/structure.ts` (claude-opus-5
  structured outputs over report.md + comments → 1–10 proposed tasks; degrade-to-null;
  skipped the fallbacks beta on purpose), `proposeSplit`/`applySplit` (metered via the polish
  budget, human confirms before rows exist), `Walkthrough.parentId`+`briefMd` children
  (metadata-only rows, brief served as reportMd to MCP), viewer SplitPanel/TaskBrief/
  SplitChildren + ⋯ "Split into tasks…"; and **voice-only capture** — /record's third kind
  "just talk" (mic-only, in-memory, rides the phone distill pipeline; VOICE_RECORD_ROWS).
  Typecheck + build green; same schema-push caveat as Waves 1–2, no live run.
- **Done (2026-08-23) — the marketing-foundation wave** (`plans/2026-08-12-marketing-plan.md`
  refreshed; built fable-opus, 5 Opus agents + Fable glue): **og.png + full social meta**
  (twitter:card, og:image, per-route canonical injected in server.ts, sitemap.xml, robots.txt
  hardening, `bun run make:og`), **hero rewritten to the outcome** ("Record a bug. Your coding
  agent fixes it. You sign off.") + Claude-Code line + 01–04 loop strip + proof line + marketing
  nav anchors (How it works · Pricing · Docs), **/docs** (the Claude Code quickstart + all six
  MCP tools, legal chrome), **error alerting** (server/alerts.ts + client beacon; email via
  Resend, dedup + caps) + **smoke.yml** (post-deploy + 30-min cron probes of
  healthz//,/mcp), /app empty state now sequences record → connect → invite, README reconciled
  to the hosted MCP command, MCP directory pack + demo beat sheet + X drafts in plans/.
  Verified live on :3995 (canonical, /docs render, loop strip, 390px scrollWidth clean).
- **Done (2026-08-23)** — **the fable5 mega-wave** (`plans/2026-08-23-fable5-mega-wave.md`,
  fable-opus, 11 Opus agents, 4 waves, commits 2fe46ef·5666608·64c107b·8bde623): sidebar app
  shell (top tabs deleted), /usage + /upgrade (+ pro-gate contract), `Walkthrough.intent`
  through web + extension 1.9.0 + declare, per-project agent instructions, the Refine pass
  (vision curation + ledger + intent-aware brief + capture-health + auto-title), the
  walkthrough assistant (Opus 5 chat, real mutation tools, revision log), needs_info +
  ask_reviewer + inline/voice/routed answers, attach_evidence + evidence on post_result,
  notify on result/question/health ('results' unsubscribe kind), watch-page comments,
  /upload stay-put notice, stdio MCP mirror. **Live-verified end to end** on a synthetic
  walkthrough (push → refine → MCP brief → question → answer → evidence → result; bx browser
  passes on shell/usage/upgrade/viewer). Outstanding: extension publish (Sal, Windows zip),
  prod deploy on next push, video-to-prompt intent mirror.
- **Done (2026-08-24) — the viewer rethink + key-point spine + free-tier kill** (owner: "ship
  it"; plans/2026-08-23-viewer-rethink.md; design canvas via /design, direction C "review desk"
  approved; fable-opus, 8 Opus agents + gate): **server** — refine synthesizes digestMd +
  pointsJson (kpN spine) + suggestedTitle + live refineStage; the brief opens with digest +
  numbered KP obligations; post_result takes per-point `outcomes` (hosted MCP + stdio + REST —
  also fixed ingest silently stripping `evidence`); assistant gains update_digest/
  update_key_points. **client** — /walkthroughs/:id rebuilt as the full-bleed review desk
  (masthead bar, vertical tab rail, state-driven hero incl. THE VERDICT "what you raised → what
  came back", ONE exchange thread + composer replacing four panels — itself untangled
  2026-08-24pm into Conversation tab + Edit-with-AI tab + Overview-hero sign-off/answer, see
  plans/2026-08-24-exchange-untangle.md; app sidebar forced to icon
  rail on the route; react-markdown). **pricing** (same day, owner) — free tier killed in copy
  AND code (0 budget, magic removed, pro 15h), landing = Pro $20/15h · Business $40/30h ·
  Enterprise, all "coming soon". Cost model: real cost ≈ $1.50/recorded-hr (refine-dominated;
  /admin/costs understates ~10× — fix pending); $20/$40 underwater on a filled quota.
  e2e re-baselined 4/4; states live-verified in Chrome. Pushed to prod (41520b0).
- **Next** — **deploy, then re-test the loop**: `/mcp` and `/connect` only exist locally until the
  next push to `main`, so the command `/connect` prints for handback.dev 404s until then. Sal's
  Drydock/DNS checklist in the rename plan (zone, project, S3 via
  `G:\code\drydock\plans\2026-07-30-s3-buckets.md`), load-unpacked QA of the extension, then **the
  go-live blockers in `plans/2026-07-30-go-live.md`** (Chrome Web Store submission first — it's
  the only queue we don't control), then the strategy backlog in
  `G:\code\gripe\plans\2026-07-29-enterprise-strategy.md`.

## Plans

- `plans/2026-08-12-marketing-plan.md` — **active — THE LAUNCH PLAYBOOK.** Positioning ("task
  capture for agents"), channel reality (X-only via @dested), phases, and the "⏭ Next actions"
  owner checklist at the top. Read it whenever launch/marketing comes up. Companions:
  `plans/2026-08-23-demo-video.md` (beat sheet + X drafts, waiting on the owner's recording day)
  and `plans/2026-08-23-mcp-directory-pack.md` (directory submissions drafted, owner submits).
- `plans/2026-07-30-transcription.md` — **active**. Why on-device Whisper stopped being the
  default, what shipped on Groq, and what's left (Deepgram if keyterm biasing is ever needed). The
  Haiku cleanup pass it proposed is built — `server/polish.ts`.
- `plans/2026-07-30-go-live.md` — **active**. What's required before strangers can sign up. Blockers
  1 and 2 (email, upload caps) and most should-fixes are ticked off; what's left is Sal's — Resend
  domain verification, the Web Store submission, the prod S3 round trip, and rotating the keys that
  were pasted in chat. Also carries the deferred `<all_urls>` → `activeTab` migration, written out
  file by file for the day Google asks.
- `plans/2026-07-30-web-store-listing.md` — **active**. Every field the Web Store form asks for,
  written to paste: description, single-purpose statement, a justification per permission, the
  data-use disclosure table, reviewer notes with test-account steps, and the screenshot shot list.
- `plans/2026-07-30-handback-rename.md` — **active**. The Inloop → Handback rename: settled
  decisions table + Sal's Drydock/DNS checklist (zone, S3, project recreate, SSM, cleanup).
- `plans/2026-08-01-teams-restructure.md` — **done**. Workspaces removed: the target model,
  pinned contracts, migration steps, and wave plan for the Teams + Personal restructure.
- `plans/2026-08-02-phone-pwa.md` — **done** (code); on-device QA outstanding. The platform
  verdict (no mobile screen capture, ever), the OS-recorder + share-target design, and the
  honest limitations list for /phone.
- `plans/2026-08-12-web-recorder.md` — **done**. The extension-free `/record` path: what ports,
  the two accepted divergences, the pop-out gesture rule.
- `plans/2026-08-12-human-handback.md` — **done** (code; live run pending). The kind split,
  share links, the transcript-first editor, the mediabunny decision, and the four waves.
- `plans/2026-08-12-extension-human-handback.md` — **done** (code; live run pending). Record in
  the extension, resolve on the web: the cloud-bridge argument, the presignEdit contract, the
  switchable kind.
- `plans/2026-08-13-loop-and-team-wave.md` — **done** (code; live run pending). The picked
  backlog in three waves: the return path + doorbell (W1), comments/search/digest (W2), the
  split structuring pass + voice capture (W3).
- `plans/2026-08-23-fable5-mega-wave.md` — **done**. The 4-wave fable-opus build: every
  decision, contract and wave assignment for refine / the assistant / intent / needs_info /
  evidence / sidebar / usage / upgrade. Live-verified; see the Status entry.
