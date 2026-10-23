// Which keyframe was on screen at a moment of the walkthrough. Pure, so the
// slideshow's playhead tick, its transcript jumps and the player's corner still
// all answer the same way, and so it can be tested.

/** The timing a lookup needs. Times are on the walkthrough-wide clock, ms. */
export type FrameTiming = {
  atMs: number
  /** Other spans [from, to) when this frame is what was on screen (library 1.2+). */
  seen?: Array<[number, number]>
  /** How long this state stayed on screen. */
  held?: number
  /** The screen went back to how it was before after `held` (a toast, a hover). */
  transient?: boolean
}

/**
 * Index of the frame showing at `ms`, -1 before the first. Whichever frame
 * started showing most recently wins: the latest capture at or before `ms`
 * (passing over transients that had already gone), or an older frame whose
 * `seen` span covers `ms` and began after that capture — a page scrolled back to
 * gets no new frame, the old one says when. A close-up captured inside its
 * base's span began later than the span, so it shows over its base.
 * `frames` is in time order.
 */
export function frameAt(frames: readonly FrameTiming[], ms: number): number {
  let found = -1
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (!f || f.atMs > ms) break
    const gone = f.transient === true && f.held !== undefined && f.atMs + f.held <= ms
    if (!gone) found = i
  }
  let since = found >= 0 ? (frames[found]?.atMs ?? -Infinity) : -Infinity
  frames.forEach((f, i) => {
    for (const [from, to] of f.seen ?? []) {
      if (ms >= from && ms < to && from > since) {
        found = i
        since = from
      }
    }
  })
  return found
}
