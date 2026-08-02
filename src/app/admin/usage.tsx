// Storage and recordings per space, measured against the per-space quota.

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { ErrorText, Loading, PageHeader, Td, Th, fmtBytes, fmtDuration } from './shared'

export function AdminUsagePage() {
  const trpc = useTRPC()
  const usage = useQuery(trpc.admin.usage.queryOptions())

  if (usage.isPending) return <Loading />
  if (usage.isError) return <ErrorText message={usage.error.message} />
  if (!usage.data) return <ErrorText message="No usage data." />

  const { quota, spaces } = usage.data

  return (
    <div className="space-y-8">
      <PageHeader
        title="Usage"
        sub={`Storage and recordings per space — quota is ${fmtBytes(quota.bytes)} and ${quota.walkthroughs} walkthroughs per space.`}
      />

      {spaces.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing uploaded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Space</Th>
                <Th className="w-24">Kind</Th>
                <Th className="w-28">Walkthroughs</Th>
                <Th className="w-24">Recorded</Th>
                <Th className="w-64">Storage</Th>
              </tr>
            </thead>
            <tbody>
              {spaces.map((s) => {
                const pct = Math.min(100, (s.bytes / quota.bytes) * 100)
                return (
                  <tr key={`${s.kind}:${s.id}`}>
                    <Td>
                      <Link
                        to={s.kind === 'team' ? `/admin/teams/${s.id}` : `/admin/users/${s.id}`}
                        className="text-cobalt font-medium hover:underline">
                        {s.name}
                      </Link>
                      <p className="text-muted-foreground truncate text-xs">{s.detail}</p>
                    </Td>
                    <Td className="text-muted-foreground font-mono text-xs">{s.kind}</Td>
                    <Td className="font-mono">
                      {s.walkthroughs} / {quota.walkthroughs}
                    </Td>
                    <Td className="font-mono">{fmtDuration(s.durationMs)}</Td>
                    <Td className="w-64">
                      <div className="flex items-center gap-2">
                        <div className="bg-muted h-1.5 w-32 shrink-0 overflow-hidden rounded-full">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              pct >= 90 ? 'bg-destructive' : 'bg-cobalt'
                            )}
                            style={{ width: `${Math.max(pct, s.bytes > 0 ? 2 : 0)}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs">{fmtBytes(s.bytes)}</span>
                        <span className="text-muted-foreground font-mono text-xs">
                          {pct.toFixed(pct >= 10 ? 0 : 1)}%
                        </span>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
