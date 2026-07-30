// Server-side speech-to-text, so the recorder doesn't have to melt the user's
// laptop running Whisper in WASM. One provider today (Groq's hosted
// whisper-large-v3-turbo — see plans/2026-07-30-transcription.md for why) behind
// a shape that doesn't leak the provider to callers.
//
// The contract is deliberately the same segment shape the on-device worker
// emits — `{t, d?, text}` in milliseconds — so the extension can swap engines
// without the timeline, the report builder, or the viewer noticing.

import { z } from 'zod'
import { env } from './env'

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo'
const REQUEST_TIMEOUT_MS = 120_000

/** Milliseconds. `d` is the spoken window; a line covers time, not an instant. */
export interface Segment {
  t: number
  d?: number
  text: string
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

export class TranscribeUnavailable extends Error {}
export class TranscribeFailed extends Error {}

export function transcriptionConfigured(): boolean {
  return Boolean(env.GROQ_API_KEY)
}

/**
 * Transcribe one chunk of 16 kHz mono WAV. Segment times are relative to the
 * chunk, not the recording — the caller owns the offset, because only it knows
 * how the audio was split.
 */
export async function transcribeChunk(wav: Uint8Array, language?: string): Promise<Segment[]> {
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
