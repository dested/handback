// The account's own usage page (/usage): storage per space with a fill meter,
// the two cloud budgets, the live-token count, and anything auto-deleting soon.
// Read-only — every number comes from `usage.mine`, which reserves nothing.

import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PageHeader } from '~/components/ui/page-header'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

const GB = 1024 * 1024 * 1024

const TIER_META: Record<'admin' | 'biz' | 'pro' | 'free', string> = {
  admin: 'Platform admin · unmetered',
  biz: 'Business plan · resets monthly',
  pro: 'Pro plan · resets monthly',
  free: 'Free plan',
}

/** A bordered card with a section title — the page's one container shape. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-card border-border rounded-lg border p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

/** One metered line: a label, the value flush right, and an optional fill bar. */
function Meter({ label, right, pct }: { label: ReactNode; right: ReactNode; pct?: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="min-w-0 truncate text-[13px]">{label}</span>
        <span className="text-muted-foreground shrink-0 font-mono text-xs">{right}</span>
      </div>
      {pct !== undefined && (
        <div className="bg-border h-1 w-full overflow-hidden rounded-full">
          <div
            className={cn('h-full rounded-full', pct >= 90 ? 'bg-destructive' : 'bg-cobalt')}
            style={{ width: `${pct.toFixed(1)}%` }}
          />
        </div>
      )}
    </div>
  )
}

export function UsagePage() {
  const trpc = useTRPC()
  const usage = useQuery(trpc.usage.mine.queryOptions())

  if (usage.isPending) return <p className="text-muted-foreground text-[13px]">Loading…</p>
  if (usage.isError) return <p className="text-destructive text-[13px]">{usage.error.message}</p>

  const data = usage.data
  const { cloud, tokens } = data

  return (
    <div className="space-y-8">
      <PageHeader title="Usage" meta={TIER_META[data.tier]} className="px-0" />

      <Section title="Storage">
        {data.spaces.map((s) => (
          <Meter
            key={s.teamId ?? 'personal'}
            label={<span className="font-medium">{s.name}</span>}
            right={
              <>
                {(s.bytes / GB).toFixed(1)} GB of {Math.round(s.quotaBytes / GB)} GB · {s.walkthroughs}{' '}
                of {s.maxWalkthroughs}
              </>
            }
            pct={Math.min(100, (s.bytes / s.quotaBytes) * 100)}
          />
        ))}
      </Section>

      <Section title="Cloud passes">
        <Meter
          label="Walkthroughs"
          right={
            cloud.walkthroughsRemaining === null || cloud.walkthroughsLimit === null
              ? 'unmetered'
              : `${cloud.walkthroughsRemaining} of ${cloud.walkthroughsLimit} left this month`
          }
        />
        <Meter
          label="Transcription"
          right={
            cloud.transcribeRemainingSeconds === null
              ? 'unmetered'
              : `${Math.round(cloud.transcribeRemainingSeconds / 60)}m left this month`
          }
        />
        <Meter
          label="Transcript polish"
          right={
            cloud.polishAllowed ? (
              'included'
            ) : data.tier === 'free' ? (
              <Link to="/upgrade" className="text-cobalt hover:underline">
                Pro only
              </Link>
            ) : (
              'Pro only'
            )
          }
        />
        <Meter
          label="Assistant"
          right={
            cloud.assistantTurnsRemaining === null ? (
              'unmetered'
            ) : cloud.assistantTurnsLimit !== null && cloud.assistantTurnsLimit > 0 ? (
              `${cloud.assistantTurnsRemaining} of ${cloud.assistantTurnsLimit} turns left this month`
            ) : data.tier === 'free' ? (
              <Link to="/upgrade" className="text-cobalt hover:underline">
                Pro only
              </Link>
            ) : (
              'Pro only'
            )
          }
        />
      </Section>

      <Section title="API tokens">
        <Meter
          label="Tokens"
          right={
            <span className="flex items-baseline gap-3">
              <span>
                {tokens.active} of {tokens.max} active
              </span>
              <Link to="/connect" className="text-muted-foreground hover:underline">
                manage on /connect
              </Link>
            </span>
          }
        />
      </Section>

      {data.expiring.length > 0 && (
        <Section title="Expiring soon">
          {data.expiring.map((w) => {
            const days = Math.ceil((new Date(w.expiresAt).getTime() - Date.now()) / 86400000)
            return (
              <Link
                key={w.id}
                to={`/walkthroughs/${w.id}`}
                className="hover:bg-secondary -mx-2 flex items-baseline justify-between gap-4 rounded-md px-2 py-1.5">
                <span className="min-w-0 truncate text-[13px]">{w.title}</span>
                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                  expires in {days}d
                </span>
              </Link>
            )
          })}
        </Section>
      )}
    </div>
  )
}
