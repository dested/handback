# Attachments + "you mentioned a file" suggestions

- **Date:** 2026-08-31
- **Status:** done
- **Type:** plan
- **What:** First-class file attachments on agent walkthroughs (viewer + web intake), plus a Haiku pass at finalize that notices referenced-but-missing files and nudges the reviewer to attach them.

## Shape

- **An attachment is a `WalkthroughFile` row whose path lives under `attachments/`** — same S3
  layout, same presign machinery, no new file table. Agent kind only, v1: attachments exist to be
  read by the agent through the brief; a human handback's deliverable is the video.
- **Intake pages do NOT touch the mirrored capture pipeline.** /upload and /record hold picked
  files locally and upload them AFTER distill finalizes, through the same tRPC path the viewer
  uses (`presignAttachments` → PUT → `finalizeAttachments`). One mechanism, zero mirror
  obligation (capture/, extension, video-to-prompt stay untouched).
- **Detection** (`server/references.ts`): fire-and-forget from ingest FINALIZE on the null→set
  transition, agent kind only. Haiku reads report.md, returns ≤6 referenced digital artifacts
  ("the pricing spreadsheet", "that CSV Randy sent", literal filenames) with quote + optional
  m:ss. Degrade-to-nothing like polish. Unmetered (one cheap call per walkthrough, behind the
  declare rate limit).
- **`WalkthroughFileSuggestion`** rows: label, quote?, atMs?, dismissedAt?, attachedPath?.
  Cascade with the walkthrough.
- **Brief** (`mcp-format.ts` + walkthroughs-api): `--- attachments ---` section — uploaded
  attachments called out with URLs, and one line per unresolved suggestion
  (`the uploader mentioned "X" — not attached`). Attachment paths excluded from the generic
  files listing (they have their own section).

## tRPC surface (walkthroughs router)

- `attachments` query: `{files: [{path,name,size,url}], suggestions: [...]}` — requireViewAccess;
  self-contained so one panel component serves viewer + intake done screens.
- `presignAttachments`: sanitize names server-side → `attachments/<safe>`, upsert-replace on same
  name (presignEdit semantics), 100 MB/file, ≤20 attachments/walkthrough, walkthrough + space
  byte caps like presignEdit. Gate `requireAttachable`: agent kind, finalized, not a split child
  (children stay metadata-only).
- `finalizeAttachments`: flip rows uploaded, recompute bytes (NOT durationMs/renderedAt),
  optional `fulfils: [{suggestionId, path}]` stamps attachedPath.
- `deleteAttachment`: path must start `attachments/`; S3-first, then row, recompute bytes.
- `dismissSuggestion`: stamp dismissedAt.

## Client

- `src/components/viewer/attachments-panel.tsx` — self-fetching panel: suggestion rows
  (cobalt-wash chip: quote + `attach` / quiet `dismiss`, atMs seeks in viewer), attachment rows
  (mono name · size · download, hover ×-delete that arms inline), `attach a file` picker.
  Polls the query briefly while suggestions are empty (detection is async at finalize).
- Wire into AgentView (section between comments and report), /upload done phase (agent kind),
  /record done phase (agent + voice kinds).
- PUTs reuse `src/lib/edit/transfer.ts` (XHR, progress, 3-try retry — web-only lib, unmirrored).

## Hazards honored

- `.env` points at prod → **no db:push here**. Prod gets the table via predeploy on next main
  push; local dev + `handback_test` need `db push` by hand (same caveat as Waves 1–3).
  `db:generate` only.
- R2 CORS: browser PUTs from `https://handback.localhost` fail in dev until the origin is added
  to R2 CORS (pre-existing caveat, applies to attachment PUTs too).
- Retention: raw purge only deletes `rec-*` — attachments survive; prefix wipes take them.
  `relocate()` copies file rows — attachments move with the walkthrough.

## Steps

1. schema + db:generate
2. server/references.ts (detection pass)
3. router procedures + get includes suggestions
4. ingest finalize hook
5. walkthroughs-api detail + mcp-format section
6. attachments-panel + AgentView + upload/record wiring
7. typecheck, docs (cliffnotes/updates/decisions), status → done
