// The per-user meter for the two cloud passes that actually cost money —
// transcription (Groq) and polish (Anthropic). Budgets are per USER, not per
// token, so minting more tokens can't multiply anyone's allowance
// (plans/2026-08-12-security-retention-audit.md §Anti-abuse). server/ingest.ts
// calls the reserve functions before spending the provider, and 429s on refusal.
//
// Two states decide the answer, checked in this order:
//   1. Platform admin — unmetered (a trusted operator; the context endpoint
//      reports `null` remaining).
//   2. Tier — both Pro and free get a real cloud budget (server/limits.ts),
//      just at different ceilings. A free account gets a small monthly
//      walkthrough allowance, each with the full cloud treatment: 1 hour of
//      transcription and a refine/polish budget. Pro gets the higher quotas.
//      Assistant turns stay Pro-only. (2026-08-24 owner reversal — the free
//      cloud tier is back, tiny counts, full treatment.)

import { isPlatformAdmin, userHasFeature } from './features'
import {
  FREE_CLOUD_TRANSCRIBE_SECONDS,
  FREE_POLISH_CALLS,
  FREE_WALKTHROUGHS_PER_MONTH,
  PRO_ASSISTANT_TURNS,
  PRO_CLOUD_TRANSCRIBE_SECONDS,
  PRO_POLISH_CALLS,
  PRO_WALKTHROUGHS_PER_MONTH,
  monthKey,
} from './limits'
import { prisma } from './prisma'

/** The account's cloud tier, resolved in one query. `admin` short-circuits to
 *  unmetered; `pro` picks the higher ceiling. */
async function tierOf(userId: string): Promise<{ admin: boolean; pro: boolean }> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, isAdmin: true, features: true },
  })
  if (!u) return { admin: false, pro: false }
  return { admin: isPlatformAdmin(u), pro: userHasFeature(u, 'pro') }
}

/** `remaining` is null when the caller is unmetered (magic or admin). */
export type TranscribeReservation = { allowed: boolean; remaining: number | null }

/**
 * Reserve `seconds` of cloud transcription this month, or refuse. Admins pass
 * without metering; everyone else is capped at their tier's budget (0 without a
 * plan), incremented atomically so two concurrent takes can't both slip past
 * the line.
 */
export async function checkAndReserveTranscribe(
  userId: string,
  seconds: number
): Promise<TranscribeReservation> {
  const { admin, pro } = await tierOf(userId)
  if (admin) return { allowed: true, remaining: null }
  const limit = pro ? PRO_CLOUD_TRANSCRIBE_SECONDS : FREE_CLOUD_TRANSCRIBE_SECONDS
  const month = monthKey(new Date())
  return await prisma.$transaction(async (tx) => {
    const row = await tx.monthlyUsage.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, month },
      update: {},
    })
    if (row.transcribeSeconds + seconds > limit) {
      return { allowed: false, remaining: Math.max(0, limit - row.transcribeSeconds) }
    }
    const updated = await tx.monthlyUsage.update({
      where: { userId_month: { userId, month } },
      data: { transcribeSeconds: { increment: seconds } },
    })
    return { allowed: true, remaining: Math.max(0, limit - updated.transcribeSeconds) }
  })
}

/**
 * Reserve one polish call this month, or refuse. Admins pass; everyone else is
 * capped at their tier's polish budget (FREE_POLISH_CALLS without a plan,
 * PRO_POLISH_CALLS with Pro).
 */
export async function checkAndReservePolish(userId: string): Promise<{ allowed: boolean }> {
  const { admin, pro } = await tierOf(userId)
  if (admin) return { allowed: true }
  const limit = pro ? PRO_POLISH_CALLS : FREE_POLISH_CALLS
  const month = monthKey(new Date())
  return await prisma.$transaction(async (tx) => {
    const row = await tx.monthlyUsage.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, month },
      update: {},
    })
    if (row.polishCalls >= limit) return { allowed: false }
    await tx.monthlyUsage.update({
      where: { userId_month: { userId, month } },
      data: { polishCalls: { increment: 1 } },
    })
    return { allowed: true }
  })
}

/**
 * Reserve one assistant turn this month, or refuse. Admins pass unmetered
 * (remaining null); without a Pro plan there is no assistant (remaining 0); Pro
 * is capped at PRO_ASSISTANT_TURNS/mo — a real margin guard, not an abuse bound.
 */
export async function checkAndReserveAssistantTurn(
  userId: string
): Promise<{ allowed: boolean; remaining: number | null }> {
  const { admin, pro } = await tierOf(userId)
  if (admin) return { allowed: true, remaining: null }
  if (!pro) return { allowed: false, remaining: 0 }
  const month = monthKey(new Date())
  return await prisma.$transaction(async (tx) => {
    const row = await tx.monthlyUsage.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, month },
      update: {},
    })
    if (row.assistantTurns >= PRO_ASSISTANT_TURNS) return { allowed: false, remaining: 0 }
    const updated = await tx.monthlyUsage.update({
      where: { userId_month: { userId, month } },
      data: { assistantTurns: { increment: 1 } },
    })
    return { allowed: true, remaining: Math.max(0, PRO_ASSISTANT_TURNS - updated.assistantTurns) }
  })
}

/**
 * Reserve one walkthrough creation this month, or refuse. Admins pass unmetered
 * (remaining and limit null); everyone else is capped at their tier's ceiling —
 * FREE_WALKTHROUGHS_PER_MONTH without a plan, PRO_WALKTHROUGHS_PER_MONTH with
 * Pro. The limit used is returned so the caller can quote it in a refusal.
 * Incremented atomically so two concurrent declares can't both slip past the
 * line. Not part of CloudStatus: the recorder doesn't self-configure against
 * it — the declare endpoint is the only caller.
 */
export async function checkAndReserveWalkthrough(
  userId: string
): Promise<{ allowed: boolean; remaining: number | null; limit: number | null }> {
  const { admin, pro } = await tierOf(userId)
  if (admin) return { allowed: true, remaining: null, limit: null }
  const limit = pro ? PRO_WALKTHROUGHS_PER_MONTH : FREE_WALKTHROUGHS_PER_MONTH
  const month = monthKey(new Date())
  return await prisma.$transaction(async (tx) => {
    const row = await tx.monthlyUsage.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, month },
      update: {},
    })
    if (row.walkthroughs >= limit) return { allowed: false, remaining: 0, limit }
    const updated = await tx.monthlyUsage.update({
      where: { userId_month: { userId, month } },
      data: { walkthroughs: { increment: 1 } },
    })
    return { allowed: true, remaining: Math.max(0, limit - updated.walkthroughs), limit }
  })
}

export type CloudStatus = {
  /** Cloud transcription seconds left this month, or null when unmetered. */
  transcribeRemainingSeconds: number | null
  polishAllowed: boolean
  /** Assistant turns left this month, or null when unmetered (admin). */
  assistantTurnsRemaining: number | null
  /** Retained for the context/usage shape — the magic is gone, so always false. */
  firstWalkthroughMagic: boolean
}

/**
 * A read-only snapshot of the caller's cloud budget for GET /api/ingest/context,
 * so a recorder can self-configure. Reserves nothing — it never increments.
 * Free and Pro both carry real budgets (at different ceilings); polishAllowed is
 * true while any polish budget for the tier remains this month.
 */
export async function cloudStatus(userId: string): Promise<CloudStatus> {
  const { admin, pro } = await tierOf(userId)
  if (admin) {
    return {
      transcribeRemainingSeconds: null,
      polishAllowed: true,
      assistantTurnsRemaining: null,
      firstWalkthroughMagic: false,
    }
  }
  const limit = pro ? PRO_CLOUD_TRANSCRIBE_SECONDS : FREE_CLOUD_TRANSCRIBE_SECONDS
  const polishLimit = pro ? PRO_POLISH_CALLS : FREE_POLISH_CALLS
  const month = monthKey(new Date())
  const row = await prisma.monthlyUsage.findUnique({
    where: { userId_month: { userId, month } },
  })
  const used = row?.transcribeSeconds ?? 0
  return {
    transcribeRemainingSeconds: Math.max(0, limit - used),
    polishAllowed: (row?.polishCalls ?? 0) < polishLimit,
    assistantTurnsRemaining: pro ? Math.max(0, PRO_ASSISTANT_TURNS - (row?.assistantTurns ?? 0)) : 0,
    firstWalkthroughMagic: false,
  }
}
