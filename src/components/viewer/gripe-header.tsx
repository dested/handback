import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import { dateTime, megabytes, mmss, plural } from './format'
import type { Gripe } from './types'

/** Title block: where it came from, and the shape of what was recorded. */
export function GripeHeader({ gripe }: { gripe: Gripe }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)

  const rename = useMutation(
    trpc.gripes.rename.mutationOptions({
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: trpc.gripes.get.queryKey({ gripeId: gripe.id }) })
        // The inbox lists titles too.
        queryClient.invalidateQueries({ queryKey: trpc.gripes.list.queryKey() })
      },
    })
  )

  // In-flight title stands in for the server's answer, so the heading reads as
  // renamed the instant it's submitted and snaps back on its own if it fails.
  const title = rename.isPending ? (rename.variables?.title ?? gripe.title) : gripe.title

  function commit(next: string) {
    const trimmed = next.trim()
    setEditing(false)
    if (!trimmed || trimmed === gripe.title) return
    rename.mutate({ gripeId: gripe.id, title: trimmed })
  }

  const meta = [
    dateTime(gripe.recordedAt),
    mmss(gripe.durationMs),
    plural(gripe.takes.length, 'take'),
    plural(gripe.frameCount, 'frame'),
    plural(gripe.errorCount, 'console error'),
    // Only worth saying when it happened: it's the difference between "the page
    // was clean" and "the errors were on a tab we weren't recording".
    gripe.droppedCount > 0 ? `${gripe.droppedCount} dropped from other tabs` : null,
    megabytes(gripe.bytes),
    gripe.uploadedByName ? `uploaded by ${gripe.uploadedByName}` : null,
  ].filter((part): part is string => part !== null)

  return (
    <div className="space-y-2">
      <Link to="/app" className="text-muted-foreground hover:text-foreground text-sm">
        ← Inbox
      </Link>

      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
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
            className="border-input bg-background font-display w-full max-w-2xl rounded-md border px-3 py-1.5 text-3xl font-semibold outline-none focus-visible:border-ring"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <Button type="submit" variant="outline">
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-display text-3xl font-semibold">{title}</h1>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-sm"
            onClick={() => setEditing(true)}>
            Rename
          </button>
        </div>
      )}

      {rename.error && <p className="text-destructive text-sm">{rename.error.message}</p>}

      <p className="text-muted-foreground font-mono text-xs">
        {gripe.slug}
        {gripe.origin && ` · ${gripe.origin}`}
      </p>
      <p className="text-muted-foreground text-sm">{meta.join(' · ')}</p>
    </div>
  )
}
