import { pad2, mmssFile } from './format'
import {
  hiddenVideo,
  LOAD_TIMEOUT_MS,
  releaseVideo,
  seekTo,
  toJpeg,
  UNREADABLE,
  waitFor,
} from './media'
import type { RecordingFrame } from './types'

/**
 * The recorder's dedup, run after the fact. `extension/src/sidepanel/recorder.ts`
 * samples a live screen share every 500 ms and decides keep/drop as it goes;
 * here the recording already exists, so the same decision is made by seek-stepping
 * the file. Every constant and the keep/drop rule are that file's, unchanged —
 * a walkthrough distilled on a phone has to look like one distilled in Chrome.
 *
 * What is *not* ported: forced keyframes. A phone clip has no clicks, no
 * navigations and no page events to force one, so the only reasons here are
 * 'start', 'change' and 'beat'.
 */

const SAMPLE_MS = 500 // candidate cadence — the recorder's live sampling interval
const SIG_SIZE = 64 // 64×64 RGB cells — fine enough that a sprite-sized change still flips whole cells
const PIX_TOL = 25 // a cell counts as changed if any channel moves more than this
const DEDUP_THRESHOLD = 8 // cells that must change for a frame to be new (~0.2% of 4096)
const DEDUP_WINDOW = 4 // vs the last N KEPT frames — A-B-A cutaways don't come back
const BEAT_MS = 15000 // a minute of narration over a slowly-shifting screen must not produce zero frames
const FRAMES_PER_MIN = 40
const MIN_FRAME_BUDGET = 150
const MAX_FRAME_BUDGET = 600
const MAX_FRAME_W = 1920
const JPEG_QUALITY = 0.9
/**
 * A live recorder pays 500 ms of wall clock per candidate; a seek-step pays a
 * decode, and an hour-long phone clip at 500 ms is 7200 of them. Cap the
 * candidate count and let the step stretch — the budget below thins the result
 * to the same shape either way.
 */
const MAX_CANDIDATES = 1800

/** How many keyframes a take of this length may keep after dedup. Uniform thinning
 *  past this point, so survivors stay spread across the whole recording. */
export function frameBudget(durationMs: number): number {
  const byLength = Math.round((durationMs / 60000) * FRAMES_PER_MIN)
  return Math.min(MAX_FRAME_BUDGET, Math.max(MIN_FRAME_BUDGET, byLength))
}

/**
 * Count of cells whose max channel delta exceeds PIX_TOL — the reference's
 * pct_diff, kept as a count.
 */
function cellDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const cells = SIG_SIZE * SIG_SIZE
  let changed = 0
  for (let i = 0; i < cells; i++) {
    const p = i * 4
    const d = Math.max(
      Math.abs(a[p] - b[p]),
      Math.abs(a[p + 1] - b[p + 1]),
      Math.abs(a[p + 2] - b[p + 2])
    )
    if (d > PIX_TOL) changed++
  }
  return changed
}

export interface ExtractOptions {
  /** 0..1 through this clip. */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export interface ExtractedFrames {
  /** Post-thin, renumbered 1..N. */
  frames: RecordingFrame[]
  /** JPEG per surviving frame, keyed by its final index. Held in memory — a phone clip is one-shot. */
  blobs: Map<number, Blob>
  /** Candidates examined. The MANIFEST reports it. */
  sampled: number
}

export async function extractFrames(
  file: Blob,
  durationMs: number,
  opts: ExtractOptions = {}
): Promise<ExtractedFrames> {
  const frames: RecordingFrame[] = []
  const blobs = new Map<number, Blob>()
  let sampled = 0
  if (durationMs <= 0) return { frames, blobs, sampled }

  const url = URL.createObjectURL(file)
  const video = hiddenVideo(url)
  try {
    await waitFor(video, ['loadeddata'], LOAD_TIMEOUT_MS, UNREADABLE)

    const sigCanvas = document.createElement('canvas')
    sigCanvas.width = SIG_SIZE
    sigCanvas.height = SIG_SIZE
    const sigCtx = sigCanvas.getContext('2d', { willReadFrequently: true })
    const frameCtx = document.createElement('canvas').getContext('2d')
    if (!sigCtx || !frameCtx) throw new Error("couldn't read frames from that video")
    frameCtx.imageSmoothingQuality = 'high'

    /** Signatures of the KEPT frames only — that ring *is* the dedup window. */
    const sigs: Uint8ClampedArray[] = []
    let lastKeptT = 0
    const stepMs = Math.max(SAMPLE_MS, Math.ceil(durationMs / MAX_CANDIDATES))

    for (let t = 0; t < durationMs; t += stepMs) {
      if (opts.signal?.aborted) throw new Error('cancelled')
      await seekTo(video, t / 1000, "couldn't read frames from that video")
      opts.onProgress?.(t / durationMs)
      if (!video.videoWidth || !video.videoHeight) continue

      sampled++
      sigCtx.drawImage(video, 0, 0, SIG_SIZE, SIG_SIZE)
      const sig = sigCtx.getImageData(0, 0, SIG_SIZE, SIG_SIZE).data

      const minDist = sigs.length ? Math.min(...sigs.map((k) => cellDiff(sig, k))) : undefined
      let reason: RecordingFrame['reason']
      if (minDist === undefined) {
        reason = 'start'
      } else if (minDist <= DEDUP_THRESHOLD) {
        // Below the bar, but the screen *is* moving and nothing has been kept in
        // a while — a drifting low-contrast UI would otherwise go dark for minutes.
        if (!(minDist > 0 && t - lastKeptT > BEAT_MS)) continue
        reason = 'beat'
      } else {
        reason = 'change'
      }
      const dist = minDist // changed-cell count vs the closest kept frame

      const width = Math.min(video.videoWidth, MAX_FRAME_W)
      const height = Math.round((video.videoHeight * width) / video.videoWidth)
      const canvas = frameCtx.canvas
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        frameCtx.imageSmoothingQuality = 'high'
      }
      frameCtx.drawImage(video, 0, 0, width, height)

      const index = frames.length + 1
      blobs.set(index, await toJpeg(canvas, JPEG_QUALITY))
      frames.push({
        index,
        t,
        file: `frames/${pad2(index)}-${mmssFile(t)}.jpg`,
        reason,
        ...(dist === undefined ? {} : { dist }),
      })
      lastKeptT = t
      sigs.push(sig)
      if (sigs.length > DEDUP_WINDOW) sigs.shift()
    }
    opts.onProgress?.(1)
  } finally {
    releaseVideo(video)
    URL.revokeObjectURL(url)
  }

  return thin(frames, blobs, sampled, durationMs)
}

/**
 * The recorder's `finish()` pass. A uniform thin: survivors stay spread across
 * the whole clip, so nothing is protected from it and nothing gets a run of
 * neighbours it doesn't earn. Survivors renumber ascending; `t` is untouched, so
 * transcript citations stay valid.
 */
function thin(
  frames: RecordingFrame[],
  blobs: Map<number, Blob>,
  sampled: number,
  durationMs: number
): ExtractedFrames {
  const allowed = frameBudget(durationMs)
  if (frames.length <= allowed) return { frames, blobs, sampled }

  const keepIdx = new Set<number>()
  const step = frames.length / allowed
  for (let i = 0; i < allowed; i++) keepIdx.add(Math.floor(i * step))
  const survivors = frames.filter((_, i) => keepIdx.has(i))

  const kept = new Map<number, Blob>()
  survivors.forEach((frame, n) => {
    const blob = blobs.get(frame.index)
    frame.index = n + 1
    frame.file = `frames/${pad2(frame.index)}-${mmssFile(frame.t)}.jpg`
    if (blob) kept.set(frame.index, blob)
  })
  return { frames: survivors, blobs: kept, sampled }
}
