import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'
import { WALKTHROUGH } from './demo-data'
import { CheckoutShot, SHOTS } from './demo-shot'
import { Section, SectionHeading, SectionLabel } from './section'

/**
 * Four steps, each with the thing itself next to it. The examples are small on
 * purpose — `distill.tsx` and `agent-view.tsx` carry the heavy proof, and this
 * section has to stay scannable at speed.
 */

const steps = [
  {
    n: '01',
    title: 'Record',
    body: 'Narrate what you’re seeing, in the app where it happens — a bug, a review note, a change you want. Draw on the page. Stop talking and it’s done.',
    mock: <TimelineMock />,
  },
  {
    n: '02',
    title: 'Route',
    body: 'Your walkthroughs land in Handback for your team to see and review — titled, timed, and filed to the right project.',
    mock: <InboxMock />,
  },
  {
    n: '03',
    title: 'Fix',
    body: 'Your coding agent pulls the brief over MCP — sheets, transcript, the errors that fired while you were talking — and starts the fix.',
    mock: <AgentMock />,
  },
  {
    n: '04',
    title: 'Sign off',
    body: 'You get notified when the work is handed back. Take a look, say the last word, sign off.',
    mock: <HandedBackMock />,
  },
]

export function HowItWorks() {
  return (
    <Section id="how" className="rule py-20 md:py-28">
      <SectionLabel>How it works</SectionLabel>
      <SectionHeading>See it, say it, ship it, sign off.</SectionHeading>
      <ol className="mt-10">
        {steps.map((step, i) => (
          <li
            key={step.n}
            className={cn(
              'grid items-start gap-x-10 gap-y-6 py-10 lg:grid-cols-[3rem_minmax(0,19rem)_1fr]',
              i > 0 && 'rule'
            )}>
            <span className="text-cobalt font-mono text-sm tracking-[0.14em]">{step.n}</span>
            <div className="min-w-0">
              <h3 className="font-display text-2xl font-semibold tracking-tight">{step.title}</h3>
              <p className="text-muted-foreground mt-2 leading-relaxed">{step.body}</p>
            </div>
            <div className="min-w-0 lg:col-start-3 lg:row-start-1">{step.mock}</div>
          </li>
        ))}
      </ol>
    </Section>
  )
}

/** A framed example: hairline card, mono caption underneath. */
function Example({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <figure>
      <div className="bg-card overflow-hidden rounded-lg border shadow-sm">{children}</div>
      <figcaption className="text-muted-foreground mt-2.5 font-mono text-[0.68rem]">
        {caption}
      </figcaption>
    </figure>
  )
}

/**
 * The one-timeline editor: two takes laid end to end, the seam dashed, spoken
 * lines as cobalt carets over an ink-grey voice lane.
 */
function TimelineMock() {
  const marks = [8, 14, 21, 33, 41, 52, 63, 71, 84]
  const voice = [12, 30, 52, 44, 18, 8, 26, 60, 48, 36, 14, 22, 58, 40, 30, 16, 44, 52, 28, 10]
  return (
    <Example caption="one timeline · 2 takes · drag across the seam">
      <div className="px-3.5 pt-3 pb-3.5">
        <div className="text-muted-foreground flex justify-between font-mono text-[0.6rem]">
          {['0:00', '0:30', '1:00', '1:34'].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>

        {/* Frames across both takes — take 2 is the same flow attempted again, which
            is why the strip repeats. */}
        <div className="mt-2 flex gap-px">
          {[...SHOTS, ...SHOTS.slice(0, 5)].map((shot, i) => (
            <CheckoutShot key={i} shot={shot} className="min-w-0 flex-1 rounded-[1px]" />
          ))}
        </div>

        {/* Voice lane with mark carets and the take seam */}
        <div className="relative mt-2">
          <div className="flex h-7 items-end gap-px">
            {voice.map((h, i) => (
              <span
                key={i}
                className="bg-foreground/30 flex-1 rounded-t-[1px]"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <div className="border-muted-foreground/50 absolute inset-y-0 left-[62%] border-l border-dashed" />
          <span className="text-muted-foreground absolute -top-0.5 left-[62%] ml-1 font-mono text-[0.55rem]">
            take 2
          </span>
        </div>
        <div className="relative h-3">
          {marks.map((left) => (
            <span
              key={left}
              className="bg-cobalt absolute top-0 h-2 w-[1.5px]"
              style={{ left: `${left}%` }}
            />
          ))}
        </div>

        <p className="border-cobalt bg-cobalt-wash/70 mt-1 flex gap-2 border-l-2 py-1 pr-2 pl-2 text-[0.7rem] leading-snug">
          <span className="text-cobalt font-mono">0:19</span>
          <span className="truncate">and nothing. No error, no discount, the total is still…</span>
        </p>
      </div>
    </Example>
  )
}

/** The inbox: three walkthroughs, each already filed to a project by its origin. */
function InboxMock() {
  const rows = [
    {
      title: WALKTHROUGH.title,
      project: WALKTHROUGH.project,
      origin: WALKTHROUGH.origin,
      status: 'open' as const,
      when: '2m',
    },
    {
      title: 'Order confirmation email never arrives',
      project: WALKTHROUGH.project,
      origin: WALKTHROUGH.origin,
      status: 'in review' as const,
      when: '1h',
    },
    {
      title: 'Checkout redesign notes — spacing and copy',
      project: 'Back office',
      origin: 'northwind.test',
      status: 'resolved' as const,
      when: 'Tue',
    },
  ]
  const tone = {
    open: 'text-cobalt bg-cobalt-wash',
    'in review': 'text-review bg-review-wash',
    resolved: 'text-approve bg-approve-wash',
  }
  return (
    <Example caption="/app · filed to the right project">
      <ul>
        {rows.map((row, i) => (
          <li
            key={row.title}
            className={cn(
              'flex items-center gap-3 px-3.5 py-3',
              i > 0 && 'border-border border-t',
              i === 0 && 'bg-cobalt-wash/40'
            )}>
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[0.55rem] tracking-[0.08em] whitespace-nowrap uppercase',
                tone[row.status]
              )}>
              {row.status}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8rem] font-medium">{row.title}</p>
              <p className="text-muted-foreground truncate font-mono text-[0.6rem]">{row.origin}</p>
            </div>
            <span className="text-muted-foreground hidden shrink-0 text-[0.68rem] sm:block">
              {row.project}
            </span>
            <span className="text-muted-foreground shrink-0 font-mono text-[0.6rem]">
              {row.when}
            </span>
          </li>
        ))}
      </ul>
    </Example>
  )
}

/** The agent side, compressed to two calls — the full version is further down the page. */
function AgentMock() {
  return (
    <Example caption="claude code · handback mcp server">
      <div className="space-y-2 p-3.5 font-mono text-[0.7rem] leading-relaxed">
        <p>
          <span className="text-cobalt select-none">▸ </span>
          list_walkthroughs()
          <span className="text-muted-foreground"> → 3 open</span>
        </p>
        <p>
          <span className="text-cobalt select-none">▸ </span>
          get_walkthrough(<span className="text-muted-foreground">"promo-code-checkout"</span>)
        </p>
        <p className="text-muted-foreground pl-3.5">
          ← report.md · {WALKTHROUGH.sheets} sheets · {WALKTHROUGH.keyframes} frames · transcript ·{' '}
          {WALKTHROUGH.errors} errors
        </p>
        <p className="pt-1">
          <span className="text-cobalt select-none">▸ </span>
          set_walkthrough_status(<span className="text-muted-foreground">"in_review"</span>)
        </p>
      </div>
    </Example>
  )
}

/** The last beat: it comes back to you, and you're the one who closes it. */
function HandedBackMock() {
  return (
    <Example caption="handed back · the last word is yours">
      <div className="space-y-2.5 px-3.5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-review bg-review-wash shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[0.55rem] tracking-[0.08em] whitespace-nowrap uppercase">
            handed back
          </span>
          <p className="min-w-0 flex-1 truncate text-[0.8rem] font-medium">{WALKTHROUGH.title}</p>
          <span className="text-muted-foreground shrink-0 font-mono text-[0.6rem]">just now</span>
        </div>
        <div className="border-border flex items-center gap-3 border-t pt-2.5">
          <span className="stamp text-approve text-[0.65rem]">SIGNED OFF</span>
          <p className="text-muted-foreground text-[0.75rem] leading-relaxed">
            You looked, it ships. You&apos;re notified the moment it lands.
          </p>
        </div>
      </div>
    </Example>
  )
}
