// Org access checks shared by the tRPC routers. Every org-scoped procedure
// resolves membership exactly once and trusts nothing from the client but ids.

import { TRPCError } from '@trpc/server'
import { prisma } from './prisma'

export type Role = 'owner' | 'admin' | 'member'

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 }

export async function requireMembership(
  userId: string,
  orgId: string,
  atLeast: Role = 'member'
): Promise<{ role: Role }> {
  const m = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true },
  })
  if (!m) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this org' })
  const role = m.role as Role
  if (RANK[role] < RANK[atLeast]) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Requires ${atLeast} role` })
  }
  return { role }
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'org'
  )
}
