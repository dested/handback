# The two-part "recorder panel + app redesign" handback

- **Date:** 2026-09-12
- **Status:** done
- **Type:** plan
- **What:** acting on walkthroughs 6919f581 (panel feedback, 9 KPs) + 9ce3a6a7 (app UI review, 10 KPs) — one handback recorded in two parts

## What Sal actually asked for (read from the transcripts, not just the digests)

**Panel (part 1).** "First, I need to be able to like minimize this" → closing the panel kills the
recording (KP1). Everything below the stop button is clutter while recording (KP2/KP4). The
transcribing note is small, aggressive, exposes internals, and send should never ship the raw
dictation — but he also doesn't love being blocked (KP7/KP8). Close the panel while uploading
(KP9 — already true since 1.10.0, the panel just never says so). Discard reads too grey (KP6).
Listening ticker needs a "this is a rough guess" line (KP3). Tips (KP5) — retracted mid-sentence.

**App (part 2).** After upload: no "hand it over / code" card, go straight to *view your handback*
(KP1) and say it's still processing (KP2). Card thumbnail isn't clickable (KP5 — real bug: the
`relative` visual header paints over the z-0 stretched Link). Wants mark-resolved + archive like a
board (KP6). Text-heavy verdict page, rail labels "too cute" (KP7). Something "fails and says
click it in the panel" on re-run (KP8 — not locatable in current copy; asked back). **The whole
look needs a redesign — mockups in Design before code (KP9, explicit).** Video player is cool (KP10).

## Decisions

1. **The panel becomes a window, not the worker.** Capture (getDisplayMedia → desktopCapture
   streamId consumed in the offscreen doc), transcription, and upload all run in the offscreen
   document. Closing the panel is now free at every stage. Toolbar badge reads red `REC` while
   recording and the icon can't toggle the panel closed mid-recording.
2. **Send never ships the live dictation and never blocks.** Send enqueues; the offscreen drain
   waits for the session's transcripts before building the file set. The panel shows a real
   progress bar, no internals in the copy.
3. **While recording the panel shows the live block only.** Crumb, title, parts, footer return
   after stop.
4. **Web fixes that survive a redesign ship now**: clickable thumbnail, `processing…` on cards +
   viewer meta + poll, Mark resolved / Reopen in the card menu (archive = resolved; it already
   auto-expires in 30d).
5. **The redesign is a design canvas first** (Claude Design, 3 directions), not code — per KP9.

## Waves

- A (Opus): offscreen capture — manifest `desktopCapture`, `lib/desktop-media.ts` boundary,
  recorder moves to `offscreen/`, `capture:*` protocol, badge + action-click behaviour. 1.11.0.
- C (Opus, parallel): web fixes in `src/` + `server/router.ts` inbox fields.
- B (Opus, after A): transcription moves to offscreen, send gating via outbox wait, panel copy/
  layout (KP3/4/6/7/8/9 + view-your-handback row).
- Fable: design canvas; review; typecheck + builds; post_result ×2 with per-KP outcomes; in_review.

## Wave B spec (extension: transcription + send gating + recording-screen copy) — after A lands

Files: `extension/src/offscreen/index.ts`, `extension/src/offscreen/transcribe.ts` (+ `transcribeCloud.ts`,
`transcribeWorker.ts`, `polish.ts` — all `git mv` from sidepanel/), `extension/src/lib/messages.ts`,
`extension/src/lib/types.ts`, `extension/src/background/index.ts`, `extension/src/sidepanel/App.tsx`,
`extension/src/sidepanel/Outbox.tsx`, `extension/src/sidepanel/panel.css`.

1. Transcription runs in the offscreen document. Queue + loop = App.tsx's old runWhisper/enqueueWhisper
   (settings via `settings:get`, session origin/events from db). Triggers: capture done (internal),
   `transcribe:enqueue {id}` from the panel (after recording:recover), and on offscreen load: every
   done recording with no `meta.transcriber` in an un-closed session or a session with a queued/failed
   outbox entry, ≤7 days old, oldest first. Broadcast `transcribe:update {queue, current}` on every
   change; `transcribe:state` answers the same shape. Background returns false for `transcribe:*`.
2. Outbox drain waits: before buildFileSet, await every queued/current transcript of the session;
   `OutboxEntry.waiting?: 'transcript'` while it does; strip row "waiting for the transcript…".
3. Panel: `whisper`/`whisperIds` come from broadcasts + `transcribe:state` on mount. Footer replaces the
   "still transcribing — hand it over now…" note with a progress block (label by stage, mono N% or an
   indeterminate bar). Send stays enabled; flash after send: "uploading in the background — you can
   close this panel".
4. While `recording`: render ONLY the `.live` block (no crumb/title/outbox/parts/footer).
5. Live block: under the ticker, "Rough live captions — the real transcript is written after you
   stop." + "You can close this panel — recording keeps going. Reopen it or press s on the page to stop."
6. Discard link: `--danger` at .8 opacity (not grey). Outbox done row: "view your handback →" as the
   primary link, "copy brief" secondary, sub line "uploaded · Handback is processing it".
