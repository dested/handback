// Server-side speech-to-text, so the recorder doesn't have to melt the user's
// laptop running Whisper in WASM. Two providers today, behind a shape that
// doesn't leak the provider to callers: Deepgram (nova-3) is preferred when
// configured because it diarizes — segments come back tagged with a speaker
// number; Groq's hosted whisper-large-v3-turbo (see
// plans/2026-07-30-transcription.md for why) is the fallback.
//
// The contract is deliberately the same segment shape the on-device worker
// emits — `{t, d?, text}` in milliseconds — so the extension can swap engines
// without the timeline, the report builder, or the viewer noticing.

import { dropUnheard } from '@dested/video-to-prompt'
import { z } from 'zod'
import { env } from './env'

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo'
const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen'
const REQUEST_TIMEOUT_MS = 120_000

/** Milliseconds. `d` is the spoken window; a line covers time, not an instant. */
export interface Segment {
  t: number
  d?: number
  text: string
  /**
   * Provider-local speaker index for THIS request (0-based), present only when
   * diarization ran. The numbering is NOT stable across chunks — clients
   * normalize by talk time.
   */
  speaker?: number
}

/** Whisper's verbose_json: timings in seconds, one entry per spoken run. */
const groqResponse = z.object({
  segments: z
    .array(
      z.object({
        start: z.number(),
        end: z.number(),
        text: z.string(),
      })
    )
    .optional()
    .default([]),
})

/** Deepgram's listen response: one utterance per diarized run, timings in seconds. */
const deepgramResponse = z.object({
  results: z
    .object({
      utterances: z
        .array(
          z.object({
            start: z.number(),
            end: z.number(),
            transcript: z.string(),
            speaker: z.number().int().optional(),
          })
        )
        .optional()
        .default([]),
    })
    .optional(),
})

/** What one chunk came back as, and which engine wrote it, in words a report can print. */
export interface Transcribed {
  segments: Segment[]
  label: string
}

const DEEPGRAM_LABEL = 'Deepgram nova-3 (hosted)'
const GROQ_LABEL = 'Whisper large-v3-turbo (hosted on Groq)'

/**
 * Whisper sometimes says a line twice: the same words again as the next
 * segment, starting within a few seconds of the first one ending. Drop the
 * repeat at the source, so the viewer, transcript.txt and every brief see the
 * line once. Same rule (and window) as the report builder's in
 * @dested/video-to-prompt.
 */
const ECHO_MS = 5000

export function dropEchoes(segments: Segment[]): Segment[] {
  const out: Segment[] = []
  let prev: { text: string; end: number } | undefined
  for (const seg of segments) {
    const echo = prev !== undefined && seg.text === prev.text && seg.t - prev.end <= ECHO_MS
    prev = { text: seg.text, end: seg.t + (seg.d ?? 0) }
    if (!echo) out.push(seg)
  }
  return out
}

/**
 * A 16-bit PCM WAV (what every client sends: the library's encodeWav, the
 * extension's own copy of it) as mono Float32 and its rate. Walks the RIFF
 * chunks rather than trusting a 44-byte header. Null for anything else.
 */
export function pcmFromWav(wav: Uint8Array): { samples: Float32Array; sampleRate: number } | null {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4))
  if (wav.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let channels = 0
  let sampleRate = 0
  let at = 12
  while (at + 8 <= wav.byteLength) {
    const id = tag(at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ' && size >= 16) {
      const format = view.getUint16(body, true)
      const bits = view.getUint16(body + 14, true)
      if (format !== 1 || bits !== 16) return null
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
    } else if (id === 'data') {
      if (!channels || !sampleRate) return null
      // A streamed WAV can promise more data than it carries; read what's there.
      const bytes = Math.min(size, wav.byteLength - body)
      const samples = new Float32Array(Math.floor(bytes / 2 / channels))
      for (let i = 0; i < samples.length; i++) {
        let sum = 0
        for (let c = 0; c < channels; c++) sum += view.getInt16(body + (i * channels + c) * 2, true)
        samples[i] = sum / channels / 32768
      }
      return { samples, sampleRate }
    }
    at = body + size + (size % 2)
  }
  return null
}

/**
 * Lines nobody said, gone: Whisper answers silence with "Thank you." (nine of
 * them over a near-silent phone take). The library's check of each line
 * against the audio it claims, run on this chunk's own WAV, so every client —
 * phone, upload, re-transcribe, the extension — gets it.
 */
function dropSilentLines(segments: Segment[], wav: Uint8Array): Segment[] {
  const pcm = pcmFromWav(wav)
  return pcm ? dropUnheard(segments, pcm.samples, pcm.sampleRate) : segments
}

export class TranscribeUnavailable extends Error {}
export class TranscribeFailed extends Error {}

export function transcriptionConfigured(): boolean {
  return Boolean(env.DEEPGRAM_API_KEY || env.GROQ_API_KEY)
}

/**
 * Transcribe one chunk of 16 kHz mono WAV. Segment times are relative to the
 * chunk, not the recording — the caller owns the offset, because only it knows
 * how the audio was split.
 */
export async function transcribeChunk(
  // Explicitly backed by a plain ArrayBuffer: `BlobPart` won't accept the
  // SharedArrayBuffer case that a bare Uint8Array leaves open.
  wav: Uint8Array<ArrayBuffer>,
  language?: string
): Promise<Transcribed> {
  // Deepgram wins when configured — it diarizes; Groq is the fallback.
  if (env.DEEPGRAM_API_KEY) {
    const segments = await transcribeDeepgram(wav, language)
    return { segments: dropSilentLines(segments, wav), label: DEEPGRAM_LABEL }
  }
  const segments = dropEchoes(await transcribeGroq(wav, language))
  return { segments: dropSilentLines(segments, wav), label: GROQ_LABEL }
}

async function transcribeGroq(
  wav: Uint8Array<ArrayBuffer>,
  language?: string
): Promise<Segment[]> {
  const key = env.GROQ_API_KEY
  if (!key) throw new TranscribeUnavailable('Server-side transcription is not configured')

  const form = new FormData()
  // Whisper routes on the extension, so the name is load-bearing, not cosmetic.
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav')
  form.append('model', MODEL)
  form.append('response_format', 'verbose_json')
  // Deterministic: this is a transcript of what was said, not a creative task.
  form.append('temperature', '0')
  if (language) form.append('language', language)

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((err: unknown) => {
    throw new TranscribeFailed(err instanceof Error ? err.message : 'network error')
  })

  if (!res.ok) {
    // The provider's error body is useful to us and safe to log, but it is not
    // something to hand back to a caller verbatim.
    const detail = await res.text().catch(() => '')
    throw new TranscribeFailed(`provider returned ${res.status}${detail ? `: ${detail}` : ''}`)
  }

  const parsed = groqResponse.safeParse(await res.json())
  if (!parsed.success) throw new TranscribeFailed('unexpected provider response shape')

  return parsed.data.segments
    .map((seg) => {
      const t = Math.max(0, Math.round(seg.start * 1000))
      const end = Math.round(seg.end * 1000)
      const text = seg.text.trim()
      return end > t ? { t, d: end - t, text } : { t, text }
    })
    .filter((seg) => seg.text.length > 0)
}

async function transcribeDeepgram(
  wav: Uint8Array<ArrayBuffer>,
  language?: string
): Promise<Segment[]> {
  const key = env.DEEPGRAM_API_KEY
  if (!key) throw new TranscribeUnavailable('Server-side transcription is not configured')

  const params = new URLSearchParams({
    model: 'nova-3',
    diarize: 'true',
    utterances: 'true',
    smart_format: 'true',
  })
  if (language) params.set('language', language)

  const res = await fetch(`${DEEPGRAM_URL}?${params.toString()}`, {
    method: 'POST',
    headers: { authorization: `Token ${key}`, 'content-type': 'audio/wav' },
    body: new Blob([wav], { type: 'audio/wav' }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((err: unknown) => {
    throw new TranscribeFailed(err instanceof Error ? err.message : 'network error')
  })

  if (!res.ok) {
    // Safe to log, not to hand back to a caller verbatim.
    const detail = await res.text().catch(() => '')
    throw new TranscribeFailed(`provider returned ${res.status}${detail ? `: ${detail}` : ''}`)
  }

  const parsed = deepgramResponse.safeParse(await res.json())
  if (!parsed.success) throw new TranscribeFailed('unexpected provider response shape')

  const utterances = parsed.data.results?.utterances ?? []
  return utterances
    .map((utt) => {
      const t = Math.max(0, Math.round(utt.start * 1000))
      const end = Math.round(utt.end * 1000)
      const text = utt.transcript.trim()
      const base = end > t ? { t, d: end - t, text } : { t, text }
      return utt.speaker === undefined ? base : { ...base, speaker: utt.speaker }
    })
    .filter((seg) => seg.text.length > 0)
}
