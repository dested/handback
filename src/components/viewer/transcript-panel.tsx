import { useEffect, useMemo, useRef } from 'react'
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
  const listRef = useRef<HTMLUListElement>(null)

  // The line whose window the playhead is inside — -1 in the gaps between lines,
  // where we hold position rather than snapping back to the top.
  const activeIndex = useMemo(() => {
    if (activeMs === undefined) return -1
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line && activeMs >= line.tMs && activeMs < line.endMs) return i
    }
    return -1
  }, [lines, activeMs])

  // Keep the spoken line in view as the video plays. The <ul> is the scroll
  // container and `relative` (below), so offsetTop reads against it.
  useEffect(() => {
    const list = listRef.current
    if (!list || activeIndex < 0) return
    const child = list.children[activeIndex] as HTMLElement | undefined
    if (!child) return
    list.scrollTo({
      top: child.offsetTop - list.clientHeight / 2 + child.clientHeight / 2,
      behavior: 'smooth',
    })
  }, [activeIndex])

  if (lines.length === 0) {
    return <p className="text-muted-foreground text-sm">No narration in this recording.</p>
  }

  return (
    <ul ref={listRef} className="relative max-h-[420px] space-y-1 overflow-y-auto">
      {lines.map((line, i) => {
        const active = i === activeIndex
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
