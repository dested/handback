# Live capture on the library's rule (extension + /record)

Status: active — built 2026-10-22; /record deployed with Handback, extension 1.12.0 zipped for Sal to
publish. Items 1–8 done (library pinned to #v1.3.1 in both package.json files); /record and the extension's offscreen
`Recorder` driven in headless Chromium with fake capture (frames with change boxes and close-ups,
`sampling.engine 'live'`, JPEGs under their pick keys, a narration frame stored out of index order).
Item 4 needed library 1.3.1 (`info` joins `PageEvent.level`, kept by `readRecordingJson`, left out
of every error count); nav notes carry origin + path only (a query or hash can hold a token). Item 8 measured headless (software canvas): `push` median 17 ms at 1080p, 57 ms at 5K
(p95 ~200 ms); cadence unchanged. Next: Sal records a real take on the unpacked build.

## Why

The extension (`extension/src/offscreen/recorder.ts`) and /record (`src/lib/capture/live.ts`)
still pick frames with their own rule: a 64×64 RGB grid every 500 ms, kept past 8 changed cells
vs the last 4 kept, a 15 s beat, click/nav-forced frames, then thinned to `frameBudget` (600 at
15+ min). That cap is why a 28-min doc read (qg) kept 600 near-identical frames and Coterie's
42-min Dawn Patrol take kept exactly 600. @dested/video-to-prompt 1.2.0 fixed the rule (no cap,
a page model for scrolling, close-ups, video found per block); 1.3.0 ships it for live use as
`LiveFrames`. Fed the same clip it picks what the extractor picks (Phoenix part 2: 81/81).

Measured on the corpus, real pipeline, old live recorder vs 1.2.0:
qg 600 → 572, w606 239 → 53, w1315 84 → 90, toothio 600 (2145 uncapped) → 178,
Phoenix 58 → 60 and 150 → 81, Dawn Patrol 600 → 524; nothing lost on any.

## The library API (1.3.0, `github:dested/video-to-prompt#v1.3.0`)

```ts
import { LIVE_STEP_MS, LiveFrames } from '@dested/video-to-prompt'
const live = new LiveFrames({
  store: (key, jpeg) => blobs.set(`${id}:frame:${key}`, jpeg),   // awaited
  discard: (key) => blobs.delete(`${id}:frame:${key}`),           // only with a budget; none set
  crop,                                                            // FrameBox, optional
  decorate: (ctx, t, w, h) => pointer,                             // draw the crosshair for time t, return FramePointer
})
await live.push(elapsedMs, video)      // every LIVE_STEP_MS (250); await before the next
live.openLine(t); live.closeLine(t)    // speech start / stop (ms into the take)
await live.finish(elapsedMs, video)    // at stop, before the share is torn down
live.frames()                          // [{ frame: RecordingFrame (index 1..N, time order), key }]
live.sampled; live.sampling            // → RecordingMeta.sampled / .sampling
```

`frames()` numbering can shift while recording (a narration line's frame lands before frames
kept after it), so the JPEG is stored under `key` (the pick id), never under `index`.

## What changes

1. **Extension recorder** (`extension/src/offscreen/recorder.ts`): the sample loop calls
   `live.push` every LIVE_STEP_MS instead of `cellDiff`/`DEDUP_*`/`BEAT_MS`; `finish()` calls
   `live.finish` before tearing the share down and drops the `frameBudget` thinning and its
   renumbering. Frames in the meta come from `live.frames()`; each carries its blob key
   (`blobKey`) so the bundle, cancel and recovery paths read `${id}:frame:${blobKey}` (old
   takes in IDB have no `blobKey`: fall back to `index`). `pristine` takes still sample nothing.
2. **Speech → lines:** a voice-activity detector on the mic (the AnalyserNode the mic shadow
   already has, or a new one): RMS over ~50 ms; speech after ~200 ms above the room's level, over
   after ~700 ms below; `openLine` at onset, `closeLine` at the end. Dictation finals arrive late,
   so they don't drive it. No mic: no lines (the rule still keeps changes and beats).
3. **Pointer:** keep a short ring of pointer samples (~10 s); `decorate(ctx, t, w, h)` draws
   the crosshair for the sample current at `startedAt + t` (fresh within POINTER_STALE_MS) and
   returns the FramePointer the frame should carry. Details get no crosshair (the library skips
   them).
4. **Clicks and navigations no longer force frames.** The rule keeps what a click changed; a
   click that changed nothing is evidence for the timeline, not a picture. Log each forced moment
   as a page event (`info`, e.g. `click: <selector> "<text>"`, `nav: <url>`) so the report's
   timeline still says it happened.
5. **Bundle and report:** the extension's own `lib/report.ts`, `lib/grids.ts` (format 1 ports)
   give way to the library's `buildReport`, `buildRecordingJson`, `buildManifestTxt`,
   `buildTranscriptTxt`, `makeGrids`, `sheetFile`, as `src/lib/capture/live-upload.ts` already
   does for /record, so close-ups, `seenMs` and change boxes reach the upload. The extension
   adds the library as a dependency (`github:dested/video-to-prompt#v1.3.0`).
6. **Recorder panel crop (window shares):** when the share is a Chrome window with the side
   panel open, the panel is in every frame (Coterie's takes). Crop it: `crop = {x:0, y:0,
   w: 1 - panelWidth/windowWidth, h:1}` from the panel's `innerWidth` and the window's width,
   recorded as `RecordingMeta.crop`. Screen shares stay uncropped for now (the panel isn't at a
   known edge); its ticking timer and live caption are busy cells the rule already leaves out.
7. **/record** (`src/lib/capture/live.ts`): the same swap (it is a port of the extension's
   engine); `live-rule.ts` goes; `frameBudget` import goes.
8. Sampling cost: two small signature draws per 250 ms plus a hold copy (≤3840 wide) when the
   rule asks. Watch CPU on a 5K screen; if it shows, say so before changing the cadence.

## Verification

- `bun run typecheck` (root) and `cd extension && npm run typecheck && npm run build`.
- The library's parity check already ran (test/browser/live.ts in video-to-prompt).
- /record in headless Chromium with fake capture (`--use-fake-ui-for-media-stream
  --use-fake-device-for-media-stream --auto-select-desktop-capture-source=...`) if it yields a
  stream: a short take keeps frames with `change` boxes and `sampling.engine = 'live'`.
- Sal records a real take with the unpacked build before anything ships.

## Rollout (Sal decides)

The self-hosted update channel and the Web Store both auto-update every install, Coterie's team
included. Default: Sal-only first (load-unpacked / beta), Coterie after his own takes look right.

## Out of scope here

Auto-crop for screen shares, the review sheet, ultrawide legibility, the STT bake-off.
