import { createHash, randomBytes } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { inviteEmail, sendEmail } from './email'
import { env } from './env'
import { isPlatformAdmin, orgHasFeature, requireAdmin, userHasFeature } from './features'
import { ORG_MAX_WALKTHROUGHS, ORG_QUOTA_BYTES } from './ingest'
import { log } from './logger'
import {
  canSeeWalkthrough,
  requireMembership,
  requireOrgScope,
  requireViewAccess,
  slugify,
} from './membership'
import { createPersonalOrg } from './orgs'
import { prisma } from './prisma'
import { latestRecorderRelease } from './releases'
import {
  copyObject,
  deletePrefix,
  walkthroughKey,
  walkthroughPrefix,
  isSafePath,
  presignGet,
} from './storage'
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
      personal: m.org.personal,
      teamEnabled: teamByOrg.get(m.org.id) ?? false,
    }))
  }),

  /** What this account may do at the platform level, independent of any org. */
  entitlements: protectedProcedure.query(async ({ ctx }) => {
    const u = await prisma.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { email: true, isAdmin: true, features: true },
    })
    return { canCreateTeams: u !== null && userHasFeature(u, 'team') }
  }),

  /**
   * The repair path for an account whose sign-up hook didn't land. Idempotent —
   * a user who already has a workspace just gets its id back.
   */
  ensurePersonal: protectedProcedure.mutation(async ({ ctx }) => {
    return await createPersonalOrg(ctx.session.user.id, ctx.session.user.name ?? '')
  }),

  /** Creating a workspace by hand means creating a team — a paid entitlement. */
  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const u = await prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { email: true, isAdmin: true, features: true },
      })
      if (!u || !userHasFeature(u, 'team')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "Teams are a paid feature and aren't enabled for your account yet.",
        })
      }
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

  rename: protectedProcedure
    .input(z.object({ orgId: z.string(), name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.session.user.id, input.orgId, 'admin')
      // The slug stays: it's the org's stable handle; only the display name moves.
      await prisma.org.update({ where: { id: input.orgId }, data: { name: input.name } })
      return { ok: true }
    }),

  members: protectedProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx.session.user.id, input.orgId, 'admin')
      const rows = await prisma.membership.findMany({
        // The roster is the owner's business: who else is in a workspace, and
        // at what address, isn't something a member needs. Members and guests
        // get FORBIDDEN here, and the Team page never calls this for them.
        where: { orgId: input.orgId },
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
      const target = await prisma.org.findUnique({
        where: { id: input.orgId },
        select: { personal: true },
      })
      if (target?.personal) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This is a personal workspace — create a team to invite people.',
        })
      }
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
      // An addressed invite is bound to that address: invitation emails get
      // forwarded, and the link alone shouldn't hand a workspace to whoever
      // received the forward. A link with no address is still open by design —
      // that's the "copy a link and pass it around" invite.
      if (invite.email && invite.email.toLowerCase() !== ctx.session.user.email.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `This invite was sent to ${invite.email}. Sign in as that address to accept it.`,
        })
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

  /**
   * "Has an agent actually reached us yet?" — what /connect polls and what
   * decides whether the inbox still nags you to connect one. `lastUsedAt` is
   * stamped by `authenticateToken` on every ingest and MCP call, so a non-null
   * value here means a real agent completed a real request. Never throws for a
   * guest; they can't hold tokens, they just get `canConnect: false`.
   */
  connection: protectedProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ ctx, input }) => {
      const access = await requireMembership(ctx.session.user.id, input.orgId)
      if (access.projectIds) return { canConnect: false, tokenCount: 0, lastUsedAt: null }
      const rows = await prisma.apiToken.findMany({
        where: { orgId: input.orgId, userId: ctx.session.user.id, revokedAt: null },
        select: { lastUsedAt: true },
      })
      const lastUsed = rows.reduce<Date | null>(
        (latest, r) => (r.lastUsedAt && (!latest || r.lastUsedAt > latest) ? r.lastUsedAt : latest),
        null
      )
      return { canConnect: true, tokenCount: rows.length, lastUsedAt: iso(lastUsed) }
    }),

  /**
   * The raw token is returned exactly once, at creation. The row's `id` and
   * `name` come back with it so the caller can offer a rename without a
   * round-trip through `list` — /connect mints with an auto-generated name and
   * lets you correct it afterwards rather than demanding one up front.
   */
  create: protectedProcedure
    .input(z.object({ orgId: z.string(), name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const access = await requireMembership(ctx.session.user.id, input.orgId)
      // A token reads the whole org through /api/ingest — guests get none.
      requireOrgScope(access)
      const raw = `hb_${randomBytes(24).toString('base64url')}`
      const created = await prisma.apiToken.create({
        data: {
          orgId: input.orgId,
          userId: ctx.session.user.id,
          name: input.name,
          tokenHash: createHash('sha256').update(raw).digest('hex'),
          lastFour: raw.slice(-4),
        },
      })
      return { token: raw, id: created.id, name: created.name }
    }),

  /** Label only — renaming can't change what a token reaches. */
  rename: protectedProcedure
    .input(
      z.object({
        orgId: z.string(),
        tokenId: z.string(),
        name: z.string().trim().min(1).max(80),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.session.user.id, input.orgId)
      await prisma.apiToken.updateMany({
        where: { id: input.tokenId, orgId: input.orgId, userId: ctx.session.user.id },
        data: { name: input.name },
      })
      return { ok: true }
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
      include: { _count: { select: { walkthroughs: true } } },
    })
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      originHints: p.originHints,
      walkthroughCount: p._count.walkthroughs,
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

  update: protectedProcedure
    .input(
      z.object({
        orgId: z.string(),
        projectId: z.string(),
        name: z.string().trim().min(1).max(80),
        // Optional, not defaulted: the UI no longer edits hints, and a rename
        // must not silently wipe the routing an upload depends on.
        originHints: z.array(z.string().trim().max(200)).max(20).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const access = await requireMembership(ctx.session.user.id, input.orgId)
      requireOrgScope(access)
      const p = await prisma.project.findUnique({ where: { id: input.projectId } })
      if (!p || p.orgId !== input.orgId) throw new TRPCError({ code: 'NOT_FOUND' })
      // Slug stays for the same reason an org's does.
      await prisma.project.update({
        where: { id: p.id },
        data: {
          name: input.name,
          ...(input.originHints ? { originHints: input.originHints } : {}),
        },
      })
      return { ok: true }
    }),
})

const walkthroughListSelect = {
  id: true,
  slug: true,
  title: true,
  origin: true,
  status: true,
  recordedAt: true,
  uploadedAt: true,
  durationMs: true,
  frameCount: true,
  errorCount: true,
  droppedCount: true,
  bytes: true,
  projectId: true,
  project: { select: { name: true, slug: true } },
  uploadedBy: { select: { name: true } },
  _count: { select: { takes: true } },
} as const

const walkthroughsRouter = router({
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
      if (input.projectId && !canSeeWalkthrough(access, input.projectId)) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }
      const rows = await prisma.walkthrough.findMany({
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
        select: walkthroughListSelect,
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
        errorCount: g.errorCount,
        droppedCount: g.droppedCount,
        bytes: Number(g.bytes),
        takeCount: g._count.takes,
        projectId: g.projectId,
        projectName: g.project?.name ?? null,
        uploadedByName: g.uploadedBy?.name ?? null,
      }))
    }),

  get: protectedProcedure
    .input(z.object({ walkthroughId: z.string() }))
    .query(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        include: {
          takes: { orderBy: { index: 'asc' } },
          files: { where: { status: 'uploaded' }, orderBy: { path: 'asc' } },
          project: { select: { id: true, name: true, slug: true } },
          uploadedBy: { select: { name: true } },
        },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      const { access, isMember } = await requireViewAccess(ctx.session.user.id, g.orgId)
      if (!canSeeWalkthrough(access, g.projectId)) throw new TRPCError({ code: 'NOT_FOUND' })
      return {
        id: g.id,
        orgId: g.orgId,
        // False when a platform admin is looking in from /admin — the viewer
        // hides every control, because the mutations would 403 anyway.
        viewerIsMember: isMember,
        slug: g.slug,
        title: g.title,
        origin: g.origin,
        status: g.status,
        recordedAt: g.recordedAt.toISOString(),
        uploadedAt: g.uploadedAt.toISOString(),
        durationMs: g.durationMs,
        frameCount: g.frameCount,
        errorCount: g.errorCount,
        droppedCount: g.droppedCount,
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
            url: await presignGet(walkthroughKey(g.orgId, g.id, f.path)),
          }))
        ),
      }
    }),

  /**
   * Short-lived presigned GET for one file of a walkthrough. The viewer asks per
   * file (video, frame, report) as it needs them.
   */
  fileUrl: protectedProcedure
    .input(z.object({ walkthroughId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!isSafePath(input.path)) throw new TRPCError({ code: 'BAD_REQUEST' })
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { orgId: true, projectId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      const { access } = await requireViewAccess(ctx.session.user.id, g.orgId)
      if (!canSeeWalkthrough(access, g.projectId)) throw new TRPCError({ code: 'NOT_FOUND' })
      const file = await prisma.walkthroughFile.findUnique({
        where: { walkthroughId_path: { walkthroughId: input.walkthroughId, path: input.path } },
      })
      if (!file || file.status !== 'uploaded') throw new TRPCError({ code: 'NOT_FOUND' })
      return { url: await presignGet(walkthroughKey(g.orgId, input.walkthroughId, input.path)) }
    }),

  setStatus: protectedProcedure
    .input(
      z.object({ walkthroughId: z.string(), status: z.enum(['open', 'in_review', 'resolved']) })
    )
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { orgId: true, projectId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      const access = await requireMembership(ctx.session.user.id, g.orgId)
      if (!canSeeWalkthrough(access, g.projectId)) throw new TRPCError({ code: 'NOT_FOUND' })
      await prisma.walkthrough.update({
        where: { id: input.walkthroughId },
        data: {
          status: input.status,
          resolvedAt: input.status === 'resolved' ? new Date() : null,
        },
      })
      return { ok: true }
    }),

  /** Same access bar as setStatus — anyone who can see the walkthrough can title it. */
  rename: protectedProcedure
    .input(z.object({ walkthroughId: z.string(), title: z.string().trim().min(1).max(300) }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { orgId: true, projectId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      const access = await requireMembership(ctx.session.user.id, g.orgId)
      if (!canSeeWalkthrough(access, g.projectId)) throw new TRPCError({ code: 'NOT_FOUND' })
      await prisma.walkthrough.update({
        where: { id: input.walkthroughId },
        data: { title: input.title },
      })
      return { ok: true }
    }),

  assignProject: protectedProcedure
    .input(z.object({ walkthroughId: z.string(), projectId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { orgId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      const access = await requireMembership(ctx.session.user.id, g.orgId)
      requireOrgScope(access)
      if (input.projectId) {
        const p = await prisma.project.findUnique({ where: { id: input.projectId } })
        if (!p || p.orgId !== g.orgId) throw new TRPCError({ code: 'BAD_REQUEST' })
      }
      await prisma.walkthrough.update({
        where: { id: input.walkthroughId },
        data: { projectId: input.projectId },
      })
      return { ok: true }
    }),

  /**
   * Move a walkthrough to another workspace the caller also holds in full.
   *
   * Order matters: copy the objects, flip the row, then delete the originals.
   * A crash mid-copy leaves the walkthrough untouched where it was; a crash after the
   * flip leaves orphaned objects under the old prefix, which is a cleanup
   * problem rather than a lost or half-visible walkthrough. The reverse order would
   * trade that for a row pointing at keys that no longer exist.
   *
   * Presigned URLs handed out before the move keep pointing at the old keys and
   * die with them — by design; the viewer re-signs against the new prefix.
   */
  moveToOrg: protectedProcedure
    .input(z.object({ walkthroughId: z.string(), orgId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const walkthrough = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        // Only uploaded files exist as objects — a pending row (declared but
        // never finished) would make the copy throw NoSuchKey and strand the move.
        include: { files: { select: { path: true }, where: { status: 'uploaded' } } },
      })
      if (!walkthrough) throw new TRPCError({ code: 'NOT_FOUND' })
      // Both ends have to be whole-workspace access: a guest must not be able
      // to walk a project's walkthrough out into an org of their own.
      requireOrgScope(await requireMembership(ctx.session.user.id, walkthrough.orgId))
      requireOrgScope(await requireMembership(ctx.session.user.id, input.orgId))
      if (input.orgId === walkthrough.orgId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Already in that workspace' })
      }

      // The destination's quota is the same one ingest enforces — a move is
      // another way to put bytes in a workspace.
      const dest = await prisma.walkthrough.aggregate({
        where: { orgId: input.orgId },
        _sum: { bytes: true },
        _count: true,
      })
      if ((dest._sum.bytes ?? 0n) + walkthrough.bytes > BigInt(ORG_QUOTA_BYTES)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That workspace is at its storage quota',
        })
      }
      if (dest._count >= ORG_MAX_WALKTHROUGHS) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That workspace is at its walkthrough limit',
        })
      }

      // Suffix until free — a move must never replace a walkthrough already there.
      let slug = walkthrough.slug
      for (
        let n = 2;
        await prisma.walkthrough.findUnique({
          where: { orgId_slug: { orgId: input.orgId, slug } },
        });
        n++
      ) {
        slug = `${walkthrough.slug}-${n}`
      }

      // A walkthrough can hold hundreds of files; copy server-side, 8 at a time.
      const paths = walkthrough.files.map((f) => f.path)
      for (let i = 0; i < paths.length; i += 8) {
        await Promise.all(
          paths
            .slice(i, i + 8)
            .map((path) =>
              copyObject(
                walkthroughKey(walkthrough.orgId, walkthrough.id, path),
                walkthroughKey(input.orgId, walkthrough.id, path)
              )
            )
        )
      }

      await prisma.walkthrough.update({
        where: { id: walkthrough.id },
        // Projects are per-org, so the assignment cannot survive the move.
        data: { orgId: input.orgId, projectId: null, slug },
      })

      try {
        await deletePrefix(walkthroughPrefix(walkthrough.orgId, walkthrough.id))
      } catch (err) {
        log.warn('move: source cleanup failed', {
          walkthroughId: walkthrough.id,
          orgId: walkthrough.orgId,
          err,
        })
      }
      return { ok: true, orgId: input.orgId, slug }
    }),

  delete: protectedProcedure
    .input(z.object({ walkthroughId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { orgId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireMembership(ctx.session.user.id, g.orgId, 'admin')
      await deletePrefix(walkthroughPrefix(g.orgId, input.walkthroughId))
      await prisma.walkthrough.delete({ where: { id: input.walkthroughId } })
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
    const [users, orgs, walkthroughs, bytes] = await Promise.all([
      prisma.user.count(),
      prisma.org.count(),
      prisma.walkthrough.count(),
      prisma.walkthrough.aggregate({ _sum: { bytes: true } }),
    ])
    return { users, orgs, walkthroughs, bytes: Number(bytes._sum.bytes ?? 0) }
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

  /**
   * Every walkthrough one account can see, grouped by workspace — the drill-down
   * behind a row on /admin. A guest's slice is honoured (only their granted
   * projects), so this is genuinely "what this user sees", not "what their
   * workspaces hold. Unfinalized walkthroughs are included and flagged: a declare
   * that never finalized is invisible in the product and is exactly the kind
   * of stuck upload an admin is looking for.
   */
  userWalkthroughs: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const memberships = await prisma.membership.findMany({
        where: { userId: input.userId },
        select: {
          role: true,
          scope: true,
          org: { select: { id: true, name: true, slug: true } },
          projectAccess: { select: { projectId: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
      if (memberships.length === 0) return []

      const walkthroughs = await prisma.walkthrough.findMany({
        where: {
          OR: memberships.map((m) =>
            m.scope === 'projects'
              ? { orgId: m.org.id, projectId: { in: m.projectAccess.map((a) => a.projectId) } }
              : { orgId: m.org.id }
          ),
        },
        orderBy: { uploadedAt: 'desc' },
        take: 500,
        include: {
          project: { select: { name: true } },
          uploadedBy: { select: { id: true, name: true } },
        },
      })

      return memberships.map((m) => ({
        org: m.org,
        role: m.scope === 'projects' ? 'member' : m.role,
        scoped: m.scope === 'projects',
        walkthroughs: walkthroughs
          .filter((g) => g.orgId === m.org.id)
          .map((g) => ({
            id: g.id,
            slug: g.slug,
            title: g.title,
            status: g.status,
            origin: g.origin,
            uploadedAt: g.uploadedAt.toISOString(),
            durationMs: g.durationMs,
            bytes: Number(g.bytes),
            finalized: g.finalizedAt !== null,
            projectName: g.project?.name ?? null,
            uploadedByName: g.uploadedBy?.name ?? null,
            // Their own recording vs. one a workspace-mate uploaded.
            uploadedByThem: g.uploadedById === input.userId,
          })),
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

/**
 * What build of the recorder the site is currently handing out. `/recorder`
 * compares it against the version the installed extension reports over the
 * ping handshake, which is the only reason a self-hosted zip can keep anyone
 * up to date — nothing auto-updates outside the Web Store.
 */
const recorderRouter = router({
  release: protectedProcedure.query(async () => {
    const release = await latestRecorderRelease()
    return release ? { version: release.version, bytes: release.bytes } : null
  }),
})

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ctx.session.user),
  recorder: recorderRouter,
  orgs: orgsRouter,
  invites: invitesRouter,
  tokens: tokensRouter,
  projects: projectsRouter,
  walkthroughs: walkthroughsRouter,
  admin: adminRouter,
})

export type AppRouter = typeof appRouter
