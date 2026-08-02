// The platform-wide feed: every walkthrough uploaded anywhere, newest first.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import {
  ErrorText,
  Loading,
  PageHeader,
  StatusChip,
  Td,
  Th,
  fmtBytes,
  fmtDate,
  fmtDuration,
} from './shared'

type StatusFilter = 'open' | 'in_review' | 'resolved' | null

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: null, label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_review', label: 'In review' },
  { value: 'resolved', label: 'Resolved' },
]

export function AdminWalkthroughsPage() {
  const trpc = useTRPC()
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [status, setStatus] = useState<StatusFilter>(null)

  const walkthroughs = useQuery(trpc.admin.walkthroughs.queryOptions({ query: submitted, status }))

  return (
    <div className="space-y-8">
      <PageHeader title="Walkthroughs" sub="The platform-wide feed — latest 100." />

      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex max-w-md flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(query.trim())
          }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, slug, or origin"
            aria-label="Search walkthroughs"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const active = status === f.value
            return (
              <button
                key={f.label}
                type="button"
                aria-pressed={active}
                onClick={() => setStatus(f.value)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-cobalt-wash text-cobalt border-transparent'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}>
                {f.label}
              </button>
            )
          })}
        </div>
      </div>

      <section className="space-y-3">
        {walkthroughs.isPending && <Loading />}
        {walkthroughs.isError && <ErrorText message={walkthroughs.error.message} />}
        {walkthroughs.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">No walkthroughs match.</p>
        )}

        {walkthroughs.data && walkthroughs.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th className="w-24">Status</Th>
                  <Th>Walkthrough</Th>
                  <Th className="w-40">Space</Th>
                  <Th className="w-32">Project</Th>
                  <Th className="w-36">Uploaded by</Th>
                  <Th className="w-20">Length</Th>
                  <Th className="w-20">Size</Th>
                  <Th className="w-32">Date</Th>
                  <Th className="w-32" />
                </tr>
              </thead>
              <tbody>
                {walkthroughs.data.map((g) => (
                  <tr key={g.id}>
                    <Td>
                      <StatusChip status={g.status} />
                    </Td>
                    <Td>
                      <Link
                        to={`/walkthroughs/${g.id}`}
                        className="text-cobalt font-medium hover:underline">
                        {g.title}
                      </Link>
                      <p className="text-muted-foreground truncate font-mono text-xs">{g.slug}</p>
                    </Td>
                    <Td>
                      {g.teamId ? (
                        <Link
                          to={`/admin/teams/${g.teamId}`}
                          className="text-cobalt hover:underline">
                          {g.space}
                        </Link>
                      ) : (
                        g.space
                      )}
                    </Td>
                    <Td className="text-muted-foreground">{g.projectName ?? '—'}</Td>
                    <Td className="text-muted-foreground truncate">
                      {g.uploadedByName ?? 'unknown'}
                    </Td>
                    <Td className="text-muted-foreground font-mono text-xs">
                      {fmtDuration(g.durationMs)}
                    </Td>
                    <Td className="text-muted-foreground font-mono text-xs">{fmtBytes(g.bytes)}</Td>
                    <Td className="text-muted-foreground font-mono text-xs">
                      {fmtDate(g.uploadedAt)}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-2">
                        {/* Declared but never finalized — invisible everywhere else. */}
                        {!g.finalized && (
                          <span className="bg-review-wash text-review rounded px-1.5 py-0.5 font-mono text-[10px] uppercase">
                            unfinished
                          </span>
                        )}
                        <Link
                          to={`/admin/walkthroughs/${g.id}`}
                          className="text-cobalt text-xs whitespace-nowrap">
                          debug →
                        </Link>
                      </div>
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
