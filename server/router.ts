import { createHash, randomBytes } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  memberTeamIds,
  requireSpaceAccess,
  requireTeamRole,
  requireViewAccess,
  slugify,
  spaceId,
  type SpaceOwner,
} from './access'
import { inviteEmail, sendEmail } from './email'
import { env } from './env'
import { isPlatformAdmin, requireAdmin, teamHasFeature, userHasFeature } from './features'
import { SPACE_MAX_WALKTHROUGHS, SPACE_QUOTA_BYTES } from './ingest'
import { log } from './logger'
import { briefFrameLimit, formatWalkthrough } from './mcp-format'
import { prisma } from './prisma'
import { latestRecorderRelease } from './releases'
import {
  copyObject,
  deletePrefix,
  spacePrefix,
  walkthroughKey,
  walkthroughPrefix,
  isSafePath,
  presignGet,
} from './storage'
import { protectedProcedure, publicProcedure, router } from './trpc'
import {
  getWalkthroughDetail,
  WALKTHROUGH_STATUSES,
  type WalkthroughStatus,
} from './walkthroughs-api'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Dates go over the wire as ISO strings so SSR-rendered HTML and React Query's
// post-hydration render produce identical markup.
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

// Space input convention: `teamId: null` means the caller's own personal space.
// Nothing else identifies a personal space, so it can never be spoofed.
const toSpace = (teamId: string | null, selfId: string): SpaceOwner =>
  teamId ? { teamId, userId: null } : { teamId: null, userId: selfId }

/** Prisma `where` fragment selecting exactly one space's rows. */
const spaceWhere = (s: SpaceOwner) =>
  s.teamId ? { teamId: s.teamId } : { teamId: null, userId: s.userId }

/**
 * Prisma `where` fragment for every space the caller reaches at once — their
 * personal rows plus each of their teams'. The cross-space reads (the inbox,
 * the project list behind it) share it so they can't drift apart.
 */
const reachWhere = (userId: string, teamIds: string[]) => ({
  OR: [{ teamId: null, userId }, { teamId: { in: teamIds } }],
})

/**
 * `status` is a plain column, so a row hands back a bare string; the cross-space
 * reads ship the union the client switches on. Anything unrecognized reads open.
 */
const asStatus = (s: string): WalkthroughStatus =>
  WALKTHROUGH_STATUSES.find((v) => v === s) ?? 'open'

/**
 * The move core shared by walkthroughs.move and admin.moveWalkthrough: quota
 * check, slug de-dup, copy → flip → best-effort delete. Callers authorize.
 */
async function relocate(
  walkthroughId: string,
  dest: SpaceOwner
): Promise<{ teamId: string | null; slug: string }> {
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    // Only uploaded files exist as objects — a pending row (declared but
    // never finished) would make the copy throw NoSuchKey and strand the move.
    include: { files: { select: { path: true }, where: { status: 'uploaded' } } },
  })
  if (!walkthrough) throw new TRPCError({ code: 'NOT_FOUND' })
  // A walkthrough that never finalized can have real objects behind rows still
  // marked pending: the copy below would skip them and the source wipe would
  // eat them. It's invisible in every list anyway — deletion is the only safe
  // exit for one of these.
  if (!walkthrough.finalizedAt) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This walkthrough never finished uploading — it can be deleted, not moved',
    })
  }
  const source: SpaceOwner = { teamId: walkthrough.teamId, userId: walkthrough.userId }
  if (source.teamId === dest.teamId && source.userId === dest.userId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Already there' })
  }

  // The destination's quota is the same one ingest enforces — a move is
  // another way to put bytes in a space.
  const destTotals = await prisma.walkthrough.aggregate({
    where: spaceWhere(dest),
    _sum: { bytes: true },
    _count: true,
  })
  if ((destTotals._sum.bytes ?? 0n) + walkthrough.bytes > BigInt(SPACE_QUOTA_BYTES)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That space is at its storage quota' })
  }
  if (destTotals._count >= SPACE_MAX_WALKTHROUGHS) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'That space is at its walkthrough limit',
    })
  }

  // Suffix until free — a move must never replace a walkthrough already there.
  let slug = walkthrough.slug
  for (
    let n = 2;
    await prisma.walkthrough.findFirst({ where: { ...spaceWhere(dest), slug } });
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
            walkthroughKey(spaceId(source), walkthrough.id, path),
            walkthroughKey(spaceId(dest), walkthrough.id, path)
          )
        )
    )
  }

  await prisma.walkthrough.update({
    where: { id: walkthrough.id },
    // Projects are per-space, so the assignment cannot survive the move.
    data: { teamId: dest.teamId, userId: dest.userId, projectId: null, slug },
  })

  try {
    await deletePrefix(walkthroughPrefix(spaceId(source), walkthrough.id))
  } catch (err) {
    log.warn('move: source cleanup failed', {
      walkthroughId: walkthrough.id,
      spaceId: spaceId(source),
      err,
    })
  }
  return { teamId: dest.teamId, slug }
}

const teamsRouter = router({
  /** Teams the signed-in user belongs to, with their effective role. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: ctx.session.user.id },
      include: { team: true },
      orderBy: { createdAt: 'asc' },
    })
    return memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      slug: m.team.slug,
      role: m.team.ownerId === ctx.session.user.id ? 'owner' : m.role,
    }))
  }),

  /** What this account may do at the platform level, independent of any team. */
  entitlements: protectedProcedure.query(async ({ ctx }) => {
    const u = await prisma.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { email: true, isAdmin: true, features: true },
    })
    return { canCreateTeams: u !== null && userHasFeature(u, 'team') }
  }),

  /** Teams are the paid, explicit thing — personal costs nothing and just exists. */
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
      // Suffix until free — team slugs are global.
      let slug = base
      for (let n = 2; await prisma.team.findUnique({ where: { slug } }); n++) {
        slug = `${base}-${n}`
      }
      const team = await prisma.team.create({
        data: {
          name: input.name,
          slug,
          ownerId: ctx.session.user.id,
          // The owner holds a membership too; their role reads as "owner" off
          // Team.ownerId, and the stored 'admin' is what they fall back to if
          // ownership is ever transferred away.
          memberships: { create: { userId: ctx.session.user.id, role: 'admin' } },
        },
      })
      return { id: team.id, name: team.name, slug: team.slug }
    }),

  rename: protectedProcedure
    .input(z.object({ teamId: z.string(), name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      await requireTeamRole(ctx.session.user.id, input.teamId, 'admin')
      // The slug stays: it's the team's stable handle; only the display name moves.
      await prisma.team.update({ where: { id: input.teamId }, data: { name: input.name } })
      return { ok: true }
    }),

  get: protectedProcedure.input(z.object({ teamId: z.string() })).query(async ({ ctx, input }) => {
    await requireTeamRole(ctx.session.user.id, input.teamId)
    const team = await prisma.team.findUnique({ where: { id: input.teamId } })
    if (!team) throw new TRPCError({ code: 'NOT_FOUND' })
    const [memberCount, pendingInvites] = await Promise.all([
      prisma.membership.count({ where: { teamId: team.id } }),
      prisma.invite.count({
        where: { teamId: team.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      }),
    ])
    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      ownerId: team.ownerId,
      seatLimit: team.seatLimit,
      memberCount,
      pendingInvites,
    }
  }),

  members: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ ctx, input }) => {
      // The roster is the owner's business: who else is in a team, and at what
      // address, isn't something a member needs. Members get FORBIDDEN here,
      // and the Team page never calls this for them.
      await requireTeamRole(ctx.session.user.id, input.teamId, 'admin')
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { ownerId: true },
      })
      if (!team) throw new TRPCError({ code: 'NOT_FOUND' })
      const rows = await prisma.membership.findMany({
        where: { teamId: input.teamId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      })
      return rows.map((m) => ({
        membershipId: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: team.ownerId === m.user.id ? 'owner' : m.role,
        joinedAt: m.createdAt.toISOString(),
      }))
    }),

  setRole: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        membershipId: z.string(),
        role: z.enum(['admin', 'member']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireTeamRole(ctx.session.user.id, input.teamId, 'owner')
      const target = await prisma.membership.findUnique({
        where: { id: input.membershipId },
        include: { team: { select: { ownerId: true } } },
      })
      if (!target || target.teamId !== input.teamId) throw new TRPCError({ code: 'NOT_FOUND' })
      if (target.userId === target.team.ownerId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "The owner's role is fixed — transfer ownership instead",
        })
      }
      await prisma.membership.update({ where: { id: target.id }, data: { role: input.role } })
      return { ok: true }
    }),

  removeMember: protectedProcedure
    .input(z.object({ teamId: z.string(), membershipId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireTeamRole(ctx.session.user.id, input.teamId, 'admin')
      const target = await prisma.membership.findUnique({
        where: { id: input.membershipId },
        include: { team: { select: { ownerId: true } } },
      })
      if (!target || target.teamId !== input.teamId) throw new TRPCError({ code: 'NOT_FOUND' })
      if (target.userId === target.team.ownerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'The owner cannot be removed' })
      }
      await prisma.membership.delete({ where: { id: target.id } })
      // No token revocation: tokens are the user, not the team, and a token's
      // reach is recomputed from live memberships on every call — losing the
      // membership loses the team's content by itself.
      return { ok: true }
    }),

  /**
   * Ownership is a single field, not a role, so handing it over is one update.
   * The outgoing owner keeps their membership row (role 'admin'), which is what
   * leaves them with continued access instead of locking them out of their own
   * team.
   */
  transferOwnership: protectedProcedure
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireTeamRole(ctx.session.user.id, input.teamId, 'owner')
      const target = await prisma.membership.findUnique({
        where: { teamId_userId: { teamId: input.teamId, userId: input.userId } },
      })
      if (!target) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'They must join the team first' })
      }
      await prisma.team.update({ where: { id: input.teamId }, data: { ownerId: input.userId } })
      return { ok: true }
    }),
})

const invitesRouter = router({
  list: protectedProcedure.input(z.object({ teamId: z.string() })).query(async ({ ctx, input }) => {
    await requireTeamRole(ctx.session.user.id, input.teamId, 'admin')
    const rows = await prisma.invite.findMany({
      where: { teamId: input.teamId, acceptedAt: null, expiresAt: { gt: new Date() } },
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
        teamId: z.string(),
        email: z.string().email().optional(),
        role: z.enum(['admin', 'member']).default('member'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireTeamRole(ctx.session.user.id, input.teamId, 'admin')
      if (!(await teamHasFeature(input.teamId, 'team'))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "Team is a paid feature and isn't enabled for this team yet.",
        })
      }
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { name: true, seatLimit: true },
      })
      if (!team) throw new TRPCError({ code: 'NOT_FOUND' })
      // A pending invite holds a seat: otherwise a team could invite twenty
      // people onto five seats and only discover it at accept time.
      const [members, pending] = await Promise.all([
        prisma.membership.count({ where: { teamId: input.teamId } }),
        prisma.invite.count({
          where: { teamId: input.teamId, acceptedAt: null, expiresAt: { gt: new Date() } },
        }),
      ])
      if (members + pending >= team.seatLimit) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `This team's ${team.seatLimit} seats are full.`,
        })
      }
      const invite = await prisma.invite.create({
        data: {
          teamId: input.teamId,
          email: input.email ?? null,
          role: input.role,
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
        emailed = await sendEmail({
          to: input.email,
          ...inviteEmail({
            team: team.name,
            inviter: ctx.session.user.name || ctx.session.user.email,
            url: `${env.BETTER_AUTH_URL}/join/${invite.id}`,
          }),
        })
      }
      return { id: invite.id, emailed }
    }),

  revoke: protectedProcedure
    .input(z.object({ teamId: z.string(), inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireTeamRole(ctx.session.user.id, input.teamId, 'admin')
      await prisma.invite.deleteMany({ where: { id: input.inviteId, teamId: input.teamId } })
      return { ok: true }
    }),

  /** What a /join/<id> link points at — safe for signed-out users. */
  peek: publicProcedure.input(z.object({ inviteId: z.string() })).query(async ({ input }) => {
    const invite = await prisma.invite.findUnique({
      where: { id: input.inviteId },
      include: { team: { select: { name: true } } },
    })
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return null
    return { teamName: invite.team.name, email: invite.email }
  }),

  accept: protectedProcedure
    .input(z.object({ inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await prisma.invite.findUnique({ where: { id: input.inviteId } })
      if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite is gone or expired' })
      }
      // An addressed invite is bound to that address: invitation emails get
      // forwarded, and the link alone shouldn't hand a team to whoever received
      // the forward. A link with no address is still open by design — that's the
      // "copy a link and pass it around" invite.
      if (invite.email && invite.email.toLowerCase() !== ctx.session.user.email.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `This invite was sent to ${invite.email}. Sign in as that address to accept it.`,
        })
      }
      const existing = await prisma.membership.findUnique({
        where: { teamId_userId: { teamId: invite.teamId, userId: ctx.session.user.id } },
      })
      // Idempotent: re-following a link you already used just re-lands you on
      // the team rather than erroring or duplicating the membership.
      if (!existing) {
        const team = await prisma.team.findUnique({
          where: { id: invite.teamId },
          select: { seatLimit: true },
        })
        if (!team) throw new TRPCError({ code: 'NOT_FOUND' })
        // Checked again here, not just at create: an open link can outlive the
        // seat that was reserved for it.
        const members = await prisma.membership.count({ where: { teamId: invite.teamId } })
        if (members >= team.seatLimit) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'This team is out of seats.' })
        }
        await prisma.membership.create({
          data: { teamId: invite.teamId, userId: ctx.session.user.id, role: invite.role },
        })
      }
      await prisma.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date(), acceptedById: ctx.session.user.id },
      })
      return { teamId: invite.teamId }
    }),
})

const tokensRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await prisma.apiToken.findMany({
      where: { userId: ctx.session.user.id, revokedAt: null },
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
   * value here means a real agent completed a real request.
   */
  connection: protectedProcedure.query(async ({ ctx }) => {
    const rows = await prisma.apiToken.findMany({
      where: { userId: ctx.session.user.id, revokedAt: null },
      select: { lastUsedAt: true },
    })
    const lastUsed = rows.reduce<Date | null>(
      (latest, r) => (r.lastUsedAt && (!latest || r.lastUsedAt > latest) ? r.lastUsedAt : latest),
      null
    )
    return { tokenCount: rows.length, lastUsedAt: iso(lastUsed) }
  }),

  /**
   * The raw token is returned exactly once, at creation. The row's `id` and
   * `name` come back with it so the caller can offer a rename without a
   * round-trip through `list` — /connect mints with an auto-generated name and
   * lets you correct it afterwards rather than demanding one up front.
   */
  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const raw = `hb_${randomBytes(24).toString('base64url')}`
      const created = await prisma.apiToken.create({
        data: {
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
    .input(z.object({ tokenId: z.string(), name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      await prisma.apiToken.updateMany({
        where: { id: input.tokenId, userId: ctx.session.user.id },
        data: { name: input.name },
      })
      return { ok: true }
    }),

  revoke: protectedProcedure
    .input(z.object({ tokenId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.apiToken.updateMany({
        where: { id: input.tokenId, userId: ctx.session.user.id },
        data: { revokedAt: new Date() },
      })
      return { ok: true }
    }),
})

const projectsRouter = router({
  list: protectedProcedure
    .input(z.object({ teamId: z.string().nullable() }))
    .query(async ({ ctx, input }) => {
      const space = toSpace(input.teamId, ctx.session.user.id)
      await requireSpaceAccess(ctx.session.user.id, space)
      const rows = await prisma.project.findMany({
        where: spaceWhere(space),
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

  /**
   * Every project the caller reaches — their personal space plus each team they
   * belong to. Membership is the whole access check: the `where` can only match
   * spaces they're in, so there's nothing left to authorize per row.
   */
  all: protectedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id
    const teamIds = await memberTeamIds(me)
    const rows = await prisma.project.findMany({
      where: reachWhere(me, teamIds),
      select: {
        id: true,
        name: true,
        slug: true,
        teamId: true,
        // The space's name off the relation, so a list spanning several teams
        // costs no extra query.
        team: { select: { name: true } },
        _count: { select: { walkthroughs: true } },
      },
    })
    return (
      rows
        .map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          teamId: p.teamId,
          spaceName: p.team?.name ?? 'Personal',
          walkthroughCount: p._count.walkthroughs,
        }))
        // Personal leads; teams follow alphabetically, projects by name within one.
        .sort(
          (a, b) =>
            Number(a.teamId !== null) - Number(b.teamId !== null) ||
            a.spaceName.localeCompare(b.spaceName) ||
            a.name.localeCompare(b.name)
        )
    )
  }),

  create: protectedProcedure
    .input(
      z.object({
        teamId: z.string().nullable(),
        name: z.string().trim().min(1).max(80),
        originHints: z.array(z.string().trim().max(200)).max(20).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const space = toSpace(input.teamId, ctx.session.user.id)
      await requireSpaceAccess(ctx.session.user.id, space)
      const base = slugify(input.name)
      // Slug uniqueness is per space and code-enforced — the ownership pair is
      // nullable, so the database can't hold the unique for us.
      let slug = base
      for (
        let n = 2;
        await prisma.project.findFirst({ where: { ...spaceWhere(space), slug } });
        n++
      ) {
        slug = `${base}-${n}`
      }
      const p = await prisma.project.create({
        data: {
          teamId: space.teamId,
          userId: space.userId,
          name: input.name,
          slug,
          originHints: input.originHints,
        },
      })
      return { id: p.id, slug: p.slug }
    }),

  update: protectedProcedure
    .input(
      z.object({
        teamId: z.string().nullable(),
        projectId: z.string(),
        name: z.string().trim().min(1).max(80),
        // Optional, not defaulted: the UI no longer edits hints, and a rename
        // must not silently wipe the routing an upload depends on.
        originHints: z.array(z.string().trim().max(200)).max(20).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const space = toSpace(input.teamId, ctx.session.user.id)
      await requireSpaceAccess(ctx.session.user.id, space)
      const p = await prisma.project.findUnique({ where: { id: input.projectId } })
      if (!p || p.teamId !== space.teamId || p.userId !== space.userId) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      // Slug stays for the same reason a team's does.
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
        teamId: z.string().nullable(),
        projectId: z.string().optional(),
        status: z.enum(['open', 'in_review', 'resolved']).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const space = toSpace(input.teamId, ctx.session.user.id)
      await requireSpaceAccess(ctx.session.user.id, space)
      const rows = await prisma.walkthrough.findMany({
        where: {
          ...spaceWhere(space),
          finalizedAt: { not: null },
          ...(input.projectId ? { projectId: input.projectId } : {}),
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

  /**
   * `list` widened across every space the caller reaches — personal plus each
   * team — for the one inbox that spans them. Same finalized-only rule and same
   * 200-row ceiling; each row names its space so the list stays readable when
   * it interleaves. The `where` is the access check (see projects.all).
   */
  inbox: protectedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id
    const teamIds = await memberTeamIds(me)
    const rows = await prisma.walkthrough.findMany({
      where: { ...reachWhere(me, teamIds), finalizedAt: { not: null } },
      orderBy: { recordedAt: 'desc' },
      take: 200,
      select: { ...walkthroughListSelect, teamId: true, team: { select: { name: true } } },
    })
    return rows.map((g) => ({
      id: g.id,
      slug: g.slug,
      title: g.title,
      origin: g.origin,
      status: asStatus(g.status),
      recordedAt: g.recordedAt.toISOString(),
      durationMs: g.durationMs,
      frameCount: g.frameCount,
      errorCount: g.errorCount,
      takeCount: g._count.takes,
      projectId: g.projectId,
      projectName: g.project?.name ?? null,
      teamId: g.teamId,
      spaceName: g.team?.name ?? 'Personal',
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
      const space: SpaceOwner = { teamId: g.teamId, userId: g.userId }
      const { isMember } = await requireViewAccess(ctx.session.user.id, space)
      return {
        id: g.id,
        teamId: g.teamId,
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
            url: await presignGet(walkthroughKey(spaceId(space), g.id, f.path)),
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
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireViewAccess(ctx.session.user.id, g)
      const file = await prisma.walkthroughFile.findUnique({
        where: { walkthroughId_path: { walkthroughId: input.walkthroughId, path: input.path } },
      })
      if (!file || file.status !== 'uploaded') throw new TRPCError({ code: 'NOT_FOUND' })
      return { url: await presignGet(walkthroughKey(spaceId(g), input.walkthroughId, input.path)) }
    }),

  setStatus: protectedProcedure
    .input(
      z.object({ walkthroughId: z.string(), status: z.enum(['open', 'in_review', 'resolved']) })
    )
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
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
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
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
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
      if (input.projectId) {
        const p = await prisma.project.findUnique({ where: { id: input.projectId } })
        // Projects belong to one space; a walkthrough can only be filed under
        // one that shares its owner.
        if (!p || p.teamId !== g.teamId || p.userId !== g.userId) {
          throw new TRPCError({ code: 'BAD_REQUEST' })
        }
      }
      await prisma.walkthrough.update({
        where: { id: input.walkthroughId },
        data: { projectId: input.projectId },
      })
      return { ok: true }
    }),

  /**
   * Move a walkthrough to another space the caller can reach — a team they
   * belong to, or their own personal space (`teamId: null`).
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
  move: protectedProcedure
    .input(z.object({ walkthroughId: z.string(), teamId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      const source: SpaceOwner = { teamId: g.teamId, userId: g.userId }
      const dest = toSpace(input.teamId, ctx.session.user.id)
      // Both ends have to admit the caller: a move must not be a way to walk
      // content out of a space they only half belong to.
      await requireSpaceAccess(ctx.session.user.id, source)
      await requireSpaceAccess(ctx.session.user.id, dest)
      const moved = await relocate(input.walkthroughId, dest)
      return { ok: true, ...moved }
    }),

  delete: protectedProcedure
    .input(z.object({ walkthroughId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      // Deleting a team's recording is an admin act; deleting your own from
      // your personal space is not — there is nobody else to answer to.
      if (g.teamId) await requireTeamRole(ctx.session.user.id, g.teamId, 'admin')
      else await requireSpaceAccess(ctx.session.user.id, g)
      await deletePrefix(walkthroughPrefix(spaceId(g), input.walkthroughId))
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

  /** The overview page in one round trip: counts, status mix, latest arrivals. */
  overview: protectedProcedure.query(async ({ ctx }) => {
    await requireAdmin(ctx.session.user.id)
    const [users, teams, projects, walkthroughs, bytes, byStatus, recentUsers, recentWalkthroughs] =
      await Promise.all([
        prisma.user.count(),
        prisma.team.count(),
        prisma.project.count(),
        prisma.walkthrough.count(),
        prisma.walkthrough.aggregate({ _sum: { bytes: true } }),
        prisma.walkthrough.groupBy({ by: ['status'], _count: true }),
        prisma.user.findMany({
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { id: true, name: true, email: true, isAdmin: true, createdAt: true },
        }),
        prisma.walkthrough.findMany({
          orderBy: { uploadedAt: 'desc' },
          take: 8,
          include: {
            team: { select: { name: true } },
            user: { select: { name: true } },
            uploadedBy: { select: { name: true } },
          },
        }),
      ])
    const statusCount = (s: string) => byStatus.find((r) => r.status === s)?._count ?? 0
    return {
      counts: {
        users,
        teams,
        projects,
        walkthroughs,
        bytes: Number(bytes._sum.bytes ?? 0),
        open: statusCount('open'),
        inReview: statusCount('in_review'),
        resolved: statusCount('resolved'),
      },
      recentUsers: recentUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        isAdmin: isPlatformAdmin(u),
        createdAt: u.createdAt.toISOString(),
      })),
      recentWalkthroughs: recentWalkthroughs.map((g) => ({
        id: g.id,
        title: g.title,
        status: g.status,
        space: g.team?.name ?? `${g.user?.name ?? 'unknown'} (personal)`,
        teamId: g.teamId,
        uploadedByName: g.uploadedBy?.name ?? null,
        uploadedAt: g.uploadedAt.toISOString(),
      })),
    }
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
            include: { team: { select: { name: true, ownerId: true } } },
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
        teams: u.memberships.map((m) => ({
          name: m.team.name,
          role: m.team.ownerId === u.id ? 'owner' : m.role,
        })),
      }))
    }),

  /**
   * Every walkthrough one account can see, grouped by space — the drill-down
   * behind a row on /admin. Personal always comes first and always exists, even
   * when it's empty, because it's the one space nobody can be removed from.
   * Unfinalized walkthroughs are included and flagged: a declare that never
   * finalized is invisible in the product and is exactly the kind of stuck
   * upload an admin is looking for.
   */
  userWalkthroughs: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const memberships = await prisma.membership.findMany({
        where: { userId: input.userId },
        select: { role: true, team: { select: { id: true, name: true, ownerId: true } } },
        orderBy: { createdAt: 'asc' },
      })

      const walkthroughs = await prisma.walkthrough.findMany({
        where: {
          OR: [{ userId: input.userId }, ...memberships.map((m) => ({ teamId: m.team.id }))],
        },
        orderBy: { uploadedAt: 'desc' },
        take: 500,
        include: {
          project: { select: { name: true } },
          uploadedBy: { select: { id: true, name: true } },
        },
      })

      const item = (g: (typeof walkthroughs)[number]) => ({
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
        // Their own recording vs. one a teammate uploaded.
        uploadedByThem: g.uploadedById === input.userId,
      })

      const space = (teamId: string | null, name: string) => ({ teamId, name })
      return [
        {
          space: space(null, 'Personal'),
          role: 'owner',
          walkthroughs: walkthroughs.filter((g) => g.userId === input.userId).map(item),
        },
        ...memberships.map((m) => ({
          space: space(m.team.id, m.team.name),
          role: m.team.ownerId === input.userId ? 'owner' : m.role,
          walkthroughs: walkthroughs.filter((g) => g.teamId === m.team.id).map(item),
        })),
      ]
    }),

  /** One account in full: profile, teams, tokens, what they hold. */
  user: protectedProcedure.input(z.object({ userId: z.string() })).query(async ({ ctx, input }) => {
    await requireAdmin(ctx.session.user.id)
    const u = await prisma.user.findUnique({
      where: { id: input.userId },
      include: {
        memberships: {
          include: { team: { select: { id: true, name: true, ownerId: true } } },
          orderBy: { createdAt: 'asc' },
        },
        apiTokens: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!u) throw new TRPCError({ code: 'NOT_FOUND' })
    const [uploads, personal, perTeam] = await Promise.all([
      prisma.walkthrough.count({ where: { uploadedById: u.id } }),
      prisma.walkthrough.aggregate({
        where: { teamId: null, userId: u.id },
        _count: true,
        _sum: { bytes: true },
      }),
      // What THEY uploaded into each team — the per-user-per-team cell.
      prisma.walkthrough.groupBy({
        by: ['teamId'],
        where: { uploadedById: u.id, teamId: { not: null } },
        _count: true,
        _sum: { bytes: true },
      }),
    ])
    const teamUploadsFor = new Map(perTeam.map((r) => [r.teamId, r]))
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      isAdmin: isPlatformAdmin(u),
      features: u.features,
      createdAt: u.createdAt.toISOString(),
      teams: u.memberships.map((m) => ({
        id: m.team.id,
        name: m.team.name,
        role: m.team.ownerId === u.id ? 'owner' : m.role,
        joinedAt: m.createdAt.toISOString(),
        uploads: teamUploadsFor.get(m.team.id)?._count ?? 0,
        uploadedBytes: Number(teamUploadsFor.get(m.team.id)?._sum.bytes ?? 0),
      })),
      tokens: u.apiTokens.map((t) => ({
        id: t.id,
        name: t.name,
        lastFour: t.lastFour,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: iso(t.lastUsedAt),
        revokedAt: iso(t.revokedAt),
      })),
      counts: {
        uploads,
        personalWalkthroughs: personal._count,
        personalBytes: Number(personal._sum.bytes ?? 0),
      },
    }
  }),

  /** Every team on the platform, sized: seats, members, projects, storage. */
  teams: protectedProcedure
    .input(z.object({ query: z.string().trim().max(100).default('') }))
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const [rows, usage] = await Promise.all([
        prisma.team.findMany({
          where: input.query
            ? {
                OR: [
                  { name: { contains: input.query, mode: 'insensitive' } },
                  { slug: { contains: input.query, mode: 'insensitive' } },
                  { owner: { email: { contains: input.query, mode: 'insensitive' } } },
                ],
              }
            : undefined,
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            owner: { select: { id: true, name: true, email: true } },
            _count: { select: { memberships: true, projects: true, walkthroughs: true } },
          },
        }),
        // One aggregate pass instead of a sum query per team.
        prisma.walkthrough.groupBy({
          by: ['teamId'],
          where: { teamId: { not: null } },
          _sum: { bytes: true },
        }),
      ])
      const now = Date.now()
      const pending = await prisma.invite.groupBy({
        by: ['teamId'],
        where: { acceptedAt: null, expiresAt: { gt: new Date(now) } },
        _count: true,
      })
      const bytesFor = new Map(usage.map((r) => [r.teamId, Number(r._sum.bytes ?? 0)]))
      const pendingFor = new Map(pending.map((r) => [r.teamId, r._count]))
      return rows.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        owner: t.owner,
        seatLimit: t.seatLimit,
        createdAt: t.createdAt.toISOString(),
        members: t._count.memberships,
        pendingInvites: pendingFor.get(t.id) ?? 0,
        projects: t._count.projects,
        walkthroughs: t._count.walkthroughs,
        bytes: bytesFor.get(t.id) ?? 0,
      }))
    }),

  /** One team in full: roster, open invites, projects, latest uploads. */
  team: protectedProcedure.input(z.object({ teamId: z.string() })).query(async ({ ctx, input }) => {
    await requireAdmin(ctx.session.user.id)
    const t = await prisma.team.findUnique({
      where: { id: input.teamId },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        memberships: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
        invites: {
          where: { acceptedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
        },
        projects: {
          include: { _count: { select: { walkthroughs: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!t) throw new TRPCError({ code: 'NOT_FOUND' })
    const [walkthroughs, bytes, perMember] = await Promise.all([
      prisma.walkthrough.findMany({
        where: { teamId: t.id },
        orderBy: { uploadedAt: 'desc' },
        take: 50,
        include: {
          project: { select: { name: true } },
          uploadedBy: { select: { name: true } },
        },
      }),
      prisma.walkthrough.aggregate({ where: { teamId: t.id }, _sum: { bytes: true } }),
      // Who is actually filling this team — usage per member.
      prisma.walkthrough.groupBy({
        by: ['uploadedById'],
        where: { teamId: t.id },
        _count: true,
        _sum: { bytes: true },
      }),
    ])
    const memberUsageFor = new Map(perMember.map((r) => [r.uploadedById, r]))
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      owner: t.owner,
      seatLimit: t.seatLimit,
      createdAt: t.createdAt.toISOString(),
      bytes: Number(bytes._sum.bytes ?? 0),
      members: t.memberships.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: t.ownerId === m.user.id ? 'owner' : m.role,
        joinedAt: m.createdAt.toISOString(),
        uploads: memberUsageFor.get(m.user.id)?._count ?? 0,
        uploadedBytes: Number(memberUsageFor.get(m.user.id)?._sum.bytes ?? 0),
      })),
      invites: t.invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
      })),
      projects: t.projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        walkthroughs: p._count.walkthroughs,
        createdAt: p.createdAt.toISOString(),
      })),
      walkthroughs: walkthroughs.map((g) => ({
        id: g.id,
        slug: g.slug,
        title: g.title,
        status: g.status,
        origin: g.origin,
        projectName: g.project?.name ?? null,
        uploadedByName: g.uploadedBy?.name ?? null,
        uploadedAt: g.uploadedAt.toISOString(),
        durationMs: g.durationMs,
        bytes: Number(g.bytes),
        finalized: g.finalizedAt !== null,
      })),
    }
  }),

  /** Platform-wide walkthrough feed, filterable — the "what is happening" view. */
  walkthroughs: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().max(100).default(''),
        status: z.enum(['open', 'in_review', 'resolved']).nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const rows = await prisma.walkthrough.findMany({
        where: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.query
            ? {
                OR: [
                  { title: { contains: input.query, mode: 'insensitive' } },
                  { slug: { contains: input.query, mode: 'insensitive' } },
                  { origin: { contains: input.query, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { uploadedAt: 'desc' },
        take: 100,
        include: {
          team: { select: { id: true, name: true } },
          user: { select: { name: true } },
          project: { select: { name: true } },
          uploadedBy: { select: { name: true } },
        },
      })
      return rows.map((g) => ({
        id: g.id,
        slug: g.slug,
        title: g.title,
        status: g.status,
        origin: g.origin,
        space: g.team?.name ?? `${g.user?.name ?? 'unknown'} (personal)`,
        teamId: g.teamId,
        projectName: g.project?.name ?? null,
        uploadedByName: g.uploadedBy?.name ?? null,
        uploadedAt: g.uploadedAt.toISOString(),
        durationMs: g.durationMs,
        bytes: Number(g.bytes),
        finalized: g.finalizedAt !== null,
      }))
    }),

  /**
   * The full anatomy of one walkthrough, including the EXACT brief an agent
   * pulls over MCP — built by the same code path (getWalkthroughDetail +
   * formatWalkthrough) under a synthetic admin auth, so what /admin shows and
   * what an agent sees cannot drift.
   */
  walkthroughDebug: protectedProcedure
    .input(z.object({ walkthroughId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        include: {
          team: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, email: true } },
          project: { select: { id: true, name: true } },
          uploadedBy: { select: { id: true, name: true, email: true } },
          takes: { orderBy: { index: 'asc' } },
          files: { orderBy: { path: 'asc' } },
        },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      const sid = spaceId({ teamId: g.teamId, userId: g.userId })
      const urls = new Map(
        await Promise.all(
          g.files
            .filter((f) => f.status === 'uploaded')
            .map(
              async (f) => [f.path, await presignGet(walkthroughKey(sid, g.id, f.path))] as const
            )
        )
      )
      // The agent's view, through the agent's own pipeline — reportMd included,
      // so it can't be fetched a second, subtly different way.
      const detail = await getWalkthroughDetail(
        { userId: ctx.session.user.id, tokenId: 'admin-ui', isAdmin: true },
        g.id
      )
      const brief = detail ? formatWalkthrough(detail) : null
      const frameFiles = g.files.filter(
        (f) => f.path.includes('/frames/') && f.status === 'uploaded'
      ).length
      return {
        id: g.id,
        slug: g.slug,
        title: g.title,
        status: g.status,
        origin: g.origin,
        space: {
          kind: g.teamId ? ('team' as const) : ('personal' as const),
          id: g.teamId ?? g.userId ?? '',
          name: g.team?.name ?? `${g.user?.name ?? 'unknown'} (personal)`,
        },
        project: g.project,
        uploadedBy: g.uploadedBy,
        recordedAt: g.recordedAt.toISOString(),
        uploadedAt: g.uploadedAt.toISOString(),
        finalizedAt: iso(g.finalizedAt),
        resolvedAt: iso(g.resolvedAt),
        durationMs: g.durationMs,
        frameCount: g.frameCount,
        errorCount: g.errorCount,
        droppedCount: g.droppedCount,
        bytes: Number(g.bytes),
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
        files: g.files.map((f) => ({
          id: f.id,
          path: f.path,
          size: f.size,
          contentType: f.contentType,
          status: f.status,
          url: urls.get(f.path) ?? null,
        })),
        reportMd: detail?.reportMd ?? null,
        brief,
        briefFrameLimit: briefFrameLimit(g.durationMs),
        frameFilesUploaded: frameFiles,
      }
    }),

  /**
   * Consumption per space, ranked — every team (even idle ones) plus every
   * personal space that actually holds something, against the ingest quotas.
   */
  usage: protectedProcedure.query(async ({ ctx }) => {
    await requireAdmin(ctx.session.user.id)
    const [teamUsage, personalUsage, teams] = await Promise.all([
      prisma.walkthrough.groupBy({
        by: ['teamId'],
        where: { teamId: { not: null } },
        _count: true,
        _sum: { bytes: true, durationMs: true },
      }),
      prisma.walkthrough.groupBy({
        by: ['userId'],
        where: { teamId: null, userId: { not: null } },
        _count: true,
        _sum: { bytes: true, durationMs: true },
      }),
      prisma.team.findMany({
        select: {
          id: true,
          name: true,
          owner: { select: { email: true } },
          _count: { select: { memberships: true } },
        },
      }),
    ])
    const users = await prisma.user.findMany({
      where: { id: { in: personalUsage.map((r) => r.userId).filter((v) => v !== null) } },
      select: { id: true, name: true, email: true },
    })
    const teamFor = new Map(teamUsage.map((r) => [r.teamId, r]))
    const userFor = new Map(users.map((u) => [u.id, u]))
    const spaces = [
      ...teams.map((t) => {
        const u = teamFor.get(t.id)
        return {
          kind: 'team' as const,
          id: t.id,
          name: t.name,
          detail: `${t._count.memberships} ${t._count.memberships === 1 ? 'member' : 'members'} · ${t.owner.email}`,
          walkthroughs: u?._count ?? 0,
          bytes: Number(u?._sum.bytes ?? 0),
          durationMs: u?._sum.durationMs ?? 0,
        }
      }),
      ...personalUsage.map((r) => {
        const u = r.userId ? userFor.get(r.userId) : undefined
        return {
          kind: 'personal' as const,
          id: r.userId ?? '',
          name: u ? `${u.name} (personal)` : 'unknown (personal)',
          detail: u?.email ?? '',
          walkthroughs: r._count,
          bytes: Number(r._sum.bytes ?? 0),
          durationMs: r._sum.durationMs ?? 0,
        }
      }),
    ].sort((a, b) => b.bytes - a.bytes)
    return {
      quota: { bytes: SPACE_QUOTA_BYTES, walkthroughs: SPACE_MAX_WALKTHROUGHS },
      spaces,
    }
  }),

  /** Seats are the paid knob; until billing exists, this hand-crank is it. */
  setSeatLimit: protectedProcedure
    .input(z.object({ teamId: z.string(), seatLimit: z.number().int().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const members = await prisma.membership.count({ where: { teamId: input.teamId } })
      if (input.seatLimit < members) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Team already has ${members} members — seats cannot go below that`,
        })
      }
      await prisma.team.update({
        where: { id: input.teamId },
        data: { seatLimit: input.seatLimit },
      })
      return { ok: true }
    }),

  /** Hand-adds an existing account; seats still apply — raise the limit first. */
  addTeamMember: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        email: z.string().trim().toLowerCase().max(255),
        role: z.enum(['admin', 'member']).default('member'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const t = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { id: true, seatLimit: true, _count: { select: { memberships: true } } },
      })
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' })
      if (t._count.memberships >= t.seatLimit) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Team is at its ${t.seatLimit} seats — raise the limit first`,
        })
      }
      const u = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })
      if (!u) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No account with that email' })
      const existing = await prisma.membership.findUnique({
        where: { teamId_userId: { teamId: t.id, userId: u.id } },
        select: { id: true },
      })
      if (existing) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Already a member' })
      await prisma.membership.create({
        data: { teamId: t.id, userId: u.id, role: input.role },
      })
      return { ok: true }
    }),

  /** The owner cannot be removed — ownership transfers, it doesn't vacate. */
  removeTeamMember: protectedProcedure
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const t = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { ownerId: true },
      })
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' })
      if (input.userId === t.ownerId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Transfer ownership before removing the owner',
        })
      }
      // Idempotent: a membership already gone is the desired end state.
      await prisma.membership.deleteMany({
        where: { teamId: input.teamId, userId: input.userId },
      })
      return { ok: true }
    }),

  /** Owner's role is computed from Team.ownerId; it cannot be assigned away. */
  setTeamMemberRole: protectedProcedure
    .input(z.object({ teamId: z.string(), userId: z.string(), role: z.enum(['admin', 'member']) }))
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const t = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { ownerId: true },
      })
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' })
      if (input.userId === t.ownerId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "The owner's role is ownership — transfer it instead",
        })
      }
      const res = await prisma.membership.updateMany({
        where: { teamId: input.teamId, userId: input.userId },
        data: { role: input.role },
      })
      if (res.count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Not a member' })
      return { ok: true }
    }),

  /** Kills a pending join link — the id IS the credential. */
  revokeInvite: protectedProcedure
    .input(z.object({ inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const res = await prisma.invite.deleteMany({
        where: { id: input.inviteId, acceptedAt: null },
      })
      if (res.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { ok: true }
    }),

  /**
   * Deletes an account and its entire personal space (rows cascade; S3 prefix
   * wiped wholesale). Teams keep everything uploaded to them — uploadedById
   * just goes null. Owners must transfer first; admins must be demoted first.
   */
  deleteUser: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot delete yourself' })
      }
      const u = await prisma.user.findUnique({
        where: { id: input.userId },
        include: { ownedTeams: { select: { name: true } } },
      })
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' })
      if (isPlatformAdmin(u)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Revoke their admin before deleting the account',
        })
      }
      if (u.ownedTeams.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `They still own ${u.ownedTeams.map((t) => t.name).join(', ')} — transfer ownership first`,
        })
      }
      // Their unaccepted join links die with them — the invite id IS the
      // credential and createdById has no FK to cascade it.
      await prisma.invite.deleteMany({ where: { createdById: u.id, acceptedAt: null } })
      // S3 first: if the wipe fails the account survives intact, which beats a
      // deleted row pointing at orphaned objects nobody can list anymore.
      await deletePrefix(spacePrefix(u.id))
      await prisma.user.delete({ where: { id: u.id } })
      return { ok: true }
    }),

  /** Deletes a team and everything it holds. Members keep their accounts. */
  deleteTeam: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const t = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { id: true },
      })
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' })
      await deletePrefix(spacePrefix(t.id))
      await prisma.team.delete({ where: { id: t.id } })
      return { ok: true }
    }),

  /**
   * Move any walkthrough anywhere: a team, or (teamId null) the uploader's
   * personal space. Quotas still apply — an admin move is not a quota bypass.
   */
  moveWalkthrough: protectedProcedure
    .input(z.object({ walkthroughId: z.string(), teamId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx.session.user.id)
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { uploadedById: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      let dest: SpaceOwner
      if (input.teamId) {
        const team = await prisma.team.findUnique({
          where: { id: input.teamId },
          select: { id: true },
        })
        if (!team) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such team' })
        dest = { teamId: team.id, userId: null }
      } else {
        if (!g.uploadedById) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'No uploader on record — no personal space to move it to',
          })
        }
        dest = { teamId: null, userId: g.uploadedById }
      }
      const moved = await relocate(input.walkthroughId, dest)
      return { ok: true, ...moved }
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
  teams: teamsRouter,
  invites: invitesRouter,
  tokens: tokensRouter,
  projects: projectsRouter,
  walkthroughs: walkthroughsRouter,
  admin: adminRouter,
})

export type AppRouter = typeof appRouter
