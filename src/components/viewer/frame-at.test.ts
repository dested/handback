import { describe, expect, test } from 'bun:test'
import { frameAt, type FrameTiming } from './frame-at'

describe('frameAt', () => {
  const plain: FrameTiming[] = [{ atMs: 0 }, { atMs: 5000 }, { atMs: 9000 }]

  test('the latest capture at or before the moment', () => {
    expect(frameAt(plain, 0)).toBe(0)
    expect(frameAt(plain, 4999)).toBe(0)
    expect(frameAt(plain, 5000)).toBe(1)
    expect(frameAt(plain, 60_000)).toBe(2)
  })

  test('-1 before the first frame', () => {
    expect(frameAt([{ atMs: 250 }], 100)).toBe(-1)
    expect(frameAt([], 100)).toBe(-1)
  })

  test('a seen span brings an older frame back over a newer one', () => {
    // Frame 0 is the top of the page; frame 1 scrolled down; 12–20s scrolled back up.
    const frames: FrameTiming[] = [{ atMs: 0, seen: [[12_000, 20_000]] }, { atMs: 5000 }]
    expect(frameAt(frames, 8000)).toBe(1)
    expect(frameAt(frames, 12_000)).toBe(0)
    expect(frameAt(frames, 19_999)).toBe(0)
    expect(frameAt(frames, 20_000)).toBe(1)
  })

  test('a frame captured inside a seen span shows over the stand-in', () => {
    // Frame 2 is a close-up of frame 0, taken while frame 0 was back on screen.
    const frames: FrameTiming[] = [
      { atMs: 0, seen: [[12_000, 20_000]] },
      { atMs: 5000 },
      { atMs: 15_000 },
    ]
    expect(frameAt(frames, 13_000)).toBe(0)
    expect(frameAt(frames, 15_000)).toBe(2)
    expect(frameAt(frames, 19_000)).toBe(2)
  })

  test('the most recent of two covering spans wins', () => {
    const frames: FrameTiming[] = [
      { atMs: 0, seen: [[10_000, 30_000]] },
      { atMs: 2000, seen: [[20_000, 25_000]] },
      { atMs: 4000 },
    ]
    expect(frameAt(frames, 15_000)).toBe(0)
    expect(frameAt(frames, 22_000)).toBe(1)
    expect(frameAt(frames, 27_000)).toBe(0)
  })

  test('a transient that had gone gives the screen back', () => {
    // Frame 1 is a toast (a close-up of frame 0) that lasted 250 ms.
    const frames: FrameTiming[] = [
      { atMs: 0 },
      { atMs: 5000, held: 250, transient: true },
      { atMs: 9000 },
    ]
    expect(frameAt(frames, 5100)).toBe(1)
    expect(frameAt(frames, 5250)).toBe(0)
    expect(frameAt(frames, 9000)).toBe(2)
  })
})
