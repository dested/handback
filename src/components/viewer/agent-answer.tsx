// The return path made visible: the review thread an agent posts into
// (post_result over MCP) and the sign-off on it. Approve resolves the
// walkthrough; Send back writes a reviewer note into the thread — the agent
// reads it in its brief when it re-pulls — and reopens it. Below the thread,
// one quiet line of agent activity ("pulled by <token> 12m ago").

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import { SectionHead } from './section-head'
import type { Walkthrough } from './types'

type Note = Walkthrough['notes'][number]

/** Coarse relative time — the thread cares about "just now" vs "yesterday". */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function activityLine(a: Walkthrough['activity'][number]): string {
  const verb =
    a.action === 'pulled'
      ? 'pulled by'
      : a.action === 'result'
        ? 'result posted by'
        : `marked ${a.detail ?? 'a status'} by`
  return `${verb} ${a.tokenName} · ${ago(a.createdAt)}`
}

function AgentNote({ note }: { note: Note }) {
  return (
    <div className="border-border bg-card space-y-2 rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-muted-foreground font-mono text-xs">
          {note.authorName} · {ago(note.createdAt)}
        </span>
        {note.prUrl && (
          <a
            href={note.prUrl}
            target="_blank"
            rel="noreferrer"
            className="text-cobalt font-mono text-xs hover:underline">
            view the PR ↗
          </a>
        )}
      </div>
      <p className="text-sm leading-relaxed">{note.summary}</p>
      {note.filesTouched.length > 0 && (
        <p className="text-muted-foreground font-mono text-xs break-all">
          {note.filesTouched.join(' · ')}
        </p>
      )}
      {note.bodyMd && (
        <pre className="bg-muted/30 max-h-72 overflow-y-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
          {note.bodyMd}
        </pre>
      )}
    </div>
  )
}

function ReviewerNote({ note }: { note: Note }) {
  return (
    <div className="border-border space-y-1 border-l-2 pl-3">
      <span className="text-muted-foreground font-mono text-xs">
        sent back — {note.authorName} · {ago(note.createdAt)}
      </span>
      <p className="text-sm leading-relaxed">{note.summary}</p>
    </div>
  )
}

export function AgentAnswer({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
    })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
  }
  const setStatus = useMutation(trpc.walkthroughs.setStatus.mutationOptions({ onSettled: invalidate }))
  const sendBack = useMutation(
    trpc.walkthroughs.sendBack.mutationOptions({
      onSuccess: () => setArmed(false),
      onSettled: invalidate,
    })
  )
  const [armed, setArmed] = useState(false)

  const notes = walkthrough.notes
  const latestActivity = walkthrough.activity[0]
  if (notes.length === 0 && !latestActivity) return null

  const hasAnswer = notes.some((n) => n.role === 'agent')
  const busy = setStatus.isPending || sendBack.isPending

  return (
    <section className="space-y-3">
      <SectionHead>{hasAnswer ? "agent's answer" : 'review thread'}</SectionHead>

      {notes.length > 0 && (
        <div className="space-y-3">
          {notes.map((note) =>
            note.role === 'agent' ? (
              <AgentNote key={note.id} note={note} />
            ) : (
              <ReviewerNote key={note.id} note={note} />
            )
          )}
        </div>
      )}

      {/* The sign-off. Only a member can act, and only an actual answer is
          worth approving — a thread of send-backs is still waiting. */}
      {walkthrough.viewerIsMember && hasAnswer && (
        <div className="flex flex-wrap items-center gap-3">
          {walkthrough.status === 'resolved' ? (
            <span className="stamp">signed off</span>
          ) : armed ? (
            <form
              className="flex w-full max-w-xl flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const input = e.currentTarget.elements.namedItem('note')
                const note = input instanceof HTMLInputElement ? input.value.trim() : ''
                if (note) sendBack.mutate({ walkthroughId: walkthrough.id, note })
              }}>
              <input
                name="note"
                autoFocus
                disabled={busy}
                placeholder="What still needs doing?"
                aria-label="Send-back note"
                className="border-input bg-background focus-visible:border-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setArmed(false)
                }}
              />
              <Button type="submit" variant="outline" disabled={busy}>
                Send to agent
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setArmed(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  setStatus.mutate({ walkthroughId: walkthrough.id, status: 'resolved' })
                }>
                Approve &amp; resolve
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setArmed(true)}>
                Send back
              </Button>
            </>
          )}
          {sendBack.error && (
            <p className="text-destructive text-sm">{sendBack.error.message}</p>
          )}
        </div>
      )}

      {latestActivity && (
        <p className="text-muted-foreground font-mono text-xs">{activityLine(latestActivity)}</p>
      )}
    </section>
  )
}
