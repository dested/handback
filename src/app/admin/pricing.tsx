// The pricing lever bench: edits the DB-saved planning model (admin.pricingModel
// / setPricingModel) and shows, live, what each lever does to the tiers, the
// underwater point, and the at-scale roll-up. All math is client-side in
// pricing-model.ts; this page is levers + read-outs. /admin/costs trends the
// same saved model against measured usage.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import {
  bizEcon,
  freeCostPerActive,
  proEcon,
  scaleEcon,
  verdictFor,
  type PricingModel,
  type TierEcon,
} from '~/lib/pricing-model'
import { ErrorText, Loading, PageHeader, SectionTitle, StatTile, Td, Th, fmtDate } from './shared'

// ---- formatting -------------------------------------------------------------

const money = (n: number) =>
  n === 0 ? '$0' : n < 0.01 ? '<$0.01' : n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`

/** Signed money with a real minus glyph — for margins that can go underwater. */
const signedMoney = (n: number) => (n < 0 ? `−${money(-n)}` : money(n))

const round2 = (n: number) => Math.round(n * 100) / 100
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const pct = (n: number) => `${Math.round(n * 100)}%`

// ---- levers -----------------------------------------------------------------

type LeverKey = keyof PricingModel
type Lever = {
  label: string
  key: LeverKey
  min: number
  max: number
  step: number
  fmt: (v: number) => string
}
type Group = { name: string; levers: Lever[] }

const dollars = (v: number) => `$${v}`
const cents = (v: number) => `$${v.toFixed(2)}`

const GROUPS: Group[] = [
  {
    name: 'Prices',
    levers: [
      { label: 'Pro $/mo', key: 'proPrice', min: 0, max: 200, step: 1, fmt: dollars },
      { label: 'Business $/mo', key: 'bizPrice', min: 0, max: 400, step: 1, fmt: dollars },
    ],
  },
  {
    name: 'Quotas',
    levers: [
      { label: 'Pro hours', key: 'proHours', min: 1, max: 60, step: 1, fmt: (v) => `${v} h` },
      { label: 'Pro walkthroughs', key: 'proCap', min: 10, max: 300, step: 5, fmt: String },
      { label: 'Business hours', key: 'bizHours', min: 5, max: 120, step: 1, fmt: (v) => `${v} h` },
      { label: 'Business walkthroughs', key: 'bizCap', min: 20, max: 600, step: 10, fmt: String },
      { label: 'Assistant turns', key: 'turnQuota', min: 0, max: 400, step: 10, fmt: String },
    ],
  },
  {
    name: 'Behavior',
    levers: [
      { label: 'Avg walkthrough', key: 'avgLen', min: 3, max: 60, step: 1, fmt: (v) => `${v} min` },
      { label: 'Utilization', key: 'util', min: 5, max: 100, step: 5, fmt: (v) => `${v}%` },
      { label: 'Assistant turns used', key: 'turnsUsed', min: 0, max: 200, step: 5, fmt: String },
      { label: 'Refine runs', key: 'rerun', min: 1, max: 2.5, step: 0.05, fmt: (v) => `${round2(v)}×` },
    ],
  },
  {
    name: 'Unit costs',
    levers: [
      { label: 'Refine / walkthrough', key: 'refineCost', min: 0.03, max: 0.6, step: 0.01, fmt: cents },
      { label: 'Media / hour', key: 'mediaCost', min: 0.02, max: 0.5, step: 0.01, fmt: cents },
      { label: 'Assistant / turn', key: 'turnCost', min: 0.02, max: 0.5, step: 0.01, fmt: cents },
    ],
  },
  {
    name: 'Free tier',
    levers: [
      { label: 'Walkthroughs / mo', key: 'freeCap', min: 0, max: 10, step: 1, fmt: String },
      { label: 'Free accounts', key: 'freeUsers', min: 0, max: 10000, step: 100, fmt: String },
      { label: 'Active', key: 'freeActive', min: 0, max: 100, step: 5, fmt: (v) => `${v}%` },
    ],
  },
  {
    name: 'Scale',
    levers: [
      { label: 'Paying users', key: 'users', min: 10, max: 5000, step: 10, fmt: String },
      { label: 'On Business', key: 'bizShare', min: 0, max: 60, step: 5, fmt: (v) => `${v}%` },
      { label: 'Fixed infra', key: 'fixed', min: 0, max: 2000, step: 25, fmt: dollars },
    ],
  },
]

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
        <span className="font-mono text-sm tabular-nums">{display}</span>
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

// ---- tier card --------------------------------------------------------------

const VERDICT_TONE: Record<'good' | 'thin' | 'bad', string> = {
  good: 'text-green-700',
  thin: 'text-foreground',
  bad: 'text-destructive',
}

function TierCard({ name, m, t }: { name: string; m: PricingModel; t: TierEcon }) {
  const hours = name === 'Pro' ? m.proHours : m.bizHours
  const cap = name === 'Pro' ? m.proCap : m.bizCap
  const verdict = verdictFor(t)
  const rows = [
    {
      label: 'Refine',
      exp: t.parts.exp.refine,
      ceil: t.parts.worst.refine,
      basis: `${Math.round(t.expW)} walkthroughs × ${money(m.refineCost)} × ${round2(m.rerun)} runs`,
    },
    {
      label: 'Media',
      exp: t.parts.exp.media,
      ceil: t.parts.worst.media,
      basis: `${num(t.expHours)} h × ${money(m.mediaCost)}`,
    },
    {
      label: 'Assistant',
      exp: t.parts.exp.assist,
      ceil: t.parts.worst.assist,
      basis: `${t.turns} turns × ${money(m.turnCost)}`,
    },
  ]

  return (
    <div className="bg-card border-border rounded border p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">{name}</h3>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          ${t.price}/mo · {hours}h + {cap} walkthroughs
        </span>
      </div>
      <p className={cn('mt-1 text-sm', VERDICT_TONE[verdict.tone])}>{verdict.text}</p>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr>
            <Th>Where the cost is</Th>
            <Th className="w-24 text-right">Expected</Th>
            <Th className="w-24 text-right">Ceiling</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <Td>
                <span className="font-medium">{r.label}</span>
                <span className="text-muted-foreground mt-0.5 block font-mono text-xs tabular-nums">
                  {r.basis}
                </span>
              </Td>
              <Td className="text-right font-mono tabular-nums">{money(r.exp)}</Td>
              <Td className="text-muted-foreground text-right font-mono tabular-nums">
                {money(r.ceil)}
              </Td>
            </tr>
          ))}
          <tr>
            <Td className="font-medium">Total cost</Td>
            <Td className="text-right font-mono font-medium tabular-nums">{money(t.exp)}</Td>
            <Td className="text-muted-foreground text-right font-mono tabular-nums">
              {money(t.worst)}
            </Td>
          </tr>
          <tr>
            <Td className="font-medium">Margin</Td>
            <Td
              className={cn(
                'text-right font-mono tabular-nums',
                t.expMargin < 0 ? 'text-destructive' : 'text-green-700'
              )}>
              {signedMoney(t.expMargin)} · {pct(t.expPct)}
            </Td>
            <Td
              className={cn(
                'text-right font-mono tabular-nums',
                t.worstMargin < 0 ? 'text-destructive' : 'text-green-700'
              )}>
              {signedMoney(t.worstMargin)} · {pct(t.worstPct)}
            </Td>
          </tr>
        </tbody>
      </table>

      <p className="text-muted-foreground mt-3 font-mono text-xs tabular-nums">
        break-even at {Math.floor(t.breakevenW)} walkthroughs / mo
      </p>
    </div>
  )
}

// ---- underwater chart -------------------------------------------------------

function readColor(css: CSSStyleDeclaration, name: string, fallback: string) {
  const v = css.getPropertyValue(name).trim()
  return v || fallback
}

function drawUnderwater(canvas: HTMLCanvasElement, m: PricingModel) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth || 600
  const cssH = 260
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const css = getComputedStyle(document.documentElement)
  const cobalt = readColor(css, '--cobalt', 'oklch(0.485 0.195 262)')
  const destructive = readColor(css, '--destructive', 'oklch(0.577 0.213 27)')
  const border = readColor(css, '--border', 'rgba(0,0,0,0.12)')
  const muted = readColor(css, '--muted-foreground', '#6b7280')

  const padL = 42
  const padR = 16
  const padT = 16
  const padB = 26
  const plotW = cssW - padL - padR
  const plotH = cssH - padT - padB

  const xMin = 2
  const xMax = 60
  const base = m.proHours * m.mediaCost + m.turnQuota * m.turnCost
  const capped = (len: number) =>
    base + Math.min((m.proHours * 60) / len, m.proCap) * m.refineCost * m.rerun
  const uncapped = (len: number) => base + ((m.proHours * 60) / len) * m.refineCost * m.rerun

  const rough = Math.max(uncapped(xMin), m.proPrice, capped(xMin)) * 1.08
  const step = rough <= 25 ? 5 : rough <= 60 ? 10 : 20
  const yMax = Math.max(step, Math.ceil(rough / step) * step)

  const xToPx = (x: number) => padL + ((x - xMin) / (xMax - xMin)) * plotW
  const yToPx = (y: number) => padT + (1 - Math.min(y, yMax) / yMax) * plotH

  ctx.font = '10.5px "IBM Plex Mono", ui-monospace, monospace'

  // $ gridlines + labels
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let v = 0; v <= yMax + 0.001; v += step) {
    const py = yToPx(v)
    ctx.strokeStyle = border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(padL, py)
    ctx.lineTo(cssW - padR, py)
    ctx.stroke()
    ctx.fillStyle = muted
    ctx.fillText(`$${v}`, padL - 6, py)
  }

  // minute ticks
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const t of [5, 10, 15, 30, 45, 60]) {
    if (t < xMin || t > xMax) continue
    ctx.fillStyle = muted
    ctx.fillText(String(t), xToPx(t), cssH - padB + 6)
  }
  ctx.textAlign = 'left'
  ctx.fillStyle = muted
  ctx.fillText('avg clip (min)', padL, cssH - padB + 6 + 12)

  // wash above the price line (the underwater region)
  const pricePy = yToPx(m.proPrice)
  ctx.save()
  ctx.globalAlpha = 0.08
  ctx.fillStyle = destructive
  ctx.fillRect(padL, padT, plotW, Math.max(0, pricePy - padT))
  ctx.restore()

  // price line
  ctx.strokeStyle = destructive
  ctx.setLineDash([5, 4])
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(padL, pricePy)
  ctx.lineTo(cssW - padR, pricePy)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = destructive
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`$${m.proPrice} price`, padL + 4, pricePy - 3)

  const N = 120
  const plot = (f: (len: number) => number) => {
    ctx.beginPath()
    for (let i = 0; i <= N; i++) {
      const x = xMin + ((xMax - xMin) * i) / N
      const px = xToPx(x)
      const py = yToPx(f(x))
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
  }

  // uncapped (dashed) then capped (solid), both cobalt
  ctx.strokeStyle = cobalt
  ctx.setLineDash([4, 3])
  ctx.lineWidth = 1.25
  plot(uncapped)
  ctx.setLineDash([])
  ctx.lineWidth = 2
  plot(capped)

  // marker at the model's avg length
  const cx = xToPx(Math.min(Math.max(m.avgLen, xMin), xMax))
  const cyVal = capped(Math.min(Math.max(m.avgLen, xMin), xMax))
  const cy = yToPx(cyVal)
  ctx.fillStyle = cobalt
  ctx.beginPath()
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2)
  ctx.fill()
  const label = `${m.avgLen} min · ${money(cyVal)}`
  const rightSide = cx < padL + plotW * 0.7
  ctx.textAlign = rightSide ? 'left' : 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(label, cx + (rightSide ? 8 : -8), cy - 6)
}

function UnderwaterChart({ model }: { model: PricingModel }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const modelRef = useRef(model)
  modelRef.current = model
  const key = JSON.stringify(model)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const render = () => drawUnderwater(canvas, modelRef.current)
    render()
    window.addEventListener('resize', render)
    return () => window.removeEventListener('resize', render)
  }, [key])

  return <canvas ref={ref} className="w-full" style={{ height: 260 }} />
}

// ---- page -------------------------------------------------------------------

export function AdminPricingPage() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const query = useQuery(trpc.admin.pricingModel.queryOptions())
  const [draft, setDraft] = useState<PricingModel | null>(null)

  const save = useMutation(
    trpc.admin.setPricingModel.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.admin.pricingModel.queryKey() })
        setDraft(null)
      },
    })
  )

  if (query.isPending) return <Loading />
  if (query.isError) return <ErrorText message={query.error.message} />
  if (!query.data) return <ErrorText message="No pricing model." />

  const saved = query.data.model
  const effective = draft ?? saved
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved)

  const setLever = (key: LeverKey, v: number) => setDraft({ ...effective, [key]: v })

  const pro = proEcon(effective)
  const biz = bizEcon(effective)
  const scale = scaleEcon(effective)
  const perActive = freeCostPerActive(effective)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Pricing model"
        sub="The plan the business is priced on — saved to the database and trended on /admin/costs."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {query.data.savedAt
            ? `saved ${fmtDate(query.data.savedAt)}`
            : 'locked 2026-08-24 defaults — never saved'}
        </span>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Discard
            </Button>
          )}
          <Button
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(effective)}>
            {save.isPending ? 'Saving…' : 'Save model'}
          </Button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Levers */}
        <div className="space-y-6">
          {GROUPS.map((g) => (
            <div key={g.name} className="space-y-3">
              <h3 className="text-muted-foreground border-border border-b pb-1 font-mono text-[11px] font-medium tracking-wide uppercase">
                {g.name}
              </h3>
              <div className="space-y-4">
                {g.levers.map((l) => {
                  const v = effective[l.key]
                  return (
                    <Knob
                      key={l.key}
                      label={l.label}
                      value={v}
                      display={l.fmt(v)}
                      min={l.min}
                      max={l.max}
                      step={l.step}
                      onChange={(nv) => setLever(l.key, nv)}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Read-outs */}
        <div className="space-y-8">
          <div className="grid gap-4 xl:grid-cols-2">
            <TierCard name="Pro" m={effective} t={pro} />
            <TierCard name="Business" m={effective} t={biz} />
          </div>

          <section className="bg-card border-border space-y-3 rounded border p-5">
            <SectionTitle>Where a Pro user takes you underwater</SectionTitle>
            <UnderwaterChart model={effective} />
            <p className="text-muted-foreground text-xs">
              Solid = cost with the {effective.proCap}-walkthrough cap; dashed = uncapped. The wash is
              where a single Pro user costs more than ${effective.proPrice}/mo.
            </p>
          </section>

          <section className="space-y-4">
            <SectionTitle>At scale</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile
                label="MRR"
                value={money(scale.mrr)}
                sub={`${scale.nPro} Pro · ${scale.nBiz} Business`}
              />
              <StatTile
                label="COGS"
                value={money(scale.cogs)}
                sub={`incl ${money(effective.fixed)} fixed`}
              />
              <StatTile
                label="Free tier"
                value={money(scale.freeCost)}
                sub={`${scale.freeActive} active × ${money(perActive)}`}
              />
              <StatTile label="Gross profit" value={signedMoney(scale.gross)} />
              <StatTile label="Gross margin" value={pct(scale.grossMargin)} />
              <StatTile label="Cost / Pro user" value={money(scale.pro.exp)} sub="expected" />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
