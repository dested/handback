/** Every duration and timestamp in the viewer reads as m:ss. */
export function mmss(ms: number): string {
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
}

/** Sizes are always megabytes here — walkthroughs are videos, never kilobytes. */
export function megabytes(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export function dateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function clockTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, { timeStyle: 'short' })
}

/** `01`, `02`, … — the editorial section numeral. */
export function numeral(n: number): string {
  return String(n).padStart(2, '0')
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
