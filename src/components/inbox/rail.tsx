// The inbox's filters. Space stopped being a mode the moment the inbox stopped
// being per-space: there is one list of everything you can see, and this is how
// you narrow it. Nothing here fetches — every count is handed in, computed off
// the single inbox array the page already holds.
//
// Two renderings of the same state: a rail on lg+, and scrollable chip rows
// below it. They share the state, the counts and the active inks; they do not
// share markup, because a rail row wants a right-aligned count and a chip wants
// the count tucked in beside the label.

import { useState, type ReactNode } from 'react'
import { Input } from '~/components/ui/input'
import { cn } from '~/lib/utils'

export type StatusKey = 'all' | 'attention' | 'open' | 'in_review' | 'resolved'

export type InboxFilters = {
  status: StatusKey
  /** null = every space. `'personal'` or a teamId otherwise. */
  space: string | null
  /** null = every project. `'general'` = the rows pinned to no project. */
  projectId: string | null
  q: string
}

/** One row of a facet group. `key` is the filter value; `'all'` is the reset. */
export type FacetOption = { key: string; label: string; count: number }

export const DEFAULT_FILTERS: InboxFilters = {
  // Needs attention, not All: the inbox's job is what is still owed, and
  // resolved walkthroughs are the majority within a week of any real use.
  status: 'attention',
  space: null,
  projectId: null,
  q: '',
}

/** Everything, deliberately — what "clear filters" means. */
export const CLEARED_FILTERS: InboxFilters = { status: 'all', space: null, projectId: null, q: '' }

export const STATUS_LABELS: Record<StatusKey, string> = {
  all: 'All',
  attention: 'Needs attention',
  open: 'Open',
  in_review: 'In review',
  resolved: 'Resolved',
}

export const STATUS_ORDER: StatusKey[] = ['all', 'attention', 'open', 'in_review', 'resolved']

const STORAGE_KEY = 'handback.inbox.filters'

function isStatusKey(value: unknown): value is StatusKey {
  return typeof value === 'string' && value in STATUS_LABELS
}

/**
 * The remembered half of the filters — status and space only. A project or a
 * search term is about one sitting; the shape of the inbox you work in is not,
 * and re-picking your team on every page load is the thing the header switcher
 * used to make you do. Callers read this in a mount effect: localStorage does
 * not exist during SSR.
 */
export function loadFilters(): Pick<InboxFilters, 'status' | 'space'> | null {
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

export function saveFilters(filters: InboxFilters): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ status: filters.status, space: filters.space })
    )
  } catch {
    // Private mode, or a full quota. Losing the memory of a filter is not worth
    // taking the page down for.
  }
}

export type RailProps = {
  status: FacetOption[]
  spaces: FacetOption[]
  projects: FacetOption[]
  filters: InboxFilters
  onStatus: (key: StatusKey) => void
  onSpace: (key: string) => void
  onProject: (key: string) => void
  onSearch: (value: string) => void
}

/** More than this and the project list stops being a list and starts being a page. */
const PROJECT_CAP = 8

export function FilterRail({
  status,
  spaces,
  projects,
  filters,
  onStatus,
  onSpace,
  onProject,
  onSearch,
}: RailProps) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? projects : projects.slice(0, PROJECT_CAP)
  const hidden = projects.length - shown.length

  return (
    <div className="space-y-5">
      <Group heading="Status">
        {status.map((option) => (
          <RailRow
            key={option.key}
            option={option}
            active={filters.status === option.key}
            onPick={() => {
              if (isStatusKey(option.key)) onStatus(option.key)
            }}
          />
        ))}
      </Group>

      <Group heading="Spaces" ruled>
        {spaces.map((option) => (
          <RailRow
            key={option.key}
            option={option}
            active={(filters.space ?? 'all') === option.key}
            onPick={() => onSpace(option.key)}
          />
        ))}
      </Group>

      <Group heading="Projects" ruled>
        {shown.map((option) => (
          <RailRow
            key={option.key}
            option={option}
            active={(filters.projectId ?? 'all') === option.key}
            onPick={() => onProject(option.key)}
          />
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-muted-foreground hover:text-foreground w-full px-2 py-1.5 text-left text-sm">
            +{hidden} more
          </button>
        )}
      </Group>

      <div className="rule pt-4">
        <Input
          type="search"
          value={filters.q}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search"
          aria-label="Search walkthroughs"
          className="h-8"
        />
      </div>
    </div>
  )
}

function Group({
  heading,
  ruled,
  children,
}: {
  heading: string
  ruled?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn(ruled && 'rule pt-4')}>
      <p className="text-muted-foreground px-2 pb-1.5 font-mono text-xs tracking-widest uppercase">
        {heading}
      </p>
      <div>{children}</div>
    </div>
  )
}

/** A facet with nothing behind it still lists — it is the answer to "is it empty, or did I mistype?" */
function RailRow({
  option,
  active,
  onPick,
}: {
  option: FacetOption
  active: boolean
  onPick: () => void
}) {
  const empty = option.count === 0 && !active
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
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
}

/**
 * The same filters on a phone. Projects only appear once a space is chosen —
 * a third scroll row of every project in every space is a wall, and the space
 * you picked is what makes it a list again.
 */
export function FilterChips({
  status,
  spaces,
  projects,
  filters,
  onStatus,
  onSpace,
  onProject,
  onSearch,
}: RailProps) {
  return (
    <div className="space-y-3">
      <ChipRow>
        {status.map((option) => (
          <Chip
            key={option.key}
            option={option}
            active={filters.status === option.key}
            onPick={() => {
              if (isStatusKey(option.key)) onStatus(option.key)
            }}
          />
        ))}
      </ChipRow>

      <ChipRow>
        {spaces.map((option) => (
          <Chip
            key={option.key}
            option={option}
            active={(filters.space ?? 'all') === option.key}
            onPick={() => onSpace(option.key)}
          />
        ))}
      </ChipRow>

      {filters.space !== null && projects.length > 1 && (
        <ChipRow>
          {projects.map((option) => (
            <Chip
              key={option.key}
              option={option}
              active={(filters.projectId ?? 'all') === option.key}
              onPick={() => onProject(option.key)}
            />
          ))}
        </ChipRow>
      )}

      <Input
        type="search"
        value={filters.q}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Search"
        aria-label="Search walkthroughs"
        className="h-9"
      />
    </div>
  )
}

// The negative margin lets the row scroll edge to edge on a phone while its
// first chip still lines up with the page text.
function ChipRow({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-6 flex gap-2 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  )
}

function Chip({
  option,
  active,
  onPick,
}: {
  option: FacetOption
  active: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors',
        active
          ? 'border-cobalt bg-cobalt-wash text-accent-foreground font-medium'
          : 'border-border text-muted-foreground hover:text-foreground'
      )}>
      {option.label}
      <span className="ml-1.5 font-mono tabular-nums opacity-60">{option.count}</span>
    </button>
  )
}
