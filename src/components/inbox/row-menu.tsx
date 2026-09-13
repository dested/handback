// The per-row ⋯ menu on the List. Everything a row can do that isn't "open the
// pane": Rename (arms the inline title editor), the status flip (Mark resolved is
// the archive — it auto-expires — or Reopen), and Open full page. Same popover
// voice as the viewer's overflow menu; no native select, no window.confirm.

import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { usePopover } from '~/components/viewer/overflow-menu'
import { cn } from '~/lib/utils'

const ITEM =
  'hover:bg-accent/50 flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm disabled:opacity-60'

export function RowMenu({
  walkthroughId,
  status,
  editing,
  pending,
  onRename,
  onSetStatus,
}: {
  walkthroughId: string
  status: string
  editing: boolean
  pending: boolean
  onRename: () => void
  onSetStatus: (status: 'open' | 'resolved') => void
}) {
  const { open, setOpen, ref } = usePopover()

  // Arming the editor closes the menu — the row's title cell takes over.
  useEffect(() => {
    if (editing) setOpen(false)
  }, [editing, setOpen])

  const resolved = status === 'resolved'

  // The trigger is invisible until the row is hovered or something inside it is
  // focused; opening it pins it visible so the menu doesn't vanish mid-click.
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        className={cn(
          'text-muted-foreground hover:bg-accent/50 hover:text-foreground inline-flex size-7 items-center justify-center rounded-full transition-colors',
          'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
          open && 'opacity-100'
        )}>
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div
          className="bg-card border-border absolute right-0 z-20 mt-1 w-44 rounded-md border p-1 shadow-sm"
          onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={ITEM}
            onClick={() => {
              setOpen(false)
              onRename()
            }}>
            Rename
          </button>
          <button
            type="button"
            disabled={pending}
            className={ITEM}
            onClick={() => {
              setOpen(false)
              onSetStatus(resolved ? 'open' : 'resolved')
            }}>
            {resolved ? 'Reopen' : 'Mark resolved'}
          </button>
          <div className="bg-border my-1 h-px" />
          <Link
            to={`/walkthroughs/${walkthroughId}`}
            className={ITEM}
            onClick={() => setOpen(false)}>
            Open full page
          </Link>
        </div>
      )}
    </div>
  )
}
