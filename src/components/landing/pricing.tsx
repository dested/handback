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
  featured?: boolean
  /** Label in the corner of the card. */
  badge?: string
  /** Priced, but not billable yet — free during the alpha. */
  soon?: boolean
}

// There is no billing yet, so no card here may imply a charge. The prices are
// real intentions and stay visible; the CTA and the badge say plainly that
// nothing is charged today.
const tiers: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    quota: 'Up to 1 hour of walkthroughs / mo',
    blurb: 'Your personal workspace and your own agent over MCP',
    cta: 'Start recording',
    to: '/sign-up',
  },
  {
    name: 'Pro',
    price: '$20',
    unit: 'per seat / mo, when billing opens',
    quota: 'Up to 3 hours / mo',
    blurb: 'Cloud workspace, share links, MCP access',
    cta: 'Use it free in alpha',
    to: '/sign-up',
    featured: true,
    badge: 'Free in alpha',
    soon: true,
  },
  {
    name: 'Business',
    price: '$40',
    unit: 'per seat / mo, when billing opens',
    quota: 'Up to 10 hours / mo',
    blurb: 'Teams — invite reviewers, roles, projects',
    cta: 'Use it free in alpha',
    to: '/sign-up',
    badge: 'Coming soon',
    soon: true,
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
    <Section id="pricing" className="rule py-20 md:py-28">
      <SectionLabel>Pricing</SectionLabel>
      <SectionHeading>Priced per reviewer, not per walkthrough.</SectionHeading>
      <p className="text-muted-foreground mt-4 max-w-xl text-sm leading-relaxed">
        Handback is in alpha and nothing is billed yet — every plan below runs free while we build.
        We'll ask before a card is ever needed.
      </p>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiers.map((tier) => {
          const ctaClass = cn(
            buttonVariants({ variant: tier.featured ? 'default' : 'outline' }),
            'mt-6 w-full'
          )
          return (
            <div
              key={tier.name}
              className={cn(
                'bg-card flex flex-col rounded-lg border p-6',
                tier.featured && 'border-cobalt'
              )}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-lg font-semibold tracking-tight">{tier.name}</h3>
                {tier.badge && (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 font-mono text-[0.65rem] tracking-[0.1em] uppercase',
                      tier.featured
                        ? 'bg-cobalt-wash text-cobalt'
                        : 'text-muted-foreground bg-muted'
                    )}>
                    {tier.badge}
                  </span>
                )}
              </div>
              {/* A price nobody is charged yet sits in muted ink, not full black. */}
              <p
                className={cn(
                  'font-display mt-5 text-3xl font-semibold tracking-tight',
                  tier.soon && 'text-muted-foreground'
                )}>
                {tier.price}
              </p>
              {/* nbsp keeps all four price blocks on one baseline */}
              <p className="text-muted-foreground mt-1 font-mono text-xs">{tier.unit ?? ' '}</p>
              <p className="text-foreground/80 mt-4 font-mono text-xs">{tier.quota}</p>
              <p className="text-muted-foreground mt-2 flex-1 text-sm leading-relaxed">
                {tier.blurb}
              </p>
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
