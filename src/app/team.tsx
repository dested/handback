// Team surfaces for the active org: who's in it, who's been invited, and the
// API tokens that let `bun cli/push.ts` and the handback MCP server talk to it.

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
    <span
      className={cn(
        'rounded px-2 py-0.5 text-xs font-medium capitalize',
        roleChipClass(role)
      )}>
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

type Tab = 'members' | 'invites' | 'tokens'

export function TeamPage() {
  const { org, orgsLoaded } = useActiveOrg()
  if (!org) return orgsLoaded ? <NoOrgCard /> : <Loading />
  return <TeamBody key={org.id} org={org} />
}

function TeamBody({ org }: { org: OrgSummary }) {
  const canManage = org.role === 'owner' || org.role === 'admin'
  // Guests are scoped to a project or two; the workspace-wide surfaces aren't theirs.
  const fullAccess = org.scope === 'org'
  const [tab, setTab] = useState<Tab>('members')

  const tabs: Array<[Tab, string]> = [
    ['members', 'Members'],
    ...(canManage ? ([['invites', 'Invites']] as Array<[Tab, string]>) : []),
    ...(fullAccess ? ([['tokens', 'API tokens']] as Array<[Tab, string]>) : []),
  ]

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Team</h1>
        <p className="text-muted-foreground text-sm">{org.name}</p>
      </header>

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

      {tab === 'members' && <MembersTab org={org} />}
      {tab === 'invites' && <InvitesTab org={org} />}
      {tab === 'tokens' && <TokensTab org={org} />}
    </div>
  )
}

function MembersTab({ org }: { org: OrgSummary }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const root = useRouteLoaderData('root') as { session: Session | null } | undefined
  const myUserId = root?.session?.user.id ?? null

  const membersQuery = useQuery(trpc.orgs.members.queryOptions({ orgId: org.id }))
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.orgs.members.queryKey({ orgId: org.id }) })
  const setRole = useMutation(trpc.orgs.setRole.mutationOptions({ onSuccess: invalidate }))
  const removeMember = useMutation(trpc.orgs.removeMember.mutationOptions({ onSuccess: invalidate }))

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
        <span className="w-20 shrink-0" />
      </div>

      <div className="divide-border divide-y">
        {membersQuery.data.map((m) => {
          const isGuest = m.scope === 'projects'
          const showRoleSelect = isOwner && m.role !== 'owner' && !isGuest
          const showRemove = canRemove && m.role !== 'owner' && m.userId !== myUserId
          return (
            <div key={m.membershipId} className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="text-muted-foreground truncate text-sm">{m.email}</p>
                {isGuest && (
                  <p className="text-muted-foreground truncate text-xs">
                    Only: {m.projects.join(', ') || 'no projects'}
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
              <div className="w-20 shrink-0">
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
          )
        })}
      </div>

      {setRole.isError && <ErrorLine message={setRole.error.message} />}
      {removeMember.isError && <ErrorLine message={removeMember.error.message} />}
    </section>
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

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Invite someone</CardTitle>
          <CardDescription>
            Leave the email blank for a link anyone can use. Invites expire after seven days. Scope
            an invite to one project and they'll only see that project's gripes.
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
    </div>
  )
}

function TokensTab({ org }: { org: OrgSummary }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [rawToken, setRawToken] = useState<string | null>(null)

  const tokensQuery = useQuery(trpc.tokens.list.queryOptions({ orgId: org.id }))
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.tokens.list.queryKey({ orgId: org.id }) })

  const create = useMutation(
    trpc.tokens.create.mutationOptions({
      onSuccess: (result) => {
        setRawToken(result.token)
        setName('')
        invalidate()
      },
    })
  )
  const revoke = useMutation(trpc.tokens.revoke.mutationOptions({ onSuccess: invalidate }))

  return (
    <div className="space-y-8">
      <p className="text-muted-foreground max-w-2xl text-sm">
        These tokens authenticate <span className="font-mono text-xs">bun cli/push.ts</span> and the
        handback MCP server; they are yours alone and only work against {org.name}.
      </p>

      <section className="space-y-3">
        {tokensQuery.isPending && <Loading />}
        {tokensQuery.isError && <ErrorLine message={tokensQuery.error.message} />}
        {tokensQuery.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">No tokens yet.</p>
        )}
        {tokensQuery.data && tokensQuery.data.length > 0 && (
          <>
            <div className="border-border text-muted-foreground flex items-center gap-4 border-b pb-2 text-xs font-medium tracking-wide uppercase">
              <span className="min-w-0 flex-1">Name</span>
              <span className="w-20 shrink-0">Token</span>
              <span className="w-28 shrink-0">Created</span>
              <span className="w-28 shrink-0">Last used</span>
              <span className="w-20 shrink-0" />
            </div>
            <div className="divide-border divide-y">
              {tokensQuery.data.map((t) => (
                <div key={t.id} className="flex items-center gap-4 py-3">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</p>
                  <span className="w-20 shrink-0 font-mono text-xs">…{t.lastFour}</span>
                  <span className="text-muted-foreground w-28 shrink-0 font-mono text-xs">
                    {fmtDate(t.createdAt)}
                  </span>
                  <span className="text-muted-foreground w-28 shrink-0 font-mono text-xs">
                    {fmtDate(t.lastUsedAt)}
                  </span>
                  <div className="w-20 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={revoke.isPending}
                      onClick={() => {
                        if (!window.confirm(`Revoke "${t.name}"? Anything using it stops working.`))
                          return
                        revoke.mutate({ orgId: org.id, tokenId: t.id })
                      }}>
                      Revoke
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {revoke.isError && <ErrorLine message={revoke.error.message} />}
      </section>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>New token</CardTitle>
          <CardDescription>Name it after the machine or agent that will use it.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              const trimmed = name.trim()
              if (!trimmed) return
              create.mutate({ orgId: org.id, name: trimmed })
            }}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1 space-y-2">
                <Label htmlFor="token-name">Name</Label>
                <Input
                  id="token-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="laptop"
                  autoComplete="off"
                  required
                />
              </div>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create token'}
              </Button>
            </div>
            {create.isError && <ErrorLine message={create.error.message} />}
            {rawToken && (
              <div className="border-cobalt/40 bg-cobalt-wash space-y-2 rounded-md border p-3">
                <p className="text-cobalt text-sm font-medium">
                  Copy it now — it won't be shown again.
                </p>
                <CopyField value={rawToken} />
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
