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
 */
const TOKEN_KEY = 'handback.phone.token'

/** Runs `work` with a live token, minting or re-minting as needed. */
export type WithToken = <T>(work: (token: string) => Promise<T>) => Promise<T>

/**
 * @param kind what to name the token after — the surface that minted it
 *   ('Phone', 'Upload', 'Recorder'), so a token list reads as places, not UUIDs.
 */
export function useCaptureToken(kind: string): WithToken {
  const trpc = useTRPC()
  const createToken = useMutation(trpc.tokens.create.mutationOptions())

  // Held in a ref so the returned helper is stable enough to sit in effect deps
  // without re-running them on every render of a fairly busy page.
  const mint = useRef(createToken.mutateAsync)
  useEffect(() => {
    mint.current = createToken.mutateAsync
  })

  const mintToken = useCallback(async (): Promise<string> => {
    const created = await mint.current({
      name: autoTokenName(kind, navigator.userAgent, new Date()),
    })
    localStorage.setItem(TOKEN_KEY, created.token)
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
      const stored = localStorage.getItem(TOKEN_KEY)
      const token = stored ?? (await mintToken())
      try {
        return await work(token)
      } catch (error) {
        if (!(error instanceof AuthError)) throw error
        localStorage.removeItem(TOKEN_KEY)
        return work(await mintToken())
      }
    },
    [mintToken]
  )
}
