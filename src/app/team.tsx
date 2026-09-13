// Every team this account belongs to, one card each: who's in it, who's been
// invited, and who owns it. There is no "current team" — space is an attribute,
// not a mode — so the page iterates `teams.mine` and lets you open the one you
// came for. Creating a team lives here too (it used to hang off the header's
// space switcher). API tokens live on /connect — they belong to the account.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouteLoaderData } from 'react-router-dom'
import { Check, ChevronRight, Copy } from 'lucide-react'
import { Avatar } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { PageHeader } from '~/components/ui/page-header'
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

const ROLE_SELECT = cn(
  'border-input bg-card text-foreground h-8 rounded-md border px-2.5 text-[13px]',
  'outline-none focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-2'
)

const TH = 'text-muted-foreground border-border border-b px-3 py-1.5 text-left text-xs font-medium'

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
        className="border-input bg-card h-8 min-w-0 flex-1 rounded-md border px-2.5 font-mono text-xs"
      />
      <Button type="button" variant="outline" size="sm" onClick={() => void copy('f', value)}>
        {copied ? <Check /> : <Copy />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

function Loading() {
  return <p className="text-muted-foreground text-[13px]">Loading…</p>
}

function ErrorLine({ message }: { message: string }) {
  return <p className="text-destructive text-[13px]">{message}</p>
}

type TeamRow = { id: string; name: string; role: string }

export function TeamPage() {
  const trpc = useTRPC()
  const teamsQuery = useQuery(trpc.teams.mine.queryOptions())
  const entitlements = useQuery(trpc.teams.entitlements.queryOptions())
  const [creating, setCreating] = useState(false)
  // Which cards are open. The first team is open by default and every other is
  // folded; an entry here is a deliberate override of that.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})

  const teams: TeamRow[] = teamsQuery.data ?? []
  const owned = teams.filter((t) => t.role === 'owner').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams"
        meta={`${teams.length} ${teams.length === 1 ? 'team' : 'teams'} · you own ${owned}`}
        className="px-0"
        actions={
          // No affordance until the answer is in — flashing the mailto fallback
          // at an entitled user reads as "you can't" for a beat.
          entitlements.isPending ? null : entitlements.data?.canCreateTeams ? (
            <Button type="button" onClick={() => setCreating((c) => !c)}>
              {creating ? 'Cancel' : 'New team'}
            </Button>
          ) : (
            <a href={MAILTO} className="text-cobalt text-[13px] font-medium hover:underline">
              Create a team — write us
            </a>
          )
        }
      />

      {creating && (
        <NewTeamCard
          onClose={() => setCreating(false)}
          onCreated={(id) => setOpenOverrides((o) => ({ ...o, [id]: true }))}
        />
      )}

      {teamsQuery.isPending && <Loading />}
      {teamsQuery.isError && <ErrorLine message={teamsQuery.error.message} />}

      {teamsQuery.isSuccess && teams.length === 0 && (
        <div className="bg-card border-border rounded-lg border p-5">
          <p className="text-muted-foreground max-w-xl text-[13px] leading-relaxed">
            You're not in a team yet. A team is how other people see your walkthroughs and review
            them — it holds a roster, a seat count, and its own projects. Teams are per-seat, and
            whoever creates one holds the bill.
          </p>
        </div>
      )}

      {teams.map((team, i) => (
        <TeamCard
          key={team.id}
          team={team}
          open={openOverrides[team.id] ?? i === 0}
          onToggle={() => setOpenOverrides((o) => ({ ...o, [team.id]: !(o[team.id] ?? i === 0) }))}
        />
      ))}

      {/* The doorbell's mute. Only worth showing to someone a team can email —
          personal-space uploads never notify anyone. */}
      {teams.length > 0 && <NotifyToggle />}

      <p className="text-muted-foreground text-[13px]">
        Your personal space needs no roster — walkthroughs you upload without a team are yours
        alone.
      </p>
    </div>
  )
}

/**
 * The account-level email switches: the "teammate added a walkthrough" mail and
 * the Monday digest. The unsubscribe link in each mail flips its switch off;
 * this is where they come back on. Optimistic — a checkbox moves on click and
 * snaps back if the write fails.
 */
function NotifyToggle() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const prefs = useQuery(trpc.prefs.get.queryOptions())
  const setPrefs = useMutation(
    trpc.prefs.set.mutationOptions({
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.prefs.get.queryKey() }),
    })
  )
  const uploads = setPrefs.isPending
    ? (setPrefs.variables?.notifyUploads ?? prefs.data?.notifyUploads ?? true)
    : (prefs.data?.notifyUploads ?? true)
  const digest = setPrefs.isPending
    ? (setPrefs.variables?.notifyDigest ?? prefs.data?.notifyDigest ?? true)
    : (prefs.data?.notifyDigest ?? true)

  return (
    <section className="bg-card border-border space-y-4 rounded-lg border p-5">
      <h2 className="text-base font-semibold">Notifications</h2>
      <label className="flex max-w-xl items-start gap-2.5 text-[13px]">
        <input
          type="checkbox"
          checked={uploads}
          disabled={prefs.isPending}
          onChange={(e) => setPrefs.mutate({ notifyUploads: e.currentTarget.checked })}
          className="accent-cobalt mt-0.5"
        />
        <span>
          Email me when a teammate adds a walkthrough
          <span className="text-muted-foreground block text-xs leading-relaxed">
            One mail per upload, to your teams only — never for your own uploads. Every mail carries
            a one-click stop link.
          </span>
        </span>
      </label>
      <label className="flex max-w-xl items-start gap-2.5 text-[13px]">
        <input
          type="checkbox"
          checked={digest}
          disabled={prefs.isPending}
          onChange={(e) => setPrefs.mutate({ notifyDigest: e.currentTarget.checked })}
          className="accent-cobalt mt-0.5"
        />
        <span>
          Send me the Monday digest
          <span className="text-muted-foreground block text-xs leading-relaxed">
            One mail a week: what's open across your spaces, what's aging, what got resolved. Skipped
            entirely when there's nothing to say.
          </span>
        </span>
      </label>
    </section>
  )
}

/**
 * One team, folded behind its own header. The roster and the invite list are
 * admin surfaces — the server refuses them to everyone else, so they don't
 * render rather than erroring on open.
 */
function TeamCard({
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
  // Nothing is fetched for a folded team; opening one is what asks.
  const teamQuery = useQuery({ ...trpc.teams.get.queryOptions({ teamId: team.id }), enabled: open })
  const detail = teamQuery.data

  return (
    <section className="bg-card border-border rounded-lg border">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 items-center gap-2 text-left">
          <ChevronRight
            className={cn(
              'text-muted-foreground size-4 shrink-0 transition-transform',
              open && 'rotate-90'
            )}
          />
          <span className="truncate text-base font-semibold">{team.name}</span>
          <RoleChip role={team.role} />
        </button>
        {detail && (
          <span className="text-muted-foreground text-[13px]">
            {detail.memberCount + detail.pendingInvites} of {detail.seatLimit} seats
          </span>
        )}
        <span className="flex-1" />
        {canManage && detail && <RenameTeam teamId={team.id} name={detail.name} />}
      </div>

      {open && (
        <div className="border-border space-y-8 border-t p-4">
          {teamQuery.isError ? (
            <ErrorLine message={teamQuery.error.message} />
          ) : !detail ? (
            <Loading />
          ) : !canManage ? (
            <p className="text-muted-foreground max-w-xl text-[13px]">
              The roster is the owner's side of the house — members and invites are managed by this
              team's owner and admins.
            </p>
          ) : (
            <>
              <MembersTable
                teamId={team.id}
                teamName={detail.name}
                isOwner={team.role === 'owner'}
              />
              <InvitesTable
                teamId={team.id}
                seatLimit={detail.seatLimit}
                taken={detail.memberCount + detail.pendingInvites}
              />
            </>
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
        // The card heading reads its name off the team list, not off `get`.
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
        onClick={() => {
          setValue(name)
          setEditing(true)
        }}>
        Rename
      </Button>
    )
  }

  return (
    <div className="space-y-1">
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
          className="h-8 w-52"
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

function MembersTable({
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
  // Ownership moves the bill as well as the controls, so it arms into a sentence
  // that says so rather than firing off a hover.
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
        // The caller just demoted themselves — their own role in the card heading
        // is now stale.
        queryClient.invalidateQueries({ queryKey: trpc.teams.mine.queryKey() })
        setTransferId(null)
      },
    })
  )

  if (membersQuery.isPending) return <Loading />
  if (membersQuery.isError) return <ErrorLine message={membersQuery.error.message} />

  return (
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold">Members</h3>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={TH}>Member</th>
            <th className={TH}>Role</th>
            <th className={TH}>Joined</th>
            <th className={cn(TH, 'text-right')} />
          </tr>
        </thead>
        <tbody>
          {membersQuery.data.map((m) => {
            const isTeamOwner = m.role === 'owner'
            const showRoleSelect = isOwner && !isTeamOwner
            const showRemove = !isTeamOwner && m.userId !== myUserId
            return (
              <tr key={m.membershipId} className="border-border/60 border-b align-top">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={m.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.name}</p>
                      <p className="text-muted-foreground truncate">{m.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {showRoleSelect ? (
                    <select
                      aria-label={`Role for ${m.email}`}
                      className={ROLE_SELECT}
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
                </td>
                <td className="text-muted-foreground px-3 py-2.5 font-mono text-xs tabular-nums">
                  {fmtDate(m.joinedAt)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex justify-end gap-1">
                    {isOwner && !isTeamOwner && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
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
                  {transferId === m.membershipId && (
                    <div className="mt-2 space-y-3 text-left">
                      <p>
                        Transfer ownership of {teamName} to{' '}
                        <span className="font-mono text-xs">{m.email}</span>? They take over the
                        team — and its bill.
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
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {setRole.isError && <ErrorLine message={setRole.error.message} />}
      {removeMember.isError && <ErrorLine message={removeMember.error.message} />}
    </div>
  )
}

function InvitesTable({
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
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold">Invites</h3>

      {invitesQuery.isPending && <Loading />}
      {invitesQuery.isError && <ErrorLine message={invitesQuery.error.message} />}
      {invitesQuery.data?.length === 0 && (
        <p className="text-muted-foreground text-[13px]">No open invites.</p>
      )}
      {invitesQuery.data && invitesQuery.data.length > 0 && (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Invitee</th>
              <th className={TH}>Role</th>
              <th className={TH}>Expires</th>
              <th className={cn(TH, 'text-right')} />
            </tr>
          </thead>
          <tbody>
            {invitesQuery.data.map((i) => (
              <tr key={i.id} className="border-border/60 border-b">
                <td className="px-3 py-2.5">
                  {i.email ?? (
                    <span className="text-muted-foreground italic">Anyone with the link</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <RoleChip role={i.role} />
                </td>
                <td className="text-muted-foreground px-3 py-2.5 font-mono text-xs tabular-nums">
                  {fmtDate(i.expiresAt)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex justify-end gap-1">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {revoke.isError && <ErrorLine message={revoke.error.message} />}

      <div className="bg-secondary border-border mt-2 space-y-4 rounded-lg border p-4">
        <p className="text-muted-foreground text-[13px]">
          Leave the email blank for a link anyone can use. Invites expire after seven days, and a
          pending one holds a seat.
        </p>
        {/* Preempted, not enforced: the server is authoritative on seats and says
            so in its own words when the form is submitted anyway. */}
        {full && (
          <p className="text-muted-foreground text-[13px]">
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
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor={`invite-email-${teamId}`} className="text-muted-foreground text-xs">
                Email (optional)
              </Label>
              <Input
                id={`invite-email-${teamId}`}
                type="email"
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`invite-role-${teamId}`} className="text-muted-foreground text-xs">
                Role
              </Label>
              <select
                id={`invite-role-${teamId}`}
                className={ROLE_SELECT}
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
              <p className="text-muted-foreground text-[13px]">Send them this link:</p>
              <CopyField value={linkFor(createdId)} />
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

/**
 * Creating a team, moved here from the header's space switcher. It no longer
 * switches anything on success — it just opens the new team's card.
 */
function NewTeamCard({
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

  return (
    <form
      className="bg-card border-border max-w-md space-y-4 rounded-lg border p-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!trimmed || create.isPending) return
        create.mutate({ name: trimmed })
      }}>
      <div className="space-y-1.5">
        <Label htmlFor="new-team-name" className="text-muted-foreground text-xs">
          Team name
        </Label>
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
      {create.isError && <ErrorLine message={create.error.message} />}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={create.isPending || !trimmed}>
          {create.isPending ? 'Creating…' : 'Create'}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
