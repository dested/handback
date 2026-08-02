// Every account on this Handback, with the two switches that matter — the paid
// `team` feature and admin rights themselves.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouteLoaderData } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import type { RootLoaderData } from '../routes'
import { ErrorText, Loading, PageHeader, Td, Th, fmtDate } from './shared'

export function AdminUsersPage() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const root = useRouteLoaderData('root') as RootLoaderData | undefined
  const myUserId = root?.session?.user.id ?? null

  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')

  const users = useQuery(trpc.admin.users.queryOptions({ query: submitted }))

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.admin.users.queryKey() })
  }
  const setFeature = useMutation(trpc.admin.setFeature.mutationOptions({ onSuccess: invalidate }))
  const setAdmin = useMutation(trpc.admin.setAdmin.mutationOptions({ onSuccess: invalidate }))

  return (
    <div className="space-y-8">
      <PageHeader title="Users" sub="Every account on this Handback." />

      <form
        className="flex max-w-md items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(query.trim())
        }}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by email or name"
          aria-label="Search users"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <section className="space-y-3">
        {users.isPending && <Loading />}
        {users.isError && <ErrorText message={users.error.message} />}
        {users.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">No users found.</p>
        )}

        {users.data && users.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th className="w-28">Joined</Th>
                  <Th className="w-64">Teams</Th>
                  <Th className="w-24">Team</Th>
                  <Th className="w-24">Admin</Th>
                  <Th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => {
                  const teamOn = u.features.includes('team')
                  return (
                    <tr key={u.id}>
                      <Td>
                        <p className="truncate font-medium">
                          <Link
                            to={`/admin/users/${u.id}`}
                            className="text-cobalt font-medium hover:underline">
                            {u.name}
                          </Link>
                          {u.id === myUserId && (
                            <span className="text-muted-foreground font-normal"> · you</span>
                          )}
                        </p>
                        <p className="text-muted-foreground truncate">
                          {u.email}
                          {!u.emailVerified && ' · unverified'}
                        </p>
                      </Td>
                      <Td className="text-muted-foreground font-mono text-xs">
                        {fmtDate(u.createdAt)}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {u.teams.length === 0 ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : (
                            u.teams.map((t, i) => (
                              <span
                                key={i}
                                className="border-border text-muted-foreground rounded border px-1.5 py-0.5 text-xs">
                                {t.name} · {t.role}
                              </span>
                            ))
                          )}
                        </div>
                      </Td>
                      <Td>
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
                            onClick={() =>
                              setFeature.mutate({ userId: u.id, feature: 'team', enabled: !teamOn })
                            }
                            className={cn(
                              'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                              teamOn
                                ? 'bg-cobalt-wash text-cobalt'
                                : 'bg-muted text-muted-foreground hover:text-foreground'
                            )}>
                            {teamOn ? 'team on' : 'team off'}
                          </button>
                        )}
                      </Td>
                      <Td>
                        {u.id === myUserId ? (
                          <span className="bg-cobalt-wash text-cobalt rounded px-2 py-0.5 text-xs font-medium">
                            admin on
                          </span>
                        ) : (
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
                        )}
                      </Td>
                      <Td>
                        <Link to={`/admin/users/${u.id}`} className="text-cobalt text-xs">
                          open →
                        </Link>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {setFeature.isError && <ErrorText message={setFeature.error.message} />}
        {setAdmin.isError && <ErrorText message={setAdmin.error.message} />}
      </section>
    </div>
  )
}
