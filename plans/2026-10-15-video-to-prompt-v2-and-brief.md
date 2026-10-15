# video-to-prompt v2 in Handback, and a better agent brief

- **Date:** 2026-10-15
- **Status:** active
- **Type:** plan
- **What:** move Handback onto `@dested/video-to-prompt` v2 and rebuild the MCP brief Opus reads

The CoLoop rebrand (uncommitted since 2026-09-21) is stashed as `stash@{0}`, with backups in
`/w/junk/handback/coloop-rebrand-2026-09-21.*`. This work lands on top of `2333867`; the rebrand
gets unstashed afterwards.

## Why

What an agent actually receives is `formatWalkthrough` (`server/mcp-format.ts`). Today:

- After Refine, `report.md` is replaced by Sonnet's `refinedBriefMd`. The verbatim narration and the
  frame-by-frame timeline never reach the agent.
- Digest, key points, summary ledger and refined brief all restate the same points.
- Every file carries a ~600-char presigned URL. A 600-frame walkthrough is ~360 KB of URLs. Claude
  Code saves text results over 50k chars to a file, so long briefs arrive as a file reference.
- Seeing a frame means curl + Read. Most agents never look.
- Key points carry no evidence: no quote, no frame, no error.
- Reports are frozen at upload: v1 data, no change boxes, no Start here, and stale after a
  re-transcribe or a removed span.

## Design

**Server-side report.** `server/brief.ts` reads each take's `recording.json` from R2 and parses it
with the library's `readRecordingJson` (format 1 and 2, extension and web). It then runs the
library's pure `buildReport` with Handback's options:

- viewer URL, source "Handback", `videoPath` from `Take.videoPath`
- reviewer cuts as `cuts` (left out of the timeline and marked inline)
- Refine's curated captions as `captions` ("shows: …")

Every walkthrough benefits, old ones included, with no extension release. A format-1 take never
claims "most of the screen changed": it has no change boxes. If no `recording.json` is readable,
fall back to S3 `report.md`. A split child keeps `briefMd`.

**Brief order** (`formatWalkthrough`):

1. intent framing
2. title + one metadata line
3. key points, evidence-first: the quote, the best frame and any nearby error, then the
   outcomes instruction
4. review thread (on a re-pull, a send-back is the instruction)
5. comments
6. project instructions
7. the working brief (`refinedBriefMd`), labelled model-written; the recording wins on any
   disagreement. Digest and summary are dropped: both restate the key points.
8. the recording: the v2 report
9. attachments and MISSING lines
10. files: a compact per-take listing (paths only, with the video's URL) and how to see images

**Tools.**

- `get_images(walkthroughId, paths?)`: image blocks, at most 6 per call. With no paths it returns
  the evidence set: key-point frames first, then Start here. Kept separate from `get_walkthrough`
  because Claude Code caps image-bearing results at 25k tokens.
- `get_file(walkthroughId, path)`: text files as text, images as an image, anything else as a URL.
- `get_walkthrough` declares `_meta["anthropic/maxResultSizeChars"]` so a long brief stays inline.
- `get_frames` (URL paging) stays as it is for back-compat.

Both MCP servers share the implementation (`walkthroughs-api.ts` + `mcp-format.ts`). The stdio CLI
fetches image bytes through the presigned URLs the wire body carries.

## Steps

1. Library 1.1.0: `readRecordingJson`; `RecordingMeta.format`; `ReportOptions.cuts` and
   `captions`; `evidenceAt`; `recording.json` gains `polished`, event `tMs` and `tlMs` (all
   additive). Tag; Handback depends on `github:dested/video-to-prompt#v1.1.0`.
2. `server/brief.ts` + `walkthroughs-api.ts`: the generated report, KP evidence and the evidence
   set on the detail.
3. `mcp-format.ts` reorder; `get_images` / `get_file` in `server/mcp.ts` and `cli/mcp.ts`; ingest
   endpoints for the CLI; admin debug keeps rendering the exact brief.
4. Eval: Opus 5.5 on the fixture, old brief vs new, graded on the four planted complaints, frame
   citations and nothing invented. Report the measured cost before scaling.
5. Web capture (`src/lib/capture/`: /phone, /upload, /record) onto the library; keep the
   Handback-only pieces (api, context, pending, upload, transcribe, polish, live-*).
6. Extension: report and grids from the library. A release needs Sal's OK.

Pushing main deploys through Drydock: that needs Sal's explicit OK.
