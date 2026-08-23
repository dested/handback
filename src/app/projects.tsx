// Every project this account can reach, grouped by the space that owns it.
// Space is an attribute of a project, not a mode the app is in — there is no
// "current space" here, so the page shows Personal and every team at once.
//
// Any member of a team may create and rename its projects — the server allows
// it, so the page offers it without a role check. Rosters live on /team.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

type ProjectRow = {
  id: string
  name: string
  slug: string
  teamId: string | null
  spaceName: string
  instructions: string | null
  walkthroughCount: number
}

type SpaceGroup = { teamId: string | null; name: string; projects: ProjectRow[] }

type TeamRow = { id: string; name: string }

const PERSONAL_KEY = 'personal'

const SELECT = cn(
  'border-input bg-background text-foreground h-9 rounded-md border px-2 text-sm shadow-xs',
  'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'
)

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * Personal first, then teams alphabetically — derived from the team list rather
 * than from the projects, so a space with nothing in it still gets a section
 * (and still tells you it's empty). A project whose team hasn't arrived in
 * `teams.mine` yet lands in a trailing group of its own rather than vanishing.
 */
function groupBySpace(projects: ProjectRow[], teams: TeamRow[]): SpaceGroup[] {
  const groups = new Map<string, SpaceGroup>()
  groups.set(PERSONAL_KEY, { teamId: null, name: 'Personal', projects: [] })
  for (const t of [...teams].sort((a, b) => a.name.localeCompare(b.name))) {
    groups.set(t.id, { teamId: t.id, name: t.name, projects: [] })
  }
  for (const p of projects) {
    const key = p.teamId ?? PERSONAL_KEY
    const group = groups.get(key)
    if (group) group.projects.push(p)
    else groups.set(key, { teamId: p.teamId, name: p.spaceName, projects: [p] })
  }
  return [...groups.values()]
}

export function ProjectsPage() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  // One project is renamed at a time; opening another closes the last.
  const [editingId, setEditingId] = useState<string | null>(null)
  // The standing-instructions editor, opened independently of rename.
  const [instructionsId, setInstructionsId] = useState<string | null>(null)

  const projectsQuery = useQuery(trpc.projects.all.queryOptions())
  const teamsQuery = useQuery(trpc.teams.mine.queryOptions())

  // `projects.list` is still the recorder-facing per-space read; a create or a
  // rename has to reach both or the destination picker goes stale.
  const invalidateProjects = () => {
    queryClient.invalidateQueries({ queryKey: trpc.projects.all.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryKey() })
  }

  const update = useMutation(
    trpc.projects.update.mutationOptions({
      onSuccess: () => {
        invalidateProjects()
        setEditingId(null)
      },
    })
  )

  // Instructions ride the same procedure but their own editor, so a save closes
  // the right panel and a failed save's error stays on its own row.
  const saveInstructions = useMutation(
    trpc.projects.update.mutationOptions({
      onSuccess: () => {
        invalidateProjects()
        setInstructionsId(null)
      },
    })
  )

  const projects = projectsQuery.data ?? []
  const teams = teamsQuery.data ?? []
  const groups = groupBySpace(projects, teams)
  const loaded = projectsQuery.isSuccess && teamsQuery.isSuccess

  return (
    <div className="max-w-4xl space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="font-display text-4xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground font-mono text-xs">
            {plural(projects.length, 'project')} across {plural(groups.length, 'space')}
          </p>
        </div>
        <Button
          type="button"
          variant={creating ? 'outline' : 'default'}
          onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cancel' : 'New project'}
        </Button>
      </header>

      {creating && (
        <NewProjectPanel
          teams={teams}
          onCreated={() => {
            invalidateProjects()
            setCreating(false)
          }}
        />
      )}

      {projectsQuery.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}
      {projectsQuery.isError && (
        <p className="text-destructive text-sm">{projectsQuery.error.message}</p>
      )}

      {loaded && projects.length === 0 ? (
        <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
          Nothing filed yet. A project is the folder a walkthrough lands in — name one after the
          surface it covers, and every recording sent to it from the recorder gathers in one place.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.teamId ?? PERSONAL_KEY}>
            <h2 className="text-muted-foreground font-mono text-xs tracking-[0.14em] uppercase">
              {group.name}
            </h2>
            <div className="rule mt-2" />
            {group.projects.length === 0 ? (
              <p className="text-muted-foreground py-3 text-sm">No projects in this space yet.</p>
            ) : (
              <div className="divide-border divide-y">
                {group.projects.map((p) => (
                  <div key={p.id} className="py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-muted-foreground font-mono text-xs">
                        {p.slug} · {plural(p.walkthroughCount, 'walkthrough')}
                      </p>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground font-mono text-xs"
                        onClick={() => {
                          saveInstructions.reset()
                          setInstructionsId(instructionsId === p.id ? null : p.id)
                        }}>
                        {p.instructions ? 'instructions' : 'add instructions'}
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground ml-auto"
                        onClick={() => {
                          // A failed save's error belongs to the row it happened
                          // on, not to whichever editor opens next.
                          update.reset()
                          setEditingId(editingId === p.id ? null : p.id)
                        }}>
                        Rename
                      </Button>
                    </div>
                    {editingId === p.id && (
                      <ProjectEditor
                        project={p}
                        pending={update.isPending}
                        error={update.isError ? update.error.message : null}
                        onSave={(name) =>
                          update.mutate({ teamId: p.teamId, projectId: p.id, name })
                        }
                        onCancel={() => setEditingId(null)}
                      />
                    )}
                    {instructionsId === p.id && (
                      <InstructionsEditor
                        project={p}
                        pending={saveInstructions.isPending}
                        error={saveInstructions.isError ? saveInstructions.error.message : null}
                        onSave={(instructions) =>
                          saveInstructions.mutate({
                            teamId: p.teamId,
                            projectId: p.id,
                            // update REQUIRES name — pass the current one through
                            // so an instructions save never renames the project.
                            name: p.name,
                            instructions,
                          })
                        }
                        onCancel={() => setInstructionsId(null)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  )
}

/** Name plus the space it belongs to — the only two things a project is. */
function NewProjectPanel({ teams, onCreated }: { teams: TeamRow[]; onCreated: () => void }) {
  const trpc = useTRPC()
  const [name, setName] = useState('')
  const [spaceKey, setSpaceKey] = useState<string>(PERSONAL_KEY)

  const create = useMutation(trpc.projects.create.mutationOptions({ onSuccess: onCreated }))

  const trimmed = name.trim()
  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <section className="max-w-xl">
      <h2 className="text-muted-foreground font-mono text-xs tracking-[0.14em] uppercase">
        New project
      </h2>
      <div className="rule mt-2" />
      <form
        className="space-y-4 pt-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!trimmed || create.isPending) return
          create.mutate({
            teamId: spaceKey === PERSONAL_KEY ? null : spaceKey,
            name: trimmed,
          })
        }}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1 space-y-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Checkout"
              autoComplete="off"
              maxLength={80}
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-space">Space</Label>
            <select
              id="project-space"
              className={SELECT}
              value={spaceKey}
              onChange={(e) => setSpaceKey(e.target.value)}>
              <option value={PERSONAL_KEY}>Personal</option>
              {sorted.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={create.isPending || !trimmed}>
            {create.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          A folder for related walkthroughs — the recorder picks one when it sends.
        </p>
        {create.isError && <p className="text-destructive text-sm">{create.error.message}</p>}
      </form>
    </section>
  )
}

/** Inline editor for one project: its display name. The slug never moves. */
function ProjectEditor({
  project,
  pending,
  error,
  onSave,
  onCancel,
}: {
  project: { id: string; name: string }
  pending: boolean
  error: string | null
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(project.name)
  const trimmed = name.trim()

  function save() {
    if (pending || trimmed === '') return
    onSave(trimmed)
  }

  return (
    <div className="mt-3 max-w-md space-y-2">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={name}
          aria-label={`Name for ${project.name}`}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            } else if (e.key === 'Escape') {
              onCancel()
            }
          }}
          autoComplete="off"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || trimmed === ''}
          onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  )
}

const TEXTAREA = cn(
  'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm shadow-xs',
  'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'
)

/**
 * Standing context an agent gets prepended to every brief it pulls from this
 * project — repo path, conventions, how to verify. A trimmed-empty save clears
 * it back to null.
 */
function InstructionsEditor({
  project,
  pending,
  error,
  onSave,
  onCancel,
}: {
  project: { name: string; instructions: string | null }
  pending: boolean
  error: string | null
  onSave: (instructions: string | null) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(project.instructions ?? '')

  function save() {
    if (pending) return
    const trimmed = text.trim()
    onSave(trimmed === '' ? null : trimmed)
  }

  return (
    <div className="mt-3 max-w-xl space-y-2">
      <textarea
        autoFocus
        rows={3}
        value={text}
        aria-label={`Instructions for ${project.name}`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Standing context for agents pulling from this project — repo path, conventions, how to verify."
        className={TEXTAREA}
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  )
}
