# Handback

**Record a bug in your own words. Your agent fixes it. You sign off.**

Handback is the cloud workspace for _walkthroughs_ — ninety-second narrated walkthroughs of something broken. You hit record in the browser extension, talk through the bug in the app where it happens, and the recorder captures the whole thing: screen video, keyframes, a transcript of what you said, the DOM events you triggered, and the console errors that fired while you were speaking. It bundles that into a folder with a `report.md` written for a coding agent rather than a human bug tracker.

The `handback` CLI pushes that folder here, where it lands in a shared inbox and auto-files to the right project by the origin it was recorded on. Your coding agent then pulls the brief over MCP — report, transcript, keyframes, video — opens the fix, and flips the walkthrough to `in_review`. A human watches the before-video against the fix and marks it `resolved`. See it, say it, the agent fixes it, you sign off. Nothing merges without a person in the loop.

## Quickstart (dev)

Requires [Bun](https://bun.sh) ≥ 1.3, a reachable Postgres, and an S3 bucket.

```bash
bun install
cp .env.example .env         # then fill in every key from the table below
createdb handback
bun run db:push              # sync prisma/schema.prisma to Postgres
bun cli/dev-bootstrap.ts     # creates a user + org, prints an hb_… API token
bun run dev                  # → https://handback.localhost (portless)
```

`dev-bootstrap` is idempotent and prints a fresh token each run; the default login is `dev@handback.local` / `handback-dev-password`. Copy the token — it is only shown once, and everything below needs it.

The server validates its environment at import (`server/env.ts`), so a missing `S3_BUCKET` or AWS credential means no boot rather than a failure at first upload.

## Pushing a walkthrough

Point the CLI at a folder the recorder wrote (`report.md` + one `rec-NN/` per take):

```bash
bun cli/push.ts ./2026-07-29-1412-checkout-hangs \
  --server https://handback.localhost \
  --token hb_…
```

Both flags fall back to `HANDBACK_SERVER` and `HANDBACK_TOKEN`, so in practice you export the token once and run `bun cli/push.ts <folder>`. Push is a two-phase upload: it declares the walkthrough and its file list, `PUT`s every file straight to S3 through presigned URLs (six at a time), then finalizes. Re-pushing the same folder replaces the previous upload wholesale rather than duplicating it. On success it prints the workspace URL for the new walkthrough.

## Connecting your agent

The hosted MCP server at `https://handback.dev/mcp` is the way in — nothing to clone, nothing to install. Add it once:

```bash
claude mcp add --transport http handback https://handback.dev/mcp \
  --header "Authorization: Bearer hb_…"
```

The token comes from [https://handback.dev/connect](https://handback.dev/connect): one button mints an auto-named token and renders that exact command with the token filled in, Copy in place — nothing gets installed. The endpoint speaks StreamableHTTP and is stateless (a fresh server per request), so any MCP client that can carry a bearer header works.

For local development against a server you're running yourself, `cli/mcp.ts` is the same tools over stdio. Register it with an absolute path:

```bash
claude mcp add handback \
  --env HANDBACK_TOKEN=hb_… \
  --env HANDBACK_SERVER=https://handback.localhost \
  -- bun /abs/path/to/cli/mcp.ts
```

`HANDBACK_SERVER` defaults to `https://handback.dev`; `HANDBACK_TOKEN` is required. Either way, the same six tools:

| tool                     | what it does                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `list_walkthroughs`      | Walkthroughs across your personal space and every team your token reaches, newest first; each carries its `space`. Optional `status` filter. |
| `get_walkthrough`        | One walkthrough's full brief: metadata, the `report.md` authored for agents, and presigned URLs for every file (video, keyframes, transcript). |
| `set_walkthrough_status` | Move a walkthrough through review — `in_review` when a fix is up, `resolved` after human sign-off.                                 |
| `post_result`            | Post what you did for the reviewer to sign off on — a summary plus optional PR url, files touched, and a longer markdown body; also flips an open walkthrough to `in_review`. |
| `ask_reviewer`           | Ask the human a clarifying question instead of guessing; the walkthrough moves to `needs_info`, the reviewer is emailed, and their answer lands in the review thread. |
| `attach_evidence`        | Get presigned PUT urls for up to 4 proof screenshots (before/after, the fixed screen); upload each, then pass the returned paths as `post_result`'s `evidence`. |

The token pins the caller, so an agent sees its owner's personal space and every team they belong to (a platform-admin token spans everything). File URLs are short-lived presigned GETs; the bucket blocks all public access.

## Architecture

```
browser extension          cli/push.ts              Handback (Express 5 + Bun)      your agent
─────────────────          ───────────              ─────────────────────────      ──────────
record + narrate  ──folder──▶  declare  ──────────▶  Postgres (metadata)
                               PUT files ─────────▶  S3 (video, frames, report)
                               finalize  ──────────▶  walkthrough becomes visible
                                                          │
                                                     web workspace  ◀── human reviews + signs off
                                                          │
                                                     cli/mcp.ts  ◀────── MCP: pull brief, set status
```

One Express server runs in dev (Vite middleware) and prod (static + SSR bundle). Metadata lives in Postgres via Prisma; no file bytes ever touch the database. Every object sits under `orgs/<orgId>/walkthroughs/<walkthroughId>/<path>` in S3 and is only ever reachable through a short-lived presigned URL.

Two auth paths, deliberately separate: humans get a better-auth session cookie and talk to tRPC at `/api/trpc/*`; machines (the CLI, the MCP server) carry a bearer `hb_…` token to the REST router at `/api/ingest/*`.

| surface            | route                                                        | who                   |
| ------------------ | ------------------------------------------------------------ | --------------------- |
| Landing            | `/`                                                          | anyone                |
| Inbox              | `/app`                                                       | signed-in             |
| Walkthrough viewer | `/walkthroughs/:walkthroughId`                               | signed-in             |
| Projects           | `/projects`                                                  | signed-in             |
| Team + tokens      | `/team`                                                      | signed-in             |
| Ingest (write)     | `POST /api/ingest/walkthroughs`, `…/:id/finalize`            | `hb_…` token          |
| Ingest (read)      | `GET /api/ingest/walkthroughs`, `…/:id`, `POST …/:id/status` | `hb_…` token          |
| Health             | `/healthz`                                                   | anyone (pings the DB) |

## Environment

Validated by `server/env.ts` at import — all of these must be set for the server to start.

| key                     | notes                                                         |
| ----------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`          | Postgres connection string.                                   |
| `BETTER_AUTH_SECRET`    | 32+ random chars. `openssl rand -base64 32`.                  |
| `BETTER_AUTH_URL`       | Public origin. Dev: `https://handback.localhost` (portless).  |
| `AWS_REGION`            | Defaults to `us-west-2`.                                      |
| `S3_BUCKET`             | Bucket holding walkthrough payloads. Block all public access. |
| `AWS_ACCESS_KEY_ID`     | Credential for that bucket.                                   |
| `AWS_SECRET_ACCESS_KEY` | Credential for that bucket.                                   |

The CLI and MCP server read `HANDBACK_SERVER` and `HANDBACK_TOKEN` instead — they are clients, not the server, and never touch the database directly.

## Scripts

| script              | what it does                                              |
| ------------------- | --------------------------------------------------------- |
| `bun run dev`       | dev server with HMR + SSR at https://handback.localhost   |
| `bun run build`     | build client (`dist/client`) + SSR bundle (`dist/server`) |
| `bun run start`     | production server                                         |
| `bun run typecheck` | `tsgo --noEmit`                                           |
| `bun run test:e2e`  | Playwright e2e + screenshot comparison                    |
| `bun run db:push`   | push `prisma/schema.prisma` to Postgres (dev)             |
| `bun run db:studio` | Prisma Studio                                             |
| `bun run prettier`  | format the repo                                           |

Deeper briefing for contributors → [`CLAUDE.md`](./CLAUDE.md) · project map → [`cliffnotes.md`](./cliffnotes.md) · visual language → [`ui.md`](./ui.md).
