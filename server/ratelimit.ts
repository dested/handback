// A small fixed-window rate limiter for the token-authed ingest routes.
//
// In memory on purpose: the service runs as a single ECS task, so one process
// sees every request and a shared store would be ceremony without benefit. If
// this ever scales to two tasks the limits become per-task — which halves their
// strictness but doesn't break anything. Swap in Redis then, not before.
//
// better-auth handles its own limits for /api/auth/* (see auth.ts); this covers
// everything an API token can reach.

import type { NextFunction, Request, RequestHandler, Response } from 'express'

export interface LimitRule {
  /** Window length in seconds. */
  window: number
  /** Requests allowed per key per window. */
  max: number
}

interface Bucket {
  count: number
  /** Epoch ms when this window ends and the count resets. */
  resetAt: number
}

const buckets = new Map<string, Bucket>()

// Buckets are tiny but unbounded in principle, so sweep expired ones whenever
// the map gets big. O(n) at a threshold beats a timer that keeps the loop alive.
const SWEEP_THRESHOLD = 5_000

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

/**
 * Consume one unit for `key`. Returns the seconds to wait when refused, or
 * `null` when the request is allowed.
 */
function consume(key: string, rule: LimitRule, now: number): number | null {
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.window * 1000 })
    if (buckets.size > SWEEP_THRESHOLD) sweep(now)
    return null
  }
  if (bucket.count >= rule.max) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  }
  bucket.count += 1
  return null
}

/**
 * Rate-limit middleware. `name` namespaces the bucket so two routes sharing a
 * key (the API token) don't spend each other's budget; `keyOf` extracts the
 * identity to meter, and returning null skips the limit entirely.
 */
export function rateLimit(
  name: string,
  rule: LimitRule,
  keyOf: (req: Request) => string | null
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = keyOf(req)
    if (id === null) {
      next()
      return
    }
    const retryAfter = consume(`${name}:${id}`, rule, Date.now())
    if (retryAfter === null) {
      next()
      return
    }
    res.setHeader('Retry-After', String(retryAfter))
    res.status(429).json({
      error: `Too many requests. Try again in ${retryAfter}s.`,
    })
  }
}

/** Test seam: drop every window. Never called in production code. */
export function resetRateLimits(): void {
  buckets.clear()
}
