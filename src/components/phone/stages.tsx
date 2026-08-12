// What the browser is doing, in the person's words. The pipeline reports ten
// stages; only seven of them are worth a line on a phone, so neighbours that
// read as one act (frames+sheets, declare+upload+finalize) share a row.
//
// The rows are honest about looping: with two clips the pipeline walks probe →
// polish once per clip, and the list walks back up with it rather than pretending
// the first pass finished the job.

import type { CaptureStage, StageProgress } from '~/lib/capture/types'
import { cn } from '~/lib/utils'

// The order is the pipeline's, and the pipeline puts the audio before the frames
// on purpose (distill.ts: the decode spike must not coexist with 600 JPEGs).
// These rows follow it, or the dots march backwards mid-clip.
export interface StageRow {
  label: string
  stages: CaptureStage[]
}

const ROWS: StageRow[] = [
  { label: 'reading clips', stages: ['probe'] },
  { label: 'reading the audio', stages: ['audio'] },
  { label: 'transcribing', stages: ['transcribe'] },
  { label: 'cleaning up wording', stages: ['polish'] },
  { label: 'distilling keyframes', stages: ['frames', 'sheets'] },
  { label: 'building the report', stages: ['build'] },
  { label: 'uploading', stages: ['declare', 'upload', 'finalize'] },
]

/**
 * `/record`'s rows. Same pipeline minus its first step: a take's keyframes were
 * kept live as it recorded, so nothing is ever read off a picked clip and a
 * "reading clips" row would sit dark for the whole run. The keyframes row stays
 * — the frames still have to come back off disk and become contact sheets.
 */
export const RECORD_ROWS: StageRow[] = ROWS.filter((row) => !row.stages.includes('probe'))

/**
 * A human handback's rows: no keyframes and no report — the video is the
 * deliverable and nothing is distilled from it. What remains is the transcript
 * work and the upload. (The pipeline never emits `frames`/`sheets`/`build` on
 * this path, so the rows go too — a permanently dark row reads as stuck.)
 */
export const HUMAN_RECORD_ROWS: StageRow[] = RECORD_ROWS.filter(
  (row) => !row.stages.includes('frames') && !row.stages.includes('build')
)

/** The stages past which cancelling would leave a half-declared walkthrough behind. */
const COMMITTED: CaptureStage[] = ['declare', 'upload', 'finalize']

export function isCommitted(progress: StageProgress | null): boolean {
  return progress !== null && COMMITTED.includes(progress.stage)
}

export function StageList({
  progress,
  rows = ROWS,
}: {
  progress: StageProgress | null
  rows?: StageRow[]
}) {
  const current = progress ? rows.findIndex((row) => row.stages.includes(progress.stage)) : -1

  return (
    <ul className="divide-border divide-y">
      {rows.map((row, i) => {
        const active = i === current
        const done = current > i
        return (
          <li
            key={row.label}
            className={cn(
              'flex items-center gap-3 py-2.5 font-mono text-sm',
              active ? 'text-foreground' : 'text-muted-foreground'
            )}>
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                done ? 'bg-approve' : active ? 'bg-cobalt' : 'border-border border'
              )}
            />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            {/* The detail is where it is up to; the percentage is how far that
                is through the whole run. A row that can say both says both —
                a lone percentage is what makes a long stage look wedged. */}
            {active && progress && (
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {progress.detail ?? ''}
                {progress.detail && progress.pct >= 0 && ' · '}
                {progress.pct >= 0 && `${Math.round(progress.pct * 100)}%`}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
