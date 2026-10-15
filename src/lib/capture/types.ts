/**
 * The capture pipeline's vocabulary. Two halves:
 *
 * 1. The public surface the capture pages code against — stages, progress,
 *    the result of a run that ends in an upload.
 * 2. The recording shapes, which are @dested/video-to-prompt's: the library
 *    builds the report, the per-take JSON and the sheets, and the declare body
 *    and the cloud viewer read the same fields, so they are re-exported here
 *    rather than copied.
 *
 * The generic pipeline (probe, frames, sheets, audio, report, format) lives in
 * the library (decisions.md 2026-10-15). What stays in this folder is
 * Handback's own: the ingest API clients (transcribe, polish, context,
 * upload), the pending-run store, and the /record live recorder, which the
 * extension shares and which keeps its own frame rule for now.
 */

import type { ClipProbe, DistillStage } from '@dested/video-to-prompt'

export type {
  ClipProbe,
  FramePointer,
  PageEvent,
  Recording,
  RecordingFrame,
  RecordingMeta,
  Session,
  TranscriberId,
  TranscriptSegment,
} from '@dested/video-to-prompt'

// ── the public surface ─────────────────────────────────────────────────────

/** The library's stages, then the three the upload adds. */
export type CaptureStage = DistillStage | 'declare' | 'upload' | 'finalize'

export interface StageProgress {
  stage: CaptureStage
  /** 0..1 across the whole run. -1 = indeterminate (no meaningful fraction). */
  pct: number
  detail?: string
}

/**
 * One recorded file the human picked. `probe` is the read the picker already
 * did: on iOS, readying a blob-URL video costs the better part of a minute, so
 * a caller that has one hands it over rather than making the pipeline pay twice.
 */
export interface ClipInput {
  file: File
  probe?: ClipProbe
}

export interface DistillResult {
  walkthroughId: string
  /** Relative — the UI links internally. */
  url: string
  frameCount: number
  lineCount: number
  durationMs: number
  transcribed: boolean
  polished: boolean
}

/** The token this phone holds is no longer good. Everything else is a plain Error. */
export class AuthError extends Error {}
