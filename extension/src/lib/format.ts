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

/** `1 line` / `2 lines` — the live counters are read mid-sentence, so "1 lines" grates. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** 4:32 — elapsed time inside a recording. */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

/** 2026-07-25 — the date alone, for anything older than a week. */
export function dateOnly(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * `4m ago` / `2h ago` / `3d ago`, and a plain date past a week. A list of
 * walkthroughs is read for recency first — "yesterday" is the question, not the
 * timestamp — and an exact stamp at that size is just noise.
 */
export function ago(ts: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 6) return `${days}d ago`;
  return dateOnly(ts);
}

/**
 * `handback.dev` — a server URL as a person would name it. The panel says which
 * workspace something went to in a dozen places and never wants the whole URL.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** 0432 — mmss without the colon, for filenames. */
export function mmssFile(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${pad(Math.floor(total / 60))}${pad(total % 60)}`;
}
