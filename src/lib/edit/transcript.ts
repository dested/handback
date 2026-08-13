// transcript.json, on the EDITED clock.
//
// Both editors write it — the /record one from takes that never left the
// machine, the viewer's one from takes that were uploaded raw — and the
// FinalCut player reads exactly this shape. One function, so a line can't mean
// one thing on one path and another on the other.

import type { TranscriptSegment } from '../capture/types'
import { sourceToOutputMs, type EditSegment, type EditState } from './edl'

/** A line as `transcript.json` carries it. `tMs`/`endMs` are output-timeline ms. */
export interface EditedTranscriptLine {
  /** Wall-clock ISO of when it was actually said — the only original timing kept. */
  at: string
  tMs: number
  endMs: number
  text: string
}

/** One take, as far as the transcript is concerned. */
export interface TranscriptSource {
  /** Whatever ids the EditState's `takeOrder` and cuts are keyed by. */
  id: string
  /** Epoch ms the take started, for the wall-clock stamp. */
  startedAt: number
  transcript: TranscriptSegment[]
}

/** A line with no reported length still covers a window; this is that guess. */
const ASSUMED_LINE_MS = 1500

/**
 * The surviving lines, moved onto the edited timeline. A line whose start was
 * cut is gone — its words are not in the video, and a transcript that says
 * otherwise would lie to the person scrubbing by it.
 */
export function editedTranscriptLines(
  takes: TranscriptSource[],
  state: EditState,
  segments: EditSegment[],
  durationMs: number
): EditedTranscriptLine[] {
  const byId = new Map(takes.map((t) => [t.id, t]))
  const lines: EditedTranscriptLine[] = []
  for (const takeId of state.takeOrder) {
    const take = byId.get(takeId)
    if (!take) continue
    for (const line of take.transcript) {
      const out = sourceToOutputMs(segments, takeId, line.t)
      if (out === null) continue
      lines.push({
        at: new Date(take.startedAt + line.t).toISOString(),
        tMs: Math.round(out),
        endMs: Math.round(Math.min(out + (line.d ?? ASSUMED_LINE_MS), durationMs)),
        text: line.text,
      })
    }
  }
  lines.sort((a, b) => a.tMs - b.tMs)
  return lines
}
