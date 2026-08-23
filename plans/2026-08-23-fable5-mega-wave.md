# Fable-5 mega-wave: refine, walkthrough agent, intent, return path, sidebar

- **Date:** 2026-08-23
- **Status:** active
- **Type:** plan
- **What:** One large fable-opus build — all decisions settled here; Opus agents implement per wave.

Owner directives (verbatim intent): prompt changers (intent), Refine post-processing pass
("whole complete feature"), walkthrough chat agent that can "fuck with the walkthrough as needed"
(NO video re-encode ever — mark excluded spans instead), agent questions w/ inline-or-route answer,
result evidence screenshots, notify-on-result, watch-page comments, /usage page, upgrade screen
(pro is admin-granted; contact sal@dested.com), full sidebar nav redesign ("nav makes it feel like
a toy"), /upload in nav, extension gets the intent picker too. Commit to main, never push.
Product AI: chat + refine synthesis on claude-opus-5; per-frame vision scoring on claude-haiku-4-5.

## Settled decisions

- **intent** = `'bug' | 'feature' | 'idea' | null` (null = untagged, brief doesn't editorialize).
  Set at capture (web record/upload/phone manual + extension 1.9.0) and switchable in the viewer
  (overflow menu). Declare schema gains optional `intent`; old recorders send none.
- **Refine pass** (`server/refine.ts`), pro-gated (admin-granted `pro` feature), fires
  fire-and-forget on ingest finalize (agent kind, pro uploader) + manual `walkthroughs.refine`.
  Steps: deterministic capture-health checks → Haiku vision frame scoring w/ captions (batches of
  12 images, target 10–20 keepers) → Opus 5 synthesis (JSON: title, summaryMd ledger, briefMd
  rewrite, health notes). Outputs land in columns; original report.md in S3 is never touched.
  Title overwritten only when current title is recorder-default-ish (`/^\d{4}-\d{2}-\d{2}-\d{4}/`
  or `title === slug`). Health warns email the uploader. Every failure → `refineStatus 'failed'`,
  degrade like polish. One polish-budget call per refine.
- **Brief serving**: `reportMd = briefMd ?? refinedBriefMd ?? S3 report.md`. formatWalkthrough
  gains intent framing paragraph, `--- summary ---`, `--- project instructions ---`, excluded-spans
  note, curated captioned frames (when curation exists, only curated frame URLs listed).
- **Walkthrough agent** (`server/agent.ts` + `walkthroughs.chat`), Opus 5 tool loop (max 12
  iterations), pro-gated + polish-metered per message. Tools: read content / update title /
  update summary / update brief / edit transcript lines (text only, timings frozen; writes
  rec-NN/transcript.json back to S3 via putObjectText) / remove span (deletes frames in range +
  strikes transcript lines + records excluded span) / set curated frames. NO video mutation.
  Conversation persisted in `walkthrough_chat`; every mutation logged in `walkthrough_revision`.
- **needs_info** = 4th status (agent-set via `ask_reviewer`; human answer flips back to open).
  Color: muted ink grey — never a new loud hue (ui.md updated). expiryFor(needs_info) = null.
- **ask_reviewer** MCP tool → WalkthroughNote {role 'agent', kind 'question'} + needs_info +
  email uploader. Viewer answers inline (text or spoken → transcribed, audio discarded) or routes
  to the uploader by email. `answerQuestion` writes {role 'reviewer', kind 'answer'} + open.
- **Evidence**: MCP `attach_evidence` (+ REST `POST /walkthroughs/:id/evidence`) presigns PUTs at
  `evidence/<ts>-<name>` (≤4 files, ≤5 MB, image/png|jpeg|webp); `post_result` gains
  `evidence: string[]` and flips those rows uploaded. Rendered as thumbnails in AgentAnswer.
- **notify on result/question**: uploader only; new `User.notifyResults` + unsubscribe kind
  `results`.
- **Watch comments**: public `walkthroughs.sharedAddComment` {token, name, text, atMs} →
  WalkthroughComment {userId null, authorName `<name> (viewer)`}, IP-limited 30/h. Members may
  delete null-user comments (deleteComment widened).
- **/usage** (`usage.mine`): per-space storage meters vs 20 GB/500, cloud budget, tokens n/10,
  expiring ≤7d. **/upgrade**: pro pitch + "invite-only during alpha — contact sal@dested.com".
  Server pro-refusals use FORBIDDEN message exactly `'Pro feature'`; client helper `isProError`.
- **Sidebar shell**: app pages get the existing `ui/sidebar` (storageKey now a prop;
  `handback.appSidebar`). Groups: REVIEW (Walkthroughs/Projects/Usage), CAPTURE
  (Record/Upload/Phone/Extension), TEAM (Teams/Connect). Footer: Upgrade (when !pro), Admin
  (when admin), email, Sign out. /admin keeps its own sidebar shell (app sidebar does not wrap it).
  Marketing chrome untouched. e2e re-baselined after.
- Extension bumps to **1.9.0** (intent chips on review screen, intent in declare). Publish to the
  release bucket is Sal's step (zip step is Windows-only) — flag at the end.
- video-to-prompt library mirror of the declare `intent` field: OUT of scope here, flagged to Sal.

## Schema additions (done by Fable directly)

User.notifyResults · Project.instructions · Walkthrough.{intent, summaryMd, refinedBriefMd,
healthJson, curationJson, refineStatus, refinedAt} · WalkthroughNote.{kind default 'result',
evidencePaths} · new WalkthroughChat {walkthroughId, userId?, role, content, actions Json?,
createdAt} · new WalkthroughRevision {walkthroughId, authorName, action, detail Json?, createdAt}.
healthJson = `[{severity:'info'|'warn', text, atMs|null}]`.
curationJson = `{frames:[{path, caption, atMs|null}], excluded:[{startMs, endMs, reason}]}`.

## Waves (≤3 Opus agents concurrent; typecheck gate + commit between waves)

- **A1** sidebar shell: layout.tsx, ui/sidebar.tsx (storageKey prop), routes.tsx (+/usage,
  /upgrade). — DONE when merged w/ A3.
- **A2** extension intent picker (extension/ workspace only, 1.9.0).
- **A3** /usage + /upgrade pages + `usage.mine` router + entitlements {pro, admin} + src/lib/pro.ts.
- **B1** server/refine.ts + ingest.ts (declare intent, finalize refine hook, evidence REST routes).
- **B2** client intent: IntentControl + record/upload/phone + capture-lib declare plumb.
- **B3** walkthroughs-api.ts + mcp-format.ts + mcp.ts + notify.ts + email.ts: needs_info,
  ask_reviewer, attach_evidence, brief fields, notifyResult/Question, templates.
- **C1** router.ts pack: setIntent, project instructions, answer/route question, sharedAddComment,
  deleteComment widen, refine mutation, chat procedures (imports server/agent.ts), get/inbox fields.
- **C2** server/agent.ts (the walkthrough agent loop + tools).
- **C3** viewer client: AgentAnswer questions/evidence/answer(+voice), needs_info chips/filters
  everywhere, watch comments UI.
- **D1** viewer assistant panel (chat UI) + refine surfaces (summary, health, curated frames,
  excluded spans line) + overflow intent control.
- **D2** e2e updates; Fable runs re-baseline. Quality gate agent. Docs (cliffnotes/ui/decisions/
  updates/features). Commits per wave.

## Progress

- [x] Plan written; .env flipped to local DB
- [ ] Schema + storage helpers (Fable)
- [ ] Wave A / B / C / D · gate · docs · commits
