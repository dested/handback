// Client-side math for the locked pricing model — shared by /admin/pricing (the
// lever bench) and /admin/costs (plan-vs-actual trending). The model VALUES come
// from admin.pricingModel (DB-saved, falling back to the locked defaults in
// server/pricing.ts); this module only computes. Keep the formulas identical to
// the bench artifact: cost = walkthroughs × (refine × rerun) + hours × media +
// turns × turnCost.

import type { PricingModel } from '../../server/pricing'

export type { PricingModel }

export type TierEcon = {
  price: number
  /** Expected-behavior user: utilization applied to the quotas. */
  exp: number
  /** Ceiling user: maxes hours, walkthrough cap, and assistant turns at once. */
  worst: number
  parts: {
    exp: { refine: number; media: number; assist: number }
    worst: { refine: number; media: number; assist: number }
  }
  expW: number
  expHours: number
  turns: number
  expMargin: number
  worstMargin: number
  expPct: number
  worstPct: number
  /** Walkthroughs/mo at which this price stops covering one user. */
  breakevenW: number
}

/** Walkthroughs one recorded hour yields at the model's average clip length. */
export function walkthroughsPerHour(m: PricingModel): number {
  return 60 / m.avgLen
}

export function tierEcon(m: PricingModel, hours: number, cap: number, price: number): TierEcon {
  const u = m.util / 100
  const expHours = hours * u
  const expW = Math.min(expHours * walkthroughsPerHour(m), cap * u)
  const turns = Math.min(m.turnsUsed, m.turnQuota)
  const refineEach = m.refineCost * m.rerun
  const parts = {
    exp: { refine: expW * refineEach, media: expHours * m.mediaCost, assist: turns * m.turnCost },
    worst: {
      refine: cap * refineEach,
      media: hours * m.mediaCost,
      assist: m.turnQuota * m.turnCost,
    },
  }
  const exp = parts.exp.refine + parts.exp.media + parts.exp.assist
  const worst = parts.worst.refine + parts.worst.media + parts.worst.assist
  return {
    price,
    exp,
    worst,
    parts,
    expW,
    expHours,
    turns,
    expMargin: price - exp,
    worstMargin: price - worst,
    expPct: price > 0 ? (price - exp) / price : 0,
    worstPct: price > 0 ? (price - worst) / price : 0,
    breakevenW: Math.max(0, (price - hours * m.mediaCost - m.turnQuota * m.turnCost) / refineEach),
  }
}

export const proEcon = (m: PricingModel) => tierEcon(m, m.proHours, m.proCap, m.proPrice)
export const bizEcon = (m: PricingModel) => tierEcon(m, m.bizHours, m.bizCap, m.bizPrice)

export type Verdict = { text: string; tone: 'good' | 'thin' | 'bad' }

export function verdictFor(t: TierEcon): Verdict {
  if (t.expMargin <= 0) return { text: 'loss leader — the expected user loses money.', tone: 'bad' }
  if (t.worstMargin < 0)
    return { text: 'underwater if maxed — carried only by low utilization.', tone: 'bad' }
  if (t.worstPct >= 0.35) return { text: 'carries with room, even at the ceiling.', tone: 'good' }
  if (t.worstPct >= 0.1) return { text: 'carries; thin at the ceiling.', tone: 'thin' }
  return { text: 'barely clears the ceiling — one assumption from a loss.', tone: 'thin' }
}

/** What one ACTIVE free account burns in a month: refine on its full walkthrough
 *  allowance plus that allowance's share of media hours. */
export function freeCostPerActive(m: PricingModel): number {
  return m.freeCap * m.refineCost * m.rerun + ((m.freeCap * m.avgLen) / 60) * m.mediaCost
}

/** At-scale roll-up for the model's user count / tier mix / free tier / fixed costs. */
export function scaleEcon(m: PricingModel) {
  const pro = proEcon(m)
  const biz = bizEcon(m)
  const nBiz = Math.round((m.users * m.bizShare) / 100)
  const nPro = m.users - nBiz
  const freeActive = Math.round((m.freeUsers * m.freeActive) / 100)
  const freeCost = freeActive * freeCostPerActive(m)
  const mrr = nPro * m.proPrice + nBiz * m.bizPrice
  const cogs = nPro * pro.exp + nBiz * biz.exp + freeCost + m.fixed
  const gross = mrr - cogs
  return {
    pro,
    biz,
    nPro,
    nBiz,
    freeActive,
    freeCost,
    mrr,
    cogs,
    gross,
    grossMargin: mrr > 0 ? gross / mrr : 0,
  }
}
