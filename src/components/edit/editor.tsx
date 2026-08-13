// The scrubber-first editor for a human handback. The timeline below the player
// is the edit surface: every take laid end to end at full length, cuts drawn ON
// that axis as removed spans, and a tag above each one toggling it back in. The
// transcript beside the player is the second way in — striking a line cuts its
// seconds, clicking one seeks. A stretch nobody spoke over is cut by hand:
// ⇧-drag the timeline, or mark an in-point and cut from there to the playhead.
// There is still no drag-SELECTION of any kind (owner verdict, decisions.md
// 2026-08-01) — a carve commits on release and nothing stays selected.
//
// TWO CLOCKS, and everything here is a translation between them. The *output*
// clock is the edit with its cuts removed — the player's clock, what
// `editSegments` sums to. The *source-global* clock is the takes in
// `state.takeOrder` laid end to end at FULL length — the timeline's clock, the
// one a cut can sit on without moving the frames either side of it. The player
// speaks output, the timeline speaks source, and `outputToSource` /
// `sourceToOutput` are the only bridges. Nothing else may invent a third.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SectionHead } from '~/components/viewer/section-head'
import {
  Timeline,
  type TimelineCut,
  type TimelineFrame,
  type TimelineTake,
  type TimelineVoiceBar,
} from '~/components/viewer/timeline'
import { useSegmentPlayer } from '~/components/viewer/use-segment-player'
import { mmss } from '~/lib/capture/format'
import type { LiveTake } from '~/lib/capture/live-store'
import {
  editSegments,
  moveTake,
  outputDurationMs,
  sourceToOutputMs,
  type Cut,
  type EditState,
} from '~/lib/edit/edl'
import type { Envelope } from '~/lib/edit/silence'
import { extractThumbs, thumbCount } from '~/lib/edit/thumbs'

export interface EditorProps {
  takes: LiveTake[]
  state: EditState
  onChange(next: EditState): void
  /** Re-run the silence pass at a new threshold (parent owns the envelopes). */
  onThreshold(thresholdMs: number): void
  /** Seekable object URL per take id. */
  videoUrls: Map<string, string>
  /** Loudness per take, when the caller decoded one; missing/null takes fall back to transcript density. */
  envelopes?: Map<string, Envelope | null>
}

/** One voice bar per this much source — fine enough to read as speech rhythm. */
const VOICE_STEP_MS = 500

/** A line missing its duration still covers a window; assume a nominal one. */
const NOMINAL_LINE_MS = 1500

export function Editor({ takes, state, onChange, onThreshold, videoUrls, envelopes }: EditorProps) {
  const byId = useMemo(() => new Map(takes.map((t) => [t.id, t])), [takes])
  const durations = useMemo(() => new Map(takes.map((t) => [t.id, t.meta.durationMs])), [takes])
  const segments = useMemo(() => editSegments(state, durations), [state, durations])
  const originalMs = takes.reduce((sum, t) => sum + t.meta.durationMs, 0)
  const tightMs = outputDurationMs(segments)
  const activeCuts = state.cuts.filter((c) => c.enabled).length

  /** Where each take starts on the source-global axis, and its whole length. */
  const { offsets, totalMs } = useMemo(() => {
    const offsets = new Map<string, number>()
    let totalMs = 0
    for (const takeId of state.takeOrder) {
      const durationMs = durations.get(takeId)
      if (durationMs === undefined) continue
      offsets.set(takeId, totalMs)
      totalMs += durationMs
    }
    return { offsets, totalMs }
  }, [state.takeOrder, durations])

  const player = useSegmentPlayer(segments, videoUrls)

  const outputToSource = useCallback(
    (outMs: number): number => {
      let acc = 0
      for (const seg of segments) {
        const len = seg.srcEndMs - seg.srcStartMs
        if (outMs < acc + len) {
          return (offsets.get(seg.takeId) ?? 0) + seg.srcStartMs + (outMs - acc)
        }
        acc += len
      }
      const last = segments[segments.length - 1]
      return last ? (offsets.get(last.takeId) ?? 0) + last.srcEndMs : 0
    },
    [segments, offsets]
  )

  const sourceToOutput = useCallback(
    (sourceMs: number): number => {
      for (const takeId of state.takeOrder) {
        const offset = offsets.get(takeId)
        const durationMs = durations.get(takeId)
        if (offset === undefined || durationMs === undefined) continue
        if (sourceMs < offset || sourceMs >= offset + durationMs) continue
        const out = sourceToOutputMs(segments, takeId, sourceMs - offset)
        if (out !== null) return out
        break
      }
      // Landed inside a cut (or past the last take): the next kept frame is the
      // honest answer — the edit has nothing to show where the scrub pointed.
      let acc = 0
      for (const seg of segments) {
        if ((offsets.get(seg.takeId) ?? 0) + seg.srcStartMs >= sourceMs) return acc
        acc += seg.srcEndMs - seg.srcStartMs
      }
      return tightMs
    },
    [state.takeOrder, offsets, durations, segments, tightMs]
  )

  const thumbs = useThumbs(state.takeOrder, durations, videoUrls)

  const timelineTakes = useMemo<TimelineTake[]>(
    () =>
      state.takeOrder.flatMap((takeId, index) => {
        const offsetMs = offsets.get(takeId)
        const durationMs = durations.get(takeId)
        if (offsetMs === undefined || durationMs === undefined) return []
        return [
          { id: takeId, label: `take ${index + 1} · ${mmss(durationMs)}`, offsetMs, durationMs },
        ]
      }),
    [state.takeOrder, offsets, durations]
  )

  const timelineCuts = useMemo<TimelineCut[]>(
    () =>
      state.cuts.flatMap((cut) => {
        const offset = offsets.get(cut.takeId)
        if (offset === undefined) return []
        return [
          {
            id: cut.id,
            startMs: offset + cut.startMs,
            endMs: offset + cut.endMs,
            enabled: cut.enabled,
          },
        ]
      }),
    [state.cuts, offsets]
  )

  const frames = useMemo<TimelineFrame[]>(() => {
    const out: TimelineFrame[] = []
    for (const takeId of state.takeOrder) {
      const offset = offsets.get(takeId)
      const durationMs = durations.get(takeId)
      if (offset === undefined || durationMs === undefined || durationMs <= 0) continue
      const extracted = thumbs.get(takeId)
      if (extracted) {
        for (const thumb of extracted) out.push({ atMs: offset + thumb.atMs, url: thumb.url })
        continue
      }
      // Still decoding: hold the strip's shape with placeholders so the lane
      // doesn't jump under the pointer when the real frames land.
      const count = thumbCount(durationMs)
      for (let i = 0; i < count; i++) {
        out.push({ atMs: offset + ((i + 0.5) * durationMs) / count, url: null })
      }
    }
    return out
  }, [state.takeOrder, offsets, durations, thumbs])

  /** The take's own loud end — a quiet room and a loud one draw the same height. */
  const loudBy = useMemo(() => {
    const map = new Map<string, number>()
    if (!envelopes) return map
    for (const [takeId, envelope] of envelopes) {
      if (envelope) map.set(takeId, percentile95(envelope.rms))
    }
    return map
  }, [envelopes])

  const voice = useMemo<TimelineVoiceBar[]>(() => {
    const out: TimelineVoiceBar[] = []
    for (const takeId of state.takeOrder) {
      const take = byId.get(takeId)
      const offset = offsets.get(takeId)
      if (!take || offset === undefined) continue
      const envelope = envelopes?.get(takeId) ?? null
      const loud = loudBy.get(takeId) ?? 0
      const spoken = take.meta.transcript.map((line) => ({
        startMs: line.t,
        endMs: line.t + (line.d ?? NOMINAL_LINE_MS),
      }))
      for (let t = 0; t < take.meta.durationMs; t += VOICE_STEP_MS) {
        const atMs = offset + t
        if (envelope) {
          const index = Math.min(
            Math.max(0, Math.floor(t / envelope.windowMs)),
            envelope.rms.length - 1
          )
          const rms = envelope.rms[index] ?? 0
          out.push({ atMs, level: loud > 0 ? Math.min(1, rms / loud) : 0 })
        } else {
          // No decoded audio for this take: the words are the only evidence of
          // voice there is, so draw their windows as a deterministic rhythm.
          const speaking = spoken.some((w) => t >= w.startMs && t < w.endMs)
          out.push({ atMs, level: speaking ? 0.35 + 0.6 * Math.abs(Math.sin(atMs / 700)) : 0.08 })
        }
      }
    }
    return out
  }, [state.takeOrder, byId, offsets, envelopes, loudBy])

  /** Line cuts currently in force — the transcript reads its strikes off this. */
  const struckLines = useMemo(
    () => new Set(state.cuts.filter((c) => c.source === 'line' && c.enabled).map((c) => c.id)),
    [state.cuts]
  )

  /** Delete/restore one transcript line as a cut spanning its window. */
  const toggleLine = useCallback(
    (takeId: string, tMs: number, endMs: number) => {
      const id = `line:${takeId}:${Math.round(tMs)}`
      const existing = state.cuts.find((c) => c.id === id)
      // Three states, because the timeline tag can veto a line cut without
      // deleting it: struck → remove the cut; vetoed → strike it again (the
      // transcript shows it un-struck, so the click must visibly cut); absent →
      // add it enabled.
      onChange(
        existing
          ? existing.enabled
            ? { ...state, cuts: state.cuts.filter((c) => c.id !== id) }
            : {
                ...state,
                cuts: state.cuts.map((c) => (c.id === id ? { ...c, enabled: true } : c)),
              }
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

  /** Cut a source-global span by hand. It may cross seams, so it splits per take. */
  const addManualCut = useCallback(
    (startMs: number, endMs: number) => {
      const cuts: Cut[] = []
      for (const takeId of state.takeOrder) {
        const offset = offsets.get(takeId)
        const durationMs = durations.get(takeId)
        if (offset === undefined || durationMs === undefined) continue
        const localStart = Math.max(0, startMs - offset)
        const localEnd = Math.min(durationMs, endMs - offset)
        if (localEnd - localStart < 100) continue
        cuts.push({
          id: `manual:${takeId}:${Math.round(localStart)}-${Math.round(localEnd)}`,
          takeId,
          startMs: localStart,
          endMs: localEnd,
          source: 'manual',
          enabled: true,
        })
      }
      if (cuts.length === 0) return
      onChange({
        ...state,
        cuts: [...state.cuts.filter((c) => !cuts.some((n) => n.id === c.id)), ...cuts],
      })
    },
    [state, onChange, offsets, durations]
  )

  const toggleCut = useCallback(
    (id: string) => {
      const cut = state.cuts.find((c) => c.id === id)
      if (!cut) return
      // A silence cut lingers vetoed so a re-tighten remembers it, and a line cut
      // belongs to its transcript line. A manual cut has no other owner, so an
      // off one would be an immortal ghost: its tag deletes it instead.
      onChange(
        cut.source === 'manual' && cut.enabled
          ? { ...state, cuts: state.cuts.filter((c) => c.id !== id) }
          : {
              ...state,
              cuts: state.cuts.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)),
            }
      )
    },
    [state, onChange]
  )

  const playheadSourceMs = outputToSource(player.outputMs)

  /** The in-point of a hand cut, source-global; null when none is marked. */
  const [inPointMs, setInPointMs] = useState<number | null>(null)

  // A reorder moves the source axis under the mark, so the mark can't survive it.
  useEffect(() => setInPointMs(null), [state.takeOrder])

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
        <div className="flex items-center gap-2 font-mono text-xs">
          {inPointMs === null ? (
            <button
              type="button"
              onClick={() => setInPointMs(playheadSourceMs)}
              className="text-muted-foreground hover:text-foreground underline underline-offset-4">
              cut from here
            </button>
          ) : (
            <>
              <span className="text-muted-foreground">cutting from {mmss(inPointMs)}</span>
              <button
                type="button"
                onClick={() => {
                  const a = Math.min(inPointMs, playheadSourceMs)
                  const b = Math.max(inPointMs, playheadSourceMs)
                  if (b - a >= 250) addManualCut(a, b)
                  setInPointMs(null)
                }}
                className="text-cobalt underline underline-offset-4">
                to here
              </button>
              <button
                type="button"
                onClick={() => setInPointMs(null)}
                className="text-muted-foreground hover:text-foreground">
                cancel
              </button>
            </>
          )}
        </div>
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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          {player.currentSrc ? (
            <video
              ref={player.videoRef}
              controls
              preload="metadata"
              src={player.currentSrc}
              onTimeUpdate={player.onTimeUpdate}
              onEnded={player.onEnded}
              onPlay={player.onPlay}
              onPause={player.onPause}
              className="max-h-[420px] w-full rounded-md border bg-black/95"
            />
          ) : (
            <div className="border-border text-muted-foreground flex h-40 items-center justify-center rounded-md border border-dashed font-mono text-xs">
              the edit removed everything — restore a cut to preview
            </div>
          )}
          <p className="text-muted-foreground font-mono text-xs">
            preview of the tight edit ({mmss(tightMs)}) — jumps land within a frame or two; the
            render is exact
          </p>
        </div>

        <div className="space-y-2 lg:col-span-1">
          <SectionHead>transcript</SectionHead>
          <div className="max-h-[420px] space-y-5 overflow-y-auto">
            {state.takeOrder.map((takeId, orderIndex) => {
              const take = byId.get(takeId)
              if (!take) return null
              return (
                <TakeFlow
                  key={takeId}
                  take={take}
                  position={orderIndex + 1}
                  struck={struckLines}
                  onToggleLine={toggleLine}
                  onSeekLine={(tMs) => {
                    const out = sourceToOutputMs(segments, takeId, tMs)
                    if (out !== null) player.seekOutput(out)
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      <Timeline
        totalMs={totalMs}
        takes={timelineTakes}
        frames={frames}
        voice={voice}
        cuts={timelineCuts}
        playheadMs={playheadSourceMs}
        markMs={inPointMs}
        onScrub={(ms) => player.seekOutput(sourceToOutput(ms))}
        onCarve={addManualCut}
        onToggleCut={toggleCut}
        onMoveTake={(id, dir) => onChange(moveTake(state, id, dir))}
      />
    </div>
  )
}

// ── the filmstrip ─────────────────────────────────────────────────────────

interface Thumb {
  atMs: number
  url: string
}

/**
 * Frames for the strip, decoded in this tab one take at a time — parallel
 * decodes of several webms is how a laptop starts dropping the preview. A take
 * that yields nothing still lands as an empty array: "done, no frames" and
 * "not tried yet" have to be distinguishable or the effect retries forever.
 */
function useThumbs(
  takeOrder: string[],
  durations: Map<string, number>,
  videoUrls: Map<string, string>
): Map<string, Thumb[]> {
  const [thumbs, setThumbs] = useState<Map<string, Thumb[]>>(new Map())

  // Read through refs inside the run: a take landing must not restart it, and
  // durations never change for an id that already has frames.
  const done = useRef(thumbs)
  done.current = thumbs
  const order = useRef(takeOrder)
  order.current = takeOrder
  const lengths = useRef(durations)
  lengths.current = durations

  const ids = takeOrder.join('|')
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      for (const takeId of order.current) {
        if (controller.signal.aborted) return
        if (done.current.has(takeId)) continue
        const url = videoUrls.get(takeId)
        const durationMs = lengths.current.get(takeId)
        if (!url || durationMs === undefined || durationMs <= 0) continue
        const frames = await extractThumbs(
          url,
          durationMs,
          thumbCount(durationMs),
          controller.signal
        )
        if (controller.signal.aborted) return
        setThumbs((prev) => new Map(prev).set(takeId, frames))
      }
    })()
    return () => controller.abort()
  }, [ids, videoUrls])

  return thumbs
}

function percentile95(rms: Float32Array): number {
  if (rms.length === 0) return 0
  const sorted = Float32Array.from(rms).sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? 0
}

// ── the transcript rail ───────────────────────────────────────────────────

interface Line {
  tMs: number
  endMs: number
  text: string
}

function TakeFlow({
  take,
  position,
  struck,
  onToggleLine,
  onSeekLine,
}: {
  take: LiveTake
  position: number
  /** Ids of every enabled line cut in the edit; ids carry their take. */
  struck: Set<string>
  onToggleLine(takeId: string, tMs: number, endMs: number): void
  onSeekLine(tMs: number): void
}) {
  const lines: Line[] = take.meta.transcript.map((line) => ({
    tMs: line.t,
    endMs: line.t + (line.d ?? NOMINAL_LINE_MS),
    text: line.text,
  }))

  return (
    <section className="space-y-2">
      <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
        take {position} · {mmss(take.meta.durationMs)}
      </p>

      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">no words in this take.</p>
      ) : (
        <p className="text-[15px] leading-8">
          {lines.map((line, i) => (
            <LineSpan
              key={`line-${line.tMs}-${i}`}
              item={line}
              struck={struck.has(`line:${take.id}:${Math.round(line.tMs)}`)}
              onToggle={() => onToggleLine(take.id, line.tMs, line.endMs)}
              onSeek={() => onSeekLine(line.tMs)}
            />
          ))}
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
  item: Line
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
        className="text-muted-foreground/0 group-hover/line:text-muted-foreground hover:!text-destructive ml-0.5 align-baseline font-mono text-xs transition-colors">
        ×
      </button>
    </span>
  )
}
