# inloop — CliffNotes

> Living map of the project. Read this before any coding session.
> Last updated: 2026-06-29. Deep briefing → `CLAUDE.md` · human quickstart → `README.md`.

## What this is

An SSR React starter template — clone it, run `bun run init <name>`, and build a real product on top. The whole point is a _minimal but bulletproof_ base: Express 5 + Vite SSR, React Router 7, tRPC, Prisma 7, better-auth, Tailwind v4/shadcn. Keep files minimal; add features, don't gold-plate the scaffolding.

## Quick Reference

- **Dev:** `bun run dev` (http://localhost:3000)
- **New project:** `bun run init <name>` then `createdb <name>` → `bun run db:push` → `bun run dev`
- **Entry point:** `server.ts` (Express; same file dev + prod) → SSR via `src/entry-server.tsx`; client hydrates via `src/index.tsx`
- **Type-check:** `bun run typecheck` (`tsgo --noEmit`)
- **Build:** `bun run build` → `dist/client` + `dist/server`
- **Test:** `bun run test:e2e` (Playwright; isolated DB `inloop_test` on :3100, committed screenshots)
- **Health:** `GET /healthz` (pings the DB)
- **Day-one fact:** server-only code lives in `./server/` — never import it from `src/*.tsx` except `import type` (it'd ship to the browser / leak secrets).

## Stack

| Layer             | Choice                          | Notes                                                                                     |
| ----------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| Runtime / pkg mgr | Bun ≥ 1.3                       | dev + prod                                                                                |
| Server            | **Express 5** + Vite SSR        | required for `*splat` route wildcards                                                     |
| Routing           | React Router 7                  | `createBrowserRouter` (client) / `createStaticHandler` (server); explicit `RouteObject[]` |
| State / data      | TanStack Query + tRPC v11       | `@trpc/tanstack-react-query` (`.queryOptions()`)                                          |
| API               | tRPC, Express mounts            | `/api/trpc`, `/api/auth/*`, `/healthz`                                                    |
| Database / ORM    | Postgres + Prisma 7             | `pg` driver adapter (`@prisma/adapter-pg`)                                                |
| Auth              | better-auth                     | email + password, autoSignIn                                                              |
| Styling           | Tailwind v4 + shadcn (new-york) | CSS-first, oklch tokens; see `ui.md`                                                      |
| Tests             | Playwright                      | `e2e/` + committed `__screenshots__` baselines                                            |
| Deploy            | Render.com blueprint            | `runtime: node` + `BUN_VERSION`                                                           |

## Directory structure

```
server.ts                Express entry: request logging, /healthz, auth + tRPC mounts,
                         vite (dev) / static+SSR (prod), startup banner. Dev AND prod.
server/
├── env.ts               zod-validated env, parsed at import (throws → no boot)
├── logger.ts            ANSI request logger, startup banner, formatError
├── prisma.ts            PrismaClient singleton (HMR-safe) via pg adapter
├── auth.ts              better-auth instance + Session type
├── trpc.ts              createContext + initTRPC + public/protectedProcedure
└── router.ts            appRouter (me, posts.list, posts.create) + AppRouter type
src/
├── index.tsx            client entry — hydrateRoot + createBrowserRouter
├── entry-server.tsx     SSR entry — createStaticHandler.query + renderToString, returns {html,status,dehydratedState}
├── App.tsx              providers: QueryClientProvider + HydrationBoundary + TRPCProvider
├── app/
│   ├── routes.tsx       RouteObject[] tree + loaders (root/dashboard/redirectIfSignedIn)
│   ├── layout.tsx       nav + <Outlet/>; sign-out lives here
│   ├── error-boundary.tsx  root ErrorBoundary → 404 / error UI
│   ├── home.tsx         /
│   ├── sign-in.tsx      /sign-in
│   ├── sign-up.tsx      /sign-up
│   └── dashboard.tsx    /dashboard (protected; posts list + create form)
├── components/ui/       shadcn primitives (button, card, input, label)
├── lib/
│   ├── auth-client.ts   better-auth React client
│   ├── trpc.tsx         TRPCProvider + useTRPC
│   └── utils.ts         cn()
└── styles/app.css       Tailwind v4 import + shadcn oklch tokens
public/                  favicon.svg, robots.txt (served by vite dev / express static prod)
e2e/                     smoke.spec.ts, global-setup.ts (truncates test DB), __screenshots__/
scripts/init.ts          clone→rename initializer
index.html               SSR template — <!--app-html--> + <!--app-state--> placeholders
prisma/schema.prisma     User / Session / Account / Verification + Post
prisma.config.ts         Prisma 7 CLI config; loads .env itself (Bun/Prisma don't)
render.yaml              Render blueprint (web service + managed Postgres)
```

## File map (concept → path)

| Concept / task                    | Location                                                      |
| --------------------------------- | ------------------------------------------------------------- |
| App providers                     | `src/App.tsx`                                                 |
| Routing + loaders                 | `src/app/routes.tsx`                                          |
| New page component                | `src/app/<name>.tsx`                                          |
| 404 / error UI                    | `src/app/error-boundary.tsx`                                  |
| tRPC procedures                   | `server/router.ts`                                            |
| tRPC context / procedure builders | `server/trpc.ts`                                              |
| DB schema                         | `prisma/schema.prisma`                                        |
| Auth config                       | `server/auth.ts` (server) · `src/lib/auth-client.ts` (client) |
| HTTP mounts / SSR / 404 logic     | `server.ts`                                                   |
| Logging                           | `server/logger.ts`                                            |
| Env vars                          | `server/env.ts` + `.env.example` + `render.yaml`              |
| Design tokens                     | `src/styles/app.css` (see `ui.md`)                            |
| E2E tests                         | `e2e/*.spec.ts`                                               |

## Routes / URLs

Routes are explicit in `src/app/routes.tsx` (no file-based routing). All page routes nest under the root `Layout`.

| Route         | Serves                | File                             | Loader                                   |
| ------------- | --------------------- | -------------------------------- | ---------------------------------------- |
| `/`           | Landing               | `src/app/home.tsx`               | `rootLoader` (session)                   |
| `/sign-in`    | Sign in               | `src/app/sign-in.tsx`            | `redirectIfSignedIn`                     |
| `/sign-up`    | Sign up               | `src/app/sign-up.tsx`            | `redirectIfSignedIn`                     |
| `/dashboard`  | Protected app         | `src/app/dashboard.tsx`          | `dashboardLoader` (redirects + prefetch) |
| `/healthz`    | DB health JSON        | `server.ts`                      | —                                        |
| `/api/auth/*` | better-auth           | `server.ts` (`toNodeHandler`)    | —                                        |
| `/api/trpc/*` | tRPC                  | `server.ts` → `server/router.ts` | —                                        |
| unmatched GET | 404 page (status 404) | `error-boundary.tsx`             | —                                        |

## Architecture

Browser ↔ Express 5 (`server.ts`) ↔ Postgres. One Express server runs in dev (Vite middleware + `ssrLoadModule`) and prod (static `dist/client` + built `dist/server/entry-server.js`), gated on `NODE_ENV`. SSR: `render(req)` builds a Fetch Request, runs `createStaticHandler(routes).query()` to execute loaders (session + tRPC prefetch happen here), `renderToString`s with `<StaticRouterProvider>`, and dehydrates the QueryClient into `window.__SSR_STATE__`. The client rehydrates that cache, so `useQuery` has data on first paint. The SSR-side tRPC options proxy calls procedures **directly** (no HTTP).

## Data model

`prisma/schema.prisma` — better-auth's required models (`User`, `Session`, `Account`, `Verification`) mapped to lowercase tables via `@@map`; fields are camelCase (better-auth queries by name) with snake_case `@map` columns. App model: `Post` (id, title, content, `authorId` → User `onDelete: Cascade`, createdAt). FK relations to `User` should cascade.

## Systems

### Auth (better-auth)

Email + password, `autoSignIn` on sign-up. Client (`auth-client.ts`) → `/api/auth/*` (`toNodeHandler`, mounted before `express.json`). SSR reads the session once per request; loaders get it via `requestContext`; the root loader returns `{ session }`, read with `useRouteLoaderData('root')`. **Lives in:** `server/auth.ts`, `src/lib/auth-client.ts`, `src/app/{sign-in,sign-up,layout}.tsx`. Sign-in/up/out all call `revalidator.revalidate()` so the nav reflects the new session.

### tRPC

`publicProcedure` / `protectedProcedure` (401 without session). Context attaches the session from request headers. **Lives in:** `server/trpc.ts`, `server/router.ts`, `src/lib/trpc.tsx`.

### Logging & errors

Dependency-free ANSI logger: one line per request (method · status · path · timing), startup banner, `formatError`. Loader/render errors and unmatched routes render the root `ErrorBoundary`. **Lives in:** `server/logger.ts`, `src/app/error-boundary.tsx`.

## Common tasks (how to modify)

### Add a route

1. Create `src/app/<name>.tsx` exporting `<NamePage>`.
2. Add `{ path: '<name>', Component: NamePage }` to `routes.tsx` (add a `loader` for auth/data).

### Add a tRPC procedure

Add to `appRouter` in `server/router.ts`; pick public/protected; validate input with zod; return JSON-safe data (dates → ISO strings).

### Add a DB table

Edit `prisma/schema.prisma` → `bun run db:push` → `bun run db:generate` → use `prisma.x` in procedures.

### Add an e2e test

Add `e2e/*.spec.ts`; screenshot only stable views; `bun run test:e2e:update` to write baselines.

## Gotchas & hard rules

- **Path alias `~/*` → `src/*`** (client only); server uses relative imports.
- **`./server/*` is server-only** — import into `src/*` only as `import type`.
- **Express 5 required** — `*splat` wildcards break on Express 4 (symptom: `/api/auth/*` 404s, auth dead).
- **`.env` loading**: Bun loads `.env` only into its own runtime, not the Prisma CLI (Node subprocess); Prisma 7 dropped auto-loading — `prisma.config.ts` loads it manually. Keep that block.
- **Run `bun run db:generate` after schema edits** (auto-runs on `bun install`).
- **JSON-safe tRPC returns** — convert `Date` → ISO string at the procedure, or SSR/hydration markup diverges.
- **shadcn has no `asChild`** (no `@radix-ui/react-slot`) — style a `Link` with `buttonVariants()`.
- **No `tailwind.config`** — Tailwind v4, tokens in `app.css`.
- Use `log.*` from `server/logger.ts`, not raw `console.log`, in server code.

## Status

- **Done** — SSR + hydration, auth (email/pw), tRPC posts demo, logging, /healthz, 404/error handling, favicon/robots, init script, Playwright e2e + screenshot baselines, Render blueprint. Express 5 + Prisma 7.
- **Not built** — email verification, OAuth providers, rate limiting, migrations workflow (uses `db push`), CI, dark-mode toggle (tokens exist, unused).
- **Next:** whatever the cloned product needs — this is a base.
