# Transcription: get it off the user's machine

> **Status: active** · opened 2026-07-30. Decision doc for replacing on-device Whisper as the
> default transcription path. Nothing here is built yet — this is the design and the argument for
> it. Related: [`2026-07-30-go-live.md`](2026-07-30-go-live.md).

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

## Provider: Deepgram Nova-3

**Timestamps are a hard requirement**, and they eliminate most of the field. The transcript drives
seeking on the timeline (`Timeline.tsx` positions each line by `t`, and clicking a line seeks the
video), and `report.md` prints a time window per line. A provider that returns a wall of text is
useless to us no matter how accurate.

| Option | Timestamps | ~Cost /min | Verdict |
| --- | --- | --- | --- |
| **Deepgram Nova-3** | word-level | ~$0.004 | **Pick this.** Fast, word-level timing, and keyterm prompting (below) |
| Groq `whisper-large-v3-turbo` | segment-level | ~$0.0007 | Cheapest by far and very fast — the budget fallback / second source |
| OpenAI `whisper-1` (verbose_json) | segment-level | ~$0.006 | Fine, unremarkable, no edge |
| OpenAI `gpt-4o-transcribe` | **none** | ~$0.006 | Disqualified — most accurate, but returns no timestamps |
| whisper.cpp on the Drydock box | segment-level | "free" | **No.** The t4g.large already runs 26 tasks; CPU inference would starve the fleet |

The Deepgram edge that matters for us specifically is **keyterm prompting** — you pass domain
vocabulary and it biases toward it. Inloop *knows the context of every recording*: the project
name, the origin hints, the page titles, the console errors that were captured alongside the audio.
Feeding those in as keyterms means "tee arr pee see" comes back as `tRPC` instead of garbage. No
generic transcription tool has that context. We do, for free, on every gripe.

> Prices and latencies above are approximate and from memory — **confirm current numbers against
> each provider's pricing page when this gets built.** The ranking is unlikely to move; the exact
> cents might.

Even at the most expensive option, 1,000 ten-minute gripes a month is under $60. This is not a
line item worth optimizing before it exists.

## How the flow changes

Today: stop → decode webm audio to 16 kHz mono → hand a `Float32Array` to the worker → wait.

Proposed:

1. **Record a mic-only track in parallel.** A second `MediaRecorder` on the mic stream alone yields
   a small opus blob (~1 MB for 10 minutes) — near-free to produce, and exactly the shape an STT
   API wants. Beats re-encoding the decoded PCM, which would be ~19 MB of WAV.
2. **`POST /api/ingest/transcribe`** with the panel's existing `ilp_` token. The server calls the
   provider and returns `{t, d?, text}[]` — the same segment shape the worker already emits, so
   `report.ts`, `Timeline.tsx` and the transcript panel need no changes at all.
3. **The panel awaits it.** At Deepgram/Groq speeds a ten-minute recording comes back in seconds,
   so the existing edit-the-transcript UX survives intact — no async "transcribing…" state to
   design, no viewer changes, no half-finished gripes in the inbox.
4. **Fall back to the worker** if the call fails, or if the org opted into on-device.

The API key lives in SSM and never reaches the extension. The `transcriber` field in
`extension/src/lib/types.ts` is already `'whisper' | 'webspeech'` and `report.ts` already prints
the engine on the trust line — adding a third value is a small, well-defined change. The data model
anticipated this.

**Keep the Web Speech live line as-is.** It's free, it's already there, and it only has to be good
enough to show the speaker that the mic is live. Deepgram streaming could replace it later for a
genuinely accurate live caption, but that needs a WebSocket relay on our side and it isn't the
problem being solved here.

## The layer that makes it *good*

Server-side STT makes it fast. This makes it better than what anyone else ships:

**Run a cleanup pass over the raw transcript with `claude-haiku-4-5`** ($1/$5 per MTok — a
10-minute transcript costs a fraction of a cent), grounded in the telemetry we already captured:
the page URLs and titles, the console errors, the project name. Not "fix the grammar" — *"this
person was on `inloop.dested.com/gripes/:id` and the console threw `TRPCClientError`; correct the
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

1. Mic-only parallel `MediaRecorder` in the recorder (small, independent, no server needed).
2. `POST /api/ingest/transcribe` + provider account + key in SSM.
3. Panel: call it, await it, fall back to the worker on failure.
4. Settings toggle: "transcribe on this device" — off by default, the privacy escape hatch.
5. Privacy policy: name the subprocessor.
6. *(later)* Haiku cleanup pass grounded in console errors + page context.
7. *(later, optional)* Deepgram streaming for a live line that's actually accurate.
