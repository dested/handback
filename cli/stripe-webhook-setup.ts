// Create (or recreate) the Stripe webhook endpoint for a Handback deployment and
// print its signing secret — the value that goes into STRIPE_WEBHOOK_SECRET.
//
//   bun cli/stripe-webhook-setup.ts [url]
//
// `url` defaults to {BETTER_AUTH_URL}/api/stripe/webhook. The signing secret is
// only ever returned by Stripe at creation time, so if an endpoint already exists
// for this exact URL we delete and recreate it to mint a fresh secret. Runs in
// whatever mode STRIPE_SECRET_KEY is in (a test key → a test-mode endpoint).

import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set.')
  process.exit(1)
}
const stripe = new Stripe(key, { appInfo: { name: 'handback-setup' } })
const mode = key.startsWith('sk_live') ? 'LIVE' : 'test'

const base = process.argv[2] ?? process.env.BETTER_AUTH_URL ?? 'https://handback.dev'
const url = base.endsWith('/api/stripe/webhook') ? base : `${base.replace(/\/$/, '')}/api/stripe/webhook`

const ENABLED_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
]

async function main() {
  console.log(`Configuring Stripe webhook [${mode}] → ${url}\n`)
  const existing = await stripe.webhookEndpoints.list({ limit: 100 })
  for (const ep of existing.data) {
    if (ep.url === url) {
      await stripe.webhookEndpoints.del(ep.id)
      console.log(`  removed existing endpoint ${ep.id} (to mint a fresh secret)`)
    }
  }
  const ep = await stripe.webhookEndpoints.create({
    url,
    enabled_events: ENABLED_EVENTS,
    description: 'Handback billing',
  })
  console.log(`  created ${ep.id}\n`)
  if (!ep.secret) throw new Error('Stripe did not return a signing secret')
  // The last line is JUST the secret, so a caller can capture it with `| tail -1`.
  console.log(ep.secret)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
