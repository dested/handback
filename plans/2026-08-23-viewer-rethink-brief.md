# The walkthrough-page rethink — brief for a fresh session

- **Date:** 2026-08-23
- **Status:** active
- **Type:** plan
- **What:** The complete prompt for redesigning /walkthroughs/:id from scratch (page + the AI
  experience on it). Written by the previous session to be executed in a clean context. Start a
  fresh session and say: **"Read plans/2026-08-23-viewer-rethink-brief.md and execute it."**

---

## Mission

Redesign `/walkthroughs/:id` — the walkthrough viewer — **from scratch, with a new metaphor**.
The owner's verdict on the current page, verbatim spirit: *"you can't just stack 10 features on
top of each other. this whole page works like shit, especially when the handback is done. i
fucking hate this page. rethink it from scratch, new metaphors. they're paying big money."*

The page accreted four feature waves onto a chassis designed for two. Every feature is good;
the composition is the failure. This is a paid product — the page must feel like it.

Read first, in order: `cliffnotes.md` (the map), `ui.md` (visual law), this file,
`plans/2026-08-12-viewer-redesign.md` (the previous redesign — its Timeline/VideoStage/masthead
chassis is good bone, reusable), `plans/2026-08-23-fable5-mega-wave.md` (what the AI features
are and why). Then the code: `src/app/walkthrough.tsx` and `src/components/viewer/*`,
`server/refine.ts`, `server/agent.ts`, and the chat/answer/refine procedures in
`server/router.ts`.

## Settled decisions — do not relitigate, do not water down

1. **The page is state-driven.** The walkthrough's status decides what the page IS:
   - **Fresh / open (agent kind):** the recording is the page — watch, scrub, curate, read the
     brief. This is closest to today.
   - **Refining:** the page says so, calmly and visibly, and transforms when it finishes (see
     AI re-spec below).
   - **needs_info:** the agent's question is the page. Answering it (typed or spoken) is the
     one action.
   - **in_review — "the handback is done" — THE hero state, design this first:** the verdict
     is the page. Agent's summary, evidence screenshots (before/after), what it touched, PR
     link — and one unmistakable Approve / Send-back moment. The recording demotes to evidence
     you can pull open. Think PR-review verdict screen, not video player with a thread under it.
   - **resolved:** a closed case — quiet, archival, the sign-off stamp visible.
   - **Human kind:** the edit → share flow stays the page (cloud editor, final cut, share).
   - **Child task (briefMd set):** stays a brief page.
2. **One thread.** Refine's notes, the agent's pulled-trace, its questions, the human's
   answers, `post_result` results + evidence, reviewer send-backs, timestamped comments, AND
   the assistant conversation become **one chronological thread with one composer**. Typing to
   the assistant is typing into the thread; assistant actions log as quiet system lines. Four
   separate panels (AgentAnswer, comments, AssistantPanel, refine notes) must not survive.
3. **Nothing dies.** Owner: "i like all this shit — only overflow." Console/events, raw
   report.md ("what the agent reads"), split-into-tasks, kind/move/delete/share all stay
   reachable — drawers, overflow, tabs — never stacked in the main flow.
4. **Quality bar** (owner picked all four): **Linear** issue detail (density, one activity
   thread, keyboard-fast, zero noise) · **Vercel** deployment page (status-driven, big clear
   state, progressive disclosure) · **Graphite / PR review** (evidence + conversation +
   explicit verdict) · **Notion AI / Granola** (AI output reads human, progress is calm and
   visible, the document comes back transformed).
5. **Visual law is unchanged.** `ui.md` governs: light only, warm paper, ink, ONE cobalt
   accent, Fraunces/Libre Franklin/IBM Plex Mono, hairline rules, the stamp, nothing orange,
   no dark mode (video wells are the only dark surface). The redesign changes **structure and
   metaphor**, not the brand. Status colors fixed: open=cobalt, in_review=violet,
   resolved=green, needs_info=muted ink grey.

## The AI experience — full re-spec (not just presentation)

This is half the mission. What happened to the owner today, which must never happen again:
he recorded a walkthrough, refine ran **silently for minutes** (he thought it was broken),
then its output appeared at the **bottom** of the page as **raw unrendered markdown** —
literal `**asterisks**` and backticks — an exhaustive timestamped ledger with **no
human-readable summary anywhere**, and the walkthrough **kept its junk default title**
(the rename gate only catches date-stamp/slug defaults; the extension's default "Session"
slips through). His words: "JESUS CHRIST… still no summary, nothing."

Mandates:

- **Progress is visible from the first second.** The moment a refining walkthrough is open,
  the page says what's happening ("Reading your walkthrough…"-grade copy, skeleton where the
  summary will land) and resolves live (poll or stream). When refine finishes, the page
  visibly transforms — title, digest, curated frames arriving is a designed moment, not a
  reload surprise.
- **Always a human digest.** Re-spec `server/refine.ts`'s synthesis so its output leads with
  a 2–4 sentence plain-language digest (what this recording is, what they want) distinct from
  the exhaustive ledger (which stays — it's for the agent and the record). The digest lives at
  the top of the page, reads like a person wrote it.
- **The title always comes back right.** Replace recorder defaults (date-stamp slugs, "Session",
  "Recording", untitled) outright; for a human-chosen title, suggest — never overwrite.
- **Render markdown with a real library.** `react-markdown` (+ remark-gfm) or equivalent —
  adding the dependency is expected. Do NOT hand-roll a renderer (the previous session tried;
  the owner laughed at it, correctly). Raw report.md stays deliberately unrendered — it's an
  inspection surface.
- **Server changes are in scope**: refine prompts/shapes, `server/agent.ts`, router procedures,
  new columns if the design needs them. Schema discipline: check `DATABASE_URL` before ANY db
  command (the .env-points-at-prod hazard has bitten twice — cliffnotes Deploy section); prod
  gets schema via predeploy on push.
- **Free-tier story**: the page must never dangle broken or empty AI panels at free users;
  pro-gating is designed, not bolted (`ProUpsell` exists).

## Feature inventory the page must hold (verify against cliffnotes/code, not memory)

Masthead (title/rename, status, project, kind-appropriate primary action, overflow: kind
switch, share, move, delete, split) · Video view (VideoStage custom player, transcript rail,
Timeline scrubber, capture tells) · Frames view (slideshow + filmstrip, staged frame deletion
with undo) · transcript · console/events (demoted) · raw report.md (demoted) · refine outputs
(digest, ledger, health notes, curated captioned frames, excluded spans, run/re-run) · the
thread (agent pulled-trace, post_result + evidence thumbnails, ask_reviewer question + inline
typed/spoken answer, send-back notes, timestamped comments) · assistant (chat + action log,
pro-gated, metered) · split-into-tasks (propose/apply + children ledger) · human kind: cloud
editor, final cut, ShareControl, /w watch page (also gets comments) · statuses incl.
needs_info · expiry/Keep.

## Process — in this order

1. **Absorb** (the reads above). Then write the state × content matrix: for each state, what
   is the hero, what is secondary, what is behind a control.
2. **Design with the `/design` skill** (the owner chose it and has never used it — make the
   canvas good): one canvas, artboards for (a) 2–3 genuinely different structural metaphors of
   the **in_review verdict state** — not three spacings of one idea — then (b) once a direction
   reads strongest, the full state suite in that direction: open, refining, needs_info,
   in_review, resolved, human-kind, plus one mobile-width board. Real data on every board (a
   real-sounding walkthrough, real agent summary, real evidence), never lorem. The owner
   refines/comments in the canvas — **get explicit approval before building.**
3. **Extract the approved design into a written spec** (update `ui.md`'s viewer section +
   a build plan in `plans/`), then **build via fable-opus discipline**: Fable decides
   everything, Opus agents implement (`model: "opus"`, ≤3 concurrent), typecheck gate between
   waves, commit to main, **never push**.
4. **Verify live in the browser** (bx): every state, with a real refined walkthrough — record
   or `bun cli/push.ts` a seed, run refine, walk open → question → answer → result → approve.
   R2 CORS note: browser→R2 uploads fail on `https://handback.localhost` until the owner adds
   that origin in Cloudflare — seed via CLI in dev, or verify on prod after the owner pushes.
5. **Finish like a task**: e2e re-baseline, cliffnotes/ui.md/decisions/updates updated, honest
   delta-vs-mocks report.

## Ground rules

- `bun run typecheck` green before "done"; `./server/*` server-only; tRPC returns JSON-safe.
- Never spawn Fable subagents; Opus only, ≤3 concurrent.
- Don't touch the capture pipeline (`src/lib/capture/*`, extension) — the viewer is web-only.
- Don't reverse recorded decisions silently (`decisions.md`) — this brief already supersedes
  the "assistant sits below the recording" composition on the owner's direct order.
- The S3 key prefix and `/gripes*` aliases are frozen; MCP tool names are stable API.
