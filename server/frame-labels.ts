// What a model reads about a keyframe, and which frames go in front of it
// together. Pure (no env, no I/O), so the brief, get_images and Refine share it
// and the tests import it directly.
//
// Library 1.2+ writes close-ups: a frame whose image is only the region of the
// screen that changed, at native resolution, sitting on an earlier frame of the
// same take (`detail.of`). Shown alone it reads as a random crop, so every path
// that hands one to a model says what it is and, where it picks the set,
// brings the base frame in first.

import { recDirName, type Recording } from '@dested/video-to-prompt'
import type { RecordingBrief } from './brief'
import { recStamp } from './mcp-format'

/** A close-up's base: the take's frame `of` (its index), at `path`. */
export type CloseUpOf = { of: number; path: string }

/** Every close-up in these takes, by walkthrough-relative path. A close-up whose base its take doesn't list is left out. */
export function closeUpsOf(recordings: Recording[]): Record<string, CloseUpOf> {
  const out: Record<string, CloseUpOf> = {}
  for (const rec of recordings) {
    const dir = recDirName(rec.index)
    const byIndex = new Map(rec.meta.frames.map((f) => [f.index, f]))
    for (const f of rec.meta.frames) {
      const base = f.detail ? byIndex.get(f.detail.of) : undefined
      if (f.detail && base)
        out[`${dir}/${f.file}`] = { of: f.detail.of, path: `${dir}/${base.file}` }
    }
  }
  return out
}

/** What a close-up is, for anything that shows one to a model: "close-up of frame 12 (rec-01/frames/12-0017.jpg): the screen then was that frame except this region". */
export function closeUpNote(base: CloseUpOf): string {
  return `close-up of frame ${base.of} (${base.path}): the screen then was that frame except this region`
}

/** One frame of `get_images`' default set: why it's in, and what changed in it. */
export type EvidenceImage = { path: string; tags: string[]; what: string }

/**
 * The evidence set `get_images` serves when asked for no paths: each key
 * point's frame in point order, then the report's Start here. One entry per
 * path, carrying every reason it's in the set. A close-up whose base isn't
 * already in the set brings the base in just before it, so the agent sees the
 * whole screen the region sits on.
 */
export function evidenceImages(
  brief: RecordingBrief | null,
  points: Array<{ id: string }>
): EvidenceImage[] {
  const byPath = new Map<string, EvidenceImage>()
  const add = (path: string, tag: string, what: string) => {
    const base = brief?.closeUps[path]
    if (base && !byPath.has(base.path)) {
      byPath.set(base.path, { path: base.path, tags: [`base of ${path}`], what: '' })
    }
    const entry = byPath.get(path)
    if (entry) {
      entry.tags.push(tag)
      entry.what = what
    } else {
      byPath.set(path, { path, tags: [tag], what })
    }
  }
  for (const p of points) {
    const frame = brief?.evidence[p.id]?.frame
    if (frame) add(frame.path, p.id.toUpperCase(), frame.what)
  }
  for (const f of brief?.startHere ?? []) add(f.path, 'start here', f.what)
  return [...byPath.values()]
}

/**
 * What an agent reads above an image: "rec-01/frames/04-0090.jpg · 0:09 · KP2 ·
 * changed top-right (small)". A close-up says so, and names its base, whether
 * or not it came in through the evidence set.
 */
export function imageLabel(
  path: string,
  brief: RecordingBrief | null,
  entry: EvidenceImage | undefined
): string {
  const at = brief?.frameAt[path]
  const base = brief?.closeUps[path]
  return [
    path,
    ...(at === undefined ? [] : [recStamp(at)]),
    ...(entry ? entry.tags : []),
    ...(base ? [closeUpNote(base)] : []),
    ...(entry?.what ? [entry.what] : []),
  ].join(' · ')
}

/**
 * `paths` in order with each close-up's base just before it, the first time the
 * base isn't already in the list, cut at `max` images without ever splitting a
 * base from its close-up. `baseOf` marks an entry brought in as a base.
 */
export function withBases(
  paths: string[],
  closeUps: Record<string, CloseUpOf>,
  max: number
): Array<{ path: string; baseOf?: string }> {
  const out: Array<{ path: string; baseOf?: string }> = []
  const seen = new Set<string>()
  for (const path of paths) {
    if (seen.has(path)) continue
    const base = closeUps[path]
    const unit =
      base && !seen.has(base.path) ? [{ path: base.path, baseOf: path }, { path }] : [{ path }]
    if (out.length + unit.length > max) break
    for (const u of unit) {
      out.push(u)
      seen.add(u.path)
    }
  }
  return out
}

/**
 * The vision pass's requests, in order: `frames` cut into batches of at most
 * `size` images, each close-up preceded by its base whenever the base isn't
 * already in that request (a base kept in an earlier request is sent again),
 * so the model always has the whole screen a close-up sits on. A base and its
 * close-up never straddle two requests.
 */
export function visionBatches<F extends { path: string; base: F | null }>(
  frames: F[],
  size: number
): F[][] {
  const batches: F[][] = []
  let batch: F[] = []
  for (const f of frames) {
    const base = f.base
    const missing = (b: F[]) => base !== null && !b.some((x) => x.path === base.path)
    if (batch.length > 0 && batch.length + (missing(batch) ? 2 : 1) > size) {
      batches.push(batch)
      batch = []
    }
    if (base !== null && missing(batch)) batch.push(base)
    batch.push(f)
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}
