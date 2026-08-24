// The Stripe webhook: POST /api/stripe/webhook. Mounted with express.raw so the
// signature can be verified against the exact bytes Stripe signed — it MUST see
// the raw body, never a parsed one, which is why this lives outside any JSON
// parser (Handback has no global express.json(); the only risk would be mounting
// this behind one).
//
// It does the least possible per event: verify the signature, find the customer
// id, and hand off to reconcileByCustomer — which re-derives entitlements from
// Stripe's live state, so this handler is naturally idempotent and order-
// independent (see server/stripe.ts). We reply 2xx on anything we handled or
// safely ignored, and 5xx only on a real transient failure so Stripe retries.

import express from 'express'
import { z } from 'zod'
import { reportError } from './alerts'
import { env } from './env'
import { log } from './logger'
import { reconcileByCustomer, stripe } from './stripe'

export const stripeWebhookRouter = express.Router()

// A customer reference is either the bare id or an expanded object with one.
const customerRef = z.union([z.string(), z.object({ id: z.string() })])
const hasCustomer = z.object({ customer: customerRef.nullish() })

/** Pull the customer id off any event object without trusting its concrete type. */
function customerIdOf(obj: unknown): string | null {
  const parsed = hasCustomer.safeParse(obj)
  if (!parsed.success || parsed.data.customer == null) return null
  const c = parsed.data.customer
  return typeof c === 'string' ? c : c.id
}

// The events that can change a subscription's entitling state. Anything else we
// acknowledge and drop — reconcile would compute the same answer regardless.
const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
])

stripeWebhookRouter.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
      res.status(503).json({ error: 'billing not configured' })
      return
    }
    const sig = req.headers['stripe-signature']
    if (typeof sig !== 'string') {
      res.status(400).send('missing stripe-signature')
      return
    }

    let event
    try {
      // req.body is a Buffer here thanks to express.raw above.
      event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET)
    } catch (err) {
      // A bad signature is a client problem — never retry-able, never alert.
      log.warn(`[stripe] webhook signature verification failed: ${String(err)}`)
      res.status(400).send('invalid signature')
      return
    }

    if (!HANDLED.has(event.type)) {
      res.json({ received: true, ignored: event.type })
      return
    }

    const customerId = customerIdOf(event.data.object)
    if (!customerId) {
      // Handled type but no customer to reconcile (shouldn't happen) — ack it so
      // Stripe stops retrying.
      log.warn(`[stripe] ${event.type} carried no customer id`)
      res.json({ received: true })
      return
    }

    try {
      await reconcileByCustomer(customerId)
      res.json({ received: true })
    } catch (err) {
      // A transient failure (DB down, Stripe API blip): 5xx so Stripe redelivers.
      reportError(
        'server',
        `stripe webhook reconcile failed (${event.type})`,
        `${customerId}: ${String(err)}`
      )
      res.status(500).json({ error: 'reconcile failed' })
    }
  }
)
