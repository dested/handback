# Marketing plan — going wide

- **Date:** 2026-08-12
- **Status:** active
- **Type:** plan
- **What:** The executable go-wide plan: positioning, launch sequence, channels (founder content,
  launch moments, communities, paid), homepage readiness, metrics. Owner executes; this doc is the
  checklist.

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

## Growth loops already in the product (feed them, don't build new ones)

1. **Share links** — `/w/:token` ends with "Recorded with Handback → handback.dev". Every human
   handback shared is an ad. Promote sharing in-product once the security audit's share-page
   fixes land.
2. **Team invites** — the recorder is useless alone at a company; a resolved walkthrough is the
   invite pitch.
3. **MCP ecosystem listings** — every MCP directory/registry entry is durable SEO + discovery to
   exactly the beachhead.

## Gates before any public launch (sequencing, not marketing)

From `plans/2026-07-30-go-live.md` + today's audit — in order:

1. Chrome Web Store submission (unlisted) — **only queue we don't control; start first.** Packet
   is written (`extension/store-listing/`).
2. Prod S3 round trip proven (~15 min; doubles as the reviewer account).
3. Privacy page truth-up + share-link section (audit doc) — must precede promoting share links.
4. Error tracking + post-deploy smoke check — you'll be asleep when launch traffic hits.
5. Retention shipped and stated — "your recordings auto-expire" is a *selling point* for this
   audience, not fine print.

## Phase 0 — this week (foundation)

- [ ] Clear gates 1–2 (submission in queue, S3 proven).
- [ ] Homepage fixes from the readiness assessment (section below).
- [ ] OG image + meta description (every share/launch link renders a card; currently unverified).
- [ ] **The demo video**: one 90-second real loop — record a gripe on a real app → Claude Code
      pulls it over MCP → PR → sign off in the inbox. This is THE asset; everything below reuses
      it. (The `walkthrough` skill can produce a polished cut; the raw loop should be real.)
- [ ] `/docs` or a README-grade "how it works with Claude Code" page — launch commenters read docs
      before signing up.

## Phase 1 — soft launch (weeks 1–2): communities + founder content

Goal: 50 real signups, watch the funnel, fix what breaks. No spiky traffic yet.

- **X build-in-public**: 3–4 posts/week. Formats that work: the demo clip; "watch my agent fix a
  bug I narrated from my phone"; cost/architecture threads (the /admin/costs page is itself a
  post); before/after of a real fix. Always a link, always the loop.
- **MCP directories**: submit the hosted MCP server everywhere (official MCP registry,
  mcp.so-style lists, awesome-mcp repos). Durable, zero-cost, exactly-right audience.
- **Communities** (give-first, no drive-bys): Claude Code Discord/Reddit, r/ClaudeAI, agent-dev
  Discords. Answer "how do I give my agent context" threads with the walkthrough loop. One
  genuinely useful post per community before ever linking.
- **10 hand-picked users**: DM devs you respect who live in Claude Code. Personal onboarding,
  watch them fail, fix the funnel. Their quotes become launch social proof.

## Phase 2 — launch moments (weeks 3–6, one per week, biggest last)

Each moment needs: demo video, tight homepage, working sign-up→record→connect in <10 minutes.

1. **Chrome Web Store → public** + "Handback is open" X thread.
2. **Product Hunt** — assets: gallery of the loop, the demo video, founder comment telling the
   story ("I got tired of writing bug reports for my agent").
3. **Show HN** — title shaped like "Show HN: Record a bug in your own words; your coding agent
   fixes it (MCP)". HN wants: honest limitations comment up top, architecture details in thread
   (they'll ask about privacy/retention — the audit work IS the answer), no marketing voice.
4. Each moment recycles into: X thread, LinkedIn post, community follow-ups.

## Phase 3 — compounding (week 6+)

- **Content engine**: weekly demo clip (a real walkthrough → real fix), monthly deep-dive post
  (transcription pipeline, keyframe dedup, MCP design — dev-tools audiences follow engineering
  blogs, and each is X-thread-able).
- **YouTube/dev-tool reviewers**: pitch the 10–15 channels covering Claude Code/agent workflows;
  offer a recorded loop + founder walkthrough. One good video outperforms a launch day.
- **SEO**: "give Claude Code context", "MCP bug reports", "agent code review workflow" — small
  surface, low competition, exactly the buyer.
- **Paid — only after organic converts** (signup→first-upload >25%): sponsor 2–3 dev newsletters
  (TLDR-class) and one YouTube integration; measure CAC vs. zero; kill fast if it doesn't clear.

## Metrics (weekly, one dashboard)

- Signups; **activation** = first walkthrough uploaded AND first agent connected (token used —
  `tokens.connection.lastUsedAt` already tracks this); the full loop = first walkthrough
  *resolved*.
- Retention: recorders active in week 2 / week 4.
- Loop health: share links created → visitors → signups (the K-factor once /w promotes it).
- Funnel drop-offs: sign-up → extension installed → first recording → first agent pull.

## Pricing at launch

Free alpha stays (nothing billed; the page already says so honestly). The tier ladder
(seats + hours + retention windows: Free 1h/30d, Pro $20 3h/90d, Business $40 10h/1y) is settled —
margins verified in /admin/costs. Flip billing on only after activation holds; announce before
charging anyone (the page already promises "we'll ask before a card is ever needed").

## Homepage readiness (recon 2026-08-12)

**Verdict: not launch-ready as-is, but close.** The 5-second test fails for a cold stranger: the
hero ("Debug and review your app in your own words") sells the *input*; the outcome — your agent
fixes it, you sign off — doesn't appear until section two. The Distill section (the real moat) is
the most convincing content on the page and is buried third. /connect and /recorder are the
strongest pages in the funnel (one-click token mint, live connected indicator, OS-aware
commands); the weak seam is sign-up → dashboard, which offers no record/connect/invite sequencing.

**Launch-blocking gaps:**
- **No OG image exists at all** (and no twitter:* meta, canonical, robots.txt, sitemap). Every
  share on X/Slack/HN renders as a bare text link. Fix before ANY launch moment.
- **No motion anywhere** — a product whose thesis is "video is the worst input" shows zero video.
  The Phase-0 demo clip belongs above the fold.
- **No social proof** — the one proof line ("the first coding agent to read a real bundle called
  these the highest-value thing in it") is anonymous and buried in Distill.
- Claude Code/MCP never appears above the fold despite being the beachhead; no "Connect Claude
  Code" CTA to /connect from the homepage.
- README still documents the stale stdio MCP setup instead of the hosted `--transport http` line;
  one-liner drifts across index.html / manifest / hero.

**Ranked fixes (recon's top 10, adopted):**
1. OG image + Twitter card meta (nothing else matters if shares have no card).
2. Hero rewrite to the outcome: "Record a bug. Your coding agent fixes it. You sign off."
3. Demo GIF/video above the fold.
4. Name Claude Code + MCP under the hero; secondary CTA → /connect.
5. 4-step loop diagram on the first screen (don't defer the loop to section two).
6. Social proof: one named quote / design-partner logo; pull the proof line up.
7. Alpha pricing simplification: one "free during alpha, no card" banner; tier grid demoted
   (keep "Priced per reviewer, not per walkthrough" prominent).
8. Marketing-nav anchors (How it works · Pricing) + a Docs/FAQ link.
9. Post-sign-up onboarding checklist (record → connect agent → invite reviewer).
10. README/one-liner reconciliation (hosted MCP command, single tagline).
