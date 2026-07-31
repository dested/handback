// Projects for the active org. A project is mostly a name plus the web origins
// its gripes get recorded on — that's what files an incoming gripe automatically.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { useActiveOrg, type OrgSummary } from '~/lib/org'
import { useTRPC } from '~/lib/trpc'

function NoOrgCard() {
  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>No organization yet</CardTitle>
        <CardDescription>
          Create one from the inbox and your projects will live here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link to="/app" className="text-primary text-sm underline underline-offset-4">
          Go to the inbox
        </Link>
      </CardContent>
    </Card>
  )
}

export function ProjectsPage() {
  const { org, orgsLoaded } = useActiveOrg()
  if (!org) {
    return orgsLoaded ? <NoOrgCard /> : <p className="text-muted-foreground text-sm">Loading…</p>
  }
  return <ProjectsBody key={org.id} org={org} />
}

function ProjectsBody({ org }: { org: OrgSummary }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [origins, setOrigins] = useState('')
  const [invited, setInvited] = useState<{ projectId: string; link: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // Guests see the list of what they've been let into, but can't reshape the workspace.
  const fullAccess = org.scope === 'org'
  const canManage = org.role === 'owner' || org.role === 'admin'

  const projectsQuery = useQuery(trpc.projects.list.queryOptions({ orgId: org.id }))
  const invite = useMutation(
    trpc.invites.create.mutationOptions({
      onSuccess: (result, vars) => {
        setCopied(false)
        setInvited({
          projectId: vars.projectId ?? '',
          link: `${window.location.origin}/join/${result.id}`,
        })
      },
    })
  )
  const create = useMutation(
    trpc.projects.create.mutationOptions({
      onSuccess: () => {
        setName('')
        setOrigins('')
        queryClient.invalidateQueries({
          queryKey: trpc.projects.list.queryKey({ orgId: org.id }),
        })
      },
    })
  )

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Projects</h1>
        <p className="text-muted-foreground text-sm">
          Gripes recorded on a matching origin file themselves here automatically.
        </p>
      </header>

      <section className="space-y-3">
        {projectsQuery.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}
        {projectsQuery.isError && (
          <p className="text-destructive text-sm">{projectsQuery.error.message}</p>
        )}
        {projectsQuery.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {fullAccess ? 'No projects yet.' : "You haven't been given access to any projects yet."}
          </p>
        )}
        {projectsQuery.data && projectsQuery.data.length > 0 && (
          <>
            <div className="border-border text-muted-foreground flex items-center gap-4 border-b pb-2 text-xs font-medium tracking-wide uppercase">
              <span className="min-w-0 flex-1">Project</span>
              {canManage && <span className="w-16 shrink-0" />}
              <span className="w-20 shrink-0 text-right">Gripes</span>
            </div>
            <div className="divide-border divide-y">
              {projectsQuery.data.map((p) => (
                <div key={p.id} className="flex items-start gap-4 py-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm font-semibold">
                      {p.name}{' '}
                      <span className="text-muted-foreground ml-1 font-mono text-xs font-normal">
                        {p.slug}
                      </span>
                    </p>
                    {p.originHints.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {p.originHints.map((origin) => (
                          <span
                            key={origin}
                            className="border-border text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-xs">
                            {origin}
                          </span>
                        ))}
                      </div>
                    )}
                    {invited?.projectId === p.id && (
                      <div className="space-y-1 pt-1">
                        <div className="flex items-center gap-2">
                          <input
                            readOnly
                            value={invited.link}
                            onFocus={(e) => e.currentTarget.select()}
                            className="border-input bg-background h-8 min-w-0 flex-1 rounded-md border px-2 font-mono text-xs"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              void navigator.clipboard.writeText(invited.link).then(() => {
                                setCopied(true)
                                setTimeout(() => setCopied(false), 1500)
                              })
                            }}>
                            {copied ? <Check /> : <Copy />}
                            {copied ? 'Copied' : 'Copy'}
                          </Button>
                        </div>
                        <p className="text-muted-foreground text-xs">
                          Anyone with this link joins as a guest of {p.name} — they'll see only this
                          project's gripes. Expires in seven days.
                        </p>
                      </div>
                    )}
                  </div>
                  {canManage && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-16 shrink-0"
                      disabled={invite.isPending}
                      onClick={() => invite.mutate({ orgId: org.id, projectId: p.id })}>
                      Invite
                    </Button>
                  )}
                  <span className="w-20 shrink-0 text-right font-mono text-sm">{p.gripeCount}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {invite.isError && <p className="text-destructive text-sm">{invite.error.message}</p>}
      </section>

      {fullAccess && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>New project</CardTitle>
            <CardDescription>
              Origins are matched against the page a gripe was recorded on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                const trimmed = name.trim()
                if (!trimmed) return
                create.mutate({
                  orgId: org.id,
                  name: trimmed,
                  originHints: origins
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line !== ''),
                })
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
              <div className="space-y-2">
                <Label htmlFor="project-origins">Origins</Label>
                <textarea
                  id="project-origins"
                  rows={3}
                  value={origins}
                  onChange={(e) => setOrigins(e.target.value)}
                  placeholder={'https://app.example.com\nhttps://staging.example.com'}
                  spellCheck={false}
                  className="border-input bg-background placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                />
                <p className="text-muted-foreground text-xs">One URL origin per line.</p>
              </div>
              {create.isError && <p className="text-destructive text-sm">{create.error.message}</p>}
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create project'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
