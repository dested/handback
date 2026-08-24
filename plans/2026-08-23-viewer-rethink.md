# Viewer rethink — state × content matrix + build spec

- **Date:** 2026-08-23
- **Status:** active
- **Type:** plan
- **What:** Working doc for executing plans/2026-08-23-viewer-rethink-brief.md: the state ×
  content matrix (step 1), the design-canvas record (step 2), and — once the owner approves a
  direction — the build spec the Opus agents implement from.

## State × content matrix (step 1)

The page is state-driven: `status` × `kind` × `refineStatus` × `briefMd` decide what the page IS.

| State | The hero (the page IS this) | Secondary (visible, quieter) | Behind a control |
| --- | --- | --- | --- |
| **open / fresh** (agent) | The recording: player + transcript rail + timeline; the refine digest at the top once it exists | Curated frames, the thread so far (comments), brief | Console, raw report.md, split, overflow (kind/move/share/delete), frames edit |
| **refining** | Same page as open, but the digest slot is a live progress surface ("Reading your walkthrough…" + skeleton); resolves live (poll), transforms visibly on finish (title + digest + curated frames arrive as a designed moment) | The recording stays watchable | same as open |
| **needs_info** | The agent's question + ONE composer (type / voice / route to uploader) | The recording as reference; the thread | same as open |
| **in_review — THE hero state** | The verdict: agent's summary (human digest), evidence before/after plates, files touched, PR link, and one unmistakable Approve / Send-back moment | The thread; the recording demoted to evidence you pull open | Console, report.md, split, overflow |
| **resolved** | A closed case: the stamp, the verdict preserved quietly, expiry + Keep | Thread (archival), recording archived | same |
| **human kind** | Edit → share flow unchanged (cloud editor / final cut / ShareControl) | Transcript | Overflow |
| **child task** (briefMd) | The brief document | The thread | Back to parent |

**One thread (settled):** refine system lines + agent trace + question/answer + post_result +
send-backs + timestamped comments + assistant conversation = one chronological thread, one
composer. Assistant actions log as quiet mono `·` lines. The four separate panels die.

## Design canvas (step 2)

Direction boards for the in_review verdict state (owner picks before the suite is built):

- **A — The dossier**: single-column editorial document; the verdict is a signed proof you
  countersign; thread below; recording demoted to a footer band. Most Handback-brand; scales to
  every state by swapping the hero band; trivial on mobile. Tradeoff: verdict and thread share
  one column, so long threads push the recording far down.
- **B — The case rail**: the walkthrough's life as a vertical rail (recorded → refined → pulled
  → asked → answered → handed back → sign-off); the current stage expands as the big card. The
  thread IS the rail. Most state-driven/Vercel. Tradeoff: rail eats width, hardest to build,
  mobile needs a collapse.
- **C — The review desk**: split panes — the work (verdict, evidence, files, sources tabs) left,
  the full-height thread + sticky sign-off right. Most PR-review/Graphite. Tradeoff: two panes
  fight below lg; composer lives in a pane, not the page.

Canvas URL: https://claude.ai/code/artifact/714cb945-11cd-4883-bc6c-a0198791b332

## Direction picked (2026-08-23)

Owner leaned **C** ("looks the most different") but called the sketches amateurish and asked
for tabs/vertical tabs — and hammered that the AI must be genuinely smart: "it needs to know
what the key points of the walkthrough are." Anchor rebuilt as the pro cut of C on the canvas's
page 1 (first sketches moved to page 2):

- **Full-bleed desk**: masthead bar → [vertical tab rail 216px | the work | the exchange 396px].
  Rail tabs: Verdict · Recording · Frames · Agent brief · Console · report.md · Tasks.
- **Key points are the spine (the AI re-spec's core):** refine extracts structured key points
  (title · severity · atMs · frame refs), not just prose. The digest leads with them, the brief
  numbers them as obligations for the agent, post_result maps outcomes back to them, and the
  verdict renders "what you raised → what came back — N of N addressed". Needs a new
  `pointsJson` column (or extend curationJson) + refine synthesis schema change + mcp-format
  change + result mapping.
- **One thread** on the right: refine system lines, comments, assistant exchanges (with quiet
  action lines), pulled/asked/answered/handed-back, one composer, sign-off pinned on top.

## Anchor approved (2026-08-23, owner: "love it, ship it")

Owner approved the anchor and short-circuited the full-suite canvas phase — straight to build.
Fable designs the remaining states in the anchor's language (below); the canvas stays as the
visual reference.

## Build spec

**Data contracts (schema pushed to local + handback_test by Fable):**

- `Walkthrough.digestMd` — 2–4 plain sentences, refine-written, the human reads it first.
- `Walkthrough.pointsJson` — `KeyPoint[]`: `{id 'kpN', title, detail, severity high|medium|low,
  atMs|null}` — the structured spine.
- `Walkthrough.suggestedTitle` — refine's title when a human-chosen title was kept (rename
  clears it; dismissable).
- `Walkthrough.refineStage` — 'reading'|'frames'|'writing' while running, else null.
- `WalkthroughNote.outcomesJson` — `PointOutcome[]`: `{point 'kpN', status
  fixed|partial|skipped|not_applicable, note}` on result notes; null from old agents.
- Brief numbers key points as obligations (`KP1 [0:19] (high) …`) and instructs agents to pass
  `outcomes` on `post_result` (MCP + REST, hosted + stdio mirrored).

**Waves (fable-opus, ≤3 Opus concurrent, typecheck gate + commit between):**

- **W1 server**: S1 refine.ts (digest/key_points synthesis, title contract incl. "Session"-class
  defaults, refineStage progress) · S2 mcp-format + walkthroughs-api + both MCP servers + ingest
  (brief sections, outcomes on post_result) · S3 router (get fields, rename clears suggestion,
  dismissSuggestedTitle) + agent.ts (read digest/points, update_digest/update_key_points tools).
- **W2 client — the desk** (`src/components/viewer/desk/`): C1 shell (walkthrough.tsx rewrite,
  masthead, vertical-tab rail w/ mobile collapse, status chip, media hook, recording/frames/
  console/report tabs; deletes agent-view) · C2 overview tab (state-driven hero: refining
  progress / digest+points / verdict w/ outcomes / question / signed-off), key-points table,
  markdown renderer (react-markdown+remark-gfm), brief tab, tasks tab · C3 exchange pane (one
  merged thread + composer modes + sign-off + voice answer; deletes agent-answer,
  assistant-panel, refine-panel, comments-panel).
- **W3**: quality gate agent, bx live verify, e2e re-baseline, docs (ui.md viewer rewrite,
  cliffnotes, decisions ×3, updates), commits. Never push.
