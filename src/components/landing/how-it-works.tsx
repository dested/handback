import { Section, SectionHeading, SectionLabel } from './section'

/**
 * The loop in four plain step cards. The heavy proof lives in `distill.tsx` and
 * `agent-view.tsx`; this section stays scannable at speed.
 */

const steps = [
  {
    n: '1',
    title: 'Record',
    body: 'Narrate what you’re seeing, in the app where it happens — a bug, a review note, a change you want. Draw on the page. Stop talking and it’s done.',
  },
  {
    n: '2',
    title: 'Route',
    body: 'Your walkthroughs land in Handback for your team to see and review — titled, timed, and filed to the right project.',
  },
  {
    n: '3',
    title: 'Fix',
    body: 'Your coding agent pulls the brief over MCP — sheets, transcript, the errors that fired while you were talking — and starts the fix.',
  },
  {
    n: '4',
    title: 'Sign off',
    body: 'You get notified when the work is handed back. Take a look, say the last word, sign off.',
  },
]

export function HowItWorks() {
  return (
    <Section id="how">
      <SectionLabel>How it works</SectionLabel>
      <SectionHeading>See it, say it, ship it, sign off.</SectionHeading>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <div key={step.n} className="bg-card rounded-lg border p-6">
            <span className="bg-cobalt-wash text-cobalt flex size-7 items-center justify-center rounded-md text-sm font-semibold">
              {step.n}
            </span>
            <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
            <p className="text-muted-foreground mt-1.5 text-[15px]">{step.body}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}
