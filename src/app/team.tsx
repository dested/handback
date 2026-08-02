// The team page for the active space: who's in it, who's been invited, and who
// owns it. A personal space has none of that and says so. API tokens live on
// /connect — they belong to the account, not to a space.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouteLoaderData } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { useActiveSpace, type Space } from '~/lib/space'
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

function Loading() {
  return <p className="text-muted-foreground text-sm">Loading…</p>
}

function ErrorLine({ message }: { message: string }) {
  return <p className="text-destructive text-sm">{message}</p>
}

type Tab = 'members' | 'invites'

export function TeamPage() {
  const { space } = useActiveSpace()
  if (space.teamId === null) return <PersonalSpaceCard />
  return <TeamBody key={space.teamId} teamId={space.teamId} role={space.role} />
}

/** Personal isn't a degenerate team — it's the shape with no roster at all. */
function PersonalSpaceCard() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold">Team</h1>
      </header>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>This is your personal space — just you.</CardTitle>
          <CardDescription>
            Walkthroughs you record land here, and nobody else can see them. When you want
            reviewers, create a team from the switcher up top. Teams are per-seat, and the creator
            holds the bill.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

function TeamBody({ teamId, role }: { teamId: string; role: Space['role'] }) {
  const trpc = useTRPC()
  // The roster and the invite list are admin surfaces — the server refuses them
  // to everyone else, so the tabs don't exist rather than erroring on open.
  const canManage = role === 'owner' || role === 'admin'
  const [tab, setTab] = useState<Tab>('members')
  const teamQuery = useQuery(trpc.teams.get.queryOptions({ teamId }))

  const tabs: Array<[Tab, string]> = canManage
    ? [
        ['members', 'Members'],
        ['invites', 'Invites'],
      ]
    : []

  const team = teamQuery.data

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Team</h1>
        {teamQuery.isError ? (
          <ErrorLine message={teamQuery.error.message} />
        ) : !team ? (
          <Loading />
        ) : (
          <>
            {canManage ? (
              <TeamName teamId={teamId} name={team.name} />
            ) : (
              <p className="text-muted-foreground text-sm">{team.name}</p>
            )}
            <p className="text-muted-foreground font-mono text-xs">
              {team.memberCount + team.pendingInvites} of {team.seatLimit} seats
            </p>
          </>
        )}
      </header>

      {/* A full member can see the team but doesn't run it. */}
      {!canManage && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>The roster is the owner's side of the house.</CardTitle>
            <CardDescription>
              Members and invites are managed by the team's owner and admins.
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

      {canManage && team && tab === 'members' && (
        <MembersTab teamId={teamId} teamName={team.name} isOwner={role === 'owner'} />
      )}
      {canManage && team && tab === 'invites' && (
        <InvitesTab
          teamId={teamId}
          seatLimit={team.seatLimit}
          taken={team.memberCount + team.pendingInvites}
        />
      )}
    </div>
  )
}

/** The team's display name, renamed in place by owners and admins. */
function TeamName({ teamId, name }: { teamId: string; name: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { refreshTeams } = useActiveSpace()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)

  const rename = useMutation(
    trpc.teams.rename.mutationOptions({
      onSuccess: () => {
        refreshTeams()
        queryClient.invalidateQueries({ queryKey: trpc.teams.get.queryKey({ teamId }) })
        setEditing(false)
      },
    })
  )

  const trimmed = value.trim()
  const stale = trimmed === '' || trimmed === name

  function save() {
    if (stale) return
    rename.mutate({ teamId, name: trimmed })
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <p className="text-muted-foreground text-sm">{name}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setValue(name)
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
          defaultValue={name}
          aria-label="Team name"
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

function MembersTab({
  teamId,
  teamName,
  isOwner,
}: {
  teamId: string
  teamName: string
  isOwner: boolean
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const root = useRouteLoaderData('root') as { session: Session | null } | undefined
  const myUserId = root?.session?.user.id ?? null

  const membersQuery = useQuery(trpc.teams.members.queryOptions({ teamId }))
  // Ownership moves the bill as well as the controls, so it arms into a
  // sentence that says so rather than firing off a hover.
  const [transferId, setTransferId] = useState<string | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.teams.members.queryKey({ teamId }) })
    queryClient.invalidateQueries({ queryKey: trpc.teams.get.queryKey({ teamId }) })
  }
  const { refreshTeams } = useActiveSpace()

  const setRole = useMutation(trpc.teams.setRole.mutationOptions({ onSuccess: invalidate }))
  const removeMember = useMutation(
    trpc.teams.removeMember.mutationOptions({ onSuccess: invalidate })
  )
  const transfer = useMutation(
    trpc.teams.transferOwnership.mutationOptions({
      onSuccess: () => {
        invalidate()
        // The caller just demoted themselves — their own role in the switcher
        // is now stale.
        refreshTeams()
        setTransferId(null)
      },
    })
  )

  if (membersQuery.isPending) return <Loading />
  if (membersQuery.isError) return <ErrorLine message={membersQuery.error.message} />

  return (
    <section className="space-y-3">
      <div className="border-border text-muted-foreground flex items-center gap-4 border-b pb-2 text-xs font-medium tracking-wide uppercase">
        <span className="min-w-0 flex-1">Member</span>
        <span className="w-36 shrink-0">Role</span>
        <span className="w-28 shrink-0">Joined</span>
        <span className="w-44 shrink-0" />
      </div>

      <div className="divide-border divide-y">
        {membersQuery.data.map((m) => {
          const isTeamOwner = m.role === 'owner'
          const showRoleSelect = isOwner && !isTeamOwner
          const showRemove = !isTeamOwner && m.userId !== myUserId
          return (
            <div key={m.membershipId} className="py-3">
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="text-muted-foreground truncate text-sm">{m.email}</p>
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
                          teamId,
                          membershipId: m.membershipId,
                          role: e.target.value === 'admin' ? 'admin' : 'member',
                        })
                      }>
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                    </select>
                  ) : (
                    <RoleChip role={m.role} />
                  )}
                </div>
                <span className="text-muted-foreground w-28 shrink-0 font-mono text-xs">
                  {fmtDate(m.joinedAt)}
                </span>
                <div className="w-44 shrink-0">
                  <div className="flex justify-end gap-1">
                    {isOwner && !isTeamOwner && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        onClick={() =>
                          setTransferId(transferId === m.membershipId ? null : m.membershipId)
                        }>
                        Make owner
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
                          if (!window.confirm(`Remove ${m.email} from ${teamName}?`)) return
                          removeMember.mutate({ teamId, membershipId: m.membershipId })
                        }}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              {transferId === m.membershipId && (
                <div className="border-border bg-muted/40 mt-3 space-y-3 rounded-md border p-3">
                  <p className="text-sm">
                    Transfer ownership of {teamName} to{' '}
                    <span className="font-mono text-xs">{m.email}</span>? They take over the team —
                    and its bill.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={transfer.isPending}
                      onClick={() => transfer.mutate({ teamId, userId: m.userId })}>
                      {transfer.isPending ? 'Transferring…' : 'Transfer ownership'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setTransferId(null)}>
                      Cancel
                    </Button>
                  </div>
                  {transfer.isError && <ErrorLine message={transfer.error.message} />}
                </div>
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

function InvitesTab({
  teamId,
  seatLimit,
  taken,
}: {
  teamId: string
  seatLimit: number
  taken: number
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { copied, copy } = useCopy()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [createdId, setCreatedId] = useState<string | null>(null)

  const invitesQuery = useQuery(trpc.invites.list.queryOptions({ teamId }))
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.invites.list.queryKey({ teamId }) })
    queryClient.invalidateQueries({ queryKey: trpc.teams.get.queryKey({ teamId }) })
  }

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
  const full = taken >= seatLimit

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
                  <RoleChip role={i.role} />
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
                    revoke.mutate({ teamId, inviteId: i.id })
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
            Leave the email blank for a link anyone can use. Invites expire after seven days, and a
            pending one holds a seat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Preempted, not enforced: the server is authoritative on seats and
              says so in its own words when the form is submitted anyway. */}
          {full && (
            <p className="text-muted-foreground mb-4 text-sm">
              All {seatLimit} seats are taken — remove someone or write us for more.
            </p>
          )}
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              const trimmed = email.trim()
              create.mutate({ teamId, role, ...(trimmed ? { email: trimmed } : {}) })
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
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  className={cn(SELECT, 'h-9')}
                  value={role}
                  onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'member')}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create invite'}
              </Button>
            </div>
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
