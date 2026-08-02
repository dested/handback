import { assertAuthorized, authHeaders, INGEST } from './api'
import type { TranscriptSegment } from './types'

/**
 * Ported from `extension/src/sidepanel/polish.ts`. The pass after transcription:
 * the server reads the lines back and fixes what a speech engine can't know —
 * product nouns, library names, acronyms, sentence breaks.
 *
 * It edits text only. Timings stay exactly as the transcriber reported them, so
 * the timeline, the frames and the report all still line up; the response is
 * checked to be the same length before a single line is replaced.
 *
 * Null on any failure (the 503 from a server with no ANTHROPIC_API_KEY
 * included) — a cleanup pass that can lose a transcript is worse than no
 * cleanup pass, so every path out of here that isn't a clean answer leaves the
 * caller holding the original lines. A dead token still throws.
 */

const MAX_LINES = 4000

const responseShape = (value: unknown, expected: number): string[] | null => {
  if (typeof value !== 'object' || value === null) return null
  const lines = (value as { lines?: unknown }).lines
  if (!Array.isArray(lines) || lines.length !== expected) return null
  const out: string[] = []
  for (const raw of lines) {
    if (typeof raw !== 'object' || raw === null) return null
    const { text } = raw as { text?: unknown }
    if (typeof text !== 'string') return null
    out.push(text)
  }
  return out
}

export interface PolishOptions {
  token: string
  signal?: AbortSignal
}

export async function polishTranscript(
  segments: TranscriptSegment[],
  opts: PolishOptions
): Promise<TranscriptSegment[] | null> {
  const token = opts.token.trim()
  if (!token) return null
  if (segments.length === 0 || segments.length > MAX_LINES) return null

  let res: Response
  try {
    res = await fetch(INGEST.polish, {
      method: 'POST',
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      // No origin and no errors: a phone clip was recorded against whatever the
      // human was holding, and nothing tapped its console.
      body: JSON.stringify({
        lines: segments.map((s) => ({ text: s.text })),
        context: { errors: [] },
      }),
      signal: opts.signal,
    })
  } catch {
    return null
  }
  assertAuthorized(res)
  if (!res.ok) return null

  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    return null
  }
  const lines = responseShape(payload, segments.length)
  if (!lines) return null

  // Spread the original first: `t` and `d` survive untouched, and only `text`
  // is taken from the answer.
  return segments.map((seg, i) => ({ ...seg, text: lines[i] ?? seg.text }))
}
