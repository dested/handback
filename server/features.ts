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

export type Feature = 'team' | 'pro' | 'biz'

/** The paid plans Stripe sells. `biz` is a superset of `pro`. */
export type Plan = 'pro' | 'biz'

/** The account's effective tier — the one number every ceiling reads from. */
export type Tier = 'admin' | 'biz' | 'pro' | 'free'

// The entitlement set billing owns: a plan grants exactly these, and reconcile
// strips the ones a plan doesn't grant. `team` is bundled into both paid plans
// (owner's call, 2026-08-24) — so canceling a paid plan revokes team creation
// too. A comp granted by hand from /admin uses this same `features` array and is
// never touched by reconcile (that only runs for accounts with a Stripe
// customer id).
const PLAN_OWNED: readonly Feature[] = ['pro', 'biz', 'team']

/** What a plan grants. biz implies pro; both bundle team. null = no plan. */
export function featuresForPlan(plan: Plan | null): Feature[] {
  if (plan === 'biz') return ['pro', 'biz', 'team']
  if (plan === 'pro') return ['pro', 'team']
  return []
}

/**
 * Rewrite a features array for a plan change: drop everything billing owns, add
 * back exactly what the plan grants, preserve any unrelated feature. Idempotent —
 * calling it twice with the same plan yields the same set — which is what makes
 * the webhook safe against duplicate and out-of-order delivery.
 */
export function applyPlanFeatures(current: string[], plan: Plan | null): string[] {
  const kept = current.filter((f) => !PLAN_OWNED.includes(f as Feature))
  return [...new Set([...kept, ...featuresForPlan(plan)])]
}

export function isPlatformAdmin(user: { email: string; isAdmin: boolean }): boolean {
  return user.isAdmin || bootstrapAdmins.has(user.email.toLowerCase())
}

/** The account's tier, from its flags — the single resolver every ceiling uses. */
export function tierOfUser(user: { email: string; isAdmin: boolean; features: string[] }): Tier {
  if (isPlatformAdmin(user)) return 'admin'
  if (user.features.includes('biz')) return 'biz'
  if (user.features.includes('pro')) return 'pro'
  return 'free'
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
