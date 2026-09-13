// The right-hand detail pane on /app: it fetches the walkthrough itself (polling
// while refine runs, exactly as the full page does), builds the presigned-url
// lookup, drives the shared media hook, and renders the same DetailHeader +
// WalkthroughDetail body the page uses.

import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useWalkthroughMedia } from '~/components/viewer/desk/use-walkthrough-media'
import type { Walkthrough } from '~/components/viewer/types'
import { useTRPC } from '~/lib/trpc'
import { WalkthroughDetail } from './detail'
import { DetailHeader } from './header'

/** The bare close bar shown before the walkthrough loads (or when it can't). */
function CloseBar({ onClose }: { onClose: () => void }) {
  return (
    <div className="border-border flex items-center justify-end border-b px-4 py-2.5">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="text-muted-foreground hover:text-foreground hover:bg-secondary grid size-8 place-items-center rounded-md">
        <X className="size-4" />
      </button>
    </div>
  )
}

/** Split out so the media hook only runs once a walkthrough is loaded. */
function Loaded({
  walkthrough,
  urlByPath,
  onClose,
}: {
  walkthrough: Walkthrough
  urlByPath: Map<string, string>
  onClose: () => void
}) {
  const media = useWalkthroughMedia(walkthrough, urlByPath)
  return (
    <div className="flex h-full flex-col">
      <DetailHeader walkthrough={walkthrough} mode="pane" onClose={onClose} urlByPath={urlByPath} />
      <div className="flex-1 overflow-auto">
        <WalkthroughDetail walkthrough={walkthrough} urlByPath={urlByPath} media={media} mode="pane" />
      </div>
    </div>
  )
}

export function WalkthroughPane({
  walkthroughId,
  onClose,
}: {
  walkthroughId: string
  onClose: () => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const query = useQuery(trpc.walkthroughs.get.queryOptions({ walkthroughId }))
  const walkthrough = query.data

  const urlByPath = useMemo(
    () => new Map((walkthrough?.files ?? []).map((file) => [file.path, file.url])),
    [walkthrough]
  )

  // Refine runs server-side; poll get until it leaves 'running', same as the page.
  const refineStatus = walkthrough?.refineStatus
  useEffect(() => {
    if (refineStatus !== 'running') return
    const id = setInterval(() => {
      queryClient.invalidateQueries({
        queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId }),
      })
    }, 5000)
    return () => clearInterval(id)
  }, [refineStatus, walkthroughId, queryClient, trpc])

  if (query.isPending) {
    return (
      <div className="flex h-full flex-col">
        <CloseBar onClose={onClose} />
        <div className="flex-1 space-y-3 overflow-auto p-5">
          <div className="bg-muted h-4 w-2/3 animate-pulse rounded" />
          <div className="bg-muted h-4 w-full animate-pulse rounded" />
          <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
        </div>
      </div>
    )
  }

  if (!walkthrough) {
    return (
      <div className="flex h-full flex-col">
        <CloseBar onClose={onClose} />
        <div className="flex-1 overflow-auto p-5">
          <p className="text-[13px]">Couldn't load this walkthrough.</p>
        </div>
      </div>
    )
  }

  return <Loaded walkthrough={walkthrough} urlByPath={urlByPath} onClose={onClose} />
}
