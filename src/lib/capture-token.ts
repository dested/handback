import { useCallback, useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { autoTokenName } from '~/components/setup-step'
import { AuthError } from '~/lib/capture/types'
import { useTRPC } from '~/lib/trpc'

/**
 * The `hb_` token the in-browser capture pages upload with.
 *
 * `/phone`, `/upload` and `/record` all need the same thing: an ingest token
 * this browser holds, minted on first use and silently replaced when it dies.
 * All three had a byte-identical copy of it, which is exactly the kind of
 * triplication that drifts — so it lives here once.
 *
 * One key across all three on purpose: one browser, one key to this account.
 * Raw tokens are shown once and only their hash is stored, so nobody — not even
 * the server — can answer "do you already have one?"; the pages therefore never
 * ask, they just mint (cliffnotes: the phrasing that got /connect rewritten).
 *
 * We keep the token's **id** alongside the raw value so a re-mint can revoke the
 * dead one it replaces — otherwise every expired/revoked token this browser ever
 * held would sit on the account counting against MAX_ACTIVE_TOKENS, and a busy
 * device would eventually mint itself into the cap it can't see.
 */
const TOKEN_KEY = 'handback.phone.token'

/** What this browser holds: the raw token plus the row id, when we know it. */
type StoredToken = { token: string; id: string | null }

function readStored(): StoredToken | null {
  const raw = localStorage.getItem(TOKEN_KEY)
  if (!raw) return null
  // Legacy format was the bare token string (no id to revoke by); the current
  // format is JSON. A bare `hb_` value predates id-tracking.
  if (raw.startsWith('hb_')) return { token: raw, id: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'token' in parsed &&
      typeof (parsed as { token: unknown }).token === 'string'
    ) {
      const p = parsed as { token: string; id?: unknown }
      return { token: p.token, id: typeof p.id === 'string' ? p.id : null }
    }
  } catch {
    // Not our shape — treat as absent and let a fresh mint overwrite it.
  }
  return null
}

/** Runs `work` with a live token, minting or re-minting as needed. */
export type WithToken = <T>(work: (token: string) => Promise<T>) => Promise<T>

/**
 * @param kind what to name the token after — the surface that minted it
 *   ('Phone', 'Upload', 'Recorder'), so a token list reads as places, not UUIDs.
 */
export function useCaptureToken(kind: string): WithToken {
  const trpc = useTRPC()
  const createToken = useMutation(trpc.tokens.create.mutationOptions())
  const revokeToken = useMutation(trpc.tokens.revoke.mutationOptions())

  // Held in refs so the returned helper is stable enough to sit in effect deps
  // without re-running them on every render of a fairly busy page.
  const mint = useRef(createToken.mutateAsync)
  const revoke = useRef(revokeToken.mutateAsync)
  useEffect(() => {
    mint.current = createToken.mutateAsync
    revoke.current = revokeToken.mutateAsync
  })

  const mintToken = useCallback(async (): Promise<string> => {
    const created = await mint.current({
      name: autoTokenName(kind, navigator.userAgent, new Date()),
    })
    const next: StoredToken = { token: created.token, id: created.id }
    localStorage.setItem(TOKEN_KEY, JSON.stringify(next))
    return created.token
  }, [kind])

  /**
   * A token can die between sessions — revoked, or the account signed out
   * elsewhere — and the person in front of the page can do nothing useful with
   * that news, so a dead token is silently replaced and the work retried once.
   * Only a second failure is worth telling them about.
   */
  return useCallback(
    async <T>(work: (token: string) => Promise<T>): Promise<T> => {
      const stored = readStored()
      const token = stored?.token ?? (await mintToken())
      try {
        return await work(token)
      } catch (error) {
        if (!(error instanceof AuthError)) throw error
        // This browser's token is dead. Drop it, best-effort revoke the row so
        // it stops counting against the cap, then mint a replacement and retry.
        localStorage.removeItem(TOKEN_KEY)
        if (stored?.id) {
          try {
            await revoke.current({ tokenId: stored.id })
          } catch {
            // Already revoked, or the network's still down — the mint below is
            // what matters, and a stale row ages out on its own.
          }
        }
        return work(await mintToken())
      }
    },
    [mintToken]
  )
}
