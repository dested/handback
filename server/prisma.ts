import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { env } from './env'

// Singleton across HMR reloads — without this, vite dev creates a new
// PrismaClient on every change and exhausts Postgres connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export type DB = typeof prisma
