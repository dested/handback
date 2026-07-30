import type { TranscriptSegment } from '../lib/types';
import type { WorkerIn, WorkerOut } from './transcribeWorker';

/**
 * Main-thread half of the post-recording transcription pass: decode the webm's
 * audio to the 16 kHz mono Float32Array Whisper wants, hand it to the worker,
 * and report progress. Every failure — no mic track, no model, a wedged run —
 * resolves to null; a missing transcript must never sink a saved walkthrough.
 */

const SAMPLE_RATE = 16000;
/** Peak below this is silence, and Whisper hallucinates sentences out of silence. */
const SILENCE_FLOOR = 0.001;
const TIMEOUT_MS = 15 * 60 * 1000;

export interface TranscribeProgress {
  stage: 'decode' | 'download' | 'model' | 'transcribe';
  pct: number;
}

export async function transcribeRecording(
  video: Blob,
  onProgress: (p: TranscribeProgress) => void,
): Promise<TranscriptSegment[] | null> {
  onProgress({ stage: 'decode', pct: -1 }); // decoding takes real time on long recordings
  const audio = await decode(video).catch(() => null);
  if (!audio) return null;
  return run(audio, onProgress).catch(() => null);
}

/**
 * Mixdown to mono at 16 kHz. Null when there's no decodable audio, or it's silent.
 * Offline, not a live AudioContext: this runs once per take with nothing to play,
 * and an OfflineAudioContext resamples in `decodeAudioData` all the same without
 * claiming an output device or tripping the autoplay policy in a side panel.
 */
async function decode(video: Blob): Promise<Float32Array<ArrayBuffer> | null> {
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  try {
    // A mic-denied recording has no audio track at all, and decoding throws.
    const buf = await ctx.decodeAudioData(await video.arrayBuffer());
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
