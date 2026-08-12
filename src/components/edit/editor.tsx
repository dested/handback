// The transcript-first editor for a human handback. The transcript IS the edit
// surface: delete a line and its time leaves the cut, silences appear as chips
// you can veto, one Tighten slider re-runs the silence pass. The preview below
// plays the tight edit by skipping the cuts live — the render is exact; this
// is close enough to judge it.
//
// Deliberately NOT a timeline with a selection marquee — the panel's timeline
// lost its selection model to an owner verdict (decisions.md 2026-08-01), and
// deleting *sentences* is both less code and a better fit for how a narrated
// take is actually tightened.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mmss } from '~/lib/capture/format'
import type { LiveTake } from '~/lib/capture/live-store'
import {
  editSegments,
  moveTake,
  outputDurationMs,
  sourceToOutputMs,
  type Cut,
  type EditSegment,
  type EditState,
} from '~/lib/edit/edl'
import { cn } from '~/lib/utils'

export interface EditorProps {
  takes: LiveTake[]
  state: EditState
  onChange(next: EditState): void
  /** Re-run the silence pass at a new threshold (parent owns the envelopes). */
  onThreshold(thresholdMs: number): void
  /** Seekable object URL per take id. */
  videoUrls: Map<string, string>
}

export function Editor({ takes, state, onChange, onThreshold, videoUrls }: EditorProps) {
  const byId = useMemo(() => new Map(takes.map((t) => [t.id, t])), [takes])
  const durations = useMemo(() => new Map(takes.map((t) => [t.id, t.meta.durationMs])), [takes])
  const segments = useMemo(() => editSegments(state, durations), [state, durations])
  const originalMs = takes.reduce((sum, t) => sum + t.meta.durationMs, 0)
  const tightMs = outputDurationMs(segments)
  const activeCuts = state.cuts.filter((c) => c.enabled).length

  const preview = usePreview(segments, videoUrls)

  /** Delete/restore one transcript line as a cut spanning its window. */
  const toggleLine = useCallback(
    (takeId: string, tMs: number, endMs: number) => {
      const id = `line:${takeId}:${Math.round(tMs)}`
      const existing = state.cuts.find((c) => c.id === id)
      onChange(
        existing
          ? { ...state, cuts: state.cuts.filter((c) => c.id !== id) }
          : {
              ...state,
              cuts: [
                ...state.cuts,
                { id, takeId, startMs: tMs, endMs, source: 'line', enabled: true },
              ],
            }
      )
    },
    [state, onChange]
  )

  const toggleCut = useCallback(
    (id: string) => {
      onChange({
        ...state,
        cuts: state.cuts.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)),
      })
    },
    [state, onChange]
  )

  return (
    <div className="space-y-6">
      {/* The readout: what tightening is buying, and the one dial. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="font-mono text-sm">
          <span className="text-muted-foreground line-through">{mmss(originalMs)}</span>
          <span className="text-muted-foreground"> → </span>
          <span className="text-cobalt font-medium">{mmss(tightMs)}</span>
          <span className="text-muted-foreground text-xs">
            {' '}
            · {activeCuts} {activeCuts === 1 ? 'cut' : 'cuts'}
          </span>
        </p>
        <label className="flex items-center gap-3 font-mono text-xs">
          <span className="text-muted-foreground">tighten</span>
          <input
            type="range"
            min={300}
            max={2000}
            step={100}
            value={state.tighten.thresholdMs}
            onChange={(e) => onThreshold(Number(e.target.value))}
            className="accent-cobalt w-40"
            aria-label="Silence threshold"
          />
          <span className="text-muted-foreground w-10 tabular-nums">
            {(state.tighten.thresholdMs / 1000).toFixed(1)}s
          </span>
        </label>
      </div>

      <PreviewPlayer preview={preview} tightMs={tightMs} />

      {/* One flow of words per take, cuts sitting between them as chips. */}
      <div className="space-y-6">
        {state.takeOrder.map((takeId, orderIndex) => {
          const take = byId.get(takeId)
          if (!take) return null
          return (
            <TakeFlow
              key={takeId}
              take={take}
              cuts={state.cuts.filter((c) => c.takeId === takeId)}
              showOrderControls={state.takeOrder.length > 1}
              isFirst={orderIndex === 0}
              isLast={orderIndex === state.takeOrder.length - 1}
              position={orderIndex + 1}
              onMove={(dir) => onChange(moveTake(state, takeId, dir))}
              onToggleLine={toggleLine}
              onToggleCut={toggleCut}
              onSeekLine={(tMs) => {
                const out = sourceToOutputMs(segments, takeId, tMs)
                if (out !== null) preview.seek(out)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── the preview ───────────────────────────────────────────────────────────

interface Preview {
  videoRef: React.RefObject<HTMLVideoElement | null>
  seek(outMs: number): void
  onTimeUpdate(): void
  onEnded(): void
  currentSrc: string | undefined
  playing: boolean
  setPlaying(v: boolean): void
}

/**
 * Plays the edit by walking its segments: within a segment the <video> just
 * plays; when the playhead crosses the segment's end it jumps to the next one
 * (a seek inside the same take, a src swap across takes). A frame or two of
 * slop at each jump is acceptable in a preview — the render is sample-exact.
 */
function usePreview(segments: EditSegment[], videoUrls: Map<string, string>): Preview {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const segIndex = useRef(0)
  const [currentSrc, setCurrentSrc] = useState<string | undefined>(undefined)
  const [playing, setPlaying] = useState(false)

  // Segments changed under the preview (a cut toggled): stay where it makes
  // sense — reset to the first segment rather than chase the old position.
  useEffect(() => {
    segIndex.current = 0
    const first = segments[0]
    setCurrentSrc(first ? videoUrls.get(first.takeId) : undefined)
  }, [segments, videoUrls])

  const enter = useCallback(
    (index: number, offsetMs: number, play: boolean) => {
      const seg = segments[index]
      const video = videoRef.current
      if (!seg || !video) return
      segIndex.current = index
      const src = videoUrls.get(seg.takeId)
      const at = (seg.srcStartMs + offsetMs) / 1000
      if (src && video.currentSrc !== src && currentSrc !== src) {
        setCurrentSrc(src)
        // Seek once the new source can seek; canplay fires after src swap.
        const onCanPlay = () => {
          video.currentTime = at
          if (play) void video.play().catch(() => {})
          video.removeEventListener('canplay', onCanPlay)
        }
        video.addEventListener('canplay', onCanPlay)
        return
      }
      video.currentTime = at
      if (play) void video.play().catch(() => {})
    },
    [segments, videoUrls, currentSrc]
  )

  const seek = useCallback(
    (outMs: number) => {
      let acc = 0
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!
        const len = seg.srcEndMs - seg.srcStartMs
        if (outMs < acc + len) {
          enter(i, outMs - acc, !videoRef.current?.paused)
          return
        }
        acc += len
      }
    },
    [segments, enter]
  )

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current
    const seg = segments[segIndex.current]
    if (!video || !seg) return
    const tMs = video.currentTime * 1000
    if (tMs >= seg.srcEndMs - 40) {
      if (segIndex.current + 1 < segments.length) {
        enter(segIndex.current + 1, 0, !video.paused)
      } else {
        video.pause()
        setPlaying(false)
      }
    } else if (tMs < seg.srcStartMs - 250) {
      // The native scrubber jumped into cut material; snap back into the edit.
      video.currentTime = seg.srcStartMs / 1000
    }
  }, [segments, enter])

  const onEnded = useCallback(() => {
    if (segIndex.current + 1 < segments.length) {
      enter(segIndex.current + 1, 0, true)
    } else {
      setPlaying(false)
    }
  }, [segments, enter])

  return { videoRef, seek, onTimeUpdate, onEnded, currentSrc, playing, setPlaying }
}

function PreviewPlayer({ preview, tightMs }: { preview: Preview; tightMs: number }) {
  if (!preview.currentSrc) {
    return (
      <div className="border-border text-muted-foreground flex h-40 items-center justify-center rounded-md border border-dashed font-mono text-xs">
        the edit removed everything — restore a cut to preview
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <video
        ref={preview.videoRef}
        src={preview.currentSrc}
        controls
        preload="metadata"
        onTimeUpdate={preview.onTimeUpdate}
        onEnded={preview.onEnded}
        onPlay={() => preview.setPlaying(true)}
        onPause={() => preview.setPlaying(false)}
        className="max-h-[420px] w-full rounded-md border bg-black/95"
      />
      <p className="text-muted-foreground font-mono text-xs">
        preview of the tight edit ({mmss(tightMs)}) — jumps land within a frame or two; the render
        is exact
      </p>
    </div>
  )
}

// ── the transcript flow ───────────────────────────────────────────────────

type FlowItem =
  | { kind: 'line'; tMs: number; endMs: number; text: string }
  | { kind: 'cut'; cut: Cut }

function TakeFlow({
  take,
  cuts,
  showOrderControls,
  isFirst,
  isLast,
  position,
  onMove,
  onToggleLine,
  onToggleCut,
  onSeekLine,
}: {
  take: LiveTake
  cuts: Cut[]
  showOrderControls: boolean
  isFirst: boolean
  isLast: boolean
  position: number
  onMove(dir: -1 | 1): void
  onToggleLine(takeId: string, tMs: number, endMs: number): void
  onToggleCut(id: string): void
  onSeekLine(tMs: number): void
}) {
  const lineCutIds = new Set(cuts.filter((c) => c.source === 'line').map((c) => c.id))
  const items: FlowItem[] = [
    // A line missing its duration still covers a window — assume a nominal
    // spoken length so deleting it cuts something rather than nothing.
    ...take.meta.transcript.map(
      (line): FlowItem => ({
        kind: 'line',
        tMs: line.t,
        endMs: line.t + (line.d ?? 1500),
        text: line.text,
      })
    ),
    ...cuts.filter((c) => c.source === 'silence').map((c): FlowItem => ({ kind: 'cut', cut: c })),
  ].sort(
    (a, b) =>
      (a.kind === 'line' ? a.tMs : a.cut.startMs) - (b.kind === 'line' ? b.tMs : b.cut.startMs)
  )

  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-3">
        <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
          take {position} · {mmss(take.meta.durationMs)}
        </p>
        {showOrderControls && (
          <span className="flex gap-1">
            <button
              type="button"
              disabled={isFirst}
              onClick={() => onMove(-1)}
              aria-label={`move take ${position} earlier`}
              className="text-muted-foreground hover:text-foreground text-xs disabled:invisible">
              ↑
            </button>
            <button
              type="button"
              disabled={isLast}
              onClick={() => onMove(1)}
              aria-label={`move take ${position} later`}
              className="text-muted-foreground hover:text-foreground text-xs disabled:invisible">
              ↓
            </button>
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          no words and no silences worth cutting in this take.
        </p>
      ) : (
        <p className="text-[15px] leading-8">
          {items.map((item, i) =>
            item.kind === 'line' ? (
              <LineSpan
                key={`line-${item.tMs}-${i}`}
                item={item}
                struck={lineCutIds.has(`line:${take.id}:${Math.round(item.tMs)}`)}
                onToggle={() => onToggleLine(take.id, item.tMs, item.endMs)}
                onSeek={() => onSeekLine(item.tMs)}
              />
            ) : (
              <GapChip key={item.cut.id} cut={item.cut} onToggle={() => onToggleCut(item.cut.id)} />
            )
          )}
        </p>
      )}
    </section>
  )
}

/**
 * One spoken window. Click seeks the preview; the × on hover strikes the line
 * (and its seconds) from the edit; clicking a struck line restores it.
 */
function LineSpan({
  item,
  struck,
  onToggle,
  onSeek,
}: {
  item: Extract<FlowItem, { kind: 'line' }>
  struck: boolean
  onToggle(): void
  onSeek(): void
}) {
  if (struck) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title="restore this line"
        className="text-muted-foreground/60 mr-1.5 text-left line-through decoration-1 hover:no-underline">
        {item.text}
      </button>
    )
  }
  return (
    <span className="group/line mr-1.5">
      <button type="button" onClick={onSeek} className="hover:bg-accent/60 rounded text-left">
        {item.text}
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-label="cut this line"
        title="cut this line"
        className="text-muted-foreground/0 group-hover/line:text-muted-foreground ml-0.5 align-baseline font-mono text-xs transition-colors hover:!text-red-700">
        ×
      </button>
    </span>
  )
}

/** A tightened silence. Filled chip = being cut; hollow = vetoed, kept in. */
function GapChip({ cut, onToggle }: { cut: Cut; onToggle(): void }) {
  const seconds = ((cut.endMs - cut.startMs) / 1000).toFixed(1)
  return (
    <button
      type="button"
      onClick={onToggle}
      title={cut.enabled ? 'keep this pause' : 'cut this pause'}
      className={cn(
        'mr-1.5 inline-block rounded-full border px-2 align-middle font-mono text-[11px] leading-5 transition-colors',
        cut.enabled
          ? 'border-primary/40 bg-accent text-primary'
          : 'border-border text-muted-foreground line-through'
      )}>
      −{seconds}s
    </button>
  )
}
