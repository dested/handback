// The conversation: the chronological record of the review — refine/activity
// system lines, agent results, questions, answers, send-backs, and the reviewer's
// timestamped comments — merged into one list sorted by time, with a single
// comment box at the foot. It is the history and the margin, nothing else: the
// act-on-it controls (sign-off, answer-the-agent) live on the Overview/Verdict
// hero, and the AI editor is its own "Edit with AI" tab.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../../server/router'
import { Button } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { mmss } from '../format'
import type { Walkthrough } from '../types'

type Outputs = inferRouterOutputs<AppRouter>
type CommentRow = Outputs['walkthroughs']['comments'][number]
type Note = Walkthrough['notes'][number]
type Activity = Walkthrough['activity'][number]

/** Coarse relative time — the thread cares about "just now" vs "yesterday". */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** `Jul 29` — the short date the system lines read with. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function activityText(a: Activity): string {
  if (a.action === 'pulled') return `pulled by ${a.tokenName} · ${ago(a.createdAt)}`
  if (a.action === 'result') return `result posted by ${a.tokenName} · ${ago(a.createdAt)}`
  return `marked ${a.detail ?? 'a status'} by ${a.tokenName} · ${ago(a.createdAt)}`
}

/** The 20px initial chip that fronts a comment. */
function Chip({ letter }: { letter: string }) {
  return (
    <span className="bg-muted flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px]">
      {letter}
    </span>
  )
}

/**
 * Proof-screenshots attached to a note. Paths are take-relative and resolve
 * against the walkthrough's own presigned file list; a path with no matching
 * file is dropped rather than rendered broken.
 */
function EvidenceThumbs({ paths, urlByPath }: { paths: string[]; urlByPath: Map<string, string> }) {
  const shots = paths
    .map((path) => ({ path, url: urlByPath.get(path) }))
    .filter((shot): shot is { path: string; url: string } => shot.url !== undefined)
  if (shots.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {shots.map((shot) => (
        <a key={shot.path} href={shot.url} target="_blank" rel="noreferrer">
          <img src={shot.url} alt="" className="border-border h-16 rounded-md border object-cover" />
        </a>
      ))}
    </div>
  )
}

/** One review note, rendered by kind — question, answer, agent result, send-back. */
function NoteEntry({
  note,
  pointCount,
  urlByPath,
}: {
  note: Note
  pointCount: number
  urlByPath: Map<string, string>
}) {
  if (note.kind === 'question') {
    return (
      <div className="border-l-muted-foreground space-y-1 border-l-2 pl-3">
        <span className="text-muted-foreground font-mono text-[11px]">
          {note.authorName} asked · {ago(note.createdAt)}
        </span>
        <p className="text-[13px] leading-relaxed">{note.summary}</p>
        <EvidenceThumbs paths={note.evidencePaths} urlByPath={urlByPath} />
      </div>
    )
  }
  if (note.kind === 'answer') {
    return (
      <div className="border-border space-y-1 border-l-2 pl-3">
        <span className="text-muted-foreground font-mono text-[11px]">
          {note.authorName} answered · {ago(note.createdAt)}
        </span>
        <p className="text-[13px] leading-relaxed">{note.summary}</p>
      </div>
    )
  }
  if (note.role === 'agent') {
    const fixed = note.outcomes.filter((o) => o.status === 'fixed').length
    return (
      <div className="border-border bg-card space-y-2 rounded-md border p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-muted-foreground font-mono text-[11px]">
            {note.authorName} · {ago(note.createdAt)}
          </span>
          {note.prUrl && (
            <a
              href={note.prUrl}
              target="_blank"
              rel="noreferrer"
              className="text-cobalt font-mono text-[11px] hover:underline">
              view the PR ↗
            </a>
          )}
        </div>
        <p className="text-[13px] leading-relaxed">{note.summary}</p>
        {note.outcomes.length > 0 && pointCount > 0 && (
          <p
            className={cn(
              'font-mono text-[11px]',
              fixed === pointCount ? 'text-approve' : 'text-muted-foreground'
            )}>
            {fixed}/{pointCount} key points addressed
          </p>
        )}
        {note.filesTouched.length > 0 && (
          <p className="text-muted-foreground font-mono text-[11px] break-all">
            {note.filesTouched.join(' · ')}
          </p>
        )}
        <EvidenceThumbs paths={note.evidencePaths} urlByPath={urlByPath} />
        {note.bodyMd && (
          <details>
            <summary className="text-muted-foreground cursor-pointer font-mono text-[11px]">
              details
            </summary>
            <pre className="bg-muted/30 mt-2 max-h-72 overflow-y-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
              {note.bodyMd}
            </pre>
          </details>
        )}
      </div>
    )
  }
  // A reviewer send-back, kind 'result'.
  return (
    <div className="border-border space-y-1 border-l-2 pl-3">
      <span className="text-muted-foreground font-mono text-[11px]">
        sent back — {note.authorName} · {ago(note.createdAt)}
      </span>
      <p className="text-[13px] leading-relaxed">{note.summary}</p>
    </div>
  )
}

/** A comment — its own head row carries the seek chip and the inline delete arm. */
function CommentEntry({
  comment,
  armed,
  deleting,
  onArm,
  onCancel,
  onDelete,
  onSeek,
}: {
  comment: CommentRow
  armed: boolean
  deleting: boolean
  onArm: () => void
  onCancel: () => void
  onDelete: () => void
  onSeek: (ms: number) => void
}) {
  return (
    <div className="flex gap-2.5">
      <Chip letter={(comment.authorName || '?').charAt(0).toUpperCase()} />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-muted-foreground font-mono text-[11px]">{comment.authorName}</span>
          {comment.atMs !== null && (
            <button
              type="button"
              onClick={() => onSeek(comment.atMs ?? 0)}
              className="text-cobalt font-mono text-[11px] hover:underline">
              {mmss(comment.atMs)}
            </button>
          )}
          <span className="text-muted-foreground font-mono text-[11px]">· {ago(comment.createdAt)}</span>
          {comment.mine &&
            (armed ? (
              <span className="font-mono text-[10px]">
                <span className="text-muted-foreground">delete? </span>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={onDelete}
                  className="text-destructive hover:underline">
                  yes
                </button>
                <span className="text-muted-foreground"> / </span>
                <button type="button" onClick={onCancel} className="text-muted-foreground hover:underline">
                  keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label="Delete comment"
                onClick={onArm}
                className="text-muted-foreground hover:text-destructive font-mono text-[10px]">
                ×
              </button>
            ))}
        </div>
        <p className="text-[13px] leading-relaxed">{comment.text}</p>
      </div>
    </div>
  )
}

export function Conversation({
  walkthrough,
  playheadMs,
  onSeek,
}: {
  walkthrough: Walkthrough
  playheadMs: number
  onSeek: (ms: number) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const invalidateComments = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.walkthroughs.comments.queryKey({ walkthroughId: walkthrough.id }),
    })

  const comments = useQuery(
    trpc.walkthroughs.comments.queryOptions({ walkthroughId: walkthrough.id })
  )

  // The comment composer — one box, one job. A pin chip appears once the player
  // has moved so a note can hang off a moment in the recording.
  const [commentText, setCommentText] = useState('')
  const [pinOn, setPinOn] = useState(false)
  const addComment = useMutation(
    trpc.walkthroughs.addComment.mutationOptions({
      onSuccess: () => {
        setCommentText('')
        invalidateComments()
      },
    })
  )

  // Comment delete arms inline on its own head row — no window.confirm.
  const [armedComment, setArmedComment] = useState<string | null>(null)
  const deleteComment = useMutation(
    trpc.walkthroughs.deleteComment.mutationOptions({
      onSuccess: () => {
        setArmedComment(null)
        invalidateComments()
      },
    })
  )

  // Evidence paths resolve against the walkthrough's own presigned file list.
  const urlByPath = useMemo(
    () => new Map(walkthrough.files.map((file) => [file.path, file.url])),
    [walkthrough.files]
  )

  // Merge every source into one list, ascending by timestamp.
  const entries: { ts: number; key: string; node: React.ReactNode }[] = []
  if (walkthrough.refinedAt) {
    entries.push({
      ts: Date.parse(walkthrough.refinedAt),
      key: 'refine',
      node: (
        <p className="text-muted-foreground font-mono text-[11px]">
          · refined — {walkthrough.points.length} key points,{' '}
          {walkthrough.curation?.frames.length ?? 0} curated frames · {shortDate(walkthrough.refinedAt)}
        </p>
      ),
    })
  }
  walkthrough.activity.forEach((a, i) => {
    entries.push({
      ts: Date.parse(a.createdAt),
      key: `act-${i}`,
      node: <p className="text-muted-foreground font-mono text-[11px]">· {activityText(a)}</p>,
    })
  })
  ;(comments.data ?? []).forEach((comment) => {
    entries.push({
      ts: Date.parse(comment.createdAt),
      key: `com-${comment.id}`,
      node: (
        <CommentEntry
          comment={comment}
          armed={armedComment === comment.id}
          deleting={deleteComment.isPending}
          onArm={() => setArmedComment(comment.id)}
          onCancel={() => setArmedComment(null)}
          onDelete={() => deleteComment.mutate({ commentId: comment.id })}
          onSeek={onSeek}
        />
      ),
    })
  })
  walkthrough.notes.forEach((note) => {
    entries.push({
      ts: Date.parse(note.createdAt),
      key: `note-${note.id}`,
      node: <NoteEntry note={note} pointCount={walkthrough.points.length} urlByPath={urlByPath} />,
    })
  })
  entries.sort((a, b) => a.ts - b.ts)

  return (
    <div className="flex max-w-[680px] flex-col gap-4">
      {/* The thread. */}
      <div className="flex flex-col gap-4">
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            Nothing here yet — the conversation starts when someone comments or an agent pulls the
            walkthrough.
          </p>
        ) : (
          entries.map((entry) => <div key={entry.key}>{entry.node}</div>)
        )}
      </div>

      {/* The comment box. */}
      {walkthrough.viewerIsMember && (
        <form
          className="flex gap-2 pt-2"
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = commentText.trim()
            if (!trimmed || addComment.isPending) return
            addComment.mutate({
              walkthroughId: walkthrough.id,
              text: trimmed,
              atMs: pinOn ? Math.round(playheadMs) : null,
            })
          }}>
          {playheadMs > 0 && (
            <button
              type="button"
              aria-pressed={pinOn}
              onClick={() => setPinOn(!pinOn)}
              className={cn(
                'shrink-0 rounded-md border px-2 py-1.5 font-mono text-[10px] transition-colors',
                pinOn
                  ? 'border-cobalt bg-cobalt-wash text-cobalt'
                  : 'border-input text-muted-foreground hover:text-foreground'
              )}>
              at {mmss(playheadMs)}
            </button>
          )}
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            className="border-input bg-card focus-visible:border-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none"
          />
          <Button type="submit" disabled={addComment.isPending || !commentText.trim()}>
            Send
          </Button>
        </form>
      )}
      {addComment.error && <p className="text-destructive text-[13px]">{addComment.error.message}</p>}
    </div>
  )
}
