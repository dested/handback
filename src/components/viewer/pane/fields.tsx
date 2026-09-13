// The walkthrough's properties as a compact key/value grid, shared by the pane
// and the page Overview. Status, project and intent are live controls (the pickers
// moved off the old masthead); recorded-by, agent and parts are read. All times
// are formatted in UTC so SSR and the client agree — no toLocale*; the relative
// "answered" time only appears after hydration.

import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Avatar } from '~/components/ui/avatar'
import { ProjectTag } from '~/components/ui/project-tag'
import { mmss } from '~/components/viewer/format'
import { usePopover } from '~/components/viewer/overflow-menu'
import { StatusChip } from '~/components/viewer/desk/status-chip'
import type { Walkthrough } from '~/components/viewer/types'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { useInvalidateWalkthrough } from './header'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `Sep 12` — a UTC day, safe to render on the server and rehydrate unchanged. */
export function utcDay(iso: string): string {
  const d = new Date(iso)
  return `${MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCDate()}`
}

/** `Sep 12, 15:40` — UTC day and 24h clock, likewise hydration-stable. */
function utcStamp(iso: string): string {
  const d = new Date(iso)
  return `${utcDay(iso)}, ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** Coarse relative time — only shown after hydration, since it reads the clock. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** False on the server and the first client render, true after mount — the switch
 *  a relative timestamp waits for so SSR markup matches. */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  return hydrated
}

const MENU_ITEM =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-accent/50 disabled:opacity-60'

/** Which project it's filed under — a ProjectTag trigger that opens the picker. */
function ProjectField({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const invalidate = useInvalidateWalkthrough(walkthrough.id)
  const { open, setOpen, ref } = usePopover()
  const [opened, setOpened] = useState(false)

  const assignProject = useMutation(
    trpc.walkthroughs.assignProject.mutationOptions({ onSettled: invalidate })
  )
  const projects = useQuery({
    ...trpc.projects.list.queryOptions({ teamId: walkthrough.teamId }),
    enabled: opened,
  })

  // In-flight variables stand in for the server's answer, so the tag moves the
  // instant it's clicked and snaps back on its own if the write fails.
  const projectId = assignProject.isPending
    ? (assignProject.variables?.projectId ?? null)
    : (walkthrough.project?.id ?? null)
  const name = assignProject.isPending
    ? ((projects.data ?? []).find((p) => p.id === projectId)?.name ?? 'General')
    : (walkthrough.project?.name ?? 'General')

  if (!walkthrough.viewerIsMember) return <ProjectTag id={projectId} name={name} />

  function assign(id: string | null) {
    setOpen(false)
    if (id === projectId) return
    assignProject.mutate({ walkthroughId: walkthrough.id, projectId: id })
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label="Project"
        aria-expanded={open}
        onClick={() => {
          setOpened(true)
          setOpen(!open)
        }}
        className="inline-flex items-center gap-1">
        <ProjectTag id={projectId} name={name} />
        <ChevronDown className="text-muted-foreground size-3.5" />
      </button>

      {open && (
        <div className="bg-card border-border absolute left-0 top-full z-30 mt-1.5 min-w-44 rounded-md border p-1 shadow-sm">
          <button
            type="button"
            className={cn(MENU_ITEM, projectId === null && 'bg-cobalt-wash text-cobalt')}
            onClick={() => assign(null)}>
            No project
          </button>
          {projects.isLoading ? (
            <button type="button" className={cn(MENU_ITEM, 'text-muted-foreground')} disabled>
              loading…
            </button>
          ) : projects.isError ? (
            <button
              type="button"
              className={cn(MENU_ITEM, 'text-muted-foreground')}
              onClick={() => void projects.refetch()}>
              couldn't load projects · retry
            </button>
          ) : (
            (projects.data ?? []).map((project) => (
              <button
                key={project.id}
                type="button"
                className={cn(MENU_ITEM, projectId === project.id && 'bg-cobalt-wash text-cobalt')}
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

const INTENTS = [null, 'bug', 'feature', 'idea'] as const

function intentLabel(intent: string | null): string {
  return intent === null
    ? 'Untagged'
    : intent === 'bug'
      ? 'Bug'
      : intent === 'feature'
        ? 'Feature'
        : 'Idea'
}

/** What the recording is FOR — a quiet pill that opens the intent picker. */
function IntentField({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const invalidate = useInvalidateWalkthrough(walkthrough.id)
  const { open, setOpen, ref } = usePopover()
  const setIntent = useMutation(
    trpc.walkthroughs.setIntent.mutationOptions({ onSettled: invalidate })
  )

  const intent = setIntent.isPending
    ? (setIntent.variables?.intent ?? walkthrough.intent)
    : walkthrough.intent

  const pill = (
    <span className="border-border bg-card text-foreground/80 inline-flex h-[22px] items-center rounded-md border px-2 text-xs font-medium">
      {intentLabel(intent)}
    </span>
  )

  if (!walkthrough.viewerIsMember) return pill

  function choose(next: (typeof INTENTS)[number]) {
    setOpen(false)
    if (next === intent) return
    setIntent.mutate({ walkthroughId: walkthrough.id, intent: next })
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label="Intent"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1">
        {pill}
        <ChevronDown className="text-muted-foreground size-3.5" />
      </button>

      {open && (
        <div className="bg-card border-border absolute left-0 top-full z-30 mt-1.5 min-w-36 rounded-md border p-1 shadow-sm">
          {INTENTS.map((option) => (
            <button
              key={option ?? 'untagged'}
              type="button"
              className={cn(MENU_ITEM, option === intent && 'bg-cobalt-wash text-cobalt')}
              onClick={() => choose(option)}>
              {intentLabel(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Key({ children }: { children: ReactNode }) {
  return <dt className="text-muted-foreground text-xs">{children}</dt>
}

export function DetailFields({ walkthrough }: { walkthrough: Walkthrough }) {
  const hydrated = useHydrated()
  const result = [...walkthrough.notes]
    .reverse()
    .find((n) => n.role === 'agent' && n.kind === 'result')

  return (
    <dl className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-x-2 gap-y-2.5 text-[13px] sm:grid-cols-[120px_minmax(0,1fr)_120px_minmax(0,1fr)]">
      <Key>Status</Key>
      <dd>
        <StatusChip walkthrough={walkthrough} />
      </dd>
      <Key>Project</Key>
      <dd className="min-w-0">
        <ProjectField walkthrough={walkthrough} />
      </dd>

      <Key>Recorded by</Key>
      <dd className="flex min-w-0 items-center gap-1.5">
        <Avatar name={walkthrough.uploadedByName} size="sm" />
        <span className="truncate">{walkthrough.uploadedByName ?? 'someone'}</span>
        <span className="text-muted-foreground shrink-0">· {utcStamp(walkthrough.recordedAt)}</span>
      </dd>
      <Key>Agent</Key>
      <dd className="text-foreground/90 min-w-0 truncate">
        {result
          ? `${result.authorName} · answered ${hydrated ? ago(result.createdAt) : utcDay(result.createdAt)}`
          : '—'}
      </dd>

      <Key>Parts</Key>
      <dd className="text-foreground/90">
        {walkthrough.takes.length} · {mmss(walkthrough.durationMs)} · {walkthrough.frameCount}{' '}
        keyframes
      </dd>
      <Key>Intent</Key>
      <dd className="min-w-0">
        <IntentField walkthrough={walkthrough} />
      </dd>
    </dl>
  )
}
