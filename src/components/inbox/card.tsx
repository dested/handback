// One walkthrough as a card. The whole card is a link into the walkthrough; the
// only thing that isn't is the quiet ⋯ menu, whose single job is Rename — armed
// inline, the same voice as the viewer's overflow menu (no native select, no
// window.confirm). A card with a real keyframe shows it; a human handback or a
// frameless one gets a paper title-card set in type, never a grey box.
//
// Status inks are fixed by ui.md: open = cobalt, in_review = violet,
// resolved = green.

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { usePopover } from '~/components/viewer/overflow-menu'
import { mmss } from '~/lib/capture/format'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

/** Everything a card draws itself from — the `walkthroughs.inbox` item, structurally. */
export type InboxCard = {
  id: string
  slug: string
  title: string
  origin: string | null
  status: string
  kind: string
  recordedAt: string
  expiresAt: string | null
  durationMs: number
  frameCount: number
  errorCount: number
  takeCount: number
  projectId: string | null
  projectName: string | null
  teamId: string | null
  spaceName: string
  uploadedByName: string | null
  thumbUrl: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// UTC parts, not toLocaleDateString: locale formatting differs between the SSR
// runtime and the browser, which would break hydration.
function shortDate(value: string): string {
  const d = new Date(value)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/**
 * "2h ago". Client-only by construction — it reads the wall clock, which the
 * server's clock is not, so the card renders the absolute date until hydration
 * and only then softens to this.
 */
function relativeTime(value: string, now: number): string {
  const seconds = Math.round((now - new Date(value).getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.round(days / 7)}w ago`
  return shortDate(value)
}

/**
 * Days until a resolved walkthrough auto-deletes, as a terse `Nd`. Null when
 * nothing is scheduled or it's already overdue (the sweep takes it within the
 * hour). Reads the clock, so callers gate it on hydration like `relativeTime`.
 */
function expiresTag(expiresAt: string | null, now: number): string | null {
  if (!expiresAt) return null
  const days = Math.ceil((new Date(expiresAt).getTime() - now) / DAY_MS)
  return days > 0 ? `${days}d` : null
}

/** Word + dot ink for a status, narrowed from the free-form string on the wire. */
function statusInk(status: string): { label: string; text: string; dot: string } {
  if (status === 'resolved') return { label: 'resolved', text: 'text-approve', dot: 'bg-approve' }
  if (status === 'in_review') return { label: 'in review', text: 'text-review', dot: 'bg-review' }
  return { label: 'open', text: 'text-cobalt', dot: 'bg-cobalt' }
}

export function WalkthroughCard({
  card,
  hydrated,
  showSpace,
}: {
  card: InboxCard
  hydrated: boolean
  showSpace: boolean
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)

  const rename = useMutation(
    trpc.walkthroughs.rename.mutationOptions({
      onSettled: () => {
        // Every surface that lists this title — the grid here, the flat list, and
        // the walkthrough it belongs to.
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
        queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: card.id }),
        })
      },
    })
  )

  // The in-flight title stands in until the refetch lands, so the card reads as
  // renamed the instant it's submitted and snaps back on its own if it fails.
  const title = rename.isPending ? (rename.variables?.title ?? card.title) : card.title

  function commit(next: string) {
    const trimmed = next.trim()
    setEditing(false)
    if (!trimmed || trimmed === card.title) return
    rename.mutate({ walkthroughId: card.id, title: trimmed })
  }

  const ink = statusInk(card.status)
  const when = hydrated ? relativeTime(card.recordedAt, Date.now()) : shortDate(card.recordedAt)
  // Only resolved rows carry an expiry; gated on hydration like `when`, since it
  // reads the wall clock the server doesn't share.
  const expires =
    hydrated && card.status === 'resolved' ? expiresTag(card.expiresAt, Date.now()) : null

  const foot: ReactNode[] = [
    mmss(card.durationMs),
    ...(card.errorCount > 0 ? [`${card.errorCount} err`] : []),
    ...(expires ? [expires] : []),
  ]

  return (
    // A stretched Link covers the card for navigation (an <a> can't hold the ⋯
    // button or the rename input); the interactive controls sit above it with
    // `relative z-10`. While editing the overlay is gone, so nothing navigates
    // by accident. `min-w-0` per the landing grid gotcha — mono lines never wrap.
    <div className="group border-border bg-card relative flex min-w-0 flex-col overflow-hidden rounded-md border transition-colors hover:border-foreground/25">
      {!editing && (
        <Link to={`/walkthroughs/${card.id}`} aria-label={title} className="absolute inset-0 z-0" />
      )}

      <CardVisual card={card} />

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('size-[7px] shrink-0 rounded-full', ink.dot)} />
            <span className={cn('truncate text-xs font-medium', ink.text)}>{ink.label}</span>
          </span>
          <span className="ml-auto" />
          <RenameMenu editing={editing} onRename={() => setEditing(true)} />
        </div>

        {editing ? (
          <form
            className="relative z-10 flex min-w-0 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const input = e.currentTarget.elements.namedItem('title')
              commit(input instanceof HTMLInputElement ? input.value : '')
            }}>
            <input
              name="title"
              autoFocus
              defaultValue={title}
              aria-label="Title"
              className="border-input bg-background focus-visible:border-ring min-w-0 flex-1 rounded-md border px-2 py-1 text-sm font-medium outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false)
              }}
            />
            <button
              type="submit"
              className="text-primary shrink-0 text-xs font-medium underline underline-offset-4">
              Save
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
              onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <h3 className="font-display line-clamp-2 text-base leading-snug font-semibold">{title}</h3>
        )}

        <p className="text-muted-foreground truncate font-mono text-xs">
          {showSpace && (
            <>
              <span>{card.spaceName}</span>
              <span className="text-border"> · </span>
            </>
          )}
          <span>{card.projectName ?? 'General'}</span>
        </p>

        <div className="text-muted-foreground mt-auto flex items-baseline gap-x-2 pt-1 font-mono text-xs">
          <span className="min-w-0 truncate">
            {card.uploadedByName ? `${card.uploadedByName} · ${when}` : when}
          </span>
          <span className="ml-auto flex shrink-0 items-baseline gap-x-1.5 tabular-nums">
            {foot.map((part, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="text-border">·</span>}
                <span>{part}</span>
              </Fragment>
            ))}
          </span>
        </div>

        {rename.error && <p className="text-destructive text-xs">{rename.error.message}</p>}
      </div>
    </div>
  )
}

/**
 * The card's visual header. Agent-kind walkthroughs with a keyframe show it;
 * everything else — a human handback, or an agent walkthrough that captured no
 * frames — gets a paper title-card with the kind and duration set in type. The
 * duration is the hero here so the placeholder reads as a designed cover, not a
 * gap where a picture failed to load.
 */
function CardVisual({ card }: { card: InboxCard }) {
  if (card.thumbUrl) {
    return (
      <div className="border-border relative aspect-video w-full overflow-hidden border-b">
        <img
          src={card.thumbUrl}
          loading="lazy"
          draggable={false}
          alt=""
          className="size-full object-cover"
        />
        <span className="border-border bg-card/90 text-muted-foreground absolute right-2 bottom-2 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tabular-nums backdrop-blur-sm">
          {mmss(card.durationMs)}
        </span>
      </div>
    )
  }

  const kindLabel = card.kind === 'human' ? 'For a person' : 'Screen recording'
  return (
    <div className="border-border bg-background relative flex aspect-video w-full items-center justify-center overflow-hidden border-b">
      <div className="border-border/70 pointer-events-none absolute inset-3 rounded-sm border" />
      <div className="relative text-center">
        <p className="text-muted-foreground font-mono text-[10px] tracking-widest uppercase">
          {kindLabel}
        </p>
        <p className="font-display mt-1 text-3xl font-semibold tabular-nums">
          {mmss(card.durationMs)}
        </p>
      </div>
    </div>
  )
}

/**
 * The per-card ⋯ menu. Everything a card can do that isn't "open it" lives here;
 * today that is exactly Rename, which arms the inline title editor in the card
 * body rather than opening anything of its own.
 */
function RenameMenu({ editing, onRename }: { editing: boolean; onRename: () => void }) {
  const { open, setOpen, ref } = usePopover()

  // Arming the editor closes the menu — the card body takes over from here.
  const armRef = useRef(onRename)
  armRef.current = onRename
  useEffect(() => {
    if (editing) setOpen(false)
  }, [editing, setOpen])

  return (
    <div ref={ref} className="relative z-10 shrink-0">
      <button
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-muted-foreground hover:bg-accent/50 hover:text-foreground -mr-1 inline-flex size-7 items-center justify-center rounded-full transition-colors">
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div className="bg-card border-border absolute right-0 z-20 mt-1 w-40 rounded-md border p-1 shadow-sm">
          <button
            type="button"
            className="hover:bg-accent/50 flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm"
            onClick={() => {
              setOpen(false)
              onRename()
            }}>
            Rename
          </button>
        </div>
      )}
    </div>
  )
}
