# Demo video — the real loop + the polished cut

- **Date:** 2026-08-23
- **Status:** active
- **Type:** plan
- **What:** Beat sheet for THE launch asset (the 90s real loop, Sal narrating), the polished-cut
  shot list, bug-pick criteria, and the X drafts that ship with it. Per the refreshed marketing
  plan: demo target is **Handback itself** — the recursion is the pitch.

## The premise (say it in the video)

Record a bug *about Handback, in Handback*. Claude Code pulls it over Handback's own MCP server,
fixes the Handback repo, posts the result back through `post_result`, and Sal signs off in the
inbox. One product, playing every role. This is also the canned answer to HN's inevitable
"do you actually use it?" — the demo IS the answer.

## Cut A — the real loop (~90s, raw, Sal narrates; goes to X + Show HN)

Authenticity rules: one sitting, real bug, real fix, jump-cut the waiting, no music, no captions
beyond maybe a mono timestamp. The polish goes in Cut B — this one has to feel like screen +
voice + terminal, because that's the claim.

| Beat | ~time | On screen | What Sal says (spirit, not script) |
| --- | --- | --- | --- |
| 1. Hit record | 0:00–0:20 | Handback open on the bug. Start recording (extension or /record), talk through it, **draw on the broken thing** (the cobalt ink is the brand shot), stop. | "ok so watch this — [the bug]. that's wrong. fixing it the normal way means writing all this up. instead—" (stop talking = done) |
| 2. The brief exists | 0:20–0:30 | The walkthrough lands in /app — card grid, then the viewer for 3 seconds: keyframes, transcript, report. | "that 20 seconds of complaining is now a brief: transcript, keyframes, the console errors that fired while i talked." |
| 3. Agent pulls it | 0:30–0:55 | Terminal. Claude Code: "anything waiting on handback?" → `list_walkthroughs` → `get_walkthrough` → it reads, then works. Jump-cut the thinking. | "claude code pulls it over mcp. i didn't paste anything." |
| 4. Handed back | 0:55–1:15 | `post_result` fires → back in Handback: status flipped to in_review, the AgentAnswer panel shows the summary + what it touched. | "and it hands the work back. i didn't merge anything yet — it's waiting on me." |
| 5. Sign off | 1:15–1:30 | Watch the before-video against the fix, click **Approve & resolve**. Hold on the resolved state one beat. End card: `handback.dev · free during the alpha`. | "i look, it's right, signed off. that's the whole product." |

**Recording mechanics:** capture the whole session with OS screen recording (or OBS) at full res;
the in-product recording inside beat 1 is Handback's own recorder doing its job on camera. Keep
the raw file — Cut B reuses this footage.

## Cut B — the polished ~60s (homepage above-the-fold + Product Hunt gallery)

Built by Claude with the walkthrough/Remotion kit from Cut A's footage + fresh Puppeteer
screenshots. Same 5 beats compressed, on-brand paper/cobalt frames, caption strip instead of
relying on voice (autoplay is muted), music bed low. Ends on the stamp: SIGNED OFF BY A HUMAN.
Deliverables: 16:9 MP4 for the homepage `<video>`, and the PH gallery stills (one per beat).

## Picking the bug (before recording day)

Criteria — all four, no exceptions:
1. **Visible in <10 seconds** to a stranger: a layout break, a wrong number, a dead control.
   Never infra (the R2 CORS gap is real but invisible on screen).
2. Real — found, not planted. Dogfooding means the next genuine annoyance is the demo.
3. One-pass fixable by the agent (client-side, contained), so beat 3 jump-cuts honestly.
4. Lives on a screen that looks good on camera (/app grid or the viewer, ideally).

**Standing offer:** Claude sweeps the running app with bx for 15 minutes and shortlists 3–4 real
papercuts to choose from — ask when you're ready to record. Don't stage one; there will be a real
one.

## X drafts (@dested voice — post as-is or mangle freely)

### The announcement thread (needs: OG image live, homepage rewrite live, Cut A uploaded)

1. "i got tired of writing bug reports for my coding agent. so now i just complain out loud —
   screen recording + narration in, repro-grade brief out, agent pulls it over mcp, fixes it, and
   the fix waits for me to sign off. it's called handback. free during alpha. handback.dev"
   *(attach Cut A)*
2. "the loop: record a bug in your own words → handback distills it (transcript, keyframes,
   console errors that fired while you talked) → your agent pulls the brief → hands the fix back →
   you say the last word. nothing ships without a human."
3. "the demo is recursive on purpose: i recorded a bug about handback, in handback, and claude
   code fixed the handback repo through handback's own mcp server. the product filed and closed
   its own bug report."
4. "unreasonably effective detail: we tile keyframes into contact sheets before the agent reads
   them. a model reading frames side by side follows what happened; the same frames one at a time,
   it doesn't. first agent to read a real bundle called the sheets the highest-value thing in it."
5. "connecting an agent is one line: claude mcp add --transport http handback
   https://handback.dev/mcp — token minted on /connect, nothing installed. works from cursor or
   anything else that speaks mcp too."

### Standalone posts (drip before/after the thread)

- **New-rule format (pre-launch warmup, no link):** "new rule: you're not allowed to type a bug
  report for your coding agent. complain out loud like a normal person and make the computer do
  the writing"
- **When the mega-wave's ask_reviewer ships:** "my coding agent just asked ME a clarifying
  question about a bug i recorded. it hit a fork, set the walkthrough to needs_info, and emailed
  me. we are officially coworkers"
- **Architecture thread teaser (the R2 story):** "moved all handback video storage from s3 to r2
  mid-alpha. 4,602 objects copied and byte-verified, zero downtime, and egress went to literally
  $0. video products live or die on egress — thread when i'm less tired"
- **Voice-note capture:** "sometimes the bug report is just… talking. handback has a 'just talk'
  mode now — mic only, no screen — and it still comes out the other side as a structured brief
  your agent can act on. dictation for people who hate dictation"

Posting rules (from the refreshed marketing plan): no hashtags, no emoji, no "Announcement",
always a link when there's something to click, never post a link until the OG card renders.
