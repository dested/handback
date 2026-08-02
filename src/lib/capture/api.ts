import { AuthError } from './types'

/**
 * Everything this pipeline says to Handback, it says same-origin: the page is
 * served by the same server that ingests, so there is no base URL to configure
 * and no CORS to clear. The recorder extension's `explain()` wording is kept —
 * a failure a person reads should read the same wherever it came from.
 */

export const INGEST = {
  context: '/api/ingest/context',
  declare: '/api/ingest/walkthroughs',
  transcribe: '/api/ingest/transcribe',
  polish: '/api/ingest/polish',
} as const

export function finalizePath(walkthroughId: string): string {
  return `/api/ingest/walkthroughs/${walkthroughId}/finalize`
}

export function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token.trim()}` }
}

/** A failed request, said in words the UI can put in front of a person. */
export async function explain(what: string, res: Response): Promise<Error> {
  const body = await res.text().catch(() => '')
  const detail = body.trim().slice(0, 200)
  return new Error(`${what} failed (${res.status})${detail ? `: ${detail}` : ''}`)
}

/**
 * A 401/403 from *our* server means the token this phone is holding is dead —
 * a distinct outcome from "the upload broke", because the only cure is signing
 * in again. Never called for an S3 PUT: those speak their own 403s.
 */
export function assertAuthorized(res: Response): void {
  if (res.status === 401 || res.status === 403) {
    throw new AuthError('sign-in expired on this phone')
  }
}
