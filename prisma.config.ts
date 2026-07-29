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
