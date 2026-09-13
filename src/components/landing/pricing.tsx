import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { Section, SectionHeading, SectionLabel } from './section'

type Tier = {
  name: string
  price: string
  unit?: string
  /** How much recording the plan carries. */
  quota: string
  blurb: string
  cta: string
  to?: string
  href?: string
  /** The highlighted plan — cobalt top border and the "Most popular" chip. */
  featured?: boolean
}

// Billing is live: the paid plans check out through Stripe. Their CTAs go to
// /upgrade (which requires sign-in, then hands off to Stripe Checkout).
const tiers: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    unit: 'no card, live today',
    quota: '2 walkthroughs and 1 hour of transcription / mo',
    blurb: 'The full treatment on every walkthrough — cloud transcription and the refine pass',
    cta: 'Start free',
    to: '/sign-up',
  },
  {
    name: 'Pro',
    price: '$29',
    unit: 'per reviewer / mo',
    quota: 'Up to 15 hours and 80 walkthroughs / mo',
    blurb: 'Your agent over MCP, the refine pass, and the walkthrough assistant',
    cta: 'Get Pro',
    to: '/upgrade',
    featured: true,
  },
  {
    name: 'Business',
    price: '$49',
    unit: 'per reviewer / mo',
    quota: 'Up to 30 hours and 130 walkthroughs / mo',
    blurb: 'Teams — invite reviewers, roles, projects',
    cta: 'Get Business',
    to: '/upgrade',
  },
  {
    name: 'Enterprise',
    price: "Let's talk",
    quota: 'Custom volume',
    blurb: 'SSO, retention, your own bucket',
    cta: 'Email us',
    href: 'mailto:sal@dested.com',
  },
]

export function Pricing() {
  return (
    <Section id="pricing">
      <SectionLabel>Pricing</SectionLabel>
      <SectionHeading>Priced per reviewer, not per walkthrough.</SectionHeading>
      <p className="text-muted-foreground mt-4 max-w-xl text-[15px]">
        The free tier is live today — record, and every walkthrough comes back refined. Upgrade to
        Pro or Business whenever you need more room; cancel anytime.
      </p>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiers.map((tier) => {
          const ctaClass = cn(
            buttonVariants({ variant: tier.featured ? 'default' : 'outline', size: 'lg' }),
            'mt-6 w-full'
          )
          return (
            <div
              key={tier.name}
              className={cn(
                'bg-card flex flex-col rounded-lg border p-6',
                tier.featured && 'border-t-cobalt border-t-2'
              )}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">{tier.name}</h3>
                {tier.featured && (
                  <span className="bg-cobalt-wash text-cobalt rounded-md px-2 py-0.5 text-xs font-medium">
                    Most popular
                  </span>
                )}
              </div>
              <p className="mt-5 text-3xl font-semibold tracking-tight">{tier.price}</p>
              {/* nbsp keeps all four price blocks on one baseline */}
              <p className="text-muted-foreground mt-1 text-[13px]">{tier.unit ?? ' '}</p>
              <p className="mt-4 flex items-start gap-2 text-[15px]">
                <Check className="text-cobalt mt-0.5 size-4 shrink-0" />
                <span>{tier.quota}</span>
              </p>
              <p className="text-muted-foreground mt-2 flex-1 text-[15px]">{tier.blurb}</p>
              {tier.href ? (
                <a href={tier.href} className={ctaClass}>
                  {tier.cta}
                </a>
              ) : (
                <Link to={tier.to ?? '/sign-up'} className={ctaClass}>
                  {tier.cta}
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}
