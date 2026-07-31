# Transcription: get it off the user's machine

> **Status: active** · opened 2026-07-30. Why on-device Whisper stopped being the default, and
> what replaced it. Related: [`2026-07-30-go-live.md`](2026-07-30-go-live.md).
>
> **Built 2026-07-30 on Groq** (Sal's call — cheapest first, easier to swap forward to Deepgram
> than to reverse). Shipped: `server/transcribe.ts`, `POST /api/ingest/transcribe`,
> `extension/src/sidepanel/transcribeCloud.ts`, and the "Transcribe on this device" toggle.
> **The cleanup pass is built too** (2026-07-30, later): `server/polish.ts` → `POST
> /api/ingest/polish` → `extension/src/sidepanel/polish.ts`.
> **Still open:** keyterm biasing (Groq has no equivalent — that's the reason to revisit Deepgram)
> and Deepgram streaming for the live line.

## The problem, precisely

`extension/src/sidepanel/transcribeWorker.ts` runs **`onnx-community/whisper-small.en` at q8**,
WebGPU with a WASM fallback, inside a side-panel worker. That's a 244M-parameter model. Two costs
fall on the user:

1. **First run downloads the weights** (~250 MB) from huggingface.co before a single word is
   transcribed. The ort runtime is bundled (`scripts/copy-ort.mjs`), but the weights are not.
2. **Every recording then pins their GPU or CPU** for the length of the inference. On the WASM
   path — no WebGPU adapter, or shaders that blow up mid-run — a ten-minute walkthrough is minutes
   of a hot fan while the person who just recorded a bug sits and waits.

And the wait is in the worst possible place: *after* they've finished talking, between them and
being done. The recorder is otherwise fast. This is the only part that isn't.

## The decision

**Transcription moves server-side and becomes the default. On-device stays as an opt-in.**

Not "add a cloud option" — flip the default. The local path stops being the thing every user
suffers through and becomes the thing a privacy-sensitive org switches *to*.

That split isn't a compromise, it's the pricing model:

| Tier | Transcription | Whose hardware | Whose bill |
| --- | --- | --- | --- |
| Free | on-device Whisper | theirs | nobody's |
| Paid | server-side, seconds | ours | ours, at ~4¢ per 10-min gripe |

The free tier keeps the thing that costs nothing to run, and the paid tier's headline benefit is
one a user *feels the first time they use it* — transcript in seconds instead of minutes, no fan.
That's a much better upgrade prompt than a seat limit.

## Provider: Groq today, Deepgram if we need the vocabulary

**Shipped on Groq `whisper-large-v3-turbo`** — roughly 10× cheaper than Deepgram, fast enough that
the panel just awaits it, and segment-level timestamps, which is all the timeline needs. The
provider lives behind one module (`server/transcribe.ts`) that returns `{t, d?, text}` in
milliseconds, so swapping it is a single file. The analysis that follows is why Deepgram is the
thing to swap *to* if transcription quality on technical vocabulary becomes the complaint.


**Timestamps are a hard requirement**, and they eliminate most of the field. The transcript drives
seeking on the timeline (`Timeline.tsx` positions each line by `t`, and clicking a line seeks the
video), and `report.md` prints a time window per line. A provider that returns a wall of text is
useless to us no matter how accurate.

| Option | Timestamps | ~Cost /min | Verdict |
| --- | --- | --- | --- |
| **Groq `whisper-large-v3-turbo`** | segment-level | ~$0.0007 | **Shipped.** Cheapest by an order of magnitude, very fast, timestamps good enough for the timeline |
| Deepgram Nova-3 | word-level | ~$0.004 | The upgrade path. Word-level timing and keyterm prompting (below) |
| OpenAI `whisper-1` (verbose_json) | segment-level | ~$0.006 | Fine, unremarkable, no edge |
| OpenAI `gpt-4o-transcribe` | **none** | ~$0.006 | Disqualified — most accurate, but returns no timestamps |
| whisper.cpp on the Drydock box | segment-level | "free" | **No.** The t4g.large already runs 26 tasks; CPU inference would starve the fleet |

The Deepgram edge, when we want it, is **keyterm prompting** — you pass domain vocabulary and it
biases toward it. Handback *knows the context of every recording*: the project name, the origin
hints, the page titles, the console errors captured alongside the audio. Feeding those in as
keyterms means "tee arr pee see" comes back as `tRPC` instead of garbage. No generic transcription
tool has that context; we do, for free, on every gripe. Groq's Whisper endpoint has no equivalent —
which is exactly why the Haiku cleanup pass below matters more on Groq than it would on Deepgram.

> Prices and latencies above are approximate and from memory — **confirm current numbers against
> each provider's pricing page when this gets built.** The ranking is unlikely to move; the exact
> cents might.

Even at the most expensive option, 1,000 ten-minute gripes a month is under $60. This is not a
line item worth optimizing before it exists.

## How the flow changes (as built)

Before: stop → decode the webm's audio to 16 kHz mono → hand the `Float32Array` to the worker →
wait minutes.

Now, in `extension/src/sidepanel/transcribe.ts`:

1. **Decode once, as before.** Both engines want the same 16 kHz mono `Float32Array`, so the decode
   is shared and the fallback costs nothing extra.
2. **Wrap it as WAV and POST it** to `/api/ingest/transcribe` with the panel's own `hb_` token
   (`transcribeCloud.ts`). 16-bit PCM runs ~1.9 MB/minute, so takes are **split into 8-minute
   chunks** and each chunk's timings are offset back onto the recording's clock — the client does
   the cutting because only it knows where it cut.
3. **The server calls Groq** and returns `{t, d?, text}[]` — the exact segment shape the worker
   already emitted, so `report.ts`, `Timeline.tsx`, and the viewer needed no changes at all.
4. **The panel awaits it.** Fast enough that the existing edit-the-transcript UX survives intact —
   no async "transcribing…" state to design, no half-finished gripes in the inbox.
5. **Any failure falls back to the worker**, as does the on-device setting. Non-null-but-empty from
   the cloud is treated as a real answer: grinding through a local pass to hear the same silence is
   the worst of both paths.

> **Deliberately not built: the parallel mic-only `MediaRecorder`.** An opus track would be ~1 MB
> per 10 minutes instead of ~19 MB of WAV, but it means touching the capture engine — the one part
> that must never break — and it wouldn't exist for takes recovered from IndexedDB after a crash.
> Re-encoding the already-decoded audio works everywhere, for every take, with zero recording-path
> risk. Revisit if upload time becomes the complaint.

The provider key lives in SSM as `GROQ_API_KEY` and never reaches the extension. Unset, the
endpoint answers 503 and every recorder falls back to on-device — a dev without a key gets the slow
path, not a broken one. `transcriber` in `extension/src/lib/types.ts` is now a `TranscriberId`
union and `report.ts` names the engine on the trust line; the data model had already anticipated a
second engine.

**Keep the Web Speech live line as-is.** It's free, it's already there, and it only has to be good
enough to show the speaker that the mic is live. Deepgram streaming could replace it later for a
genuinely accurate live caption, but that needs a WebSocket relay on our side and it isn't the
problem being solved here.

## The layer that makes it *good*

Server-side STT makes it fast. This makes it better than what anyone else ships:

**Run a cleanup pass over the raw transcript with `claude-haiku-4-5`** ($1/$5 per MTok — a
10-minute transcript costs a fraction of a cent), grounded in the telemetry we already captured:
the page URLs and titles, the console errors, the project name. Not "fix the grammar" — *"this
person was on `handback.dev/gripes/:id` and the console threw `TRPCClientError`; correct the
technical terms in this transcript and touch nothing else."*

That turns "the tee arr pee see call is throwing" into "the tRPC call is throwing" using evidence
from the same recording. Timestamps pass through untouched. It's the kind of thing that only works
because a gripe carries context a transcript alone doesn't — which is the whole premise of the
product.

Do this **after** the server-side move is working, not as part of it.

## What this costs us elsewhere

**Audio leaves the machine.** That is a real change and it lands on the legal pages: Deepgram (or
whoever) becomes a named subprocessor in the privacy policy, and the on-device mode becomes the
documented answer for anyone who won't accept that. Ship the policy change in the same release —
see the go-live doc, which already flags the privacy policy as a blocker for other reasons.

## Order of work

- [x] `POST /api/ingest/transcribe` + `server/transcribe.ts` (Groq).
- [x] Panel: WAV-encode, chunk, call it, await it, fall back to the worker on failure.
- [x] Settings toggle: "Transcribe on this device" — off by default, the privacy escape hatch.
- [x] Privacy policy names the subprocessor and describes both modes (`/privacy`).
- [x] **A `GROQ_API_KEY` in prod SSM** — set 2026-07-30 (task definition rev 10).
- [ ] Verify end to end against a real recording: check the report's trust line says
      `Whisper large-v3-turbo, hosted`, and that a multi-chunk take (>8 min) has monotonic
      timestamps across the seam.
- [x] **Haiku cleanup pass** — built 2026-07-30. `server/polish.ts` + `POST /api/ingest/polish` +
      `extension/src/sidepanel/polish.ts`, grounded in the recorded origin and the page's console
      errors. Text only: the model returns edits keyed by line index, a line it doesn't return is
      kept verbatim, and every failure leaves the original transcript standing. Verified against
      real mangled speech — "handbag" → "Handback", "cores" → "CORS", "you are ell" → "URL",
      "use effect" → "useEffect". The report names it, because a model touched the words.
- [ ] *(optional)* Mic-only opus track, if the WAV upload turns out to be the slow part.
- [ ] *(optional)* Deepgram, if keyterm biasing beats the cleanup pass.
- [ ] *(optional)* Streaming for a live line that's actually accurate.
