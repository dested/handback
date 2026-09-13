// The standard page head — title, optional meta beside it, right-aligned actions,
// and an optional tab row underneath. Every top-level surface opens with one.

import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

export function PageHeader({
  title,
  meta,
  actions,
  tabs,
  className,
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  tabs?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-col gap-3 px-7 pt-5', className)}>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {meta && <span className="text-muted-foreground text-[13px]">{meta}</span>}
        <span className="flex-1" />
        {actions}
      </div>
      {tabs}
    </header>
  )
}
