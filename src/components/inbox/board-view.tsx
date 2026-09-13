// The Board view: the same four groups as columns, always all four (a chosen
// status just empties the others). Cards drag between Open and Done — the only
// two drop targets — and reopen or resolve on drop; Needs-your-call and
// Processing are not targets. A local pending map holds a dropped card in its new
// column until the invalidated inbox refetch lands.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Avatar } from '~/components/ui/avatar'
import { ProjectTag } from '~/components/ui/project-tag'
import { useTRPC } from '~/lib/trpc'
import { mmss, relativeTime, shortDate } from '~/lib/time'
import { cn } from '~/lib/utils'
import { GROUPS, groupOf, type Group } from './groups'
import type { InboxCard } from './types'

export function BoardView({
  cards,
  selectedId,
  hydrated,
  onSelect,
}: {
  cards: InboxCard[]
  selectedId: string | null
  hydrated: boolean
  onSelect: (id: string) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  // id → the column it was just dropped into, held until the refetch confirms it.
  const [pending, setPending] = useState<Map<string, Group>>(() => new Map())

  const setStatus = useMutation(
    trpc.walkthroughs.setStatus.mutationOptions({
      onSettled: (_data, _error, variables) => {
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
        queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: variables.walkthroughId }),
        })
        setPending((prev) => {
          const next = new Map(prev)
          next.delete(variables.walkthroughId)
          return next
        })
      },
    })
  )

  function move(id: string, group: 'open' | 'done') {
    setPending((prev) => new Map(prev).set(id, group))
    setStatus.mutate({ walkthroughId: id, status: group === 'done' ? 'resolved' : 'open' })
  }

  const columns: Record<Group, InboxCard[]> = { call: [], processing: [], open: [], done: [] }
  for (const card of cards) {
    columns[pending.get(card.id) ?? groupOf(card)].push(card)
  }

  return (
    <div className="grid grid-cols-4 gap-3.5 px-7 pb-7">
      {GROUPS.map((group) => {
        const rows = columns[group.key]
        const isDrop = group.key === 'open' || group.key === 'done'
        return (
          <div
            key={group.key}
            onDragOver={isDrop ? (e) => e.preventDefault() : undefined}
            onDrop={
              isDrop
                ? (e) => {
                    e.preventDefault()
                    const id = e.dataTransfer.getData('text/plain')
                    if (id) move(id, group.key === 'done' ? 'done' : 'open')
                  }
                : undefined
            }
            className="bg-secondary flex flex-col gap-2 rounded-[10px] p-2.5">
            <div className="flex items-center gap-2 font-semibold">
              <i className={cn('size-2 rounded-full', group.dot)} />
              {group.label}
              <span className="text-muted-foreground font-normal">{rows.length}</span>
              {group.key === 'done' && (
                <span className="text-muted-foreground ml-auto text-xs font-normal">
                  clears in 30d
                </span>
              )}
            </div>
            {rows.map((card) => (
              <BoardCard
                key={card.id}
                card={card}
                done={group.key === 'done'}
                selected={card.id === selectedId}
                hydrated={hydrated}
                onSelect={onSelect}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function BoardCard({
  card,
  done,
  selected,
  hydrated,
  onSelect,
}: {
  card: InboxCard
  done: boolean
  selected: boolean
  hydrated: boolean
  onSelect: (id: string) => void
}) {
  const when = hydrated ? relativeTime(card.recordedAt, Date.now()) : shortDate(card.recordedAt)
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', card.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => onSelect(card.id)}
      className={cn(
        'bg-card hover:border-foreground/25 flex cursor-pointer flex-col gap-2 rounded-lg border p-2.5',
        selected ? 'border-cobalt' : 'border-border'
      )}>
      {!done && card.thumbUrl && (
        <img
          src={card.thumbUrl}
          loading="lazy"
          draggable={false}
          alt=""
          className="h-24 w-full rounded-md object-cover"
        />
      )}
      <p className="font-medium leading-snug">{card.title}</p>
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <ProjectTag id={card.projectId} name={card.projectName ?? 'General'} />
        {card.score && (
          <span className="text-approve font-mono tabular-nums">
            {card.score.fixed}/{card.score.total}
          </span>
        )}
        {card.kind !== 'human' && <span className="font-mono">{mmss(card.durationMs)}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <span className="font-mono tabular-nums">{when}</span>
          <Avatar name={card.uploadedByName} size="sm" />
        </span>
      </div>
    </div>
  )
}
