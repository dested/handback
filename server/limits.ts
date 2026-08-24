// Tier limits for the metered cloud passes plus one account-safety cap. Cloud
// transcription now comes with a plan: without one the budget is 0 and the
// recorder falls back on-device. The Pro number is a real product quota (15
// hours); PRO_POLISH_CALLS stays an abuse bound. server/usage.ts enforces them,
// and server/ingest.ts turns a refusal into a 429.

/** No free cloud budget — transcription without a plan runs on-device. */
export const FREE_CLOUD_TRANSCRIBE_SECONDS = 0

/** Pro cloud transcription quota: 15 hours per user per month. */
export const PRO_CLOUD_TRANSCRIBE_SECONDS = 54_000

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
