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
4. ~~Eval: Opus 5.5 on the fixture, old brief vs new, graded on the four planted complaints, frame
   citations and nothing invented.~~ Done; results below.
5. ~~Web capture (`src/lib/capture/`: /phone, /upload, /record) onto the library; keep the
   Handback-only pieces (api, context, pending, upload, transcribe, polish, live-*).~~ Done on
   library 1.1.4 (local, not pushed). Verified in headless Chromium against a client-only Vite
   server: `distillForHandback` (agent + human) and `sendLiveWalkthrough` with declare, PUTs and
   finalize answered by the test, nothing uploaded. Output in `W:\junk\handback\migration-check\`.
   Found on the way: the web transcribe client never ranked speakers (Deepgram's 0-based ids
   would fail applyTranscript's `speaker >= 1`); re-transcribe left a stale engine label; the
   library promised outlines on live-kept frames (fixed in 1.1.4). Left as it was: the human
   MANIFEST lists report.md, which the human path drops (same as before).
6. Extension: report and grids from the library. A release needs Sal's OK.

Pushing main deploys through Drydock: that needs Sal's explicit OK.

## Eval results (2026-10-15)

`scripts/brief-eval/run.ts` on the video-to-prompt fixture app (31 s, four planted complaints:
toast gone in 0.6 s, total $1,240 → $1,245, "Email is required" before typing, a card-declined
banner with no card), with the title and transcriber name neutralised (they gave the answers away).
Old = v1 files, old Refine prompt, old formatter with presigned URLs and a fetch tool standing in
for curl + Read. New = v2 files, rebuilt report, evidence key points, get_images/get_file. Refine
ran once per condition (Sonnet 5, no Haiku curation in either); Opus 5.5, adaptive thinking, 3 runs
each, graded by reading. Outputs: `W:\junk\handback\brief-eval\runs\` and `…\runs2\`.

| | old | new | new + 1.1.2 + frames in Refine |
| --- | --- | --- | --- |
| toast seen (and its 0.5 s) | 0/3 (v1 kept no frame) | 3/3 | 3/3 |
| total read as $1,240 → $1,245 | 3/3 | 3/3 | 3/3 |
| validation timing right (appears while still focused) | 0/3 ("fires on focus") | 3/3 | 3/3 |
| frames of what preceded the banner (dialog closed, scroll, PDF hover) | 0/3 (none kept) | 3/3 | 3/3 |
| brief errors the agent had to correct | $12.40, "no frame of the total" | $12.40, total "top-right", confirm frame, "send caused the banner" | total "top-right" (1 line) |
| cost per run / tool calls | $0.28 / 10 | $0.23 / 4 | $0.23 / 4 |

All in: $2.85, 44 calls. Every run on both sides found all four complaints and kept the confirm
dialog off the bug list; Opus 5.5 corrected Refine's $12.40 every time. What the new brief adds is
evidence the old one never had (the transient toast and the frames between the events), at less
cost. Fixes it drove: library 1.1.2 (a line's → frame weighs time on screen; the report says what
"changed top-right" means) and Refine seeing the Start here frames (decisions.md).

Open: a one-digit change doesn't register in the library's signature, so the total's frame is
labelled by the email field's focus ring and Refine still sometimes places the total "top-right"
(video-to-prompt plan, follow-up). Limits: one fixture, one Refine sample per condition, no Haiku
curation, a fetch tool kinder than curl + Read.
