// The List view: one dense table, grouped into the four sections. Each row opens
// the walkthrough in the right-hand pane (its whole surface is the click target,
// bar the controls that stop propagation); the ✓ circle approves an in-review
// row in place, and the ⋯ menu renames / flips status / opens the full page.
//
// Status inks are fixed by ui.md: violet Your call · cobalt Open · grey
// Processing/Needs info · green Done.

import { Fragment, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { Avatar } from '~/components/ui/avatar'
import { ProjectTag } from '~/components/ui/project-tag'
import { StatusPill } from '~/components/ui/status-pill'
import { useTRPC } from '~/lib/trpc'
import { expiresTag, mmss, relativeTime, shortDate } from '~/lib/time'
import { cn } from '~/lib/utils'
import { GROUPS, groupOf, type Group } from './groups'
import { RowMenu } from './row-menu'
import type { InboxCard } from './types'

const TH = 'text-muted-foreground border-border border-b px-3 py-1.5 text-left text-xs font-medium'

export function ListView({
  cards,
  status,
  selectedId,
  hydrated,
  onSelect,
}: {
  cards: InboxCard[]
  status: 'all' | Group
  selectedId: string | null
  hydrated: boolean
  onSelect: (id: string) => void
}) {
  // Done opens collapsed — it's the archive, not the queue.
  const [collapsed, setCollapsed] = useState<Set<Group>>(() => new Set<Group>(['done']))

  const grouped = new Map<Group, InboxCard[]>()
  for (const card of cards) {
    const key = groupOf(card)
    const list = grouped.get(key)
    if (list) list.push(card)
    else grouped.set(key, [card])
  }

  // Every non-empty group when unfiltered; the single chosen group otherwise
  // (kept even if the section head is its only survivor of a race).
  const sections =
    status === 'all'
      ? GROUPS.filter((g) => (grouped.get(g.key)?.length ?? 0) > 0)
      : GROUPS.filter((g) => g.key === status)

  function toggle(key: Group) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          <th className={TH} style={{ width: '46%' }}>
            Walkthrough
          </th>
          <th className={TH}>Status</th>
          <th className={TH}>Agent</th>
          <th className={TH}>Project</th>
          <th className={TH}>Recorded by</th>
          <th className={cn(TH, 'text-right')}>Age</th>
        </tr>
      </thead>
      <tbody>
        {sections.map((section) => {
          const rows = grouped.get(section.key) ?? []
          const isCollapsed = collapsed.has(section.key)
          return (
            <Fragment key={section.key}>
              <tr>
                <td colSpan={6} className="border-border h-9 border-b px-3">
                  <button
                    type="button"
                    onClick={() => toggle(section.key)}
                    className="flex items-center gap-1.5 font-semibold">
                    <span className="text-muted-foreground w-2 text-xs">
                      {isCollapsed ? '▸' : '▾'}
                    </span>
                    {section.label}
                    <span className="text-muted-foreground ml-1 font-normal">{rows.length}</span>
                    {section.key === 'done' && !isCollapsed && (
                      <span className="text-muted-foreground ml-2 text-xs font-normal">
                        archived · clears after 30 days
                      </span>
                    )}
                  </button>
                </td>
              </tr>
              {!isCollapsed &&
                rows.map((card) => (
                  <Row
                    key={card.id}
                    card={card}
                    selected={card.id === selectedId}
                    hydrated={hydrated}
                    onSelect={onSelect}
                  />
                ))}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

function Row({
  card,
  selected,
  hydrated,
  onSelect,
}: {
  card: InboxCard
  selected: boolean
  hydrated: boolean
  onSelect: (id: string) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const cancelRef = useRef(false)

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
    queryClient.invalidateQueries({
      queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: card.id }),
    })
  }

  const rename = useMutation(trpc.walkthroughs.rename.mutationOptions({ onSettled: invalidate }))
  const setStatus = useMutation(
    trpc.walkthroughs.setStatus.mutationOptions({ onSettled: invalidate })
  )

  // In-flight values stand in until the refetch lands, so the row reads as
  // changed the instant it's acted on and snaps back on its own if it fails.
  const title = rename.isPending ? (rename.variables?.title ?? card.title) : card.title
  const status = setStatus.isPending ? (setStatus.variables?.status ?? card.status) : card.status

  function commit(next: string) {
    const trimmed = next.trim()
    setEditing(false)
    if (!trimmed || trimmed === card.title) return
    rename.mutate({ walkthroughId: card.id, title: trimmed })
  }

  const processing = card.refineStatus === 'running'
  const when = hydrated ? relativeTime(card.recordedAt, Date.now()) : shortDate(card.recordedAt)
  const expires = hydrated && status === 'resolved' ? expiresTag(card.expiresAt, Date.now()) : null

  const sub =
    card.kind === 'human'
      ? `for a person · ${mmss(card.durationMs)}`
      : `${card.takeCount} ${card.takeCount === 1 ? 'part' : 'parts'} · ${mmss(card.durationMs)} · ${card.frameCount} keyframes` +
        (card.errorCount > 0
          ? ` · ${card.errorCount} console ${card.errorCount === 1 ? 'error' : 'errors'}`
          : '')

  return (
    <tr
      onClick={() => {
        if (!editing) onSelect(card.id)
      }}
      className={cn(
        'group border-border/60 hover:bg-secondary h-11 cursor-pointer border-b',
        selected && 'bg-cobalt-wash hover:bg-cobalt-wash'
      )}>
      <td className="px-3">
        <div className="flex items-center gap-3">
          <CheckCircle status={status} onApprove={() => setStatus.mutate({ walkthroughId: card.id, status: 'resolved' })} />
          {card.thumbUrl ? (
            <img
              src={card.thumbUrl}
              loading="lazy"
              draggable={false}
              alt=""
              className="h-[30px] w-12 shrink-0 rounded object-cover"
            />
          ) : (
            <div className="bg-muted h-[30px] w-12 shrink-0 rounded" />
          )}
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                autoFocus
                defaultValue={title}
                aria-label="Title"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commit(e.currentTarget.value)
                  } else if (e.key === 'Escape') {
                    cancelRef.current = true
                    setEditing(false)
                  }
                }}
                onBlur={(e) => {
                  if (cancelRef.current) {
                    cancelRef.current = false
                    return
                  }
                  commit(e.target.value)
                }}
                className="border-input bg-card focus-visible:border-ring w-full rounded-md border px-2 py-1 text-[13px] font-medium outline-none"
              />
            ) : (
              <p className="truncate font-medium">{title}</p>
            )}
            <p className="text-muted-foreground truncate text-xs">{sub}</p>
          </div>
        </div>
      </td>
      <td className="px-3">
        <StatusPill status={status} processing={processing} />
      </td>
      <td className="px-3">
        {card.score ? (
          <div className="flex items-center gap-2">
            <div className="bg-border h-1 w-14 overflow-hidden rounded">
              <div
                className="bg-approve h-full rounded"
                style={{
                  width: `${card.score.total > 0 ? (card.score.fixed / card.score.total) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="font-mono text-xs tabular-nums">
              {card.score.fixed}/{card.score.total}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3">
        <ProjectTag id={card.projectId} name={card.projectName ?? 'General'} />
      </td>
      <td className="px-3">
        <div className="flex items-center gap-2">
          <Avatar name={card.uploadedByName} size="sm" />
          <span className="text-muted-foreground truncate">{card.uploadedByName ?? '—'}</span>
        </div>
      </td>
      <td className="px-3">
        <div className="flex items-center justify-end gap-1">
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            {when}
            {expires && <span className="text-muted-foreground/70"> · {expires}</span>}
          </span>
          <RowMenu
            walkthroughId={card.id}
            status={status}
            editing={editing}
            pending={setStatus.isPending}
            onRename={() => setEditing(true)}
            onSetStatus={(next) => setStatus.mutate({ walkthroughId: card.id, status: next })}
          />
        </div>
      </td>
    </tr>
  )
}

/** The lead ✓ disc: an Approve button on an in-review row, a filled tick on a
 *  resolved one, a plain ring otherwise. */
function CheckCircle({ status, onApprove }: { status: string; onApprove: () => void }) {
  if (status === 'resolved') {
    return (
      <span className="bg-approve border-approve text-white flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]">
        <Check className="size-3" />
      </span>
    )
  }
  if (status === 'in_review') {
    return (
      <button
        type="button"
        title="Approve"
        aria-label="Approve"
        onClick={(e) => {
          e.stopPropagation()
          onApprove()
        }}
        className="border-input hover:border-approve hover:text-approve text-transparent flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]">
        <Check className="size-3" />
      </button>
    )
  }
  return <span className="border-input size-[18px] shrink-0 rounded-full border-[1.5px]" />
}
