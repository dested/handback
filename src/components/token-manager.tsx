// Shared token management — the list-and-revoke surface plus the "you've hit the
// cap" affordances, used everywhere a token can be minted.
//
// Every mint surface (/connect, /recorder, /phone, /record, /upload) can run
// into MAX_ACTIVE_TOKENS, and the server's only remedy is "revoke one first."
// That remedy is useless unless a revoke control is right there when it happens,
// so the list and the limit notice both live here and get embedded wherever a
// mint can fail.

import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '~/components/ui/button'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Formatted from UTC parts on purpose: locale formatting differs between the
// SSR runtime and the browser, which would break hydration.
function fmtDate(value: string | null) {
  if (!value) return 'never'
  const d = new Date(value)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

const TH = 'text-muted-foreground border-border border-b px-3 py-1.5 text-left text-xs font-medium'

/**
 * True when a `tokens.create` failure is the active-token cap (server:
 * PRECONDITION_FAILED "Too many active tokens — revoke one first"). Matched on
 * the message so the client never imports the server-only limit constant, and
 * accepts either the thrown error (connect/recorder) or a page's stored failure
 * string (the capture pages surface `error.message` as a plain string).
 */
export function isTokenLimitError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /too many active tokens/i.test(message)
}

/**
 * The bare list + per-row revoke. No heading of its own so it can sit under a
 * section title on /connect or inside a limit notice on a mint surface.
 */
export function TokenList() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const tokensQuery = useQuery(trpc.tokens.list.queryOptions())
  const revoke = useMutation(
    trpc.tokens.revoke.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.tokens.list.queryKey() })
        void queryClient.invalidateQueries({ queryKey: trpc.tokens.connection.queryKey() })
      },
    })
  )

  return (
    <div className="space-y-3">
      {tokensQuery.isPending && <p className="text-muted-foreground text-[13px]">Loading…</p>}
      {tokensQuery.isError && (
        <p className="text-destructive text-[13px]">{tokensQuery.error.message}</p>
      )}
      {tokensQuery.data?.length === 0 && (
        <p className="text-muted-foreground text-[13px]">No tokens yet.</p>
      )}
      {tokensQuery.data && tokensQuery.data.length > 0 && (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Name</th>
              <th className={TH}>Created</th>
              <th className={TH}>Last used</th>
              <th className={cn(TH, 'text-right')} />
            </tr>
          </thead>
          <tbody>
            {tokensQuery.data.map((t) => (
              <tr key={t.id} className="border-border/60 border-b">
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="text-muted-foreground px-3 py-2 font-mono text-xs tabular-nums">
                  {fmtDate(t.createdAt)}
                </td>
                <td className="text-muted-foreground px-3 py-2 font-mono text-xs tabular-nums">
                  {fmtDate(t.lastUsedAt)}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={revoke.isPending}
                    onClick={() => {
                      if (!window.confirm(`Revoke "${t.name}"? Anything using it stops working.`))
                        return
                      revoke.mutate({ tokenId: t.id })
                    }}>
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {revoke.isError && <p className="text-destructive text-[13px]">{revoke.error.message}</p>}
    </div>
  )
}

/**
 * Reference, not a step: the list you come back to when you want to cut one off.
 * There is deliberately no "create" form here — minting always happens at the
 * top of whatever flow you're in, so there's never a question about which
 * control to use.
 */
export function TokenManager({
  title = 'Your API tokens',
  blurb = (
    <>
      These authenticate the recorder, the CLI, and the MCP server. They're yours alone. A token
      reads your personal space and every team you belong to; revoking one disconnects whatever
      holds it. Old ones keep working until you revoke them — a new one never displaces them.
    </>
  ),
}: {
  title?: string
  blurb?: ReactNode
}) {
  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold">{title}</h2>
      {blurb && (
        <p className="text-muted-foreground mt-1 max-w-2xl text-[13px] leading-relaxed">{blurb}</p>
      )}
      <div className="bg-card border-border mt-4 rounded-lg border p-5">
        <TokenList />
      </div>
    </section>
  )
}

/**
 * The "you can't mint another until you revoke one" panel, shown inline wherever
 * a mint just failed on the cap. It carries the remedy — the revoke list — so
 * the person never has to go hunting for a settings page to get unstuck.
 */
export function TokenLimitNotice() {
  return (
    <div className="border-destructive/40 bg-card space-y-4 rounded-lg border p-4 text-[13px]">
      <div>
        <p className="font-semibold">You've reached your active-token limit.</p>
        <p className="text-muted-foreground mt-1 leading-relaxed">
          Linking, connecting an agent, and recording each mint a token, and they don't expire on
          their own. Revoke one you no longer use, then try again.
        </p>
      </div>
      <TokenList />
    </div>
  )
}
