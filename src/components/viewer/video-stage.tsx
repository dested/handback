// The walkthrough player. One <video> with the browser's default chrome stripped
// off, wearing controls in the editorial language instead — a paper transport bar
// under a dark video well. The seek bar reads the SegmentPlayer's OUTPUT clock,
// which spans every take as one continuous recording, so it never jumps back to
// zero at a take boundary the way native controls (bound to one source at a time,
// and to MediaRecorder webm's unknowable duration) do.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Camera,
  CameraOff,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { cn } from '~/lib/utils'
import { mmss } from './format'
import type { ViewerFrame } from './slideshow'
import { usePopover } from './overflow-menu'
import type { SegmentPlayer } from './use-segment-player'

const RATES = [0.5, 1, 1.25, 1.5, 2] as const

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

const ICON_BTN =
  'text-muted-foreground hover:text-foreground grid size-8 place-items-center rounded-md transition-colors hover:bg-accent/50'

export function VideoStage({
  player,
  className,
  maxHeightClass = 'max-h-[480px]',
  frames,
}: {
  player: SegmentPlayer
  className?: string
  maxHeightClass?: string
  /** Keyframes on the output clock — the exact stills the agent reads. When
   *  present, the transport ticks each capture and the well flashes the shot. */
  frames?: ViewerFrame[]
}): React.ReactElement {
  const { videoRef, currentSrc, playing, outputMs, durationMs, togglePlay, seekOutput } = player

  const wrapRef = useRef<HTMLDivElement>(null)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState<number>(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [bufferedMs, setBufferedMs] = useState(0)
  const [showCaptures, setShowCaptures] = useState(true)
  const [flash, setFlash] = useState(false)

  // The keyframe the playhead is currently sitting on — the last capture at or
  // before now. A shutter flash fires the instant playback crosses into a new one.
  let frameIndex = -1
  if (frames) {
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].atMs <= outputMs) frameIndex = i
      else break
    }
  }
  const currentFrame = frameIndex >= 0 ? frames?.[frameIndex] : undefined

  const prevFrameIndex = useRef(frameIndex)
  const flashTimer = useRef<number | null>(null)
  useEffect(() => {
    if (frameIndex > prevFrameIndex.current && frameIndex >= 0 && showCaptures) {
      setFlash(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlash(false), 150)
    }
    prevFrameIndex.current = frameIndex
  }, [frameIndex, showCaptures])

  // The playhead updates ~30×/s; a ref keeps the buffered reader off the effect
  // dep list so it doesn't resubscribe every frame.
  const outputRef = useRef(outputMs)
  outputRef.current = outputMs
  const durationRef = useRef(durationMs)
  durationRef.current = durationMs

  // Volume + mute are element properties that survive a source swap.
  useEffect(() => {
    const video = videoRef.current
    if (video) {
      video.volume = volume
      video.muted = muted
    }
  }, [volume, muted, videoRef])

  // playbackRate, unlike volume, resets to 1 whenever a new source loads — so
  // reapply it on every source and on loadeddata.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = rate
    const reapply = () => {
      video.playbackRate = rate
    }
    video.addEventListener('loadeddata', reapply)
    return () => video.removeEventListener('loadeddata', reapply)
  }, [rate, videoRef, currentSrc])

  // Buffering spinner + how far ahead the current source has loaded, mapped onto
  // the output clock (exact for one take, close enough across a boundary).
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const stall = () => setBuffering(true)
    const flow = () => setBuffering(false)
    const progress = () => {
      const t = video.currentTime
      let ahead = 0
      for (let i = 0; i < video.buffered.length; i++) {
        if (t >= video.buffered.start(i) - 0.5 && t <= video.buffered.end(i) + 0.5) {
          ahead = video.buffered.end(i) - t
          break
        }
      }
      const total = durationRef.current
      setBufferedMs(clamp(outputRef.current + ahead * 1000, 0, total > 0 ? total : Infinity))
    }
    video.addEventListener('waiting', stall)
    video.addEventListener('stalled', stall)
    video.addEventListener('playing', flow)
    video.addEventListener('canplay', flow)
    video.addEventListener('progress', progress)
    video.addEventListener('timeupdate', progress)
    return () => {
      video.removeEventListener('waiting', stall)
      video.removeEventListener('stalled', stall)
      video.removeEventListener('playing', flow)
      video.removeEventListener('canplay', flow)
      video.removeEventListener('progress', progress)
      video.removeEventListener('timeupdate', progress)
    }
  }, [videoRef])

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen?.().catch(() => {})
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const bumpVolume = useCallback((delta: number) => {
    setMuted(false)
    setVolume((v) => clamp(v + delta, 0, 1))
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const tag = (event.target as HTMLElement).tagName
      const onControl = tag === 'BUTTON' || tag === 'INPUT'
      const at = outputRef.current
      switch (event.key) {
        case ' ':
        case 'k':
          if (onControl) return // let the focused control take the key
          event.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          event.preventDefault()
          seekOutput(at - 5000)
          break
        case 'ArrowRight':
          event.preventDefault()
          seekOutput(at + 5000)
          break
        case 'j':
          seekOutput(at - 10000)
          break
        case 'l':
          seekOutput(at + 10000)
          break
        case 'ArrowUp':
          if (onControl) return
          event.preventDefault()
          bumpVolume(0.1)
          break
        case 'ArrowDown':
          if (onControl) return
          event.preventDefault()
          bumpVolume(-0.1)
          break
        case 'm':
          setMuted((s) => !s)
          break
        case 'f':
          toggleFullscreen()
          break
        case 'Home':
          seekOutput(0)
          break
        case 'End':
          seekOutput(durationRef.current)
          break
        default:
          if (/^[0-9]$/.test(event.key)) seekOutput(durationRef.current * (Number(event.key) / 10))
      }
    },
    [togglePlay, seekOutput, bumpVolume, toggleFullscreen]
  )

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  if (!currentSrc) {
    return (
      <div
        className={cn(
          'border-border text-muted-foreground flex h-64 items-center justify-center rounded-md border border-dashed text-sm',
          className
        )}>
        No video was uploaded.
      </div>
    )
  }

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        'group/stage bg-card focus-visible:ring-cobalt/40 overflow-hidden rounded-md border outline-none focus-visible:ring-2',
        fullscreen && 'flex h-screen flex-col rounded-none border-0',
        className
      )}>
      <div className={cn('relative bg-black/95', fullscreen ? 'flex flex-1 items-center' : '')}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          src={currentSrc}
          playsInline
          preload="metadata"
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          onTimeUpdate={player.onTimeUpdate}
          onEnded={player.onEnded}
          onPlay={player.onPlay}
          onPause={player.onPause}
          className={cn(
            'mx-auto block w-full cursor-pointer object-contain',
            fullscreen ? 'h-full max-h-none' : maxHeightClass
          )}
        />

        {!playing && !buffering && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label="Play"
            className="absolute inset-0 grid place-items-center">
            <span className="grid size-16 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/25 backdrop-blur-sm transition group-hover/stage:bg-black/65">
              <Play className="size-7 translate-x-0.5" fill="currentColor" />
            </span>
          </button>
        )}

        {buffering && playing && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <Loader2 className="size-9 animate-spin text-white/85" />
          </div>
        )}

        {/* shutter — the frame the agent keeps was grabbed right here */}
        {showCaptures && (
          <div
            className={cn(
              'pointer-events-none absolute inset-0 bg-white transition-opacity',
              flash ? 'opacity-20 duration-0' : 'opacity-0 duration-200'
            )}
          />
        )}

        {/* the captured still, held in the corner while it plays — this is what
            the agent actually sees at this moment, not the moving video */}
        {showCaptures && currentFrame && (
          <div
            className={cn(
              'pointer-events-none absolute right-3 bottom-3 w-28 overflow-hidden rounded-md border border-white/25 bg-black/55 backdrop-blur-sm transition-opacity duration-300',
              playing || flash ? 'opacity-100' : 'opacity-0'
            )}>
            {currentFrame.url && (
              <img src={currentFrame.url} alt="" className="aspect-video w-full object-cover" />
            )}
            <p className="flex items-center gap-1.5 px-1.5 py-1 font-mono text-[10px] text-white/90">
              <Camera className="size-3 text-white/80" />
              frame {frameIndex + 1}
              {frames && <span className="text-white/50">/ {frames.length}</span>}
            </p>
          </div>
        )}
      </div>

      <div className="border-border bg-card border-t px-3 pt-1.5 pb-2">
        <SeekBar
          outputMs={outputMs}
          durationMs={durationMs}
          bufferedMs={bufferedMs}
          onSeek={seekOutput}
          markers={showCaptures ? frames?.map((f) => f.atMs) : undefined}
        />

        <div className="mt-1 flex items-center gap-2">
          <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className={ICON_BTN}>
            {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4" fill="currentColor" />}
          </button>

          <div className="group/vol flex items-center">
            <button type="button" onClick={() => setMuted((s) => !s)} aria-label={muted ? 'Unmute' : 'Mute'} className={ICON_BTN}>
              <VolumeIcon className="size-4" />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(event) => {
                setMuted(false)
                setVolume(Number(event.target.value))
              }}
              aria-label="Volume"
              style={{ accentColor: 'var(--cobalt)' }}
              className="ml-0.5 hidden h-1 w-0 cursor-pointer opacity-0 transition-all group-hover/vol:w-16 group-hover/vol:opacity-100 focus-visible:w-16 focus-visible:opacity-100 sm:block"
            />
          </div>

          <span className="text-muted-foreground ml-1 font-mono text-xs tabular-nums">
            <span className="text-foreground">{mmss(outputMs)}</span>
            <span className="px-1 opacity-50">/</span>
            {durationMs > 0 ? mmss(durationMs) : '—:—'}
          </span>

          <div className="ml-auto flex items-center gap-1">
            {frames && frames.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCaptures((s) => !s)}
                aria-pressed={showCaptures}
                title={showCaptures ? 'Hide captured frames' : 'Show captured frames'}
                className={cn(ICON_BTN, showCaptures && 'text-cobalt hover:text-cobalt')}>
                {showCaptures ? <Camera className="size-4" /> : <CameraOff className="size-4" />}
              </button>
            )}
            <RateMenu rate={rate} onRate={setRate} />
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
              className={ICON_BTN}>
              {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The transport bar's scrubber — buffered gutter, cobalt played fill, a grip that
 *  swells on hover, a mono time bubble tracking the cursor. Drives the output clock. */
function SeekBar({
  outputMs,
  durationMs,
  bufferedMs,
  onSeek,
  markers,
}: {
  outputMs: number
  durationMs: number
  bufferedMs: number
  onSeek: (ms: number, forcePlay?: boolean) => void
  /** Source-global ms of each keyframe capture, ticked onto the track. */
  markers?: number[]
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const down = useRef(false)
  const [hoverPct, setHoverPct] = useState<number | null>(null)

  const ready = durationMs > 0
  const playedPct = ready ? clamp((outputMs / durationMs) * 100, 0, 100) : 0
  const bufferedPct = ready ? clamp((bufferedMs / durationMs) * 100, 0, 100) : 0

  const pctAt = (event: React.PointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return clamp((event.clientX - rect.left) / rect.width, 0, 1)
  }

  const seekTo = (event: React.PointerEvent<HTMLDivElement>) => {
    if (ready) onSeek(pctAt(event) * durationMs)
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={ready ? Math.round(durationMs / 1000) : 0}
      aria-valuenow={Math.round(outputMs / 1000)}
      tabIndex={0}
      onPointerDown={(event) => {
        if (!ready) return
        event.currentTarget.setPointerCapture(event.pointerId)
        down.current = true
        seekTo(event)
      }}
      onPointerMove={(event) => {
        setHoverPct(pctAt(event))
        if (down.current) seekTo(event)
      }}
      onPointerUp={(event) => {
        down.current = false
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerLeave={() => setHoverPct(null)}
      className={cn('group/seek relative flex h-4 items-center', ready ? 'cursor-pointer' : 'cursor-default')}>
      {/* time bubble */}
      {hoverPct !== null && ready && (
        <span
          className="border-border bg-card text-foreground pointer-events-none absolute bottom-5 z-10 -translate-x-1/2 rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums shadow-sm"
          style={{ left: `${hoverPct * 100}%` }}>
          {mmss(hoverPct * durationMs)}
        </span>
      )}

      <div className="bg-border relative h-[3px] w-full rounded-full transition-[height] group-hover/seek:h-[5px]">
        <div className="bg-foreground/20 absolute inset-y-0 left-0 rounded-full" style={{ width: `${bufferedPct}%` }} />
        {ready &&
          markers?.map((m, i) => (
            <span
              key={`${m}-${i}`}
              className="bg-foreground/45 absolute inset-y-0 w-px"
              style={{ left: `${clamp((m / durationMs) * 100, 0, 100)}%` }}
            />
          ))}
        <div className="bg-cobalt absolute inset-y-0 left-0 rounded-full" style={{ width: `${playedPct}%` }} />
        <span
          className="bg-cobalt absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full shadow-sm transition-transform group-hover/seek:scale-100"
          style={{ left: `${playedPct}%` }}
        />
      </div>
    </div>
  )
}

function RateMenu({ rate, onRate }: { rate: number; onRate: (r: number) => void }) {
  const { open, setOpen, ref } = usePopover()
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Playback speed"
        className="text-muted-foreground hover:text-foreground hover:bg-accent/50 grid h-8 min-w-9 place-items-center rounded-md px-1.5 font-mono text-xs tabular-nums transition-colors">
        {rate}×
      </button>
      {open && (
        <div className="border-border bg-card absolute right-0 bottom-full z-20 mb-1 w-24 overflow-hidden rounded-md border py-1 shadow-md">
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                onRate(r)
                setOpen(false)
              }}
              className={cn(
                'hover:bg-accent/50 flex w-full items-center justify-between px-2.5 py-1 text-left font-mono text-xs tabular-nums',
                r === rate ? 'text-cobalt' : 'text-foreground'
              )}>
              {r}×{r === rate && <span className="text-cobalt">●</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
