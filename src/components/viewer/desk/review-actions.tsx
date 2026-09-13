// The needs_info reply box, rendered by the detail body (viewer/pane/detail.tsx) right under
// the agent's question. The sign-off card that used to live beside it became the Approve /
// Send back buttons in viewer/pane/header.tsx (2026-09-13 redesign).

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
