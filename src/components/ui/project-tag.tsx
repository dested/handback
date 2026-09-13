// A project shown as a coloured-swatch chip. The colour is derived from the id
// so the same project reads the same everywhere without storing a colour — a
// null id (the catch-all "General") gets a neutral grey.

import { cn } from '~/lib/utils'

const PROJECT_COLORS = ['#2f56d8', '#6b45d6', '#128a3c', '#0e7490', '#4b5563', '#b8236b']

export function projectColor(id: string | null): string {
  if (id === null) return '#9ca3af'
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  // The modulo keeps the index in range; the fallback only satisfies
  // noUncheckedIndexedAccess, it can't actually be reached.
  return PROJECT_COLORS[sum % PROJECT_COLORS.length] ?? '#2f56d8'
}

export function ProjectTag({
  id,
  name,
  className,
}: {
  id: string | null
  name: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'text-foreground/80 inline-flex h-[22px] items-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium',
        className
      )}>
      <i className="size-2 rounded-[2px]" style={{ background: projectColor(id) }} />
      {name}
    </span>
  )
}
