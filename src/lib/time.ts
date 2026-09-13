// Wall-clock and duration strings shared by the List and Board rows. `shortDate`
// and `mmss` are pure (SSR-safe); `relativeTime` and `expiresTag` read the clock,
// so callers gate them on hydration — the server renders the absolute date and
// only the hydrated client softens to "2h ago" / an expiry countdown.

const DAY_MS = 24 * 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// UTC parts, not toLocaleDateString: locale formatting differs between the SSR
// runtime and the browser, which would break hydration.
export function shortDate(value: string): string {
  const d = new Date(value)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "2h ago". Reads the wall clock, so the caller renders `shortDate` until hydration. */
export function relativeTime(value: string, now: number): string {
  const seconds = Math.round((now - new Date(value).getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.round(days / 7)}w ago`
  return shortDate(value)
}

/**
 * Days until a resolved walkthrough auto-deletes, as a terse `Nd`. Null when
 * nothing is scheduled or it's already overdue. Reads the clock, so callers gate
 * it on hydration like `relativeTime`.
 */
export function expiresTag(expiresAt: string | null, now: number): string | null {
  if (!expiresAt) return null
  const days = Math.ceil((new Date(expiresAt).getTime() - now) / DAY_MS)
  return days > 0 ? `${days}d` : null
}

/** 4:32 — elapsed time inside a recording. */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const s = total % 60
  return `${Math.floor(total / 60)}:${String(s).padStart(2, '0')}`
}
