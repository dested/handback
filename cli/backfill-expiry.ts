// One-shot expiry backfill: stamps every already-resolved walkthrough that has
// no expiry with `now + RETENTION_DAYS`, so retention applies to history, not
// just future status changes (owner directive 2026-08-12: "yes backfill, 30
// days from now").
//
// Run this EXACTLY ONCE per database, by hand, after the retention deploy:
//   bun cli/backfill-expiry.ts
//
// It must never become part of the recurring sweep or the boot path — the Keep
// control clears `expiresAt` on purpose, and a recurring backfill would re-arm
// deletion on walkthroughs the owner explicitly chose to keep.
//
// ⚠️ Runs against whatever DATABASE_URL is in .env — check it first (the
// prod-flip hazard has bitten twice).

import { prisma } from '../server/prisma'
import { RETENTION_DAYS } from '../server/retention'

const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000)

const candidates = await prisma.walkthrough.findMany({
  where: { status: 'resolved', expiresAt: null },
  select: { id: true, slug: true, title: true },
})

if (candidates.length === 0) {
  console.log('Nothing to backfill — no resolved walkthroughs without an expiry.')
} else {
  await prisma.walkthrough.updateMany({
    where: { id: { in: candidates.map((w) => w.id) } },
    data: { expiresAt },
  })
  for (const w of candidates) console.log(`stamped ${w.slug} (${w.id}) — ${w.title}`)
  console.log(`\n${candidates.length} walkthrough(s) now expire ${expiresAt.toISOString()}`)
}

process.exit(0)
