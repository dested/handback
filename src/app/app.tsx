// The inbox — the active space's walkthrough list. Two states live here: the
// filtered list, and the empty "nothing here yet" guide. There is no
// provisioning state: a space always exists.
// Status colors are fixed by ui.md: open = cobalt, in_review = violet,
// resolved = green.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, X } from 'lucide-react'
import { useActiveSpace, type Space } from '~/lib/space'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

type StatusFilter = 'open' | 'in_review' | 'resolved' | null

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_review', label: 'In review' },
  { value: 'resolved', label: 'Resolved' },
]

/** Status is a free-form string on the wire; narrow it to the three inks. */
function statusMeta(status: string): { label: string; wash: string } {
  if (status === 'resolved') return { label: 'Resolved', wash: 'bg-approve-wash text-approve' }
  if (status === 'in_review') return { label: 'In review', wash: 'bg-review-wash text-review' }
  return { label: 'Open', wash: 'bg-cobalt-wash text-cobalt' }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// UTC parts, not toLocaleDateString: locale formatting differs between the SSR
// runtime and the browser, which would break hydration.
function fmtDate(value: string): string {
  const d = new Date(value)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function InboxPage() {
  const { space } = useActiveSpace()
  // Keyed on the space so switching resets the filters rather than carrying one
  // space's project selection into another's list.
  return <Inbox key={space.teamId ?? 'personal'} space={space} />
}

function Inbox({ space }: { space: Space }) {
  const trpc = useTRPC()
  const [status, setStatus] = useState<StatusFilter>(null)
  const [projectId, setProjectId] = useState<string | null>(null)

  const walkthroughs = useQuery(
    trpc.walkthroughs.list.queryOptions({
      teamId: space.teamId,
      ...(status ? { status } : {}),
      ...(projectId ? { projectId } : {}),
    })
  )
  const projects = useQuery(trpc.projects.list.queryOptions({ teamId: space.teamId }))

  const rows = walkthroughs.data ?? []
  const unfiltered = status === null && projectId === null

  return (
    <div>
      <ConnectBanner />
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-3xl font-semibold">Inbox</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => {
            const active = status === f.value
            return (
              <button
                key={f.label}
                type="button"
                onClick={() => setStatus(f.value)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? f.value === null
                      ? 'bg-secondary text-foreground'
                      : statusMeta(f.value).wash
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}>
                {f.label}
              </button>
            )
          })}
          <select
            aria-label="Project"
            className="border-input bg-background text-foreground rounded-md border px-2 py-1 text-sm"
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value === '' ? null : e.target.value)}>
            <option value="">All projects</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {walkthroughs.isPending ? (
        <SkeletonRows />
      ) : walkthroughs.isError ? (
        <p className="text-destructive py-8 text-sm">
          Could not load the inbox. {walkthroughs.error.message}
        </p>
      ) : rows.length === 0 ? (
        unfiltered ? (
          <FirstWalkthroughGuide />
        ) : (
          <p className="text-muted-foreground border-border border-t py-10 text-sm">
            No walkthroughs match these filters.
          </p>
        )
      ) : (
        <div className="divide-border border-border divide-y border-t">
          {rows.map((g) => {
            const meta = statusMeta(g.status)
            return (
              <Link
                key={g.id}
                to={`/walkthroughs/${g.id}`}
                className="hover:bg-accent/40 flex items-start gap-4 rounded-md px-3 py-4 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{g.title}</p>
                  <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
                    {g.slug}
                    {g.origin ? ` · ${g.origin}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {g.projectName && (
                    <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs">
                      {g.projectName}
                    </span>
                  )}
                  {g.errorCount > 0 && (
                    <span className="text-destructive border-destructive/30 rounded border px-1.5 py-0.5 font-mono text-[0.6875rem]">
                      {g.errorCount} {g.errorCount === 1 ? 'error' : 'errors'}
                    </span>
                  )}
                  <span className={cn('rounded px-2 py-0.5 text-xs font-medium', meta.wash)}>
                    {meta.label}
                  </span>
                </div>
                <div className="text-muted-foreground w-36 shrink-0 space-y-1 text-right font-mono text-xs">
                  <div>{formatDuration(g.durationMs)}</div>
                  <div>
                    {g.takeCount} {g.takeCount === 1 ? 'take' : 'takes'} · {g.frameCount} frames
                  </div>
                  <div>{fmtDate(g.recordedAt)}</div>
                  {g.uploadedByName && <div className="truncate">{g.uploadedByName}</div>}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * The one thing worth interrupting the inbox for: an inbox full of walkthroughs is
 * useless if the person who fixes them can't reach it. Shown until an agent has
 * actually called in (`lastUsedAt`), then gone for good — and dismissible in
 * the meantime, because a banner you can't close is a banner people learn to
 * hate. Tokens are account-wide, so this reads the same in every space.
 */
const DISMISS_KEY = 'handback.connectBannerDismissed'

function ConnectBanner() {
  const trpc = useTRPC()
  const connection = useQuery(trpc.tokens.connection.queryOptions())
  // localStorage is unavailable during SSR; assume not-dismissed and correct on
  // mount, so the server and first client render agree.
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => setDismissed(localStorage.getItem(DISMISS_KEY) === '1'), [])

  const data = connection.data
  if (!data || data.lastUsedAt || dismissed) return null

  return (
    <div className="border-cobalt/30 bg-cobalt-wash mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border p-5">
      <div className="min-w-56 flex-1">
        <p className="font-display text-lg font-semibold">
          Are you the engineer who's going to fix these?
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect Claude Code and it can read a walkthrough end to end — narration, keyframes,
          console errors — then hand the fix back for sign-off. One command, about a minute.
        </p>
      </div>
      <Link
        to="/connect"
        className="bg-primary text-primary-foreground inline-flex shrink-0 items-center gap-2 rounded-md px-4 py-2 text-sm font-medium hover:opacity-90">
        Connect an agent
        <ArrowRight className="size-4" />
      </Link>
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

/** The space's inbox is genuinely empty: the two halves of getting one here. */
function FirstWalkthroughGuide() {
  return (
    <div className="bg-card border-border max-w-2xl rounded-xl border p-8 shadow-sm">
      <h2 className="font-display text-xl font-semibold">No walkthroughs yet.</h2>
      <p className="text-muted-foreground mt-2 text-sm">
        A walkthrough is a narrated screen recording — a bug, review feedback, anything you'd rather
        say than type. Two sides to set up: the person recording, and the agent fixing.
      </p>

      <div className="mt-6 space-y-6">
        <section>
          <h3 className="text-sm font-semibold">Get one in</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Install the Handback recorder — a Chrome extension. Record a walkthrough of the problem
            and it uploads straight to this inbox.
          </p>
          <Link
            to="/recorder"
            className="text-primary mt-3 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4">
            Set up the recorder
            <ArrowRight className="size-3.5" />
          </Link>
        </section>

        <section className="border-border border-t pt-5">
          <h3 className="text-sm font-semibold">Get one out</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Connect a coding agent now and walkthroughs are actionable the moment they land.
          </p>
          <Link
            to="/connect"
            className="text-primary mt-3 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4">
            Connect Claude Code
            <ArrowRight className="size-3.5" />
          </Link>
        </section>
      </div>
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="divide-border border-border divide-y border-t">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-4 px-3 py-4">
          <div className="flex-1 space-y-2">
            <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
            <div className="bg-muted h-3 w-1/5 animate-pulse rounded" />
          </div>
          <div className="bg-muted h-5 w-16 animate-pulse rounded-full" />
          <div className="w-36 space-y-2">
            <div className="bg-muted ml-auto h-3 w-10 animate-pulse rounded" />
            <div className="bg-muted ml-auto h-3 w-24 animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
