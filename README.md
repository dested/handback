# inloop

An SSR React starter wired with a current, type-safe stack — clone it, rename it, ship.

> Already have a project cloned from an older inloop? See [`MIGRATION.md`](./MIGRATION.md) to bring it up to date (it fixes some app-breaking bugs).

| layer             | choice                                                                             |
| ----------------- | ---------------------------------------------------------------------------------- |
| runtime / pkg mgr | **Bun** ≥ 1.3 (dev + prod)                                                         |
| server            | **Express 5** + **Vite** SSR (vite middleware in dev, static + SSR bundle in prod) |
| routing           | **React Router 7** (`createBrowserRouter` client, `createStaticHandler` server)    |
| data              | **tRPC v11** + **TanStack Query** (`.queryOptions()` API)                          |
| db                | **Postgres** + **Prisma 7** (pg driver adapter)                                    |
| auth              | **better-auth** (email + password, autoSignIn)                                     |
| styles            | **Tailwind v4** + **shadcn/ui** (new-york, oklch tokens)                           |
| tests             | **Playwright** e2e with committed screenshot baselines                             |
| deploy            | **Render.com** blueprint (web service + managed Postgres)                          |

## Quickstart

Requires [Bun](https://bun.sh) ≥ 1.3 and a reachable Postgres.

**Start a new project from this template (recommended):**

```bash
bun install
bun run init my-app          # renames everything + writes a fresh .env (new secret)
createdb my_app              # or point .env's DATABASE_URL at any Postgres
bun run db:push              # sync schema to the database
bun run dev                  # → http://localhost:3000
```

`bun run init my-app --fresh-git` also wipes the template's git history and starts a clean repo.

**Or set it up by hand:**

```bash
bun install
cp .env.example .env         # then edit: DATABASE_URL + a 32+ char BETTER_AUTH_SECRET
bun run db:push
bun run dev
```

Generate a secret: `openssl rand -base64 32`.

## Scripts

| script                    | what it does                                              |
| ------------------------- | --------------------------------------------------------- |
| `bun run dev`             | dev server with HMR + SSR on :3000                        |
| `bun run init <name>`     | rename the template to a new project + fresh `.env`       |
| `bun run build`           | build client (`dist/client`) + SSR bundle (`dist/server`) |
| `bun run start`           | run the production server (`NODE_ENV=production`)         |
| `bun run typecheck`       | `tsgo --noEmit` (TypeScript Native Preview)               |
| `bun run test:e2e`        | Playwright e2e + screenshot comparison                    |
| `bun run test:e2e:update` | regenerate screenshot baselines                           |
| `bun run db:push`         | push `prisma/schema.prisma` to Postgres (dev)             |
| `bun run db:migrate`      | create + apply a migration (dev)                          |
| `bun run db:generate`     | regenerate the Prisma client (auto-runs on install)       |
| `bun run db:studio`       | Prisma Studio                                             |
| `bun run prettier`        | format the repo                                           |

## Layout

```
server.ts                Express entry — request logging, /healthz, auth + tRPC
                         mounts, vite/SSR, startup banner. Runs in dev AND prod.
server/
├── env.ts               zod-validated env (throws at import if invalid)
├── logger.ts            color request logging, startup banner, error formatting
├── prisma.ts            PrismaClient singleton (HMR-safe, pg adapter)
├── auth.ts              better-auth instance + Session type
├── trpc.ts              context + initTRPC + public/protected procedures
└── router.ts            appRouter (exports AppRouter type)

src/
├── index.tsx            client entry (hydrateRoot + createBrowserRouter)
├── entry-server.tsx     SSR entry (createStaticHandler + renderToString)
├── App.tsx              providers (QueryClient + tRPC + hydration)
├── app/
│   ├── routes.tsx       RouteObject[] tree + loaders
│   ├── layout.tsx       root layout (nav + <Outlet/>)
│   ├── error-boundary.tsx  404 + error UI (root ErrorBoundary)
│   ├── home.tsx · sign-in.tsx · sign-up.tsx · dashboard.tsx
├── components/ui/       shadcn primitives
├── lib/                 auth-client, trpc, utils
└── styles/app.css       Tailwind v4 + shadcn tokens

public/                  favicon.svg, robots.txt (served statically)
e2e/                     Playwright specs + committed __screenshots__ baselines
scripts/init.ts          the clone→rename initializer
prisma/schema.prisma     User / Session / Account / Verification + Post
```

## How it fits together

**Auth.** Sign-in/up call `authClient` → POST `/api/auth/*` (mounted via `toNodeHandler(auth)`) → session cookie. On SSR, `entry-server.tsx` reads the session once per request and passes it to loaders, so the first paint already knows who you are (no flicker). On client navigations, loaders re-check via `authClient.getSession()`.

**tRPC.** Components call `useQuery(trpc.posts.list.queryOptions())` → `/api/trpc/*` → `appRouter`. `createContext` attaches the session; `protectedProcedure` 401s without one.

**SSR + hydration.** Loaders prefetch tRPC queries into a per-request `QueryClient` (via a direct, no-HTTP options proxy). The cache is dehydrated into `window.__SSR_STATE__` and rehydrated on the client, so `useQuery` has data on first render. Procedures return JSON-safe types (dates as ISO strings) to keep SSR and client markup identical.

**Logging.** Every request logs one color-coded line (`method · status · path · timing`), with dev asset noise filtered out. The server prints a startup banner (mode, URLs, db host, routes). See `server/logger.ts`.

**404 / errors.** Unknown pages render the root `ErrorBoundary` with a real 404 status; asset-shaped misses (`/favicon.ico`, stray files) 404 fast instead of rendering the SPA; unknown `/api/*` returns JSON.

## Testing

Playwright e2e lives in `e2e/`. `bun run test:e2e` boots the app on port 3100 against an **isolated test database** (`inloop_test`), truncates it for determinism, and runs the smoke suite — home, sign-up → dashboard → create post → sign-out, and the 404 page. Visual baselines are committed under `e2e/__screenshots__/`; update them with `bun run test:e2e:update`.

```bash
createdb inloop_test
DATABASE_URL=postgres://.../inloop_test bunx prisma db push
bun run test:e2e
```

Screenshots are OS/font specific — regenerate on the platform your CI uses.

## Deploy to Render

1. Push to GitHub.
2. Render → **Blueprints → New Blueprint Instance**, point at the repo. `render.yaml` provisions managed Postgres + a web service. `/healthz` is the health check.
3. After the first deploy, set `BETTER_AUTH_URL` to the assigned public URL and redeploy.

`preDeployCommand` runs `prisma db push --accept-data-loss` (fine for a starter — switch to `prisma migrate deploy` with committed migrations for real production). Render uses `runtime: node` with `BUN_VERSION` set, because there's no `runtime: bun` — the Node runtime ships Bun and puts it on PATH.

## Gotchas

- **Express 5 is required** — the route patterns (`/api/auth/*splat`) use named wildcards. Don't downgrade to Express 4.
- **`.env` loading**: Bun loads `.env` into its own runtime but not into the Prisma CLI (a Node subprocess), and Prisma 7 dropped auto-loading — so `prisma.config.ts` loads `.env` itself. Keep that block if you touch the file.
- **Server-only code lives in `./server/`** — never import it from `src/*.tsx` except as `import type`, or it lands in the client bundle. See `CLAUDE.md` for the full rules.
- Path alias `~/*` → `src/*` (client only); server code uses relative imports.

For the deeper "how to extend this" briefing (hard rules, common tasks, architecture flows), read [`CLAUDE.md`](./CLAUDE.md) and [`cliffnotes.md`](./cliffnotes.md).
