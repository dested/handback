import { cn } from '~/lib/utils'
import { mmss } from './format'

/**
 * The narration, one clickable line per spoken window. Structurally typed on
 * purpose: the viewer hands it lines on the whole-walkthrough clock, the final
 * cut hands it `TranscriptLine`s off transcript.json.
 */
export function TranscriptPanel({
  lines,
  onSeek,
  activeMs,
}: {
  lines: { tMs: number; endMs: number; text: string }[]
  onSeek: (tMs: number) => void
  activeMs?: number
}) {
  if (lines.length === 0) {
    return <p className="text-muted-foreground text-sm">No narration in this recording.</p>
  }

  return (
    <ul className="max-h-[420px] space-y-1 overflow-y-auto">
      {lines.map((line, i) => {
        const active = activeMs !== undefined && activeMs >= line.tMs && activeMs < line.endMs
        return (
          <li key={`${line.tMs}-${i}`}>
            <button
              type="button"
              onClick={() => onSeek(line.tMs)}
              className={cn(
                'hover:bg-accent/40 flex w-full gap-3 rounded-sm px-1.5 py-1 text-left transition-colors',
                active && 'bg-cobalt-wash'
              )}>
              <span className="text-cobalt shrink-0 pt-px font-mono text-xs">{mmss(line.tMs)}</span>
              <span className="text-sm leading-relaxed">{line.text}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
