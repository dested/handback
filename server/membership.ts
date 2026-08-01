// Org access checks shared by the tRPC routers. Every org-scoped procedure
// resolves membership exactly once and trusts nothing from the client but ids.

import { TRPCError } from '@trpc/server'
import { isPlatformAdmin } from './features'
import { prisma } from './prisma'

export type Role = 'owner' | 'admin' | 'member'

export type Access = {
  role: Role
  // null = whole workspace; otherwise the only projectIds this member sees
  projectIds: string[] | null
}

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 }

async function findAccess(userId: string, orgId: string): Promise<Access | null> {
  const m = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true, scope: true, projectAccess: { select: { projectId: true } } },
  })
  if (!m) return null
  // Guests never outrank member, whatever the stored role says.
  const scoped = m.scope === 'projects'
  return {
    role: scoped ? 'member' : (m.role as Role),
    projectIds: scoped ? m.projectAccess.map((a) => a.projectId) : null,
  }
}

export async function requireMembership(
  userId: string,
  orgId: string,
  atLeast: Role = 'member'
): Promise<Access> {
  const access = await findAccess(userId, orgId)
  if (!access) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this org' })
  if (RANK[access.role] < RANK[atLeast]) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Requires ${atLeast} role` })
  }
  return access
}

/**
 * Read access with the platform-admin escape hatch: a Handback admin can *look
 * at* any workspace's walkthrough from /admin without being a member of it. Deliberately
 * read-only — every mutation still goes through `requireMembership`, so support
 * can see a recording but can't retitle, retriage, move or delete it. `isMember`
 * is false on the bypass path so the viewer can say so out loud.
 */
export async function requireViewAccess(
  userId: string,
  orgId: string
): Promise<{ access: Access; isMember: boolean }> {
  const access = await findAccess(userId, orgId)
  if (access) return { access, isMember: true }
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, isAdmin: true },
  })
  if (u && isPlatformAdmin(u))
    return { access: { role: 'owner', projectIds: null }, isMember: false }
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this org' })
}

/** Rejects guests — for operations that touch the whole workspace. */
export function requireOrgScope(access: Access): void {
  if (access.projectIds) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires full workspace access' })
  }
}

export function canSeeWalkthrough(access: Access, projectId: string | null): boolean {
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
