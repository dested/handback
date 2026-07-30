import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Shared chrome for /privacy and /terms. Editorial, left-aligned, prose-width —
 * these are documents, not marketing sections, so no centering and no flourishes
 * beyond the hairline rules the rest of the site divides sections with.
 */

export function LegalPage({
  title,
  summary,
  updated,
  children,
}: {
  title: string
  summary: string
  /** Human-readable date, e.g. "July 30, 2026". */
  updated: string
  children: ReactNode
}) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <header className="rule border-t-0 pb-10">
        <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
          Last updated {updated}
        </p>
        <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          {title}
        </h1>
        <p className="text-muted-foreground mt-4 text-lg leading-relaxed">{summary}</p>
      </header>
      <div className="rule space-y-10 pt-10">{children}</div>
      <footer className="rule text-muted-foreground mt-14 pt-8 text-sm">
        Questions about this document? Email{' '}
        <a className="text-cobalt font-medium hover:underline" href="mailto:sal@dested.com">
          sal@dested.com
        </a>
        . See also{' '}
        <Link className="text-cobalt font-medium hover:underline" to="/privacy">
          Privacy
        </Link>{' '}
        and{' '}
        <Link className="text-cobalt font-medium hover:underline" to="/terms">
          Terms
        </Link>
        .
      </footer>
    </article>
  )
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-2xl font-semibold tracking-tight">{heading}</h2>
      <div className="mt-3 space-y-3 leading-relaxed [&_a]:font-medium [&_a]:text-cobalt hover:[&_a]:underline">
        {children}
      </div>
    </section>
  )
}

/** A definition-style list — used for "what we collect" and the subprocessor table. */
export function Terms({ items }: { items: { term: string; detail: ReactNode }[] }) {
  return (
    <dl className="divide-border divide-y">
      {items.map((item) => (
        <div key={item.term} className="grid gap-1 py-3 sm:grid-cols-[13rem_1fr] sm:gap-6">
          <dt className="font-mono text-sm leading-relaxed font-medium">{item.term}</dt>
          <dd className="text-muted-foreground leading-relaxed">{item.detail}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Callout for the things a reader genuinely needs to notice. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="border-cobalt bg-cobalt-wash text-foreground border-l-2 py-2 pl-4 leading-relaxed">
      {children}
    </p>
  )
}
