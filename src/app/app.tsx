// Walkthroughs — the /app surface. One `walkthroughs.inbox` query feeds both a
// dense List and a Board, grouped into the four status buckets; every filter and
// count is computed client-side over that one array, so a facet click never
// refetches and the counts can never disagree with what they count. All filter
// state lives in the URL (view · status · space · project · q · w) — no
// localStorage memory — so a link reproduces a view exactly. Selecting a row
// opens it in the right-hand pane (`w`); the topbar search feeds `q`.
//
// Status inks are fixed by ui.md: violet Your call · cobalt Open · grey
// Processing/Needs info · green Done.

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, CircleDot, X } from 'lucide-react'
import { BoardView } from '~/components/inbox/board-view'
import { ListView } from '~/components/inbox/list-view'
import { GROUPS, groupOf, type Group } from '~/components/inbox/groups'
import type { InboxCard } from '~/components/inbox/types'
import { buttonVariants } from '~/components/ui/button'
import { Chip } from '~/components/ui/chip'
import { PageHeader } from '~/components/ui/page-header'
import { projectColor } from '~/components/ui/project-tag'
import { Tabs } from '~/components/ui/tabs'
import { WalkthroughPane } from '~/components/viewer/pane'
import { usePopover } from '~/components/viewer/overflow-menu'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

/** The personal space's key in every facet — teamId is null and null is not a Map key you can read back. */
const PERSONAL = 'personal'

type StatusFilter = 'all' | Group

function isStatusFilter(value: string | null): value is StatusFilter {
  return (
    value === 'all' ||
    value === 'call' ||
    value === 'processing' ||
    value === 'open' ||
    value === 'done'
  )
}

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'call', label: 'Needs your call' },
  { key: 'open', label: 'Open' },
  { key: 'processing', label: 'Processing' },
  { key: 'done', label: 'Done' },
]

const VIEW_TABS: { key: 'list' | 'board'; label: string }[] = [
  { key: 'list', label: 'List' },
  { key: 'board', label: 'Board' },
]

/** One row of a facet group. `key` is the filter value; `'all'` is the reset. */
type FacetOption = { key: string; label: string; count: number }

const PARAM_KEYS = ['view', 'status', 'space', 'project', 'q', 'w'] as const
type ParamKey = (typeof PARAM_KEYS)[number]
// A key at its default is absent from the URL — a clean link, and the shape
// `update` deletes back to.
const PARAM_DEFAULTS: Record<ParamKey, string | null> = {
  view: 'list',
  status: 'all',
  space: null,
  project: null,
  q: '',
  w: null,
}

function matchesSpace(card: InboxCard, space: string | null): boolean {
  return space === null || (card.teamId ?? PERSONAL) === space
}

function matchesProject(card: InboxCard, project: string | null): boolean {
  if (project === null) return true
  if (project === 'general') return card.projectId === null
  return card.projectId === project
}

function matchesQuery(card: InboxCard, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (
    card.title.toLowerCase().includes(needle) ||
    card.slug.toLowerCase().includes(needle) ||
    (card.origin !== null && card.origin.toLowerCase().includes(needle))
  )
}

function matchesStatusGroup(card: InboxCard, status: StatusFilter): boolean {
  return status === 'all' || groupOf(card) === status
}

export function InboxPage() {
  const trpc = useTRPC()
  const [params, setParams] = useSearchParams()

  const inbox = useQuery({
    ...trpc.walkthroughs.inbox.queryOptions(),
    // Poll while anything is refining, so a "Processing" row clears itself; stop
    // once nothing is running.
    refetchInterval: (query) =>
      query.state.data?.some((c) => c.refineStatus === 'running') ? 5000 : false,
  })
  const projectsQuery = useQuery(trpc.projects.all.queryOptions())
  const teamsQuery = useQuery(trpc.teams.mine.queryOptions())
  const connection = useQuery(trpc.tokens.connection.queryOptions())

  const rawStatus = params.get('status')
  const status: StatusFilter = isStatusFilter(rawStatus) ? rawStatus : 'all'
  const view: 'list' | 'board' = params.get('view') === 'board' ? 'board' : 'list'
  const space = params.get('space')
  const project = params.get('project')
  const q = params.get('q') ?? ''
  const paneId = params.get('w')

  function update(patch: Partial<Record<ParamKey, string | null>>) {
    const next = new URLSearchParams(params)
    for (const key of PARAM_KEYS) {
      const value = patch[key]
      if (value === undefined) continue
      if (value === null || value === '' || value === PARAM_DEFAULTS[key]) next.delete(key)
      else next.set(key, value)
    }
    setParams(next)
  }

  // Corrected on mount, so the server markup and the first client paint agree:
  // SSR knows neither the clock nor localStorage. Only the age columns read it.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  const cards = useMemo(() => inbox.data ?? [], [inbox.data])
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const memberships = teamsQuery.data ?? []

  // The deep half of search: title/slug/origin match instantly client-side; what
  // was SAID (transcript, report) matches server-side against the corpus filled
  // at finalize. `q` changes only on navigation, so no debounce is needed.
  const deepSearch = useQuery({
    ...trpc.walkthroughs.search.queryOptions({ q: q.trim() }),
    enabled: q.trim().length >= 2,
  })
  const deepIds = useMemo(
    () => new Set(q.trim().length >= 2 ? (deepSearch.data?.ids ?? []) : []),
    [q, deepSearch.data]
  )

  // Each facet counts the cards that survive *every other* filter, so a count is
  // a promise about what picking it shows.
  const searched = useMemo(
    () => cards.filter((c) => matchesQuery(c, q) || deepIds.has(c.id)),
    [cards, q, deepIds]
  )
  const spaceScope = useMemo(
    () => searched.filter((c) => matchesStatusGroup(c, status)),
    [searched, status]
  )
  const projectScope = useMemo(
    () => spaceScope.filter((c) => matchesSpace(c, space)),
    [spaceScope, space]
  )
  const statusScope = useMemo(
    () => searched.filter((c) => matchesSpace(c, space) && matchesProject(c, project)),
    [searched, space, project]
  )
  const visible = useMemo(
    () => statusScope.filter((c) => matchesStatusGroup(c, status)),
    [statusScope, status]
  )

  const statusCount = (key: StatusFilter) =>
    key === 'all' ? statusScope.length : statusScope.filter((c) => groupOf(c) === key).length

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

  // Space is worth surfacing only once there's more than one to choose between.
  const hasSpaces = spaceFacets.length > 2

  // A URL space filter can outlive the membership that made it valid — a left
  // team's id would silently empty the view. Reset it once the list disagrees.
  useEffect(() => {
    if (!teamsQuery.data || space === null || space === PERSONAL) return
    if (!teamsQuery.data.some((t) => t.id === space)) update({ space: null, project: null })
  }, [teamsQuery.data, space])

  const projectFacets: FacetOption[] = useMemo(() => {
    const inSpace = projects.filter((p) => space === null || (p.teamId ?? PERSONAL) === space)
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
  }, [projects, projectScope, space])

  const hasProjects = projects.length > 0
  const needsRecorder = connection.data?.tokenCount === 0

  const title = titleNode(project, space, projects, memberships)
  const meta = `${statusScope.length} ${statusScope.length === 1 ? 'walkthrough' : 'walkthroughs'}`

  const actions = (
    <>
      {needsRecorder && (
        <Link to="/recorder" className={buttonVariants({ variant: 'outline' })}>
          get the recorder
        </Link>
      )}
      <Link to="/upload" className={buttonVariants({ variant: 'outline' })}>
        Upload
      </Link>
      <Link to="/record" className={buttonVariants()}>
        <CircleDot />
        Record
      </Link>
    </>
  )

  const onSelect = (id: string) => update({ w: id })

  return (
    <div>
      <PageHeader
        title={title}
        meta={meta}
        actions={actions}
        tabs={
          <Tabs items={VIEW_TABS} value={view} onChange={(k) => update({ view: k })} />
        }
      />

      <div className="flex flex-wrap items-center gap-2 px-7 py-2.5">
        {STATUS_CHIPS.map((chip) => (
          <Chip
            key={chip.key}
            on={status === chip.key}
            count={statusCount(chip.key)}
            onClick={() => update({ status: chip.key })}>
            {chip.label}
          </Chip>
        ))}
        {q && (
          <Chip on onClick={() => update({ q: null })}>
            <span className="max-w-[12rem] truncate">“{q}”</span>
            <X className="size-3" />
          </Chip>
        )}
        <span className="flex-1" />
        {hasSpaces && (
          <FacetSelect
            label="Space"
            options={spaceFacets}
            value={space ?? 'all'}
            onPick={(key) => update({ space: key === 'all' ? null : key, project: null })}
          />
        )}
        {hasProjects && (
          <FacetSelect
            label="Project"
            options={projectFacets}
            value={project ?? 'all'}
            onPick={(key) => update({ project: key === 'all' ? null : key })}
          />
        )}
      </div>

      <ConnectLine lastUsedAt={connection.data?.lastUsedAt ?? null} />

      <div className={cn(paneId && 'lg:grid lg:grid-cols-[minmax(0,1fr)_640px]')}>
        <div className="min-w-0">
          {inbox.isPending ? (
            <SkeletonList />
          ) : inbox.isError ? (
            <p className="px-7 py-10 text-sm">
              <span className="text-destructive">Could not load your walkthroughs.</span>{' '}
              <button
                type="button"
                onClick={() => void inbox.refetch()}
                className="text-cobalt underline underline-offset-4">
                try again
              </button>
            </p>
          ) : cards.length === 0 ? (
            <div className="px-7">
              <FirstWalkthroughGuide />
            </div>
          ) : visible.length === 0 ? (
            <p className="text-muted-foreground px-7 py-10 text-sm">
              Nothing here yet — record a walkthrough or upload one.{' '}
              <Link to="/record" className="text-cobalt underline underline-offset-4">
                Record
              </Link>{' '}
              ·{' '}
              <Link to="/upload" className="text-cobalt underline underline-offset-4">
                Upload
              </Link>
              {(status !== 'all' || space !== null || project !== null || q !== '') && (
                <>
                  {' '}
                  ·{' '}
                  <button
                    type="button"
                    onClick={() =>
                      update({ status: 'all', space: null, project: null, q: null })
                    }
                    className="text-cobalt underline underline-offset-4">
                    clear filters
                  </button>
                </>
              )}
            </p>
          ) : view === 'board' ? (
            <BoardView cards={visible} selectedId={paneId} hydrated={hydrated} onSelect={onSelect} />
          ) : (
            <div className="px-7 pb-7">
              <ListView
                cards={visible}
                status={status}
                selectedId={paneId}
                hydrated={hydrated}
                onSelect={onSelect}
              />
            </div>
          )}
        </div>
        {paneId && (
          <div className="bg-card fixed inset-x-0 top-[52px] bottom-0 z-30 lg:sticky lg:inset-x-auto lg:bottom-auto lg:z-auto lg:h-[calc(100vh-52px)] lg:overflow-hidden lg:border-l lg:shadow-[-8px_0_24px_rgb(31_34_41/.06)]">
            <WalkthroughPane walkthroughId={paneId} onClose={() => update({ w: null })} />
          </div>
        )}
      </div>
    </div>
  )
}

/** The page title: the project (with its swatch) when one is filtered, else the
 *  space name, else the collection's own name. */
function titleNode(
  project: string | null,
  space: string | null,
  projects: { id: string; name: string }[],
  memberships: { id: string; name: string }[]
) {
  if (project !== null) {
    const name = project === 'general' ? 'General' : (projects.find((p) => p.id === project)?.name ?? 'Project')
    return (
      <span className="inline-flex items-center gap-2">
        <i
          className="size-2.5 rounded-[3px]"
          style={{ background: projectColor(project === 'general' ? null : project) }}
        />
        {name}
      </span>
    )
  }
  if (space !== null) {
    return space === PERSONAL ? 'Personal' : (memberships.find((t) => t.id === space)?.name ?? 'Space')
  }
  return 'Walkthroughs'
}

/**
 * A quiet text selector — label + current value + chevron, opening a popover of
 * facet rows. The trigger reads like a `Chip` (border, 28px). Never a native
 * `<select>` (ui.md).
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
        className="border-input bg-card text-foreground/80 hover:bg-secondary inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium">
        <span className="text-muted-foreground">{label}</span>
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
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px]',
                  active
                    ? 'bg-cobalt-wash text-cobalt font-medium'
                    : empty
                      ? 'text-muted-foreground/60 hover:bg-muted/60'
                      : 'hover:bg-muted/60'
                )}>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-xs tabular-nums',
                    active ? 'text-cobalt' : 'text-muted-foreground'
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
 * One quiet line until an agent has actually read a walkthrough (`lastUsedAt`),
 * then gone for good — dismissible in the meantime.
 */
const DISMISS_KEY = 'handback.connectBannerDismissed'

function ConnectLine({ lastUsedAt }: { lastUsedAt: string | null }) {
  // localStorage is unavailable during SSR; assume not-dismissed and correct on
  // mount, so the server and first client render agree.
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => setDismissed(localStorage.getItem(DISMISS_KEY) === '1'), [])

  if (lastUsedAt || dismissed) return null

  return (
    <div className="text-muted-foreground flex items-center gap-3 px-7 pb-1 text-[13px]">
      <p className="min-w-0 flex-1">
        No agent has read a walkthrough yet.{' '}
        <Link to="/connect" className="text-cobalt underline underline-offset-4">
          Connect Claude Code
        </Link>{' '}
        and it can take one end to end — narration, keyframes, console errors.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        className="hover:text-foreground shrink-0"
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
      <h2 className="text-2xl font-semibold">Nothing handed back yet.</h2>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        A walkthrough is a narrated screen recording — a bug, review feedback, anything you'd rather
        say than type. Four ways to make the first one:
      </p>
      <div className="mt-6 space-y-3 text-sm leading-relaxed">
        <p>
          <Link to="/record" className="text-cobalt underline underline-offset-4">
            Record one right now
          </Link>{' '}
          — share a tab or your screen from this browser, nothing to install.
        </p>
        <p>
          <Link to="/recorder" className="text-cobalt underline underline-offset-4">
            Install the recorder
          </Link>{' '}
          and capture your screen from Chrome, narration and all.
        </p>
        <p>
          <Link to="/phone" className="text-cobalt underline underline-offset-4">
            Use the phone you're holding
          </Link>{' '}
          — its own screen recorder, shared straight here.
        </p>
        <p>
          <Link to="/upload" className="text-cobalt underline underline-offset-4">
            Already have a clip?
          </Link>{' '}
          Drop it in and we'll distil it into a walkthrough.
        </p>
      </div>
      <div className="border-border mt-7 space-y-3 border-t pt-6 text-sm leading-relaxed">
        <p>
          Then{' '}
          <Link to="/connect" className="text-cobalt underline underline-offset-4">
            connect your agent
          </Link>{' '}
          — one pasted command, and it can pull whatever you record.
        </p>
        <p>
          Working with others?{' '}
          <Link to="/team" className="text-cobalt underline underline-offset-4">
            Invite a reviewer
          </Link>{' '}
          — every walkthrough in a team space reaches the whole team.
        </p>
      </div>
    </div>
  )
}

function SkeletonList() {
  return (
    <div className="space-y-2 px-7 py-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="bg-muted size-[18px] shrink-0 animate-pulse rounded-full" />
          <div className="bg-muted h-[30px] w-12 shrink-0 animate-pulse rounded" />
          <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
        </div>
      ))}
    </div>
  )
}
