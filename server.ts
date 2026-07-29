import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { toNodeHandler } from 'better-auth/node'
import express from 'express'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auth } from './server/auth'
import { env } from './server/env'
import { formatError, log, requestLogger, startupBanner } from './server/logger'
import { prisma } from './server/prisma'
import { appRouter } from './server/router'
import { createContext } from './server/trpc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isProd = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT ?? 3000)

const resolve = (p: string) => path.resolve(__dirname, p)

// Requests with a file extension that reach the SSR catch-all are misses
// (favicon.ico, source maps, stray .png). Render the SPA only for extension-less
// paths so these 404 fast instead of returning a full HTML doc with status 200.
const LOOKS_LIKE_FILE = /\.[a-zA-Z0-9]+$/

async function createServer() {
  const app = express()
  app.disable('x-powered-by')

  // One tidy log line per request (status + timing), asset noise filtered out.
  app.use(requestLogger(isProd))

  // Liveness/readiness probe — pings the DB. Used by Render's health check.
  app.get('/healthz', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      res.json({ status: 'ok', uptime: process.uptime() })
    } catch (e) {
      log.error(`healthz db check failed: ${formatError(e)}`)
      res.status(503).json({ status: 'error', error: 'database unreachable' })
    }
  })

  // better-auth handler — mounted BEFORE express.json() (better-auth reads
  // the raw body itself).
  app.all('/api/auth/*splat', toNodeHandler(auth))

  app.use(
    '/api/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({ error, type, path: trpcPath, input }) {
        log.error(`[trpc] ${type} ${trpcPath ?? '<unknown>'} ${error.code} — ${error.message}`, {
          input,
        })
        if (error.code === 'INTERNAL_SERVER_ERROR' && error.stack) {
          console.error(error.stack)
        }
      },
    })
  )

  let vite: Awaited<ReturnType<typeof import('vite').createServer>> | undefined

  if (!isProd) {
    vite = await (
      await import('vite')
    ).createServer({
      root: __dirname,
      // Explicit HMR port — without it vite logs "Port undefined is already in
      // use" in middleware mode.
      server: { middlewareMode: true, hmr: { port: 24678 } },
      appType: 'custom',
    })
    app.use(vite.middlewares)
  } else {
    app.use(
      (await import('compression')).default(),
      express.static(resolve('./dist/client'), { index: false })
    )
  }

  const indexProd = isProd ? fs.readFileSync(resolve('./dist/client/index.html'), 'utf-8') : ''

  app.use(async (req, res) => {
    // Unmatched API routes return JSON, never the HTML SPA.
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    // GET and HEAD on extension-less paths are SSR navigations; express strips
    // the body from a HEAD response, and unfurlers/uptime checks use it.
    const navigational = req.method === 'GET' || req.method === 'HEAD'
    if (!navigational || LOOKS_LIKE_FILE.test(req.path)) {
      res.status(404).type('txt').end('Not found')
      return
    }
    try {
      let template: string
      let render: typeof import('./src/entry-server').render

      if (!isProd && vite) {
        template = fs.readFileSync(resolve('./index.html'), 'utf-8')
        template = await vite.transformIndexHtml(req.originalUrl, template)
        render = (await vite.ssrLoadModule('/src/entry-server.tsx')).render
      } else {
        template = indexProd
        // @ts-ignore — produced by `vite build --ssr`; may not exist before first build
        render = (await import('./dist/server/entry-server.js')).render
      }

      const { html: appHtml, status, dehydratedState } = await render(req)

      const stateScript = `<script>window.__SSR_STATE__ = ${jsonForScript({ dehydratedState })}</script>`
      const html = template
        .replace('<!--app-state-->', stateScript)
        .replace('<!--app-html-->', appHtml)

      res.status(status).set({ 'Content-Type': 'text/html' }).end(html)
    } catch (e: unknown) {
      if (e instanceof Response) {
        const location = e.headers.get('location')
        if (location) {
          res.redirect(e.status, location)
        } else {
          const body = await e.text()
          res.status(e.status).end(body)
        }
        return
      }
      if (!isProd && vite) vite.ssrFixStacktrace(e as Error)
      log.error(`SSR render failed for ${req.method} ${req.originalUrl}`)
      console.error(formatError(e))
      res
        .status(500)
        .type('txt')
        .end(isProd ? 'Internal Server Error' : formatError(e))
    }
  })

  app.listen(PORT, () => {
    startupBanner({
      port: PORT,
      isProd,
      databaseUrl: env.DATABASE_URL,
      routes: ['/', '/sign-in', '/sign-up', '/dashboard', '/healthz', '/api/trpc', '/api/auth'],
    })
  })
}

// JSON for safe inline-script embedding: escape `<` so `</script>` can't
// terminate the script tag.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

createServer().catch((e) => {
  log.error('failed to start server')
  console.error(formatError(e))
  process.exit(1)
})
