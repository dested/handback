// Workspace provisioning. Every account owns a personal workspace — a workspace
// with exactly one member and no invites — so a fresh sign-up lands in an inbox
// instead of on a naming screen. Teams are the explicit, entitled thing.

import { slugify } from './membership'
import { prisma } from './prisma'

function personalName(userName: string): string {
  const first = userName.trim().split(/\s+/)[0]
  return first ? `${first}'s workspace` : 'Your workspace'
}

/**
 * Idempotent: a user who already holds any membership keeps that workspace.
 * Both the sign-up hook and the client-side repair path call this, and they can
 * race.
 */
export async function createPersonalOrg(userId: string, userName: string): Promise<{ id: string }> {
  const existing = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { orgId: true },
  })
  if (existing) return { id: existing.orgId }

  const name = personalName(userName)
  const base = slugify(name)
  // Suffix until free — org slugs are global.
  let slug = base
  for (let n = 2; await prisma.org.findUnique({ where: { slug } }); n++) {
    slug = `${base}-${n}`
  }

  const org = await prisma.org.create({
    data: {
      name,
      slug,
      personal: true,
      memberships: { create: { userId, role: 'owner' } },
    },
  })
  return { id: org.id }
}
