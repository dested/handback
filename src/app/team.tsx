// Team surfaces for the active org: who's in it and who's been invited. A
// personal workspace has neither, and says so. API tokens live on /connect.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouteLoaderData } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { useActiveOrg, type OrgSummary } from '~/lib/org'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import type { Session } from '../../server/auth'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Formatted from UTC parts on purpose: locale formatting differs between the
// SSR runtime and the browser, which would break hydration.
function fmtDate(value: string | null) {
  if (!value) return 'never'
  const d = new Date(value)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

const SELECT = cn(
  'border-input bg-background text-foreground h-8 rounded-md border px-2 text-sm shadow-xs',
  'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'
)

function roleChipClass(role: string) {
  if (role === 'owner') return 'bg-cobalt-wash text-cobalt'
  if (role === 'admin') return 'bg-review-wash text-review'
  return 'bg-muted text-muted-foreground'
}

function RoleChip({ role }: { role: string }) {
  return (
    <span className={cn('rounded px-2 py-0.5 text-xs font-medium capitalize', roleChipClass(role))}>
      {role}
    </span>
  )
}

/** Copy-to-clipboard state keyed by row, so only the clicked row flashes. */
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      return
    }
    setCopied(key)
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
  }
  return { copied, copy }
}

function CopyField({ value }: { value: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="border-input bg-background h-8 min-w-0 flex-1 rounded-md border px-2 font-mono text-xs"
      />
      <Button type="button" variant="outline" size="sm" onClick={() => void copy('f', value)}>
        {copied ? <Check /> : <Copy />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

function NoOrgCard() {
  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>No organization yet</CardTitle>
        <CardDescription>
          Create one from the inbox and your team, invites, and tokens live here.
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

function Loading() {
  return <p className="text-muted-foreground text-sm">Loading…</p>
}

function ErrorLine({ message }: { message: string }) {
  return <p className="text-destructive text-sm">{message}</p>
}

type Tab = 'members' | 'invites'

export function TeamPage() {
  const { org, orgsLoaded } = useActiveOrg()
  if (!org) return orgsLoaded ? <NoOrgCard /> : <Loading />
  return <TeamBody key={org.id} org={org} />
}

function TeamBody({ org }: { org: OrgSummary }) {
  // The roster and the invite list are admin surfaces — the server refuses them
  // to everyone else, so the tabs don't exist rather than erroring on open.
  const canManage = org.role === 'owner' || org.role === 'admin'
  // Guests are scoped to a project or two; the workspace-wide surfaces aren't theirs.
  const fullAccess = org.scope === 'org'
  const [tab, setTab] = useState<Tab>('members')

  const tabs: Array<[Tab, string]> =
    !org.personal && canManage
      ? [
          ['members', 'Members'],
          ['invites', 'Invites'],
        ]
      : []

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Team</h1>
        {!org.personal && canManage ? (
          <WorkspaceName org={org} />
        ) : (
          <p className="text-muted-foreground text-sm">{org.name}</p>
        )}
      </header>

      {/* A personal workspace has no roster to manage — the page's whole job is
          explaining that, and where a team comes from. */}
      {org.personal && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>This is your personal workspace — just you.</CardTitle>
            <CardDescription>
              Walkthroughs you record land here, and nobody else can see them. When you want
              reviewers, create a team from the workspace switcher up top — a team is a workspace
              with members.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* A full member can see the workspace but doesn't run it. */}
      {!org.personal && !canManage && fullAccess && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>The roster is the owner's side of the house.</CardTitle>
            <CardDescription>
              Members and invites are managed by the workspace owner and admins.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* A guest holds a slice of the workspace, and none of this page is in it —
          say so rather than rendering a header above nothing. */}
      {!org.personal && !fullAccess && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>You're a guest on this workspace</CardTitle>
            <CardDescription>
              You see the projects you've been granted —{' '}
              <Link to="/projects" className="text-primary underline underline-offset-4">
                they're listed here
              </Link>
              . Who else is in the workspace and who's been invited are the owner's side of the
              house.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {tabs.length > 0 && (
        <div className="border-border bg-card inline-flex gap-1 rounded-md border p-1">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                tab === value
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}>
              {label}
            </button>
          ))}
        </div>
      )}

      {tabs.length > 0 && tab === 'members' && <MembersTab org={org} />}
      {tabs.length > 0 && tab === 'invites' && <InvitesTab org={org} />}
    </div>
  )
}

/** The workspace's display name, renamed in place by owners and admins. */
function WorkspaceName({ org }: { org: OrgSummary }) {
  const trpc = useTRPC()
  const { refreshOrgs } = useActiveOrg()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(org.name)

  const rename = useMutation(
    trpc.orgs.rename.mutationOptions({
      onSuccess: () => {
        refreshOrgs()
        setEditing(false)
      },
    })
  )

  const trimmed = value.trim()
  const stale = trimmed === '' || trimmed === org.name

  function save() {
    if (stale) return
    rename.mutate({ orgId: org.id, name: trimmed })
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <p className="text-muted-foreground text-sm">{org.name}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setValue(org.name)
            setEditing(true)
          }}>
          Rename
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-md space-y-1">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          defaultValue={org.name}
          aria-label="Workspace name"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            } else if (e.key === 'Escape') {
              setEditing(false)
            }
          }}
        />
        <Button type="button" size="sm" disabled={rename.isPending || stale} onClick={save}>
          {rename.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {rename.isError && <ErrorLine message={rename.error.message} />}
    </div>
  )
}

function MembersTab({ org }: { org: OrgSummary }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const root = useRouteLoaderData('root') as { session: Session | null } | undefined
  const myUserId = root?.session?.user.id ?? null

  const membersQuery = useQuery(trpc.orgs.members.queryOptions({ orgId: org.id }))
  const projectsQuery = useQuery(trpc.projects.list.queryOptions({ orgId: org.id }))
  const [editingId, setEditingId] = useState<string | null>(null)
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.orgs.members.queryKey({ orgId: org.id }) })
  const setRole = useMutation(trpc.orgs.setRole.mutationOptions({ onSuccess: invalidate }))
  const removeMember = useMutation(
    trpc.orgs.removeMember.mutationOptions({ onSuccess: invalidate })
  )
  const setAccess = useMutation(
    trpc.orgs.setAccess.mutationOptions({
      onSuccess: () => {
        invalidate()
        setEditingId(null)
      },
    })
  )

  const isOwner = org.role === 'owner'
  const canRemove = isOwner || org.role === 'admin'

  if (membersQuery.isPending) return <Loading />
  if (membersQuery.isError) return <ErrorLine message={membersQuery.error.message} />

  return (
    <section className="space-y-3">
      <div className="border-border text-muted-foreground flex items-center gap-4 border-b pb-2 text-xs font-medium tracking-wide uppercase">
        <span className="min-w-0 flex-1">Member</span>
        <span className="w-36 shrink-0">Role</span>
        <span className="w-28 shrink-0">Joined</span>
        <span className="w-40 shrink-0" />
      </div>

      <div className="divide-border divide-y">
        {membersQuery.data.map((m) => {
          const isGuest = m.scope === 'projects'
          const showRoleSelect = isOwner && m.role !== 'owner' && !isGuest
          const showRemove = canRemove && m.role !== 'owner' && m.userId !== myUserId
          // Admins can't restrict fellow admins — the server enforces it, the UI hides it.
          const showAccess = canRemove && m.role !== 'owner' && (isOwner || m.role !== 'admin')
          return (
            <div key={m.membershipId} className="py-3">
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="text-muted-foreground truncate text-sm">{m.email}</p>
                  {isGuest && (
                    <p className="text-muted-foreground truncate text-xs">
                      Only: {m.projects.map((p) => p.name).join(', ') || 'no projects'}
                    </p>
                  )}
                </div>
                <div className="w-36 shrink-0">
                  {showRoleSelect ? (
                    <select
                      aria-label={`Role for ${m.email}`}
                      className={SELECT}
                      value={m.role}
                      disabled={setRole.isPending}
                      onChange={(e) =>
                        setRole.mutate({
                          orgId: org.id,
                          membershipId: m.membershipId,
                          role: e.target.value as 'admin' | 'member',
                        })
                      }>
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                    </select>
                  ) : isGuest ? (
                    <RoleChip role="guest" />
                  ) : (
                    <RoleChip role={m.role} />
                  )}
                </div>
                <span className="text-muted-foreground w-28 shrink-0 font-mono text-xs">
                  {fmtDate(m.joinedAt)}
                </span>
                <div className="w-40 shrink-0">
                  <div className="flex justify-end gap-1">
                    {showAccess && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setEditingId(editingId === m.membershipId ? null : m.membershipId)
                        }>
                        Access
                      </Button>
                    )}
                    {showRemove && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={removeMember.isPending}
                        onClick={() => {
                          if (!window.confirm(`Remove ${m.email} from ${org.name}?`)) return
                          removeMember.mutate({ orgId: org.id, membershipId: m.membershipId })
                        }}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              {editingId === m.membershipId && (
                <AccessEditor
                  member={m}
                  projects={projectsQuery.data ?? []}
                  projectsLoading={projectsQuery.isPending}
                  pending={setAccess.isPending}
                  error={setAccess.isError ? setAccess.error.message : null}
                  onSave={(projectIds) =>
                    setAccess.mutate({ orgId: org.id, membershipId: m.membershipId, projectIds })
                  }
                  onCancel={() => setEditingId(null)}
                />
              )}
            </div>
          )
        })}
      </div>

      {setRole.isError && <ErrorLine message={setRole.error.message} />}
      {removeMember.isError && <ErrorLine message={removeMember.error.message} />}
    </section>
  )
}

/** Inline editor for one member's access: whole workspace, or a project subset. */
function AccessEditor({
  member,
  projects,
  projectsLoading,
  pending,
  error,
  onSave,
  onCancel,
}: {
  member: { membershipId: string; scope: string; projects: Array<{ id: string; name: string }> }
  projects: Array<{ id: string; name: string }>
  projectsLoading: boolean
  pending: boolean
  error: string | null
  onSave: (projectIds: string[] | null) => void
  onCancel: () => void
}) {
  const [scoped, setScoped] = useState(member.scope === 'projects')
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(member.projects.map((p) => p.id))
  )

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="border-border bg-muted/40 mt-3 space-y-3 rounded-md border p-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          className="accent-primary"
          name={`access-${member.membershipId}`}
          checked={!scoped}
          onChange={() => setScoped(false)}
        />
        Entire workspace
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          className="accent-primary"
          name={`access-${member.membershipId}`}
          checked={scoped}
          onChange={() => setScoped(true)}
        />
        Only selected projects
      </label>
      {scoped &&
        (projectsLoading ? (
          <p className="text-muted-foreground pl-6 text-xs">Loading projects…</p>
        ) : projects.length === 0 ? (
          <p className="text-muted-foreground pl-6 text-xs">No projects in this workspace yet.</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6">
            {projects.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                />
                {p.name}
              </label>
            ))}
          </div>
        ))}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={pending || (scoped && (projectsLoading || selected.size === 0))}
          onClick={() => onSave(scoped ? [...selected] : null)}>
          {pending ? 'Saving…' : 'Save access'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <ErrorLine message={error} />}
    </div>
  )
}

function TeamUpsell() {
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Team is a paid feature</CardTitle>
        <CardDescription>
          Inviting teammates and project guests isn't switched on for this workspace yet. During the
          alpha it's enabled by hand — write{' '}
          <a className="text-primary underline underline-offset-4" href="mailto:sal@dested.com">
            sal@dested.com
          </a>{' '}
          and we'll turn it on.
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

function InvitesTab({ org }: { org: OrgSummary }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { copied, copy } = useCopy()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [projectId, setProjectId] = useState('')
  const [createdId, setCreatedId] = useState<string | null>(null)

  const invitesQuery = useQuery(trpc.invites.list.queryOptions({ orgId: org.id }))
  const projectsQuery = useQuery(trpc.projects.list.queryOptions({ orgId: org.id }))
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.invites.list.queryKey({ orgId: org.id }) })

  const create = useMutation(
    trpc.invites.create.mutationOptions({
      onSuccess: (result) => {
        setCreatedId(result.id)
        setEmail('')
        invalidate()
      },
    })
  )
  const revoke = useMutation(trpc.invites.revoke.mutationOptions({ onSuccess: invalidate }))

  const linkFor = (id: string) => `${window.location.origin}/join/${id}`

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        {invitesQuery.isPending && <Loading />}
        {invitesQuery.isError && <ErrorLine message={invitesQuery.error.message} />}
        {invitesQuery.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">No open invites.</p>
        )}
        {invitesQuery.data && invitesQuery.data.length > 0 && (
          <div className="divide-border divide-y">
            {invitesQuery.data.map((i) => (
              <div key={i.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {i.email ?? (
                      <span className="text-muted-foreground italic">Anyone with the link</span>
                    )}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Expires <span className="font-mono">{fmtDate(i.expiresAt)}</span>
                  </p>
                </div>
                <div className="w-36 shrink-0">
                  {i.projectName ? (
                    <span className="bg-muted text-muted-foreground inline-block max-w-full truncate rounded px-2 py-0.5 align-middle text-xs font-medium">
                      {i.projectName}
                    </span>
                  ) : (
                    <RoleChip role={i.role} />
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copy(i.id, linkFor(i.id))}>
                  {copied === i.id ? <Check /> : <Copy />}
                  {copied === i.id ? 'Copied' : 'Copy link'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={revoke.isPending}
                  onClick={() => {
                    if (!window.confirm('Revoke this invite? The link stops working.')) return
                    revoke.mutate({ orgId: org.id, inviteId: i.id })
                  }}>
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
        {revoke.isError && <ErrorLine message={revoke.error.message} />}
      </section>

      {/* Turning team off must not orphan live links — the list + revoke above
          stay; only creating new invites is paywalled. */}
      {!org.teamEnabled && <TeamUpsell />}
      {org.teamEnabled && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
            <CardDescription>
              Leave the email blank for a link anyone can use. Invites expire after seven days.
              Scope an invite to one project and they'll only see that project's walkthroughs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                const trimmed = email.trim()
                create.mutate({
                  orgId: org.id,
                  ...(projectId ? { projectId } : { role }),
                  ...(trimmed ? { email: trimmed } : {}),
                })
              }}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1 space-y-2">
                  <Label htmlFor="invite-email">Email (optional)</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="teammate@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-access">Access</Label>
                  <select
                    id="invite-access"
                    className={cn(SELECT, 'h-9')}
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">Entire workspace</option>
                    {(projectsQuery.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} only
                      </option>
                    ))}
                  </select>
                </div>
                {projectId === '' && (
                  <div className="space-y-2">
                    <Label htmlFor="invite-role">Role</Label>
                    <select
                      id="invite-role"
                      className={cn(SELECT, 'h-9')}
                      value={role}
                      onChange={(e) => setRole(e.target.value as 'admin' | 'member')}>
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>
                )}
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? 'Creating…' : 'Create invite'}
                </Button>
              </div>
              {projectsQuery.isError && <ErrorLine message={projectsQuery.error.message} />}
              {create.isError && <ErrorLine message={create.error.message} />}
              {createdId && (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-sm">Send them this link:</p>
                  <CopyField value={linkFor(createdId)} />
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
