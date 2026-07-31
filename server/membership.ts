// Org access checks shared by the tRPC routers. Every org-scoped procedure
// resolves membership exactly once and trusts nothing from the client but ids.

import { TRPCError } from '@trpc/server'
import { prisma } from './prisma'

export type Role = 'owner' | 'admin' | 'member'

export type Access = {
  role: Role
  // null = whole workspace; otherwise the only projectIds this member sees
  projectIds: string[] | null
}

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 }

export async function requireMembership(
  userId: string,
  orgId: string,
  atLeast: Role = 'member'
): Promise<Access> {
  const m = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true, scope: true, projectAccess: { select: { projectId: true } } },
  })
  if (!m) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this org' })
  // Guests never outrank member, whatever the stored role says.
  const scoped = m.scope === 'projects'
  const role: Role = scoped ? 'member' : (m.role as Role)
  if (RANK[role] < RANK[atLeast]) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Requires ${atLeast} role` })
  }
  return { role, projectIds: scoped ? m.projectAccess.map((a) => a.projectId) : null }
}

/** Rejects guests — for operations that touch the whole workspace. */
export function requireOrgScope(access: Access): void {
  if (access.projectIds) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires full workspace access' })
  }
}

export function canSeeGripe(access: Access, projectId: string | null): boolean {
  return access.projectIds === null || (projectId !== null && access.projectIds.includes(projectId))
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
