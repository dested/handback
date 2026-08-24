// The account's own usage page (/usage): storage per space with a fill meter,
// the two cloud budgets, the live-token count, and anything auto-deleting soon.
// Read-only — every number comes from `usage.mine`, which reserves nothing.

import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { SectionHead } from '~/components/viewer/section-head'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

const GB = 1024 * 1024 * 1024

const TIER_META: Record<'admin' | 'pro' | 'free', string> = {
  admin: 'platform admin · unmetered',
  pro: 'pro plan · resets monthly',
  free: 'free plan',
}

/** A hairline-ruled row: a label on the left, the value flush right. */
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="rule flex items-baseline justify-between gap-4 py-3">
      <span className="min-w-0 text-sm">{label}</span>
      <span className="shrink-0">{children}</span>
    </div>
  )
}

export function UsagePage() {
  const trpc = useTRPC()
  const usage = useQuery(trpc.usage.mine.queryOptions())

  if (usage.isPending) return <p className="text-muted-foreground text-sm">Loading…</p>
  if (usage.isError) return <p className="text-destructive text-sm">{usage.error.message}</p>

  const data = usage.data
  const { cloud, tokens } = data

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-semibold">Usage</h1>
        <p className="text-muted-foreground font-mono text-xs">{TIER_META[data.tier]}</p>
      </header>

      <section className="space-y-2">
        <SectionHead>storage</SectionHead>
        <div>
          {data.spaces.map((s) => {
            const pct = Math.min(100, (s.bytes / s.quotaBytes) * 100)
            return (
              <div key={s.teamId ?? 'personal'} className="rule py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 truncate text-sm font-medium">{s.name}</span>
                  <span className="text-muted-foreground shrink-0 font-mono text-xs">
                    {(s.bytes / GB).toFixed(1)} GB of {Math.round(s.quotaBytes / GB)} GB ·{' '}
                    {s.walkthroughs} of {s.maxWalkthroughs}
                  </span>
                </div>
                <div className="bg-border mt-2 h-1 w-full overflow-hidden rounded-full">
                  <div
                    className={cn('h-full', pct > 90 ? 'bg-destructive' : 'bg-primary')}
                    style={{ width: `${pct.toFixed(1)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-2">
        <SectionHead>cloud passes</SectionHead>
        <div>
          <Row label="walkthroughs">
            <span className="text-muted-foreground font-mono text-xs">
              {cloud.walkthroughsRemaining === null || cloud.walkthroughsLimit === null
                ? 'unmetered'
                : `${cloud.walkthroughsRemaining} of ${cloud.walkthroughsLimit} left this month`}
            </span>
          </Row>
          <Row label="transcription">
            <span className="text-muted-foreground font-mono text-xs">
              {cloud.transcribeRemainingSeconds === null
                ? 'unmetered'
                : `${Math.round(cloud.transcribeRemainingSeconds / 60)}m left this month`}
            </span>
          </Row>
          <Row label="transcript polish">
            {cloud.polishAllowed ? (
              <span className="text-muted-foreground font-mono text-xs">included</span>
            ) : data.tier === 'free' ? (
              <Link to="/upgrade" className="text-cobalt font-mono text-xs hover:underline">
                Pro only
              </Link>
            ) : (
              <span className="text-muted-foreground font-mono text-xs">Pro only</span>
            )}
          </Row>
          <Row label="assistant">
            {cloud.assistantTurnsRemaining === null ? (
              <span className="text-muted-foreground font-mono text-xs">unmetered</span>
            ) : cloud.assistantTurnsLimit !== null && cloud.assistantTurnsLimit > 0 ? (
              <span className="text-muted-foreground font-mono text-xs">
                {cloud.assistantTurnsRemaining} of {cloud.assistantTurnsLimit} turns left this month
              </span>
            ) : data.tier === 'free' ? (
              <Link to="/upgrade" className="text-cobalt font-mono text-xs hover:underline">
                Pro only
              </Link>
            ) : (
              <span className="text-muted-foreground font-mono text-xs">Pro only</span>
            )}
          </Row>
        </div>
      </section>

      <section className="space-y-2">
        <SectionHead>api tokens</SectionHead>
        <Row label="tokens">
          <span className="flex items-baseline gap-3">
            <span className="text-muted-foreground font-mono text-xs">
              {tokens.active} of {tokens.max} active
            </span>
            <Link to="/connect" className="text-muted-foreground text-xs hover:underline">
              manage on /connect
            </Link>
          </span>
        </Row>
      </section>

      {data.expiring.length > 0 && (
        <section className="space-y-2">
          <SectionHead>expiring soon</SectionHead>
          <div>
            {data.expiring.map((w) => {
              const days = Math.ceil((new Date(w.expiresAt).getTime() - Date.now()) / 86400000)
              return (
                <Link
                  key={w.id}
                  to={`/walkthroughs/${w.id}`}
                  className="rule hover:bg-accent/40 flex items-baseline justify-between gap-4 py-3">
                  <span className="min-w-0 truncate text-sm">{w.title}</span>
                  <span className="text-muted-foreground shrink-0 font-mono text-xs">
                    expires in {days}d
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
