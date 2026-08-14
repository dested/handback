// Margin notes on the recording. A comment can pin itself to the playhead
// (`atMs`, the walkthrough-wide output clock) — the mono time chip seeks — and
// every comment rides into the agent brief, so writing one here is also
// instructing the agent.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { mmss } from './format'

/** Coarse relative time, same voice as the review thread. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function CommentsPanel({
  walkthroughId,
  currentMs,
  canComment,
  onSeek,
}: {
  walkthroughId: string
  /** The player's output clock, for the "pin to m:ss" chip. */
  currentMs: number
  /** False on the admin read-only path — the list still renders. */
  canComment: boolean
  onSeek: (ms: number) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const comments = useQuery(trpc.walkthroughs.comments.queryOptions({ walkthroughId }))
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.walkthroughs.comments.queryKey({ walkthroughId }),
    })
  const add = useMutation(trpc.walkthroughs.addComment.mutationOptions({ onSettled: invalidate }))
  const remove = useMutation(
    trpc.walkthroughs.deleteComment.mutationOptions({ onSettled: invalidate })
  )

  const [text, setText] = useState('')
  // Pinning is the default: a comment written while watching is almost always
  // about the moment on screen. The chip toggles it off for general notes.
  const [pinned, setPinned] = useState(true)

  function submit() {
    const trimmed = text.trim()
    if (!trimmed || add.isPending) return
    add.mutate({ walkthroughId, text: trimmed, atMs: pinned ? Math.round(currentMs) : null })
    setText('')
  }

  const rows = comments.data ?? []
  if (comments.isError) return null

  return (
    <div className="max-w-2xl space-y-3">
      {rows.length === 0 && !canComment ? (
        <p className="text-muted-foreground text-sm">No comments.</p>
      ) : (
        rows.map((comment) => (
          <div key={comment.id} className="group flex items-baseline gap-2.5">
            {comment.atMs !== null ? (
              <button
                type="button"
                onClick={() => onSeek(comment.atMs ?? 0)}
                className="text-cobalt shrink-0 font-mono text-xs hover:underline">
                {mmss(comment.atMs)}
              </button>
            ) : (
              <span className="text-muted-foreground/50 shrink-0 font-mono text-xs">—</span>
            )}
            <p className="min-w-0 text-sm leading-relaxed">
              {comment.text}{' '}
              <span className="text-muted-foreground font-mono text-xs whitespace-nowrap">
                {comment.authorName} · {ago(comment.createdAt)}
              </span>
              {comment.mine && (
                <button
                  type="button"
                  aria-label="Delete comment"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ commentId: comment.id })}
                  className="text-muted-foreground hover:text-destructive ml-2 font-mono text-xs opacity-0 transition-opacity group-hover:opacity-100">
                  ×
                </button>
              )}
            </p>
          </div>
        ))
      )}

      {canComment && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}>
          <button
            type="button"
            aria-pressed={pinned}
            title={pinned ? 'Pinned to the playhead — click for a general note' : 'General note — click to pin to the playhead'}
            onClick={() => setPinned(!pinned)}
            className={cn(
              'shrink-0 rounded-md border px-2 py-1.5 font-mono text-xs transition-colors',
              pinned
                ? 'border-cobalt/40 bg-cobalt-wash text-cobalt'
                : 'border-input text-muted-foreground hover:text-foreground'
            )}>
            {pinned ? `@ ${mmss(currentMs)}` : 'no time'}
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            placeholder="Add a comment — your agent reads these too"
            aria-label="Comment"
            className="border-input bg-background focus-visible:border-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none"
          />
          <Button type="submit" variant="outline" size="sm" disabled={!text.trim() || add.isPending}>
            Comment
          </Button>
        </form>
      )}
      {add.error && <p className="text-destructive text-sm">{add.error.message}</p>}
    </div>
  )
}
