// Projects for the active space. A project is a name; incoming walkthroughs file
// themselves to one via the recorder's project picker (origin hints still exist
// on the server for auto-routing, but the UI no longer collects them).
//
// Any member of a team may create and rename its projects — the server allows
// it, so the page offers it without a role check. Invites live on /team.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { useActiveSpace, type Space } from '~/lib/space'
import { useTRPC } from '~/lib/trpc'

export function ProjectsPage() {
  const { space } = useActiveSpace()
  return <ProjectsBody key={space.teamId ?? 'personal'} space={space} />
}

function ProjectsBody({ space }: { space: Space }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  // One project is edited at a time; opening another closes the last.
  const [editingId, setEditingId] = useState<string | null>(null)

  const projectsQuery = useQuery(trpc.projects.list.queryOptions({ teamId: space.teamId }))
  const invalidateProjects = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.projects.list.queryKey({ teamId: space.teamId }),
    })
  const create = useMutation(
    trpc.projects.create.mutationOptions({
      onSuccess: () => {
        setName('')
        invalidateProjects()
      },
    })
  )
  const update = useMutation(
    trpc.projects.update.mutationOptions({
      onSuccess: () => {
        invalidateProjects()
        setEditingId(null)
      },
    })
  )

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Projects</h1>
        <p className="text-muted-foreground text-sm">
          {space.teamId === null
            ? 'Projects sort your own walkthroughs.'
            : "Projects sort the team's walkthroughs."}{' '}
          Walkthroughs recorded on a matching origin file themselves here automatically.
        </p>
      </header>

      <section className="space-y-3">
        {projectsQuery.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}
        {projectsQuery.isError && (
          <p className="text-destructive text-sm">{projectsQuery.error.message}</p>
        )}
        {projectsQuery.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">No projects yet.</p>
        )}
        {projectsQuery.data && projectsQuery.data.length > 0 && (
          <>
            <div className="border-border text-muted-foreground flex items-center gap-4 border-b pb-2 text-xs font-medium tracking-wide uppercase">
              <span className="min-w-0 flex-1">Project</span>
              <span className="w-32 shrink-0" />
              <span className="w-20 shrink-0 text-right">Walkthroughs</span>
            </div>
            <div className="divide-border divide-y">
              {projectsQuery.data.map((p) => (
                <div key={p.id} className="py-3">
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="text-sm font-semibold">
                        {p.name}{' '}
                        <span className="text-muted-foreground ml-1 font-mono text-xs font-normal">
                          {p.slug}
                        </span>
                      </p>
                    </div>
                    <div className="flex w-32 shrink-0 justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          // A failed save's error belongs to the row it happened
                          // on, not to whichever editor opens next.
                          update.reset()
                          setEditingId(editingId === p.id ? null : p.id)
                        }}>
                        Edit
                      </Button>
                    </div>
                    <span className="w-20 shrink-0 text-right font-mono text-sm">
                      {p.walkthroughCount}
                    </span>
                  </div>
                  {editingId === p.id && (
                    <ProjectEditor
                      project={p}
                      pending={update.isPending}
                      error={update.isError ? update.error.message : null}
                      onSave={(name) =>
                        update.mutate({ teamId: space.teamId, projectId: p.id, name })
                      }
                      onCancel={() => setEditingId(null)}
                    />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>New project</CardTitle>
          <CardDescription>
            A folder for related walkthroughs — name it after the surface it covers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              const trimmed = name.trim()
              if (!trimmed) return
              create.mutate({ teamId: space.teamId, name: trimmed })
            }}>
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Checkout"
                autoComplete="off"
                required
              />
            </div>
            {create.isError && <p className="text-destructive text-sm">{create.error.message}</p>}
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create project'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
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

  return (
    <div className="border-border bg-muted/40 mt-3 space-y-3 rounded-md border p-3">
      <div className="space-y-2">
        <Label htmlFor={`project-name-${project.id}`}>Name</Label>
        <Input
          id={`project-name-${project.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || trimmed === ''}
          onClick={() => onSave(trimmed)}>
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
