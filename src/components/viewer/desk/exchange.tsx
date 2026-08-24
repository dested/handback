// The exchange: one chronological thread that replaces the four old panels
// (review thread, comments, assistant chat, refine notes). Every source — the
// refine event, agent activity, comments, review notes (results, questions,
// answers, send-backs) and the assistant chat — merges into a single list sorted
// by timestamp. The sign-off is pinned on top; one composer (comment · assistant)
// and, while a question is open, the answer form sit at the foot.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../../server/router'
import { Button } from '~/components/ui/button'
import { ProUpsell } from '~/components/pro-upsell'
import { isProError } from '~/lib/pro'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { mmss } from '../format'
import { SectionHead } from '../section-head'
import type { Walkthrough } from '../types'
import { useVoiceAnswer } from './use-voice-answer'

type Outputs = inferRouterOutputs<AppRouter>
type CommentRow = Outputs['walkthroughs']['comments'][number]
type ChatMessage = Outputs['walkthroughs']['chatHistory'][number]
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

/** The 20px initial chip that fronts a comment or chat turn. */
function Chip({ letter, accent }: { letter: string; accent?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px]',
        accent ? 'bg-cobalt-wash text-cobalt' : 'bg-muted'
      )}>
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

/** One assistant-thread turn — your message, or the assistant's with its actions. */
function ChatEntry({ row }: { row: ChatMessage }) {
  const isUser = row.role === 'user'
  return (
    <div className="flex gap-2.5">
      <Chip letter={isUser ? 'Y' : 'A'} accent={!isUser} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-muted-foreground font-mono text-[11px]">
          {isUser ? 'You → assistant' : 'assistant'} · {ago(row.createdAt)}
        </span>
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{row.content}</p>
        {row.actions.map((action, i) => (
          <p key={i} className="text-muted-foreground font-mono text-[11px]">
            · {action.detail}
          </p>
        ))}
      </div>
    </div>
  )
}

/**
 * The needs_info answer box: always visible while the walkthrough waits, never
 * armed. Type an answer, dictate one, or hand the question to whoever uploaded
 * the walkthrough. Each path invalidates the queries the viewer reads.
 */
function AnswerForm({ walkthrough, invalidate }: { walkthrough: Walkthrough; invalidate: () => void }) {
  const trpc = useTRPC()
  const [text, setText] = useState('')
  const answer = useMutation(
    trpc.walkthroughs.answerQuestion.mutationOptions({
      onSuccess: () => setText(''),
      onSettled: invalidate,
    })
  )
  const route = useMutation(
    trpc.walkthroughs.routeQuestion.mutationOptions({ onSettled: invalidate })
  )
  const voice = useVoiceAnswer((heard) => setText(heard))

  const uploader = walkthrough.uploadedByName
  const busy = answer.isPending || voice.transcribing

  return (
    <div className="space-y-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = text.trim()
          if (trimmed) answer.mutate({ walkthroughId: walkthrough.id, text: trimmed })
        }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          placeholder="Answer the agent…"
          aria-label="Answer the agent"
          className="border-input bg-card focus-visible:border-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none"
        />
        <Button type="submit" disabled={busy || !text.trim()}>
          Answer
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={voice.toggle}>
          {voice.recording ? `stop · ${voice.clock}` : 'Answer by voice'}
        </Button>
        {uploader &&
          (route.isSuccess ? (
            <span className="text-muted-foreground font-mono text-xs">sent to {uploader}</span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              disabled={busy || route.isPending}
              onClick={() => route.mutate({ walkthroughId: walkthrough.id })}>
              Ask {uploader}
            </Button>
          ))}
      </form>
      {voice.transcribing && (
        <p className="text-muted-foreground font-mono text-sm">transcribing…</p>
      )}
      {voice.error && <p className="text-destructive font-mono text-sm">{voice.error}</p>}
      {answer.error && <p className="text-destructive text-sm">{answer.error.message}</p>}
      {route.error && <p className="text-destructive text-sm">{route.error.message}</p>}
    </div>
  )
}

export function Exchange({
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

  // Any status/sendBack/answer/route mutation moves the walkthrough itself — its
  // read, the grid list, and the inbox all refetch.
  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
    })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
  }
  const invalidateComments = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.walkthroughs.comments.queryKey({ walkthroughId: walkthrough.id }),
    })

  const entitlements = useQuery(trpc.teams.entitlements.queryOptions())
  const pro = entitlements.data?.pro ?? false
  const entLoaded = entitlements.isSuccess
  const assistantAvailable = walkthrough.kind === 'agent' && walkthrough.briefMd === null

  const comments = useQuery(
    trpc.walkthroughs.comments.queryOptions({ walkthroughId: walkthrough.id })
  )
  const history = useQuery({
    ...trpc.walkthroughs.chatHistory.queryOptions({ walkthroughId: walkthrough.id }),
    enabled: pro && walkthrough.viewerIsMember && assistantAvailable,
  })

  // Sign-off.
  const setStatus = useMutation(
    trpc.walkthroughs.setStatus.mutationOptions({ onSettled: invalidate })
  )
  const sendBack = useMutation(
    trpc.walkthroughs.sendBack.mutationOptions({
      onSuccess: () => setArmed(false),
      onSettled: invalidate,
    })
  )
  const [armed, setArmed] = useState(false)

  // Composer.
  const [mode, setMode] = useState<'comment' | 'assistant'>('comment')
  const [commentText, setCommentText] = useState('')
  const [assistantMessage, setAssistantMessage] = useState('')
  const [pinOn, setPinOn] = useState(false)
  const addComment = useMutation(
    trpc.walkthroughs.addComment.mutationOptions({
      onSuccess: () => {
        setCommentText('')
        invalidateComments()
      },
    })
  )
  const chat = useMutation(
    trpc.walkthroughs.chat.mutationOptions({
      onSuccess: () => {
        setAssistantMessage('')
        queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.chatHistory.queryKey({ walkthroughId: walkthrough.id }),
        })
        // The turn may have edited the walkthrough itself — retitle, summary,
        // dropped span — so its own read and the inbox both refetch.
        queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
        })
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
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

  const notes = walkthrough.notes
  const hasResult = notes.some((n) => n.role === 'agent' && n.kind === 'result')
  const latestActivity = walkthrough.activity[0]
  const signOffBusy = setStatus.isPending || sendBack.isPending

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
  notes.forEach((note) => {
    entries.push({
      ts: Date.parse(note.createdAt),
      key: `note-${note.id}`,
      node: <NoteEntry note={note} pointCount={walkthrough.points.length} urlByPath={urlByPath} />,
    })
  })
  if (pro && walkthrough.viewerIsMember && assistantAvailable) {
    ;(history.data ?? []).forEach((row) => {
      entries.push({
        ts: Date.parse(row.createdAt),
        key: `chat-${row.id}`,
        node: <ChatEntry row={row} />,
      })
    })
  }
  entries.sort((a, b) => a.ts - b.ts)

  // Composer error taxonomy, ported from the old assistant panel.
  const chatError = chat.error
  const proError = isProError(chatError)
  const notConfigured = chatError instanceof Error && chatError.message.includes("isn't configured")

  const composerValue = mode === 'comment' ? commentText : assistantMessage
  const composerPending = mode === 'comment' ? addComment.isPending : chat.isPending
  const submitComposer = () => {
    if (mode === 'comment') {
      const trimmed = commentText.trim()
      if (!trimmed || addComment.isPending) return
      addComment.mutate({
        walkthroughId: walkthrough.id,
        text: trimmed,
        atMs: pinOn ? Math.round(playheadMs) : null,
      })
    } else {
      const trimmed = assistantMessage.trim()
      if (!trimmed || chat.isPending) return
      chat.mutate({ walkthroughId: walkthrough.id, message: trimmed })
    }
  }

  const pill = (active: boolean) =>
    cn(
      'rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors',
      active
        ? 'border-cobalt text-cobalt bg-cobalt-wash'
        : 'border-input text-muted-foreground hover:text-foreground'
    )

  return (
    <div className="flex flex-col gap-4 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
      {/* The sign-off, pinned first. */}
      {walkthrough.status === 'resolved' ? (
        <div className="space-y-1.5">
          <span className="stamp text-approve">signed off</span>
          {latestActivity && (
            <p className="text-muted-foreground font-mono text-[11px]">{activityText(latestActivity)}</p>
          )}
        </div>
      ) : walkthrough.viewerIsMember && walkthrough.status === 'in_review' && hasResult ? (
        <div className="border-border border-l-review bg-card rounded-md border border-l-[3px] p-4">
          <p className="text-review font-mono text-[11px] tracking-widest uppercase">
            waiting on your sign-off
          </p>
          {armed ? (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                const input = e.currentTarget.elements.namedItem('note')
                const note = input instanceof HTMLInputElement ? input.value.trim() : ''
                if (note) sendBack.mutate({ walkthroughId: walkthrough.id, note })
              }}>
              <input
                name="note"
                autoFocus
                disabled={signOffBusy}
                placeholder="What still needs doing?"
                aria-label="Send-back note"
                className="border-input bg-card focus-visible:border-ring w-full min-w-0 rounded-md border px-3 py-1.5 text-sm outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setArmed(false)
                }}
              />
              <div className="flex gap-2">
                <Button type="submit" variant="outline" className="flex-1" disabled={signOffBusy}>
                  Send to agent
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={signOffBusy}
                  onClick={() => setArmed(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-3 flex gap-2">
              <Button
                className="flex-1"
                disabled={signOffBusy}
                onClick={() =>
                  setStatus.mutate({ walkthroughId: walkthrough.id, status: 'resolved' })
                }>
                Approve &amp; sign off
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                disabled={signOffBusy}
                onClick={() => setArmed(true)}>
                Send back
              </Button>
            </div>
          )}
          {sendBack.error && <p className="text-destructive mt-2 text-[13px]">{sendBack.error.message}</p>}
          {setStatus.error && (
            <p className="text-destructive mt-2 text-[13px]">{setStatus.error.message}</p>
          )}
        </div>
      ) : null}

      <SectionHead>the exchange</SectionHead>

      {/* The thread. */}
      <div className="flex flex-1 flex-col gap-4">
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            Nothing here yet — the exchange starts when someone comments or an agent pulls the
            walkthrough.
          </p>
        ) : (
          entries.map((entry) => <div key={entry.key}>{entry.node}</div>)
        )}
      </div>

      {/* The answer form, only while a question waits. */}
      {walkthrough.status === 'needs_info' && walkthrough.viewerIsMember && (
        <div className="space-y-2">
          <SectionHead>answer the agent</SectionHead>
          <AnswerForm walkthrough={walkthrough} invalidate={invalidate} />
        </div>
      )}

      {/* The composer. */}
      {walkthrough.viewerIsMember && (
        <div className="space-y-2">
          {mode === 'assistant' && chat.isPending && (
            <p className="text-muted-foreground animate-pulse font-mono text-[11px]">
              assistant is working…
            </p>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('comment')} className={pill(mode === 'comment')}>
              comment
            </button>
            {assistantAvailable && (
              <button
                type="button"
                onClick={() => setMode('assistant')}
                className={pill(mode === 'assistant')}>
                assistant
              </button>
            )}
          </div>

          {mode === 'assistant' && entLoaded && !pro ? (
            <ProUpsell feature="The walkthrough assistant" />
          ) : mode === 'assistant' && notConfigured ? (
            <p className="text-muted-foreground font-mono text-[11px]">{chatError.message}</p>
          ) : (
            <>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  submitComposer()
                }}>
                {mode === 'comment' && playheadMs > 0 && (
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
                  value={composerValue}
                  onChange={(e) =>
                    mode === 'comment'
                      ? setCommentText(e.target.value)
                      : setAssistantMessage(e.target.value)
                  }
                  disabled={mode === 'assistant' && chat.isPending}
                  placeholder={
                    mode === 'comment' ? 'Add a comment…' : 'Ask the assistant to change something…'
                  }
                  aria-label={mode === 'comment' ? 'Add a comment' : 'Message the assistant'}
                  className="border-input bg-card focus-visible:border-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none"
                />
                <Button type="submit" disabled={composerPending || !composerValue.trim()}>
                  Send
                </Button>
              </form>
              {mode === 'assistant' &&
                (proError ? (
                  <ProUpsell feature="The walkthrough assistant" />
                ) : (
                  chatError && <p className="text-destructive text-[13px]">{chatError.message}</p>
                ))}
              {mode === 'comment' && addComment.error && (
                <p className="text-destructive text-[13px]">{addComment.error.message}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
