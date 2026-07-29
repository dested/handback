// Dependency-free, color-aware logging for the dev/prod server. No chalk, no
// morgan — just ANSI codes gated on a TTY and the NO_COLOR convention.
//
// Exports:
//   log            — leveled console helpers (info/warn/error/success/debug)
//   requestLogger  — Express middleware: one tidy line per request with status
//                    + timing, color-coded, with dev asset noise filtered out
//   startupBanner  — the boxed banner printed once on listen
//   formatError    — consistent error rendering for the SSR catch-all

import type { NextFunction, Request, Response } from 'express'

const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined

const code = (n: number) => (s: string | number) => (useColor ? `\x1b[${n}m${s}\x1b[0m` : String(s))

export const c = {
  reset: '\x1b[0m',
  bold: code(1),
  dim: code(2),
  red: code(31),
  green: code(32),
  yellow: code(33),
  blue: code(34),
  magenta: code(35),
  cyan: code(36),
  gray: code(90),
}

const tag = {
  info: c.cyan('info'),
  warn: c.yellow('warn'),
  error: c.red('error'),
  success: c.green('ready'),
  debug: c.gray('debug'),
}

export const log = {
  info: (msg: string, ...rest: unknown[]) => console.log(`${tag.info}  ${msg}`, ...rest),
  warn: (msg: string, ...rest: unknown[]) => console.warn(`${tag.warn}  ${msg}`, ...rest),
  error: (msg: string, ...rest: unknown[]) => console.error(`${tag.error} ${msg}`, ...rest),
  success: (msg: string, ...rest: unknown[]) => console.log(`${tag.success} ${msg}`, ...rest),
  debug: (msg: string, ...rest: unknown[]) => console.log(`${tag.debug} ${msg}`, ...rest),
}

function colorStatus(status: number): string {
  const s = String(status)
  if (status >= 500) return c.red(s)
  if (status >= 400) return c.yellow(s)
  if (status >= 300) return c.cyan(s)
  return c.green(s)
}

function colorDuration(ms: number): string {
  const text = ms >= 1 ? `${ms.toFixed(0)}ms` : `${ms.toFixed(1)}ms`
  if (ms >= 1000) return c.red(text)
  if (ms >= 300) return c.yellow(text)
  return c.gray(text)
}

// Vite serves a flood of module/HMR requests in dev; logging them buries the
// signal. Skip framework internals and static assets — keep page + API traffic.
const DEV_SKIP = /^\/(@|src\/|node_modules\/|\.vite\/)|\/\.vite\//
const ASSET_EXT =
  /\.(js|mjs|ts|tsx|jsx|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|wasm)$/i

function shouldSkip(path: string, isProd: boolean): boolean {
  if (!isProd && DEV_SKIP.test(path)) return true
  if (path === '/assets' || path.startsWith('/assets/')) return true
  return ASSET_EXT.test(path)
}

export function requestLogger(isProd: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (shouldSkip(req.path, isProd)) return next()
    const start = process.hrtime.bigint()
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      const method = req.method.padEnd(4)
      const len = res.getHeader('content-length')
      const size = len ? c.gray(`${len}b`) : ''
      console.log(
        `${c.gray('›')} ${c.bold(method)} ${colorStatus(res.statusCode)} ${req.originalUrl} ${colorDuration(ms)} ${size}`.trimEnd()
      )
    })
    next()
  }
}

// Hide the password in a connection string for safe logging.
function safeDbUrl(url: string | undefined): string {
  if (!url) return c.gray('(unset)')
  try {
    const u = new URL(url)
    const auth = u.username ? `${u.username}@` : ''
    return `${u.protocol}//${auth}${u.host}${u.pathname}`
  } catch {
    return c.gray('(invalid url)')
  }
}

export function startupBanner(opts: {
  port: number
  isProd: boolean
  databaseUrl?: string
  routes: string[]
}) {
  const mode = opts.isProd ? c.yellow('production') : c.green('development')
  const url = c.cyan(`http://localhost:${opts.port}`)
  console.log()
  console.log(`  ${c.bold(c.magenta('inloop'))} ${c.dim('· Express + React Router 7 SSR')}`)
  console.log(`  ${c.dim('mode')}     ${mode}`)
  console.log(`  ${c.dim('local')}    ${url}`)
  console.log(`  ${c.dim('health')}   ${c.cyan(`http://localhost:${opts.port}/healthz`)}`)
  console.log(`  ${c.dim('database')} ${safeDbUrl(opts.databaseUrl)}`)
  console.log(`  ${c.dim('routes')}   ${opts.routes.map((r) => c.gray(r)).join(c.dim(' · '))}`)
  console.log()
}

export function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`
  return String(err)
}
