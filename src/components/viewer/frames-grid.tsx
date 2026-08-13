// The keyframes as a legible contact sheet. The tiles are big enough to read at a
// glance; clicking one opens it full size in a lightbox — with prev/next and a
// "Play from here" that seeks the player and brings it back into view — because a
// 64px thumbnail was never something you could actually see, and seeking a player
// scrolled off the top of the page did nothing you could watch.

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Play, X } from 'lucide-react'
import { cn } from '~/lib/utils'

export interface GridFrame {
  atMs: number
  url: string | null
  label: string
}

/** The last frame the playhead has reached — the contact sheet's "you are here". */
function activeIndex(frames: GridFrame[], activeMs: number): number {
  let index = 0
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].atMs <= activeMs) index = i
  }
  return index
}

export function FramesGrid({
  frames,
  activeMs,
  onSeek,
}: {
  frames: GridFrame[]
  activeMs: number
  /** Seek the player to this moment and reveal it (scroll it back into view). */
  onSeek: (ms: number) => void
}) {
  const [lightbox, setLightbox] = useState<number | null>(null)

  if (frames.length === 0) {
    return <p className="text-muted-foreground text-sm">No keyframes were captured.</p>
  }

  const current = activeIndex(frames, activeMs)

  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
        {frames.map((frame, i) => {
          const active = i === current
          return (
            <button
              key={`${frame.atMs}-${i}`}
              type="button"
              onClick={() => setLightbox(i)}
              aria-label={`View frame ${i + 1} at ${frame.label}`}
              className="group block text-left">
              <p className="mb-1 flex items-baseline gap-2 font-mono text-[11px]">
                <span className={active ? 'text-cobalt' : 'text-foreground'}>{i + 1}</span>
                <span className={active ? 'text-cobalt' : 'text-muted-foreground'}>
                  {frame.label}
                </span>
              </p>
              {frame.url ? (
                <img
                  src={frame.url}
                  loading="lazy"
                  draggable={false}
                  alt=""
                  className={cn(
                    'border-border group-hover:border-cobalt aspect-video w-full rounded-sm border object-cover transition-colors',
                    active && 'border-cobalt ring-cobalt ring-2'
                  )}
                />
              ) : (
                <span className="border-border bg-muted text-muted-foreground flex aspect-video w-full items-center justify-center rounded-sm border font-mono text-[10px]">
                  missing
                </span>
              )}
            </button>
          )
        })}
      </div>

      {lightbox !== null && (
        <Lightbox
          frames={frames}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          onPlay={(ms) => {
            setLightbox(null)
            onSeek(ms)
          }}
        />
      )}
    </>
  )
}

function Lightbox({
  frames,
  index,
  onIndex,
  onClose,
  onPlay,
}: {
  frames: GridFrame[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  onPlay: (ms: number) => void
}) {
  const frame = frames[index]
  const go = useCallback(
    (delta: number) => onIndex(Math.min(frames.length - 1, Math.max(0, index + delta))),
    [frames.length, index, onIndex]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight') go(1)
      else if (event.key === 'ArrowLeft') go(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [go, onClose])

  if (!frame) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="bg-foreground/60 fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm sm:p-8">
      <div
        onClick={(event) => event.stopPropagation()}
        className="bg-card flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-md border shadow-xl">
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/95">
          {frame.url ? (
            <img src={frame.url} alt="" draggable={false} className="max-h-[70vh] w-auto object-contain" />
          ) : (
            <span className="text-muted-foreground p-16 font-mono text-sm">frame missing</span>
          )}

          {index > 0 && (
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous frame"
              className="absolute top-1/2 left-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/20 backdrop-blur-sm transition hover:bg-black/70">
              <ArrowLeft className="size-4" />
            </button>
          )}
          {index < frames.length - 1 && (
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next frame"
              className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/20 backdrop-blur-sm transition hover:bg-black/70">
              <ArrowRight className="size-4" />
            </button>
          )}
        </div>

        <div className="border-border flex items-center justify-between gap-4 border-t px-4 py-3">
          <p className="font-mono text-xs">
            <span className="text-foreground">frame {index + 1}</span>
            <span className="text-muted-foreground px-1.5">/ {frames.length}</span>
            <span className="text-cobalt">{frame.label}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPlay(frame.atMs)}
              className="bg-cobalt hover:bg-cobalt/90 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors">
              <Play className="size-3.5" fill="currentColor" />
              Play from here
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground hover:bg-accent/50 grid size-8 place-items-center rounded-md transition-colors">
              <X className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
