// Every project this account can reach, grouped by the space that owns it.
// Space is an attribute of a project, not a mode the app is in — there is no
// "current space" here, so the page shows Personal and every team at once.
//
// Any member of a team may create and rename its projects — the server allows
// it, so the page offers it without a role check. Rosters live on /team.

import { Fragment, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { PageHeader } from '~/components/ui/page-header'
import { projectColor } from '~/components/ui/project-tag'
import { usePopover } from '~/components/viewer/overflow-menu'
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
  'border-input bg-card text-foreground h-8 rounded-md border px-2.5 text-[13px]',
  'outline-none focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-2'
)

const TH = 'text-muted-foreground border-border border-b px-3 py-1.5 text-left text-xs font-medium'

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
  const multiSpace = groups.length > 1

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        meta={`${plural(projects.length, 'project')} across ${plural(groups.length, 'space')}`}
        className="px-0"
        actions={
          <Button
            type="button"
            variant={creating ? 'outline' : 'default'}
            onClick={() => setCreating((c) => !c)}>
            {creating ? 'Cancel' : 'New project'}
          </Button>
        }
      />

      {creating && (
        <NewProjectPanel
          teams={teams}
          onCreated={() => {
            invalidateProjects()
            setCreating(false)
          }}
        />
      )}

      {projectsQuery.isPending && <p className="text-muted-foreground text-[13px]">Loading…</p>}
      {projectsQuery.isError && (
        <p className="text-destructive text-[13px]">{projectsQuery.error.message}</p>
      )}

      {loaded && projects.length === 0 ? (
        <p className="text-muted-foreground max-w-xl text-[13px] leading-relaxed">
          Nothing filed yet. A project is the folder a walkthrough lands in — name one after the
          surface it covers, and every recording sent to it from the recorder gathers in one place.
        </p>
      ) : (
        loaded && (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={TH} style={{ width: '46%' }}>
                  Project
                </th>
                <th className={TH}>Space</th>
                <th className={TH}>Walkthroughs</th>
                <th className={cn(TH, 'text-right')} />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.teamId ?? PERSONAL_KEY}>
                  {multiSpace && (
                    <tr>
                      <td colSpan={4} className="border-border h-9 border-b px-3">
                        <span className="font-semibold">{group.name}</span>
                        <span className="text-muted-foreground ml-1.5 font-normal">
                          {group.projects.length}
                        </span>
                      </td>
                    </tr>
                  )}
                  {group.projects.length === 0
                    ? multiSpace && (
                        <tr>
                          <td
                            colSpan={4}
                            className="text-muted-foreground border-border/60 border-b px-3 py-3">
                            No projects in this space yet.
                          </td>
                        </tr>
                      )
                    : group.projects.map((p) => (
                        <ProjectRowView
                          key={p.id}
                          project={p}
                          editing={editingId === p.id}
                          editingInstructions={instructionsId === p.id}
                          renamePending={update.isPending}
                          renameError={
                            editingId === p.id && update.isError ? update.error.message : null
                          }
                          instructionsPending={saveInstructions.isPending}
                          instructionsError={
                            instructionsId === p.id && saveInstructions.isError
                              ? saveInstructions.error.message
                              : null
                          }
                          onRename={() => {
                            // A failed save's error belongs to the row it happened on,
                            // not to whichever editor opens next.
                            update.reset()
                            setInstructionsId(null)
                            setEditingId(p.id)
                          }}
                          onEditInstructions={() => {
                            saveInstructions.reset()
                            setEditingId(null)
                            setInstructionsId(p.id)
                          }}
                          onSaveName={(name) =>
                            update.mutate({ teamId: p.teamId, projectId: p.id, name })
                          }
                          onCancelName={() => setEditingId(null)}
                          onSaveInstructions={(instructions) =>
                            saveInstructions.mutate({
                              teamId: p.teamId,
                              projectId: p.id,
                              // update REQUIRES name — pass the current one through so
                              // an instructions save never renames the project.
                              name: p.name,
                              instructions,
                            })
                          }
                          onCancelInstructions={() => setInstructionsId(null)}
                        />
                      ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  )
}

function ProjectRowView({
  project,
  editing,
  editingInstructions,
  renamePending,
  renameError,
  instructionsPending,
  instructionsError,
  onRename,
  onEditInstructions,
  onSaveName,
  onCancelName,
  onSaveInstructions,
  onCancelInstructions,
}: {
  project: ProjectRow
  editing: boolean
  editingInstructions: boolean
  renamePending: boolean
  renameError: string | null
  instructionsPending: boolean
  instructionsError: string | null
  onRename: () => void
  onEditInstructions: () => void
  onSaveName: (name: string) => void
  onCancelName: () => void
  onSaveInstructions: (instructions: string | null) => void
  onCancelInstructions: () => void
}) {
  return (
    <>
      <tr className="group border-border/60 border-b">
        <td className="px-3 py-2">
          <div className="flex items-center gap-2.5">
            <i
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: projectColor(project.id) }}
            />
            <div className="min-w-0">
              {editing ? (
                <InlineName
                  name={project.name}
                  pending={renamePending}
                  onSave={onSaveName}
                  onCancel={onCancelName}
                />
              ) : (
                <p className="truncate font-medium">{project.name}</p>
              )}
              <p className="text-muted-foreground truncate font-mono text-xs">{project.slug}</p>
            </div>
          </div>
        </td>
        <td className="text-muted-foreground px-3 py-2">{project.spaceName}</td>
        <td className="px-3 py-2 font-mono text-xs tabular-nums">{project.walkthroughCount}</td>
        <td className="px-3 py-2 text-right">
          <ProjectMenu
            hasInstructions={project.instructions !== null}
            onRename={onRename}
            onEditInstructions={onEditInstructions}
          />
        </td>
      </tr>
      {renameError && (
        <tr>
          <td colSpan={4} className="text-destructive px-3 pb-2 text-[13px]">
            {renameError}
          </td>
        </tr>
      )}
      {editingInstructions && (
        <tr>
          <td colSpan={4} className="px-3 pb-3">
            <InstructionsEditor
              project={project}
              pending={instructionsPending}
              error={instructionsError}
              onSave={onSaveInstructions}
              onCancel={onCancelInstructions}
            />
          </td>
        </tr>
      )}
    </>
  )
}

/** The per-row ⋯ menu: rename in place, or open the instructions editor. */
function ProjectMenu({
  hasInstructions,
  onRename,
  onEditInstructions,
}: {
  hasInstructions: boolean
  onRename: () => void
  onEditInstructions: () => void
}) {
  const { open, setOpen, ref } = usePopover()
  const ITEM =
    'hover:bg-accent/50 flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[13px]'
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'text-muted-foreground hover:bg-accent/50 hover:text-foreground inline-flex size-7 items-center justify-center rounded-full transition-colors',
          'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
          open && 'opacity-100'
        )}>
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div className="bg-card border-border absolute right-0 z-20 mt-1 w-48 rounded-md border p-1 shadow-sm">
          <button
            type="button"
            className={ITEM}
            onClick={() => {
              setOpen(false)
              onRename()
            }}>
            Rename
          </button>
          <button
            type="button"
            className={ITEM}
            onClick={() => {
              setOpen(false)
              onEditInstructions()
            }}>
            {hasInstructions ? 'Edit instructions' : 'Add instructions'}
          </button>
        </div>
      )}
    </div>
  )
}

/** The name cell turned editable — Enter saves, Escape backs out. */
function InlineName({
  name,
  pending,
  onSave,
  onCancel,
}: {
  name: string
  pending: boolean
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(name)
  const trimmed = value.trim()

  function save() {
    if (pending || trimmed === '' || trimmed === name) {
      onCancel()
      return
    }
    onSave(trimmed)
  }

  return (
    <Input
      autoFocus
      value={value}
      aria-label={`Name for ${name}`}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          save()
        } else if (e.key === 'Escape') {
          onCancel()
        }
      }}
      onBlur={save}
      autoComplete="off"
      className="h-7"
    />
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
    <form
      className="bg-card border-border max-w-xl space-y-4 rounded-lg border p-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!trimmed || create.isPending) return
        create.mutate({
          teamId: spaceKey === PERSONAL_KEY ? null : spaceKey,
          name: trimmed,
        })
      }}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="project-name" className="text-muted-foreground text-xs">
            Name
          </Label>
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
        <div className="space-y-1.5">
          <Label htmlFor="project-space" className="text-muted-foreground text-xs">
            Space
          </Label>
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
          {create.isPending ? 'Creating…' : 'Create'}
        </Button>
      </div>
      <p className="text-muted-foreground text-[13px]">
        A folder for related walkthroughs — the recorder picks one when it sends.
      </p>
      {create.isError && <p className="text-destructive text-[13px]">{create.error.message}</p>}
    </form>
  )
}

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
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  function save() {
    if (pending) return
    const trimmed = text.trim()
    onSave(trimmed === '' ? null : trimmed)
  }

  return (
    <div className="bg-secondary border-border max-w-xl space-y-2 rounded-lg border p-4">
      <textarea
        ref={ref}
        rows={3}
        value={text}
        aria-label={`Instructions for ${project.name}`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Standing context for agents pulling from this project — repo path, conventions, how to verify."
        className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring w-full rounded-md border px-2.5 py-2 text-[13px] outline-none focus-visible:ring-2"
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-destructive text-[13px]">{error}</p>}
    </div>
  )
}
