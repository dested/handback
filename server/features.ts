// Platform-level entitlements. Billing doesn't exist yet: features are granted
// by hand from /admin, and platform admins implicitly have everything.

import { TRPCError } from '@trpc/server'
import { env } from './env'
import { prisma } from './prisma'

const bootstrapAdmins = new Set(
  env.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '')
)

export type Feature = 'team' | 'pro'

export function isPlatformAdmin(user: { email: string; isAdmin: boolean }): boolean {
  return user.isAdmin || bootstrapAdmins.has(user.email.toLowerCase())
}

export function userHasFeature(
  user: { email: string; isAdmin: boolean; features: string[] },
  feature: Feature
): boolean {
  return isPlatformAdmin(user) || user.features.includes(feature)
}

/**
 * Is this account on the Pro tier? True for a platform admin (implicitly holds
 * everything) or anyone granted the `pro` feature by hand from /admin — the same
 * per-user feature mechanism `team` rides on, no new table. Metering in
 * server/usage.ts reads this to pick the free vs. Pro ceiling.
 */
export async function userIsPro(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, isAdmin: true, features: true },
  })
  return u !== null && userHasFeature(u, 'pro')
}

/** A team has a feature when its owner does. */
export async function teamHasFeature(teamId: string, feature: Feature): Promise<boolean> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { owner: { select: { email: true, isAdmin: true, features: true } } },
  })
  return team !== null && userHasFeature(team.owner, feature)
}

export async function requireAdmin(userId: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, isAdmin: true },
  })
  if (!u || !isPlatformAdmin(u)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Admins only' })
}
