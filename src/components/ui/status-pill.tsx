// One walkthrough status, rendered as a washed pill with its ink dot. The four
// inks ARE the status vocabulary across the app (List, Board, detail, extension):
// violet "Your call" · cobalt Open · grey Needs info · green Done. `processing`
// overrides the label to a pulsing "Processing" regardless of the stored status.

import { cn } from '~/lib/utils'
import type { WalkthroughStatus } from '~/components/viewer/types'

export const STATUS_INK = {
  open: { label: 'Open', text: 'text-cobalt', dot: 'bg-cobalt', wash: 'bg-cobalt-wash' },
  in_review: { label: 'Your call', text: 'text-review', dot: 'bg-review', wash: 'bg-review-wash' },
  needs_info: {
    label: 'Needs info',
    text: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
    wash: 'bg-muted',
  },
  resolved: { label: 'Done', text: 'text-approve', dot: 'bg-approve', wash: 'bg-approve-wash' },
} as const satisfies Record<WalkthroughStatus, { label: string; text: string; dot: string; wash: string }>

function isStatus(status: string): status is WalkthroughStatus {
  return status in STATUS_INK
}

/** The ink for a status string, falling back to Open for anything unrecognised. */
export function statusInk(status: string): (typeof STATUS_INK)[WalkthroughStatus] {
  return isStatus(status) ? STATUS_INK[status] : STATUS_INK.open
}

export function StatusPill({
  status,
  processing = false,
  className,
}: {
  status: string
  processing?: boolean
  className?: string
}) {
  const ink = statusInk(status)
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap',
        ink.wash,
        ink.text,
        className
      )}>
      <i className={cn('size-[7px] rounded-full', ink.dot, processing && 'animate-pulse')} />
      {processing ? 'Processing' : ink.label}
    </span>
  )
}
