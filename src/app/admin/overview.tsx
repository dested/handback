// The admin front page: platform-wide counts, then the two most recent things
// that happened — accounts and walkthroughs.

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTRPC } from '~/lib/trpc'
import {
  ErrorText,
  Loading,
  PageHeader,
  SectionTitle,
  StatTile,
  StatusChip,
  fmtBytes,
  fmtDate,
} from './shared'

export function AdminOverviewPage() {
  const trpc = useTRPC()
  const overview = useQuery(trpc.admin.overview.queryOptions())

  return (
    <div className="space-y-8">
      <PageHeader title="Overview" sub="Everything on this Handback." />

      {overview.isPending && <Loading />}
      {overview.isError && <ErrorText message={overview.error.message} />}

      {overview.data && (
        <>
          <div className="flex flex-wrap gap-3">
            <StatTile label="Users" value={overview.data.counts.users} />
            <StatTile label="Teams" value={overview.data.counts.teams} />
            <StatTile label="Projects" value={overview.data.counts.projects} />
            <StatTile label="Walkthroughs" value={overview.data.counts.walkthroughs} />
            <StatTile label="Storage" value={fmtBytes(overview.data.counts.bytes)} />
          </div>

          <div className="flex flex-wrap gap-3">
            <StatTile
              label="Open"
              value={<span className="text-cobalt">{overview.data.counts.open}</span>}
            />
            <StatTile
              label="In review"
              value={<span className="text-review">{overview.data.counts.inReview}</span>}
            />
            <StatTile
              label="Resolved"
              value={<span className="text-approve">{overview.data.counts.resolved}</span>}
            />
          </div>

          <div className="grid gap-10 lg:grid-cols-2">
            <section className="space-y-3">
              <SectionTitle>Latest accounts</SectionTitle>
              {overview.data.recentUsers.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nothing yet.</p>
              ) : (
                <ul className="divide-border divide-y">
                  {overview.data.recentUsers.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 py-2.5">
                      <Link
                        to={`/admin/users/${u.id}`}
                        className="text-cobalt text-sm font-medium hover:underline">
                        {u.name}
                      </Link>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                        {u.email}
                      </span>
                      {u.isAdmin && (
                        <span className="bg-cobalt-wash text-cobalt rounded px-1.5 py-0.5 text-xs">
                          admin
                        </span>
                      )}
                      <span className="text-muted-foreground shrink-0 font-mono text-xs">
                        {fmtDate(u.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle>Latest walkthroughs</SectionTitle>
              {overview.data.recentWalkthroughs.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nothing yet.</p>
              ) : (
                <ul className="divide-border divide-y">
                  {overview.data.recentWalkthroughs.map((g) => (
                    <li key={g.id} className="flex items-center gap-3 py-2.5">
                      <StatusChip status={g.status} />
                      <Link
                        to={`/walkthroughs/${g.id}`}
                        className="text-cobalt min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                        {g.title}
                      </Link>
                      <span className="text-muted-foreground shrink-0 truncate text-xs">
                        {g.space}
                      </span>
                      <span className="text-muted-foreground shrink-0 font-mono text-xs">
                        {fmtDate(g.uploadedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
