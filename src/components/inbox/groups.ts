// The four buckets a walkthrough falls into — the List's sections and the Board's
// columns, one vocabulary for both. Processing wins over status (a running refine
// reads as Processing whatever the stored status), then the review states, then
// resolved, then plain open. Order here is the contract order the views render in.

import type { InboxCard } from './types'

export type Group = 'call' | 'processing' | 'open' | 'done'

export function groupOf(card: InboxCard): Group {
  if (card.refineStatus === 'running') return 'processing'
  if (card.status === 'in_review' || card.status === 'needs_info') return 'call'
  if (card.status === 'resolved') return 'done'
  return 'open'
}

export const GROUPS: { key: Group; label: string; dot: string }[] = [
  { key: 'call', label: 'Needs your call', dot: 'bg-review' },
  { key: 'processing', label: 'Processing', dot: 'bg-muted-foreground' },
  { key: 'open', label: 'Open', dot: 'bg-cobalt' },
  { key: 'done', label: 'Done', dot: 'bg-approve' },
]
