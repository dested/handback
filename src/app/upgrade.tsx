// The Handback Pro page (/upgrade): what Pro is, and the one way to get it while
// billing doesn't exist — write us. Reads `teams.entitlements` only to swap the
// contact card for a "you already have this" stamp once Pro is on.

import { useQuery } from '@tanstack/react-query'
import { buttonVariants } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'

const FEATURES: Array<[string, string]> = [
  [
    'refine',
    'Every upload distilled: curated captioned keyframes, a capture-health check, and a brief written for your agent.',
  ],
  [
    'the assistant',
    'Talk to a walkthrough — fix the transcript, cut a section, rewrite the brief. It does the editing.',
  ],
  ['polish', "Transcript cleanup that spells your product's nouns right."],
  ['budgets', '20 hours of cloud transcription a month.'],
]

export function UpgradePage() {
  const trpc = useTRPC()
  const entitlements = useQuery(trpc.teams.entitlements.queryOptions())
  const isPro = entitlements.data?.pro ?? false

  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Handback Pro</h1>
        <p className="text-muted-foreground leading-relaxed">
          The refine pass, the walkthrough assistant, and real cloud budgets — for teams shipping
          with agents.
        </p>
      </header>

      <div>
        {FEATURES.map(([label, desc]) => (
          <div key={label} className="rule flex flex-col gap-1 py-4 sm:flex-row sm:gap-6">
            <span className="text-muted-foreground w-32 shrink-0 font-mono text-xs tracking-[0.14em] uppercase">
              {label}
            </span>
            <p className="text-sm leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {isPro ? (
        <div className="space-y-3">
          <span className="stamp text-cobalt">pro is on</span>
          <p className="text-muted-foreground text-sm">This account already has everything above.</p>
        </div>
      ) : (
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
      )}
    </div>
  )
}
