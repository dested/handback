/**
 * The /record live recorder's keep/drop vocabulary: a 64×64 RGB signature of
 * the screen share every 500 ms, kept when enough cells move against the last
 * few kept frames. It is the recorder extension's rule
 * (`extension/src/sidepanel/recorder.ts`), unchanged, and it stays here rather
 * than in @dested/video-to-prompt because the extension still runs it: moving
 * /record to the library's Selector (luma signature, change boxes) goes with
 * moving the extension. Until then the frames this rule keeps carry no change
 * boxes and no `sampling`, and the library's report says so.
 */

export const SIG_SIZE = 64 // 64×64 RGB cells — fine enough that a sprite-sized change still flips whole cells
export const PIX_TOL = 25 // a cell counts as changed if any channel moves more than this
export const DEDUP_THRESHOLD = 8 // cells that must change for a frame to be new (~0.2% of 4096)
export const DEDUP_WINDOW = 4 // vs the last N KEPT frames — A-B-A cutaways don't come back
export const BEAT_MS = 15000 // a minute of narration over a slowly-shifting screen must not produce zero frames
export const MAX_FRAME_W = 1920
export const JPEG_QUALITY = 0.8 // 0.9 until 2026-08-25 — frames were half the upload; UI text stays legible

/**
 * Count of cells whose max channel delta exceeds PIX_TOL — the reference's
 * pct_diff, kept as a count.
 */
export function cellDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const cells = SIG_SIZE * SIG_SIZE
  let changed = 0
  for (let i = 0; i < cells; i++) {
    const p = i * 4
    const d = Math.max(
      Math.abs(a[p] - b[p]),
      Math.abs(a[p + 1] - b[p + 1]),
      Math.abs(a[p + 2] - b[p + 2])
    )
    if (d > PIX_TOL) changed++
  }
  return changed
}

export function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('frame encode failed'))),
      'image/jpeg',
      quality
    )
  })
}
