import { cn } from '~/lib/utils'
import { Section, SectionHeading, SectionLabel } from './section'

const steps = [
  {
    n: '01',
    title: 'Record',
    body: 'Narrate the bug in the app where it happens. Draw on the page. Every take lands on one timeline.',
  },
  {
    n: '02',
    title: 'Route',
    body: 'Gripes arrive in one inbox and auto-file to the right project by the origin they were recorded on.',
  },
  {
    n: '03',
    title: 'Fix',
    body: 'Your coding agent pulls the brief over MCP — transcript, keyframes, console errors — and opens the fix.',
  },
  {
    n: '04',
    title: 'Sign off',
    body: 'A human reviews the before-video against the fix and approves.',
  },
]

export function HowItWorks() {
  return (
    <Section id="how" className="rule py-20 md:py-28">
      <SectionLabel>How it works</SectionLabel>
      <SectionHeading>See it, say it, ship it, sign off.</SectionHeading>
      <ol className="mt-12">
        {steps.map((step, i) => (
          <li
            key={step.n}
            className={cn('grid gap-x-10 gap-y-2 py-10 md:grid-cols-[4rem_1fr]', i > 0 && 'rule')}>
            <span className="text-cobalt font-mono text-sm tracking-[0.14em]">{step.n}</span>
            <div>
              <h3 className="font-display text-2xl font-semibold tracking-tight">{step.title}</h3>
              <p className="text-muted-foreground mt-2 max-w-2xl leading-relaxed">{step.body}</p>
              {step.n === '04' && (
                <span className="stamp text-approve mt-6 text-[0.7rem]">SIGNED OFF</span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  )
}
