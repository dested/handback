// Platform admin: every account on this Handback, with the two switches that
// matter — the paid `team` feature and admin rights themselves.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouteLoaderData } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
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

function fmtBytes(n: number) {
  const gb = n / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`
}

export function AdminPage() {
  const trpc = useTRPC()
  const status = useQuery(trpc.admin.status.queryOptions())
  if (status.isPending) return <p className="text-muted-foreground text-sm">Loading…</p>
  if (!status.data?.isAdmin)
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Admins only</CardTitle>
          <CardDescription>This page is for platform admins.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/app" className="text-primary text-sm underline underline-offset-4">
            Back to the inbox
          </Link>
        </CardContent>
      </Card>
    )
  return <AdminBody />
}

function AdminBody() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const root = useRouteLoaderData('root') as { session: Session | null } | undefined
  const myUserId = root?.session?.user.id ?? null

  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')

  const stats = useQuery(trpc.admin.stats.queryOptions())
  const users = useQuery(trpc.admin.users.queryOptions({ query: submitted }))

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.admin.users.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.admin.stats.queryKey() })
  }
  const setFeature = useMutation(trpc.admin.setFeature.mutationOptions({ onSuccess: invalidate }))
  const setAdmin = useMutation(trpc.admin.setAdmin.mutationOptions({ onSuccess: invalidate }))

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Admin</h1>
        <p className="text-muted-foreground text-sm">Every account on this Handback.</p>
      </header>

      {stats.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}
      {stats.isError && <p className="text-destructive text-sm">{stats.error.message}</p>}
      {stats.data && (
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <p className="font-mono text-2xl">{stats.data.users}</p>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Users
            </p>
          </div>
          <div>
            <p className="font-mono text-2xl">{stats.data.orgs}</p>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Workspaces
            </p>
          </div>
          <div>
            <p className="font-mono text-2xl">{stats.data.gripes}</p>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Gripes
            </p>
          </div>
          <div>
            <p className="font-mono text-2xl">{fmtBytes(stats.data.bytes)}</p>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Storage
            </p>
          </div>
        </div>
      )}

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
        {users.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}
        {users.isError && <p className="text-destructive text-sm">{users.error.message}</p>}
        {users.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">No users found.</p>
        )}
        {users.data && users.data.length > 0 && (
          <>
            <div className="border-border text-muted-foreground flex items-center gap-4 border-b pb-2 text-xs font-medium tracking-wide uppercase">
              <span className="min-w-0 flex-1">Member</span>
              <span className="w-28 shrink-0">Joined</span>
              <span className="w-64 shrink-0">Workspaces</span>
              <span className="w-24 shrink-0">Team</span>
              <span className="w-24 shrink-0">Admin</span>
            </div>
            <div className="divide-border divide-y">
              {users.data.map((u) => {
                const teamOn = u.features.includes('team')
                return (
                  <div key={u.id} className="flex items-center gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {u.name}
                        {u.id === myUserId && (
                          <span className="text-muted-foreground font-normal"> · you</span>
                        )}
                      </p>
                      <p className="text-muted-foreground truncate text-sm">
                        {u.email}
                        {!u.emailVerified && ' · unverified'}
                      </p>
                    </div>
                    <span className="text-muted-foreground w-28 shrink-0 font-mono text-xs">
                      {fmtDate(u.createdAt)}
                    </span>
                    <div className="flex w-64 shrink-0 flex-wrap gap-1">
                      {u.orgs.length === 0 ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        u.orgs.map((o, i) => (
                          <span
                            key={i}
                            className="border-border text-muted-foreground rounded border px-1.5 py-0.5 text-xs">
                            {o.name} · {o.role}
                          </span>
                        ))
                      )}
                    </div>
                    <div className="w-24 shrink-0">
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
                    </div>
                    <div className="w-24 shrink-0">
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
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
        {setFeature.isError && (
          <p className="text-destructive text-sm">{setFeature.error.message}</p>
        )}
        {setAdmin.isError && <p className="text-destructive text-sm">{setAdmin.error.message}</p>}
      </section>
    </div>
  )
}
