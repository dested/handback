// The desk's tab rail: a hero item whose label tracks the walkthrough's status,
// the source group (the raw material), the carved-out tasks, and a footer that
// runs (or reports) the refine pass. A vertical column on lg+, a horizontal
// scroll row below it — same items, group labels dropped. Icons are the mock's
// own 16px inline strokes, kept literal so the rail reads as drawn.

import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isProError } from '~/lib/pro'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { mmss } from '../format'
import type { Walkthrough } from '../types'
import type { DeskTab } from './types'
import type { WalkthroughMedia } from './use-walkthrough-media'

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  className: 'shrink-0',
} as const

const ICONS: Record<DeskTab, ReactNode> = {
  overview: (
    <svg {...ICON_PROPS}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.4 8.1l1.8 1.8 3.4-3.6" />
    </svg>
  ),
  conversation: (
    <svg {...ICON_PROPS}>
      <path d="M2.75 3.75h10.5v6.5h-6L4 12.75v-2.5H2.75z" />
    </svg>
  ),
  recording: (
    <svg {...ICON_PROPS}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.7 5.6v4.8l3.8-2.4z" />
    </svg>
  ),
  frames: (
    <svg {...ICON_PROPS}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  ),
  brief: (
    <svg {...ICON_PROPS}>
      <path d="M4 1.75h5.2l2.8 2.8v9.7H4z" />
      <path d="M9 1.75v3h3" />
      <path d="M6 8.5h4M6 11h4" />
    </svg>
  ),
  console: (
    <svg {...ICON_PROPS}>
      <path d="M3.5 5l3 3-3 3" />
      <path d="M8.5 11.5h4" />
    </svg>
  ),
  report: (
    <svg {...ICON_PROPS}>
      <path d="M4 1.75h5.2l2.8 2.8v9.7H4z" />
      <path d="M9 1.75v3h3" />
      <path d="M6.2 9.6l-1.2 1.2 1.2 1.2M9.8 9.6l1.2 1.2-1.2 1.2" />
    </svg>
  ),
  tasks: (
    <svg {...ICON_PROPS}>
      <circle cx="3.5" cy="4.5" r="1" />
      <path d="M7 4.5h5.5" />
      <circle cx="3.5" cy="8" r="1" />
      <path d="M7 8h5.5" />
      <circle cx="3.5" cy="11.5" r="1" />
      <path d="M7 11.5h5.5" />
    </svg>
  ),
  assistant: (
    <svg {...ICON_PROPS}>
      <path d="M9.5 4.5l2 2L6 12l-2.5.5L4 10z" />
      <path d="M11.2 6.8L9.2 4.8" />
      <path d="M12.5 2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3L11.2 3l1.3-.5z" />
    </svg>
  ),
}

/** `Jul 29` — the terse date the refine footer stamps. */
function shortDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function RailItem({
  tab,
  label,
  active,
  onTab,
  trailing,
}: {
  tab: DeskTab
  label: string
  active: boolean
  onTab: (t: DeskTab) => void
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      aria-current={active}
      onClick={() => onTab(tab)}
      className={cn(
        'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors',
        active
          ? 'bg-cobalt-wash text-cobalt font-medium'
          : 'text-muted-foreground hover:text-foreground'
      )}>
      {ICONS[tab]}
      <span className="flex-1 text-left whitespace-nowrap">{label}</span>
      {trailing}
    </button>
  )
}

const COUNT = 'font-mono text-[11px] tabular-nums'
const GROUP = 'text-muted-foreground hidden px-3 pt-4 pb-1.5 font-mono text-[11px] tracking-widest uppercase lg:block'

export function DeskRail({
  walkthrough,
  tab,
  onTab,
  media,
}: {
  walkthrough: Walkthrough
  tab: DeskTab
  onTab: (t: DeskTab) => void
  media: WalkthroughMedia
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const entitlements = useQuery(trpc.teams.entitlements.queryOptions())
  const refine = useMutation(
    trpc.walkthroughs.refine.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
        }),
    })
  )

  // The hero item speaks the status: what the reviewer does next is what it names.
  const hasResult = walkthrough.notes.some((n) => n.role === 'agent' && n.kind === 'result')
  const heroPill = (n: number) => (
    <span className="bg-review rounded-full px-[7px] py-px font-mono text-[10px] text-white">{n}</span>
  )
  const hero: { label: string; trailing?: ReactNode } =
    walkthrough.status === 'in_review'
      ? { label: 'Verdict', trailing: hasResult ? heroPill(1) : undefined }
      : walkthrough.status === 'needs_info'
        ? { label: 'Question', trailing: heroPill(1) }
        : walkthrough.status === 'resolved'
          ? { label: 'Signed off' }
          : { label: 'Overview' }

  const showTasks = walkthrough.kind === 'agent' && walkthrough.briefMd === null
  const showAssistant = walkthrough.kind === 'agent' && walkthrough.briefMd === null
  const threadCount = walkthrough.notes.length

  const pro = entitlements.data?.pro ?? false
  const entLoaded = entitlements.isSuccess
  const status = walkthrough.refineStatus
  const proError = isProError(refine.error)
  const run = () => refine.mutate({ walkthroughId: walkthrough.id })

  const refinedLine = walkthrough.refinedAt && (
    <span className="text-muted-foreground tabular-nums">refined {shortDate(walkthrough.refinedAt)}</span>
  )

  let control: ReactNode
  if (pro && entLoaded) {
    if (status === null) {
      control = (
        <button
          type="button"
          className="text-cobalt text-left hover:underline disabled:opacity-60"
          disabled={refine.isPending}
          onClick={run}>
          run refine
        </button>
      )
    } else if (status === 'running') {
      control = <span className="text-muted-foreground">refining…</span>
    } else if (status === 'failed') {
      control = (
        <button
          type="button"
          className="text-destructive text-left hover:underline disabled:opacity-60"
          disabled={refine.isPending}
          onClick={run}>
          refine failed · retry
        </button>
      )
    } else {
      control = (
        <>
          {refinedLine}
          <button
            type="button"
            className="text-cobalt text-left hover:underline disabled:opacity-60"
            disabled={refine.isPending}
            onClick={run}>
            re-run
          </button>
        </>
      )
    }
  } else {
    // Free account: no control, just the timestamp when a pass has ever run.
    control = refinedLine
  }

  return (
    <nav className="border-border flex gap-1 overflow-x-auto border-b px-2 py-2 lg:min-h-full lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:px-3 lg:py-4">
      <RailItem
        tab="overview"
        label={hero.label}
        trailing={hero.trailing}
        active={tab === 'overview'}
        onTab={onTab}
      />
      <RailItem
        tab="conversation"
        label="Conversation"
        active={tab === 'conversation'}
        onTab={onTab}
        trailing={
          threadCount > 0 ? (
            <span className={cn(COUNT, 'text-muted-foreground')}>{threadCount}</span>
          ) : undefined
        }
      />

      <span className={GROUP}>the source</span>
      <RailItem
        tab="recording"
        label="Recording"
        active={tab === 'recording'}
        onTab={onTab}
        trailing={<span className={cn(COUNT, 'text-muted-foreground')}>{mmss(walkthrough.durationMs)}</span>}
      />
      <RailItem
        tab="frames"
        label="Frames"
        active={tab === 'frames'}
        onTab={onTab}
        trailing={<span className={cn(COUNT, 'text-muted-foreground')}>{walkthrough.frameCount}</span>}
      />
      <RailItem tab="brief" label="Agent brief" active={tab === 'brief'} onTab={onTab} />
      <RailItem
        tab="console"
        label="Console"
        active={tab === 'console'}
        onTab={onTab}
        trailing={
          <span
            className={cn(COUNT, walkthrough.errorCount > 0 ? 'text-destructive' : 'text-muted-foreground')}>
            {walkthrough.errorCount}
          </span>
        }
      />
      <RailItem tab="report" label="report.md" active={tab === 'report'} onTab={onTab} />

      {showTasks && (
        <>
          <span className={GROUP}>carved out</span>
          <RailItem
            tab="tasks"
            label="Tasks"
            active={tab === 'tasks'}
            onTab={onTab}
            trailing={
              <span className={cn(COUNT, 'text-muted-foreground')}>{walkthrough.children.length}</span>
            }
          />
        </>
      )}

      {showAssistant && (
        <>
          <span className={GROUP}>revise</span>
          <RailItem tab="assistant" label="Edit with AI" active={tab === 'assistant'} onTab={onTab} />
        </>
      )}

      <div className="border-border flex shrink-0 flex-col gap-1 px-3 pt-3 font-mono text-[11px] lg:mt-auto lg:border-t">
        {proError && <span className="text-muted-foreground">refine is a Pro feature</span>}
        {refine.error && !proError && (
          <span className="text-destructive break-words">{refine.error.message}</span>
        )}
        {!proError && control}
      </div>
    </nav>
  )
}
