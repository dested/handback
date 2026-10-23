// Shapes the viewer works with. The walkthrough itself comes from tRPC (so its type
// is inferred, never restated); each take's detail comes from the recorder's
// own `rec-NN/recording.json`, fetched straight from S3 — that file is written
// by the recorder extension, so its shape is declared by hand here.

import type { FrameBox } from '@dested/video-to-prompt'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../server/router'

type Outputs = inferRouterOutputs<AppRouter>

export type Walkthrough = Outputs['walkthroughs']['get']
export type Take = Walkthrough['takes'][number]

export type WalkthroughStatus = 'open' | 'in_review' | 'needs_info' | 'resolved'

/** One deduped keyframe. `file` is take-relative, e.g. `frames/03-0125.jpg`. */
export type Frame = {
  index: number
  at: string
  tMs: number
  file: string
  reason: string
  pointer?: { x: number; y: number } | null
  /** How long this state stayed on screen, ms. */
  held?: number
  /** The screen went back to how it was before after `held` (a toast, a hover). */
  transient?: boolean
  /** Other take-local spans [from, to) when this frame is what was on screen (library 1.2+). */
  seenMs?: Array<[number, number]>
  /**
   * A close-up, not the whole screen (library 1.2+): the screen then was frame
   * `of` (its `index`, same take) except inside `box`, and this image shows
   * `box` at its own resolution.
   */
  detail?: { of: number; box: FrameBox }
}

/** One spoken window. `tMs`/`endMs` are take-local milliseconds. */
export type TranscriptLine = {
  at: string
  tMs: number
  endMs: number
  text: string
  /** 1-based speaker rank (1 = most talk time); absent when diarization didn't run. */
  speaker?: number
}

export type TakeEvent = {
  level: string
  at: string
  message: string
  detail?: unknown
}

export type TakeRecording = {
  recording: {
    frames: Frame[]
    transcript: TranscriptLine[]
    events: TakeEvent[]
  }
}
