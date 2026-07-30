// The Handback identity: one returning stroke — the work goes out in ink,
// turns, and comes back in cobalt to land in your hand — beside the lowercase
// Fraunces wordmark. Import this — never redraw it.

import { cn } from '~/lib/utils'

export function ReturnMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 20"
      fill="none"
      aria-hidden="true"
      className={cn('h-5 w-auto', className)}>
      <path
        d="M4 6.2 H18 A3.8 3.8 0 0 1 21.8 10"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M21.8 10 A3.8 3.8 0 0 1 18 13.8 H8"
        stroke="var(--cobalt)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M11.4 9.4 L6.2 13.8 L11.4 18.2"
        stroke="var(--cobalt)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <ReturnMark />
      <span className="font-display text-xl font-semibold tracking-tight">handback</span>
    </span>
  )
}
