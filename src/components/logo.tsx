// The Inloop identity: two interlocked loops (human + agent), ink and cobalt,
// beside the lowercase Fraunces wordmark. Import this — never redraw it.

import { cn } from '~/lib/utils'

export function LoopMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 20"
      fill="none"
      aria-hidden="true"
      className={cn('h-5 w-auto', className)}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="18" cy="10" r="7" stroke="var(--cobalt)" strokeWidth="2.4" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LoopMark />
      <span className="font-display text-xl font-semibold tracking-tight">inloop</span>
    </span>
  )
}
