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

/**
 * Every keyframe in the walkthrough as one numbered contact sheet — the whole
 * recording readable at a glance, each cell a seek into the player above.
 */
export function FramesGrid({
  frames,
  activeMs,
  onSeek,
}: {
  frames: GridFrame[]
  activeMs: number
  onSeek: (ms: number) => void
}) {
  if (frames.length === 0) {
    return <p className="text-muted-foreground text-sm">No keyframes were captured.</p>
  }

  const current = activeIndex(frames, activeMs)

  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
      {frames.map((frame, i) => {
        const active = i === current
        return (
          <button
            key={`${frame.atMs}-${i}`}
            type="button"
            onClick={() => onSeek(frame.atMs)}
            aria-label={`Seek to ${frame.label}`}
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
                  'border-border group-hover:border-cobalt w-full rounded-sm border transition-colors',
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
  )
}
