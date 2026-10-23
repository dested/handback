import { describe, expect, test } from 'bun:test'
import { readRecordingJson } from '@dested/video-to-prompt'
import type { RecordingBrief } from './brief'
import {
  closeUpNote,
  closeUpsOf,
  evidenceImages,
  imageLabel,
  visionBatches,
  withBases,
} from './frame-labels'

// A take as library 1.2 writes it: frame 3 is a close-up on frame 2, frame 4
// came back into view later (seenMs).
const take = readRecordingJson({
  format: 'video-to-prompt/2',
  recording: {
    dir: 'rec-01',
    durationMs: 30000,
    frames: [
      { index: 1, tMs: 0, file: 'frames/01-0000.jpg', reason: 'start' },
      { index: 2, tMs: 9000, file: 'frames/02-0009.jpg', reason: 'change' },
      {
        index: 3,
        tMs: 12000,
        file: 'frames/03-0012.jpg',
        reason: 'change',
        detail: { of: 2, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      },
      {
        index: 4,
        tMs: 15000,
        file: 'frames/04-0015.jpg',
        reason: 'change',
        seenMs: [[20000, 25000]],
      },
    ],
    transcript: [],
    events: [],
  },
})

describe('closeUpsOf', () => {
  test('maps each close-up to its base frame, by path', () => {
    expect(take).not.toBeNull()
    const closeUps = take ? closeUpsOf([take.recording]) : {}
    expect(closeUps).toEqual({
      'rec-01/frames/03-0012.jpg': { of: 2, path: 'rec-01/frames/02-0009.jpg' },
    })
  })

  test('the reader keeps seen spans', () => {
    expect(take?.recording.meta.frames[3]?.seen).toEqual([[20000, 25000]])
  })
})

const brief: RecordingBrief = {
  recordingMd: '',
  startHere: [
    { path: 'rec-01/frames/03-0012.jpg', atMs: 12000, what: 'a close-up (top left)' },
    { path: 'rec-01/frames/02-0009.jpg', atMs: 9000, what: 'changed middle' },
    { path: 'rec-01/frames/04-0015.jpg', atMs: 15000, what: 'changed' },
  ],
  evidence: {
    kp1: { frame: { path: 'rec-01/frames/04-0015.jpg', atMs: 15000, what: 'changed' } },
  },
  frameAt: {
    'rec-01/frames/02-0009.jpg': 9000,
    'rec-01/frames/03-0012.jpg': 12000,
    'rec-01/frames/04-0015.jpg': 15000,
  },
  closeUps: { 'rec-01/frames/03-0012.jpg': { of: 2, path: 'rec-01/frames/02-0009.jpg' } },
}

describe('evidence images', () => {
  test('a close-up brings its base in just before it, once', () => {
    const set = evidenceImages(brief, [{ id: 'kp1' }])
    expect(set.map((e) => e.path)).toEqual([
      'rec-01/frames/04-0015.jpg',
      'rec-01/frames/02-0009.jpg',
      'rec-01/frames/03-0012.jpg',
    ])
    // The base was also a Start here frame: it keeps both reasons.
    expect(set[1]?.tags).toEqual(['base of rec-01/frames/03-0012.jpg', 'start here'])
  })

  test('a close-up is labelled with its base whether or not it is evidence', () => {
    const note =
      'close-up of frame 2 (rec-01/frames/02-0009.jpg): the screen then was that frame except this region'
    expect(closeUpNote({ of: 2, path: 'rec-01/frames/02-0009.jpg' })).toBe(note)
    expect(imageLabel('rec-01/frames/03-0012.jpg', brief, undefined)).toBe(
      `rec-01/frames/03-0012.jpg · 0:12 · ${note}`
    )
    const entry = evidenceImages(brief, []).find((e) => e.path === 'rec-01/frames/03-0012.jpg')
    expect(imageLabel('rec-01/frames/03-0012.jpg', brief, entry)).toBe(
      `rec-01/frames/03-0012.jpg · 0:12 · start here · ${note} · a close-up (top left)`
    )
  })

  test('a whole-screen frame reads as before', () => {
    expect(imageLabel('rec-01/frames/04-0015.jpg', brief, undefined)).toBe(
      'rec-01/frames/04-0015.jpg · 0:15'
    )
    const base = evidenceImages(brief, []).find((e) => e.path === 'rec-01/frames/02-0009.jpg')
    expect(imageLabel('rec-01/frames/02-0009.jpg', brief, base)).toBe(
      'rec-01/frames/02-0009.jpg · 0:09 · base of rec-01/frames/03-0012.jpg · start here · changed middle'
    )
  })
})

describe('withBases', () => {
  const closeUps = { c: { of: 1, path: 'b' }, d: { of: 1, path: 'b' } }

  test('the base comes first, only once', () => {
    expect(withBases(['a', 'c', 'd'], closeUps, 6)).toEqual([
      { path: 'a' },
      { path: 'b', baseOf: 'c' },
      { path: 'c' },
      { path: 'd' },
    ])
  })

  test('a base already in the list is not brought in again', () => {
    expect(withBases(['b', 'c'], closeUps, 6)).toEqual([{ path: 'b' }, { path: 'c' }])
  })

  test('the cap never splits a base from its close-up', () => {
    expect(withBases(['a', 'x', 'c'], closeUps, 3)).toEqual([{ path: 'a' }, { path: 'x' }])
  })
})

describe('visionBatches', () => {
  type F = { path: string; base: F | null }
  const f = (path: string, base: F | null = null): F => ({ path, base })
  const b = f('b')

  test('a close-up whose base is in the request is sent alone', () => {
    const batches = visionBatches([f('a'), b, f('c', b)], 12)
    expect(batches.map((x) => x.map((y) => y.path))).toEqual([['a', 'b', 'c']])
  })

  test('a base from an earlier request is sent again beside its close-up', () => {
    const batches = visionBatches([f('a'), b, f('x'), f('c', b)], 3)
    expect(batches.map((x) => x.map((y) => y.path))).toEqual([
      ['a', 'b', 'x'],
      ['b', 'c'],
    ])
  })

  test('a base and its close-up never straddle two requests', () => {
    const batches = visionBatches([f('a'), f('x'), f('c', b)], 3)
    expect(batches.map((x) => x.map((y) => y.path))).toEqual([
      ['a', 'x'],
      ['b', 'c'],
    ])
  })
})
