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

export type Feature = 'team'

export function isPlatformAdmin(user: { email: string; isAdmin: boolean }): boolean {
  return user.isAdmin || bootstrapAdmins.has(user.email.toLowerCase())
}

export function userHasFeature(
  user: { email: string; isAdmin: boolean; features: string[] },
  feature: Feature
): boolean {
  return isPlatformAdmin(user) || user.features.includes(feature)
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
