// Edit with AI — the walkthrough assistant, on its own surface. A Sonnet tool
// loop that edits THIS walkthrough (retitle, trim a span, rewrite the summary or
// key points) on your instruction. It is not a person and not part of the review
// thread: it is a tool that changes the recording, so it lives in its own tab
// away from the human↔agent conversation. Pro-only, agent-kind, non-child.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../../server/router'
import { Button } from '~/components/ui/button'
import { ProUpsell } from '~/components/pro-upsell'
import { isProError } from '~/lib/pro'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { SectionHead } from '../section-head'
import type { Walkthrough } from '../types'

type Outputs = inferRouterOutputs<AppRouter>
type ChatMessage = Outputs['walkthroughs']['chatHistory'][number]

/** Coarse relative time — the turn cares about "just now" vs "yesterday". */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** One turn — your instruction, or the assistant's reply with the edits it made. */
function ChatEntry({ row }: { row: ChatMessage }) {
  const isUser = row.role === 'user'
  return (
    <div className="flex gap-2.5">
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px]',
          isUser ? 'bg-muted' : 'bg-cobalt-wash text-cobalt'
        )}>
        {isUser ? 'You' : 'AI'}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-muted-foreground font-mono text-[11px]">
          {isUser ? 'you' : 'AI editor'} · {ago(row.createdAt)}
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

export function AssistantTab({
  walkthrough,
  pro,
  entLoaded,
}: {
  walkthrough: Walkthrough
  pro: boolean
  entLoaded: boolean
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')

  const history = useQuery({
    ...trpc.walkthroughs.chatHistory.queryOptions({ walkthroughId: walkthrough.id }),
    enabled: pro && walkthrough.viewerIsMember,
  })

  const chat = useMutation(
    trpc.walkthroughs.chat.mutationOptions({
      onSuccess: () => {
        setMessage('')
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

  const chatError = chat.error
  const proError = isProError(chatError)
  const notConfigured = chatError instanceof Error && chatError.message.includes("isn't configured")

  const submit = () => {
    const trimmed = message.trim()
    if (!trimmed || chat.isPending) return
    chat.mutate({ walkthroughId: walkthrough.id, message: trimmed })
  }

  if (!walkthrough.viewerIsMember) {
    return (
      <p className="text-muted-foreground text-sm">
        Only members of this space can edit the walkthrough.
      </p>
    )
  }

  if (entLoaded && !pro) {
    return (
      <div className="max-w-[680px] space-y-4">
        <SectionHead>edit with AI</SectionHead>
        <ProUpsell feature="The walkthrough assistant" />
      </div>
    )
  }

  const rows = history.data ?? []

  return (
    <div className="flex max-w-[680px] flex-col gap-4">
      <div className="space-y-1">
        <SectionHead>edit with AI</SectionHead>
        <p className="text-muted-foreground text-[13px] leading-relaxed">
          Tell the AI editor to change this walkthrough — retitle it, trim a stretch, tighten the
          summary or the key points. Every edit is logged.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            No edits yet. Try “rename this to something clearer” or “drop the first 20 seconds.”
          </p>
        ) : (
          rows.map((row) => <ChatEntry key={row.id} row={row} />)
        )}
        {chat.isPending && (
          <p className="text-muted-foreground animate-pulse font-mono text-[11px]">
            the AI editor is working…
          </p>
        )}
      </div>

      {notConfigured ? (
        <p className="text-muted-foreground font-mono text-[11px]">{chatError.message}</p>
      ) : (
        <>
          <form
            className="flex gap-2 pt-2"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={chat.isPending}
              placeholder="Ask the AI to change something…"
              aria-label="Message the AI editor"
              className="border-input bg-card focus-visible:border-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none"
            />
            <Button type="submit" disabled={chat.isPending || !message.trim()}>
              Send
            </Button>
          </form>
          {proError ? (
            <ProUpsell feature="The walkthrough assistant" />
          ) : (
            chatError && <p className="text-destructive text-[13px]">{chatError.message}</p>
          )}
        </>
      )}
    </div>
  )
}
