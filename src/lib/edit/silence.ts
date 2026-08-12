// Where the dead air is. Two sources of truth, combined conservatively: the
// RMS envelope of the take's mixed audio track says where there is no *sound*,
// and the Whisper transcript says where there are no *words* — a span is only
// proposed as a cut where both agree, so an app's own sound effects or a
// second voice never get tightened out just because nobody was narrating.
//
// The envelope is computed once per take (a decode is the expensive part) and
// the cuts are re-derived synchronously every time the tighten slider moves.

import { decodeMono, SAMPLE_RATE } from '../capture/audio'
import type { Cut, TightenOptions } from './edl'

/** Coarse loudness over time. 50 ms windows — syllable-scale, not sample-scale. */
export interface Envelope {
  rms: Float32Array
  windowMs: number
  durationMs: number
}

const WINDOW_MS = 50

/** Never cut a silence this short even at the tightest setting — it's a breath. */
const FLOOR_MS = 300

/** Decode a take's audio into an envelope. Null = no decodable/audible audio. */
export async function computeEnvelope(media: Blob): Promise<Envelope | null> {
  const audio = await decodeMono(media)
  if (!audio) return null
  const win = Math.round((SAMPLE_RATE * WINDOW_MS) / 1000)
  const count = Math.max(1, Math.floor(audio.length / win))
  const rms = new Float32Array(count)
  for (let w = 0; w < count; w++) {
    let sum = 0
    const start = w * win
    for (let i = start; i < start + win; i++) sum += audio[i]! * audio[i]!
    rms[w] = Math.sqrt(sum / win)
  }
  return { rms, windowMs: WINDOW_MS, durationMs: Math.round((audio.length / SAMPLE_RATE) * 1000) }
}

/**
 * The loudness bar below which a window counts as silent, chosen from the
 * take's own distribution: raw capture (no noise suppression — see RAW_AUDIO)
 * means every room has a different floor, so a fixed constant would cut one
 * person's speech and keep another's refrigerator.
 */
function silenceThreshold(rms: Float32Array): number {
  const sorted = [...rms].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  const floor = at(0.15)
  const loud = at(0.9)
  // A take that is quiet throughout (loud ≈ floor) proposes nothing.
  return Math.min(floor * 2.5 + 1e-4, floor + (loud - floor) * 0.15)
}

interface SpeechSpan {
  tMs: number
  endMs: number
}

/**
 * Propose cuts for one take: RMS-silent runs at least `thresholdMs` long, minus
 * any overlap with (padded) speech, shrunk by `padMs` at each end.
 */
export function silenceCuts(
  takeId: string,
  envelope: Envelope,
  speech: SpeechSpan[],
  opts: TightenOptions
): Cut[] {
  const threshold = silenceThreshold(envelope.rms)
  const { windowMs, durationMs } = envelope

  // 1. Runs of silent windows.
  const runs: Array<{ startMs: number; endMs: number }> = []
  let runStart: number | null = null
  for (let w = 0; w <= envelope.rms.length; w++) {
    const silent = w < envelope.rms.length && envelope.rms[w]! < threshold
    if (silent && runStart === null) runStart = w * windowMs
    if (!silent && runStart !== null) {
      runs.push({ startMs: runStart, endMs: Math.min(w * windowMs, durationMs) })
      runStart = null
    }
  }

  // 2. Subtract padded speech — words win over the meter, always.
  const spans = speech
    .map((s) => ({ startMs: Math.max(0, s.tMs - opts.padMs), endMs: s.endMs + opts.padMs }))
    .sort((a, b) => a.startMs - b.startMs)
  const quiet: Array<{ startMs: number; endMs: number }> = []
  for (const run of runs) {
    let cursor = run.startMs
    for (const span of spans) {
      if (span.endMs <= cursor || span.startMs >= run.endMs) continue
      if (span.startMs > cursor) quiet.push({ startMs: cursor, endMs: span.startMs })
      cursor = Math.max(cursor, span.endMs)
    }
    if (cursor < run.endMs) quiet.push({ startMs: cursor, endMs: run.endMs })
  }

  // 3. Long enough, then padded inward so the cut never clips onto a word.
  const minMs = Math.max(FLOOR_MS, opts.thresholdMs)
  return quiet
    .filter((q) => q.endMs - q.startMs >= minMs)
    .map((q) => {
      // Leading/trailing dead air is cut flush to the edge — there is nothing
      // on the far side to breathe into.
      const startMs = q.startMs <= 0 ? 0 : q.startMs + opts.padMs
      const endMs = q.endMs >= durationMs ? durationMs : q.endMs - opts.padMs
      return { startMs, endMs }
    })
    .filter((q) => q.endMs - q.startMs >= FLOOR_MS)
    .map((q, i) => ({
      id: `silence:${takeId}:${i}:${Math.round(q.startMs)}`,
      takeId,
      startMs: Math.round(q.startMs),
      endMs: Math.round(q.endMs),
      source: 'silence' as const,
      enabled: true,
    }))
}
