# CLAUDE.md

Briefing for an LLM working in this repo. **Read `cliffnotes.md` first** — it is the living map
(what exists, where, gotchas). `ui.md` is the visual law for anything user-facing. `decisions.md`
records settled choices; don't reverse one silently. Append to `updates.md` when you finish a task.

## What this is

**Handback** (handback.dev, formerly Inloop) — the cloud workspace where recorded gripes
(narrated screen walkthroughs from the bundled recorder extension) are uploaded to S3/Postgres,
reviewed by humans, and pulled by coding agents over MCP. Built on dested/sal-starter: Bun · Express 5 + Vite SSR · React Router 7 · tRPC v11 ·
Prisma 7 + Postgres · better-auth · Tailwind v4.

## Non-negotiables

- **UI is light-only. No dark mode. Nothing orange.** (ui.md; owner's explicit directive.)
- `./server/*` is server-only — import into `src/*` only as `import type`.
- tRPC returns must be JSON-safe (Dates → ISO strings, BigInt → Number) or SSR hydration diverges.
- Path alias `~/*` → `src/*` (client only); server uses relative imports.
- Express 5 required (`*splat` wildcards); better-auth mounts before `express.json()`.
- `bun run typecheck` must pass before any task is "done"; run `bun run db:generate` after schema
  edits.
- Secrets live in `.env` only (S3 keys, DB url). Never commit them; never print raw API tokens
  except at creation.

## Commands

`bun run dev` (:3995) · `bun run typecheck` · `bun run db:push` / `db:generate` ·
`bun cli/dev-bootstrap.ts` (seed login + token) · `bun cli/push.ts <folder>` (upload a gripe) ·
`E2E_DATABASE_URL=… bun run test:e2e` (isolated DB :3100).
