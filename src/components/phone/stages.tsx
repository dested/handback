// What the browser is doing, in the person's words. The pipeline reports ten
// stages; only seven of them are worth a line on a phone, so neighbours that
// read as one act (frames+sheets, declare+upload+finalize) share a row.
//
// The rows are honest about looping: with two clips the pipeline walks probe →
// polish once per clip, and the list walks back up with it rather than pretending
// the first pass finished the job.

import type { CaptureStage, StageProgress } from '~/lib/capture/types'
import { cn } from '~/lib/utils'

const ROWS: { label: string; stages: CaptureStage[] }[] = [
  { label: 'reading clips', stages: ['probe'] },
  { label: 'distilling keyframes', stages: ['frames', 'sheets'] },
  { label: 'reading the audio', stages: ['audio'] },
  { label: 'transcribing', stages: ['transcribe'] },
  { label: 'cleaning up wording', stages: ['polish'] },
  { label: 'building the report', stages: ['build'] },
  { label: 'uploading', stages: ['declare', 'upload', 'finalize'] },
]

/** The stages past which cancelling would leave a half-declared walkthrough behind. */
const COMMITTED: CaptureStage[] = ['declare', 'upload', 'finalize']

export function isCommitted(progress: StageProgress | null): boolean {
  return progress !== null && COMMITTED.includes(progress.stage)
}

export function StageList({ progress }: { progress: StageProgress | null }) {
  const current = progress ? ROWS.findIndex((row) => row.stages.includes(progress.stage)) : -1

  return (
    <ul className="divide-border divide-y">
      {ROWS.map((row, i) => {
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
            {active && progress && (
              <span className="text-muted-foreground shrink-0 text-xs">
                {progress.pct >= 0 ? `${Math.round(progress.pct * 100)}%` : (progress.detail ?? '')}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
