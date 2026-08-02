// Every team on this Handback: seats in use, what they've built, what they store.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { useTRPC } from '~/lib/trpc'
import { ErrorText, Loading, PageHeader, Td, Th, fmtBytes, fmtDate } from './shared'

export function AdminTeamsPage() {
  const trpc = useTRPC()
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')

  const teams = useQuery(trpc.admin.teams.queryOptions({ query: submitted }))

  return (
    <div className="space-y-8">
      <PageHeader title="Teams" sub="Every team on this Handback." />

      <form
        className="flex max-w-md items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(query.trim())
        }}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by team, slug, or owner email"
          aria-label="Search teams"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <section className="space-y-3">
        {teams.isPending && <Loading />}
        {teams.isError && <ErrorText message={teams.error.message} />}
        {teams.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">No teams found.</p>
        )}

        {teams.data && teams.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Team</Th>
                  <Th>Owner</Th>
                  <Th className="w-24">Seats</Th>
                  <Th className="w-24">Projects</Th>
                  <Th className="w-28">Walkthroughs</Th>
                  <Th className="w-24">Storage</Th>
                  <Th className="w-32">Created</Th>
                </tr>
              </thead>
              <tbody>
                {teams.data.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <Link
                        to={`/admin/teams/${t.id}`}
                        className="text-cobalt font-medium hover:underline">
                        {t.name}
                      </Link>
                      <p className="text-muted-foreground font-mono text-xs">{t.slug}</p>
                    </Td>
                    <Td>
                      <p>{t.owner.name}</p>
                      <p className="text-muted-foreground truncate">{t.owner.email}</p>
                    </Td>
                    <Td>
                      <span className="font-mono">
                        {t.members}/{t.seatLimit}
                      </span>
                      {t.pendingInvites > 0 && (
                        <p className="text-muted-foreground text-xs">+{t.pendingInvites} pending</p>
                      )}
                    </Td>
                    <Td className="font-mono">{t.projects}</Td>
                    <Td className="font-mono">{t.walkthroughs}</Td>
                    <Td className="font-mono">{fmtBytes(t.bytes)}</Td>
                    <Td className="text-muted-foreground font-mono text-xs">
                      {fmtDate(t.createdAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
