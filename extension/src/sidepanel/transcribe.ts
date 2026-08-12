import type { TranscriberId, TranscriptSegment } from '../lib/types';
import { transcribeInCloud } from './transcribeCloud';
import type { WorkerIn, WorkerOut } from './transcribeWorker';

/**
 * Main-thread half of the post-recording transcription pass: decode the webm's
 * audio to a 16 kHz mono Float32Array, then get words out of it. The caller
 * hands in the mic-only shadow when the take has one (a take with system audio
 * mixed into its video must not have that mix transcribed); the video webm
 * itself otherwise — decodeAudioData doesn't care which.
 *
 * Two engines share that decode. By default the audio goes to the workspace and
 * comes back transcribed in seconds. On-device Whisper is the fallback — when
 * the upload fails, when there's no token, or when the user has asked for it
 * because the audio must not leave the machine. It's the same model family,
 * minutes slower, and it runs the laptop hot; that's the trade being made.
 *
 * Every failure resolves to null: a missing transcript must never sink a saved
 * walkthrough.
 */

const SAMPLE_RATE = 16000;
/** Peak below this is silence, and Whisper hallucinates sentences out of silence. */
const SILENCE_FLOOR = 0.001;
const TIMEOUT_MS = 15 * 60 * 1000;

export interface TranscribeProgress {
  stage: 'decode' | 'upload' | 'download' | 'model' | 'transcribe' | 'polish';
  pct: number;
}

export interface TranscribeResult {
  segments: TranscriptSegment[];
  /** Which engine actually produced these — the report cites it. */
  engine: TranscriberId;
}

export async function transcribeRecording(
  media: Blob,
  opts: { serverUrl: string; apiToken: string; lang: string; onDevice: boolean },
  onProgress: (p: TranscribeProgress) => void,
): Promise<TranscribeResult | null> {
  onProgress({ stage: 'decode', pct: -1 }); // decoding takes real time on long recordings
  const audio = await decode(media).catch(() => null);
  if (!audio) return null;

  if (!opts.onDevice && opts.apiToken) {
    onProgress({ stage: 'upload', pct: 0 });
    const cloud = await transcribeInCloud(audio, {
      serverUrl: opts.serverUrl,
      apiToken: opts.apiToken,
      lang: opts.lang,
      onProgress: (fraction) => onProgress({ stage: 'upload', pct: fraction * 100 }),
    }).catch(() => null);
    // A non-null answer is the answer, empty included: an empty transcript means
    // the speech engine heard nothing, and grinding through a local pass to hear
    // the same nothing is the worst of both paths.
    if (cloud) return { segments: cloud, engine: 'groq' };
  }

  const segments = await run(audio, onProgress).catch(() => null);
  return segments ? { segments, engine: 'whisper' } : null;
}

/**
 * Mixdown to mono at 16 kHz. Null when there's no decodable audio, or it's silent.
 * Offline, not a live AudioContext: this runs once per take with nothing to play,
 * and an OfflineAudioContext resamples in `decodeAudioData` all the same without
 * claiming an output device or tripping the autoplay policy in a side panel.
 */
async function decode(media: Blob): Promise<Float32Array<ArrayBuffer> | null> {
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  try {
    // A mic-denied recording has no audio track at all, and decoding throws.
    const buf = await ctx.decodeAudioData(await media.arrayBuffer());
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const channel = buf.getChannelData(c);
      for (let i = 0; i < channel.length; i++) mono[i] += channel[i];
    }
    if (buf.numberOfChannels > 1) {
      for (let i = 0; i < mono.length; i++) mono[i] /= buf.numberOfChannels;
    }
    for (let i = 0; i < mono.length; i++) {
      if (Math.abs(mono[i]) > SILENCE_FLOOR) return mono;
    }
    return null;
  } catch {
    return null;
  }
}

function run(
  audio: Float32Array<ArrayBuffer>,
  onProgress: (p: TranscribeProgress) => void,
): Promise<TranscriptSegment[] | null> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./transcribeWorker.ts', import.meta.url), {
      type: 'module',
    });
    let settled = false;
    const finish = (segments: TranscriptSegment[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(segments);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);

    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type === 'progress') onProgress({ stage: msg.stage, pct: msg.pct });
      else if (msg.type === 'done') finish(msg.segments);
      else finish(null);
    };
    worker.onerror = () => finish(null);
    worker.onmessageerror = () => finish(null);

    const job: WorkerIn = { audio };
    worker.postMessage(job, [audio.buffer]);
  });
}
