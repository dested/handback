import type { PageEvent, TranscriptSegment } from '../lib/types';

/**
 * The pass after transcription: the workspace reads the lines back against the
 * page they were recorded on and fixes what a speech engine can't know — the
 * product's own nouns, the library names, the acronyms, the sentence breaks.
 *
 * It edits text only. Timings stay exactly as the transcriber reported them, so
 * the timeline, the frames, and the report all still line up; the response is
 * checked to be the same length before a single line is replaced.
 *
 * Null on any failure. A cleanup pass that can lose a transcript is worse than
 * no cleanup pass, so every path out of here that isn't a clean answer leaves
 * the caller holding the original lines.
 */

const MAX_ERRORS = 20;
const MAX_LINES = 4000;

export interface PolishOptions {
  serverUrl: string;
  apiToken: string;
  /** The recorded tab's origin — the single most useful hint about product nouns. */
  origin?: string;
  /** What the page complained about while recording. */
  events?: PageEvent[];
}

const responseShape = (value: unknown, expected: number): string[] | null => {
  if (typeof value !== 'object' || value === null) return null;
  const lines = (value as { lines?: unknown }).lines;
  if (!Array.isArray(lines) || lines.length !== expected) return null;
  const out: string[] = [];
  for (const raw of lines) {
    if (typeof raw !== 'object' || raw === null) return null;
    const { text } = raw as { text?: unknown };
    if (typeof text !== 'string') return null;
    out.push(text);
  }
  return out;
};

export async function polishTranscript(
  segments: TranscriptSegment[],
  opts: PolishOptions,
): Promise<TranscriptSegment[] | null> {
  const base = opts.serverUrl.trim().replace(/\/+$/, '');
  const token = opts.apiToken.trim();
  if (!base || !token) return null;
  if (segments.length === 0 || segments.length > MAX_LINES) return null;

  // Network noise is repetitive and rarely names anything; console errors carry
  // the identifiers worth spelling right.
  const errors = (opts.events ?? [])
    .filter((e) => e.level !== 'network')
    .slice(-MAX_ERRORS)
    .map((e) => (e.detail ? `${e.message} — ${e.detail}` : e.message));

  let res: Response;
  try {
    res = await fetch(`${base}/api/ingest/polish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        lines: segments.map((s) => ({ text: s.text })),
        context: { origin: opts.origin, errors },
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return null;
  }
  const lines = responseShape(payload, segments.length);
  if (!lines) return null;

  // Spread the original first: `t`, `d`, and any `tl` a human already dragged
  // survive untouched, and only `text` is taken from the answer.
  return segments.map((seg, i) => ({ ...seg, text: lines[i] ?? seg.text }));
}
