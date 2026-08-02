// Where the walkthrough lands, as ONE control — the same bargain the recorder
// panel makes. Two selects (space, then project) invite a half-set destination;
// one row that reads "to Personal · General" and opens into a grouped list
// cannot be left half-set, because every row in it sets both at once.

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ServerContext } from '~/lib/capture/context'
import type { Space } from '~/lib/space'
import { cn } from '~/lib/utils'

export type Destination = { teamId: string | null; projectId: string | null }

/** One space as the picker draws it: a header and the rows under it. */
type Group = { teamId: string | null; name: string; projects: { id: string; name: string }[] }

/**
 * The context fetch is what knows about projects, so until it lands the picker
 * falls back to the spaces the app already has in memory — you can still choose
 * a space, there just isn't a project list to choose from yet.
 */
function groups(ctx: ServerContext | null, spaces: Space[]): Group[] {
  if (ctx) {
    return [
      { teamId: null, name: 'Personal', projects: ctx.personal.projects },
      ...ctx.teams.map((team) => ({ teamId: team.id, name: team.name, projects: team.projects })),
    ]
  }
  return spaces.map((space) => ({ teamId: space.teamId, name: space.name, projects: [] }))
}

function label(list: Group[], value: Destination): string {
  const group = list.find((g) => g.teamId === value.teamId)
  const project = group?.projects.find((p) => p.id === value.projectId)
  return `${group?.name ?? 'Personal'} · ${project?.name ?? 'General'}`
}

export function DestinationControl({
  ctx,
  ctxFailed,
  spaces,
  value,
  onChange,
  onRetryContext,
}: {
  ctx: ServerContext | null
  ctxFailed: boolean
  spaces: Space[]
  value: Destination
  onChange: (next: Destination) => void
  onRetryContext: () => void
}) {
  const [open, setOpen] = useState(false)
  const list = groups(ctx, spaces)

  const pick = (next: Destination) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="border-border hover:bg-muted/40 flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left font-mono text-sm">
        <span className="truncate">to {label(list, value)}</span>
        {/* Drawn, never the platform's own select arrow. */}
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div className="border-border bg-card overflow-hidden rounded-md border">
          {list.map((group) => (
            <div
              key={group.teamId ?? 'personal'}
              className="border-border border-b last:border-b-0">
              <p className="text-muted-foreground bg-muted/40 px-3 py-1.5 font-mono text-xs tracking-widest uppercase">
                {group.name}
              </p>
              <Row
                name="General"
                active={value.teamId === group.teamId && value.projectId === null}
                onPick={() => pick({ teamId: group.teamId, projectId: null })}
              />
              {group.projects.map((project) => (
                <Row
                  key={project.id}
                  name={project.name}
                  active={value.teamId === group.teamId && value.projectId === project.id}
                  onPick={() => pick({ teamId: group.teamId, projectId: project.id })}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {ctxFailed && (
        <p className="text-muted-foreground text-sm">
          projects unavailable ·{' '}
          <button
            type="button"
            onClick={onRetryContext}
            className="text-primary underline underline-offset-4">
            retry
          </button>
        </p>
      )}
    </div>
  )
}

/** A hairline ring on the inactive dots so every name starts at the same x. */
function Row({ name, active, onPick }: { name: string; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm',
        active ? 'bg-cobalt-wash text-cobalt' : 'hover:bg-muted/40'
      )}>
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          active ? 'bg-cobalt' : 'border-border border'
        )}
      />
      <span className="truncate">{name}</span>
    </button>
  )
}
