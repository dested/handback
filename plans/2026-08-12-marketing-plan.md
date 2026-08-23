# Marketing plan — going wide

- **Date:** 2026-08-12
- **Status:** active
- **Type:** plan
- **What:** The executable go-wide plan: positioning, launch sequence, channels (founder content,
  launch moments, communities, paid), homepage readiness, metrics. Owner executes; this doc is the
  checklist. **Refreshed 2026-08-23** against what actually shipped (gate audit below) and the
  owner's channel answers: X is the one real channel (otherwise cold), demo video = both a real
  loop and a polished cut, marketing runs **in parallel** with the fable5 mega-wave, and the Web
  Store listing is **already public**.

## Positioning

**Handback is not a screen recorder.** Loom is video for humans; Jam is bug reports for humans;
Handback is **task capture for agents** — you talk through what's wrong, your agent fixes it, you
sign off. (Carried forward from the 2026-07-29 strategy doc; still correct.)

- One-liner (dev audience): *"Record the bug in your own words. Your agent fixes it. You sign off."*
- One-liner (broad): *"The fastest way to hand work to a coding agent — and get it back."*
- The name is the pitch: the agent **hands the work back**; a human signs off. Say it everywhere.

**Beachhead:** Claude Code power users — they run agents daily, feel the specify-work bottleneck,
adopt bottom-up, and onboarding is literally one `claude mcp add` line (/connect). **Message
stays broad** ("anyone working with an engineering team") but every launch artifact demos the
Claude Code loop end-to-end, because that's the audience the owner knows and can reach.

Expansion audiences, in order: Cursor/other-agent devs (MCP is agent-agnostic) → PM/founder
records + dev's agent fixes (the team sell) → agencies (client feedback → agent queue).

**New ammo since 2026-08-12** — the story got stronger; use it:
- **The loop is fully closed in-product now**: record → agent pulls (MCP) → `post_result` lands in
  a review thread → Approve & resolve / Send back. The demo no longer has to hand-wave the return
  path — it's a screen you can show.
- Share links (`/w/:token`), the no-extension `/record` page, voice-only capture, split-into-tasks,
  Monday digest, retention ("recordings auto-expire" — a selling point for this audience).
- Mega-wave (in flight): refine pass, the walkthrough chat agent, **`ask_reviewer` — the agent
  asks YOU a clarifying question** — and evidence screenshots on results. Each of these is its own
  X moment when it ships; "my agent asked me a follow-up question about my bug report" is the most
  tweetable thing the product does.

## Channel reality (owner's answers, 2026-08-23)

- **X with real reach — the primary channel.** Everything routes through it. Otherwise **cold**:
  no Discord/Reddit presence, no bench of 10 devs to DM. Consequences:
  - MCP directories weigh MORE (durable discovery that needs zero audience).
  - Community presence (Claude Code Discord, r/ClaudeAI) starts NOW as give-first groundwork so
    it's warm by the PH/HN moments — expect 2–3 weeks before a link is welcome.
  - The "10 hand-picked users" becomes: DM the devs who engage with the build-in-public posts.
    The X audience IS the pool.
- **Demo video: both.** A real raw loop (owner narrates, agent really fixes it) for X/HN
  authenticity + a polished ~60s Remotion cut for the homepage and PH gallery.
- **Cadence: parallel.** Sessions alternate between mega-wave waves (B–D) and marketing-foundation
  items below. Neither stalls; marketing items are ordered so the highest-leverage land first.

## Growth loops already in the product (feed them, don't build new ones)

1. **Share links** — `/w/:token` is live. Verify the page carries "Recorded with Handback →
   handback.dev" attribution; every human handback shared is an ad.
2. **Team invites** — the recorder is useless alone at a company; a resolved walkthrough is the
   invite pitch.
3. **MCP ecosystem listings** — every MCP directory/registry entry is durable SEO + discovery to
   exactly the beachhead.

## Gates — audited 2026-08-23

1. ~~Chrome Web Store~~ — **DONE, and already PUBLIC** (store id `bdhajcl…`, STORE_URL wired into
   /recorder). The "flip to public" launch moment no longer exists; moment #1 is now purely the
   announcement thread + demo video.
2. ~~Prod round trip~~ — **proven de facto**: real walkthroughs live on prod (16 as of the Aug 2
   migration audit); R2 cutover byte-verified Aug 13.
3. ~~Privacy truth-up~~ — **DONE** (Aug 12 rewrite; processors named).
4. **Error tracking + post-deploy smoke check — STILL OPEN. The last real gate.** You'll be asleep
   when launch traffic hits. No PH/HN moment until this is in.
5. ~~Retention~~ — **shipped** (30d resolved expiry, 14d raw purge). State it as a selling point.
   Minor: `cli/backfill-expiry.ts` not yet run on prod.
6. **Security housekeeping before the traffic spike** (from go-live + cliffnotes): rotate the
   Groq/Resend/Anthropic keys pasted in chat 2026-07-30; mint the Object-R&W-only R2 token and
   delete the over-privileged migration token.

## Phase 0 — the foundation (parallel with mega-wave; ordered by leverage)

| # | Item | Who | Status |
| --- | --- | --- | --- |
| 1 | **OG image + `twitter:*` meta + canonical + sitemap** — og:title/description exist; **no og:image**, so every share on X/Slack/HN renders a bare text link. Hours of work; unblocks every other item's distribution. | Claude | open |
| 2 | **Error tracking + post-deploy smoke check** (gate 4) | Claude | open |
| 3 | **Homepage top-10 fixes** (ranked list below) | Claude | open |
| 4 | **/docs — "how it works with Claude Code"** — launch commenters read docs before signing up | Claude | open |
| 5 | **MCP directory pack**: listings drafted for the official MCP registry, mcp.so, PulseMCP, Glama, Smithery, awesome-mcp-servers PRs | Claude drafts, owner submits | open |
| 6 | **The demo video, twice**: (a) the REAL loop — owner records a genuine bug on a real app, Claude Code pulls + fixes over MCP, sign-off on screen (~1–2h of owner time; Claude preps the target app, the bug, and the beat sheet); (b) the polished ~60s Remotion cut for homepage/PH | (a) owner + Claude prep · (b) Claude | open |
| 7 | Rotate pasted keys + R2 token cleanup (gate 6) | owner | open |

## Phase 1 — soft launch (weeks 1–2): X + directories

Goal: 50 real signups, watch the funnel, fix what breaks. No spiky traffic yet.

- **X build-in-public**: 3–4 posts/week. Formats that work: the demo clip; "watch my agent fix a
  bug I narrated from my phone"; cost/architecture threads (the R2 $0-egress cutover and the
  /admin/costs estimator are each a post); before/after of a real fix; mega-wave ships as they
  land ("the agent can now ask me questions"). Always a link, always the loop. **Do not post the
  announcement until the OG image renders** — the first impression of every link is the card.
- **MCP directories**: submit everywhere (item 5). Durable, zero-cost, exactly-right audience.
- **Communities** (give-first groundwork, no links yet): join Claude Code Discord, r/ClaudeAI,
  agent-dev Discords; answer "how do I give my agent context" threads on the merits. Budget 2–3
  weeks of presence before the first link.
- **DM funnel**: personally onboard devs who engage with the X posts. Watch them fail; fix the
  funnel. Their quotes become launch social proof.

## Phase 2 — launch moments (one per week, biggest last)

Each moment needs: demo video live, tight homepage, working sign-up→record→connect in <10 minutes.

1. **"Handback is open" X thread** — the announcement moment (the store is already public, so the
   thread + video IS the moment). Pin it.
2. **Product Hunt** — assets: gallery of the loop, the polished cut, founder comment telling the
   story ("I got tired of writing bug reports for my agent").
3. **Show HN** — title shaped like "Show HN: Record a bug in your own words; your coding agent
   fixes it (MCP)". HN wants: honest limitations comment up top, architecture details in thread
   (privacy/retention questions — the audit work IS the answer; the R2/costs material plays well),
   the REAL raw loop not the produced cut, no marketing voice.
4. Each moment recycles into: X thread, LinkedIn post, community follow-ups (by then the accounts
   have history).

## Phase 3 — compounding (week 6+)

- **Content engine**: weekly demo clip (a real walkthrough → real fix), monthly deep-dive post
  (transcription pipeline, keyframe dedup, MCP design, the refine pass — dev-tools audiences
  follow engineering blogs, and each is X-thread-able).
- **YouTube/dev-tool reviewers**: pitch the 10–15 channels covering Claude Code/agent workflows;
  offer a recorded loop + founder walkthrough. One good video outperforms a launch day.
- **SEO**: "give Claude Code context", "MCP bug reports", "agent code review workflow" — small
  surface, low competition, exactly the buyer.
- **Paid — only after organic converts** (signup→first-upload >25%): sponsor 2–3 dev newsletters
  (TLDR-class) and one YouTube integration; measure CAC vs. zero; kill fast if it doesn't clear.

## Metrics (weekly, one dashboard)

- Signups; **activation** = first walkthrough uploaded AND first agent connected (token used —
  lastUsedAt already tracks this); the full loop = first walkthrough *resolved*.
- Retention: recorders active in week 2 / week 4.
- Loop health: share links created → visitors → signups (the K-factor once /w promotes it).
- Funnel drop-offs: sign-up → extension installed → first recording → first agent pull.
- /admin/overview already shows counts + status mix; don't build a dashboard before there's
  traffic to read.

## Pricing at launch

Free alpha stays (nothing billed; the page already says so honestly). The tier ladder
(seats + hours + retention windows: Free 1h/30d, Pro $20 3h/90d, Business $40 10h/1y) is settled —
margins verified in /admin/costs. Pro is currently admin-granted, invite-only (/upgrade says
contact sal@dested.com — shipped in mega-wave A). Flip billing on only after activation holds;
announce before charging anyone.

## Homepage readiness (recon 2026-08-12; re-checked 2026-08-23)

**Verdict: not launch-ready as-is, but close.** The 5-second test fails for a cold stranger: the
hero sells the *input*; the outcome — your agent fixes it, you sign off — doesn't appear until
section two. The Distill section (the real moat) is buried third. /connect and /recorder are the
strongest pages in the funnel; the weak seam is sign-up → dashboard sequencing (partially helped
by the new sidebar shell — re-recon after mega-wave D).

**Ranked fixes (top 10, adopted):**
1. **OG image + Twitter card meta** — og:title/description exist now, og:image still missing.
   Nothing else matters if shares have no card.
2. Hero rewrite to the outcome: "Record a bug. Your coding agent fixes it. You sign off."
3. Demo video above the fold (the polished cut).
4. Name Claude Code + MCP under the hero; secondary CTA → /connect.
5. 4-step loop diagram on the first screen — and it can now end on a REAL screen: the
   AgentAnswer approve/send-back panel.
6. Social proof: one named quote / design-partner logo; pull the proof line up.
7. Alpha pricing simplification: one "free during alpha, no card" banner; tier grid demoted.
8. Marketing-nav anchors (How it works · Pricing) + a Docs link (once /docs exists).
9. Post-sign-up onboarding checklist (record → connect agent → invite reviewer).
10. README/one-liner reconciliation (hosted MCP command, single tagline everywhere).
