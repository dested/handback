// Walkthroughs — the walkthroughs available to you, Personal and every team at
// once, as a card grid. Not an inbox: there is no queue to clear, just the
// collection you can reach. Space stopped being a mode you switch at the top
// (2026-08-03); it's an attribute you filter by, and only when you have more
// than one space to filter between.
//
// One query does the whole page. `walkthroughs.inbox` (the wire name is frozen —
// the API keeps it) is capped small enough to hold, so every filter and every
// count in the toolbar is computed here over that one array — no refetch when
// you click a facet, and the counts can never disagree with the cards they count.
//
// Status colors are fixed by ui.md: open = cobalt, in_review = violet,
// resolved = green.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, X } from 'lucide-react'
import { WalkthroughCard, type InboxCard } from '~/components/inbox/card'
import { usePopover } from '~/components/viewer/overflow-menu'
import { buttonVariants } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

/** The personal space's key in every facet — teamId is null and null is not a Map key you can read back. */
const PERSONAL = 'personal'

type StatusKey = 'all' | 'open' | 'in_review' | 'needs_info' | 'resolved'

const STATUS_LABELS: Record<StatusKey, string> = {
  all: 'All',
  open: 'Open',
  in_review: 'In review',
  needs_info: 'Needs info',
  resolved: 'Resolved',
}
const STATUS_ORDER: StatusKey[] = ['all', 'open', 'in_review', 'needs_info', 'resolved']

type Filters = {
  status: StatusKey
  /** null = every space. `'personal'` or a teamId otherwise. */
  space: string | null
  /** null = every project. `'general'` = the walkthroughs pinned to no project. */
  projectId: string | null
  q: string
}

// A collection, not a queue: it opens on everything you can reach, not on
// "what's still owed". The old inbox defaulted to Needs-attention for exactly
// the queue framing the owner asked us to drop.
const DEFAULT_FILTERS: Filters = { status: 'all', space: null, projectId: null, q: '' }

/** One row of a facet group. `key` is the filter value; `'all'` is the reset. */
type FacetOption = { key: string; label: string; count: number }

const STORAGE_KEY = 'handback.inbox.filters'

function isStatusKey(value: unknown): value is StatusKey {
  return typeof value === 'string' && value in STATUS_LABELS
}

// The remembered half — status and space. A project or a search term is about
// one sitting; the shape of the collection you work in is not. Read in a mount
// effect: localStorage does not exist during SSR.
function loadFilters(): Pick<Filters, 'status' | 'space'> | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { status, space } = parsed as { status?: unknown; space?: unknown }
  return {
    status: isStatusKey(status) ? status : DEFAULT_FILTERS.status,
    space: typeof space === 'string' ? space : null,
  }
}

function saveFilters(filters: Filters): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ status: filters.status, space: filters.space }))
  } catch {
    // Private mode, or a full quota. Losing the memory of a filter is not worth
    // taking the page down for.
  }
}

function matchesStatus(status: string, key: StatusKey): boolean {
  return key === 'all' || status === key
}

function matchesSpace(card: InboxCard, space: string | null): boolean {
  return space === null || (card.teamId ?? PERSONAL) === space
}

function matchesProject(card: InboxCard, projectId: string | null): boolean {
  if (projectId === null) return true
  if (projectId === 'general') return card.projectId === null
  return card.projectId === projectId
}

function matchesQuery(card: InboxCard, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    card.title.toLowerCase().includes(needle) ||
    card.slug.toLowerCase().includes(needle) ||
    (card.origin !== null && card.origin.toLowerCase().includes(needle))
  )
}

export function InboxPage() {
  const trpc = useTRPC()
  const inbox = useQuery(trpc.walkthroughs.inbox.queryOptions())
  const projectsQuery = useQuery(trpc.projects.all.queryOptions())
  const teamsQuery = useQuery(trpc.teams.mine.queryOptions())
  const connection = useQuery(trpc.tokens.connection.queryOptions())

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  // Corrected on mount, so the server's markup and the first client paint agree:
  // SSR knows neither the stored filters nor the clock.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    const stored = loadFilters()
    if (stored) setFilters((prev) => ({ ...prev, ...stored }))
    setHydrated(true)
  }, [])

  function update(patch: Partial<Filters>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    saveFilters(next)
  }

  const cards = useMemo(() => inbox.data ?? [], [inbox.data])
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const memberships = teamsQuery.data ?? []

  // The deep half of search: title/slug/origin match instantly client-side;
  // what was SAID (transcript, report) matches server-side against the corpus
  // filled at finalize. Debounced — the server call is per pause, not per key.
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const q = filters.q.trim()
    if (q.length < 2) {
      setDebouncedQ('')
      return
    }
    const timer = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(timer)
  }, [filters.q])
  const deepSearch = useQuery({
    ...trpc.walkthroughs.search.queryOptions({ q: debouncedQ }),
    enabled: debouncedQ.length >= 2,
  })
  const deepIds = useMemo(
    () => new Set(debouncedQ.length >= 2 ? (deepSearch.data?.ids ?? []) : []),
    [debouncedQ, deepSearch.data]
  )

  // Facet counts are computed the same honest way the rail did it: each group
  // counts the cards that survive *every other* filter, so a count is a promise
  // about what picking it shows.
  const searched = useMemo(
    () => cards.filter((c) => matchesQuery(c, filters.q) || deepIds.has(c.id)),
    [cards, filters.q, deepIds]
  )
  const statusScope = useMemo(
    () =>
      searched.filter((c) => matchesSpace(c, filters.space) && matchesProject(c, filters.projectId)),
    [searched, filters.space, filters.projectId]
  )
  const spaceScope = useMemo(
    () => searched.filter((c) => matchesStatus(c.status, filters.status)),
    [searched, filters.status]
  )
  const projectScope = useMemo(
    () => spaceScope.filter((c) => matchesSpace(c, filters.space)),
    [spaceScope, filters.space]
  )
  const visible = useMemo(
    () => projectScope.filter((c) => matchesProject(c, filters.projectId)),
    [projectScope, filters.projectId]
  )

  const statusCount = (key: StatusKey) =>
    statusScope.filter((c) => matchesStatus(c.status, key)).length

  // The universe of spaces is the union of what has walkthroughs, what has
  // projects, AND the membership list — a team you just joined has neither cards
  // nor projects yet and still belongs here.
  const spaceFacets: FacetOption[] = useMemo(() => {
    const names = new Map<string, string>([[PERSONAL, 'Personal']])
    for (const t of memberships) names.set(t.id, t.name)
    for (const c of cards) names.set(c.teamId ?? PERSONAL, c.spaceName)
    for (const p of projects) names.set(p.teamId ?? PERSONAL, p.spaceName)
    const teams = [...names.entries()]
      .filter(([key]) => key !== PERSONAL)
      .sort((a, b) => a[1].localeCompare(b[1]))
    const count = (key: string) => spaceScope.filter((c) => (c.teamId ?? PERSONAL) === key).length
    return [
      { key: 'all', label: 'All spaces', count: spaceScope.length },
      { key: PERSONAL, label: names.get(PERSONAL) ?? 'Personal', count: count(PERSONAL) },
      ...teams.map(([key, label]) => ({ key, label, count: count(key) })),
    ]
  }, [memberships, cards, projects, spaceScope])

  // Space is worth surfacing only once there's more than one to choose between:
  // a lone Personal space is not a filter, it's the whole universe.
  const hasSpaces = spaceFacets.length > 2

  // A persisted space filter can outlive the membership that made it valid — a
  // left team's id would silently empty the grid. Reset it once the membership
  // list is in and disagrees.
  useEffect(() => {
    if (!hydrated || !teamsQuery.data || filters.space === null || filters.space === PERSONAL) return
    if (!teamsQuery.data.some((t) => t.id === filters.space)) {
      update({ space: null, projectId: null })
    }
  }, [hydrated, teamsQuery.data, filters.space])

  const projectFacets: FacetOption[] = useMemo(() => {
    const inSpace = projects.filter(
      (p) => filters.space === null || (p.teamId ?? PERSONAL) === filters.space
    )
    const general = projectScope.filter((c) => c.projectId === null).length
    const named = inSpace
      .map((p) => ({
        key: p.id,
        label: p.name,
        count: projectScope.filter((c) => c.projectId === p.id).length,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    return [
      { key: 'all', label: 'All projects', count: projectScope.length },
      ...(general > 0 ? [{ key: 'general', label: 'General', count: general }] : []),
      ...named,
    ]
  }, [projects, projectScope, filters.space])

  const hasProjects = projects.length > 0

  // One quiet meta line under the title — mono numbers, not a dashboard.
  const openCount = cards.filter((c) => c.status === 'open').length
  const reviewCount = cards.filter((c) => c.status === 'in_review').length
  const summary = [
    cards.length > 0 ? `${cards.length} available` : null,
    openCount > 0 ? `${openCount} open` : null,
    reviewCount > 0 ? `${reviewCount} in review` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  // No token has ever been minted, so nothing on this account can record yet.
  const needsRecorder = connection.data?.tokenCount === 0

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">Walkthroughs</h1>
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

      <div className="border-border mt-8 flex flex-wrap items-center gap-x-4 gap-y-3 border-t pt-5">
        <div className="w-full sm:w-56">
          <Input
            type="search"
            value={filters.q}
            onChange={(event) => update({ q: event.target.value })}
            placeholder="Search titles & words spoken"
            aria-label="Search walkthroughs"
            className="h-9"
          />
        </div>

        <StatusSegments
          value={filters.status}
          count={statusCount}
          onPick={(key) => update({ status: key })}
        />

        <div className="flex items-center gap-2 sm:ml-auto">
          {hasSpaces && (
            <FacetSelect
              label="Space"
              options={spaceFacets}
              value={filters.space ?? 'all'}
              onPick={(key) => update({ space: key === 'all' ? null : key, projectId: null })}
            />
          )}
          {hasProjects && (
            <FacetSelect
              label="Project"
              options={projectFacets}
              value={filters.projectId ?? 'all'}
              onPick={(key) => update({ projectId: key === 'all' ? null : key })}
            />
          )}
        </div>
      </div>

      <div className="mt-6">
        {inbox.isPending ? (
          <SkeletonGrid />
        ) : inbox.isError ? (
          <p className="py-10 text-sm">
            <span className="text-destructive">Could not load your walkthroughs.</span>{' '}
            <button
              type="button"
              onClick={() => void inbox.refetch()}
              className="text-primary underline underline-offset-4">
              try again
            </button>
          </p>
        ) : cards.length === 0 ? (
          <FirstWalkthroughGuide />
        ) : visible.length === 0 ? (
          <p className="text-muted-foreground py-10 text-sm">
            nothing here under these filters ·{' '}
            <button
              type="button"
              onClick={() => update({ status: 'all', space: null, projectId: null, q: '' })}
              className="text-primary underline underline-offset-4">
              clear filters
            </button>
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((card) => (
              <li key={card.id} className="min-w-0">
                <WalkthroughCard card={card} hydrated={hydrated} showSpace={hasSpaces} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** The status filter as a segmented control; each segment carries its mono count. */
function StatusSegments({
  value,
  count,
  onPick,
}: {
  value: StatusKey
  count: (key: StatusKey) => number
  onPick: (key: StatusKey) => void
}) {
  return (
    <div className="border-border inline-flex items-center rounded-md border p-0.5">
      {STATUS_ORDER.map((key) => {
        const active = value === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(key)}
            className={cn(
              'flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm whitespace-nowrap transition-colors',
              active
                ? 'bg-cobalt-wash text-accent-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}>
            {STATUS_LABELS[key]}
            <span className="font-mono text-[11px] tabular-nums opacity-60">{count(key)}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * A quiet text selector — label + current value + chevron, opening a popover of
 * facet rows. Never a native `<select>` (ui.md; the viewer's project picker set
 * the pattern).
 */
function FacetSelect({
  label,
  options,
  value,
  onPick,
}: {
  label: string
  options: FacetOption[]
  value: string
  onPick: (key: string) => void
}) {
  const { open, setOpen, ref } = usePopover()
  const current = options.find((o) => o.key === value) ?? options[0]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Filter by ${label.toLowerCase()}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="border-border hover:bg-accent/50 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors">
        <span className="text-muted-foreground font-mono text-[10px] tracking-widest uppercase">
          {label}
        </span>
        <span className="max-w-[10rem] truncate">{current?.label}</span>
        <ChevronDown className="text-muted-foreground size-3.5" />
      </button>
      {open && (
        <div className="bg-card border-border absolute right-0 z-20 mt-1 max-h-80 w-56 overflow-y-auto rounded-md border p-1 shadow-sm">
          {options.map((option) => {
            const active = option.key === value
            const empty = option.count === 0 && !active
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  onPick(option.key)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
                  active
                    ? 'bg-cobalt-wash text-accent-foreground font-medium'
                    : empty
                      ? 'text-muted-foreground/60 hover:bg-muted/60'
                      : 'hover:bg-muted/60'
                )}>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-xs tabular-nums',
                    active ? 'text-accent-foreground' : 'text-muted-foreground'
                  )}>
                  {option.count}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * The one thing worth interrupting for: a wall of walkthroughs is useless if the
 * person who fixes them can't reach it. Shown until an agent has actually called
 * in (`lastUsedAt`), then gone for good — dismissible in the meantime. One line,
 * not a box: the grid below it is the page.
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

/** Nothing anywhere, in any space. Four ways in, one line each. */
function FirstWalkthroughGuide() {
  return (
    <div className="border-border max-w-xl border-t pt-8">
      <h2 className="font-display text-2xl font-semibold">Nothing handed back yet.</h2>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        A walkthrough is a narrated screen recording — a bug, review feedback, anything you'd rather
        say than type. Four ways to make the first one:
      </p>
      <div className="mt-6 space-y-3 text-sm leading-relaxed">
        {/* First, because it is the only one that needs nothing installed. */}
        <p>
          <Link to="/record" className="text-primary underline underline-offset-4">
            Record one right now
          </Link>{' '}
          — share a tab or your screen from this browser, nothing to install.
        </p>
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

function SkeletonGrid() {
  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <li key={i} className="border-border bg-card overflow-hidden rounded-md border">
          <div className="bg-muted aspect-video w-full animate-pulse" />
          <div className="space-y-2 p-4">
            <div className="bg-muted h-3 w-14 animate-pulse rounded" />
            <div className="bg-muted h-4 w-4/5 animate-pulse rounded" />
            <div className="bg-muted h-3 w-2/5 animate-pulse rounded" />
          </div>
        </li>
      ))}
    </ul>
  )
}
