import { describe, expect, test } from 'bun:test';
import type { PointerSample } from '../lib/types';
import { mapPointer, POINTER_RING_MS, POINTER_STALE_MS, PointerRing, pointerOnFrame } from './pointer';

/** A 1920×1080 screen with a 1920×960 viewport, the pointer at (x, y) in it (and 120 px lower on screen). */
function sample(ts: number, x = 960, y = 480, extra: Partial<PointerSample> = {}): PointerSample {
  return { ts, x, y, sx: x, sy: y + 120, vw: 1920, vh: 960, sw: 1920, sh: 1080, ...extra };
}

describe('PointerRing.at', () => {
  test('the last sample at or before the moment', () => {
    const ring = new PointerRing();
    ring.push(sample(1000, 100));
    ring.push(sample(2000, 200));
    ring.push(sample(3000, 300));
    expect(ring.at(1999)?.x).toBe(100);
    expect(ring.at(2000)?.x).toBe(200);
    expect(ring.at(3500)?.x).toBe(300);
  });

  test('nothing before the first sample, nothing once the last is stale', () => {
    const ring = new PointerRing();
    ring.push(sample(1000));
    expect(ring.at(999)).toBeUndefined();
    expect(ring.at(1000 + POINTER_STALE_MS)).toBeDefined();
    expect(ring.at(1001 + POINTER_STALE_MS)).toBeUndefined();
  });

  test('a held frame gets the pointer of its own time, not the latest', () => {
    const ring = new PointerRing();
    ring.push(sample(10_000, 100));
    ring.push(sample(14_000, 900));
    expect(ring.at(11_000)?.x).toBe(100);
  });

  test('keeps about ten seconds of trail, and always the newest sample', () => {
    const ring = new PointerRing();
    for (let ts = 0; ts <= 30_000; ts += 100) ring.push(sample(ts));
    expect(ring.size).toBe(POINTER_RING_MS / 100 + 1);
    expect(ring.at(15_000)).toBeUndefined();
    expect(ring.at(25_000)).toBeDefined();
  });

  test('a sample that arrives out of order is dropped', () => {
    const ring = new PointerRing();
    ring.push(sample(2000, 200));
    ring.push(sample(1500, 150));
    expect(ring.at(1800)).toBeUndefined();
    expect(ring.size).toBe(1);
  });
});

describe('mapPointer', () => {
  test('a screen-shaped frame maps from screen coordinates', () => {
    expect(mapPointer(sample(0, 960, 480), 1920, 1080)).toEqual({ nx: 0.5, ny: 600 / 1080 });
  });

  test('a viewport-shaped frame maps from client coordinates', () => {
    expect(mapPointer(sample(0, 960, 480), 1280, 640)).toEqual({ nx: 0.5, ny: 0.5 });
  });

  test('a frame shaped like neither maps nothing', () => {
    expect(mapPointer(sample(0), 1000, 1000)).toBeNull();
  });
});

describe('pointerOnFrame', () => {
  test('whole frame: position, selector and text', () => {
    const p = sample(0, 960, 480, { selector: '#save', text: 'Save' });
    expect(pointerOnFrame(p, 1280, 640)).toEqual({ nx: 0.5, ny: 0.5, selector: '#save', text: 'Save' });
  });

  test('a cropped frame maps against the whole capture, then into the crop', () => {
    // The capture is the viewport (2:1); the frame shows its left 80%.
    const crop = { x: 0, y: 0, w: 0.8, h: 1 };
    const p = sample(0, 480, 480);
    const at = pointerOnFrame(p, 1536, 960, crop);
    expect(at?.nx).toBeCloseTo(0.25 / 0.8);
    expect(at?.ny).toBeCloseTo(0.5);
  });

  test('a pointer outside the crop keeps its name but loses its place', () => {
    const crop = { x: 0, y: 0, w: 0.8, h: 1 };
    const p = sample(0, 1800, 480, { selector: '.panel' });
    expect(pointerOnFrame(p, 1536, 960, crop)).toEqual({ selector: '.panel' });
  });

  test('unmappable and unnamed is nothing at all', () => {
    expect(pointerOnFrame(sample(0), 1000, 1000)).toBeUndefined();
  });
});
