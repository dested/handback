// Shapes the viewer works with. The gripe itself comes from tRPC (so its type
// is inferred, never restated); each take's detail comes from the recorder's
// own `rec-NN/recording.json`, fetched straight from S3 — that file is written
// by the Gripe extension, so its shape is declared by hand here.

import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../server/router'

type Outputs = inferRouterOutputs<AppRouter>

export type Gripe = Outputs['gripes']['get']
export type Take = Gripe['takes'][number]

export type GripeStatus = 'open' | 'in_review' | 'resolved'

/** One deduped keyframe. `file` is take-relative, e.g. `frames/03-0125.jpg`. */
export type Frame = {
  index: number
  at: string
  tMs: number
  file: string
  reason: string
  pointer?: { x: number; y: number } | null
}

/** One spoken window. `tMs`/`endMs` are take-local milliseconds. */
export type TranscriptLine = {
  at: string
  tMs: number
  endMs: number
  text: string
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
