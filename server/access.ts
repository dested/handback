// Space access checks shared by the tRPC routers and the token APIs. A space is
// either a team or one account's personal space (`{ teamId: null, userId }`);
// every space-scoped procedure resolves access exactly once and trusts nothing
// from the client but ids.

import { TRPCError } from '@trpc/server'
import { isPlatformAdmin } from './features'
import { prisma } from './prisma'

export type Role = 'owner' | 'admin' | 'member'

/** Exactly one of the two is set. */
export type SpaceOwner = { teamId: string | null; userId: string | null }

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 }

/**
 * The caller's effective role in a team. "owner" is never stored on the
 * membership row — Team.ownerId is authoritative — but the owner holds a
 * membership too, so the roster and the role agree.
 */
export async function requireTeamRole(
  userId: string,
  teamId: string,
  atLeast: Role = 'member'
): Promise<Role> {
  const [team, membership] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId }, select: { ownerId: true } }),
    prisma.membership.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { role: true },
    }),
  ])
  if (!team) throw new TRPCError({ code: 'NOT_FOUND' })
  const isOwner = team.ownerId === userId
  if (!membership && !isOwner) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this team' })
  }
  const role: Role = isOwner ? 'owner' : ((membership?.role ?? 'member') as Role)
  if (RANK[role] < RANK[atLeast]) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Requires ${atLeast} role` })
  }
  return role
}

/** Access to either kind of space. A personal space admits only its owner. */
export async function requireSpaceAccess(
  userId: string,
  space: SpaceOwner,
  atLeast: Role = 'member'
): Promise<Role> {
  if (space.userId !== null) {
    if (space.userId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your space' })
    }
    // You are the whole space, so no `atLeast` can fail.
    return 'owner'
  }
  if (space.teamId === null) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unowned space' })
  return await requireTeamRole(userId, space.teamId, atLeast)
}

/**
 * Read access with the platform-admin escape hatch: a Handback admin can *look
 * at* any space's walkthrough from /admin without belonging to it. Deliberately
 * read-only — every mutation still goes through `requireSpaceAccess`, so support
 * can see a recording but can't retitle, retriage, move or delete it. `isMember`
 * is false on the bypass path so the viewer can say so out loud.
 */
export async function requireViewAccess(
  userId: string,
  space: SpaceOwner
): Promise<{ role: Role; isMember: boolean }> {
  try {
    return { role: await requireSpaceAccess(userId, space), isMember: true }
  } catch {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isAdmin: true },
    })
    if (u && isPlatformAdmin(u)) return { role: 'owner', isMember: false }
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this space' })
  }
}

/** Every team the account can reach — the team half of a token's reach. */
export async function memberTeamIds(userId: string): Promise<string[]> {
  const rows = await prisma.membership.findMany({ where: { userId }, select: { teamId: true } })
  return rows.map((m) => m.teamId)
}

/** The S3 path segment for a space: the team id, or the owner's user id. */
export function spaceId(space: SpaceOwner): string {
  const id = space.teamId ?? space.userId
  if (id === null) throw new Error('space has neither teamId nor userId')
  return id
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'team'
  )
}
