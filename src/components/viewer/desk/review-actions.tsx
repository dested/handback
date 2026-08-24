// The reviewer's act-on-it controls, rendered on the Overview/Verdict hero right
// beside what they answer. SignOff is the "waiting on your sign-off" card
// (Approve / Send back), shown once an agent has handed a result back; AnswerForm
// is the needs_info reply box. Both used to live in the exchange pane; they moved
// here when the conversation became its own tab, so the primary action sits with
// the verdict instead of behind a tab.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import type { Walkthrough } from '../types'
import { useVoiceAnswer } from './use-voice-answer'

/** Refetch the walkthrough, the grid list and the inbox after a status move. */
function useInvalidate(walkthroughId: string) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId }),
    })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
  }
}

/**
 * The sign-off card. Renders only for a member on an in_review walkthrough that
 * has an agent result to sign off on — otherwise null, so callers can drop it in
 * unconditionally.
 */
export function SignOff({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const invalidate = useInvalidate(walkthrough.id)
  const [armed, setArmed] = useState(false)

  const setStatus = useMutation(
    trpc.walkthroughs.setStatus.mutationOptions({ onSettled: invalidate })
  )
  const sendBack = useMutation(
    trpc.walkthroughs.sendBack.mutationOptions({
      onSuccess: () => setArmed(false),
      onSettled: invalidate,
    })
  )

  const hasResult = walkthrough.notes.some((n) => n.role === 'agent' && n.kind === 'result')
  if (!walkthrough.viewerIsMember || walkthrough.status !== 'in_review' || !hasResult) return null

  const busy = setStatus.isPending || sendBack.isPending

  return (
    <div className="border-border border-l-review bg-card max-w-[680px] rounded-md border border-l-[3px] p-4">
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
            disabled={busy}
            placeholder="What still needs doing?"
            aria-label="Send-back note"
            className="border-input bg-card focus-visible:border-ring w-full min-w-0 rounded-md border px-3 py-1.5 text-sm outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setArmed(false)
            }}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="outline" disabled={busy}>
              Send to agent
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setArmed(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() => setStatus.mutate({ walkthroughId: walkthrough.id, status: 'resolved' })}>
            Approve &amp; sign off
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setArmed(true)}>
            Send back
          </Button>
        </div>
      )}
      {sendBack.error && <p className="text-destructive mt-2 text-[13px]">{sendBack.error.message}</p>}
      {setStatus.error && <p className="text-destructive mt-2 text-[13px]">{setStatus.error.message}</p>}
    </div>
  )
}

/**
 * The needs_info answer box: always visible while the walkthrough waits, never
 * armed. Type an answer, dictate one, or hand the question to whoever uploaded
 * the walkthrough. Each path invalidates the queries the viewer reads.
 */
export function AnswerForm({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const invalidate = useInvalidate(walkthrough.id)
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
    <div className="max-w-[680px] space-y-2">
      <form
        className="space-y-2"
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
          className="border-input bg-card focus-visible:border-ring w-full min-w-0 rounded-md border px-3 py-1.5 text-sm outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={busy || !text.trim()}>
            Answer
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={voice.toggle}>
            {voice.recording ? `stop · ${voice.clock}` : 'Answer by voice'}
          </Button>
          {uploader &&
            (route.isSuccess ? (
              <span className="text-muted-foreground font-mono text-xs">sent to {uploader}</span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || route.isPending}
                onClick={() => route.mutate({ walkthroughId: walkthrough.id })}>
                Ask {uploader}
              </Button>
            ))}
        </div>
      </form>
      {voice.transcribing && <p className="text-muted-foreground font-mono text-sm">transcribing…</p>}
      {voice.error && <p className="text-destructive font-mono text-sm">{voice.error}</p>}
      {answer.error && <p className="text-destructive text-sm">{answer.error.message}</p>}
      {route.error && <p className="text-destructive text-sm">{route.error.message}</p>}
    </div>
  )
}
