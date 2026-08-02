// One team, end to end: who's in it, who's been invited, what they've built,
// and the seat limit — the only thing an admin can change here.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import {
  ErrorText,
  Loading,
  PageHeader,
  SectionTitle,
  StatTile,
  StatusChip,
  Td,
  Th,
  fmtBytes,
  fmtDate,
  fmtDuration,
} from './shared'

type MemberRole = 'admin' | 'member'

// Owner is computed from Team.ownerId, never a stored membership role.
const ROLE_SELECT = 'border-input bg-background rounded-md border text-sm'

export function AdminTeamPage() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { teamId = '' } = useParams()

  const team = useQuery(trpc.admin.team.queryOptions({ teamId }))
  // Null until the admin types: the field falls back to whatever the server
  // last said, so a refetch can't fight a value being edited.
  const [seats, setSeats] = useState<string | null>(null)
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState<MemberRole>('member')
  // One row armed at a time, keyed by userId.
  const [arming, setArming] = useState<string | null>(null)

  const setSeatLimit = useMutation(
    trpc.admin.setSeatLimit.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.team.queryKey({ teamId }) })
        queryClient.invalidateQueries({ queryKey: trpc.admin.teams.queryKey() })
      },
    })
  )

  const invalidateMembership = () => {
    queryClient.invalidateQueries({ queryKey: trpc.admin.team.queryKey({ teamId }) })
    queryClient.invalidateQueries({ queryKey: trpc.admin.teams.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.admin.users.queryKey() })
  }

  const add = useMutation(
    trpc.admin.addTeamMember.mutationOptions({
      onSuccess: () => {
        setAddEmail('')
        invalidateMembership()
      },
    })
  )

  const setRole = useMutation(
    trpc.admin.setTeamMemberRole.mutationOptions({ onSuccess: invalidateMembership })
  )

  const remove = useMutation(
    trpc.admin.removeTeamMember.mutationOptions({
      onSuccess: () => {
        setArming(null)
        invalidateMembership()
      },
    })
  )

  const revoke = useMutation(
    trpc.admin.revokeInvite.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.team.queryKey({ teamId }) })
      },
    })
  )

  if (team.isPending) return <Loading />
  if (team.isError) return <ErrorText message={team.error.message} />
  if (!team.data) return <ErrorText message="No such team." />

  const t = team.data
  const seatValue = seats ?? String(t.seatLimit)
  const seatNumber = Number(seatValue)
  const seatsInvalid =
    !Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 500 || seatValue.trim() === ''

  return (
    <div className="space-y-8">
      <PageHeader title={t.name} sub={`${t.slug} · created ${fmtDate(t.createdAt)}`} />

      <p className="text-sm">
        Owned by{' '}
        <Link to={`/admin/users/${t.owner.id}`} className="text-cobalt font-medium hover:underline">
          {t.owner.name}
        </Link>
        <span className="text-muted-foreground"> · {t.owner.email}</span>
      </p>

      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <StatTile label="Members" value={`${t.members.length}/${t.seatLimit}`} />
        <StatTile label="Projects" value={t.projects.length} />
        <StatTile label="Storage" value={fmtBytes(t.bytes)} />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="seat-limit">Seat limit</Label>
            <Input
              id="seat-limit"
              type="number"
              min={1}
              max={500}
              className="w-24"
              value={seatValue}
              onChange={(e) => setSeats(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={setSeatLimit.isPending || seatsInvalid || seatNumber === t.seatLimit}
            onClick={() => setSeatLimit.mutate({ teamId, seatLimit: seatNumber })}>
            Save
          </Button>
        </div>
        {setSeatLimit.isError && <ErrorText message={setSeatLimit.error.message} />}
      </div>

      <section className="space-y-3">
        <SectionTitle>Members</SectionTitle>

        <div className="space-y-2">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              add.mutate({ teamId, email: addEmail, role: addRole })
            }}>
            <Input
              className="w-64"
              type="email"
              required
              placeholder="account@email.com"
              aria-label="Account email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
            />
            <select
              aria-label="Role"
              className={cn(ROLE_SELECT, 'h-9 px-2.5')}
              value={addRole}
              onChange={(e) => setAddRole(e.target.value === 'admin' ? 'admin' : 'member')}>
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
            <Button type="submit" variant="outline" disabled={add.isPending || !addEmail.trim()}>
              Add member
            </Button>
          </form>
          <p className="text-muted-foreground text-xs">
            Adds an existing account directly — no invite email. Seats still apply.
          </p>
          {add.isError && <ErrorText message={add.error.message} />}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th className="w-32">Role</Th>
                <Th className="w-24">Uploads</Th>
                <Th className="w-24">Storage</Th>
                <Th className="w-32">Joined</Th>
                <Th className="w-56" />
              </tr>
            </thead>
            <tbody>
              {t.members.map((m) => (
                <tr key={m.userId}>
                  <Td>
                    <Link
                      to={`/admin/users/${m.userId}`}
                      className="text-cobalt font-medium hover:underline">
                      {m.name}
                    </Link>
                    <p className="text-muted-foreground truncate">{m.email}</p>
                  </Td>
                  <Td>
                    {m.role === 'owner' ? (
                      <span className="bg-cobalt-wash text-cobalt rounded px-1.5 py-0.5 text-xs font-medium">
                        owner
                      </span>
                    ) : (
                      <span className="text-muted-foreground font-mono text-xs">{m.role}</span>
                    )}
                  </Td>
                  <Td className="font-mono">{m.uploads}</Td>
                  <Td className="font-mono">{fmtBytes(m.uploadedBytes)}</Td>
                  <Td className="text-muted-foreground font-mono text-xs">{fmtDate(m.joinedAt)}</Td>
                  <Td>
                    <div className="flex items-center justify-end gap-3">
                      {m.role !== 'owner' && (
                        <>
                          <select
                            aria-label={`Role for ${m.name}`}
                            className={cn(ROLE_SELECT, 'h-7 px-1.5 text-xs')}
                            disabled={setRole.isPending}
                            value={m.role}
                            onChange={(e) =>
                              setRole.mutate({
                                teamId,
                                userId: m.userId,
                                role: e.target.value === 'admin' ? 'admin' : 'member',
                              })
                            }>
                            <option value="member">member</option>
                            <option value="admin">admin</option>
                          </select>
                          {arming === m.userId ? (
                            <span className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground">remove {m.name}?</span>
                              <button
                                type="button"
                                className="text-destructive text-xs font-medium"
                                disabled={remove.isPending}
                                onClick={() => remove.mutate({ teamId, userId: m.userId })}>
                                yes, remove
                              </button>
                              <button
                                type="button"
                                className="text-muted-foreground text-xs"
                                onClick={() => setArming(null)}>
                                keep
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-destructive text-xs"
                              onClick={() => setArming(m.userId)}>
                              remove
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {setRole.isError && <ErrorText message={setRole.error.message} />}
        {remove.isError && <ErrorText message={remove.error.message} />}
      </section>

      {t.invites.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Pending invites</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Email</Th>
                  <Th className="w-32">Role</Th>
                  <Th className="w-32">Created</Th>
                  <Th className="w-32">Expires</Th>
                  <Th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {t.invites.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      {i.email ?? <span className="text-muted-foreground italic">open link</span>}
                    </Td>
                    <Td className="text-muted-foreground font-mono text-xs">{i.role}</Td>
                    <Td className="text-muted-foreground font-mono text-xs">
                      {fmtDate(i.createdAt)}
                    </Td>
                    <Td className="text-muted-foreground font-mono text-xs">
                      {fmtDate(i.expiresAt)}
                    </Td>
                    <Td>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive text-xs"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate({ inviteId: i.id })}>
                        revoke
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {revoke.isError && <ErrorText message={revoke.error.message} />}
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle>Projects</SectionTitle>
        {t.projects.length === 0 ? (
          <p className="text-muted-foreground text-sm">No projects.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th className="w-28">Walkthroughs</Th>
                  <Th className="w-32">Created</Th>
                </tr>
              </thead>
              <tbody>
                {t.projects.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-muted-foreground font-mono text-xs">{p.slug}</p>
                    </Td>
                    <Td className="font-mono">{p.walkthroughs}</Td>
                    <Td className="text-muted-foreground font-mono text-xs">
                      {fmtDate(p.createdAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Latest walkthroughs</SectionTitle>
        {t.walkthroughs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No walkthroughs yet.</p>
        ) : (
          <div className="divide-border/70 divide-y">
            {t.walkthroughs.map((g) => (
              <div key={g.id} className="flex items-center gap-3 py-2">
                <span className="w-20 shrink-0 text-center">
                  <StatusChip status={g.status} />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/walkthroughs/${g.id}`}
                    className="text-cobalt truncate text-sm font-medium hover:underline">
                    {g.title}
                  </Link>
                  <p className="text-muted-foreground truncate font-mono text-xs">
                    {g.slug}
                    {g.projectName && ` · ${g.projectName}`}
                    {g.origin && ` · ${g.origin}`}
                  </p>
                </div>
                <span className="text-muted-foreground w-40 shrink-0 truncate text-xs">
                  {g.uploadedByName ?? 'unknown'}
                </span>
                <span className="text-muted-foreground w-14 shrink-0 text-right font-mono text-xs">
                  {fmtDuration(g.durationMs)}
                </span>
                <span className="text-muted-foreground w-16 shrink-0 text-right font-mono text-xs">
                  {fmtBytes(g.bytes)}
                </span>
                <span className="text-muted-foreground w-28 shrink-0 text-right font-mono text-xs">
                  {fmtDate(g.uploadedAt)}
                </span>
                {/* Declared but never finalized — invisible everywhere else. */}
                <span className="w-20 shrink-0 text-right">
                  {!g.finalized && (
                    <span className="bg-review-wash text-review rounded px-1.5 py-0.5 font-mono text-[10px] uppercase">
                      unfinished
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Danger zone</SectionTitle>
        <p className="text-muted-foreground text-sm">
          Deleting this team removes every walkthrough and project it holds. Members keep their
          accounts and personal spaces.
        </p>
        <DeleteTeam teamId={t.id} name={t.name} />
      </section>
    </div>
  )
}

/** Arms inline, and only fires once the exact team name has been retyped. */
function DeleteTeam({ teamId, name }: { teamId: string; name: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [armed, setArmed] = useState(false)
  const [typed, setTyped] = useState('')

  const del = useMutation(
    trpc.admin.deleteTeam.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.teams.queryKey() })
        navigate('/admin/teams')
      },
    })
  )

  if (!armed) {
    return (
      <Button variant="destructive" onClick={() => setArmed(true)}>
        Delete team…
      </Button>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">
          Type <span className="font-mono">{name}</span> to confirm.
        </p>
        <Input
          className="w-64"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label="Confirm the team name"
        />
        <Button
          variant="destructive"
          disabled={typed !== name || del.isPending}
          onClick={() => del.mutate({ teamId })}>
          Delete team
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setArmed(false)
            setTyped('')
          }}>
          Keep
        </Button>
      </div>
      {del.isError && <ErrorText message={del.error.message} />}
    </div>
  )
}
