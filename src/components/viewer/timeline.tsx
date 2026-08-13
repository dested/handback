// The scrubber. Everything sits on a source-global axis — every take laid end
// to end at full length — so a cut is drawn ON the axis as a removed span
// rather than compressing it: the frames either side of a cut never move when
// you toggle it, which is the only way the toggle reads as reversible.
//
// Two interaction modes, decided by whether the caller can remove ranges:
//  · Viewer (no onRemoveRange): the whole thing is a scrubber — pointer-down
//    anywhere scrubs and dragging keeps scrubbing.
//  · Editor (onRemoveRange present): a CLICK moves the playhead, a DRAG paints a
//    persistent selection you then Remove (button, or Delete). This reverses the
//    old no-selection rule — owner directive 2026-08-13, decisions.md.

import { useEffect, useRef, useState } from 'react'
import { Scissors, X } from 'lucide-react'
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

/** Past this many pixels a press is a drag (a selection), under it a click (a seek). */
const DRAG_THRESHOLD_PX = 4

/** A selection shorter than this is nothing worth removing. */
const MIN_SELECT_MS = 200

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
  onRemoveRange,
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
  /** When present, drag paints a selection and this removes it (source-global ms, start < end). */
  onRemoveRange?(startMs: number, endMs: number): void
  busy?: boolean
}): React.ReactElement {
  // The fork is decided once, at pointerdown, and held for the whole gesture.
  const gesture = useRef<'scrub' | 'select' | 'pending' | null>(null)
  const anchorMs = useRef(0)
  const anchorX = useRef(0)
  /** The span being painted right now (null between drags). */
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)
  /** The committed, persistent selection waiting to be Removed. */
  const [selection, setSelection] = useState<{ a: number; b: number } | null>(null)

  const selectable = Boolean(onRemoveRange) && !busy

  // Delete removes the selection, Escape clears it — only while one exists, so a
  // viewer timeline (which never has a selection) never touches the keyboard.
  useEffect(() => {
    if (!selection) return
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        onRemoveRange?.(selection.a, selection.b)
        setSelection(null)
      } else if (event.key === 'Escape') {
        setSelection(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, onRemoveRange])

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
    anchorMs.current = at
    anchorX.current = event.clientX
    if (selectable) {
      // Wait to see if this becomes a drag (select) or stays a click (seek).
      gesture.current = 'pending'
      return
    }
    gesture.current = 'scrub'
    onScrub(at)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (gesture.current === null) return
    const at = msAt(event)
    if (gesture.current === 'scrub') {
      onScrub(at)
      return
    }
    if (gesture.current === 'pending') {
      if (Math.abs(event.clientX - anchorX.current) < DRAG_THRESHOLD_PX) return
      gesture.current = 'select'
      setSelection(null) // a new drag supersedes whatever was selected
    }
    if (gesture.current === 'select') {
      setDrag({ a: anchorMs.current, b: at })
    }
  }

  function onPointerRelease(event: React.PointerEvent<HTMLDivElement>) {
    const mode = gesture.current
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (mode === 'select' && drag) {
      const a = Math.min(drag.a, drag.b)
      const b = Math.max(drag.a, drag.b)
      setDrag(null)
      setSelection(b - a >= MIN_SELECT_MS ? { a, b } : null)
      return
    }
    setDrag(null)
    if (mode === 'pending') {
      // Never crossed the threshold: it was a click — seek and drop any selection.
      onScrub(anchorMs.current)
      setSelection(null)
    }
  }

  function onPointerAbort(event: React.PointerEvent<HTMLDivElement>) {
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDrag(null)
  }

  const selCenterPct = selection
    ? clamp(((selection.a + selection.b) / 2 / totalMs) * 100, 7, 93)
    : 0

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
        className={cn('relative', selectable ? 'cursor-text' : 'cursor-ew-resize')}
        onPointerDown={busy ? undefined : onPointerDown}
        onPointerMove={busy ? undefined : onPointerMove}
        onPointerUp={busy ? undefined : onPointerRelease}
        onPointerCancel={busy ? undefined : onPointerAbort}>
        {/* the Remove bar, floating over the committed selection */}
        {selection && (
          <div
            className="absolute -top-9 z-30 -translate-x-1/2"
            style={{ left: `${selCenterPct}%` }}
            onPointerDown={(event) => event.stopPropagation()}>
            <div className="border-border bg-card flex items-center gap-1 rounded-md border p-1 shadow-md">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onRemoveRange?.(selection.a, selection.b)
                  setSelection(null)
                }}
                className="bg-cobalt hover:bg-cobalt/90 inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[11px] font-medium text-white transition-colors">
                <Scissors className="size-3" />
                Remove {((selection.b - selection.a) / 1000).toFixed(1)}s
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  setSelection(null)
                }}
                aria-label="Clear selection"
                className="text-muted-foreground hover:text-foreground hover:bg-accent/50 grid size-6 place-items-center rounded transition-colors">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        )}

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

        {/* the selection: the live drag, tinted lighter; the committed one, bordered */}
        {drag && (
          <span
            className="border-cobalt/50 bg-cobalt-wash/50 pointer-events-none absolute inset-y-0 z-10 border-x"
            style={{ left: pct(Math.min(drag.a, drag.b)), width: pct(Math.abs(drag.b - drag.a)) }}
          />
        )}
        {selection && (
          <span
            className="border-cobalt bg-cobalt-wash/60 pointer-events-none absolute inset-y-0 z-10 border-x-2"
            style={{
              left: pct(selection.a),
              width: pct(selection.b - selection.a),
            }}
          />
        )}

        <div
          className="bg-cobalt pointer-events-none absolute inset-y-0 z-20 w-px"
          style={{ left: pct(playheadMs), transform: 'translateX(-50%)' }}>
          <span className="bg-cobalt absolute top-0 left-0 size-[7px] -translate-x-1/2 rounded-full" />
        </div>
      </div>

      {selectable && (
        <p className="text-muted-foreground pt-1.5 font-mono text-[10px]">
          {selection
            ? 'Delete removes it · Esc clears · click to move the playhead'
            : 'Drag across the timeline to select a section, then Remove it · click to move the playhead'}
        </p>
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
