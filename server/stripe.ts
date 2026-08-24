// The one typed boundary around Stripe. Everything money-related enters here so
// the rest of the server never imports the SDK directly.
//
// Design (the reason this is "bulletproof"):
//   - `features` on the User row stays the enforcement source of truth. Stripe
//     is upstream of it; the webhook never trusts a single event's payload.
//   - reconcileByCustomer() is the ONLY thing that flips entitlements, and it
//     works by PULLING the customer's live subscriptions from Stripe and
//     computing the correct state — never by applying a delta from one event.
//     That makes duplicate delivery, out-of-order delivery, and missed events
//     all converge to the same correct answer the next time any event lands (or
//     billing.sync runs). Idempotent by construction.
//
// Billing is optional: with STRIPE_SECRET_KEY unset every entry point degrades
// cleanly (checkout/portal throw a friendly PRECONDITION_FAILED, the webhook
// 503s) and the app boots and runs exactly as it did before billing existed.

import Stripe from 'stripe'
import { applyPlanFeatures, type Plan } from './features'
import { env } from './env'
import { log } from './logger'
import { prisma } from './prisma'

// Pinned to the SDK's own default API version (omitting `apiVersion` uses the
// version the installed stripe@22 was built and typed against — no literal to
// drift from the types).
export const stripe: Stripe | null = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, { appInfo: { name: 'handback' } })
  : null

/** Billing is fully wired only when the client AND both prices are configured. */
export function billingConfigured(): boolean {
  return stripe !== null && !!env.STRIPE_PRICE_PRO && !!env.STRIPE_PRICE_BIZ
}

/** The Stripe client, or a friendly error the router turns into a 4xx. */
export function requireStripe(): Stripe {
  if (!stripe) {
    throw new Error('Billing is not configured (STRIPE_SECRET_KEY is unset).')
  }
  return stripe
}

/** The recurring price id checkout should sell for a plan. */
export function priceForPlan(plan: Plan): string | undefined {
  return plan === 'biz' ? env.STRIPE_PRICE_BIZ : env.STRIPE_PRICE_PRO
}

/** Map a Stripe price id back to a plan (null = a price we don't recognize). */
export function planForPrice(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null
  if (priceId === env.STRIPE_PRICE_BIZ) return 'biz'
  if (priceId === env.STRIPE_PRICE_PRO) return 'pro'
  return null
}

/** biz outranks pro when an account somehow holds both. */
function rank(plan: Plan): number {
  return plan === 'biz' ? 2 : 1
}

/**
 * The account's Stripe customer id, creating the customer on first use. Safe
 * against a double-click race: after creating we claim the row only if it's
 * still empty, and fall back to the winner's id otherwise (deleting our now-
 * orphaned customer so we don't leak duplicates).
 */
export async function getOrCreateCustomer(userId: string): Promise<string> {
  const s = requireStripe()
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, stripeCustomerId: true },
  })
  if (!u) throw new Error('No such user')
  if (u.stripeCustomerId) return u.stripeCustomerId

  const customer = await s.customers.create({
    email: u.email,
    name: u.name,
    metadata: { userId },
  })
  const claimed = await prisma.user.updateMany({
    where: { id: userId, stripeCustomerId: null },
    data: { stripeCustomerId: customer.id },
  })
  if (claimed.count === 1) return customer.id

  // Someone else claimed it first — use theirs and drop the duplicate we made.
  const winner = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  })
  await s.customers.del(customer.id).catch(() => {})
  if (!winner?.stripeCustomerId) throw new Error('Failed to provision a Stripe customer')
  return winner.stripeCustomerId
}

// A subscription entitles while it's active/trialing, and during the dunning
// grace window (past_due) — we don't yank access the instant one card renewal
// fails. Everything else (canceled, unpaid, incomplete, paused) does not.
const ENTITLING = new Set<Stripe.Subscription.Status>(['active', 'trialing', 'past_due'])

/** The best plan a single subscription grants (null = none of its prices map). */
function planOfSubscription(sub: Stripe.Subscription): Plan | null {
  let best: Plan | null = null
  for (const item of sub.items.data) {
    const plan = planForPrice(item.price.id)
    if (plan && (best === null || rank(plan) > rank(best))) best = plan
  }
  return best
}

/**
 * Reconcile one customer's entitlements from their live Stripe subscriptions.
 * The single writer of billing state. Pulls every subscription, picks the best
 * entitling plan, and writes `features` + the cached mirror to match. A customer
 * we don't know (no matching user) is ignored. Never throws for "nothing to do".
 */
export async function reconcileByCustomer(customerId: string): Promise<void> {
  const s = requireStripe()
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true, features: true },
  })
  if (!user) {
    log.warn(`[stripe] reconcile: no user for customer ${customerId} — ignoring`)
    return
  }

  const subs = await s.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })

  // Best entitling plan across all subscriptions, and the subscription that
  // backs it (for the display mirror). If nothing entitles, we still surface the
  // most-recent subscription's status so the UI can say "canceled".
  let chosen: { plan: Plan; sub: Stripe.Subscription } | null = null
  for (const sub of subs.data) {
    if (!ENTITLING.has(sub.status)) continue
    const plan = planOfSubscription(sub)
    if (plan && (chosen === null || rank(plan) > rank(chosen.plan))) chosen = { plan, sub }
  }

  const plan = chosen?.plan ?? null
  // subscriptions.list returns newest first, so subs.data[0] is the latest.
  const mirror = chosen?.sub ?? subs.data[0] ?? null
  const features = applyPlanFeatures(user.features, plan)

  // The period end lives on the subscription item since the Basil API version.
  const mirrorItem = mirror?.items.data[0]
  await prisma.user.update({
    where: { id: user.id },
    data: {
      features,
      plan,
      stripeSubscriptionId: mirror?.id ?? null,
      subscriptionStatus: mirror?.status ?? null,
      currentPeriodEnd: mirrorItem ? new Date(mirrorItem.current_period_end * 1000) : null,
    },
  })
  log.info(
    `[stripe] reconciled ${user.id}: plan=${plan ?? 'none'} status=${mirror?.status ?? 'none'}`
  )
}

/** Reconcile by our user id, if they have a Stripe customer. Used by billing.sync. */
export async function reconcileByUser(userId: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  })
  if (u?.stripeCustomerId) await reconcileByCustomer(u.stripeCustomerId)
}
