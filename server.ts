import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { toNodeHandler } from 'better-auth/node'
import express from 'express'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auth } from './server/auth'
import { startDigestSweep } from './server/digest'
import { env } from './server/env'
import { ingestRouter } from './server/ingest'
import { formatError, log, requestLogger, startupBanner } from './server/logger'
import { mcpRouter } from './server/mcp'
import { prisma } from './server/prisma'
import { latestRecorderRelease } from './server/releases'
import { appRouter } from './server/router'
import { startRetentionSweep } from './server/retention'
import { presignGet } from './server/storage'
import { createContext } from './server/trpc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isProd = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT ?? 3995)

const resolve = (p: string) => path.resolve(__dirname, p)

// Requests with a file extension that reach the SSR catch-all are misses
// (favicon.ico, source maps, stray .png). Render the SPA only for extension-less
// paths so these 404 fast instead of returning a full HTML doc with status 200.
const LOOKS_LIKE_FILE = /\.[a-zA-Z0-9]+$/

async function createServer() {
  const app = express()
  app.disable('x-powered-by')

  // One hop: Caddy terminates TLS and forwards. Without this `req.ip` is the
  // proxy's address for every request, which would collapse every caller into a
  // single rate-limit bucket.
  app.set('trust proxy', 1)

  // Baseline security headers on every response. No CSP in this pass — the SSR
  // inline state script needs a nonce before a policy can be strict, and that's
  // out of scope here. Permissions-Policy deliberately leaves microphone and
  // display-capture alone: the recorder pages are the whole product and need
  // them. HSTS only goes out over HTTPS (Caddy terminates TLS; the container
  // sees the forwarded proto), never on a plain-http dev request.
  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=()')
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    next()
  })

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

  // Token-authed upload surface for the CLI / extension / MCP. Parses its own
  // JSON bodies; keep it after the auth mount, which needs the raw stream.
  app.use('/api/ingest', ingestRouter)

  // The recorder's zip, for as long as there is no Web Store listing. Signed-in
  // only: the build is not secret, but an unauthenticated URL is a public
  // release by another name, and "not public yet" is the whole point. Sits at
  // the root rather than under /api because it's a link a human clicks, and it
  // must be mounted before the SSR catch-all like every other non-page route.
  app.get('/download/recorder', async (req, res) => {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      if (Array.isArray(value)) for (const v of value) headers.append(key, v)
      else headers.set(key, value)
    }
    const session = await auth.api.getSession({ headers })
    if (!session) return res.redirect(302, '/sign-in?next=/recorder')

    const release = await latestRecorderRelease()
    if (!release) return res.status(404).json({ error: 'No recorder build has been published yet' })

    log.info(`[releases] ${session.user.email} downloading recorder ${release.version}`)
    // A redirect, not a proxy: the bytes go browser↔S3 and never touch the
    // container's memory or its 576 MiB ceiling.
    res.redirect(302, await presignGet(release.key))
  })

  // One-click unsubscribe for the recurring emails (upload notify + weekly
  // digest). The signed link in the mail's footer is the whole credential
  // (HMAC of user id + kind) — it has to work without a session, from any mail
  // client. Re-enable lives on /team.
  app.get('/api/notifications/unsubscribe', async (req, res) => {
    const { NOTIFY_KINDS, verifyUnsubscribeSig } = await import('./server/notify')
    const userId = typeof req.query.u === 'string' ? req.query.u : ''
    const sig = typeof req.query.sig === 'string' ? req.query.sig : ''
    const kindParam = typeof req.query.kind === 'string' ? req.query.kind : ''
    const kind = NOTIFY_KINDS.find((k) => k === kindParam)
    if (!userId || !sig || !kind || !verifyUnsubscribeSig(userId, kind, sig)) {
      res.status(400).type('txt').end('Bad unsubscribe link')
      return
    }
    await prisma.user
      .update({
        where: { id: userId },
        data: kind === 'uploads' ? { notifyUploads: false } : { notifyDigest: false },
      })
      .catch(() => {})
    const what =
      kind === 'uploads' ? 'emails when a teammate adds a walkthrough' : 'weekly digest emails'
    res
      .type('html')
      .end(
        `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0;padding:48px 16px;background:#fbfaf7;font-family:'Helvetica Neue',Arial,sans-serif;color:#25272e"><div style="max-width:480px;margin:0 auto"><div style="font-size:18px;font-weight:600">Handback</div><div style="height:1px;background:#e6e3dc;margin:16px 0 24px"></div><p style="font-size:15px;line-height:1.6">Done — no more ${what}.</p><p style="font-size:13px;color:#6b6f7a;line-height:1.6">Changed your mind? Turn them back on from your <a href="/team" style="color:#2f56d8">Team page</a>.</p></div>`
      )
  })

  // The PWA share sheet POSTs here; the service worker intercepts and stashes
  // the media. If no SW is in control (first run, registration blocked) the
  // POST reaches Express instead — the file is lost, but the person must land
  // on /phone with the picker, never on a 404.
  app.post('/share-target', (_req, res) => res.redirect(303, '/phone?error=share'))

  // The hosted MCP server. Deliberately at the root and not under /api — this
  // URL is copy-pasted by hand into `claude mcp add`, and it has to be short
  // enough to read back over someone's shoulder. Must be mounted before the SSR
  // catch-all, which would otherwise answer a JSON-RPC client with HTML.
  app.use('/mcp', mcpRouter)

  app.use(
    '/api/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({ error, type, path: trpcPath, input }) {
        // Share tokens and file paths ride in these inputs; keep them out of the
        // logs. Every other procedure's input still logs as-is for debugging.
        const loggedInput =
          trpcPath === 'walkthroughs.shared' || trpcPath === 'walkthroughs.fileUrl'
            ? '[redacted]'
            : input
        log.error(`[trpc] ${type} ${trpcPath ?? '<unknown>'} ${error.code} — ${error.message}`, {
          input: loggedInput,
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
        // Dev serves app.css through the JS module graph, which lands a tick
        // after the SSR HTML paints — a visible unstyled flash on every load.
        // Link the compiled sheet directly (?direct = raw CSS, not a JS module)
        // so first paint is styled; Vite's later injected copy is identical.
        template = template.replace(
          '</head>',
          '<link rel="stylesheet" href="/src/styles/app.css?direct" /></head>'
        )
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
      routes: ['/', '/sign-in', '/sign-up', '/connect', '/healthz', '/api/trpc', '/mcp'],
    })
    // Hourly retention sweep (+ one run 30s after boot). One ECS task, same
    // single-process assumption as the in-memory rate limiter.
    startRetentionSweep()
    // Hourly check for the Monday digest window (server/digest.ts).
    startDigestSweep()
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
