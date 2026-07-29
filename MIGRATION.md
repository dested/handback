# Upgrading an existing inloop clone

This repo (a project cloned from **inloop**) predates a round of bug fixes and
hardening in the template. This doc brings it up to date.

Some of these are **correctness bugs that break the app** (auth returns 404, the
Prisma CLI can't read `.env`, `prettier` crashes) — apply the Critical/High
sections to _every_ clone. The Recommended section is opt-in polish.

## How to run this

**Option A — hand it to Claude Code** (recommended). From the repo root:

> Read `MIGRATION.md` and apply it to this repository. Work top-to-bottom.
> This project may have been renamed and modified, so detect each issue with the
> given command before fixing, adapt edits to the local code instead of pasting
> blindly, and run every Verify step. Stop and ask if a file has diverged enough
> that the fix is ambiguous.

**Option B — do it yourself.** Follow each section: run the **Detect** command; if
it matches, apply the **Fix**; then run **Verify**. Do them in order.

> ⚠️ Your project was likely renamed (via `bun run init` or by hand). The Detect
> commands below are name-agnostic. The new _files_ you copy from upstream still
> say `inloop`/`inloop`/`Inloop` — search-and-replace those to your
> project's name after copying (the same three tokens `bun run init` rewrites).

**Upstream** = a fresh clone of the latest inloop. Keep one handy to copy new
files from (`git clone <inloop-url> /tmp/inloop-upstream`).

---

## TL;DR order of operations

```bash
bun add express@^5          # 1  fixes auth (Critical)
# edit prisma.config.ts     # 2  fixes db:* + postinstall (Critical)
# edit prettier.config.js   # 3  fixes `bun run prettier` (High)
# edit src/app/layout.tsx   # 4  fixes sign-out (High)
# edit server.ts + index.html + add public/  # 5,6  favicon / real 404 (Medium)
bun install && bun run typecheck && bun run build   # verify
```

---

## 1. Critical — auth is broken on Express 4

The routing/SSR code uses **Express 5** named-wildcard routes (`/api/auth/*splat`),
and `@types/express` is v5 — but early clones pinned **Express 4**, where `*splat`
doesn't match. Result: **every `/api/auth/*` request 404s and auth is completely
dead** (sign-in/up/out all fail silently).

**Detect**

```bash
grep '"express"' package.json     # if it shows ^4.x, you're affected
```

**Fix**

```bash
bun add express@^5
```

`@types/express` should already be `^5`; if not, `bun add -d @types/express@^5`.

**Verify**

```bash
# with the app running (bun run dev), in another shell:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/auth/get-session
# expect 200 (was 404)
```

---

## 2. Critical — the Prisma CLI can't read `.env`

Bun loads `.env` into its own runtime but **not** into the Prisma CLI (a Node
subprocess), and Prisma 7 dropped automatic `.env` loading. So `db:push`,
`db:migrate`, `db:studio`, `db:generate`, and the `postinstall` all throw
`PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL` on a
fresh clone. The old `prisma.config.ts` even claims (wrongly) that "Bun loads
`.env` automatically."

**Detect**

```bash
grep -q "readFileSync" prisma.config.ts || echo "AFFECTED: prisma.config.ts does not load .env itself"
```

**Fix** — replace `prisma.config.ts` with:

```ts
// Prisma 7 moved the connection URL out of `schema.prisma` — the CLI tooling
// (db push, migrate, studio) reads it from here. The runtime `PrismaClient`
// gets it via the pg driver adapter in `server/prisma.ts`.
//
// Prisma 7 no longer auto-loads `.env`, and Bun only injects `.env` into its
// OWN runtime — NOT into the Node subprocess that runs the Prisma CLI. So we
// load `.env` ourselves here. This is a no-op when the var is already set
// (CI, Render, or an exported shell var), and tolerates a missing `.env` so a
// fresh `bun install` (postinstall → `prisma generate`) succeeds before you've
// created one.
import { readFileSync } from 'node:fs'
import { defineConfig } from 'prisma/config'

if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(new URL('.env', import.meta.url), 'utf8').split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    // no .env yet — fine for `prisma generate`, which doesn't connect.
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
})
```

**Verify**

```bash
mv .env .env.bak 2>/dev/null; bun run db:generate && echo "generate OK without .env"; mv .env.bak .env 2>/dev/null
bun run db:push   # with .env present → syncs schema
```

---

## 3. High — `bun run prettier` crashes on its own config

`prettier.config.js` uses CommonJS (`module.exports` / `require`) while
`package.json` is `"type": "module"`, so Prettier errors: _"module is not defined
in ES module scope."_ It also omits `semi: false`, so Prettier's default would
**add semicolons across a codebase that is written semicolon-free.**

**Detect**

```bash
grep -q "module.exports" prettier.config.js && echo "AFFECTED: CommonJS prettier config in an ESM package"
```

**Fix** — replace `prettier.config.js` with:

```js
export default {
  printWidth: 100,
  tabWidth: 2,
  semi: false,
  singleQuote: true,
  bracketSameLine: true,
  trailingComma: 'es5',

  plugins: ['prettier-plugin-tailwindcss'],
  tailwindAttributes: ['className'],
}
```

> If your team deliberately adopted semicolons, drop the `semi: false` line and run
> `bunx prettier --write .` once to normalize.

Also add a `.prettierignore` so Prettier skips build output and binaries:

```
node_modules
dist
bun.lock
e2e/__screenshots__
playwright-report
test-results
```

**Verify**

```bash
bunx prettier --check .   # should run without a config error
```

---

## 4. High — sign-out doesn't clear the session in the UI

The sign-in/up flows call `revalidator.revalidate()` so the nav reflects the new
session, but **sign-out doesn't** — it navigates home while the root loader keeps
serving the stale (signed-in) session, so the nav still shows the user's email and
"Sign out" after they've signed out.

**Detect**

```bash
grep -A4 "async function signOut" src/app/layout.tsx | grep -q "revalidat" || echo "AFFECTED: signOut never revalidates"
```

**Fix** — in `src/app/layout.tsx`, add `useRevalidator` to the `react-router-dom`
import, grab it in the component (`const revalidator = useRevalidator()`), and make
`signOut` revalidate after navigating:

```ts
async function signOut() {
  await authClient.signOut()
  navigate('/', { replace: true })
  revalidator.revalidate()
}
```

**Verify** — sign in, then sign out: the nav should immediately show "Sign in /
Sign up". (Covered by the e2e suite in §9.)

---

## 5. Medium — favicon 404, SPA-as-asset, and no real 404 status

Early clones have no favicon, and the SSR catch-all renders the full HTML app for
_any_ unmatched path — so `/favicon.ico` and stray asset requests return a 200 with
a full HTML document as the "file", unknown `/api/*` returns HTML instead of JSON,
and unknown pages return **200 instead of 404**.

**Detect**

```bash
grep -q "LOOKS_LIKE_FILE\|startsWith('/api/')" server.ts || echo "AFFECTED: catch-all renders SPA for asset/api/unknown paths"
test -f public/favicon.svg || echo "AFFECTED: no favicon"
```

**Fix**

a) Add static assets. Create `public/favicon.svg` and `public/robots.txt` (copy
from upstream). Vite serves `public/` in dev; `vite build` copies it into
`dist/client` for prod.

b) Guard the SSR catch-all in `server.ts`. Add this constant near the top:

```ts
// Requests with a file extension that reach the SSR catch-all are misses
// (favicon.ico, source maps, stray .png). Render the SPA only for extension-less
// paths so these 404 fast instead of returning a full HTML doc with status 200.
const LOOKS_LIKE_FILE = /\.[a-zA-Z0-9]+$/
```

and make the final `app.use(async (req, res) => { ... })` handler start with:

```ts
  app.use(async (req, res) => {
    // Unmatched API routes return JSON, never the HTML SPA.
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    // Only GET requests for extension-less paths are SSR navigations.
    if (req.method !== 'GET' || LOOKS_LIKE_FILE.test(req.path)) {
      res.status(404).type('txt').end('Not found')
      return
    }
    // ...existing SSR render...
```

c) Return the real status from SSR. In `src/entry-server.tsx`, have `render()`
return `status: routerContext.statusCode` alongside `html`/`dehydratedState`, and
in `server.ts` use it: `res.status(status).set(...)` instead of a hardcoded
`res.status(200)`. Pair this with the root `ErrorBoundary` from §8 so unmatched
routes render a real 404 page. (If you skip §8, at minimum the status will be
correct.)

**Verify**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/favicon.svg        # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/favicon.ico        # 404 (fast, not HTML)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/does-not-exist     # 404
```

---

## 6. Medium — `<head>` polish

`index.html` has no favicon link, description, or theme color. Add to `<head>`:

```html
<meta name="color-scheme" content="light dark" />
<meta name="theme-color" content="#0a0a0a" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<meta name="description" content="..." />
<meta property="og:title" content="..." />
<meta property="og:description" content="..." />
<meta property="og:type" content="website" />
```

---

## Recommended upgrades (opt-in — copy from upstream)

These aren't bug fixes, but they're why the template got better. Each is
self-contained; copy the file(s) from a fresh upstream clone and rename tokens.

| Upgrade                                      | Files to copy                  | Wiring                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **7. Logging + `/healthz` + startup banner** | `server/logger.ts`             | In `server.ts`: `app.use(requestLogger(isProd))` first; add the `/healthz` route; replace the plain listen `console.log` with `startupBanner(...)`; use `log.*`/`formatError` for errors.                                                                                                                                 |
| **8. 404 / error boundary**                  | `src/app/error-boundary.tsx`   | In `routes.tsx`: `import { RouteErrorBoundary }` and add `ErrorBoundary: RouteErrorBoundary` to the root route. Requires the SSR `status` change from §5c for correct 404 codes.                                                                                                                                          |
| **9. Clone→rename init script**              | `scripts/init.ts`              | Add `"init": "bun scripts/init.ts"` to `package.json` scripts.                                                                                                                                                                                                                                                            |
| **10. E2E + screenshot tracking**            | `playwright.config.ts`, `e2e/` | `bun add -d @playwright/test && bunx playwright install chromium`. Add `test:e2e*` scripts. Create the test DB: `createdb <name>_test && DATABASE_URL=...<name>_test bunx prisma db push`. Generate baselines: `bun run test:e2e:update`. Gitignore `test-results`/`playwright-report`; **commit** `e2e/__screenshots__`. |
| **11. Project docs**                         | `cliffnotes.md`, `ui.md`       | Refresh for your project (the cliffnotes plugin reads them).                                                                                                                                                                                                                                                              |

Also worth syncing from upstream: the updated `CLAUDE.md`, `README.md`, and
`.gitignore` (adds the Playwright artifact ignores).

---

## Final verification checklist

```bash
bun install
bun run typecheck          # clean
bun run build              # dist/client + dist/server
bun run dev                # banner prints; visit /, /dashboard, a bad URL
# in another shell:
curl -s http://localhost:3000/healthz                                   # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/auth/get-session   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/favicon.ico            # 404
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/nope                   # 404
bun run test:e2e           # if you adopted §10
```

Manual: sign up → land on dashboard → create a post → sign out → nav shows "Sign in".
If all of that holds, the clone is current.
