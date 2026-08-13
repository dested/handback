// The per-user meter for the two cloud passes that actually cost money —
// transcription (Groq) and polish (Anthropic). Budgets are per USER, not per
// token, so minting more tokens can't multiply anyone's allowance
// (plans/2026-08-12-security-retention-audit.md §Anti-abuse). server/ingest.ts
// calls the reserve functions before spending the provider, and 429s on refusal.
//
// Three states decide the answer, checked in this order:
//   1. First-walkthrough magic — a user with zero finalized walkthroughs gets
//      cloud transcribe AND polish free and unmetered, because the first run IS
//      the product. This is checked first so it can't be gated by tier.
//   2. Platform admin — unmetered (a trusted operator; the context endpoint
//      reports `null` remaining, same as magic).
//   3. Tier — Pro gets the high abuse ceilings, free gets the small transcription
//      budget and no polish. Ceilings live in server/limits.ts.

import { isPlatformAdmin, userHasFeature } from './features'
import {
  FREE_CLOUD_TRANSCRIBE_SECONDS,
  PRO_CLOUD_TRANSCRIBE_SECONDS,
  PRO_POLISH_CALLS,
  monthKey,
} from './limits'
import { prisma } from './prisma'

/**
 * True while the user has never finalized a walkthrough — counted by
 * `uploadedById`, so it spans their personal space and every team they've
 * uploaded into. While true, both cloud passes are free and unmetered.
 */
export async function hasFirstWalkthroughMagic(userId: string): Promise<boolean> {
  const finalized = await prisma.walkthrough.count({
    where: { uploadedById: userId, finalizedAt: { not: null } },
  })
  return finalized === 0
}

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
 * Reserve `seconds` of cloud transcription this month, or refuse. Magic and
 * admins pass without metering; everyone else is capped at their tier's budget,
 * incremented atomically so two concurrent takes can't both slip past the line.
 */
export async function checkAndReserveTranscribe(
  userId: string,
  seconds: number
): Promise<TranscribeReservation> {
  if (await hasFirstWalkthroughMagic(userId)) return { allowed: true, remaining: null }
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
 * Reserve one polish call this month, or refuse. Magic and admins pass; the free
 * tier has no polish at all; Pro is capped at PRO_POLISH_CALLS/mo.
 */
export async function checkAndReservePolish(userId: string): Promise<{ allowed: boolean }> {
  if (await hasFirstWalkthroughMagic(userId)) return { allowed: true }
  const { admin, pro } = await tierOf(userId)
  if (admin) return { allowed: true }
  if (!pro) return { allowed: false }
  const month = monthKey(new Date())
  return await prisma.$transaction(async (tx) => {
    const row = await tx.monthlyUsage.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, month },
      update: {},
    })
    if (row.polishCalls >= PRO_POLISH_CALLS) return { allowed: false }
    await tx.monthlyUsage.update({
      where: { userId_month: { userId, month } },
      data: { polishCalls: { increment: 1 } },
    })
    return { allowed: true }
  })
}

export type CloudStatus = {
  /** Cloud transcription seconds left this month, or null when unmetered. */
  transcribeRemainingSeconds: number | null
  polishAllowed: boolean
  firstWalkthroughMagic: boolean
}

/**
 * A read-only snapshot of the caller's cloud budget for GET /api/ingest/context,
 * so a recorder can self-configure. Reserves nothing — it never increments.
 */
export async function cloudStatus(userId: string): Promise<CloudStatus> {
  if (await hasFirstWalkthroughMagic(userId)) {
    return { transcribeRemainingSeconds: null, polishAllowed: true, firstWalkthroughMagic: true }
  }
  const { admin, pro } = await tierOf(userId)
  if (admin) {
    return { transcribeRemainingSeconds: null, polishAllowed: true, firstWalkthroughMagic: false }
  }
  const limit = pro ? PRO_CLOUD_TRANSCRIBE_SECONDS : FREE_CLOUD_TRANSCRIBE_SECONDS
  const month = monthKey(new Date())
  const row = await prisma.monthlyUsage.findUnique({
    where: { userId_month: { userId, month } },
  })
  const used = row?.transcribeSeconds ?? 0
  return {
    transcribeRemainingSeconds: Math.max(0, limit - used),
    polishAllowed: pro,
    firstWalkthroughMagic: false,
  }
}
