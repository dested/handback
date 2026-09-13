// Initials disc — the stand-in for a person wherever a name appears (topbar menu,
// List rows, conversation). First letters of the first two words; `?` when the
// name is unknown.

import { cn } from '~/lib/utils'

function initials(name: string | null): string {
  if (name === null) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string | null
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-cobalt-wash text-cobalt inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        size === 'sm' ? 'size-5 text-[9px]' : 'size-7 text-[11px]',
        className
      )}>
      {initials(name)}
    </span>
  )
}
