// The weekly digest: one Monday-morning email per person — what's open across
// every space they reach, how stale the oldest is, what got resolved last week.
//
// No cron infrastructure exists here (same single-process assumption as the
// rate limiter and the retention sweep), so this is an hourly check that fires
// inside one Monday UTC window; `User.digestSentAt` is the idempotency guard,
// so a redeploy mid-window can't double-send and a missed window (deploy,
// downtime) just catches the next Monday.

import { memberTeamIds } from './access'
import { digestEmail, sendEmail } from './email'
import { env } from './env'
import { log } from './logger'
import { unsubscribeUrl } from './notify'
import { prisma } from './prisma'

// Monday 15:00–16:00 UTC ≈ morning across the US, midafternoon in Europe.
const SEND_DAY_UTC = 1
const SEND_HOUR_UTC = 15
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** Everything one person's digest says. Null when there is nothing to say. */
async function buildDigest(userId: string): Promise<Parameters<typeof digestEmail>[0]['stats'] | null> {
  const teamIds = await memberTeamIds(userId)
  const reach = {
    OR: [{ teamId: null, userId }, { teamId: { in: teamIds } }],
    finalizedAt: { not: null },
  }
  const [open, inReview, resolvedThisWeek, oldestOpen, topOpen] = await Promise.all([
    prisma.walkthrough.count({ where: { ...reach, status: 'open' } }),
    prisma.walkthrough.count({ where: { ...reach, status: 'in_review' } }),
    prisma.walkthrough.count({
      where: { ...reach, status: 'resolved', resolvedAt: { gt: new Date(Date.now() - WEEK_MS) } },
    }),
    prisma.walkthrough.findFirst({
      where: { ...reach, status: 'open' },
      orderBy: { recordedAt: 'asc' },
      select: { recordedAt: true },
    }),
    prisma.walkthrough.findMany({
      where: { ...reach, status: 'open' },
      orderBy: { recordedAt: 'asc' },
      take: 5,
      select: { id: true, title: true, recordedAt: true },
    }),
  ])
  if (open === 0 && inReview === 0 && resolvedThisWeek === 0) return null
  return {
    open,
    inReview,
    resolvedThisWeek,
    oldestOpenDays: oldestOpen
      ? Math.max(0, Math.floor((Date.now() - oldestOpen.recordedAt.getTime()) / DAY_MS))
      : null,
    topOpen: topOpen.map((w) => ({
      title: w.title,
      ageDays: Math.max(0, Math.floor((Date.now() - w.recordedAt.getTime()) / DAY_MS)),
      url: `${env.BETTER_AUTH_URL}/walkthroughs/${w.id}`,
    })),
  }
}

async function runDigestSweep(): Promise<void> {
  const now = new Date()
  if (now.getUTCDay() !== SEND_DAY_UTC || now.getUTCHours() !== SEND_HOUR_UTC) return

  const due = await prisma.user.findMany({
    where: {
      emailVerified: true,
      notifyDigest: true,
      OR: [{ digestSentAt: null }, { digestSentAt: { lt: new Date(Date.now() - SIX_DAYS_MS) } }],
    },
    select: { id: true, email: true },
  })

  for (const user of due) {
    // Stamp before sending: a crash between stamp and send costs one digest,
    // the other order can spam one every sweep until the send stops throwing.
    await prisma.user.update({ where: { id: user.id }, data: { digestSentAt: now } })
    const stats = await buildDigest(user.id).catch((err: unknown) => {
      log.warn(`[digest] build failed for ${user.id}: ${String(err)}`)
      return null
    })
    // Nothing to say (no walkthroughs at all): no mail, and the stamp above
    // keeps the account off next hour's due list either way.
    if (!stats) continue
    await sendEmail({
      to: user.email,
      ...digestEmail({
        stats,
        appUrl: `${env.BETTER_AUTH_URL}/app`,
        unsubscribeUrl: unsubscribeUrl(user.id, 'digest'),
      }),
    })
  }
  if (due.length > 0) log.info(`[digest] sweep considered ${due.length} account(s)`)
}

export function startDigestSweep(): void {
  setTimeout(() => void runDigestSweep().catch((err) => log.warn(`[digest] ${String(err)}`)), 90_000)
  setInterval(
    () => void runDigestSweep().catch((err) => log.warn(`[digest] ${String(err)}`)),
    SWEEP_INTERVAL_MS
  )
}
