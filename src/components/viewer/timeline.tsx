// The scrubber. Everything sits on a source-global axis — every take laid end
// to end at full length — so a cut is drawn ON the axis as a removed span
// rather than compressing it: the frames either side of a cut never move when
// you toggle it, which is the only way the toggle reads as reversible.
//
// Bare drag scrubs — pointer-down anywhere on the lanes scrubs and dragging
// keeps scrubbing. Where carving is enabled, ⇧-drag instead sweeps a span and
// commits it as a cut the moment you let go. There is still NO selection of any
// kind (owner verdict, decisions.md 2026-08-01): a carve commits instantly on
// release and nothing persists selected. The cut tags above remain the only
// control that toggles an existing cut.

import { useRef, useState } from 'react'
import { cn } from '~/lib/utils'
import { mmss } from './format'

export interface TimelineTake {
  id: string
  label: string
  offsetMs: number
  durationMs: number
}

/** atMs is source-global. url null renders a placeholder box. */
export interface TimelineFrame {
  atMs: number
  url: string | null
}

export interface TimelineVoiceBar {
  atMs: number
  /** 0..1 */
  level: number
}

/** A removed span on the source-global axis. */
export interface TimelineCut {
  id: string
  startMs: number
  endMs: number
  enabled: boolean
}

/** Coarsest step first would crowd; finest that keeps the ruler under ten labels wins. */
const TICK_STEPS = [1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000]

/** A label past this would clip on the right edge. */
const LABEL_LIMIT_PCT = 97

/** Same hatch on every cut fill — kept literal so tailwind-merge can't drop the wash under it. */
const CUT_FILL =
  'pointer-events-none absolute inset-y-0 border-x border-border bg-muted/50 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,oklch(0.9_0.008_95)_4px,oklch(0.9_0.008_95)_5px)]'

const CUT_GHOST = 'pointer-events-none absolute inset-y-0 border border-dashed border-border/80'

/** Anything shorter is a ⇧-click, and a ⇧-click is nothing. */
const MIN_CARVE_MS = 250

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function tickStep(totalMs: number): number {
  for (const step of TICK_STEPS) {
    if (totalMs / step <= 9) return step
  }
  return 600000
}

export function Timeline({
  totalMs,
  takes,
  frames,
  voice,
  cuts,
  playheadMs,
  onScrub,
  onToggleCut,
  onMoveTake,
  onCarve,
  markMs,
  busy,
}: {
  totalMs: number
  takes: TimelineTake[]
  frames: TimelineFrame[]
  voice: TimelineVoiceBar[]
  cuts?: TimelineCut[]
  playheadMs: number
  onScrub(sourceMs: number): void
  onToggleCut?(id: string): void
  onMoveTake?(id: string, dir: -1 | 1): void
  /** When present, ⇧-drag sweeps a span and calls this on release (source-global ms, start < end). */
  onCarve?(startMs: number, endMs: number): void
  /** A pending in-point (the editor's "cut from here"), drawn as a dashed cobalt line. */
  markMs?: number | null
  busy?: boolean
}): React.ReactElement {
  // The fork is decided once, at pointerdown, and held for the whole gesture.
  const gesture = useRef<'scrub' | 'carve' | null>(null)
  const [carve, setCarve] = useState<{ a: number; b: number } | null>(null)

  // A walkthrough seconds old is one quiet line, not a stack of empty scaffolding.
  if (totalMs <= 0 || takes.length === 0) {
    return <p className="text-muted-foreground py-2 font-mono text-xs">nothing recorded yet.</p>
  }

  const pct = (ms: number) => `${(clamp(ms, 0, totalMs) / totalMs) * 100}%`
  const enabledCuts = (cuts ?? []).filter((c) => c.enabled)
  const step = tickStep(totalMs)
  const ticks: number[] = []
  for (let at = 0; at <= totalMs; at += step) ticks.push(at)

  function msAt(event: React.PointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return clamp(((event.clientX - rect.left) / rect.width) * totalMs, 0, totalMs)
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = msAt(event)
    if (event.shiftKey && onCarve && !busy) {
      gesture.current = 'carve'
      setCarve({ a: at, b: at })
      return
    }
    gesture.current = 'scrub'
    onScrub(at)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (gesture.current === null) return
    const at = msAt(event)
    if (gesture.current === 'carve') {
      setCarve((span) => (span === null ? span : { a: span.a, b: at }))
      return
    }
    onScrub(at)
  }

  function endGesture(event: React.PointerEvent<HTMLDivElement>): 'scrub' | 'carve' | null {
    const mode = gesture.current
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    return mode
  }

  function onPointerRelease(event: React.PointerEvent<HTMLDivElement>) {
    const mode = endGesture(event)
    if (mode !== 'carve') return
    setCarve(null)
    if (carve === null || Math.abs(carve.b - carve.a) < MIN_CARVE_MS) return
    onCarve?.(Math.min(carve.a, carve.b), Math.max(carve.a, carve.b))
  }

  function onPointerAbort(event: React.PointerEvent<HTMLDivElement>) {
    endGesture(event)
    setCarve(null)
  }

  return (
    <div className="select-none">
      {cuts && cuts.length > 0 && (
        <div className="relative h-6">
          {cuts.map((cut) => (
            <button
              key={cut.id}
              type="button"
              title={
                cut.enabled ? 'kept out — click to keep this part' : 'kept in — click to cut it'
              }
              onClick={(event) => {
                event.stopPropagation()
                onToggleCut?.(cut.id)
              }}
              style={{
                left: pct((cut.startMs + cut.endMs) / 2),
                transform: 'translateX(-50%)',
              }}
              className={cn(
                'absolute rounded-full border px-1.5 font-mono text-[11px] leading-5',
                cut.enabled
                  ? 'border-cobalt/40 bg-cobalt-wash text-cobalt'
                  : 'border-border text-muted-foreground line-through'
              )}>
              {`−${((cut.endMs - cut.startMs) / 1000).toFixed(1)}s`}
            </button>
          ))}
        </div>
      )}

      <div
        className="relative cursor-ew-resize"
        onPointerDown={busy ? undefined : onPointerDown}
        onPointerMove={busy ? undefined : onPointerMove}
        onPointerUp={busy ? undefined : onPointerRelease}
        onPointerCancel={busy ? undefined : onPointerAbort}>
        {/* ruler */}
        <div className="border-border relative h-5 border-b">
          {ticks.map((at) => {
            const position = (at / totalMs) * 100
            return (
              <div key={at}>
                <span
                  className="bg-border absolute bottom-0 h-1 w-px"
                  style={{ left: `${position}%` }}
                />
                {position <= LABEL_LIMIT_PCT && (
                  <span
                    className="text-muted-foreground absolute top-0 font-mono text-[10px]"
                    style={{
                      left: `${position}%`,
                      transform: at === 0 ? undefined : 'translateX(-50%)',
                    }}>
                    {mmss(at)}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* filmstrip */}
        <div className="relative h-14 overflow-hidden">
          {frames.map((frame, index) => {
            const cut = enabledCuts.some((c) => frame.atMs >= c.startMs && frame.atMs < c.endMs)
            const style = { left: pct(frame.atMs), transform: 'translateX(-50%)' }
            return frame.url === null ? (
              <span
                key={`${index}:${frame.atMs}`}
                style={style}
                className={cn(
                  'border-border bg-muted absolute top-1 h-12 w-16 rounded-sm border',
                  cut && 'opacity-40'
                )}
              />
            ) : (
              <img
                key={`${index}:${frame.atMs}`}
                src={frame.url}
                draggable={false}
                loading="lazy"
                alt=""
                style={style}
                className={cn(
                  'border-border absolute top-1 h-12 w-auto rounded-sm border',
                  cut && 'opacity-40'
                )}
              />
            )
          })}
          <CutOverlays cuts={cuts} pct={pct} />
        </div>

        {/* takes, each over the stretch it owns — absolutely placed so seams
            line up with the ruler and filmstrip above, not flex-gap drifted */}
        <div className="relative h-7">
          {takes.map((take, index) => (
            <span
              key={take.id}
              style={{ left: pct(take.offsetMs), width: pct(take.durationMs) }}
              className="border-border text-muted-foreground absolute inset-y-0 flex min-w-0 items-center gap-1.5 overflow-hidden rounded-sm border px-2 font-mono text-[11px] whitespace-nowrap">
              {take.label}
              {onMoveTake && takes.length > 1 && (
                <>
                  <button
                    type="button"
                    disabled={index === 0 || busy}
                    title="move this take earlier"
                    // pointerdown must not reach the scrub surface: its capture
                    // would swallow the click and the press would scrub instead.
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      onMoveTake(take.id, -1)
                    }}
                    className="text-muted-foreground hover:text-foreground text-[10px] disabled:invisible">
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === takes.length - 1 || busy}
                    title="move this take later"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      onMoveTake(take.id, 1)
                    }}
                    className="text-muted-foreground hover:text-foreground text-[10px] disabled:invisible">
                    ↓
                  </button>
                </>
              )}
            </span>
          ))}
        </div>

        {/* voice as density bars — ink gray, never cobalt; the playhead owns that */}
        <div className="relative h-8">
          <svg
            className="text-foreground/55 h-full w-full"
            viewBox="0 0 1000 32"
            preserveAspectRatio="none">
            {voice.map((bar, index) => {
              const height = Math.max(2, bar.level * 28)
              return (
                <rect
                  key={`${index}:${bar.atMs}`}
                  fill="currentColor"
                  rx={0.6}
                  x={(clamp(bar.atMs, 0, totalMs) / totalMs) * 1000}
                  width={Math.max(1.2, (1000 / voice.length) * 0.55)}
                  height={height}
                  y={16 - height / 2}
                />
              )
            })}
          </svg>
          <CutOverlays cuts={cuts} pct={pct} />
        </div>

        {/* the pen mid-stroke — tinted cobalt, deliberately not the committed hatch */}
        {carve !== null && (
          <span
            className="border-cobalt/50 bg-cobalt-wash/60 pointer-events-none absolute inset-y-0 z-10 border-x"
            style={{
              left: pct(Math.min(carve.a, carve.b)),
              width: pct(Math.abs(carve.b - carve.a)),
            }}
          />
        )}

        {typeof markMs === 'number' && (
          <div
            className="border-cobalt/70 pointer-events-none absolute inset-y-0 z-10 w-0 border-l border-dashed"
            style={{ left: pct(markMs) }}
          />
        )}

        <div
          className="bg-cobalt pointer-events-none absolute inset-y-0 w-px"
          style={{ left: pct(playheadMs), transform: 'translateX(-50%)' }}>
          <span className="bg-cobalt absolute top-0 left-0 size-[7px] -translate-x-1/2 rounded-full" />
        </div>
      </div>

      {onCarve && (
        <p className="text-muted-foreground pt-1 font-mono text-[10px]">⇧ drag to cut a section</p>
      )}
    </div>
  )
}

/** The removed spans, drawn identically in every lane that carries them. */
function CutOverlays({
  cuts,
  pct,
}: {
  cuts: TimelineCut[] | undefined
  pct: (ms: number) => string
}) {
  if (!cuts) return null
  return (
    <>
      {cuts.map((cut) => (
        <div
          key={cut.id}
          className={cut.enabled ? CUT_FILL : CUT_GHOST}
          style={{ left: pct(cut.startMs), width: pct(cut.endMs - cut.startMs) }}
        />
      ))}
    </>
  )
}
