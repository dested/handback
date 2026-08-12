import { initTRPC, TRPCError } from '@trpc/server'
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express'
import { auth, type Session } from './auth'

// `ip` feeds the rate limit on the few public procedures (share views); null
// (the SSR loopback caller) skips the limit rather than pooling under one key.
export type Context = { session: Session | null; ip: string | null }

export async function createContext({ req }: CreateExpressContextOptions): Promise<Context> {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, value)
    }
  }
  const session = await auth.api.getSession({ headers })
  return { session, ip: req.ip ?? null }
}

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({ ctx: { ...ctx, session: ctx.session } })
})
