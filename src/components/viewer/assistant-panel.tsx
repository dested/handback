// The walkthrough assistant: a power tool that lives at the foot of the page.
// Ask for changes in plain words and a pro-gated, metered agent (server/agent.ts)
// reads the walkthrough and applies edits — a retitle, a trimmed summary, a
// dropped span. The thread persists, so a reload rehydrates it. Members only,
// agent walkthroughs only; the recording stays the page and this sits below it.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '~/components/ui/button'
import { ProUpsell } from '~/components/pro-upsell'
import { isProError } from '~/lib/pro'
import { useTRPC } from '~/lib/trpc'
import { SectionHead } from './section-head'
import type { Walkthrough } from './types'

/** Coarse relative time — the thread cares about "just now" vs "yesterday". */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const EMPTY_HINT =
  'Ask for changes in plain words — "take out everything about the sidebar", "when I said cash I meant cache", "retitle this".'

export function AssistantPanel({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')

  const entitlements = useQuery(trpc.teams.entitlements.queryOptions())
  const pro = entitlements.data?.pro ?? false
  const entLoaded = entitlements.isSuccess

  const history = useQuery({
    ...trpc.walkthroughs.chatHistory.queryOptions({ walkthroughId: walkthrough.id }),
    enabled: pro,
  })

  const chat = useMutation(
    trpc.walkthroughs.chat.mutationOptions({
      onSuccess: () => {
        setMessage('')
        queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.chatHistory.queryKey({ walkthroughId: walkthrough.id }),
        })
        // The turn may have edited the walkthrough itself — retitle, summary,
        // dropped span — so the viewer's own read and the inbox both refetch.
        queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
        })
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
      },
    })
  )

  // The assistant is a member-only tool on a finalized agent walkthrough; a
  // child task is its brief and has nothing to edit. (Finalization is implied —
  // the page only reaches here for a real recording.)
  if (walkthrough.kind !== 'agent' || !walkthrough.viewerIsMember || walkthrough.briefMd !== null) {
    return null
  }

  const rows = history.data ?? []
  const error = chat.error
  const proError = isProError(error)
  const notConfigured = error instanceof Error && error.message.includes("isn't configured")
  const overBudget = error instanceof Error && error.message.includes('budget')

  return (
    <section className="rule space-y-4 pt-8">
      <SectionHead>assistant</SectionHead>

      {entLoaded && !pro ? (
        <ProUpsell feature="The walkthrough assistant" />
      ) : entLoaded ? (
        <>
          <div className="max-w-2xl space-y-4">
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-sm leading-relaxed">{EMPTY_HINT}</p>
            ) : (
              rows.map((row) => (
                <div key={row.id} className="space-y-1">
                  <p className="text-muted-foreground font-mono text-xs">
                    {row.role === 'user' ? 'you' : 'assistant'} · {ago(row.createdAt)}
                  </p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{row.content}</p>
                  {row.actions.map((action, i) => (
                    <p key={i} className="text-muted-foreground font-mono text-xs">
                      · {action.detail}
                    </p>
                  ))}
                </div>
              ))
            )}

            {chat.isPending && (
              <p className="text-muted-foreground animate-pulse font-mono text-xs">
                assistant is working…
              </p>
            )}
          </div>

          {/* The server can't run the assistant at all — no key configured. Say
              so once and take the composer away; nothing will send. */}
          {notConfigured ? (
            <p className="text-muted-foreground font-mono text-xs">{error.message}</p>
          ) : (
            <div className="max-w-2xl space-y-2">
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const trimmed = message.trim()
                  if (trimmed) chat.mutate({ walkthroughId: walkthrough.id, message: trimmed })
                }}>
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={chat.isPending}
                  placeholder="Ask for a change…"
                  aria-label="Message the assistant"
                  className="border-input bg-background focus-visible:border-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none"
                />
                <Button type="submit" disabled={chat.isPending || !message.trim()}>
                  Send
                </Button>
              </form>
              {proError ? (
                <ProUpsell feature="The walkthrough assistant" />
              ) : overBudget ? (
                <p className="text-destructive text-sm">{error.message}</p>
              ) : (
                error && <p className="text-destructive text-sm">{error.message}</p>
              )}
            </div>
          )}
        </>
      ) : null}
    </section>
  )
}
