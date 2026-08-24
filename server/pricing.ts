// The pricing PLANNING model: a single source of truth for what the pricing
// bench (/admin/pricing edits it, /admin/costs trends against it) reasons over.
// It is NOT enforcement — the numbers that actually gate uploads and cloud
// passes live in server/limits.ts and must be changed there deliberately, never
// synced from here. Persisted as an AdminSetting ('pricing-model') when the
// owner saves; LOCKED_PRICING_MODEL below is the fallback until they do.

import { z } from 'zod'

export const pricingModelSchema = z.object({
  proPrice: z.number().min(0).max(500),
  bizPrice: z.number().min(0).max(1000),
  proHours: z.number().min(1).max(200),
  proCap: z.number().min(1).max(2000),
  bizHours: z.number().min(1).max(400),
  bizCap: z.number().min(1).max(5000),
  turnQuota: z.number().min(0).max(2000),
  avgLen: z.number().min(1).max(240),
  util: z.number().min(0).max(100),
  turnsUsed: z.number().min(0).max(2000),
  rerun: z.number().min(1).max(10),
  refineCost: z.number().min(0).max(5),
  mediaCost: z.number().min(0).max(5),
  turnCost: z.number().min(0).max(5),
  users: z.number().min(0).max(1000000),
  bizShare: z.number().min(0).max(100),
  fixed: z.number().min(0).max(100000),
})

export type PricingModel = z.infer<typeof pricingModelSchema>

/** Locked by the owner on the pricing bench, 2026-08-24. */
export const LOCKED_PRICING_MODEL: PricingModel = {
  proPrice: 29,
  bizPrice: 49,
  proHours: 15,
  proCap: 80,
  bizHours: 30,
  bizCap: 130,
  turnQuota: 30,
  avgLen: 30,
  util: 100,
  turnsUsed: 15,
  rerun: 1.25,
  refineCost: 0.08,
  mediaCost: 0.14,
  turnCost: 0.06,
  users: 2000,
  bizShare: 20,
  fixed: 175,
}
