// The detail action bar, shared by the pane and the full page. It carries the
// reviewer's two verdict controls — Approve and Send back — that used to live on
// the Overview hero's SignOff card, plus Copy brief (agent) or the share control
// (human) and the ⋯ menu. In the pane it also closes and links out to the page.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, buttonVariants } from '~/components/ui/button'
import { OverflowMenu, usePopover } from '~/components/viewer/overflow-menu'
import { ShareControl } from '~/components/viewer/share-control'
import type { Walkthrough } from '~/components/viewer/types'
import { useCopy } from '~/components/viewer/use-copy'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

/** Refetch this walkthrough and every inbox list (any project/status filter). */
export function useInvalidateWalkthrough(walkthroughId: string): () => void {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId }) })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
  }
}

/** What the agent needs to find this walkthrough and report back when it's done. */
export function agentBrief(walkthrough: Walkthrough): string {
  return (
    `Read the walkthrough "${walkthrough.title}" at ${window.location.origin}/walkthroughs/${walkthrough.id}. ` +
    `Pull the full brief with the handback MCP tool get_walkthrough("${walkthrough.id}") — the report.md ` +
    `inside is authored for you, follow it. When your fix is up, set the walkthrough to in_review ` +
    `with set_walkthrough_status.`
  )
}

export function DetailHeader({
  walkthrough,
  mode,
  onClose,
  urlByPath,
  onSplit,
}: {
  walkthrough: Walkthrough
  mode: 'pane' | 'page'
  /** Present in pane mode — the × dismisses the pane. */
  onClose?: () => void
  /** Presigned urls by path, handed to the ⋯ menu for MP4 export. */
  urlByPath?: Map<string, string>
  /** Present on the page — opens the Tasks tab from the ⋯ menu's Split entry. */
  onSplit?: () => void
}) {
  const trpc = useTRPC()
  const invalidate = useInvalidateWalkthrough(walkthrough.id)
  const { copied, copy } = useCopy()
  const sendBackPop = usePopover()

  const setStatus = useMutation(
    trpc.walkthroughs.setStatus.mutationOptions({ onSettled: invalidate })
  )
  const sendBack = useMutation(
    trpc.walkthroughs.sendBack.mutationOptions({
      onSuccess: () => sendBackPop.setOpen(false),
      onSettled: invalidate,
    })
  )

  // Exactly SignOff's guard: a member, in review, with an agent result to act on.
  const hasResult = walkthrough.notes.some((n) => n.role === 'agent' && n.kind === 'result')
  const canReview = walkthrough.viewerIsMember && walkthrough.status === 'in_review' && hasResult
  const busy = setStatus.isPending || sendBack.isPending

  // A member copies the brief while the work is still open; a non-member is a
  // platform admin looking in, who can still copy it to hand off.
  const canCopyBrief = walkthrough.viewerIsMember
    ? walkthrough.kind === 'agent' && walkthrough.status === 'open'
    : true

  return (
    <div className="border-border flex items-center gap-2 border-b px-4 py-2.5">
      {canReview && (
        <>
          <Button
            variant="approve"
            disabled={busy}
            onClick={() =>
              setStatus.mutate({ walkthroughId: walkthrough.id, status: 'resolved' })
            }>
            <Check className="size-4" />
            Approve
          </Button>
          <div ref={sendBackPop.ref} className="relative">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => sendBackPop.setOpen(!sendBackPop.open)}>
              Send back
            </Button>
            {sendBackPop.open && (
              <form
                className="bg-popover border-border absolute left-0 top-full z-30 mt-1 w-72 space-y-2 rounded-lg border p-2 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault()
                  const el = e.currentTarget.elements.namedItem('note')
                  const note = el instanceof HTMLTextAreaElement ? el.value.trim() : ''
                  if (note) sendBack.mutate({ walkthroughId: walkthrough.id, note })
                }}>
                <textarea
                  name="note"
                  autoFocus
                  rows={3}
                  disabled={busy}
                  placeholder="What still needs doing?"
                  aria-label="Send-back note"
                  className="border-input bg-card focus-visible:border-ring w-full resize-none rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') sendBackPop.setOpen(false)
                  }}
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  className="border-destructive text-destructive hover:bg-destructive/10">
                  Send back
                </Button>
                {sendBack.error && (
                  <p className="text-destructive text-xs">{sendBack.error.message}</p>
                )}
              </form>
            )}
          </div>
        </>
      )}

      <span className="flex-1" />

      {walkthrough.kind === 'human' && walkthrough.viewerIsMember ? (
        <ShareControl walkthrough={walkthrough} />
      ) : canCopyBrief ? (
        <Button variant="ghost" onClick={() => copy(agentBrief(walkthrough))}>
          {copied ? 'Copied' : 'Copy brief'}
        </Button>
      ) : null}

      <OverflowMenu walkthrough={walkthrough} urlByPath={urlByPath} onSplit={onSplit} />

      {mode === 'pane' && onClose && (
        <>
          <Link
            to={`/walkthroughs/${walkthrough.id}`}
            aria-label="Open full page"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}>
            <ExternalLink className="size-4" />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground hover:bg-secondary grid size-8 place-items-center rounded-md">
            <X className="size-4" />
          </button>
        </>
      )}
    </div>
  )
}
