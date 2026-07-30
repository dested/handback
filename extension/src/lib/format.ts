export function slugify(input: string, max = 42): string {
  const slug = input
    .toLowerCase()
    .replace(/https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'session';
}

/** Two-digit zero pad. Every number that lands in a filename goes through this. */
export const pad2 = (n: number) => String(n).padStart(2, '0');
const pad = pad2;

/** rec-01 — the folder one part of a gripe lives in. Uploader and report must agree. */
export function recDirName(index: number): string {
  return `rec-${pad2(index)}`;
}

/** 2026-07-25-1432 — sortable, filesystem-safe, readable at a glance. */
export function stamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function clockTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function dateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 4:32 — elapsed time inside a recording. */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

/** 0432 — mmss without the colon, for filenames. */
export function mmssFile(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${pad(Math.floor(total / 60))}${pad(total % 60)}`;
}
