import { describe, expect, test } from 'bun:test'
import * as extension from '../../../extension/src/offscreen/voice'
import * as web from './voice'

/** One reading every STEP ms over [from, to), at whatever level `at(t)` says. */
const STEP = 50

interface Gate {
  push(t: number, rms: number): { kind: 'open' | 'close'; t: number } | null
  finish(t: number): { kind: 'open' | 'close'; t: number } | null
  readonly speaking: boolean
}

function feed(gate: Gate, from: number, to: number, at: (t: number) => number) {
  const edges: { kind: 'open' | 'close'; t: number; at: number }[] = []
  for (let t = from; t < to; t += STEP) {
    const edge = gate.push(t, at(t))
    if (edge) edges.push({ ...edge, at: t })
  }
  return edges
}

const ROOM = 0.001
const VOICE = 0.05
/** Speech over these spans, the room everywhere else. */
const spans =
  (...on: [number, number][]) =>
  (t: number) =>
    on.some(([a, b]) => t >= a && t < b) ? VOICE : ROOM

// The web recorder's copy and the extension's must behave identically.
for (const [name, impl] of [
  ['web', web],
  ['extension', extension],
] as const) {
  describe(`VoiceGate (${name})`, () => {
    test('a quiet room opens nothing', () => {
      const gate = new impl.VoiceGate()
      expect(feed(gate, 0, 30_000, (t) => ROOM * (1 + 0.3 * Math.sin(t / 170)))).toEqual([])
      expect(gate.speaking).toBe(false)
    })

    test('a line is stamped where the speech began and where it stopped', () => {
      const gate = new impl.VoiceGate()
      const edges = feed(gate, 0, 8000, spans([2000, 4000]))
      expect(edges.map(({ kind, t }) => ({ kind, t }))).toEqual([
        { kind: 'open', t: 2000 },
        { kind: 'close', t: 4000 },
      ])
      // Confirmed ONSET_MS and HANGOVER_MS later, not before.
      expect(edges[0]?.at).toBe(2000 + impl.ONSET_MS)
      expect(edges[1]?.at).toBe(4000 + impl.HANGOVER_MS)
    })

    test('a blip shorter than the onset is not speech', () => {
      const gate = new impl.VoiceGate()
      expect(feed(gate, 0, 6000, spans([2000, 2150]))).toEqual([])
    })

    test('a pause shorter than the hangover stays one line', () => {
      const gate = new impl.VoiceGate()
      const edges = feed(gate, 0, 8000, spans([2000, 3000], [3400, 5000]))
      expect(edges.map((e) => e.kind)).toEqual(['open', 'close'])
      expect(edges[1]?.t).toBe(5000)
    })

    test('a longer pause ends one line and the next speech opens another', () => {
      const gate = new impl.VoiceGate()
      const edges = feed(gate, 0, 8000, spans([2000, 3000], [3800, 5000]))
      expect(edges.map(({ kind, t }) => ({ kind, t }))).toEqual([
        { kind: 'open', t: 2000 },
        { kind: 'close', t: 3000 },
        { kind: 'open', t: 3800 },
        { kind: 'close', t: 5000 },
      ])
    })

    test('nothing opens during warm-up; the line keeps where it began', () => {
      const gate = new impl.VoiceGate()
      const edges = feed(gate, 0, 4000, spans([500, 2500]))
      expect(edges[0]).toEqual({ kind: 'open', t: 500, at: impl.WARMUP_MS })
    })

    test('talking from the first moment is heard once the room shows itself', () => {
      const gate = new impl.VoiceGate()
      // The floor starts on the voice, so the first stretch is the "room" until a pause.
      const edges = feed(gate, 0, 9000, spans([0, 3000], [5000, 6000]))
      expect(edges.map(({ kind, t }) => ({ kind, t }))).toEqual([
        { kind: 'open', t: 5000 },
        { kind: 'close', t: 6000 },
      ])
    })

    test('a noisy room sets its own bar', () => {
      const gate = new impl.VoiceGate()
      const noisy = 0.02
      const edges = feed(gate, 0, 12_000, (t) => (t >= 6000 && t < 8000 ? 0.12 : noisy))
      expect(edges.map(({ kind, t }) => ({ kind, t }))).toEqual([
        { kind: 'open', t: 6000 },
        { kind: 'close', t: 8000 },
      ])
    })

    test('a fan switching on is absorbed instead of reading as one endless line', () => {
      const gate = new impl.VoiceGate()
      const edges = feed(gate, 0, 40_000, (t) => (t < 3000 ? ROOM : 0.006))
      expect(edges.map((e) => e.kind)).toEqual(['open', 'close'])
      expect(edges[1]?.t ?? Infinity).toBeLessThan(16_000)
      expect(gate.speaking).toBe(false)
    })

    test('finish closes an open line at the end, or where the quiet began', () => {
      const talking = new impl.VoiceGate()
      feed(talking, 0, 5000, spans([2000, 9000]))
      expect(talking.finish(5000)).toEqual({ kind: 'close', t: 5000 })
      expect(talking.finish(5100)).toBeNull()

      const trailing = new impl.VoiceGate()
      feed(trailing, 0, 4300, spans([2000, 4000]))
      expect(trailing.speaking).toBe(true)
      expect(trailing.finish(4300)).toEqual({ kind: 'close', t: 4000 })
    })

    test('rmsOf', () => {
      expect(impl.rmsOf(new Float32Array(0))).toBe(0)
      expect(impl.rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5)
    })
  })
}
