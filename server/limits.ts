// Tier limits for the metered cloud passes plus one account-safety cap. These
// are abuse ceilings, not product quotas — the free transcription budget is the
// only number a real free user can feel; the Pro ceilings exist purely to bound
// a runaway recorder or a compromised token. server/usage.ts enforces them, and
// server/ingest.ts turns a refusal into a 429.

/** Free cloud transcription budget: 15 minutes per user per month. */
export const FREE_CLOUD_TRANSCRIBE_SECONDS = 900

/** Pro cloud transcription ceiling: 20 hours per user per month (abuse bound). */
export const PRO_CLOUD_TRANSCRIBE_SECONDS = 72_000

/** Pro polish-call ceiling per user per month (abuse bound). */
export const PRO_POLISH_CALLS = 1_000

/** Most non-revoked API tokens one account may hold at once. */
export const MAX_ACTIVE_TOKENS = 10

/** The UTC 'YYYY-MM' bucket a moment falls in — the MonthlyUsage row key. */
export function monthKey(d: Date): string {
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}
