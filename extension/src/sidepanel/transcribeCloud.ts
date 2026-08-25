import type { TranscriptSegment } from '../lib/types';

/**
 * The fast path: send the decoded audio to the workspace and let it transcribe.
 * Seconds instead of the minutes on-device Whisper takes, and the user's laptop
 * stays cool — see plans/2026-07-30-transcription.md.
 *
 * The audio arrives here already decoded to the 16 kHz mono Float32Array the
 * on-device worker wanted, so both engines share one decode. We wrap it as WAV
 * (the one container every speech API accepts without a codec) and post it to
 * `/api/ingest/transcribe` with the panel's own hb_ token. No provider key ever
 * reaches the extension.
 *
 * Long takes are split here rather than server-side: 16-bit PCM runs ~1.9 MB per
 * minute, so a half-hour walkthrough would blow past any upload limit in one
 * piece. We cut on a fixed window and offset each chunk's timings back onto the
 * recording's own clock, which only the caller can do correctly.
 */

const SAMPLE_RATE = 16000;
/** ~15 MB per chunk at 16 kHz/16-bit — comfortably inside the endpoint's 30 MB cap. */
const CHUNK_SECONDS = 8 * 60;
const CHUNK_SAMPLES = CHUNK_SECONDS * SAMPLE_RATE;

export interface CloudTranscribeOptions {
  serverUrl: string;
  apiToken: string;
  /** Narration language as a BCP-47 tag; only the leading two letters are sent. */
  lang?: string;
  /** 0–1 across the whole recording, so a long take shows real movement. */
  onProgress?: (fraction: number) => void;
}

const responseShape = (value: unknown): TranscriptSegment[] | null => {
  if (typeof value !== 'object' || value === null) return null;
  const segments = (value as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) return null;
  const out: TranscriptSegment[] = [];
  for (const raw of segments) {
    if (typeof raw !== 'object' || raw === null) return null;
    const { t, d, text, speaker } = raw as {
      t?: unknown;
      d?: unknown;
      text?: unknown;
      speaker?: unknown;
    };
    if (typeof t !== 'number' || typeof text !== 'string') return null;
    const base = typeof d === 'number' ? { t, d, text } : { t, text };
    out.push(typeof speaker === 'number' ? { ...base, speaker } : base);
  }
  return out;
};

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
  if (!segments.some((s) => s.speaker !== undefined)) return segments;
  const talk = new Map<number, number>();
  for (const seg of segments) {
    if (seg.speaker === undefined) continue;
    talk.set(seg.speaker, (talk.get(seg.speaker) ?? 0) + (seg.d ?? 3000));
  }
  const ranked = [...talk.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const rank = new Map<number, number>();
  ranked.forEach(([raw], i) => rank.set(raw, i + 1));
  return segments.map((seg) =>
    seg.speaker === undefined ? seg : { ...seg, speaker: rank.get(seg.speaker) ?? seg.speaker },
  );
}

/**
 * Null on any failure — a missing cloud transcript is never fatal, the caller
 * falls back to the on-device pass. Throwing here would only mean catching there.
 */
export async function transcribeInCloud(
  audio: Float32Array,
  opts: CloudTranscribeOptions,
): Promise<TranscriptSegment[] | null> {
  const base = opts.serverUrl.trim().replace(/\/+$/, '');
  const token = opts.apiToken.trim();
  if (!base || !token) return null;

  // Two letters is what the API takes; `en-US` and `en` mean the same thing to it.
  const lang = opts.lang?.trim().slice(0, 2).toLowerCase();
  const query = lang && /^[a-z]{2}$/.test(lang) ? `?language=${lang}` : '';
  const url = `${base}/api/ingest/transcribe${query}`;

  const chunks = Math.max(1, Math.ceil(audio.length / CHUNK_SAMPLES));
  const all: TranscriptSegment[] = [];

  for (let i = 0; i < chunks; i++) {
    const start = i * CHUNK_SAMPLES;
    const slice = audio.subarray(start, Math.min(start + CHUNK_SAMPLES, audio.length));
    // Where this chunk sits on the recording's clock.
    const offsetMs = Math.round((start / SAMPLE_RATE) * 1000);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/wav' },
        body: encodeWav(slice),
      });
    } catch {
      return null; // offline, blocked, server down — take the slow path
    }
    if (!res.ok) return null;

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      return null;
    }
    const segments = responseShape(payload);
    if (!segments) return null;

    for (const seg of normalizeSpeakers(segments)) all.push({ ...seg, t: seg.t + offsetMs });
    opts.onProgress?.((i + 1) / chunks);
  }

  return all;
}

/**
 * Float32 mono → a 16-bit PCM WAV blob. Hand-rolled because the platform has no
 * encoder and the format's 44-byte header is shorter than any dependency.
 */
function encodeWav(samples: Float32Array): Blob {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format: uncompressed PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, bytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling: decoded audio can overshoot ±1 and wrap into noise.
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
