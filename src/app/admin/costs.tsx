// The cost estimator: what a user actually costs to serve, anchored to live
// usage, and what that means for the pricing tiers. All math is client-side;
// the server only supplies measured anchors (GB per recorded hour, intake).

import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Input } from '~/components/ui/input'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import { ErrorText, Loading, PageHeader, SectionTitle, StatTile, Td, Th, fmtBytes } from './shared'

// ---- pricing constants (editable on the page) -------------------------------

// Defaults are Cloudflare R2 — the live store since the 2026-08-13 cutover.
const DEFAULT_PRICES = {
  /** R2 storage. */
  storagePerGbMonth: 0.015,
  /** R2 egress is free — the reason we migrated. */
  egressPerGb: 0,
  /** Groq whisper-large-v3-turbo, per audio hour. Paid tiers only — free tier is
   *  local-first (on-device transcription), so it never bills this. */
  transcribePerHour: 0.04,
  /** Haiku 4.5 polish pass — ~12k tokens in/out per spoken hour at $1/$5 per MTok.
   *  Paid tiers only — the free tier's one cloud walkthrough + 15 cloud-min/mo cap
   *  keeps its transcribe/polish spend negligible; everything else is local. */
  polishPerHour: 0.07,
  /** R2 Class A writes — an agent-kind hour uploads ~600–2500 keyframe files. */
  requestsPerHour: 0.012,
  /** The ECS task, shared Postgres box, Resend, domains — everything usage-independent. */
  fixedPerMonth: 60,
}

type Prices = typeof DEFAULT_PRICES

/** AWS S3 (us-west-2) — what we migrated OFF 2026-08-13. Kept for comparison. */
const S3_PRICES: Prices = {
  ...DEFAULT_PRICES,
  storagePerGbMonth: 0.023,
  egressPerGb: 0.09, // data transfer out — every presigned GET a viewer played
  requestsPerHour: 0.015, // S3 PUT $5/M vs R2 Class A $4.50/M
}

const RETENTIONS = [
  { days: 7, label: '7d' },
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 180, label: '180d' },
  { days: 365, label: '1y' },
  { days: Infinity, label: 'forever' },
]

// Mirrors src/components/landing/pricing.tsx; retention per tier is the
// proposed ladder (retention is a tier feature — see decisions).
const TIERS = [
  { name: 'Free', price: 0, hours: 1, retentionDays: 30 },
  { name: 'Pro', price: 20, hours: 3, retentionDays: 90 },
  { name: 'Business', price: 40, hours: 10, retentionDays: 365 },
]

// Fallbacks for anchors we can't measure yet (no human-kind uploads, say).
// These reflect the throttled capture rates shipped 2026-08-12: agent kind is
// capped at 1 Mbps ≈ 0.45 GB/hr; human/pristine averages ~5 Mbps ≈ 2.5 GB/hr
// including the retained final (raws expire 14d post-render). Measured anchors
// override these as real post-throttle uploads arrive.
const FALLBACK_GB_PER_HOUR = { agent: 0.45, human: 2.5 }

// ---- math -------------------------------------------------------------------

type Scenario = {
  hoursPerMonth: number
  humanShare: number // 0..1
  retentionDays: number
  viewsPerWalkthrough: number
  agentGbPerHour: number
  humanGbPerHour: number
}

/** Per-user monthly cost, split by driver. Storage for `forever` is reported at month 12. */
function monthlyCost(s: Scenario, p: Prices) {
  const agentHrs = s.hoursPerMonth * (1 - s.humanShare)
  const humanHrs = s.hoursPerMonth * s.humanShare
  const newGb = agentHrs * s.agentGbPerHour + humanHrs * s.humanGbPerHour
  // With expiry after R days a user holds ~R/30 months of intake at steady
  // state. "Forever" has no steady state — cost climbs every month; we report
  // the month-12 bill and flag it.
  const heldGb = s.retentionDays === Infinity ? newGb * 12 : newGb * (s.retentionDays / 30)
  const storage = heldGb * p.storagePerGbMonth
  const egress = newGb * s.viewsPerWalkthrough * p.egressPerGb
  const transcription = s.hoursPerMonth * p.transcribePerHour
  const polish = s.hoursPerMonth * p.polishPerHour
  const requests = s.hoursPerMonth * p.requestsPerHour
  return {
    newGb,
    heldGb,
    storage,
    egress,
    transcription,
    polish,
    requests,
    total: storage + egress + transcription + polish + requests,
  }
}

const money = (n: number) =>
  n === 0 ? '$0' : n < 0.01 ? '<$0.01' : n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`

const gb = (n: number) => (n >= 100 ? `${n.toFixed(0)} GB` : n >= 1 ? `${n.toFixed(1)} GB` : `${(n * 1024).toFixed(0)} MB`)

// ---- controls ---------------------------------------------------------------

function Knob({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </span>
        <span className="font-mono text-sm">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
        style={{ accentColor: 'var(--cobalt)' }}
      />
    </div>
  )
}

function PriceField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
      <Input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-1 font-mono"
      />
    </label>
  )
}

function Row({ label, amount, note }: { label: string; amount: number; note?: ReactNode }) {
  return (
    <tr>
      <Td>{label}</Td>
      <Td className="font-mono">{money(amount)}</Td>
      <Td className="text-muted-foreground text-xs">{note}</Td>
    </tr>
  )
}

// ---- page -------------------------------------------------------------------

export function AdminCostsPage() {
  const trpc = useTRPC()
  const stats = useQuery(trpc.admin.costStats.queryOptions())

  const [prices, setPrices] = useState<Prices>(DEFAULT_PRICES)
  const [users, setUsers] = useState(50)
  const [hours, setHours] = useState(10)
  const [humanPct, setHumanPct] = useState(20)
  const [retention, setRetention] = useState(30)
  const [views, setViews] = useState(2)
  // '' = follow the live anchor; a number = hand override.
  const [gbOverride, setGbOverride] = useState<{ agent: string; human: string }>({
    agent: '',
    human: '',
  })

  if (stats.isPending) return <Loading />
  if (stats.isError) return <ErrorText message={stats.error.message} />
  if (!stats.data) return <ErrorText message="No usage data." />

  const { total, byKind, last30d, files } = stats.data

  const measuredGbPerHour = (kind: 'agent' | 'human') => {
    const row = byKind.find((r) => r.kind === kind)
    if (!row || row.durationMs < 60_000) return null // under a minute measured = noise
    return row.bytes / 1024 ** 3 / (row.durationMs / 3_600_000)
  }
  const anchor = {
    agent: measuredGbPerHour('agent') ?? FALLBACK_GB_PER_HOUR.agent,
    human: measuredGbPerHour('human') ?? FALLBACK_GB_PER_HOUR.human,
  }
  const effectiveGb = {
    agent: gbOverride.agent === '' ? anchor.agent : Number(gbOverride.agent) || anchor.agent,
    human: gbOverride.human === '' ? anchor.human : Number(gbOverride.human) || anchor.human,
  }

  const scenario: Scenario = {
    hoursPerMonth: hours,
    humanShare: humanPct / 100,
    retentionDays: retention,
    viewsPerWalkthrough: views,
    agentGbPerHour: effectiveGb.agent,
    humanGbPerHour: effectiveGb.human,
  }
  const perUser = monthlyCost(scenario, prices)
  const platformTotal = perUser.total * users + prices.fixedPerMonth
  const perUserAllIn = perUser.total + prices.fixedPerMonth / Math.max(1, users)
  const perHour = hours > 0 ? perUser.total / hours : 0

  const totalHours = total.durationMs / 3_600_000
  const forever = retention === Infinity

  return (
    <div className="space-y-10">
      <PageHeader
        title="Costs"
        sub="What a user costs to serve — anchored to measured usage, projected by the sliders. Retention is the lever that keeps storage from compounding forever."
      />

      {/* Live anchors */}
      <section className="space-y-4">
        <SectionTitle>Measured</SectionTitle>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Stored" value={fmtBytes(total.bytes)} sub={`${files} files`} />
          <StatTile
            label="Recorded"
            value={`${totalHours >= 10 ? totalHours.toFixed(0) : totalHours.toFixed(1)} h`}
            sub={`${total.walkthroughs} walkthroughs`}
          />
          <StatTile
            label="Agent GB/hr"
            value={anchor.agent.toFixed(2)}
            sub={measuredGbPerHour('agent') ? 'measured' : 'fallback estimate'}
          />
          <StatTile
            label="Human GB/hr"
            value={anchor.human.toFixed(2)}
            sub={measuredGbPerHour('human') ? 'measured' : 'fallback estimate'}
          />
          <StatTile
            label="30-day intake"
            value={fmtBytes(last30d.bytes)}
            sub={`${last30d.walkthroughs} walkthroughs`}
          />
          <StatTile label="Active uploaders" value={last30d.uploaders} sub="last 30 days" />
        </div>
        <p className="text-muted-foreground text-xs">
          Storage bill today: ~{money((total.bytes / 1024 ** 3) * prices.storagePerGbMonth)}/mo at
          S3 Standard. GB-per-hour anchors feed the projection below; override them once real usage
          diverges.
        </p>
        <p className="text-muted-foreground text-xs">
          Anchors measured before the bitrate throttle overstate GB/hr — expect ~0.45 (agent) / ~2.5
          (human) going forward.
        </p>
      </section>

      {/* Scenario */}
      <section className="space-y-4">
        <SectionTitle>Scenario</SectionTitle>
        <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <Knob
            label="Active users"
            value={users}
            display={String(users)}
            min={1}
            max={2000}
            step={1}
            onChange={setUsers}
          />
          <Knob
            label="Recording hrs / user / mo"
            value={hours}
            display={`${hours} h`}
            min={0}
            max={400}
            step={1}
            onChange={setHours}
          />
          <Knob
            label="Human-handback share"
            value={humanPct}
            display={`${humanPct}%`}
            min={0}
            max={100}
            step={5}
            onChange={setHumanPct}
          />
          <Knob
            label="Views per walkthrough"
            value={views}
            display={`${views}×`}
            min={0}
            max={10}
            step={1}
            onChange={setViews}
          />
          <div>
            <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Retention
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {RETENTIONS.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => setRetention(r.days)}
                  className={cn(
                    'rounded border px-2.5 py-1 font-mono text-xs',
                    retention === r.days
                      ? 'border-cobalt bg-cobalt-wash text-cobalt'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Agent GB/hr
              </span>
              <Input
                type="number"
                step="any"
                placeholder={anchor.agent.toFixed(2)}
                value={gbOverride.agent}
                onChange={(e) => setGbOverride((o) => ({ ...o, agent: e.target.value }))}
                className="mt-1 font-mono"
              />
            </label>
            <label className="block">
              <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Human GB/hr
              </span>
              <Input
                type="number"
                step="any"
                placeholder={anchor.human.toFixed(2)}
                value={gbOverride.human}
                onChange={(e) => setGbOverride((o) => ({ ...o, human: e.target.value }))}
                className="mt-1 font-mono"
              />
            </label>
          </div>
        </div>
      </section>

      {/* Result */}
      <section className="space-y-4">
        <SectionTitle>Cost per user per month</SectionTitle>
        {forever && (
          <p className="text-destructive text-xs">
            No expiry: storage compounds every month with no ceiling. The figure below is the
            month-12 bill — month 24 doubles it. This is why retention is priced.
          </p>
        )}
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Driver</Th>
                  <Th className="w-24">$ / user / mo</Th>
                  <Th>Basis</Th>
                </tr>
              </thead>
              <tbody>
                <Row
                  label="Storage"
                  amount={perUser.storage}
                  note={`${gb(perUser.newGb)} new / mo · ${gb(perUser.heldGb)} held ${forever ? 'by month 12' : 'at steady state'}`}
                />
                <Row
                  label="Egress (views)"
                  amount={perUser.egress}
                  note={`${views}× full download per walkthrough`}
                />
                <Row
                  label="Transcription"
                  amount={perUser.transcription}
                  note={`${hours} h × ${money(prices.transcribePerHour)}/h (Groq)`}
                />
                <Row label="Polish" amount={perUser.polish} note="Haiku cleanup pass" />
                <Row label="S3 requests" amount={perUser.requests} note="keyframe PUTs" />
                <tr>
                  <Td className="font-medium">Total variable</Td>
                  <Td className="font-mono font-medium">{money(perUser.total)}</Td>
                  <Td className="text-muted-foreground text-xs">
                    {money(perHour)} per recorded hour
                  </Td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 content-start gap-6">
            <StatTile
              label="All-in / user"
              value={money(perUserAllIn)}
              sub={`incl. fixed ÷ ${users} users`}
            />
            <StatTile
              label="Platform / mo"
              value={money(platformTotal)}
              sub={`${users} users + ${money(prices.fixedPerMonth)} fixed`}
            />
            <StatTile
              label="Per recorded hour"
              value={money(perHour + (forever ? 0 : 0))}
              sub="variable cost, these settings"
            />
            <StatTile
              label="New storage / mo"
              value={gb(perUser.newGb * users)}
              sub="platform-wide intake"
            />
          </div>
        </div>
      </section>

      {/* Tier margins */}
      <section className="space-y-4">
        <SectionTitle>Tier margins</SectionTitle>
        <p className="text-muted-foreground text-xs">
          Each tier costed at its full hour quota with its own retention window (30d / 90d / 1y —
          the proposed ladder), same mix and views as the scenario. Margin is price minus variable
          cost; fixed costs sit above this table.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Tier</Th>
                <Th className="w-20">Price</Th>
                <Th className="w-24">Quota</Th>
                <Th className="w-24">Retention</Th>
                <Th className="w-28">Cost at quota</Th>
                <Th className="w-24">Margin</Th>
                <Th>Headroom</Th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t) => {
                const cost = monthlyCost(
                  { ...scenario, hoursPerMonth: t.hours, retentionDays: t.retentionDays },
                  prices
                )
                const margin = t.price - cost.total
                const perHr = cost.total / t.hours
                const maxHours = perHr > 0 ? t.price / perHr : Infinity
                return (
                  <tr key={t.name}>
                    <Td className="font-medium">{t.name}</Td>
                    <Td className="font-mono">${t.price}</Td>
                    <Td className="font-mono">{t.hours} h/mo</Td>
                    <Td className="font-mono">{t.retentionDays}d</Td>
                    <Td className="font-mono">{money(cost.total)}</Td>
                    <Td
                      className={cn(
                        'font-mono',
                        margin < 0 ? 'text-destructive' : 'text-approve'
                      )}>
                      {margin < 0 ? `−${money(-margin)}` : money(margin)}
                      {t.price > 0 && (
                        <span className="text-muted-foreground ml-1 text-xs">
                          {Math.round((margin / t.price) * 100)}%
                        </span>
                      )}
                    </Td>
                    <Td className="text-muted-foreground text-xs">
                      {t.price === 0
                        ? `costs ${money(cost.total)} to give away`
                        : `breaks even at ${maxHours >= 1000 ? '1000+' : Math.floor(maxHours)} h/mo`}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Unit prices */}
      <section className="space-y-4">
        <SectionTitle
          right={
            <div className="flex gap-1">
              {(
                [
                  ['R2', DEFAULT_PRICES],
                  ['S3', S3_PRICES],
                ] as const
              ).map(([name, preset]) => {
                const active =
                  prices.storagePerGbMonth === preset.storagePerGbMonth &&
                  prices.egressPerGb === preset.egressPerGb
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setPrices((p) => ({ ...preset, fixedPerMonth: p.fixedPerMonth }))}
                    className={cn(
                      'rounded border px-2.5 py-1 font-mono text-xs',
                      active
                        ? 'border-cobalt bg-cobalt-wash text-cobalt'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}>
                    {name}
                  </button>
                )
              })}
            </div>
          }>
          Unit prices
        </SectionTitle>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <PriceField
            label="S3 $/GB-mo"
            value={prices.storagePerGbMonth}
            onChange={(v) => setPrices((p) => ({ ...p, storagePerGbMonth: v }))}
          />
          <PriceField
            label="Egress $/GB"
            value={prices.egressPerGb}
            onChange={(v) => setPrices((p) => ({ ...p, egressPerGb: v }))}
          />
          <PriceField
            label="Transcribe $/h"
            value={prices.transcribePerHour}
            onChange={(v) => setPrices((p) => ({ ...p, transcribePerHour: v }))}
          />
          <PriceField
            label="Polish $/h"
            value={prices.polishPerHour}
            onChange={(v) => setPrices((p) => ({ ...p, polishPerHour: v }))}
          />
          <PriceField
            label="Requests $/h"
            value={prices.requestsPerHour}
            onChange={(v) => setPrices((p) => ({ ...p, requestsPerHour: v }))}
          />
          <PriceField
            label="Fixed $/mo"
            value={prices.fixedPerMonth}
            onChange={(v) => setPrices((p) => ({ ...p, fixedPerMonth: v }))}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          Defaults: S3 Standard us-west-2 ($0.023/GB-mo, $0.09/GB out), Groq whisper-large-v3-turbo
          ($0.04/audio-hr), Haiku 4.5 polish (~$0.07/spoken-hr at $1/$5 per MTok). Storage and
          egress are the whole story — the AI costs are rounding errors.
        </p>
      </section>
    </div>
  )
}
