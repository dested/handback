import { mmss } from './format'
import type { TranscriptLine } from './types'

/** The narration, one clickable line per spoken window. */
export function TranscriptPanel({
  lines,
  onSeek,
}: {
  lines: TranscriptLine[]
  onSeek: (tMs: number) => void
}) {
  if (lines.length === 0) {
    return <p className="text-muted-foreground text-sm">No speech in this take.</p>
  }

  return (
    <div className="border-border max-h-[480px] overflow-y-auto rounded-md border">
      <ul className="divide-border divide-y">
        {lines.map((line, i) => (
          <li key={`${line.tMs}-${i}`}>
            <button
              type="button"
              onClick={() => onSeek(line.tMs)}
              className="hover:bg-accent/40 flex w-full gap-3 px-3 py-2 text-left transition-colors">
              <span className="text-cobalt shrink-0 pt-px font-mono text-xs">
                [{mmss(line.tMs)}]
              </span>
              <span className="text-sm">{line.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
