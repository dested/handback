// One account, end to end: its switches, its teams, its API tokens, and every
// walkthrough it can see.
//
// Reading a space they aren't in works because platform admins bypass
// membership on the read side (`requireViewAccess`) — the viewer opens
// read-only, with no status, project, move or delete controls.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useRouteLoaderData } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import type { RootLoaderData } from '../routes'
import {
  ErrorText,
  Loading,
  PageHeader,
  STATUS_CLASS,
  SectionTitle,
  StatTile,
  Td,
  Th,
  fmtBytes,
  fmtDate,
  fmtDuration,
} from './shared'

export function AdminUserPage() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { userId = '' } = useParams()
  const root = useRouteLoaderData('root') as RootLoaderData | undefined

  const user = useQuery(trpc.admin.user.queryOptions({ userId }))

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.admin.user.queryKey({ userId }) })
    queryClient.invalidateQueries({ queryKey: trpc.admin.users.queryKey() })
  }
  const setFeature = useMutation(trpc.admin.setFeature.mutationOptions({ onSuccess: invalidate }))
  const setAdmin = useMutation(trpc.admin.setAdmin.mutationOptions({ onSuccess: invalidate }))

  if (user.isPending) return <Loading />
  if (user.isError) return <ErrorText message={user.error.message} />
  if (!user.data) return <ErrorText message="No such user." />

  const u = user.data
  const teamOn = u.features.includes('team')

  return (
    <div className="space-y-8">
      <PageHeader title={u.name} sub={u.email} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          joined {fmtDate(u.createdAt)}
        </span>
        {!u.emailVerified && (
          <span className="bg-review-wash text-review rounded px-1.5 py-0.5 text-xs">
            unverified
          </span>
        )}
        {u.isAdmin && (
          <span className="bg-cobalt-wash text-cobalt rounded px-1.5 py-0.5 text-xs">admin</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {u.isAdmin ? (
          // Admins have every feature implicitly — no toggle to lie with.
          <span className="bg-cobalt-wash text-cobalt rounded px-2 py-0.5 text-xs font-medium">
            team on
          </span>
        ) : (
          <button
            type="button"
            aria-pressed={teamOn}
            disabled={setFeature.isPending}
            onClick={() => setFeature.mutate({ userId: u.id, feature: 'team', enabled: !teamOn })}
            className={cn(
              'rounded px-2 py-0.5 text-xs font-medium transition-colors',
              teamOn
                ? 'bg-cobalt-wash text-cobalt'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            )}>
            {teamOn ? 'team on' : 'team off'}
          </button>
        )}
        <button
          type="button"
          aria-pressed={u.isAdmin}
          disabled={setAdmin.isPending}
          onClick={() => setAdmin.mutate({ userId: u.id, isAdmin: !u.isAdmin })}
          className={cn(
            'rounded px-2 py-0.5 text-xs font-medium transition-colors',
            u.isAdmin
              ? 'bg-cobalt-wash text-cobalt'
              : 'bg-muted text-muted-foreground hover:text-foreground'
          )}>
          {u.isAdmin ? 'admin on' : 'admin off'}
        </button>
        {setFeature.isError && <ErrorText message={setFeature.error.message} />}
        {setAdmin.isError && <ErrorText message={setAdmin.error.message} />}
      </div>

      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <StatTile label="Uploads" value={u.counts.uploads} />
        <StatTile label="Personal walkthroughs" value={u.counts.personalWalkthroughs} />
        <StatTile label="Personal storage" value={fmtBytes(u.counts.personalBytes)} />
      </div>

      <section className="space-y-3">
        <SectionTitle>Teams</SectionTitle>
        {u.teams.length === 0 ? (
          <p className="text-muted-foreground text-sm">No teams.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th className="w-32">Role</Th>
                  <Th className="w-28">Their uploads</Th>
                  <Th className="w-24">Storage</Th>
                  <Th className="w-32">Joined</Th>
                </tr>
              </thead>
              <tbody>
                {u.teams.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <Link
                        to={`/admin/teams/${t.id}`}
                        className="text-cobalt font-medium hover:underline">
                        {t.name}
                      </Link>
                    </Td>
                    <Td className="text-muted-foreground font-mono text-xs">{t.role}</Td>
                    <Td className="font-mono">{t.uploads}</Td>
                    <Td className="font-mono">{fmtBytes(t.uploadedBytes)}</Td>
                    <Td className="text-muted-foreground font-mono text-xs">
                      {fmtDate(t.joinedAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>API tokens</SectionTitle>
        {u.tokens.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tokens.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th className="w-28">Token</Th>
                  <Th className="w-32">Created</Th>
                  <Th className="w-32">Last used</Th>
                  <Th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {u.tokens.map((t) => (
                  <tr key={t.id}>
                    <Td>{t.name}</Td>
                    <Td className="text-muted-foreground font-mono text-xs">…{t.lastFour}</Td>
                    <Td className="text-muted-foreground font-mono text-xs">
                      {fmtDate(t.createdAt)}
                    </Td>
                    <Td className="text-muted-foreground font-mono text-xs">
                      {fmtDate(t.lastUsedAt)}
                    </Td>
                    <Td>
                      {t.revokedAt ? (
                        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                          revoked
                        </span>
                      ) : (
                        <span className="bg-approve-wash text-approve rounded px-1.5 py-0.5 text-xs">
                          active
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Walkthroughs</SectionTitle>
        <UserWalkthroughs userId={userId} />
      </section>

      <section className="space-y-3">
        <SectionTitle>Danger zone</SectionTitle>
        <p className="text-muted-foreground text-sm">
          Deleting this account removes their personal space — every personal walkthrough, project,
          token and session. Teams keep everything that was uploaded to them.
        </p>
        {root?.session?.user.id === u.id ? (
          <p className="text-muted-foreground text-sm">
            This is you — you cannot delete your own account.
          </p>
        ) : (
          <DeleteAccount userId={u.id} email={u.email} />
        )}
      </section>
    </div>
  )
}

/** Arms inline, and only fires once the exact address has been retyped. */
function DeleteAccount({ userId, email }: { userId: string; email: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [armed, setArmed] = useState(false)
  const [typed, setTyped] = useState('')

  const del = useMutation(
    trpc.admin.deleteUser.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.users.queryKey() })
        navigate('/admin/users')
      },
    })
  )

  if (!armed) {
    return (
      <Button variant="destructive" onClick={() => setArmed(true)}>
        Delete account…
      </Button>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">
          Type <span className="font-mono">{email}</span> to confirm.
        </p>
        <Input
          className="w-64"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label="Confirm the account email"
        />
        <Button
          variant="destructive"
          disabled={typed !== email || del.isPending}
          onClick={() => del.mutate({ userId })}>
          Delete account
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

/** Everything one account can see, space by space — personal first, then teams. */
function UserWalkthroughs({ userId }: { userId: string }) {
  const trpc = useTRPC()
  const groups = useQuery(trpc.admin.userWalkthroughs.queryOptions({ userId }))

  if (groups.isPending) return <Loading />
  if (groups.isError) return <ErrorText message={groups.error.message} />
  if (!groups.data || groups.data.length === 0)
    return <p className="text-muted-foreground text-sm">No teams.</p>

  return (
    <div className="space-y-5">
      {groups.data.map((group) => (
        <div key={group.space.teamId ?? 'personal'} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-sm font-medium">{group.space.name}</p>
            <span className="text-muted-foreground font-mono text-xs">{group.role}</span>
            <span className="text-muted-foreground ml-auto font-mono text-xs">
              {group.walkthroughs.length}{' '}
              {group.walkthroughs.length === 1 ? 'walkthrough' : 'walkthroughs'}
            </span>
          </div>

          {group.walkthroughs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No walkthroughs yet.</p>
          ) : (
            <div className="divide-border/70 divide-y">
              {group.walkthroughs.map((g) => (
                <div key={g.id} className="flex items-center gap-3 py-2">
                  <span
                    className={cn(
                      'w-20 shrink-0 rounded px-2 py-0.5 text-center text-xs font-medium',
                      STATUS_CLASS[g.status] ?? 'bg-muted text-muted-foreground'
                    )}>
                    {g.status === 'in_review' ? 'in review' : g.status}
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
                    {g.uploadedByThem ? 'uploaded by them' : `by ${g.uploadedByName ?? 'unknown'}`}
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
        </div>
      ))}
    </div>
  )
}
