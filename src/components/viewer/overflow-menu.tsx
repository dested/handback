// The rare and the irreversible, kept out of the masthead's main line: who the
// walkthrough is for, its share link, which space it lives in, and deleting it.
// Every destructive choice arms into one inline question inside its own row —
// never a browser confirm(), never a row that grows and shoves the page down.

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useActiveSpace } from '~/lib/space'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import type { Walkthrough } from './types'
import { useCopy } from './use-copy'

const ITEM =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent/50 disabled:opacity-60'
const SECTION =
  'text-muted-foreground px-2 pt-1.5 pb-0.5 font-mono text-[10px] tracking-widest uppercase'
const DIVIDER = 'border-border my-1 border-t'

/** What's armed right now — arming one thing disarms whatever else was. */
type Armed = { kind: 'move'; teamId: string | null } | { kind: 'delete' } | null

/**
 * Open/closed state for a popover, dismissed by a pointerdown outside `ref` or
 * Escape. The listeners only exist while it's open, so a closed popover costs
 * the document nothing.
 */
export function usePopover(): {
  open: boolean
  setOpen: (v: boolean) => void
  /** Attach to the wrapper that contains both trigger and panel. */
  ref: RefObject<HTMLDivElement | null>
} {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && ref.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return { open, setOpen, ref }
}

export function OverflowMenu({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { spaces, setActiveSpace } = useActiveSpace()
  const { copied, copy } = useCopy()
  const { open, setOpen, ref } = usePopover()
  const [armed, setArmed] = useState<Armed>(null)

  // Closing is a decision not to act: nothing stays armed behind a shut menu.
  useEffect(() => {
    if (!open) setArmed(null)
  }, [open])

  // Refetch this walkthrough and every inbox list (any project/status filter).
  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
    })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
  }

  const setKind = useMutation(trpc.walkthroughs.setKind.mutationOptions({ onSettled: invalidate }))

  const keep = useMutation(trpc.walkthroughs.keep.mutationOptions({ onSettled: invalidate }))

  const share = useMutation(
    trpc.walkthroughs.share.mutationOptions({
      onSuccess: (result) => {
        void copy(`${window.location.origin}/w/${result.shareToken}`)
      },
      onSettled: invalidate,
    })
  )
  const unshare = useMutation(trpc.walkthroughs.unshare.mutationOptions({ onSettled: invalidate }))

  const move = useMutation(
    trpc.walkthroughs.move.mutationOptions({
      onSuccess: (_result, variables) => {
        // The URL doesn't change; following the walkthrough into its new space is
        // what keeps walkthroughs.get answering for the caller after the refetch.
        setActiveSpace(variables.teamId)
        invalidate()
      },
    })
  )

  const remove = useMutation(
    trpc.walkthroughs.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
        queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
        navigate('/app')
      },
    })
  )

  // In-flight variables stand in for the server's answer, so the menu moves the
  // instant it's clicked and snaps back on its own if the write fails.
  const kind = setKind.isPending ? (setKind.variables?.kind ?? walkthrough.kind) : walkthrough.kind

  // Deleting a team's walkthrough is admin-only server-side; your own personal
  // space is always yours to delete from.
  const canDelete =
    walkthrough.viewerIsMember &&
    (walkthrough.teamId === null ||
      ['owner', 'admin'].includes(
        spaces.find((s) => s.teamId === walkthrough.teamId)?.role ?? 'member'
      ))

  // Every space you're in except the one it already sits in — Personal included.
  const destinations = spaces.filter((s) => s.teamId !== walkthrough.teamId)

  // A platform admin reached this walkthrough from /admin without belonging to its
  // space: the read side lets them look, every mutation still 403s. Show
  // nothing they can't actually do.
  if (!walkthrough.viewerIsMember) return null

  const shareUrl = walkthrough.shareToken
    ? `${window.location.origin}/w/${walkthrough.shareToken}`
    : null
  const actionError = move.error ?? remove.error

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="border-input hover:bg-accent/50 inline-flex size-9 items-center justify-center rounded-full border transition-colors">
        <MoreHorizontal className="size-4" />
      </button>

      {open && (
        <div className="bg-card border-border absolute right-0 z-20 mt-2 w-64 rounded-md border p-1 shadow-sm">
          {/* Who it's for is a judgement, not a property of the recording — a
              walkthrough filed for an agent can turn out to be the thing you
              just want to send someone. Nothing is rewritten either way. */}
          <p className={SECTION}>who it&rsquo;s for</p>
          {(['agent', 'human'] as const).map((option) => {
            const active = kind === option
            return (
              <button
                key={option}
                type="button"
                className={cn(ITEM, active && 'text-cobalt')}
                disabled={setKind.isPending}
                onClick={() =>
                  !active && setKind.mutate({ walkthroughId: walkthrough.id, kind: option })
                }>
                <span
                  className={cn('size-[5px] rounded-full', active ? 'bg-cobalt' : 'bg-transparent')}
                />
                {option === 'agent' ? 'For an agent' : 'For a person'}
              </button>
            )
          })}

          {/* A human handback is FOR a person — its share link is the point, so
              the masthead owns it there and this menu stays out of the way. */}
          {kind === 'agent' && (
            <>
              <div className={DIVIDER} />
              {shareUrl === null ? (
                <button
                  type="button"
                  className={ITEM}
                  disabled={share.isPending}
                  onClick={() => share.mutate({ walkthroughId: walkthrough.id })}>
                  {share.isPending ? 'creating link…' : copied ? 'Copied' : 'Share link'}
                </button>
              ) : (
                <>
                  <button type="button" className={ITEM} onClick={() => copy(shareUrl)}>
                    {copied ? 'Copied' : 'Copy share link'}
                  </button>
                  <button
                    type="button"
                    className={cn(ITEM, 'text-destructive')}
                    disabled={unshare.isPending}
                    onClick={() => unshare.mutate({ walkthroughId: walkthrough.id })}>
                    {unshare.isPending ? 'revoking…' : 'Revoke share link'}
                  </button>
                </>
              )}
            </>
          )}

          {/* A resolved walkthrough on a retention clock: Keep cancels the
              scheduled auto-deletion. Safe and reversible, so it's a plain item,
              not an armed one. */}
          {walkthrough.expiresAt && (
            <>
              <div className={DIVIDER} />
              <button
                type="button"
                className={ITEM}
                disabled={keep.isPending}
                onClick={() => keep.mutate({ walkthroughId: walkthrough.id })}>
                {keep.isPending ? 'keeping…' : 'Keep — cancel auto-delete'}
              </button>
            </>
          )}

          {destinations.length > 0 && (
            <>
              <div className={DIVIDER} />
              <p className={SECTION}>move to</p>
              {destinations.map((dest) => {
                const moving = move.isPending && move.variables?.teamId === dest.teamId
                const arming = armed?.kind === 'move' && armed.teamId === dest.teamId
                if (moving) {
                  return (
                    <button key={dest.teamId ?? 'personal'} type="button" className={ITEM} disabled>
                      moving…
                    </button>
                  )
                }
                if (arming) {
                  return (
                    <div
                      key={dest.teamId ?? 'personal'}
                      className={cn(ITEM, 'flex-wrap font-mono text-xs hover:bg-transparent')}>
                      move here?
                      <button
                        type="button"
                        className="text-cobalt"
                        onClick={() =>
                          move.mutate({ walkthroughId: walkthrough.id, teamId: dest.teamId })
                        }>
                        yes
                      </button>
                      <span className="text-muted-foreground">/</span>
                      <button
                        type="button"
                        className="text-muted-foreground"
                        onClick={() => setArmed(null)}>
                        keep
                      </button>
                    </div>
                  )
                }
                return (
                  <button
                    key={dest.teamId ?? 'personal'}
                    type="button"
                    className={ITEM}
                    disabled={move.isPending}
                    onClick={() => setArmed({ kind: 'move', teamId: dest.teamId })}>
                    {dest.name}
                  </button>
                )
              })}
            </>
          )}

          {canDelete && (
            <>
              <div className={DIVIDER} />
              {remove.isPending ? (
                <button type="button" className={ITEM} disabled>
                  deleting…
                </button>
              ) : armed?.kind === 'delete' ? (
                <div className={cn(ITEM, 'flex-wrap font-mono text-xs hover:bg-transparent')}>
                  delete this walkthrough?
                  <button
                    type="button"
                    className="text-destructive"
                    onClick={() => remove.mutate({ walkthroughId: walkthrough.id })}>
                    yes, delete
                  </button>
                  <span className="text-muted-foreground">/</span>
                  <button
                    type="button"
                    className="text-muted-foreground"
                    onClick={() => setArmed(null)}>
                    keep
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={cn(ITEM, 'text-destructive')}
                  onClick={() => setArmed({ kind: 'delete' })}>
                  Delete walkthrough
                </button>
              )}
            </>
          )}

          {actionError && (
            <p className="text-destructive px-2 py-1 text-xs">{actionError.message}</p>
          )}
        </div>
      )}
    </div>
  )
}
