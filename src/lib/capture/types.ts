/**
 * The capture pipeline's vocabulary. Two halves:
 *
 * 1. The public surface the phone UI codes against — stages, progress, the
 *    result of a distill run.
 * 2. The recording shapes ported from the recorder extension
 *    (`extension/src/lib/types.ts`). They are copied rather than imported
 *    because `extension/` is a separate npm workspace, and they must not drift:
 *    the report, the per-take JSON, the declare body and the cloud viewer all
 *    read exactly these fields.
 */

// ── the public surface ─────────────────────────────────────────────────────

export type CaptureStage =
  | 'probe'
  | 'frames'
  | 'sheets'
  | 'audio'
  | 'transcribe'
  | 'polish'
  | 'build'
  | 'declare'
  | 'upload'
  | 'finalize'

export interface StageProgress {
  stage: CaptureStage
  /** 0..1 across the whole run. -1 = indeterminate (no meaningful fraction). */
  pct: number
  detail?: string
}

/** One recorded file the human picked. */
export interface ClipInput {
  file: File
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

// ── the recording shapes (ported, frozen) ──────────────────────────────────

export interface PageEvent {
  level: 'error' | 'warn' | 'network'
  message: string
  detail?: string
  ts: number
}

/**
 * Which engine wrote the transcript that shipped. Only `groq` occurs here —
 * there is no on-device pass on a phone — but the field is the report's, and
 * the report knows all of them.
 */
export type TranscriberId = 'whisper' | 'groq'

export interface TranscriptSegment {
  /** ms from recording start — where the speaker *started* the line */
  t: number
  /** Spoken length in ms when the transcriber reported one. A line covers a window, not an instant. */
  d?: number
  /** Position on the walkthrough's unified axis, ms. Set only when a human moved it; absent = computed from t. */
  tl?: number
  text: string
}

/** The pointer as it applies to one keyframe. Never set on this path — a phone clip has no mouse. */
export interface FramePointer {
  nx?: number
  ny?: number
  selector?: string
  text?: string
}

export interface RecordingFrame {
  index: number
  /** ms from recording start */
  t: number
  /** Path relative to the take dir, e.g. frames/03-0125.jpg */
  file: string
  /**
   * Why this frame exists. A phone clip only ever produces `start`, `change`
   * and `beat` — there are no clicks or navigations to force one — but the
   * union stays whole so a reader of this shape is the reader of the
   * extension's.
   */
  reason: 'start' | 'change' | 'click' | 'nav' | 'beat'
  /** Changed-cell count (of 64×64) vs the closest of the last kept frames (absent on the first). */
  dist?: number
  pointer?: FramePointer
  tl?: number
}

export interface RecordingMeta {
  startedAt: number
  durationMs: number
  /** Candidate frames examined; frames[] is what survived dedup. */
  sampled: number
  frames: RecordingFrame[]
  transcript: TranscriptSegment[]
  transcriber?: TranscriberId
  /** The server's cleanup pass rewrote the wording. Timings are the transcriber's either way. */
  polished?: boolean
  rev?: number
  reviewed?: boolean
  events: PageEvent[]
  eventScope?: string
  droppedEvents?: number
  /** The take's video, named for the container it actually arrived in. */
  videoFile: string
}

/** One take. A walkthrough is one or more of them laid end to end on one clock. */
export interface Recording {
  id: string
  sessionId: string
  /** 1-based part number; names the rec-NN folder. */
  index: number
  createdAt: number
  state: 'recording' | 'done'
  interrupted?: boolean
  mime: string
  chunks: number
  meta: RecordingMeta
}

export interface Session {
  id: string
  name: string
  slug: string
  createdAt: number
  updatedAt: number
  origin: string
  recCount: number
  closed?: boolean
  uploadedUrl?: string
  projectId?: string
  projectName?: string
}

/** Contact sheet shape. The sheet builder and the report that cites the sheets must agree. */
export const GRID_COLS = 3
export const GRID_ROWS = 3
export const GRID_PER_SHEET = GRID_COLS * GRID_ROWS
