import { createHash, randomBytes } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { requireMembership, slugify } from './membership'
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
    return memberships.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      role: m.role,
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
      await requireMembership(ctx.session.user.id, input.orgId)
      const rows = await prisma.membership.findMany({
        where: { orgId: input.orgId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      })
      return rows.map((m) => ({
        membershipId: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
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
      await prisma.membership.update({ where: { id: target.id }, data: { role: input.role } })
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
      return { ok: true }
    }),
})

const invitesRouter = router({
  list: protectedProcedure.input(z.object({ orgId: z.string() })).query(async ({ ctx, input }) => {
    await requireMembership(ctx.session.user.id, input.orgId, 'admin')
    const rows = await prisma.invite.findMany({
      where: { orgId: input.orgId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.session.user.id, input.orgId, 'admin')
      const invite = await prisma.invite.create({
        data: {
          orgId: input.orgId,
          email: input.email ?? null,
          role: input.role,
          createdById: ctx.session.user.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      })
      return { id: invite.id }
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
      include: { org: { select: { name: true } } },
    })
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return null
    return { orgName: invite.org.name, email: invite.email }
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
          data: { orgId: invite.orgId, userId: ctx.session.user.id, role: invite.role },
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
      await requireMembership(ctx.session.user.id, input.orgId)
      const raw = `ilp_${randomBytes(24).toString('base64url')}`
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
    await requireMembership(ctx.session.user.id, input.orgId)
    const rows = await prisma.project.findMany({
      where: { orgId: input.orgId },
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
      await requireMembership(ctx.session.user.id, input.orgId)
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
      await requireMembership(ctx.session.user.id, input.orgId)
      const rows = await prisma.gripe.findMany({
        where: {
          orgId: input.orgId,
          finalizedAt: { not: null },
          ...(input.projectId ? { projectId: input.projectId } : {}),
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
    await requireMembership(ctx.session.user.id, g.orgId)
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
        select: { orgId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireMembership(ctx.session.user.id, g.orgId)
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
        select: { orgId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireMembership(ctx.session.user.id, g.orgId)
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
      await requireMembership(ctx.session.user.id, g.orgId)
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

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ctx.session.user),
  orgs: orgsRouter,
  invites: invitesRouter,
  tokens: tokensRouter,
  projects: projectsRouter,
  gripes: gripesRouter,
})

export type AppRouter = typeof appRouter
