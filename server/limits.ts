// Tier limits for the metered cloud passes plus one account-safety cap. There IS
// a free cloud tier again (2026-08-24 owner reversal): a free account gets a
// small monthly walkthrough allowance (FREE_WALKTHROUGHS_PER_MONTH), each with
// the full cloud treatment — transcription (FREE_CLOUD_TRANSCRIBE_SECONDS) and
// the refine pass — so free users see the product's magic. The Pro numbers are
// real product quotas (15 hours, 80 walkthroughs); the POLISH_CALLS ceilings stay
// abuse bounds on transcript polish. Assistant turns are their own metered quota
// (PRO_ASSISTANT_TURNS), not an abuse bound, and stay Pro-only.
// server/usage.ts enforces them, and server/ingest.ts turns a refusal into a 429.

/** Free cloud transcription: 1 hour per month — enough for the free walkthrough allowance. */
export const FREE_CLOUD_TRANSCRIBE_SECONDS = 3_600

/** Pro cloud transcription quota: 15 hours per user per month. */
export const PRO_CLOUD_TRANSCRIBE_SECONDS = 54_000

/** Pro polish-call ceiling per user per month (abuse bound). */
export const PRO_POLISH_CALLS = 1_000

/** Free polish/refine call budget per month — covers the free allowance with margin; an abuse bound, like PRO_POLISH_CALLS. */
export const FREE_POLISH_CALLS = 20

/** Pro assistant-turn quota per user per month — a real margin guard, not an abuse bound. */
export const PRO_ASSISTANT_TURNS = 30

/** Walkthroughs a non-admin account may create per month (the locked plan's Pro cap). */
export const PRO_WALKTHROUGHS_PER_MONTH = 80

/** Walkthroughs a free account may create per month — small on purpose; each gets the full cloud treatment. */
export const FREE_WALKTHROUGHS_PER_MONTH = 2

/** Total refine passes one walkthrough may consume (the automatic first run + re-runs). */
export const MAX_REFINE_RUNS_PER_WALKTHROUGH = 4

/** Most non-revoked API tokens one account may hold at once. */
export const MAX_ACTIVE_TOKENS = 10

/** The UTC 'YYYY-MM' bucket a moment falls in — the MonthlyUsage row key. */
export function monthKey(d: Date): string {
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}
