import { createHash, randomBytes } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { inviteEmail, sendEmail } from './email'
import { env } from './env'
import { isPlatformAdmin, orgHasFeature, requireAdmin, userHasFeature } from './features'
import { canSeeGripe, requireMembership, requireOrgScope, slugify } from './membership'
import { prisma } from './prisma'
import { deletePrefix, gripeKey, gripePrefix, isSafePath, presignGet } from './storage'
import { protectedProcedure, publicProcedure, router } from './trpc'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Dates go over the wire as ISO strings so SSR-rendered HTML and React Query's
// post-hydration render produce identical markup.
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

const orgsRouter = router({
  /** Orgs the signed-in user belongs to, with their role. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: ctx.session.user.id },
      include: { org: true },
      orderBy: { createdAt: 'asc' },
    })
    // Entitlements live on the owner, so a workspace inherits whatever its
    // owner has been granted.
    const owners = await prisma.membership.findMany({
      where: { orgId: { in: memberships.map((m) => m.orgId) }, role: 'owner' },
      select: { orgId: true, user: { select: { email: true, isAdmin: true, features: true } } },
    })
    const teamByOrg = new Map(owners.map((o) => [o.orgId, userHasFeature(o.user, 'team')]))
    return memberships.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      // Clamped like requireMembership: a guest's stored role never leaks as
      // anything above member, so the client can't render admin controls.
      role: m.scope === 'projects' ? 'member' : m.role,
      scope: m.scope,
      teamEnabled: teamByOrg.get(m.org.id) ?? false,
    }))
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const base = slugify(input.name)
      // Suffix until free — org slugs are global.
      let slug = base
      for (let n = 2; await prisma.org.findUnique({ where: { slug } }); n++) {
        slug = `${base}-${n}`
      }
      const org = await prisma.org.create({
        data: {
          name: input.name,
          slug,
          memberships: { create: { userId: ctx.session.user.id, role: 'owner' } },
        },
      })
      return { id: org.id, name: org.name, slug: org.slug }
    }),

  members: protectedProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ ctx, input }) => {
      const access = await requireMembership(ctx.session.user.id, input.orgId)
      const rows = await prisma.membership.findMany({
        // Guests only see who shares their slice: full members plus guests
        // with an overlapping project — not the whole roster's emails.
        where: {
          orgId: input.orgId,
          ...(access.projectIds
            ? {
                OR: [
                  { scope: 'org' },
                  { projectAccess: { some: { projectId: { in: access.projectIds } } } },
                ],
              }
            : {}),
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          projectAccess: { select: { project: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      })
      return rows.map((m) => ({
        membershipId: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        scope: m.scope,
        projects: m.projectAccess.map((a) => a.project),
        joinedAt: m.createdAt.toISOString(),
      }))
    }),

  setRole: protectedProcedure
    .input(
      z.object({
        orgId: z.string(),
        membershipId: z.string(),
        role: z.enum(['admin', 'member']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.session.user.id, input.orgId, 'owner')
      const target = await prisma.membership.findUnique({ where: { id: input.membershipId } })
      if (!target || target.orgId !== input.orgId) throw new TRPCError({ code: 'NOT_FOUND' })
      if (target.role === 'owner') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Owners cannot be demoted here' })
      }
      if (target.scope === 'projects') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Project guests are always members' })
      }
      await prisma.membership.update({ where: { id: target.id }, data: { role: input.role } })
      return { ok: true }
    }),

  setAccess: protectedProcedure
    .input(
      z.object({
        orgId: z.string(),
        membershipId: z.string(),
        // null = entire workspace; ids = guest scoped to exactly these projects
        projectIds: z.array(z.string()).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await requireMembership(ctx.session.user.id, input.orgId, 'admin')
      const target = await prisma.membership.findUnique({ where: { id: input.membershipId } })
      if (!target || target.orgId !== input.orgId) throw new TRPCError({ code: 'NOT_FOUND' })
      if (target.role === 'owner') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'The owner always has full access' })
      }
      if (target.role === 'admin' && input.projectIds && actor.role !== 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner can restrict an admin' })
      }
      const ids = input.projectIds
      if (ids) {
        const count = await prisma.project.count({
          where: { orgId: input.orgId, id: { in: ids } },
        })
        if (count !== ids.length) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown project' })
        }
      }
      await prisma.$transaction(async (tx) => {
        if (ids) {
          // Restricting an admin demotes them — guests are always members.
          await tx.membership.update({
            where: { id: target.id },
            data: { scope: 'projects', role: 'member' },
          })
          await tx.projectAccess.deleteMany({
            where: { membershipId: target.id, projectId: { notIn: ids } },
          })
          await tx.projectAccess.createMany({
            data: ids.map((projectId) => ({ membershipId: target.id, projectId })),
            skipDuplicates: true,
          })
        } else {
          await tx.membership.update({ where: { id: target.id }, data: { scope: 'org' } })
          await tx.projectAccess.deleteMany({ where: { membershipId: target.id } })
        }
      })
      // Restriction closes the org-wide side door too: their hb_ tokens read
      // the whole org through /api/ingest.
      if (ids) {
        await prisma.apiToken.updateMany({
          where: { orgId: input.orgId, userId: target.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        })
      }
      return { ok: true }
    }),

  removeMember: protectedProcedure
    .input(z.object({ orgId: z.string(), membershipId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.session.user.id, input.orgId, 'admin')
      const target = await prisma.membership.findUnique({ where: { id: input.membershipId } })
      if (!target || target.orgId !== input.orgId) throw new TRPCError({ code: 'NOT_FOUND' })
      if (target.role === 'owner') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'The owner cannot be removed' })
      }
      await prisma.membership.delete({ where: { id: target.id } })
      // Their org tokens die with the membership — a live token would keep
      // reading the whole org through /api/ingest.
      await prisma.apiToken.updateMany({
        where: { orgId: input.orgId, userId: target.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      return { ok: true }
    }),
})

const invitesRouter = router({
  list: protectedProcedure.input(z.object({ orgId: z.string() })).query(async ({ ctx, input }) => {
    await requireMembership(ctx.session.user.id, input.orgId, 'admin')
    const rows = await prisma.invite.findMany({
      where: { orgId: input.orgId, acceptedAt: null, expiresAt: { gt: new Date() } },
      include: { project: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      projectName: i.project?.name ?? null,
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt.toISOString(),
    }))
  }),

  create: protectedProcedure
    .input(
      z.object({
        orgId: z.string(),
        email: z.string().email().optional(),
        role: z.enum(['admin', 'member']).default('member'),
        projectId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.session.user.id, input.orgId, 'admin')
      if (!(await orgHasFeature(input.orgId, 'team'))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "Team is a paid feature and isn't enabled for this workspace yet.",
        })
      }
      if (input.projectId) {
        const p = await prisma.project.findUnique({ where: { id: input.projectId } })
        if (!p || p.orgId !== input.orgId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown project' })
        }
      }
      const invite = await prisma.invite.create({
        data: {
          orgId: input.orgId,
          email: input.email ?? null,
          role: input.projectId ? 'member' : input.role,
          projectId: input.projectId ?? null,
          createdById: ctx.session.user.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      })

      // An invite without an address is a link the admin copies by hand; with
      // one, we send it. Either way the link is the credential, so the row is
      // created first and the email is best-effort on top — a bounce must not
      // lose an invitation that already exists.
      let emailed = false
      if (input.email) {
        const org = await prisma.org.findUnique({
          where: { id: input.orgId },
          select: { name: true },
        })
        emailed = await sendEmail({
          to: input.email,
          ...inviteEmail({
            org: org?.name ?? 'a workspace',
            inviter: ctx.session.user.name || ctx.session.user.email,
            url: `${env.BETTER_AUTH_URL}/join/${invite.id}`,
          }),
        })
      }
      return { id: invite.id, emailed }
    }),

  revoke: protectedProcedure
    .input(z.object({ orgId: z.string(), inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.session.user.id, input.orgId, 'admin')
      await prisma.invite.deleteMany({ where: { id: input.inviteId, orgId: input.orgId } })
      return { ok: true }
    }),

  /** What a /join/<id> link points at — safe for signed-out users. */
  peek: publicProcedure.input(z.object({ inviteId: z.string() })).query(async ({ input }) => {
    const invite = await prisma.invite.findUnique({
      where: { id: input.inviteId },
      include: { org: { select: { name: true } }, project: { select: { name: true } } },
    })
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return null
    return {
      orgName: invite.org.name,
      email: invite.email,
      projectName: invite.project?.name ?? null,
    }
  }),

  accept: protectedProcedure
    .input(z.object({ inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await prisma.invite.findUnique({ where: { id: input.inviteId } })
      if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite is gone or expired' })
      }
      const existing = await prisma.membership.findUnique({
        where: { orgId_userId: { orgId: invite.orgId, userId: ctx.session.user.id } },
      })
      if (!existing) {
        await prisma.membership.create({
          data: {
            orgId: invite.orgId,
            userId: ctx.session.user.id,
            role: invite.projectId ? 'member' : invite.role,
            scope: invite.projectId ? 'projects' : 'org',
            ...(invite.projectId
              ? { projectAccess: { create: { projectId: invite.projectId } } }
              : {}),
          },
        })
      } else if (invite.projectId) {
        // Org-wide members already see the project; extend a fellow guest.
        if (existing.scope === 'projects') {
          await prisma.projectAccess.upsert({
            where: {
              membershipId_projectId: { membershipId: existing.id, projectId: invite.projectId },
            },
            create: { membershipId: existing.id, projectId: invite.projectId },
            update: {},
          })
        }
      } else if (existing.scope === 'projects') {
        // An org-wide invite upgrades a guest to full membership.
        await prisma.membership.update({
          where: { id: existing.id },
          data: { role: invite.role, scope: 'org', projectAccess: { deleteMany: {} } },
        })
      }
      await prisma.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date(), acceptedById: ctx.session.user.id },
      })
      return { orgId: invite.orgId }
    }),
})

const tokensRouter = router({
  list: protectedProcedure.input(z.object({ orgId: z.string() })).query(async ({ ctx, input }) => {
    await requireMembership(ctx.session.user.id, input.orgId)
    const rows = await prisma.apiToken.findMany({
      where: { orgId: input.orgId, userId: ctx.session.user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      lastFour: t.lastFour,
      createdAt: t.createdAt.toISOString(),
      lastUsedAt: iso(t.lastUsedAt),
    }))
  }),

  /** The raw token is returned exactly once, at creation. */
  create: protectedProcedure
    .input(z.object({ orgId: z.string(), name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const access = await requireMembership(ctx.session.user.id, input.orgId)
      // A token reads the whole org through /api/ingest — guests get none.
      requireOrgScope(access)
      const raw = `hb_${randomBytes(24).toString('base64url')}`
      await prisma.apiToken.create({
        data: {
          orgId: input.orgId,
          userId: ctx.session.user.id,
          name: input.name,
          tokenHash: createHash('sha256').update(raw).digest('hex'),
          lastFour: raw.slice(-4),
        },
      })
      return { token: raw }
    }),

  revoke: protectedProcedure
    .input(z.object({ orgId: z.string(), tokenId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.session.user.id, input.orgId)
      await prisma.apiToken.updateMany({
        where: { id: input.tokenId, orgId: input.orgId, userId: ctx.session.user.id },
        data: { revokedAt: new Date() },
      })
      return { ok: true }
    }),
})

const projectsRouter = router({
  list: protectedProcedure.input(z.object({ orgId: z.string() })).query(async ({ ctx, input }) => {
    const access = await requireMembership(ctx.session.user.id, input.orgId)
    const rows = await prisma.project.findMany({
      where: {
        orgId: input.orgId,
        ...(access.projectIds ? { id: { in: access.projectIds } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { gripes: true } } },
    })
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      originHints: p.originHints,
      gripeCount: p._count.gripes,
    }))
  }),

  create: protectedProcedure
    .input(
      z.object({
        orgId: z.string(),
        name: z.string().trim().min(1).max(80),
        originHints: z.array(z.string().trim().max(200)).max(20).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const access = await requireMembership(ctx.session.user.id, input.orgId)
      requireOrgScope(access)
      const base = slugify(input.name)
      let slug = base
      for (
        let n = 2;
        await prisma.project.findUnique({
          where: { orgId_slug: { orgId: input.orgId, slug } },
        });
        n++
      ) {
        slug = `${base}-${n}`
      }
      const p = await prisma.project.create({
        data: { orgId: input.orgId, name: input.name, slug, originHints: input.originHints },
      })
      return { id: p.id, slug: p.slug }
    }),
})

const gripeListSelect = {
  id: true,
  slug: true,
  title: true,
  origin: true,
  status: true,
  recordedAt: true,
  uploadedAt: true,
  durationMs: true,
  frameCount: true,
  eventCount: true,
  bytes: true,
  projectId: true,
  project: { select: { name: true, slug: true } },
  uploadedBy: { select: { name: true } },
  _count: { select: { takes: true } },
} as const

const gripesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        orgId: z.string(),
        projectId: z.string().optional(),
        status: z.enum(['open', 'in_review', 'resolved']).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const access = await requireMembership(ctx.session.user.id, input.orgId)
      if (input.projectId && !canSeeGripe(access, input.projectId)) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }
      const rows = await prisma.gripe.findMany({
        where: {
          orgId: input.orgId,
          finalizedAt: { not: null },
          ...(input.projectId
            ? { projectId: input.projectId }
            : access.projectIds
              ? { projectId: { in: access.projectIds } }
              : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        orderBy: { recordedAt: 'desc' },
        take: 200,
        select: gripeListSelect,
      })
      return rows.map((g) => ({
        id: g.id,
        slug: g.slug,
        title: g.title,
        origin: g.origin,
        status: g.status,
        recordedAt: g.recordedAt.toISOString(),
        uploadedAt: g.uploadedAt.toISOString(),
        durationMs: g.durationMs,
        frameCount: g.frameCount,
        eventCount: g.eventCount,
        bytes: Number(g.bytes),
        takeCount: g._count.takes,
        projectId: g.projectId,
        projectName: g.project?.name ?? null,
        uploadedByName: g.uploadedBy?.name ?? null,
      }))
    }),

  get: protectedProcedure.input(z.object({ gripeId: z.string() })).query(async ({ ctx, input }) => {
    const g = await prisma.gripe.findUnique({
      where: { id: input.gripeId },
      include: {
        takes: { orderBy: { index: 'asc' } },
        files: { where: { status: 'uploaded' }, orderBy: { path: 'asc' } },
        project: { select: { id: true, name: true, slug: true } },
        uploadedBy: { select: { name: true } },
      },
    })
    if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
    const access = await requireMembership(ctx.session.user.id, g.orgId)
    if (!canSeeGripe(access, g.projectId)) throw new TRPCError({ code: 'NOT_FOUND' })
    return {
      id: g.id,
      orgId: g.orgId,
      slug: g.slug,
      title: g.title,
      origin: g.origin,
      status: g.status,
      recordedAt: g.recordedAt.toISOString(),
      uploadedAt: g.uploadedAt.toISOString(),
      durationMs: g.durationMs,
      frameCount: g.frameCount,
      eventCount: g.eventCount,
      bytes: Number(g.bytes),
      project: g.project,
      uploadedByName: g.uploadedBy?.name ?? null,
      takes: g.takes.map((t) => ({
        id: t.id,
        index: t.index,
        dir: t.dir,
        interrupted: t.interrupted,
        startedAt: iso(t.startedAt),
        durationMs: t.durationMs,
        frameCount: t.frameCount,
        transcriber: t.transcriber,
        videoPath: t.videoPath,
      })),
      // Presigned per file so the viewer never round-trips per frame; signing
      // is local HMAC work, cheap even at a few hundred files.
      files: await Promise.all(
        g.files.map(async (f) => ({
          path: f.path,
          size: f.size,
          contentType: f.contentType,
          url: await presignGet(gripeKey(g.orgId, g.id, f.path)),
        }))
      ),
    }
  }),

  /**
   * Short-lived presigned GET for one file of a gripe. The viewer asks per
   * file (video, frame, report) as it needs them.
   */
  fileUrl: protectedProcedure
    .input(z.object({ gripeId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!isSafePath(input.path)) throw new TRPCError({ code: 'BAD_REQUEST' })
      const g = await prisma.gripe.findUnique({
        where: { id: input.gripeId },
        select: { orgId: true, projectId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      const access = await requireMembership(ctx.session.user.id, g.orgId)
      if (!canSeeGripe(access, g.projectId)) throw new TRPCError({ code: 'NOT_FOUND' })
      const file = await prisma.gripeFile.findUnique({
        where: { gripeId_path: { gripeId: input.gripeId, path: input.path } },
      })
      if (!file || file.status !== 'uploaded') throw new TRPCError({ code: 'NOT_FOUND' })
      return { url: await presignGet(gripeKey(g.orgId, input.gripeId, input.path)) }
    }),

  setStatus: protectedProcedure
    .input(
      z.object({ gripeId: z.string(), status: z.enum(['open', 'in_review', 'resolved']) })
    )
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.gripe.findUnique({
        where: { id: input.gripeId },
        select: { orgId: true, projectId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      const access = await requireMembership(ctx.session.user.id, g.orgId)
      if (!canSeeGripe(access, g.projectId)) throw new TRPCError({ code: 'NOT_FOUND' })
      await prisma.gripe.update({
        where: { id: input.gripeId },
        data: {
          status: input.status,
          resolvedAt: input.status === 'resolved' ? new Date() : null,
        },
      })
      return { ok: true }
    }),

  assignProject: protectedProcedure
    .input(z.object({ gripeId: z.string(), projectId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.gripe.findUnique({
        where: { id: input.gripeId },
        select: { orgId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      const access = await requireMembership(ctx.session.user.id, g.orgId)
      requireOrgScope(access)
      if (input.projectId) {
        const p = await prisma.project.findUnique({ where: { id: input.projectId } })
        if (!p || p.orgId !== g.orgId) throw new TRPCError({ code: 'BAD_REQUEST' })
      }
      await prisma.gripe.update({
        where: { id: input.gripeId },
        data: { projectId: input.projectId },
      })
      return { ok: true }
    }),

  delete: protectedProcedure
    .input(z.object({ gripeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.gripe.findUnique({
        where: { id: input.gripeId },
        select: { orgId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireMembership(ctx.session.user.id, g.orgId, 'admin')
      await deletePrefix(gripePrefix(g.orgId, input.gripeId))
      await prisma.gripe.delete({ where: { id: input.gripeId } })
      return { ok: true }
    }),
})

const adminRouter = router({
  /** Cheap probe for the nav — never throws for non-admins. */
  status: protectedProcedure.query(async ({ ctx }) => {
    const u = await prisma.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { email: true, isAdmin: true },
    })
    return { isAdmin: u !== null && isPlatformAdmin(u) }
  }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    await requireAdmin(ctx.session.user.id)
    const [users, orgs, gripes, bytes] = await Promise.all([
      prisma.user.count(),
      prisma.org.count(),
      prisma.gripe.count(),
      prisma.gripe.aggregate({ _sum: { bytes: true } }),
    ])
    return { users, orgs, gripes, bytes: Number(bytes._sum.bytes ?? 0) }
  }),

  users: protectedProcedure
    .input(z.object({ query: z.string().trim().max(100).default('') }))
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const rows = await prisma.user.findMany({
        where: input.query
          ? {
              OR: [
                { email: { contains: input.query, mode: 'insensitive' } },
                { name: { contains: input.query, mode: 'insensitive' } },
              ],
            }
          : undefined,
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          memberships: {
            include: { org: { select: { name: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
      return rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: u.emailVerified,
        // Effective admin, not the raw flag — ADMIN_EMAILS bootstrap admins
        // must not render as "admin off".
        isAdmin: isPlatformAdmin(u),
        features: u.features,
        createdAt: u.createdAt.toISOString(),
        orgs: u.memberships.map((m) => ({ name: m.org.name, role: m.role })),
      }))
    }),

  setFeature: protectedProcedure
    .input(z.object({ userId: z.string(), feature: z.enum(['team']), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const u = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { features: true },
      })
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' })
      const features = input.enabled
        ? [...new Set([...u.features, input.feature])]
        : u.features.filter((f) => f !== input.feature)
      await prisma.user.update({ where: { id: input.userId }, data: { features } })
      return { ok: true }
    }),

  setAdmin: protectedProcedure
    .input(z.object({ userId: z.string(), isAdmin: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      if (input.userId === ctx.session.user.id && !input.isAdmin) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot revoke your own admin' })
      }
      await prisma.user.update({ where: { id: input.userId }, data: { isAdmin: input.isAdmin } })
      return { ok: true }
    }),
})

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ctx.session.user),
  orgs: orgsRouter,
  invites: invitesRouter,
  tokens: tokensRouter,
  projects: projectsRouter,
  gripes: gripesRouter,
  admin: adminRouter,
})

export type AppRouter = typeof appRouter
