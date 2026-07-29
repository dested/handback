import { useEffect, useRef, useState } from 'react'
import { cn } from '~/lib/utils'
import { plural } from './format'
import type { Frame } from './types'

/** Keyframes as a scrubbable strip: click a thumb, the take's video jumps there. */
export function Filmstrip({
  frames,
  urlFor,
  onSeek,
}: {
  frames: Frame[]
  urlFor: (takeRelativeFile: string) => string | undefined
  onSeek: (tMs: number) => void
}) {
  const [flashed, setFlashed] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  if (frames.length === 0) {
    return (
      <p className="text-muted-foreground py-2 font-mono text-xs">No keyframes in this take.</p>
    )
  }

  function pick(frame: Frame) {
    onSeek(frame.tMs)
    setFlashed(frame.index)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlashed(null), 700)
  }

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto py-2">
        {frames.map((frame) => {
          const url = urlFor(frame.file)
          return (
            <button
              key={frame.index}
              type="button"
              onClick={() => pick(frame)}
              title={`${frame.at} — ${frame.reason}`}
              aria-label={`Seek to ${frame.at}`}
              className="shrink-0 rounded-sm">
              {url ? (
                <img
                  src={url}
                  loading="lazy"
                  alt=""
                  className={cn(
                    'border-border hover:border-cobalt h-16 w-auto rounded-sm border transition-colors',
                    flashed === frame.index && 'ring-cobalt border-cobalt ring-2'
                  )}
                />
              ) : (
                <span className="border-border text-muted-foreground flex h-16 w-24 items-center justify-center rounded-sm border font-mono text-[10px]">
                  missing
                </span>
              )}
            </button>
          )
        })}
      </div>
      <p className="text-muted-foreground font-mono text-xs">
        {plural(frames.length, 'keyframe')} · click to seek
      </p>
    </div>
  )
}
