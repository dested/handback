// The masthead: the title, and every control the walkthrough has. Triage status
// and the one action that matters for who it's for sit on the line; everything
// rare or irreversible lives behind the ⋯ menu.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { dateTime, megabytes, mmss, plural } from './format'
import { OverflowMenu, usePopover } from './overflow-menu'
import { ShareControl } from './share-control'
import { StatusControl } from './status-control'
import type { Walkthrough } from './types'
import { useCopy } from './use-copy'

const ITEM =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent/50 disabled:opacity-60'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How soon a resolved walkthrough auto-deletes, for the meta line. Days, ceil;
 * "expires today" inside the last day. Null when nothing is scheduled. The
 * header only ever renders client-side (the page shows a skeleton during SSR),
 * so reading the clock here is hydration-safe.
 */
function expiresLabel(expiresAt: string | null): string | null {
  if (!expiresAt) return null
  const days = (new Date(expiresAt).getTime() - Date.now()) / DAY_MS
  return days < 1 ? 'expires today' : `expires in ${Math.ceil(days)}d`
}

/** What the agent needs to find this walkthrough and report back when it's done. */
function agentBrief(walkthrough: Walkthrough): string {
  return (
    `Read the walkthrough "${walkthrough.title}" at ${window.location.origin}/walkthroughs/${walkthrough.id}. ` +
    `Pull the full brief with the handback MCP tool get_walkthrough("${walkthrough.id}") — the report.md ` +
    `inside is authored for you, follow it. When your fix is up, set the walkthrough to in_review ` +
    `with set_walkthrough_status.`
  )
}

/** Refetch this walkthrough and every inbox list (any project/status filter). */
function useInvalidateWalkthrough(walkthroughId: string): () => void {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId }) })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
  }
}

/** Which project it's filed under, as quiet text that opens a list. */
function ProjectPicker({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const invalidate = useInvalidateWalkthrough(walkthrough.id)
  const { open, setOpen, ref } = usePopover()
  // The list is only worth fetching once someone asks to see it.
  const [opened, setOpened] = useState(false)

  const assignProject = useMutation(
    trpc.walkthroughs.assignProject.mutationOptions({ onSettled: invalidate })
  )
  const projects = useQuery({
    ...trpc.projects.list.queryOptions({ teamId: walkthrough.teamId }),
    enabled: opened,
  })

  // In-flight variables stand in for the server's answer, so the label moves the
  // instant it's clicked and snaps back on its own if the write fails.
  const projectId = assignProject.isPending
    ? (assignProject.variables?.projectId ?? null)
    : (walkthrough.project?.id ?? null)
  const name = assignProject.isPending
    ? ((projects.data ?? []).find((p) => p.id === projectId)?.name ?? null)
    : (walkthrough.project?.name ?? null)

  function assign(id: string | null) {
    setOpen(false)
    if (id === projectId) return
    assignProject.mutate({ walkthroughId: walkthrough.id, projectId: id })
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Project"
        aria-expanded={open}
        onClick={() => {
          setOpened(true)
          setOpen(!open)
        }}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors">
        {name ?? 'no project'}
        <ChevronDown className="size-3.5" />
      </button>

      {open && (
        <div className="bg-card border-border absolute left-0 z-20 mt-2 min-w-44 rounded-md border p-1 shadow-sm">
          <button
            type="button"
            className={cn(ITEM, projectId === null && 'bg-cobalt-wash text-cobalt')}
            onClick={() => assign(null)}>
            No project
          </button>
          {projects.isLoading ? (
            <button type="button" className={cn(ITEM, 'text-muted-foreground')} disabled>
              loading…
            </button>
          ) : projects.isError ? (
            <button
              type="button"
              className={cn(ITEM, 'text-muted-foreground')}
              onClick={() => void projects.refetch()}>
              couldn't load projects · retry
            </button>
          ) : (
            (projects.data ?? []).map((project) => (
              <button
                key={project.id}
                type="button"
                className={cn(ITEM, projectId === project.id && 'bg-cobalt-wash text-cobalt')}
                onClick={() => assign(project.id)}>
                {project.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** Title block: where it came from, and the shape of what was recorded. */
export function WalkthroughHeader({
  walkthrough,
  onSplit,
}: {
  walkthrough: Walkthrough
  /** Opens the split-into-tasks mode; absent when this walkthrough can't split. */
  onSplit?: () => void
}) {
  const trpc = useTRPC()
  const invalidate = useInvalidateWalkthrough(walkthrough.id)
  const { copied, copy } = useCopy()
  const [editing, setEditing] = useState(false)

  // The inbox lists titles too — both readers of them refetch on a rename.
  const rename = useMutation(trpc.walkthroughs.rename.mutationOptions({ onSettled: invalidate }))
  const setStatus = useMutation(
    trpc.walkthroughs.setStatus.mutationOptions({ onSettled: invalidate })
  )

  // In-flight variables stand in for the server's answer, so the heading and the
  // status read as written the instant they're submitted, and snap back on
  // their own if the write fails.
  const title = rename.isPending
    ? (rename.variables?.title ?? walkthrough.title)
    : walkthrough.title
  const status = setStatus.isPending
    ? (setStatus.variables?.status ?? walkthrough.status)
    : walkthrough.status

  function commit(next: string) {
    const trimmed = next.trim()
    setEditing(false)
    if (!trimmed || trimmed === walkthrough.title) return
    rename.mutate({ walkthroughId: walkthrough.id, title: trimmed })
  }

  const meta = [
    walkthrough.slug,
    walkthrough.origin,
    dateTime(walkthrough.recordedAt),
    mmss(walkthrough.durationMs),
    plural(walkthrough.takes.length, 'take'),
    walkthrough.kind === 'agent' ? plural(walkthrough.frameCount, 'frame') : null,
    walkthrough.kind === 'agent' ? plural(walkthrough.errorCount, 'console error') : null,
    // Only worth saying when it happened: it's the difference between "the page
    // was clean" and "the errors were on a tab we weren't recording".
    walkthrough.droppedCount > 0 ? `${walkthrough.droppedCount} dropped from other tabs` : null,
    megabytes(walkthrough.bytes),
    walkthrough.uploadedByName ? `uploaded by ${walkthrough.uploadedByName}` : null,
    expiresLabel(walkthrough.expiresAt),
    // What the recording is for, when it's been tagged — already lowercase.
    walkthrough.intent,
  ].filter((part): part is string => part !== null)

  return (
    <header className="space-y-2">
      <Link to="/app" className="text-muted-foreground hover:text-foreground text-sm">
        ← Inbox
      </Link>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
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
              className="border-input bg-background font-display focus-visible:border-ring w-full max-w-2xl rounded-md border px-3 py-1.5 text-3xl font-semibold outline-none"
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

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {walkthrough.viewerIsMember ? (
            <>
              <StatusControl
                status={status}
                disabled={setStatus.isPending}
                onChange={(next) =>
                  setStatus.mutate({ walkthroughId: walkthrough.id, status: next })
                }
              />
              <ProjectPicker walkthrough={walkthrough} />

              {/* A human handback is FOR a person — the share link is its point,
                  and an agent brief would tell an agent to pull a walkthrough
                  that its list deliberately hides. */}
              {walkthrough.kind === 'human' ? (
                <ShareControl walkthrough={walkthrough} />
              ) : (
                <Button onClick={() => copy(agentBrief(walkthrough))}>
                  {copied ? 'Copied' : 'Copy agent brief'}
                </Button>
              )}

              <OverflowMenu walkthrough={walkthrough} onSplit={onSplit} />
            </>
          ) : (
            // A platform admin reached this walkthrough from /admin without
            // belonging to its space: the read side lets them look, every
            // mutation still 403s. Show nothing they can't actually do.
            <>
              <span className="border-review/40 bg-review-wash text-review rounded-md border px-2 py-1 font-mono text-xs">
                admin view · read only
              </span>
              <Button variant="outline" onClick={() => copy(agentBrief(walkthrough))}>
                {copied ? 'Copied' : 'Copy agent brief'}
              </Button>
            </>
          )}
        </div>
      </div>

      {rename.error && <p className="text-destructive text-sm">{rename.error.message}</p>}

      <p className="text-muted-foreground font-mono text-xs">{meta.join(' · ')}</p>
    </header>
  )
}
