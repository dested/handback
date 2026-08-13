// Share link controls for a walkthrough the viewer is a member of. Off: one
// quiet button that mints the token. On: one pill — the /w URL in mono, then
// `copy`, then `revoke`, which kills the link; minting again rotates it (which
// is also how a leaked link dies without going dark first).

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import type { Walkthrough } from './types'
import { useCopy } from './use-copy'

export function ShareControl({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { copied, copy } = useCopy()

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
    })

  // Turn-off must win the race against every cached copy of the old token —
  // the mutation's own result AND the not-yet-refetched row. Without this the
  // revoke lands server-side while the link stays on screen ("turn off didn't
  // work"), and only a reload tells the truth.
  const [revoked, setRevoked] = useState(false)

  const share = useMutation(
    trpc.walkthroughs.share.mutationOptions({
      onMutate: () => setRevoked(false),
      onSettled: invalidate,
    })
  )
  const unshare = useMutation(
    trpc.walkthroughs.unshare.mutationOptions({
      onSuccess: () => setRevoked(true),
      onSettled: invalidate,
    })
  )

  // The freshly-minted token stands in until the refetch lands, so Copy works
  // the instant the button says the link exists. A mint in flight shows the
  // minting state, never a stale predecessor.
  const minted = share.isPending ? null : (share.data?.shareToken ?? null)
  const token = revoked ? null : (minted ?? walkthrough.shareToken)
  const busy = share.isPending || unshare.isPending

  if (!token) {
    return (
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => share.mutate({ walkthroughId: walkthrough.id })}>
        {share.isPending ? 'Creating link…' : 'Share link'}
      </Button>
    )
  }

  const url = `${window.location.origin}/w/${token}`

  return (
    <div className="flex items-center gap-0">
      <span className="border-input bg-card text-muted-foreground max-w-56 truncate rounded-l-md border border-r-0 px-2.5 py-1.5 font-mono text-xs">
        {url}
      </span>
      <button
        type="button"
        className="border-input text-cobalt hover:bg-cobalt-wash border px-2.5 py-1.5 font-mono text-xs"
        onClick={() => copy(url)}>
        {copied ? 'copied' : 'copy'}
      </button>
      <button
        type="button"
        className="border-input text-muted-foreground hover:text-destructive rounded-r-md border border-l-0 px-2.5 py-1.5 font-mono text-xs"
        disabled={busy}
        onClick={() => unshare.mutate({ walkthroughId: walkthrough.id })}>
        {unshare.isPending ? 'revoking…' : 'revoke'}
      </button>
    </div>
  )
}
