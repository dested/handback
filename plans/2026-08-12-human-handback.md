# Human handback — pristine video, in-browser tight edit, share link

- **Date:** 2026-08-12
- **Status:** done
- **Type:** plan
- **What:** a second first-class walkthrough kind — video *for a person* — with an
  in-browser editor (auto-tighten + transcript-first cuts) and token-guarded share links.

## The ask

Owner: record a video to send back to a *person*, not an agent. Report it easily, have it
cut up — "give me the tightest edit of this": remove breaks/long pauses, remove pieces,
move out whole chunks. In the browser. Find an npm library for the heavy lifting if one
exists, otherwise build it. And pull the human/AI distinction out explicitly: **human
handback wants the video pristine; AI handback doesn't care.**

## Settled with the owner (2026-08-12)

| Fork | Answer |
| --- | --- |
| Delivery | **Token-guarded share link + MP4 download** — both |
| Edit UI | **Transcript-first** (Descript-style: delete text → cut video; silence gaps are chips; one Tighten slider). Timeline is preview + fine-trim, never a selection marquee |
| Reordering | **Remove-only + whole-take reorder in v1** — but the EDL must be order-capable so full segment reorder drops in soon |
| Data model | **Walkthrough + `kind`** ('agent' \| 'human') — same table/spaces/quota/inbox; human viewer is video-primary; MCP filters `human` out of agent lists |

## Engine decision: mediabunny

[mediabunny](https://mediabunny.dev/) (Vanilagy — successor to mp4-muxer/webm-muxer):
pure TS, zero deps, ~16–30KB gzipped tree-shaken, demux/decode/encode/mux webm+mp4 over
WebCodecs (hardware encoders), microsecond-precision trimming. Covers exactly the hard
half: read our MediaRecorder webm, re-encode a cut list, mux H.264+AAC MP4.
Bonus: a fast remux fixes MediaRecorder's cueless webm so the editor gets real seeking.

**Rejected:** ffmpeg.wasm (~30MB, needs cross-origin isolation, slow), server-side ffmpeg
(576MiB container hard cap), off-the-shelf editor UIs (the auto-jump-cut world is SaaS
apps — TimeBolt/SavvyCut — not libraries). Timeline UI is ours; we own the filmstrip
visual language already.

## Design

### The kind split

- `Walkthrough.kind String @default("agent")` — `'agent' | 'human'`.
- Chosen on `/record`'s hero: "for a coding agent" / "for a person".
- **Capture divergence (the "pristine" half):** human mode records
  `frameRate: {ideal: 30}` (agent mode stays 10) and sets `videoBitsPerSecond`
  (~8 Mbps; agent mode keeps MediaRecorder defaults), and **skips the keyframe
  sampling loop entirely** — no frames, no contact sheets, no report.md distill.
  Mic shadow + transcription stay: the transcript IS the edit surface.
- Agent surface: `walkthroughs-api` list excludes `kind: 'human'` (MCP + ingest GET);
  direct `get` by id still answers.
- Viewer: `kind === 'human'` renders video-primary (big player, transcript below,
  share + download controls; no filmstrip/keyframe emphasis). Inbox rows get a small
  kind tag.

### Share links

- `Walkthrough.shareToken String? @unique` (+ `sharedAt`). Token is the whole
  credential — same precedent as unaddressed invites. Minted with crypto randomness
  (~22 chars base58); revoke = null it; re-share = new token.
- `walkthroughs.share` / `walkthroughs.unshare` (member-gated), and a **public**
  `walkthroughs.shared` procedure (rate-limited, input = token) returning title,
  transcript, duration, presigned GETs for the video files. No enumeration surface.
- Route **`/w/:shareToken`** — public watch page, no session, no app chrome; player +
  transcript. 1h presigns; page refetches on expiry.

### The EDL (built for reorder from day one)

```ts
type EditSegment = { id: string; takeId: string; srcStart: number; srcEnd: number }
type Edl = { version: 1; takeOrder: string[]; segments: EditSegment[]; // ordered = output order
             tighten: { threshold: number; pad: number } }
```

- `segments` is the *output* in order. v1's UI only ever produces removals (splitting
  a take's span and dropping pieces) and whole-take reorder — but the render walks
  `segments` in array order, so arbitrary reorder is already legal downstream.
- Non-destructive: raw take webms in IDB are never touched. EDL persists to
  IDB (`handback-web-recorder`, new store) on every change — crash-survivable like
  everything else in the house.

### Auto-tighten

- Candidates from **two sources we already have**: gaps between Whisper segments
  (`t`/`d` in ms), confirmed against an RMS envelope decoded from the audio track
  (`decodeAudioData` on the mic shadow, else the video's track).
- Cut every gap > threshold (slider, default ~800ms), keep ~200ms pad around speech,
  always trim leading/trailing silence. Each cut is a chip in the transcript flow —
  click to veto/restore.

### Transcript-first editor (`/record`, human mode, after takes exist)

- Flow: takes → **Edit** stage: transcribe (existing client → `/api/ingest/transcribe`
  → polish) → editor → Render & send.
- Transcript lines are the edit surface: select/delete a line or word-range →
  its time range leaves the EDL (strikethrough, restorable). Gap chips between lines
  show tightened silences. Take strip above: drag to reorder, × to drop.
- Preview: `<video>` per take with timeupdate skip-over-cuts (seekable thanks to the
  mediabunny remux). Fine-trim handles at cut edges on the mini-timeline. Small seek
  glitches acceptable in preview; the render is exact.

### Render & deliver

- `render(edl, takes) → final.mp4` via mediabunny: decode each kept span, encode
  H.264+AAC (hardware), progress bar. Then the normal two-phase upload with
  `kind: 'human'`; files = `final.mp4`, `transcript.json`, `edit.json` (the EDL, for
  future re-edit), `MANIFEST.txt`. **Raw takes are NOT uploaded in v1** — they stay in
  IDB for the session; re-edit-after-upload arrives with full reorder. (Quota: a raw
  30fps capture would eat the 2GB/walkthrough cap fast; the render is the artifact.)
- Success screen: **Copy share link** (mints on click) + **Download MP4**.
- `ingest declare` accepts optional `kind` (default `'agent'`, validated).

## Waves

1. **Schema + kind + share** — prisma (`kind`, `shareToken`, `sharedAt`) + db:generate;
   ingest declare `kind`; walkthroughs-api list filter; `share`/`unshare`/`shared`
   procedures + rate limit; `/w/:shareToken` page; viewer video-primary branch + share
   controls; inbox kind tag.
2. **/record human mode** — kind picker on the hero; pristine capture settings in
   `live.ts` (30fps, bitrate, no frame loop); human flow skips distill, uploads video +
   transcript.
3. **Editor** — EDL lib + IDB persistence, remux-for-seek, silence detection,
   transcript-first UI, tighten slider, preview player, take reorder, fine-trim.
4. **Render + export** — mediabunny render to MP4, progress, upload (`final.mp4` +
   `edit.json`), download button, share-on-success.

Each wave typechecks green before the next. `.env` `DATABASE_URL` points at PROD
(standing hazard, bitten twice) — **no `db:push` until it's verified local**;
`db:generate` is enough for typecheck.

## Out of scope (soon, not now)

- Full segment reorder UI (EDL already supports it).
- Re-edit after upload / editing extension or phone recordings (extension IDB is
  another origin; viewer-side editing over presigned GETs is the path).
- Filler-word ("um") removal — needs word-level timestamps from Whisper; possible
  via Groq `verbose_json` later.
- Captions burned into the MP4.
