import type * as express from 'express'
import { dehydrate, QueryClient, type DehydratedState } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query'
import ReactDomServer from 'react-dom/server'
import { StaticRouterProvider, createStaticHandler, createStaticRouter } from 'react-router-dom'
import { auth, type Session } from '../server/auth'
import { appRouter } from '../server/router'
import App from './App'
import { routes, type SsrLoaderContext } from './app/routes'

export async function render(req: express.Request): Promise<{
  html: string
  status: number
  session: Session | null
  dehydratedState: DehydratedState
}> {
  const fetchRequest = expressToFetch(req)

  const session = await auth.api.getSession({ headers: fetchRequest.headers })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000 } },
  })

  const trpcServer = createTRPCOptionsProxy({
    router: appRouter,
    ctx: { session },
    queryClient,
  })

  const { query, dataRoutes } = createStaticHandler(routes)
  const ssrContext: SsrLoaderContext = { session, queryClient, trpc: trpcServer }
  const routerContext = await query(fetchRequest, { requestContext: ssrContext })

  if (routerContext instanceof Response) throw routerContext

  const router = createStaticRouter(dataRoutes, routerContext)

  // Loopback tRPC client for any non-prefetched query that runs during render.
  // Prefetched queries land in queryClient cache and won't hit this.
  const cookieHeader = req.headers.cookie
  const trpcClient = createTRPCClient<typeof appRouter>({
    links: [
      httpBatchLink({
        url: `http://localhost:${process.env.PORT ?? 3000}/api/trpc`,
        headers: () => (cookieHeader ? { cookie: cookieHeader } : {}),
      }),
    ],
  })

  const html = ReactDomServer.renderToString(
    <App queryClient={queryClient} trpcClient={trpcClient} dehydratedState={null}>
      <StaticRouterProvider router={router} context={routerContext} />
    </App>
  )

  // statusCode reflects loader-thrown Responses and unmatched-route 404s, so
  // the server returns the right HTTP status (not a blanket 200).
  return {
    html,
    status: routerContext.statusCode,
    session,
    dehydratedState: dehydrate(queryClient),
  }
}

function expressToFetch(req: express.Request): Request {
  const origin = `${req.protocol}://${req.get('host')}`
  const url = new URL(req.originalUrl || req.url, origin)
  const controller = new AbortController()
  req.on('close', () => controller.abort())

  const headers = new Headers()
  for (const [key, values] of Object.entries(req.headers)) {
    if (!values) continue
    if (Array.isArray(values)) {
      for (const v of values) headers.append(key, v)
    } else {
      headers.set(key, values)
    }
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    signal: controller.signal,
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body

  return new Request(url.href, init)
}
