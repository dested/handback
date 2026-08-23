// Self-hosted error alerting. No Sentry, no new service — a prod failure emails
// the owner over the same Resend sender the transactional mail uses. One ECS
// task serves everything, so this is deliberately in-memory and single-process,
// the same assumption ratelimit.ts and the retention sweep already make.
//
// Every path here is fire-and-forget and MUST NOT throw: an alert that takes
// down the request it was reporting on is worse than the original bug. And it
// never alerts about its own failures — that is the one way to turn a flaky
// mail provider into an infinite loop.

import express, { Router } from 'express'
import { z } from 'zod'
import { alertEmail, sendEmail } from './email'
import { env } from './env'
import { formatError, log } from './logger'
import { rateLimit } from './ratelimit'

export type AlertSource = 'server' | 'client' | 'trpc' | 'ssr'

// At most one email per distinct error per hour; occurrences accumulate in
// between and ride along in the next email, then reset.
const SIGNATURE_WINDOW_MS = 60 * 60 * 1000
// A rolling ceiling on total alert volume. A storm of distinct errors must not
// turn into a storm of mail — past this, we log and stay quiet for the day.
const GLOBAL_WINDOW_MS = 24 * 60 * 60 * 1000
const GLOBAL_MAX = 20

interface SignatureState {
  count: number
  /** Epoch ms of the last email sent for this signature; 0 = never. */
  lastSentAt: number
}

const signatures = new Map<string, SignatureState>()
// Timestamps of alert dispatches in the last 24h, pruned on every call.
const dispatchedAt: number[] = []

function recipients(): string[] {
  return env.ADMIN_EMAILS.split(',')
    .map((address) => address.trim())
    .filter((address) => address.length > 0)
}

/**
 * Report an error for alerting. Fire-and-forget: returns immediately, never
 * throws, and swallows everything internally — including its own send failures.
 */
export function reportError(source: AlertSource, message: string, detail?: string): void {
  void (async () => {
    const signature = `${source}:${message.slice(0, 200)}`
    const now = Date.now()

    const state = signatures.get(signature) ?? { count: 0, lastSentAt: 0 }
    state.count += 1
    signatures.set(signature, state)

    // Still inside this signature's quiet hour — keep counting, send nothing.
    if (state.lastSentAt !== 0 && now - state.lastSentAt < SIGNATURE_WINDOW_MS) return

    const to = recipients()
    if (to.length === 0) {
      // Nowhere to send. Log it once per quiet hour (throttled like a send) so
      // the terminal isn't buried under a repeating error.
      log.warn(`[alerts] ${signature} (x${state.count}) — no ADMIN_EMAILS configured`)
      state.count = 0
      state.lastSentAt = now
      return
    }

    // Prune the rolling window, then honour the global ceiling.
    while (dispatchedAt.length > 0 && dispatchedAt[0]! <= now - GLOBAL_WINDOW_MS) {
      dispatchedAt.shift()
    }
    if (dispatchedAt.length >= GLOBAL_MAX) {
      // Leave count/lastSentAt untouched so this retries once volume subsides.
      log.warn(`[alerts] global cap (${GLOBAL_MAX}/24h) reached — dropping ${signature}`)
      return
    }

    const count = state.count
    state.count = 0
    state.lastSentAt = now
    dispatchedAt.push(now)

    const message_ = alertEmail({ source, message, detail, count })
    for (const address of to) {
      await sendEmail({ to: address, ...message_ })
    }
  })().catch(() => {})
}

/**
 * Route last-resort process errors into an alert. Deliberately does NOT
 * process.exit: one task serves every request, so a degraded process that keeps
 * answering beats a dead one. An unhandled rejection is usually survivable.
 */
export function installProcessAlerts(): void {
  process.on('uncaughtException', (err) => {
    log.error(`uncaught exception: ${formatError(err)}`)
    const message = err instanceof Error ? err.message : String(err)
    reportError('server', message, err instanceof Error ? err.stack : undefined)
  })
  process.on('unhandledRejection', (reason) => {
    log.error(`unhandled rejection: ${formatError(reason)}`)
    const message = reason instanceof Error ? reason.message : String(reason)
    reportError('server', message, reason instanceof Error ? reason.stack : undefined)
  })
}

// Browser errors POST here (src/lib/client-errors.ts). Small JSON, rate-limited
// per IP so a broken page in one tab can't flood the mailbox.
const reportSchema = z.object({
  message: z.string().min(1).max(500),
  stack: z.string().max(4000).optional(),
  url: z.string().max(500).optional(),
})

const byIp = (req: express.Request): string => req.ip ?? 'unknown'

export const clientErrorRouter: Router = Router()
clientErrorRouter.use(express.json({ limit: '8kb' }))
clientErrorRouter.use(rateLimit('client-error', { window: 60, max: 10 }, byIp))
clientErrorRouter.post('/', (req, res) => {
  const parsed = reportSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'bad report' })
    return
  }
  const { message, stack, url } = parsed.data
  // Browser noise, not our bug: ResizeObserver's benign loop warning and the
  // opaque cross-origin "Script error." carry nothing actionable.
  if (/ResizeObserver|^Script error/.test(message)) {
    res.status(204).end()
    return
  }
  reportError('client', message, `${url ?? ''}\n${stack ?? ''}`.trim())
  res.status(204).end()
})
