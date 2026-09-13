// Landing sections in the work-tool idiom: a centred 6xl measure, generous
// vertical rhythm, no full-bleed grounds (the page is white throughout). The
// eyebrow is a cobalt caps label, the heading plain Inter.

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
    <section id={id} className={cn('mx-auto w-full max-w-6xl px-7 py-20', className)}>
      {children}
    </section>
  )
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-cobalt text-xs font-semibold tracking-[.06em] uppercase', className)}>
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
    <h2 className={cn('mt-2 max-w-2xl text-3xl font-semibold tracking-tight', className)}>
      {children}
    </h2>
  )
}
