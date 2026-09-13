import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Shared chrome for /privacy, /terms and /docs. Left-aligned, prose-width, in the
 * work-tool idiom — plain Inter headings, a hairline footer, no editorial rules.
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
    <article className="mx-auto max-w-3xl px-7 py-12">
      <header className="pb-8">
        <p className="text-muted-foreground text-[13px]">Last updated {updated}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-3 text-[15px] leading-7">{summary}</p>
      </header>
      <div className="space-y-8">{children}</div>
      <footer className="text-muted-foreground mt-12 border-t pt-8 text-[13px]">
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

export function Section({
  heading,
  id,
  children,
}: {
  heading: string
  /** Anchor target, e.g. `#processors` linked from the recorder pages. */
  id?: string
  children: ReactNode
}) {
  return (
    // scroll-mt so a deep-link doesn't tuck the heading under the viewport top.
    <section id={id} className={id ? 'scroll-mt-24' : undefined}>
      <h2 className="mt-10 text-base font-semibold">{heading}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-7 [&_a]:font-medium [&_a]:text-cobalt hover:[&_a]:underline">
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
          <dt className="font-mono text-[13px] leading-7 font-medium">{item.term}</dt>
          <dd className="text-muted-foreground text-[15px] leading-7">{item.detail}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Callout for the things a reader genuinely needs to notice. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="bg-secondary rounded-lg border p-4 text-[13px] leading-6">{children}</p>
  )
}
