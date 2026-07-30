import { pipeline, env, type ProgressInfo } from '@huggingface/transformers';

/**
 * Whisper, on-device, off the main thread. The panel's live dictation is Chrome's
 * Web Speech API — fast, but it drops words and stops listening on long silences.
 * This is the second pass: after recording stops, the webm's own audio goes through
 * whisper-small.en for the transcript that actually ships.
 *
 * MV3 forbids remote code, so the onnxruntime wasm is served from the extension
 * (public/ort, staged by scripts/copy-ort.mjs). Model *weights* are data, not code:
 * they download from huggingface.co on first use and transformers.js caches them.
 *
 * One job per worker lifetime — the caller terminates us when it has the answer.
 */

const MODEL_ID = 'onnx-community/whisper-small.en';

export interface WorkerIn {
  /** 16 kHz mono, transferred. */
  audio: Float32Array;
}

export type WorkerOut =
  | { type: 'progress'; stage: 'download' | 'model' | 'transcribe'; pct: number }
  | { type: 'done'; segments: { t: number; d?: number; text: string }[] }
  | { type: 'error'; message: string };

env.allowLocalModels = false;
// The extension's own origin, asked for by name rather than assembled: a worker
// spawned from the panel document has chrome.runtime, and getURL is the only
// thing that is right in both a packed extension and the preview harness.
env.backends.onnx.wasm!.wasmPaths =
  typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('ort/')
    : self.location.origin + '/ort/';

function post(msg: WorkerOut) {
  self.postMessage(msg);
}

/** Per-file download percentages; the bar is their mean. */
const filePct = new Map<string, number>();

function onModelProgress(info: ProgressInfo) {
  if (info.status === 'progress') {
    filePct.set(info.file, info.progress);
    let sum = 0;
    for (const pct of filePct.values()) sum += pct;
    post({ type: 'progress', stage: 'download', pct: sum / filePct.size });
  } else if (info.status === 'ready') {
    post({ type: 'progress', stage: 'model', pct: 100 });
  }
}

function build(device: 'webgpu' | 'wasm') {
  filePct.clear(); // a wasm retry must not average in the failed webgpu attempt's files
  return pipeline('automatic-speech-recognition', MODEL_ID, {
    device,
    dtype: 'q8',
    progress_callback: onModelProgress,
  });
}

async function transcribe(device: 'webgpu' | 'wasm', audio: Float32Array) {
  const asr = await build(device);
  post({ type: 'progress', stage: 'transcribe', pct: -1 });
  const out = await asr(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
  return (out.chunks ?? []).map((chunk) => {
    // Typed as a full pair, but whisper leaves the closing stamp null on a chunk
    // it never got to finish — the last one of a run, most often.
    const span = chunk.timestamp as [number, number | null] | undefined;
    const start = Math.round((span?.[0] ?? 0) * 1000);
    const close = span?.[1];
    const end = close == null ? null : Math.round(close * 1000);
    return {
      t: start,
      // A line covers the seconds it took to say — the report shows a window, not a point.
      ...(end && end > start ? { d: end - start } : {}),
      text: chunk.text.trim(),
    };
  });
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  try {
    let segments;
    try {
      segments = await transcribe('webgpu', e.data.audio);
    } catch (err) {
      // No WebGPU adapter, or the shaders blew up mid-inference — one retry on wasm.
      console.warn('[transcribe] webgpu failed, falling back to wasm', err);
      segments = await transcribe('wasm', e.data.audio);
    }
    post({ type: 'done', segments: segments.filter((s) => s.text) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
