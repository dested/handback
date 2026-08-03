// The inbox — one list of every walkthrough this account can see, Personal and
// every team at once. Space used to be a mode you switched at the top of the
// page; it is an attribute now, and this is the page that decision was made
// for. You filter, you don't context-switch.
//
// One query does the whole page. `walkthroughs.inbox` is capped small enough to
// hold, so every filter and every count in the rail is computed here over that
// one array — no refetch when you click a facet, and the counts can never
// disagree with the rows they are counting.
//
// Status colors are fixed by ui.md: open = cobalt, in_review = violet,
// resolved = green.

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import {
  CLEARED_FILTERS,
  DEFAULT_FILTERS,
  FilterChips,
  FilterRail,
  STATUS_LABELS,
  STATUS_ORDER,
  loadFilters,
  saveFilters,
  type FacetOption,
  type InboxFilters,
  type StatusKey,
} from '~/components/inbox/rail'
import { buttonVariants } from '~/components/ui/button'
import { mmss } from '~/lib/capture/format'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

/** The personal space's key in every facet — teamId is null and null is not a Map key you can read back. */
const PERSONAL = 'personal'

/** The fields the filters actually read. Rows are structurally wider than this. */
type Filterable = {
  title: string
  slug: string
  origin: string | null
  status: string
  teamId: string | null
  projectId: string | null
}

function matchesStatus(status: string, key: StatusKey): boolean {
  if (key === 'all') return true
  if (key === 'attention') return status === 'open' || status === 'in_review'
  return status === key
}

function matchesSpace(row: Filterable, space: string | null): boolean {
  return space === null || (row.teamId ?? PERSONAL) === space
}

function matchesProject(row: Filterable, projectId: string | null): boolean {
  if (projectId === null) return true
  if (projectId === 'general') return row.projectId === null
  return row.projectId === projectId
}

function matchesQuery(row: Filterable, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    row.title.toLowerCase().includes(needle) ||
    row.slug.toLowerCase().includes(needle) ||
    (row.origin !== null && row.origin.toLowerCase().includes(needle))
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// UTC parts, not toLocaleDateString: locale formatting differs between the SSR
// runtime and the browser, which would break hydration.
function shortDate(value: string): string {
  const d = new Date(value)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/**
 * "2h ago". Client-only by construction — it reads the wall clock, which the
 * server's clock is not, so the row renders the absolute date until hydration
 * has happened and only then softens to this.
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

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Word + dot ink for a status, narrowed from the free-form string on the wire. */
function statusInk(status: string): { label: string; text: string; dot: string } {
  if (status === 'resolved') return { label: 'resolved', text: 'text-approve', dot: 'bg-approve' }
  if (status === 'in_review') return { label: 'in review', text: 'text-review', dot: 'bg-review' }
  return { label: 'open', text: 'text-cobalt', dot: 'bg-cobalt' }
}

export function InboxPage() {
  const trpc = useTRPC()
  const inbox = useQuery(trpc.walkthroughs.inbox.queryOptions())
  const projectsQuery = useQuery(trpc.projects.all.queryOptions())
  const teamsQuery = useQuery(trpc.teams.mine.queryOptions())
  const connection = useQuery(trpc.tokens.connection.queryOptions())

  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_FILTERS)
  // Both corrected on mount, so the server's markup and the first client paint
  // agree: SSR knows neither the stored filters nor the clock.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    const stored = loadFilters()
    if (stored) setFilters((prev) => ({ ...prev, ...stored }))
    setHydrated(true)
  }, [])

  function update(patch: Partial<InboxFilters>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    saveFilters(next)
  }

  const rows = useMemo(() => inbox.data ?? [], [inbox.data])
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])

  // Four passes over one array. Each facet group counts the rows that would
  // survive *every other* filter, which is what makes a count in the rail a
  // promise about what clicking it shows.
  const searched = useMemo(() => rows.filter((r) => matchesQuery(r, filters.q)), [rows, filters.q])
  const statusScope = useMemo(
    () =>
      searched.filter(
        (r) => matchesSpace(r, filters.space) && matchesProject(r, filters.projectId)
      ),
    [searched, filters.space, filters.projectId]
  )
  const spaceScope = useMemo(
    () => searched.filter((r) => matchesStatus(r.status, filters.status)),
    [searched, filters.status]
  )
  const projectScope = useMemo(
    () => spaceScope.filter((r) => matchesSpace(r, filters.space)),
    [spaceScope, filters.space]
  )
  const visible = useMemo(
    () => projectScope.filter((r) => matchesProject(r, filters.projectId)),
    [projectScope, filters.projectId]
  )

  const statusFacets: FacetOption[] = STATUS_ORDER.map((key) => ({
    key,
    label: STATUS_LABELS[key],
    count: statusScope.filter((r) => matchesStatus(r.status, key)).length,
  }))

  // The universe of spaces is the union of what has walkthroughs, what has
  // projects, AND the membership list itself — a team you just joined has
  // neither rows nor projects yet, and still belongs here.
  const memberships = teamsQuery.data ?? []
  const spaceFacets: FacetOption[] = useMemo(() => {
    const names = new Map<string, string>([[PERSONAL, 'Personal']])
    for (const t of memberships) names.set(t.id, t.name)
    for (const r of rows) names.set(r.teamId ?? PERSONAL, r.spaceName)
    for (const p of projects) names.set(p.teamId ?? PERSONAL, p.spaceName)
    const teams = [...names.entries()]
      .filter(([key]) => key !== PERSONAL)
      .sort((a, b) => a[1].localeCompare(b[1]))
    const count = (key: string) => spaceScope.filter((r) => (r.teamId ?? PERSONAL) === key).length
    return [
      { key: 'all', label: 'All spaces', count: spaceScope.length },
      { key: PERSONAL, label: names.get(PERSONAL) ?? 'Personal', count: count(PERSONAL) },
      ...teams.map(([key, label]) => ({ key, label, count: count(key) })),
    ]
  }, [memberships, rows, projects, spaceScope])

  // A persisted space filter can outlive the membership that made it valid —
  // a left team's id would silently empty the inbox. Reset it once the
  // membership list is in and disagrees.
  useEffect(() => {
    if (!hydrated || !teamsQuery.data || filters.space === null || filters.space === PERSONAL)
      return
    if (!teamsQuery.data.some((t) => t.id === filters.space)) {
      update({ space: null, projectId: null })
    }
  }, [hydrated, teamsQuery.data, filters.space])

  const projectFacets: FacetOption[] = useMemo(() => {
    const inSpace = projects.filter(
      (p) => filters.space === null || (p.teamId ?? PERSONAL) === filters.space
    )
    const general = projectScope.filter((r) => r.projectId === null).length
    const named = inSpace
      .map((p) => ({
        key: p.id,
        label: p.name,
        count: projectScope.filter((r) => r.projectId === p.id).length,
      }))
      // Busiest first: with the list capped, the eight worth showing are the
      // eight with something in them.
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    return [
      { key: 'all', label: 'All projects', count: projectScope.length },
      // "General" is the project-less pile. It only earns a row when it has one.
      ...(general > 0 ? [{ key: 'general', label: 'General', count: general }] : []),
      ...named,
    ]
  }, [projects, projectScope, filters.space])

  const openCount = rows.filter((r) => r.status === 'open').length
  const reviewCount = rows.filter((r) => r.status === 'in_review').length
  const spaceCount = new Set(rows.map((r) => r.spaceName)).size
  const summary = [
    openCount > 0 ? `${openCount} open` : null,
    reviewCount > 0 ? `${reviewCount} in review` : null,
    spaceCount > 1 ? `across ${spaceCount} spaces` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  // No token has ever been minted, so nothing on this account can record yet.
  const needsRecorder = connection.data?.tokenCount === 0

  const railProps = {
    status: statusFacets,
    spaces: spaceFacets,
    projects: projectFacets,
    filters,
    onStatus: (key: StatusKey) => update({ status: key }),
    // A project belongs to exactly one space; carrying the old pick across
    // would filter the new space down to nothing.
    onSpace: (key: string) => update({ space: key === 'all' ? null : key, projectId: null }),
    onProject: (key: string) => update({ projectId: key === 'all' ? null : key }),
    onSearch: (value: string) => update({ q: value }),
  }

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">Inbox</h1>
          {summary && <p className="text-muted-foreground mt-2 font-mono text-xs">{summary}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {needsRecorder && (
            <Link to="/recorder" className={cn(buttonVariants({ variant: 'outline' }))}>
              get the recorder
            </Link>
          )}
          <Link to="/upload" className={cn(buttonVariants())}>
            Upload a recording
          </Link>
        </div>
      </header>

      <ConnectLine lastUsedAt={connection.data?.lastUsedAt ?? null} />

      <div className="mt-8 lg:grid lg:grid-cols-[220px_1fr] lg:gap-10">
        <aside className="hidden lg:sticky lg:top-8 lg:block lg:self-start">
          <FilterRail {...railProps} />
        </aside>
        <div className="mb-6 lg:hidden">
          <FilterChips {...railProps} />
        </div>

        <div className="min-w-0">
          {inbox.isPending ? (
            <SkeletonRows />
          ) : inbox.isError ? (
            <p className="border-border border-t py-8 text-sm">
              <span className="text-destructive">Could not load the inbox.</span>{' '}
              <button
                type="button"
                onClick={() => void inbox.refetch()}
                className="text-primary underline underline-offset-4">
                try again
              </button>
            </p>
          ) : rows.length === 0 ? (
            <FirstWalkthroughGuide />
          ) : visible.length === 0 ? (
            <p className="text-muted-foreground border-border border-t py-10 text-sm">
              nothing here under these filters ·{' '}
              <button
                type="button"
                onClick={() => {
                  setFilters(CLEARED_FILTERS)
                  saveFilters(CLEARED_FILTERS)
                }}
                className="text-primary underline underline-offset-4">
                clear filters
              </button>
            </p>
          ) : (
            <ul className="divide-border border-border divide-y border-t">
              {visible.map((row) => (
                <li key={row.id}>
                  <Row row={row} hydrated={hydrated} showSpaceChip={filters.space === null} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/** What a row needs to draw itself — the inbox payload, structurally. */
type InboxRow = Filterable & {
  id: string
  recordedAt: string
  durationMs: number
  errorCount: number
  takeCount: number
  projectName: string | null
  spaceName: string
  uploadedByName: string | null
}

function Row({
  row,
  hydrated,
  showSpaceChip,
}: {
  row: InboxRow
  hydrated: boolean
  showSpaceChip: boolean
}) {
  const ink = statusInk(row.status)
  const when = hydrated ? relativeTime(row.recordedAt, Date.now()) : shortDate(row.recordedAt)

  const meta: ReactNode[] = [
    showSpaceChip ? (
      <span className="ring-border rounded px-1.5 ring-1 ring-inset">{row.spaceName}</span>
    ) : (
      row.spaceName
    ),
    row.projectName ?? 'General',
    ...(row.origin ? [row.origin] : []),
    plural(row.takeCount, 'take'),
    mmss(row.durationMs),
    ...(row.errorCount > 0 ? [plural(row.errorCount, 'error')] : []),
    ...(row.uploadedByName ? [`by ${row.uploadedByName}`] : []),
  ]

  return (
    <Link
      to={`/walkthroughs/${row.id}`}
      className="hover:bg-muted/40 -mx-3 block rounded-sm px-3 py-4 transition-colors">
      <div className="flex items-baseline gap-3">
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cn('size-[7px] shrink-0 rounded-full', ink.dot)} />
          <span className={cn('text-xs font-medium', ink.text)}>{ink.label}</span>
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
        <span className="text-muted-foreground shrink-0 font-mono text-xs">{when}</span>
      </div>
      <p className="text-muted-foreground mt-1.5 truncate font-mono text-xs">
        {meta.map((part, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="text-border"> · </span>}
            {part}
          </Fragment>
        ))}
      </p>
    </Link>
  )
}

/**
 * The one thing worth interrupting the inbox for: an inbox full of walkthroughs
 * is useless if the person who fixes them can't reach it. Shown until an agent
 * has actually called in (`lastUsedAt`), then gone for good — and dismissible in
 * the meantime, because a banner you can't close is a banner people learn to
 * hate. It is one line, not a box: the inbox below it is the page.
 */
const DISMISS_KEY = 'handback.connectBannerDismissed'

function ConnectLine({ lastUsedAt }: { lastUsedAt: string | null }) {
  // localStorage is unavailable during SSR; assume not-dismissed and correct on
  // mount, so the server and first client render agree.
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => setDismissed(localStorage.getItem(DISMISS_KEY) === '1'), [])

  if (lastUsedAt || dismissed) return null

  return (
    <div className="border-border mt-6 flex items-center gap-3 border-t pt-4 text-sm">
      <p className="text-muted-foreground min-w-0 flex-1">
        No agent has read a walkthrough yet.{' '}
        <Link to="/connect" className="text-primary underline underline-offset-4">
          Connect Claude Code
        </Link>{' '}
        and it can take one end to end — narration, keyframes, console errors.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground shrink-0"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1')
          setDismissed(true)
        }}>
        <X className="size-4" />
      </button>
    </div>
  )
}

/** Nothing anywhere, in any space. Three ways in, one line each. */
function FirstWalkthroughGuide() {
  return (
    <div className="border-border max-w-xl border-t pt-8">
      <h2 className="font-display text-2xl font-semibold">Nothing handed back yet.</h2>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        A walkthrough is a narrated screen recording — a bug, review feedback, anything you'd rather
        say than type. Three ways to make the first one:
      </p>
      <div className="mt-6 space-y-3 text-sm leading-relaxed">
        <p>
          <Link to="/recorder" className="text-primary underline underline-offset-4">
            Install the recorder
          </Link>{' '}
          and capture your screen from Chrome, narration and all.
        </p>
        <p>
          <Link to="/phone" className="text-primary underline underline-offset-4">
            Use the phone you're holding
          </Link>{' '}
          — its own screen recorder, shared straight here.
        </p>
        <p>
          <Link to="/upload" className="text-primary underline underline-offset-4">
            Already have a clip?
          </Link>{' '}
          Drop it in and we'll distil it into a walkthrough.
        </p>
      </div>
    </div>
  )
}

function SkeletonRows() {
  return (
    <ul className="divide-border border-border divide-y border-t">
      {[0, 1, 2].map((i) => (
        <li key={i} className="space-y-2 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-muted h-3 w-14 animate-pulse rounded" />
            <div className="bg-muted h-4 flex-1 animate-pulse rounded" />
            <div className="bg-muted h-3 w-12 animate-pulse rounded" />
          </div>
          <div className="bg-muted h-3 w-2/5 animate-pulse rounded" />
        </li>
      ))}
    </ul>
  )
}
