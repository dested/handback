// One-shot, idempotent Stripe provisioning for Handback billing.
//
//   bun cli/stripe-setup.ts
//
// Creates (or reuses) the two subscription products + monthly prices the locked
// plan sells — Pro $29, Business $49 — and a reusable 100%-off comp coupon with a
// promotion code. Safe to run repeatedly: products are matched by metadata,
// prices by lookup_key, the coupon by a fixed id, the promo code by its code. It
// prints the price ids to paste into .env (STRIPE_PRICE_PRO / STRIPE_PRICE_BIZ).
//
// Reads STRIPE_SECRET_KEY from the environment (Bun auto-loads .env). Runs
// against whatever mode the key is in — a test key touches only test data.

import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set (put it in .env first).')
  process.exit(1)
}
const stripe = new Stripe(key, { appInfo: { name: 'handback-setup' } })
const mode = key.startsWith('sk_live') ? 'LIVE' : 'test'

type PlanSpec = {
  plan: 'pro' | 'biz'
  name: string
  description: string
  amount: number // cents
  lookupKey: string
}

const PLANS: PlanSpec[] = [
  {
    plan: 'pro',
    name: 'Handback Pro',
    description: '80 walkthroughs/mo, 15h transcription, refine + assistant + polish, teams.',
    amount: 2900,
    lookupKey: 'handback_pro_monthly',
  },
  {
    plan: 'biz',
    name: 'Handback Business',
    description: '130 walkthroughs/mo, 30h transcription, everything in Pro, teams.',
    amount: 4900,
    lookupKey: 'handback_business_monthly',
  },
]

const COUPON_ID = 'handback-comp-100'
const PROMO_CODE = 'HANDBACK100'

async function ensureProduct(spec: PlanSpec): Promise<string> {
  const found = await stripe.products.search({
    query: `active:'true' AND metadata['handback_plan']:'${spec.plan}'`,
    limit: 1,
  })
  const existing = found.data[0]
  if (existing) {
    // Keep the human-readable fields in sync without churning ids.
    await stripe.products.update(existing.id, { name: spec.name, description: spec.description })
    return existing.id
  }
  const created = await stripe.products.create({
    name: spec.name,
    description: spec.description,
    metadata: { handback_plan: spec.plan },
  })
  return created.id
}

async function ensurePrice(spec: PlanSpec, productId: string): Promise<string> {
  const found = await stripe.prices.list({ lookup_keys: [spec.lookupKey], limit: 1 })
  const existing = found.data[0]
  if (existing) return existing.id
  const created = await stripe.prices.create({
    product: productId,
    unit_amount: spec.amount,
    currency: 'usd',
    recurring: { interval: 'month' },
    lookup_key: spec.lookupKey,
    metadata: { handback_plan: spec.plan },
  })
  return created.id
}

async function ensureComp(): Promise<void> {
  try {
    await stripe.coupons.retrieve(COUPON_ID)
  } catch {
    await stripe.coupons.create({
      id: COUPON_ID,
      name: 'Handback comp (100% off)',
      percent_off: 100,
      duration: 'forever',
    })
    console.log(`  created coupon ${COUPON_ID} (100% off, forever)`)
  }
  const codes = await stripe.promotionCodes.list({ code: PROMO_CODE, limit: 1 })
  if (codes.data.length === 0) {
    await stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: COUPON_ID },
      code: PROMO_CODE,
    })
    console.log(`  created promotion code ${PROMO_CODE}`)
  }
}

async function main() {
  console.log(`Provisioning Handback billing in Stripe [${mode}]…\n`)
  const ids: Record<'pro' | 'biz', string> = { pro: '', biz: '' }
  for (const spec of PLANS) {
    const productId = await ensureProduct(spec)
    const priceId = await ensurePrice(spec, productId)
    ids[spec.plan] = priceId
    console.log(`  ${spec.name}: product ${productId} · price ${priceId}`)
  }
  await ensureComp()

  console.log('\nPaste into .env:\n')
  console.log(`STRIPE_PRICE_PRO=${ids.pro}`)
  console.log(`STRIPE_PRICE_BIZ=${ids.biz}`)
  console.log(
    `\nComp: give anyone 100% off by having them enter ${PROMO_CODE} at checkout,\n` +
      `or comp directly from /admin (toggle pro/biz on their account — no Stripe needed).\n`
  )
  console.log(
    'Webhook: create an endpoint at {BETTER_AUTH_URL}/api/stripe/webhook in the Stripe\n' +
      'dashboard (events: checkout.session.completed, customer.subscription.*, invoice.*),\n' +
      'then put its signing secret in STRIPE_WEBHOOK_SECRET. For local dev:\n' +
      '  stripe listen --forward-to https://handback.localhost/api/stripe/webhook\n'
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
