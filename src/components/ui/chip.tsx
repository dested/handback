// A toggle chip — the filter control on the List/Board tools row (status facets,
// space/project triggers). `on` fills it with ink; an optional count trails muted.

import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

export function Chip({
  on = false,
  count,
  onClick,
  children,
  className,
}: {
  on?: boolean
  count?: number
  onClick?: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium',
        on
          ? 'bg-foreground border-foreground text-white'
          : 'text-foreground/80 hover:bg-secondary border-input bg-card',
        className
      )}>
      {children}
      {count !== undefined && <span className="font-mono text-xs opacity-70">{count}</span>}
    </button>
  )
}
