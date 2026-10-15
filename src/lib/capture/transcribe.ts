import { encodeWav, SAMPLE_RATE } from '@dested/video-to-prompt'
import { assertAuthorized, authHeaders, INGEST } from './api'
import type { TranscriptSegment } from './types'

/**
 * Ported from `extension/src/sidepanel/transcribeCloud.ts`. The decoded audio is
 * wrapped as WAV — the one container every speech API accepts without a codec —
 * and posted to `/api/ingest/transcribe` with this phone's own hb_ token.
 *
 * Long clips are split here rather than server-side: 16-bit PCM runs ~1.9 MB per
 * minute, so a half-hour walkthrough would blow past any upload limit in one
 * piece. Each chunk's timings are offset back onto the recording's own clock,
 * which only the caller can do correctly.
 *
 * The answer carries the engine that wrote it (the server prefers Deepgram
 * nova-3 and falls back to Groq's Whisper), so the report can name the one
 * that actually answered rather than both.
 *
 * Null on any failure, including the 503 a server with no GROQ_API_KEY answers.
 * There is no on-device fallback on a phone, so null means the walkthrough ships
 * without a transcript — never that the run failed. The one exception is a dead
 * token, which throws: signing in again is the only cure and the human has to hear it.
 */

/** ~15 MB per chunk at 16 kHz/16-bit — comfortably inside the endpoint's 30 MB cap. */
const CHUNK_SECONDS = 8 * 60
const CHUNK_SAMPLES = CHUNK_SECONDS * SAMPLE_RATE

export interface CloudTranscribeOptions {
  token: string
  /** 0–1 across the whole recording, so a long clip shows real movement. */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export interface CloudHeard {
  segments: TranscriptSegment[]
  /** The engine that answered, in words. Absent from a server that predates the field. */
  label?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readSegments = (value: unknown): TranscriptSegment[] | null => {
  if (!isRecord(value) || !Array.isArray(value.segments)) return null
  const out: TranscriptSegment[] = []
  for (const raw of value.segments) {
    if (!isRecord(raw)) return null
    const { t, d, text, speaker } = raw
    if (typeof t !== 'number' || typeof text !== 'string') return null
    const base = typeof d === 'number' ? { t, d, text } : { t, text }
    out.push(typeof speaker === 'number' ? { ...base, speaker } : base)
  }
  return out
}

/** The server's word for its engine; it lands in the report, so keep it a short line. */
const readLabel = (value: unknown): string | undefined => {
  if (!isRecord(value) || typeof value.label !== 'string') return undefined
  const label = value.label.trim().slice(0, 80)
  return label || undefined
}

/**
 * Speaker numbers arrive per-request and are NOT stable across chunks — chunk 2
 * may call the narrator "1" where chunk 1 called them "0". We can't carry the
 * provider's labels, but talk time is: in a walkthrough the narrator dominates
 * every chunk, so ranking a chunk's speakers by total speech (most first) and
 * relabelling to that rank makes "S1" mean the same voice across chunks. Ranks
 * are 1-based (1 = most talk time). A segment the provider left unlabelled stays
 * unlabelled; a chunk with no speakers at all comes back unchanged. Keep this
 * identical across the transcribe clients (the pipeline mirror rule).
 */
function normalizeSpeakers(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (!segments.some((s) => s.speaker !== undefined)) return segments
  const talk = new Map<number, number>()
  for (const seg of segments) {
    if (seg.speaker === undefined) continue
    talk.set(seg.speaker, (talk.get(seg.speaker) ?? 0) + (seg.d ?? 3000))
  }
  const ranked = [...talk.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  const rank = new Map<number, number>()
  ranked.forEach(([raw], i) => rank.set(raw, i + 1))
  return segments.map((seg) =>
    seg.speaker === undefined ? seg : { ...seg, speaker: rank.get(seg.speaker) ?? seg.speaker }
  )
}

export async function transcribeInCloud(
  audio: Float32Array,
  opts: CloudTranscribeOptions
): Promise<CloudHeard | null> {
  const token = opts.token.trim()
  if (!token) return null

  const chunks = Math.max(1, Math.ceil(audio.length / CHUNK_SAMPLES))
  const all: TranscriptSegment[] = []
  // One engine per server in practice; a fallback mid-recording names both.
  const labels = new Set<string>()

  for (let i = 0; i < chunks; i++) {
    const start = i * CHUNK_SAMPLES
    const slice = audio.subarray(start, Math.min(start + CHUNK_SAMPLES, audio.length))
    // Where this chunk sits on the recording's clock.
    const offsetMs = Math.round((start / SAMPLE_RATE) * 1000)

    let res: Response
    try {
      res = await fetch(INGEST.transcribe, {
        method: 'POST',
        headers: { ...authHeaders(token), 'content-type': 'audio/wav' },
        body: encodeWav(slice),
        signal: opts.signal,
      })
    } catch {
      return null // offline, blocked, server down — ship without words
    }
    assertAuthorized(res)
    if (!res.ok) return null

    let payload: unknown
    try {
      payload = await res.json()
    } catch {
      return null
    }
    const segments = readSegments(payload)
    if (!segments) return null
    const label = readLabel(payload)
    if (label && segments.length) labels.add(label)

    for (const seg of normalizeSpeakers(segments)) all.push({ ...seg, t: seg.t + offsetMs })
    opts.onProgress?.((i + 1) / chunks)
  }

  return labels.size ? { segments: all, label: [...labels].join(' and ') } : { segments: all }
}
