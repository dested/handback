// Where the recorder's zip comes from until there's a Web Store listing.
//
// The bucket IS the release channel: whatever `releases/recorder/` holds with
// the highest version is the current build. There is no constant to bump and
// nothing to keep in sync with extension/package.json — upload a new zip and
// the site is serving it. Nothing here is public; the download route checks a
// session and hands back a short-lived presigned URL.

import { log } from './logger'
import { listPrefix } from './storage'

export const RELEASE_PREFIX = 'releases/recorder/'

/** `releases/recorder/handback-recorder-1.1.1.zip` → `1.1.1`. */
const VERSION_RE = /^handback-recorder-(\d+\.\d+\.\d+)\.zip$/

export type RecorderRelease = { version: string; key: string; bytes: number }

/** Newest first. A build nobody can parse is ignored rather than served. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// Listing S3 on every page render would be a round trip per visitor for an
// answer that changes when a human uploads a zip. One task, so one cache.
const CACHE_MS = 60_000
let cached: { at: number; release: RecorderRelease | null } | null = null

export async function latestRecorderRelease(): Promise<RecorderRelease | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.release

  let release: RecorderRelease | null = null
  try {
    const objects = await listPrefix(RELEASE_PREFIX)
    const parsed = objects.flatMap((o) => {
      const match = VERSION_RE.exec(o.key.slice(RELEASE_PREFIX.length))
      return match?.[1] ? [{ version: match[1], key: o.key, bytes: o.size }] : []
    })
    parsed.sort((a, b) => compareVersions(a.version, b.version))
    release = parsed[0] ?? null
  } catch (err: unknown) {
    // S3 being unreachable must not take /recorder down — the page falls back
    // to "no build available" and every other install step still reads.
    log.warn(`[releases] could not list ${RELEASE_PREFIX}: ${String(err)}`)
    return cached?.release ?? null
  }

  cached = { at: Date.now(), release }
  return release
}

/** After an upload, so the next request sees the new build instead of waiting out the cache. */
export function forgetCachedRelease(): void {
  cached = null
}

/** True when the installed extension is older than what the bucket is serving. */
export function isStale(installed: string, latest: string): boolean {
  return compareVersions(installed, latest) > 0
}
