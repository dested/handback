import { useEffect, useRef } from 'react'
import { Button } from '~/components/ui/button'
import { mmss, mmssFile } from '~/lib/capture/format'
import type { LiveThumb, LiveUpdate } from '~/lib/capture/live'
import { AudioMeters } from './hud'

/**
 * The recording state, in the page — the rich half of the extension experience a
 * floating HUD can't carry: a live view of exactly what is being captured, and
 * the keyframes accumulating into a filmstrip as they are kept, the way the
 * extension's timeline builds under you while you narrate.
 *
 * The compact controls (clock, audio, stop) live in `RecordingHud` and can float
 * in a PiP window; this panel is what you look at while you are still on this
 * tab. When the controls have floated out, `floating` drops the in-page stop
 * button so there is exactly one, and this becomes a passive monitor.
 */

export interface RecordingPanelProps {
  live: LiveUpdate | null
  stream: MediaStream | null
  thumbs: LiveThumb[]
  stopping: boolean
  onStop: () => void
  /** The controls have popped out to a floating window; hide the in-page ones. */
  floating: boolean
  pipSupported: boolean
  onPopOut: () => void
  /** Human handback: full-rate video, no keyframes — the chip and the filmstrip
   *  would both read "0" forever, so they say what's true instead. */
  pristine?: boolean
}

export function RecordingPanel({
  live,
  stream,
  thumbs,
  stopping,
  onStop,
  floating,
  pipSupported,
  onPopOut,
  pristine = false,
}: RecordingPanelProps) {
  const video = useRef<HTMLVideoElement | null>(null)

  // A MediaStream can feed more than one <video>; the recorder reads the same
  // stream off-screen. srcObject is a property, never an attribute, so it can
  // only be set from script — hence the effect rather than a prop on the tag.
  useEffect(() => {
    const el = video.current
    if (!el) return
    el.srcObject = stream
    if (stream) void el.play().catch(() => {})
    return () => {
      el.srcObject = null
    }
  }, [stream])

  return (
    <div className="space-y-4">
      <div className="border-border bg-ink overflow-hidden rounded-md border">
        {/* object-contain on an ink ground: a shared window is rarely 16:9, and
            letterboxing the real frame beats cropping it. */}
        <div className="relative aspect-video w-full">
          <video
            ref={video}
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-contain"
          />
          <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 backdrop-blur-sm">
            <span className="bg-destructive size-2.5 animate-pulse rounded-full" aria-hidden />
            <span className="font-mono text-sm font-medium text-white tabular-nums">
              {mmss(live?.elapsedMs ?? 0)}
            </span>
          </div>
          <div className="absolute top-3 right-3 rounded-full bg-black/55 px-3 py-1 font-mono text-xs text-white/90 backdrop-blur-sm">
            {pristine ? 'full video' : `${live?.frameCount ?? 0} keyframes`}
          </div>
        </div>
      </div>

      {!pristine && <Filmstrip thumbs={thumbs} />}

      <div className="flex items-start justify-between gap-4">
        <AudioMeters live={live} />
        {pipSupported &&
          (floating ? (
            <span className="text-muted-foreground shrink-0 font-mono text-xs">
              controls are floating ↗
            </span>
          ) : (
            <button
              type="button"
              onClick={onPopOut}
              className="text-primary shrink-0 text-sm underline underline-offset-4">
              pop the controls out ↗
            </button>
          ))}
      </div>

      {floating ? (
        <p className="text-muted-foreground font-mono text-xs">
          the recorder is floating above your other windows — go drive the thing you're narrating,
          and stop it from there.
        </p>
      ) : (
        <Button type="button" className="h-[46px] w-full" disabled={stopping} onClick={onStop}>
          {stopping ? 'finishing…' : 'Stop recording'}
        </Button>
      )}
    </div>
  )
}

/**
 * The keyframes so far, newest at the right, scrolled to keep the freshest in
 * view — this is the take taking shape. Empty until dedup keeps the first frame,
 * which is a beat or two in, so it says so rather than drawing an empty rail.
 */
function Filmstrip({ thumbs }: { thumbs: LiveThumb[] }) {
  const rail = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = rail.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [thumbs.length])

  if (!thumbs.length) {
    return (
      <p className="text-muted-foreground border-border rounded-md border border-dashed px-3 py-4 text-center font-mono text-xs">
        keyframes will appear here as the screen changes
      </p>
    )
  }

  return (
    <div
      ref={rail}
      className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]"
      aria-label="captured keyframes">
      {thumbs.map((thumb) => (
        <figure key={thumb.index} className="shrink-0">
          <img
            src={thumb.url}
            alt=""
            className="border-border h-16 rounded-sm border object-cover"
            draggable={false}
          />
          <figcaption className="text-muted-foreground mt-1 text-center font-mono text-[10px] tabular-nums">
            {mmssFile(thumb.t)}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
