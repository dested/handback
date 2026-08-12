// The edit, as data. Non-destructive: raw take webms are never touched; the
// state is take order plus a list of cuts, and everything downstream — the
// preview, the duration readout, the render — reads the same derived segment
// list so they can't disagree about what the tight edit contains.
//
// Built for more than v1 uses: the render walks `EditSegment[]` in array
// order, so arbitrary segment reordering is already legal downstream — the UI
// just doesn't produce it yet (owner: remove-only + whole-take reorder now,
// "get ready for the full thing soon").

export type CutSource = 'silence' | 'line' | 'manual'

/** A span of one take that the edit removes. Milliseconds, take-local. */
export interface Cut {
  id: string
  takeId: string
  startMs: number
  endMs: number
  /** What proposed it: the silence pass, a deleted transcript line, or a hand. */
  source: CutSource
  /** A vetoed cut stays in the list (so the chip can be un-vetoed) but doesn't cut. */
  enabled: boolean
}

export interface TightenOptions {
  /** A silence must be at least this long before it's worth cutting. */
  thresholdMs: number
  /** Breathing room left on each side of kept sound. */
  padMs: number
}

/** The whole edit — what persists to IDB while editing and ships as edit.json. */
export interface EditState {
  version: 1
  /** Output order of takes, by take id. */
  takeOrder: string[]
  cuts: Cut[]
  tighten: TightenOptions
}

/** One kept span, in output order. The render and the preview both walk this. */
export interface EditSegment {
  takeId: string
  srcStartMs: number
  srcEndMs: number
}

export const DEFAULT_TIGHTEN: TightenOptions = { thresholdMs: 800, padMs: 200 }

/** Below this a kept sliver is a visual pop, not content. */
const MIN_SEGMENT_MS = 150

export function initialEditState(takeIds: string[]): EditState {
  return { version: 1, takeOrder: [...takeIds], cuts: [], tighten: { ...DEFAULT_TIGHTEN } }
}

/** Enabled cuts of one take, merged where they touch or overlap, ascending. */
export function mergedCuts(
  state: EditState,
  takeId: string
): Array<{ startMs: number; endMs: number }> {
  const spans = state.cuts
    .filter((c) => c.enabled && c.takeId === takeId && c.endMs > c.startMs)
    .sort((a, b) => a.startMs - b.startMs)
  const merged: Array<{ startMs: number; endMs: number }> = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.startMs <= last.endMs) last.endMs = Math.max(last.endMs, span.endMs)
    else merged.push({ startMs: span.startMs, endMs: span.endMs })
  }
  return merged
}

/**
 * The kept spans, in output order: takes in `takeOrder`, each minus its merged
 * cuts. `durations` maps take id → full duration in ms.
 */
export function editSegments(state: EditState, durations: Map<string, number>): EditSegment[] {
  const out: EditSegment[] = []
  for (const takeId of state.takeOrder) {
    const durationMs = durations.get(takeId)
    if (durationMs === undefined || durationMs <= 0) continue
    let cursor = 0
    for (const cut of mergedCuts(state, takeId)) {
      const start = Math.max(0, Math.min(cut.startMs, durationMs))
      const end = Math.max(0, Math.min(cut.endMs, durationMs))
      if (start - cursor >= MIN_SEGMENT_MS) {
        out.push({ takeId, srcStartMs: cursor, srcEndMs: start })
      }
      cursor = Math.max(cursor, end)
    }
    if (durationMs - cursor >= MIN_SEGMENT_MS) {
      out.push({ takeId, srcStartMs: cursor, srcEndMs: durationMs })
    }
  }
  return out
}

export function outputDurationMs(segments: EditSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.srcEndMs - s.srcStartMs), 0)
}

/**
 * Where a take-local source moment lands on the output timeline, or null when
 * the edit cut it. Feeds transcript-line seeking in the preview.
 */
export function sourceToOutputMs(
  segments: EditSegment[],
  takeId: string,
  srcMs: number
): number | null {
  let acc = 0
  for (const seg of segments) {
    if (seg.takeId === takeId && srcMs >= seg.srcStartMs && srcMs < seg.srcEndMs) {
      return acc + (srcMs - seg.srcStartMs)
    }
    acc += seg.srcEndMs - seg.srcStartMs
  }
  return null
}

/** Move a take one step up/down in the output order. */
export function moveTake(state: EditState, takeId: string, dir: -1 | 1): EditState {
  const order = [...state.takeOrder]
  const i = order.indexOf(takeId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return state
  ;[order[i], order[j]] = [order[j], order[i]]
  return { ...state, takeOrder: order }
}

/** What comes back out of IndexedDB is untrusted — a bad shape reads as "no saved edit". */
export function parseEditState(value: unknown, takeIds: string[]): EditState | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Partial<EditState>
  if (v.version !== 1 || !Array.isArray(v.takeOrder) || !Array.isArray(v.cuts)) return null
  // The saved order must describe exactly today's takes — a stale edit from a
  // session whose takes changed underneath it is worse than starting over.
  const order = v.takeOrder.filter((id): id is string => typeof id === 'string')
  if (order.length !== takeIds.length || takeIds.some((id) => !order.includes(id))) return null
  const cuts = v.cuts.filter(
    (c): c is Cut =>
      typeof c === 'object' &&
      c !== null &&
      typeof (c as Cut).id === 'string' &&
      typeof (c as Cut).takeId === 'string' &&
      typeof (c as Cut).startMs === 'number' &&
      typeof (c as Cut).endMs === 'number' &&
      typeof (c as Cut).enabled === 'boolean' &&
      ['silence', 'line', 'manual'].includes((c as Cut).source)
  )
  const tighten =
    typeof v.tighten === 'object' &&
    v.tighten !== null &&
    typeof v.tighten.thresholdMs === 'number' &&
    typeof v.tighten.padMs === 'number'
      ? v.tighten
      : { ...DEFAULT_TIGHTEN }
  return { version: 1, takeOrder: order, cuts, tighten }
}

/** Replace every silence cut with a freshly detected set (tighten re-run). */
export function withSilenceCuts(state: EditState, cuts: Cut[]): EditState {
  // A silence the person explicitly vetoed stays vetoed across re-runs when the
  // same span is proposed again — matching is by take + rough position.
  const vetoed = state.cuts.filter((c) => c.source === 'silence' && !c.enabled)
  const stillVetoed = (cut: Cut) =>
    vetoed.some((v) => v.takeId === cut.takeId && Math.abs(v.startMs - cut.startMs) < 250)
  return {
    ...state,
    cuts: [
      ...state.cuts.filter((c) => c.source !== 'silence'),
      ...cuts.map((c) => (stillVetoed(c) ? { ...c, enabled: false } : c)),
    ],
  }
}
