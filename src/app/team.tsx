// Every team this account belongs to, one section each: who's in it, who's been
// invited, and who owns it. There is no "current team" — space is an attribute,
// not a mode — so the page iterates `teams.mine` and lets you open the one you
// came for. Creating a team lives here too (it used to hang off the header's
// space switcher). API tokens live on /connect — they belong to the account.

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouteLoaderData } from 'react-router-dom'
import { Check, ChevronRight, Copy } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
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

const MAILTO = 'mailto:sal@dested.com?subject=Handback%20teams'

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

/** Your standing in a team, stated once beside its name and never shouted. */
function RoleTag({ role }: { role: string }) {
  return (
    <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
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

/** A mono uppercase head over a hairline — the page's only section chrome. */
function SectionHead({ children }: { children: string }) {
  return (
    <>
      <h3 className="text-muted-foreground font-mono text-xs tracking-[0.14em] uppercase">
        {children}
      </h3>
      <div className="rule mt-2" />
    </>
  )
}

type Tab = 'members' | 'invites'

type TeamRow = { id: string; name: string; role: string }

export function TeamPage() {
  const trpc = useTRPC()
  const teamsQuery = useQuery(trpc.teams.mine.queryOptions())
  const entitlements = useQuery(trpc.teams.entitlements.queryOptions())
  const [creating, setCreating] = useState(false)
  // Which sections are open. The first team is open by default and every other
  // is folded; an entry here is a deliberate override of that.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})

  const teams: TeamRow[] = teamsQuery.data ?? []
  const owned = teams.filter((t) => t.role === 'owner').length

  return (
    <div className="max-w-4xl space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="font-display text-4xl font-semibold tracking-tight">Teams</h1>
          <p className="text-muted-foreground font-mono text-xs">
            {teams.length} {teams.length === 1 ? 'team' : 'teams'} · you own {owned}
          </p>
        </div>
        {/* No affordance until the answer is in — flashing the mailto fallback
            at an entitled user reads as "you can't" for a beat. */}
        {entitlements.isPending ? null : entitlements.data?.canCreateTeams ? (
          <Button type="button" onClick={() => setCreating(true)}>
            New team…
          </Button>
        ) : (
          <a href={MAILTO} className="text-cobalt text-sm font-medium hover:underline">
            Create a team — write us
          </a>
        )}
      </header>

      {teamsQuery.isPending && <Loading />}
      {teamsQuery.isError && <ErrorLine message={teamsQuery.error.message} />}

      {teamsQuery.isSuccess && teams.length === 0 && (
        <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
          You're not in a team yet. A team is how other people see your walkthroughs and review them
          — it holds a roster, a seat count, and its own projects. Teams are per-seat, and whoever
          creates one holds the bill.
        </p>
      )}

      {teams.map((team, i) => (
        <TeamSection
          key={team.id}
          team={team}
          open={openOverrides[team.id] ?? i === 0}
          onToggle={() => setOpenOverrides((o) => ({ ...o, [team.id]: !(o[team.id] ?? i === 0) }))}
        />
      ))}

      {/* The doorbell's mute. Only worth showing to someone a team can email —
          personal-space uploads never notify anyone. */}
      {teams.length > 0 && <NotifyToggle />}

      <p className="text-muted-foreground text-sm">
        Your personal space needs no roster — walkthroughs you upload without a team are yours
        alone.
      </p>

      {creating && (
        <NewTeamModal
          onClose={() => setCreating(false)}
          onCreated={(id) => setOpenOverrides((o) => ({ ...o, [id]: true }))}
        />
      )}
    </div>
  )
}

/**
 * The one account-level switch on this page: the "teammate added a walkthrough"
 * email. The unsubscribe link in the mail itself flips it off; this is where it
 * comes back on. Optimistic — the checkbox moves on click and snaps back if the
 * write fails.
 */
function NotifyToggle() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const prefs = useQuery(trpc.prefs.get.queryOptions())
  const setNotify = useMutation(
    trpc.prefs.setNotifyUploads.mutationOptions({
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.prefs.get.queryKey() }),
    })
  )
  const enabled = setNotify.isPending
    ? (setNotify.variables?.enabled ?? true)
    : (prefs.data?.notifyUploads ?? true)

  return (
    <section className="space-y-3">
      <SectionHead>notifications</SectionHead>
      <label className="flex max-w-xl items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={prefs.isPending}
          onChange={(e) => setNotify.mutate({ enabled: e.currentTarget.checked })}
          className="accent-cobalt mt-0.5"
        />
        <span>
          Email me when a teammate adds a walkthrough
          <span className="text-muted-foreground block text-xs leading-relaxed">
            One mail per upload, to your teams only — never for your own uploads. Every mail
            carries a one-click stop link.
          </span>
        </span>
      </label>
    </section>
  )
}

/**
 * One team, folded behind its own name. The roster and the invite list are
 * admin surfaces — the server refuses them to everyone else, so the tabs don't
 * exist rather than erroring on open.
 */
function TeamSection({
  team,
  open,
  onToggle,
}: {
  team: TeamRow
  open: boolean
  onToggle: () => void
}) {
  const trpc = useTRPC()
  const canManage = team.role === 'owner' || team.role === 'admin'
  const [tab, setTab] = useState<Tab>('members')
  // Nothing is fetched for a folded team; opening one is what asks.
  const teamQuery = useQuery({ ...trpc.teams.get.queryOptions({ teamId: team.id }), enabled: open })
  const detail = teamQuery.data

  const tabs: Array<[Tab, string]> = canManage
    ? [
        ['members', 'Members'],
        ['invites', 'Invites'],
      ]
    : []

  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 py-2 text-left">
        <ChevronRight
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform',
            open && 'rotate-90'
          )}
        />
        <span className="font-display truncate text-xl font-semibold">{team.name}</span>
        <RoleTag role={team.role} />
      </button>
      <div className="rule" />

      {open && (
        <div className="space-y-8 pt-4 pl-7">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {teamQuery.isError ? (
              <ErrorLine message={teamQuery.error.message} />
            ) : !detail ? (
              <Loading />
            ) : (
              <p className="text-muted-foreground font-mono text-xs">
                {detail.memberCount + detail.pendingInvites} of {detail.seatLimit} seats
              </p>
            )}
            {canManage && detail && <RenameTeam teamId={team.id} name={detail.name} />}
          </div>

          {/* A full member can see the team but doesn't run it. */}
          {!canManage && (
            <p className="text-muted-foreground max-w-xl text-sm">
              The roster is the owner's side of the house — members and invites are managed by this
              team's owner and admins.
            </p>
          )}

          {tabs.length > 0 && (
            <div className="flex items-center gap-5">
              {tabs.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={cn(
                    'border-b-2 pb-1 font-mono text-xs tracking-[0.14em] uppercase transition-colors',
                    tab === value
                      ? 'border-cobalt text-foreground'
                      : 'text-muted-foreground hover:text-foreground border-transparent'
                  )}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {canManage && detail && tab === 'members' && (
            <MembersTab teamId={team.id} teamName={detail.name} isOwner={team.role === 'owner'} />
          )}
          {canManage && detail && tab === 'invites' && (
            <InvitesTab
              teamId={team.id}
              seatLimit={detail.seatLimit}
              taken={detail.memberCount + detail.pendingInvites}
            />
          )}
        </div>
      )}
    </section>
  )
}

/** The team's display name, renamed in place by owners and admins. */
function RenameTeam({ teamId, name }: { teamId: string; name: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)

  const rename = useMutation(
    trpc.teams.rename.mutationOptions({
      onSuccess: () => {
        // The section heading reads its name off the team list, not off `get`.
        queryClient.invalidateQueries({ queryKey: trpc.teams.mine.queryKey() })
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => {
          setValue(name)
          setEditing(true)
        }}>
        Rename
      </Button>
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={rename.isPending || stale}
          onClick={save}>
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

  const setRole = useMutation(trpc.teams.setRole.mutationOptions({ onSuccess: invalidate }))
  const removeMember = useMutation(
    trpc.teams.removeMember.mutationOptions({ onSuccess: invalidate })
  )
  const transfer = useMutation(
    trpc.teams.transferOwnership.mutationOptions({
      onSuccess: () => {
        invalidate()
        // The caller just demoted themselves — their own role in the section
        // heading is now stale.
        queryClient.invalidateQueries({ queryKey: trpc.teams.mine.queryKey() })
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
                <div className="mt-3 max-w-xl space-y-3">
                  <p className="text-sm">
                    Transfer ownership of {teamName} to{' '}
                    <span className="font-mono text-xs">{m.email}</span>? They take over the team —
                    and its bill.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
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

      <section className="max-w-xl">
        <SectionHead>Invite someone</SectionHead>
        <div className="space-y-4 pt-4">
          <p className="text-muted-foreground text-sm">
            Leave the email blank for a link anyone can use. Invites expire after seven days, and a
            pending one holds a seat.
          </p>
          {/* Preempted, not enforced: the server is authoritative on seats and
              says so in its own words when the form is submitted anyway. */}
          {full && (
            <p className="text-muted-foreground text-sm">
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
                <Label htmlFor={`invite-email-${teamId}`}>Email (optional)</Label>
                <Input
                  id={`invite-email-${teamId}`}
                  type="email"
                  placeholder="teammate@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`invite-role-${teamId}`}>Role</Label>
                <select
                  id={`invite-role-${teamId}`}
                  className={cn(SELECT, 'h-9')}
                  value={role}
                  onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'member')}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <Button type="submit" variant="outline" disabled={create.isPending}>
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
        </div>
      </section>
    </div>
  )
}

/**
 * Creating a team, moved here from the header's space switcher. It no longer
 * switches anything on success — it just opens the new team's section.
 */
function NewTeamModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (teamId: string) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  const create = useMutation(
    trpc.teams.create.mutationOptions({
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: trpc.teams.mine.queryKey() })
        onCreated(result.id)
        onClose()
      },
    })
  )

  const trimmed = name.trim()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New team"
        className="bg-card border-border w-80 rounded-xl border p-6 shadow-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!trimmed || create.isPending) return
            create.mutate({ name: trimmed })
          }}>
          <div className="space-y-2">
            <Label htmlFor="new-team-name">Team name</Label>
            <Input
              id="new-team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Design"
              maxLength={80}
              autoFocus
              required
            />
          </div>
          {create.isError && <p className="text-destructive text-sm">{create.error.message}</p>}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={create.isPending || !trimmed}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
