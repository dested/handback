// Retention: when a walkthrough (and its bytes) leaves the system, and the
// hourly sweep that enforces it.
//
// Retention is both the #1 storage-cost lever and the #1 liability lever —
// screen recordings can hold anything, so we keep them no longer than we have
// to. Three clocks run here:
//   - a resolved walkthrough auto-deletes RETENTION_DAYS after it's resolved;
//   - a human handback's raw takes are purged RAW_TTL_DAYS after its final.mp4
//     renders (the shipped video stays until the whole walkthrough goes);
//   - an upload that never finalized is swept after UNFINALIZED_TTL_DAYS.
//
// The stamping lives in the two status-write paths (tRPC `setStatus` and the
// shared `setWalkthroughStatus`) and in `finalizeEdit`; this module owns the
// constants, `expiryFor`, and the sweep that acts on the stamps.

import { spaceId, type SpaceOwner } from './access'
import { log } from './logger'
import { prisma } from './prisma'
import { deleteKeys, deletePrefix, walkthroughKey, walkthroughPrefix } from './storage'

/** Days a resolved walkthrough survives before it auto-deletes. Alpha default —
 *  becomes a per-tier window once billing is wired (Free/Pro/Business/Enterprise). */
export const RETENTION_DAYS = 30

/** Days a human handback keeps its raw takes after the final cut renders. */
export const RAW_TTL_DAYS = 14

/** Days an upload that never finalized is allowed to sit before it's swept. */
export const UNFINALIZED_TTL_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The expiry a status implies: resolved schedules deletion RETENTION_DAYS out,
 * everything else clears it. Called by both status-write paths so a walkthrough
 * flipped back off resolved un-schedules itself in the same update.
 */
export function expiryFor(status: string): Date | null {
  return status === 'resolved' ? new Date(Date.now() + RETENTION_DAYS * DAY_MS) : null
}

/** How many rows one sweep processes per category — an hourly run catches up. */
const SWEEP_CAP = 50

const ownerOf = (w: { teamId: string | null; userId: string | null }): SpaceOwner => ({
  teamId: w.teamId,
  userId: w.userId,
})

/** A raw-take file — anything whose path sits under a `rec-NN` take directory. */
const isRawTakeFile = (path: string): boolean => path.startsWith('rec-')

/**
 * Expired walkthroughs: past their `expiresAt`, finalized. S3 prefix first,
 * then the row — the `admin.deleteUser` / `walkthroughs.delete` ordering, so a
 * failed wipe leaves the record intact rather than orphaning unlistable objects.
 */
async function sweepExpired(now: Date): Promise<void> {
  const rows = await prisma.walkthrough.findMany({
    where: { expiresAt: { not: null, lt: now }, finalizedAt: { not: null } },
    select: { id: true, slug: true, teamId: true, userId: true },
    take: SWEEP_CAP,
  })
  for (const w of rows) {
    try {
      await deletePrefix(walkthroughPrefix(spaceId(ownerOf(w)), w.id))
      await prisma.walkthrough.delete({ where: { id: w.id } })
      log.info(`[retention] expired ${w.slug} (${w.id}) deleted`)
    } catch (err) {
      log.warn(`[retention] failed to delete expired ${w.id}: ${String(err)}`)
    }
  }
}

/**
 * Uploads that never finalized and have aged out: nothing lists them, but their
 * declared prefix can hold real objects. Same S3-first delete.
 */
async function sweepUnfinalized(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - UNFINALIZED_TTL_DAYS * DAY_MS)
  const rows = await prisma.walkthrough.findMany({
    where: { finalizedAt: null, uploadedAt: { lt: cutoff } },
    select: { id: true, slug: true, teamId: true, userId: true },
    take: SWEEP_CAP,
  })
  for (const w of rows) {
    try {
      await deletePrefix(walkthroughPrefix(spaceId(ownerOf(w)), w.id))
      await prisma.walkthrough.delete({ where: { id: w.id } })
      log.info(`[retention] abandoned upload ${w.slug} (${w.id}) deleted`)
    } catch (err) {
      log.warn(`[retention] failed to delete abandoned ${w.id}: ${String(err)}`)
    }
  }
}

/**
 * Human handbacks whose final cut rendered more than RAW_TTL_DAYS ago: drop the
 * raw takes (everything under a `rec-NN` take dir), keep the shipped final.mp4 / transcript
 * / edit.json, recompute `bytes` from the survivors, and stamp `rawsPurgedAt` so
 * it runs once. The final video stays until the whole walkthrough expires.
 */
async function sweepRawTakes(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - RAW_TTL_DAYS * DAY_MS)
  const rows = await prisma.walkthrough.findMany({
    where: { kind: 'human', rawsPurgedAt: null, renderedAt: { not: null, lt: cutoff } },
    select: {
      id: true,
      slug: true,
      teamId: true,
      userId: true,
      files: { select: { id: true, path: true, size: true } },
    },
    take: SWEEP_CAP,
  })
  for (const w of rows) {
    try {
      const raws = w.files.filter((f) => isRawTakeFile(f.path))
      const survivors = w.files.filter((f) => !isRawTakeFile(f.path))
      const owner = ownerOf(w)
      if (raws.length > 0) {
        await deleteKeys(raws.map((f) => walkthroughKey(spaceId(owner), w.id, f.path)))
      }
      const bytes = BigInt(survivors.reduce((sum, f) => sum + f.size, 0))
      await prisma.$transaction([
        prisma.walkthroughFile.deleteMany({ where: { id: { in: raws.map((f) => f.id) } } }),
        prisma.walkthrough.update({
          where: { id: w.id },
          data: { bytes, rawsPurgedAt: now },
        }),
      ])
      log.info(`[retention] purged ${raws.length} raw takes from ${w.slug} (${w.id})`)
    } catch (err) {
      log.warn(`[retention] failed to purge raws from ${w.id}: ${String(err)}`)
    }
  }
}

/** One full pass. Each category is independent — one throwing never stops the next. */
async function runSweep(): Promise<void> {
  const now = new Date()
  try {
    await sweepExpired(now)
  } catch (err) {
    log.warn(`[retention] expired sweep failed: ${String(err)}`)
  }
  try {
    await sweepUnfinalized(now)
  } catch (err) {
    log.warn(`[retention] unfinalized sweep failed: ${String(err)}`)
  }
  try {
    await sweepRawTakes(now)
  } catch (err) {
    log.warn(`[retention] raw-take sweep failed: ${String(err)}`)
  }
}

/**
 * Start the retention sweep: one run 30s after boot (so a fresh deploy catches
 * anything already overdue) and hourly after that. One ECS task runs this — the
 * same single-process assumption the in-memory rate limiter rides on.
 */
export function startRetentionSweep(): void {
  setTimeout(() => {
    void runSweep()
  }, 30_000)
  setInterval(() => {
    void runSweep()
  }, 60 * 60 * 1000)
}
