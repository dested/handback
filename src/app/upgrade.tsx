// Handback Pro / Business (/upgrade): the pricing wall and the entry points into
// Stripe Checkout and the Customer Portal. When billing isn't configured on the
// server it falls back to the "write us" card, so this page is safe in any env.
//
// On return from Checkout (?checkout=success) it calls billing.sync once so the
// account reflects the new plan immediately, without waiting on the webhook.

import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { buttonVariants } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

type Plan = 'pro' | 'biz'

const PLANS: Array<{
  plan: Plan
  name: string
  price: string
  tagline: string
  features: string[]
}> = [
  {
    plan: 'pro',
    name: 'Pro',
    price: '$29',
    tagline: 'For an individual shipping with agents.',
    features: [
      '80 walkthroughs a month',
      '15 hours of cloud transcription',
      'The refine pass on every upload',
      'The walkthrough assistant — 30 turns a month',
      'Transcript polish',
      'Create and run teams',
    ],
  },
  {
    plan: 'biz',
    name: 'Business',
    price: '$49',
    tagline: 'For a team with a heavier queue.',
    features: [
      '130 walkthroughs a month',
      '30 hours of cloud transcription',
      'Everything in Pro',
      'The walkthrough assistant',
      'Transcript polish',
      'Create and run teams',
    ],
  },
]

const PERIOD_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

export function UpgradePage() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const billing = useQuery(trpc.billing.status.queryOptions())
  const entitlements = useQuery(trpc.teams.entitlements.queryOptions())

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.billing.status.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.teams.entitlements.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.usage.mine.queryKey() })
  }

  const checkout = useMutation(
    trpc.billing.checkout.mutationOptions({
      onSuccess: ({ url }) => {
        window.location.href = url
      },
    })
  )
  const portal = useMutation(
    trpc.billing.portal.mutationOptions({
      onSuccess: ({ url }) => {
        window.location.href = url
      },
    })
  )
  const sync = useMutation(trpc.billing.sync.mutationOptions({ onSuccess: invalidate }))

  // Returned from Checkout — pull the fresh subscription state once, then strip
  // the query param so a refresh doesn't re-run it.
  const syncedRef = useRef(false)
  useEffect(() => {
    if (syncedRef.current) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('checkout') === 'success') {
      syncedRef.current = true
      sync.mutate()
      params.delete('checkout')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
  }, [sync])

  const configured = billing.data?.configured ?? false
  const currentPlan = billing.data?.plan ?? null
  const status = billing.data?.status ?? null
  const periodEnd = billing.data?.currentPeriodEnd
  const isAdmin = entitlements.data?.pro && !currentPlan // pro via comp/admin, no Stripe plan
  const busy = checkout.isPending || portal.isPending || sync.isPending

  return (
    <div className="max-w-4xl space-y-8">
      <header className="space-y-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Handback Pro</h1>
        <p className="text-muted-foreground max-w-2xl leading-relaxed">
          The refine pass, the walkthrough assistant, and real cloud budgets — for people shipping
          with agents.
        </p>
      </header>

      {/* Current-subscription banner */}
      {currentPlan && (
        <div className="border-cobalt/30 bg-cobalt-wash/40 flex flex-wrap items-center justify-between gap-4 rounded-md border p-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="stamp text-cobalt">
                {currentPlan === 'biz' ? 'business' : 'pro'} is on
              </span>
              {status && status !== 'active' && (
                <span className="text-review bg-review-wash rounded px-1.5 py-0.5 font-mono text-xs">
                  {status.replace(/_/g, ' ')}
                </span>
              )}
            </div>
            {periodEnd && (
              <p className="text-muted-foreground font-mono text-xs">
                {status === 'canceled' ? 'access ends' : 'renews'}{' '}
                {PERIOD_FMT.format(new Date(periodEnd))}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => portal.mutate()}
            className={cn(buttonVariants({ variant: 'outline' }), busy && 'opacity-60')}>
            Manage subscription
          </button>
        </div>
      )}

      {isAdmin && !currentPlan && (
        <div className="space-y-1">
          <span className="stamp text-cobalt">pro is on</span>
          <p className="text-muted-foreground text-sm">
            This account already has everything below (granted directly).
          </p>
        </div>
      )}

      {/* Pricing cards — the real thing when billing is configured */}
      {configured ? (
        <div className="grid gap-5 sm:grid-cols-2">
          {PLANS.map((p) => {
            const isCurrent = currentPlan === p.plan
            return (
              <div
                key={p.plan}
                className={cn(
                  'bg-card flex flex-col rounded-md border p-6',
                  isCurrent ? 'border-cobalt' : 'border-border'
                )}>
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display text-2xl font-semibold">{p.name}</h2>
                  <div className="text-right">
                    <span className="font-display text-3xl font-semibold">{p.price}</span>
                    <span className="text-muted-foreground font-mono text-xs"> /mo</span>
                  </div>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">{p.tagline}</p>
                <ul className="mt-5 flex-1 space-y-2">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2 text-sm leading-snug">
                      <span className="text-cobalt mt-0.5 shrink-0">→</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  {isCurrent ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => portal.mutate()}
                      className={cn(
                        buttonVariants({ variant: 'outline' }),
                        'w-full',
                        busy && 'opacity-60'
                      )}>
                      Manage
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || isAdmin}
                      onClick={() => checkout.mutate({ plan: p.plan })}
                      className={cn(buttonVariants(), 'w-full', (busy || isAdmin) && 'opacity-60')}>
                      {currentPlan ? `Switch to ${p.name}` : `Choose ${p.name}`}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        !currentPlan &&
        !isAdmin && (
          <div className="bg-card border-border space-y-3 rounded-md border p-6">
            <h2 className="font-display text-lg font-semibold">
              Invite-only while Handback is in alpha
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Tell us what you're building and we'll turn it on for your account.
            </p>
            <a href="mailto:sal@dested.com?subject=Handback%20Pro" className={buttonVariants()}>
              Contact sal@dested.com
            </a>
          </div>
        )
      )}

      {(checkout.isError || portal.isError || sync.isError) && (
        <p className="text-destructive text-sm">
          {checkout.error?.message ?? portal.error?.message ?? sync.error?.message}
        </p>
      )}

      {configured && !currentPlan && (
        <p className="text-muted-foreground text-xs">
          Have a promo code? Enter it at checkout. Secure payment by Stripe; cancel anytime from the
          billing portal.
        </p>
      )}
    </div>
  )
}
