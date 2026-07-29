import { Link } from 'react-router-dom'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { Section, SectionHeading, SectionLabel } from './section'

type Tier = {
  name: string
  price: string
  unit?: string
  blurb: string
  cta: string
  to?: string
  href?: string
  featured?: boolean
}

const tiers: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    blurb: 'Record locally, bring your own agent',
    cta: 'Start recording',
    to: '/sign-up',
  },
  {
    name: 'Pro',
    price: '$20',
    unit: 'per seat / mo',
    blurb: 'Cloud workspace, share links, MCP access',
    cta: 'Get started',
    to: '/sign-up',
    featured: true,
  },
  {
    name: 'Business',
    price: '$40',
    unit: 'per seat / mo',
    blurb: 'Projects, auto-routing, team roles',
    cta: 'Get started',
    to: '/sign-up',
  },
  {
    name: 'Enterprise',
    price: "Let's talk",
    blurb: 'SSO, retention, your own bucket',
    cta: 'Email us',
    href: 'mailto:sal@dested.com',
  },
]

export function Pricing() {
  return (
    <Section id="pricing" className="rule py-20 md:py-28">
      <SectionLabel>Pricing</SectionLabel>
      <SectionHeading>Priced per reviewer, not per gripe.</SectionHeading>
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
                {tier.featured && (
                  <span className="bg-cobalt-wash text-cobalt rounded-full px-2 py-0.5 font-mono text-[0.65rem] tracking-[0.1em] uppercase">
                    Most teams
                  </span>
                )}
              </div>
              <p className="font-display mt-5 text-3xl font-semibold tracking-tight">
                {tier.price}
              </p>
              {/* nbsp keeps all four price blocks on one baseline */}
              <p className="text-muted-foreground mt-1 font-mono text-xs">{tier.unit ?? ' '}</p>
              <p className="text-muted-foreground mt-5 flex-1 text-sm leading-relaxed">
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
