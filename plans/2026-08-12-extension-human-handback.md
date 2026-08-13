# Extension human handback — record in the panel, resolve on the web

- **Date:** 2026-08-12
- **Status:** done (code, 2026-08-12; no live run — `.env` points at prod)
- **Type:** plan
- **What:** the extension gets the "for a person" mode; editing stays on the web.
  Raw takes upload with `kind: 'human'`; the viewer grows an edit mode that
  downloads them, runs the existing transcript-first editor, renders final.mp4
  in the browser, and attaches it to the walkthrough.

## Owner's directive

"The extension needs it too… I'm okay with record in extension and resolve on
web. Make it."

## Why the cloud is the bridge

Extension IndexedDB (`handback-recorder`) lives on the chrome-extension://
origin — no page can read it, and external messaging JSON-serializes (no blobs).
So raw takes MUST travel through the existing ingest path. Consequence: unlike
the web /record human flow (which renders locally and never uploads raws), an
extension human walkthrough uploads its raw takes — which also makes
**re-editing** possible for these, since source + edit.json live server-side.

## The contract

An extension human upload declares `kind: 'human'` and carries, per take:
`rec-NN/walkthrough.webm` (pristine), `rec-NN/recording.json`,
`rec-NN/transcript.txt` — NO frames, NO contact sheets, NO report.md, no
MANIFEST. The viewer sees kind 'human' with no `final.mp4` and offers
**"Tighten & share"**: an inline edit mode that produces and attaches
`final.mp4` + `transcript.json` + `edit.json`. After that the viewer/watch page
show the render (FinalCut) — and a **"Re-edit"** affordance remains because the
raws are still there.

## Work items

### 1. Extension (`extension/` — its own npm workspace, npm not bun)

- **`src/lib/types.ts`**: `Session` gains `kind: 'agent' | 'human'` (default
  'agent' in `DEFAULT`/creation paths — old rows without the field read as
  'agent'). Bump nothing else in the schema; the worker owns the DB.
- **Panel idle hero** (`Home.tsx` / wherever the "Record a walkthrough" hero
  lives): the same two-pill picker as /record — `for an agent` / `for a person`
  — system fonts, panel.css tokens (paper/cobalt, NOTHING dark or orange),
  locked once the session has takes. Picking 'human' relabels the hero button
  "Record a video". The choice is stored on the session (message through the
  worker like other session mutations; follow the existing message pattern in
  `lib/messages.ts` + `background/index.ts`).
- **`src/sidepanel/recorder.ts`**: pristine mode, mirroring
  `src/lib/capture/live.ts` EXACTLY (that file is the reference — read it):
  `frameRate: { ideal: 30 }` (vs 10), `videoBitsPerSecond =
  round(min(16e6, max(6e6, videoWidth*videoHeight*4)))`, and NO keyframe
  sampling (no sample timer, no finish() sample, frames stay `[]`). Audio mix,
  mic shadow, chunk persistence: untouched. Transcription + polish still run.
- **`src/lib/upload.ts`** (+ its caller): for a human session, declare body
  gets `kind: 'human'`; the file set is the contract above (skip
  report.md/grids/frames). The declare response field is `walkthroughId` —
  NEVER `gripeId` (that bug already happened once; see cliffnotes).
- **Timeline**: human takes have no frames — the existing empty-timeline/
  transcript-only branches must hold. Do not build panel-side editing.
- **Version**: bump `extension/package.json` to 1.8.0 (manifest version is
  derived by the build — verify, don't hand-edit dist).

### 2. Server (session-authed tRPC — NOT ingest; the editor runs in the viewer)

- **`walkthroughs.presignEdit`** (protected, `requireSpaceAccess`, walkthrough
  must be `kind: 'human'` and finalized): input
  `{ walkthroughId, files: [{ path, size, contentType }] }` where `path` is
  allowlisted to exactly `final.mp4 | transcript.json | edit.json`. Enforce
  the per-file cap and space quota (reuse ingest's exported
  `SPACE_QUOTA_BYTES` etc. and its byte-accounting approach). Upsert
  `WalkthroughFile` rows (status 'pending', replacing any prior row at that
  path), return a presigned PUT per file (`presignPut` signs ContentLength).
- **`walkthroughs.finalizeEdit`** (same gate): marks those rows 'uploaded',
  sets `durationMs` to the render's duration, recomputes `bytes` as the sum of
  uploaded file sizes. JSON-safe returns (Dates → ISO, BigInt → Number).
- Do NOT touch `/api/ingest` routes, MCP, or `walkthroughs-api.ts` for this.

### 3. Web viewer edit mode

- New `src/components/edit/cloud-editor.tsx`: given the tRPC `get` payload of a
  kind-'human' walkthrough, it
  1. fetches each take's `rec-NN/walkthrough.webm` via the presigned URL into a
     Blob (progress line while downloading),
  2. adapts takes into the `LiveTake` shape the existing `Editor` component
     consumes — **use `take.dir` as the take id** (stable across sessions;
     edit.json's takeOrder/cuts key off it), transcript from
     `rec-NN/recording.json` (`recording.transcript` is `TranscriptLine[]`
     `{tMs, endMs, text}` → convert to `TranscriptSegment` `{t, d, text}`),
  3. `seekableBlob` for preview URLs, `computeEnvelope` per take, seeds
     `EditState` from an existing `edit.json` (fetch if present; validate with
     `parseEditState` against the dir ids) else `initialEditState` +
     auto-tighten at 800ms exactly like record.tsx's `retighten`,
  4. reuses `Editor` (`src/components/edit/editor.tsx`) unchanged — if a prop
     tweak is unavoidable, keep record.tsx working,
  5. Render & attach: `renderEdit` → `presignEdit` → PUT each blob (XHR or
     fetch; honor ContentLength) → `finalizeEdit` → invalidate
     `walkthroughs.get` — the page flips to FinalCut on its own.
- **`src/app/walkthrough.tsx`**: kind 'human' without `final.mp4` → a quiet
  callout + "Tighten & share" button that mounts the cloud editor inline
  (replacing the take list while active, with a way back). With `final.mp4`
  AND raw takes present → a small "re-edit" affordance that opens the same
  editor seeded from edit.json.
- transcript.json written by the cloud editor must match the existing shape
  `{ lines: [{at, tMs, endMs, text}] }` on the EDITED clock (see
  `sendHumanWalkthrough` in `src/lib/capture/live-upload.ts` — mirror its
  re-timing logic; extract a shared helper rather than copying if clean).

### 4. Kind is switchable on the walkthrough page (owner: "why not")

- **`walkthroughs.setKind`** (protected, `requireSpaceAccess`): input
  `{ walkthroughId, kind: 'agent' | 'human' }`, writes the column, JSON-safe
  return. No file mutations — it is pure reclassification: agent→human hides it
  from agent lists and (if raw takes exist) makes it tightenable; human→agent
  surfaces it to agents (a missing report.md already degrades to null in the
  brief — tolerated).
- **Viewer control**: in `WalkthroughControls`, member-gated like the rest — a
  small select in the controls row, same visual voice as the existing project/
  move selects: `for an agent` / `for a person`. Optimistic like setStatus
  (in-flight variables stand in), invalidates `get` + `list` + `inbox`.

## Hard rules (from CLAUDE.md / cliffnotes — violations are bugs)

- `bun run typecheck` (tsgo) must be clean; `bun run build` must be clean;
  `cd extension && npm run build` must be clean. Prettier on touched files.
- **No `any`**, no unexplained casts, no `@ts-ignore`. zod at boundaries.
- Light-only UI, nothing orange; extension uses system fonts + panel.css vars.
- `./server/*` into `src/*` as `import type` only. tRPC returns JSON-safe.
- **Do not run ANY db command** — `.env` DATABASE_URL points at PROD.
- Do not touch Dockerfile / drydock.yaml / .github/workflows (Drydock-owned).
- Do not commit, push, or publish — the session lead reviews and releases.

## Out of scope

- Panel-side editing UI (the web is the editor, by design).
- Deleting raw takes after render (quota reclaim) — later decision.
- /phone human mode.
