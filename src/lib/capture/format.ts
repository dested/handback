/** Ported from `extension/src/lib/format.ts` — these strings end up in filenames
 *  and in the report, so the two implementations have to agree character for
 *  character. Only what the capture pipeline needs is here. */

/** Two-digit zero pad. Every number that lands in a filename goes through this. */
export const pad2 = (n: number) => String(n).padStart(2, '0')
const pad = pad2

/** rec-01 — the folder one take lives in. Uploader and report must agree. */
export function recDirName(index: number): string {
  return `rec-${pad2(index)}`
}

export function dateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function hhmm(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 4:32 — elapsed time inside a recording. */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${pad(total % 60)}`
}

/** 0432 — mmss without the colon, for filenames. */
export function mmssFile(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${pad(Math.floor(total / 60))}${pad(total % 60)}`
}
