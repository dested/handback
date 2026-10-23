import type { FrameBox } from '@dested/video-to-prompt';
import type { FramePointer, PointerSample } from '../lib/types';

/**
 * Where the mouse was when a keyframe's picture was on screen. The frame rule
 * decides late — a held candidate is encoded seconds after it was seen — so the
 * recorder keeps a short trail of samples and the keyframe asks for the one that
 * was current at its own time, not whatever the pointer is doing now.
 */

/** A pointer older than this says nothing about the frame. */
export const POINTER_STALE_MS = 2500;
/** How much trail is kept, measured back from the newest sample. */
export const POINTER_RING_MS = 10000;
/** Aspect-ratio match required before a coordinate mapping is believed. */
const MAP_TOLERANCE = 0.02;

const WHOLE: FrameBox = { x: 0, y: 0, w: 1, h: 1 };

export class PointerRing {
  private samples: PointerSample[] = [];

  push(sample: PointerSample): void {
    const last = this.samples[this.samples.length - 1];
    // Messages can cross on the wire; the trail stays in time order.
    if (last && sample.ts < last.ts) return;
    this.samples.push(sample);
    const keepFrom = sample.ts - POINTER_RING_MS;
    let drop = 0;
    while (drop < this.samples.length - 1 && this.samples[drop].ts < keepFrom) drop++;
    if (drop) this.samples.splice(0, drop);
  }

  /** The sample current at absolute time `ts`: the last one at or before it, if it's fresh enough. */
  at(ts: number): PointerSample | undefined {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i];
      if (s.ts > ts) continue;
      return ts - s.ts <= POINTER_STALE_MS ? s : undefined;
    }
    return undefined;
  }

  get size(): number {
    return this.samples.length;
  }
}

/**
 * Where the pointer lands inside the captured frame, 0–1, or null when we can't
 * be sure. The capture stream never says *what* it handed us, so the frame's shape
 * is the only evidence: a frame shaped like the screen is the screen (map from
 * `screenX/Y`), a frame shaped like the viewport is the tab (map from
 * `clientX/Y`). A window capture matches neither and a second monitor pushes
 * screen coordinates out of range — both draw nothing rather than draw a lie.
 * The selector still ships in the report either way.
 */
export function mapPointer(p: PointerSample, w: number, h: number): { nx: number; ny: number } | null {
  if (!w || !h) return null;
  const aspect = w / h;
  const fits = (a: number) => Math.abs(aspect - a) / a;
  const options: { off: number; nx: number; ny: number }[] = [];
  if (p.sw && p.sh) options.push({ off: fits(p.sw / p.sh), nx: p.sx / p.sw, ny: p.sy / p.sh });
  if (p.vw && p.vh) options.push({ off: fits(p.vw / p.vh), nx: p.x / p.vw, ny: p.y / p.vh });
  const best = options.filter((o) => o.off <= MAP_TOLERANCE).sort((a, b) => a.off - b.off)[0];
  if (!best) return null;
  if ([best.nx, best.ny].some((v) => v < -0.02 || v > 1.02)) return null;
  return { nx: Math.min(1, Math.max(0, best.nx)), ny: Math.min(1, Math.max(0, best.ny)) };
}

/**
 * The pointer as one keyframe should carry it. `width`×`height` is the image
 * being drawn, which shows only `crop` of the capture: the mapping is made
 * against the whole capture's shape, then moved into the crop, and a pointer
 * outside the crop keeps its selector but loses its position.
 */
export function pointerOnFrame(
  p: PointerSample,
  width: number,
  height: number,
  crop: FrameBox = WHOLE,
): FramePointer | undefined {
  const mapped = mapPointer(p, width / crop.w, height / crop.h);
  let at: { nx: number; ny: number } | undefined;
  if (mapped) {
    const nx = (mapped.nx - crop.x) / crop.w;
    const ny = (mapped.ny - crop.y) / crop.h;
    if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) at = { nx, ny };
  }
  if (!at && !p.selector) return undefined;
  return {
    ...(at ?? {}),
    ...(p.selector ? { selector: p.selector } : {}),
    ...(p.text ? { text: p.text } : {}),
  };
}
