// Landing sections are full-bleed so they can carry their own ground colour and
// full-width hairline rules; the copy inside sits in the editorial 6xl measure.

import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

export function Section({
  id,
  className,
  children,
}: {
  id?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section id={id} className={className}>
      <div className="mx-auto w-full max-w-6xl px-6">{children}</div>
    </section>
  )
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'text-muted-foreground font-mono text-xs tracking-[0.18em] uppercase',
        className
      )}>
      {children}
    </p>
  )
}

export function SectionHeading({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <h2
      className={cn(
        'font-display mt-4 max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl',
        className
      )}>
      {children}
    </h2>
  )
}
