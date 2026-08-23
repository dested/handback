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
import { agentConfigured, runWalkthroughChat } from './agent'
import { inviteEmail, sendEmail, walkthroughQuestionEmail } from './email'
import { env } from './env'
import { isPlatformAdmin, requireAdmin, teamHasFeature, userHasFeature, userIsPro } from './features'
import {
  MAX_FILE_BYTES,
  MAX_WALKTHROUGH_BYTES,
  SPACE_MAX_WALKTHROUGHS,
  SPACE_QUOTA_BYTES,
} from './ingest'
import {
  FREE_CLOUD_TRANSCRIBE_SECONDS,
  MAX_ACTIVE_TOKENS,
  PRO_CLOUD_TRANSCRIBE_SECONDS,
} from './limits'
import { log } from './logger'
import { briefFrameLimit, formatWalkthrough } from './mcp-format'
import { unsubscribeUrl } from './notify'
import { prisma } from './prisma'
import { checkLimit } from './ratelimit'
import { refineConfigured, runRefine } from './refine'
import { latestRecorderRelease } from './releases'
import { expiryFor } from './retention'
import { indexWalkthrough, searchWalkthroughIds } from './search'
import {
  copyObject,
  deleteKeys,
  deletePrefix,
  getObjectText,
  spacePrefix,
  walkthroughKey,
  walkthroughPrefix,
  isSafePath,
  presignGet,
  presignPut,
} from './storage'
import { childBriefMd, proposeStructure, structureConfigured } from './structure'
import { checkAndReservePolish, cloudStatus } from './usage'
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
    return {
      canCreateTeams: u !== null && userHasFeature(u, 'team'),
      pro: u !== null && userHasFeature(u, 'pro'),
    }
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
      const user = await prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { email: true, isAdmin: true, emailVerified: true },
      })
      if (!user) throw new TRPCError({ code: 'NOT_FOUND' })
      // Verified email gates token minting — a working `hb_` token is the key to
      // the paid cloud passes, so a throwaway account can't mint one. Platform
      // admins are exempt.
      if (!user.emailVerified && !isPlatformAdmin(user)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Verify your email to create API tokens.',
        })
      }
      // Then a per-account cap on live tokens (after the verification gate).
      const active = await prisma.apiToken.count({
        where: { userId: ctx.session.user.id, revokedAt: null },
      })
      if (active >= MAX_ACTIVE_TOKENS) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Too many active tokens — revoke one first.',
        })
      }
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
        // Standing project context, prepended to every brief in this project.
        instructions: p.instructions ?? null,
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
        instructions: true,
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
          instructions: p.instructions ?? null,
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
        // Standing project context. Optional like the hints — only touched when
        // present; a trimmed-empty string clears it back to null.
        instructions: z.string().trim().max(4000).nullable().optional(),
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
          ...(input.instructions !== undefined
            ? { instructions: input.instructions ? input.instructions : null }
            : {}),
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
  intent: true,
  kind: true,
  recordedAt: true,
  uploadedAt: true,
  expiresAt: true,
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

/**
 * The only paths the in-viewer editor may write, and the whole of what an edit
 * produces: the render, its transcript on the edited clock, and the EDL that
 * made it. Everything else about a walkthrough arrives through ingest's declare
 * — this is a narrow second door for a walkthrough that already exists, so it
 * is an allowlist rather than `isSafePath`.
 */
const EDIT_PATHS = ['final.mp4', 'transcript.json', 'edit.json'] as const

const editPathSchema = z.enum(EDIT_PATHS)

/** Sizes in a refusal are for a person to read, so they are gigabytes. */
const gbLabel = (bytes: number | bigint) =>
  `${(Number(bytes) / (1024 * 1024 * 1024)).toFixed(1)} GB`

/**
 * A walkthrough the caller may attach an edit to: human, finalized, and in a
 * space they belong to. Read access isn't enough — this writes.
 */
async function requireEditable(userId: string, walkthroughId: string) {
  const g = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    select: { id: true, teamId: true, userId: true, kind: true, finalizedAt: true, bytes: true },
  })
  if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
  await requireSpaceAccess(userId, g)
  if (g.kind !== 'human') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a human handback can be edited' })
  }
  if (!g.finalizedAt) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This walkthrough never finished uploading',
    })
  }
  return g
}

/**
 * A walkthrough the caller may split into tasks: agent kind (a human handback
 * is a video, not a backlog), finalized, in a space they belong to, and not
 * itself a child — a task carved out of a task is noise.
 */
async function requireSplittable(userId: string, walkthroughId: string) {
  const g = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    select: {
      id: true,
      slug: true,
      title: true,
      origin: true,
      teamId: true,
      userId: true,
      projectId: true,
      recordedAt: true,
      durationMs: true,
      kind: true,
      finalizedAt: true,
      parentId: true,
    },
  })
  if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
  await requireSpaceAccess(userId, g)
  if (g.kind !== 'agent') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only an agent walkthrough can be split' })
  }
  if (!g.finalizedAt) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This walkthrough never finished uploading',
    })
  }
  if (g.parentId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'This is already a split-out task' })
  }
  return g
}

/** What the human confirms — the proposal, possibly trimmed or retitled. */
const proposedTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  severity: z.enum(['low', 'medium', 'high']),
  repro: z.array(z.string().trim().min(1).max(500)).max(10),
  acceptance: z.array(z.string().trim().min(1).max(500)).max(10),
  startMs: z.number().int().min(0).nullable(),
  endMs: z.number().int().min(0).nullable(),
})

/** m:ss on the walkthrough clock, for the comment lines the pass reads. */
const commentStamp = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

/**
 * Refine's outputs live as Json columns; the viewer reads them through these,
 * which never throw — an un-refined or malformed blob degrades to the empty
 * shape (`[]` for health, `null` for curation) rather than breaking `get`.
 */
const healthJsonSchema = z.array(
  z.object({
    severity: z.enum(['info', 'warn']),
    text: z.string(),
    atMs: z.number().nullable().default(null),
  })
)
const curationJsonSchema = z.object({
  frames: z
    .array(z.object({ path: z.string(), caption: z.string(), atMs: z.number().nullable() }))
    .default([]),
  excluded: z
    .array(z.object({ startMs: z.number(), endMs: z.number(), reason: z.string() }))
    .default([]),
})
/** A chat turn's applied tool calls, for the transcript's meta line. */
const chatActionsSchema = z.array(z.object({ action: z.string(), detail: z.string() }))

const walkthroughsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        teamId: z.string().nullable(),
        projectId: z.string().optional(),
        status: z.enum(WALKTHROUGH_STATUSES).optional(),
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
        intent: g.intent,
        kind: g.kind,
        recordedAt: g.recordedAt.toISOString(),
        uploadedAt: g.uploadedAt.toISOString(),
        expiresAt: iso(g.expiresAt),
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
      select: {
        ...walkthroughListSelect,
        teamId: true,
        userId: true,
        team: { select: { name: true } },
      },
    })

    // One representative keyframe per card, for the agent-kind walkthroughs that
    // have frames. `distinct: ['walkthroughId']` over a path-ordered scan is a
    // single DISTINCT ON — the first frame file (`rec-01/frames/00-…jpg` sorts
    // first) of the first take per walkthrough, never every file of every one.
    const framedIds = rows.filter((g) => g.kind !== 'human').map((g) => g.id)
    const thumbFiles = framedIds.length
      ? await prisma.walkthroughFile.findMany({
          where: { walkthroughId: { in: framedIds }, status: 'uploaded', path: { contains: '/frames/' } },
          orderBy: [{ walkthroughId: 'asc' }, { path: 'asc' }],
          distinct: ['walkthroughId'],
          select: { walkthroughId: true, path: true },
        })
      : []
    const thumbPathById = new Map(thumbFiles.map((f) => [f.walkthroughId, f.path]))

    return Promise.all(
      rows.map(async (g) => {
        const thumbPath = thumbPathById.get(g.id)
        return {
          id: g.id,
          slug: g.slug,
          title: g.title,
          origin: g.origin,
          status: asStatus(g.status),
          intent: g.intent,
          kind: g.kind,
          recordedAt: g.recordedAt.toISOString(),
          expiresAt: iso(g.expiresAt),
          durationMs: g.durationMs,
          frameCount: g.frameCount,
          errorCount: g.errorCount,
          takeCount: g._count.takes,
          projectId: g.projectId,
          projectName: g.project?.name ?? null,
          teamId: g.teamId,
          spaceName: g.team?.name ?? 'Personal',
          uploadedByName: g.uploadedBy?.name ?? null,
          // Presigning is local HMAC signing — no S3 round trip — so one per
          // card at ≤200 items is cheap. Human kind or no frames → null.
          thumbUrl: thumbPath
            ? await presignGet(walkthroughKey(spaceId({ teamId: g.teamId, userId: g.userId }), g.id, thumbPath))
            : null,
        }
      })
    )
  }),

  /**
   * Full-text ids for the /app search box: which walkthroughs in my reach say
   * this, in the title, the report or the transcript. The client already holds
   * every inbox row, so ids are the whole answer — it unions them with its own
   * title matches. Corpus filled at finalize (server/search.ts).
   */
  search: protectedProcedure
    .input(z.object({ q: z.string().trim().min(2).max(200) }))
    .query(async ({ ctx, input }) => {
      const me = ctx.session.user.id
      const ids = await searchWalkthroughIds(me, await memberTeamIds(me), input.q)
      return { ids }
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
          notes: { orderBy: { createdAt: 'asc' } },
          // The trace is a courtesy line, not a log viewer — the newest few.
          access: { orderBy: { createdAt: 'desc' }, take: 5 },
          // The split, both directions: where this row came from, and what
          // was carved out of it.
          parent: { select: { id: true, title: true } },
          children: { select: { id: true, title: true, status: true }, orderBy: { slug: 'asc' } },
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
        // 'bug' | 'feature' | 'idea' | null — what the recording is FOR.
        intent: g.intent,
        kind: g.kind,
        // The whole credential for /w/<token>; null = not shared. Members only
        // ever see it here (the admin read-only path passes through too — a
        // platform admin can already reach every file of the walkthrough).
        shareToken: g.shareToken,
        recordedAt: g.recordedAt.toISOString(),
        uploadedAt: g.uploadedAt.toISOString(),
        // When this walkthrough auto-deletes (resolved + a retention window);
        // null = not scheduled. The viewer reads it to show "expires in Nd".
        expiresAt: iso(g.expiresAt),
        durationMs: g.durationMs,
        frameCount: g.frameCount,
        errorCount: g.errorCount,
        droppedCount: g.droppedCount,
        bytes: Number(g.bytes),
        // Refine's outputs, when it ran: the complete ledger, the pass status
        // ('running' | 'done' | 'failed' | null), and when it last finished.
        summaryMd: g.summaryMd,
        refineStatus: g.refineStatus,
        refinedAt: iso(g.refinedAt),
        // Capture-QC notes and the keyframe curation, both read leniently — an
        // un-refined or malformed blob degrades to [] / null, never a throw.
        health: (() => {
          const parsed = healthJsonSchema.safeParse(g.healthJson)
          return parsed.success ? parsed.data : []
        })(),
        curation: (() => {
          const parsed = curationJsonSchema.safeParse(g.curationJson)
          return parsed.success ? parsed.data : null
        })(),
        project: g.project,
        uploadedByName: g.uploadedBy?.name ?? null,
        // A child task's whole content; null on every ordinary walkthrough.
        briefMd: g.briefMd,
        parent: g.parent,
        children: g.children.map((c) => ({ id: c.id, title: c.title, status: asStatus(c.status) })),
        // Present when an edited render was uploaded (human handbacks) — signed
        // with a content-disposition so Download saves a named file.
        downloadUrl: await (async () => {
          const finalFile = g.files.find((f) => f.path === 'final.mp4')
          return finalFile
            ? presignGet(walkthroughKey(spaceId(space), g.id, finalFile.path), {
                downloadAs: `${g.slug}.mp4`,
              })
            : null
        })(),
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
        // The review thread (agent results + reviewer send-backs), oldest first
        // — what the "agent's answer" panel renders and sign-off acts on.
        notes: g.notes.map((n) => ({
          id: n.id,
          role: n.role,
          // 'result' | 'question' | 'answer' — the viewer renders each kind
          // differently (a question opens the answer box).
          kind: n.kind,
          summary: n.summary,
          prUrl: n.prUrl,
          filesTouched: n.filesTouched,
          // Proof-screenshot paths on this entry; their urls are in `files`.
          evidencePaths: n.evidencePaths,
          bodyMd: n.bodyMd,
          authorName: n.authorName,
          createdAt: n.createdAt.toISOString(),
        })),
        // Newest-first agent activity ("pulled by <token> 12m ago").
        activity: g.access.map((a) => ({
          tokenName: a.tokenName,
          action: a.action,
          detail: a.detail,
          createdAt: a.createdAt.toISOString(),
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
    .input(z.object({ walkthroughId: z.string(), status: z.enum(WALKTHROUGH_STATUSES) }))
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
          // resolved schedules auto-deletion; flipping back off resolved clears
          // it. Same call as the shared MCP path (setWalkthroughStatus).
          expiresAt: expiryFor(input.status),
        },
      })
      return { ok: true }
    }),

  /**
   * Tag what a walkthrough is FOR — a bug to fix, a feature to build, an idea to
   * assess — or clear it. Pure metadata; the brief's intent framing and the
   * agent queue read it. Same access bar as setStatus.
   */
  setIntent: protectedProcedure
    .input(
      z.object({
        walkthroughId: z.string(),
        intent: z.enum(['bug', 'feature', 'idea']).nullable(),
      })
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
        data: { intent: input.intent },
      })
      return { ok: true }
    }),

  /**
   * The reviewer's half of the return path: reject the agent's answer with a
   * note. The note lands in the review thread (so the agent reads it in the
   * brief when it re-pulls) and the walkthrough goes back to `open` — through
   * the same expiryFor write every status change takes.
   */
  sendBack: protectedProcedure
    .input(z.object({ walkthroughId: z.string(), note: z.string().trim().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
      await prisma.walkthroughNote.create({
        data: {
          walkthroughId: input.walkthroughId,
          role: 'reviewer',
          summary: input.note,
          filesTouched: [],
          authorName: ctx.session.user.name,
        },
      })
      await prisma.walkthrough.update({
        where: { id: input.walkthroughId },
        data: { status: 'open', resolvedAt: null, expiresAt: expiryFor('open') },
      })
      return { ok: true }
    }),

  /**
   * The reviewer answers an agent's question. Lands as a `kind:'answer'`
   * reviewer note (the agent reads it in the brief on its next pull) and, only
   * when the walkthrough is still waiting (`needs_info`), flips it back to open
   * through the same expiryFor write every status change takes. A question on an
   * already-resolved walkthrough leaves the status alone.
   */
  answerQuestion: protectedProcedure
    .input(z.object({ walkthroughId: z.string(), text: z.string().trim().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true, status: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
      await prisma.walkthroughNote.create({
        data: {
          walkthroughId: input.walkthroughId,
          role: 'reviewer',
          kind: 'answer',
          summary: input.text,
          filesTouched: [],
          authorName: ctx.session.user.name,
        },
      })
      if (g.status === 'needs_info') {
        await prisma.walkthrough.update({
          where: { id: input.walkthroughId },
          data: { status: 'open', resolvedAt: null, expiresAt: expiryFor('open') },
        })
      }
      return { ok: true }
    }),

  /**
   * Forward an agent's open question to the person who uploaded the walkthrough,
   * by email — for when the reviewer looking at it isn't the one who can answer.
   * Refuses if the caller is the uploader (they can answer here), if there's no
   * open question, or if the uploader has no verified address to mail.
   */
  routeQuestion: protectedProcedure
    .input(z.object({ walkthroughId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: {
          teamId: true,
          userId: true,
          title: true,
          uploadedById: true,
          uploadedBy: { select: { name: true, email: true, emailVerified: true } },
        },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
      const note = await prisma.walkthroughNote.findFirst({
        where: { walkthroughId: input.walkthroughId, kind: 'question' },
        orderBy: { createdAt: 'desc' },
        select: { summary: true },
      })
      if (!note) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No open question' })
      if (g.uploadedById === ctx.session.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You are the uploader — answer it here',
        })
      }
      if (!g.uploadedById || !g.uploadedBy || !g.uploadedBy.emailVerified) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The uploader has no verified email',
        })
      }
      const emailed = await sendEmail({
        to: g.uploadedBy.email,
        ...walkthroughQuestionEmail({
          title: g.title,
          question: note.summary,
          url: `${env.BETTER_AUTH_URL}/walkthroughs/${input.walkthroughId}`,
          unsubscribeUrl: unsubscribeUrl(g.uploadedById, 'results'),
        }),
      })
      return { ok: true, emailed }
    }),

  /**
   * The structuring pass, half one: read the walkthrough and propose the split.
   * A mutation, not a query — it spends a metered model call (same meter as the
   * cleanup pass). Nothing is written; the human gets the proposal to trim,
   * retitle and confirm, and only applySplit creates rows.
   */
  proposeSplit: protectedProcedure
    .input(z.object({ walkthroughId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const g = await requireSplittable(ctx.session.user.id, input.walkthroughId)
      if (!structureConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Structuring isn't configured on this server",
        })
      }
      const { allowed } = await checkAndReservePolish(ctx.session.user.id)
      if (!allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Splitting uses a metered cloud pass — this month’s budget is used up',
        })
      }
      const space: SpaceOwner = { teamId: g.teamId, userId: g.userId }
      const reportMd = await getObjectText(
        walkthroughKey(spaceId(space), g.id, 'report.md')
      ).catch(() => null)
      if (!reportMd) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This walkthrough has no report to read',
        })
      }
      const comments = await prisma.walkthroughComment.findMany({
        where: { walkthroughId: g.id },
        orderBy: { createdAt: 'asc' },
      })
      const tasks = await proposeStructure({
        title: g.title,
        durationMs: g.durationMs,
        reportMd,
        comments: comments.map(
          (c) =>
            `${c.atMs === null ? '' : `[${commentStamp(c.atMs)}] `}${c.authorName}: ${c.text}`
        ),
      })
      if (!tasks) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: "The structuring pass didn't come back with a usable proposal — try again",
        })
      }
      return { tasks }
    }),

  /**
   * Half two: the human confirmed, so the rows become real. Each child is a
   * metadata-only walkthrough — no files, no takes, ~0 bytes — whose whole
   * content is `briefMd` and whose evidence is the parent (the brief says so
   * in words). Finalized at birth so it lists like anything else.
   */
  applySplit: protectedProcedure
    .input(
      z.object({
        walkthroughId: z.string(),
        tasks: z.array(proposedTaskSchema).min(1).max(10),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const g = await requireSplittable(ctx.session.user.id, input.walkthroughId)
      const created: Array<{ id: string; slug: string; title: string }> = []
      for (const [i, task] of input.tasks.entries()) {
        // Per-space slug dedup, code-enforced like every other slug here. Earlier
        // children of this same loop are already inserted, so they collide too.
        const base = `${g.slug}-task-${i + 1}`
        let slug = base
        for (
          let n = 2;
          await prisma.walkthrough.findFirst({
            where: { ...spaceWhere({ teamId: g.teamId, userId: g.userId }), slug },
            select: { id: true },
          });
          n++
        ) {
          slug = `${base}-${n}`
        }
        const child = await prisma.walkthrough.create({
          data: {
            teamId: g.teamId,
            userId: g.userId,
            projectId: g.projectId,
            slug,
            title: task.title,
            origin: g.origin,
            status: 'open',
            kind: 'agent',
            recordedAt: g.recordedAt,
            uploadedById: ctx.session.user.id,
            finalizedAt: new Date(),
            parentId: g.id,
            briefMd: childBriefMd(task, g),
            // The brief is the corpus — no S3 object to index, so it's filled
            // inline instead of through indexWalkthrough.
            searchText: childBriefMd(task, g).replace(/\s+/g, ' ').trim(),
          },
        })
        created.push({ id: child.id, slug: child.slug, title: child.title })
      }
      log.info(`[structure] split ${g.slug} into ${created.length} tasks`)
      return { children: created }
    }),

  /**
   * Margin notes. Separate from `get` so posting one refetches a few rows, not
   * a few hundred re-presigned file URLs. `mine` is computed server-side —
   * it's the delete permission, and the client shouldn't have to know why.
   */
  comments: protectedProcedure
    .input(z.object({ walkthroughId: z.string() }))
    .query(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireViewAccess(ctx.session.user.id, g)
      const rows = await prisma.walkthroughComment.findMany({
        where: { walkthroughId: input.walkthroughId },
        orderBy: { createdAt: 'asc' },
      })
      return rows.map((c) => ({
        id: c.id,
        authorName: c.authorName,
        atMs: c.atMs,
        text: c.text,
        createdAt: c.createdAt.toISOString(),
        mine: c.userId === ctx.session.user.id,
      }))
    }),

  addComment: protectedProcedure
    .input(
      z.object({
        walkthroughId: z.string(),
        text: z.string().trim().min(1).max(2000),
        // The walkthrough-wide output clock, same axis as transcript/frames.
        atMs: z.number().int().min(0).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
      await prisma.walkthroughComment.create({
        data: {
          walkthroughId: input.walkthroughId,
          userId: ctx.session.user.id,
          authorName: ctx.session.user.name,
          atMs: input.atMs,
          text: input.text,
        },
      })
      return { ok: true }
    }),

  /**
   * Delete a comment: your own anywhere, or — because they belong to nobody —
   * the anonymous ones left by watch-page viewers (`userId: null`), which a
   * member of the walkthrough's space moderates. Someone else's real comment is
   * left untouched, the same silent no-op the old own-only `deleteMany` was.
   */
  deleteComment: protectedProcedure
    .input(z.object({ commentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const comment = await prisma.walkthroughComment.findUnique({
        where: { id: input.commentId },
        select: {
          userId: true,
          walkthrough: { select: { teamId: true, userId: true } },
        },
      })
      if (!comment) return { ok: true }
      if (comment.userId === ctx.session.user.id) {
        await prisma.walkthroughComment.delete({ where: { id: input.commentId } })
      } else if (comment.userId === null) {
        await requireSpaceAccess(ctx.session.user.id, comment.walkthrough)
        await prisma.walkthroughComment.delete({ where: { id: input.commentId } })
      }
      return { ok: true }
    }),

  /**
   * Cancel a scheduled auto-deletion — a resolved walkthrough someone wants to
   * hold on to. Same access bar as setStatus; reopening it (setStatus off
   * resolved) clears `expiresAt` too, this is the way to keep it *and* resolved.
   */
  keep: protectedProcedure
    .input(z.object({ walkthroughId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
      await prisma.walkthrough.update({
        where: { id: input.walkthroughId },
        data: { expiresAt: null },
      })
      return { ok: true }
    }),

  /**
   * Reclassify who a walkthrough is for. Pure metadata — no file is written,
   * moved or deleted; what changes is who can see it and how this page reads
   * it. agent→human hides it from every agent list and, if the raw takes are
   * still there, makes it tightenable. human→agent hands it back to the agents;
   * a walkthrough with no report.md already degrades to a null report in the
   * brief rather than breaking one, which is what makes this direction safe.
   */
  setKind: protectedProcedure
    .input(z.object({ walkthroughId: z.string(), kind: z.enum(['agent', 'human']) }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
      await prisma.walkthrough.update({
        where: { id: input.walkthroughId },
        data: { kind: input.kind },
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

  /**
   * Prune keyframes from a walkthrough — the slideshow's edit mode. Only paths
   * under a take's frames/ dir are deletable this way; the video, transcript and
   * report are not frames and stay out of reach. Rows go first, S3 second: a
   * crash in between leaves orphaned objects (wiped with the walkthrough's
   * prefix eventually), never rows presigning dead keys.
   */
  deleteFrames: protectedProcedure
    .input(
      z.object({ walkthroughId: z.string(), paths: z.array(z.string().min(1)).min(1).max(1000) })
    )
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true, frameCount: true, bytes: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
      if (input.paths.some((p) => !isSafePath(p) || !p.includes('/frames/'))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only keyframes can be deleted' })
      }
      const files = await prisma.walkthroughFile.findMany({
        where: { walkthroughId: input.walkthroughId, path: { in: input.paths }, status: 'uploaded' },
      })
      if (files.length === 0) return { ok: true, deleted: 0 }
      await prisma.walkthroughFile.deleteMany({ where: { id: { in: files.map((f) => f.id) } } })
      // Keep the take/walkthrough frame math honest — the meta line and the
      // brief's frame cap both read these counts.
      const byDir = new Map<string, number>()
      for (const f of files) {
        const dir = f.path.split('/')[0] ?? ''
        byDir.set(dir, (byDir.get(dir) ?? 0) + 1)
      }
      for (const [dir, n] of byDir) {
        await prisma.take.updateMany({
          where: { walkthroughId: input.walkthroughId, dir, frameCount: { gte: n } },
          data: { frameCount: { decrement: n } },
        })
      }
      const bytesFreed = files.reduce((n, f) => n + f.size, 0)
      const bytes = g.bytes - BigInt(bytesFreed)
      await prisma.walkthrough.update({
        where: { id: input.walkthroughId },
        data: {
          frameCount: Math.max(0, g.frameCount - files.length),
          bytes: bytes < 0n ? 0n : bytes,
        },
      })
      await deleteKeys(files.map((f) => walkthroughKey(spaceId(g), input.walkthroughId, f.path)))
      return { ok: true, deleted: files.length }
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

  /**
   * Mint (or re-mint) the share token — the whole credential behind /w/<token>,
   * same trust model as an unaddressed invite link. Re-sharing rotates the
   * token, which is also how an accidentally-leaked link is killed and replaced
   * in one move; `unshare` kills it outright.
   */
  share: protectedProcedure
    .input(z.object({ walkthroughId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true, finalizedAt: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
      // An unfinalized walkthrough has nothing watchable behind the link.
      if (!g.finalizedAt) throw new TRPCError({ code: 'BAD_REQUEST' })
      const shareToken = randomBytes(18).toString('base64url')
      await prisma.walkthrough.update({
        where: { id: input.walkthroughId },
        data: { shareToken, sharedAt: new Date() },
      })
      return { shareToken }
    }),

  unshare: protectedProcedure
    .input(z.object({ walkthroughId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
      await prisma.walkthrough.update({
        where: { id: input.walkthroughId },
        data: { shareToken: null, sharedAt: null },
      })
      return { ok: true }
    }),

  /**
   * Presigned PUTs for the artifacts the in-viewer editor produces. The mirror
   * of ingest's declare, one walkthrough down: same per-file cap, same
   * per-walkthrough cap, same space quota, same `ContentLength`-signed PUT so
   * S3 rejects an upload that doesn't match what was declared.
   *
   * Rows go back to 'pending' as they are re-declared, which is deliberate:
   * between this call and `finalizeEdit` the object in the bucket is being
   * overwritten, and a viewer pointed at it would be pointed at half a file.
   */
  presignEdit: protectedProcedure
    .input(
      z.object({
        walkthroughId: z.string(),
        files: z
          .array(
            z.object({
              path: editPathSchema,
              size: z.number().int().min(1).max(MAX_FILE_BYTES),
              contentType: z.string().min(1).max(120),
            })
          )
          .min(1)
          .max(EDIT_PATHS.length),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const g = await requireEditable(ctx.session.user.id, input.walkthroughId)
      const space: SpaceOwner = { teamId: g.teamId, userId: g.userId }

      const paths = input.files.map((f) => f.path)
      if (new Set(paths).size !== paths.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Duplicate path' })
      }

      // What the walkthrough will weigh once these land: everything already
      // uploaded that this call is *not* replacing, plus what it declares.
      const replacing = new Set<string>(paths)
      const existing = await prisma.walkthroughFile.findMany({
        where: { walkthroughId: g.id, status: 'uploaded' },
        select: { path: true, size: true },
      })
      const keptBytes = existing
        .filter((f) => !replacing.has(f.path))
        .reduce((sum, f) => sum + f.size, 0)
      const nextBytes = keptBytes + input.files.reduce((sum, f) => sum + f.size, 0)
      if (nextBytes > MAX_WALKTHROUGH_BYTES) {
        throw new TRPCError({
          code: 'PAYLOAD_TOO_LARGE',
          message: `This walkthrough would be ${gbLabel(nextBytes)}; the limit is ${gbLabel(MAX_WALKTHROUGH_BYTES)}`,
        })
      }

      // Quota is per space and counted after this write, so a re-edit doesn't
      // pay twice for the render it is replacing.
      const stored = await prisma.walkthrough.aggregate({
        where: spaceWhere(space),
        _sum: { bytes: true },
      })
      const otherBytes = (stored._sum.bytes ?? 0n) - g.bytes
      if (otherBytes + BigInt(nextBytes) > BigInt(SPACE_QUOTA_BYTES)) {
        throw new TRPCError({
          code: 'PAYLOAD_TOO_LARGE',
          message: `Storage quota reached: this space holds ${gbLabel(otherBytes)} of ${gbLabel(SPACE_QUOTA_BYTES)}.`,
        })
      }

      const uploads: Array<{ path: string; contentType: string; url: string }> = []
      for (const f of input.files) {
        await prisma.walkthroughFile.upsert({
          where: { walkthroughId_path: { walkthroughId: g.id, path: f.path } },
          create: {
            walkthroughId: g.id,
            path: f.path,
            size: f.size,
            contentType: f.contentType,
            status: 'pending',
          },
          update: { size: f.size, contentType: f.contentType, status: 'pending' },
        })
        uploads.push({
          path: f.path,
          contentType: f.contentType,
          url: await presignPut(
            walkthroughKey(spaceId(space), g.id, f.path),
            f.contentType,
            f.size
          ),
        })
      }
      return { walkthroughId: g.id, uploads }
    }),

  /**
   * The other half: the PUTs landed, so the rows become real, the walkthrough's
   * duration becomes the render's (the inbox should read as the video someone
   * will watch, not the raw takes it was cut from), and `bytes` is recomputed
   * from what is actually uploaded rather than adjusted by a delta.
   */
  finalizeEdit: protectedProcedure
    .input(
      z.object({
        walkthroughId: z.string(),
        paths: z.array(editPathSchema).min(1).max(EDIT_PATHS.length),
        /** The render's length. Capped at a day — a typo must not become the row. */
        durationMs: z
          .number()
          .int()
          .min(0)
          .max(24 * 60 * 60 * 1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const g = await requireEditable(ctx.session.user.id, input.walkthroughId)
      await prisma.walkthroughFile.updateMany({
        where: { walkthroughId: g.id, path: { in: input.paths } },
        data: { status: 'uploaded' },
      })
      const uploaded = await prisma.walkthroughFile.aggregate({
        where: { walkthroughId: g.id, status: 'uploaded' },
        _sum: { size: true },
      })
      const bytes = BigInt(uploaded._sum.size ?? 0)
      await prisma.walkthrough.update({
        where: { id: g.id },
        // `renderedAt` starts the raw-take retention clock (server/retention.ts):
        // the raws survive this long for re-edits, then the sweep purges them.
        data: { durationMs: input.durationMs, bytes, renderedAt: new Date() },
      })
      log.info(`[edit] attached render to walkthrough ${g.id} (${input.paths.join(', ')})`)
      // The render brought a transcript.json — refresh the search corpus.
      void indexWalkthrough(g.id)
      // BigInt doesn't survive JSON; the viewer reads a Number like everywhere else.
      return { ok: true, durationMs: input.durationMs, bytes: Number(bytes) }
    }),

  /**
   * Re-run the refine pass on a finalized agent walkthrough — a pro-gated,
   * metered second read (server/refine.ts). Fire-and-forget: it flips
   * `refineStatus` to 'running' and the client polls `get` for the outcome, so
   * this returns as soon as the pass is kicked off. runRefine OWNS its safety
   * (never throws, meters the CALLER), so the gates here are only about giving a
   * fast, specific refusal instead of a silent no-op.
   */
  refine: protectedProcedure
    .input(z.object({ walkthroughId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: {
          teamId: true,
          userId: true,
          kind: true,
          finalizedAt: true,
          refineStatus: true,
        },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
      if (!(await userIsPro(ctx.session.user.id))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Pro feature' })
      }
      if (g.kind !== 'agent') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only an agent walkthrough can be refined',
        })
      }
      if (!g.finalizedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This walkthrough never finished uploading',
        })
      }
      if (g.refineStatus === 'running') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Refine is already running' })
      }
      if (!refineConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Refine isn't configured on this server",
        })
      }
      void runRefine(input.walkthroughId, { byUserId: ctx.session.user.id })
      return { ok: true }
    }),

  /**
   * Talk to the walkthrough assistant (server/agent.ts) — a pro-gated, metered
   * agentic turn that can read the walkthrough and apply edits to it. Blocks on
   * the reply because the turn's applied actions come back with it; each turn
   * spends one polish call on the caller's budget.
   */
  chat: protectedProcedure
    .input(z.object({ walkthroughId: z.string(), message: z.string().trim().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true, kind: true, finalizedAt: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireSpaceAccess(ctx.session.user.id, g)
      if (!(await userIsPro(ctx.session.user.id))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Pro feature' })
      }
      if (g.kind !== 'agent') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only an agent walkthrough has an assistant',
        })
      }
      if (!g.finalizedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This walkthrough never finished uploading',
        })
      }
      if (!agentConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "The assistant isn't configured on this server",
        })
      }
      const { allowed } = await checkAndReservePolish(ctx.session.user.id)
      if (!allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "This month's assistant budget is used up",
        })
      }
      const result = await runWalkthroughChat({
        walkthroughId: input.walkthroughId,
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        message: input.message,
      })
      return result
    }),

  /** The persisted assistant thread, oldest first — what a reload rehydrates. */
  chatHistory: protectedProcedure
    .input(z.object({ walkthroughId: z.string() }))
    .query(async ({ ctx, input }) => {
      const g = await prisma.walkthrough.findUnique({
        where: { id: input.walkthroughId },
        select: { teamId: true, userId: true },
      })
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireViewAccess(ctx.session.user.id, g)
      const rows = await prisma.walkthroughChat.findMany({
        where: { walkthroughId: input.walkthroughId },
        orderBy: { createdAt: 'asc' },
        take: 200,
      })
      return rows.map((r) => {
        const parsed = chatActionsSchema.safeParse(r.actions)
        return {
          id: r.id,
          role: r.role,
          content: r.content,
          actions: parsed.success ? parsed.data : [],
          createdAt: r.createdAt.toISOString(),
        }
      })
    }),

  /**
   * The public read behind /w/<token> — no session, the token is the whole
   * credential (128+ bits, unguessable; the IP rate limit is defense in depth,
   * not the lock). Returns the same presigned-per-file shape the viewer gets,
   * minus anything member-only, so the watch page can reuse the viewer's
   * reading of takes and transcripts. Presigns expire in 1h; the page refetches.
   */
  shared: publicProcedure
    .input(z.object({ token: z.string().min(8).max(80) }))
    .query(async ({ ctx, input }) => {
      if (ctx.ip !== null) {
        const wait = checkLimit('share-view', ctx.ip, { window: 3600, max: 240 })
        if (wait !== null) throw new TRPCError({ code: 'TOO_MANY_REQUESTS' })
      }
      const g = await prisma.walkthrough.findUnique({
        where: { shareToken: input.token },
        include: {
          takes: { orderBy: { index: 'asc' } },
          files: { where: { status: 'uploaded' }, orderBy: { path: 'asc' } },
          comments: { orderBy: { createdAt: 'asc' } },
        },
      })
      if (!g || !g.finalizedAt) throw new TRPCError({ code: 'NOT_FOUND' })
      const space: SpaceOwner = { teamId: g.teamId, userId: g.userId }
      // The edited render, when there is one — a human handback's primary
      // artifact. Signed a second time with a content-disposition so Download
      // saves a named file instead of playing in the tab.
      const finalFile = g.files.find((f) => f.path === 'final.mp4')
      return {
        title: g.title,
        kind: g.kind,
        recordedAt: g.recordedAt.toISOString(),
        durationMs: g.durationMs,
        downloadUrl: finalFile
          ? await presignGet(walkthroughKey(spaceId(space), g.id, finalFile.path), {
              downloadAs: `${g.slug}.mp4`,
            })
          : null,
        takes: g.takes.map((t) => ({
          id: t.id,
          index: t.index,
          dir: t.dir,
          durationMs: t.durationMs,
          videoPath: t.videoPath,
        })),
        files: await Promise.all(
          g.files.map(async (f) => ({
            path: f.path,
            size: f.size,
            contentType: f.contentType,
            url: await presignGet(walkthroughKey(spaceId(space), g.id, f.path)),
          }))
        ),
        // The margin notes, oldest first — the watch page shows them and lets a
        // viewer add their own (sharedAddComment).
        comments: g.comments.map((c) => ({
          authorName: c.authorName,
          atMs: c.atMs,
          text: c.text,
          createdAt: c.createdAt.toISOString(),
        })),
      }
    }),

  /**
   * A watch-page viewer leaves a comment — no session, the share token is the
   * whole credential (same trust model as `shared`). The row is anonymous
   * (`userId: null`) and its author name is suffixed "(viewer)" so members can
   * tell it from a teammate's; a member of the space can delete it
   * (deleteComment). IP-rate-limited as the only brake a public writer has.
   */
  sharedAddComment: publicProcedure
    .input(
      z.object({
        token: z.string().min(8).max(80),
        name: z.string().trim().min(1).max(60),
        text: z.string().trim().min(1).max(2000),
        atMs: z.number().int().min(0).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.ip !== null) {
        const wait = checkLimit('share-comment', ctx.ip, { window: 3600, max: 30 })
        if (wait !== null) throw new TRPCError({ code: 'TOO_MANY_REQUESTS' })
      }
      const g = await prisma.walkthrough.findUnique({
        where: { shareToken: input.token },
        select: { id: true, finalizedAt: true },
      })
      if (!g || !g.finalizedAt) throw new TRPCError({ code: 'NOT_FOUND' })
      await prisma.walkthroughComment.create({
        data: {
          walkthroughId: g.id,
          userId: null,
          authorName: `${input.name} (viewer)`,
          atMs: input.atMs,
          text: input.text,
        },
      })
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
        status: z.enum(WALKTHROUGH_STATUSES).nullish(),
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
        {
          userId: ctx.session.user.id,
          tokenId: 'admin-ui',
          tokenName: 'admin-ui',
          isAdmin: true,
          emailVerified: true,
        },
        g.id,
        { trace: false }
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

  /**
   * Live anchors for /admin/costs: how much real recordings weigh (GB per
   * recorded hour, by kind) and the last 30 days of intake, so the estimator
   * extrapolates from measured usage instead of guesses.
   */
  costStats: protectedProcedure.query(async ({ ctx }) => {
    await requireAdmin(ctx.session.user.id)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [total, byKind, recent, recentUploaders, fileCount] = await Promise.all([
      prisma.walkthrough.aggregate({ _count: true, _sum: { bytes: true, durationMs: true } }),
      prisma.walkthrough.groupBy({
        by: ['kind'],
        _count: true,
        _sum: { bytes: true, durationMs: true },
      }),
      prisma.walkthrough.aggregate({
        where: { uploadedAt: { gte: since } },
        _count: true,
        _sum: { bytes: true, durationMs: true },
      }),
      prisma.walkthrough.findMany({
        where: { uploadedAt: { gte: since }, uploadedById: { not: null } },
        select: { uploadedById: true },
        distinct: ['uploadedById'],
      }),
      prisma.walkthroughFile.count(),
    ])
    const shape = (r: { _count: number; _sum: { bytes: bigint | null; durationMs: number | null } }) => ({
      walkthroughs: r._count,
      bytes: Number(r._sum.bytes ?? 0),
      durationMs: r._sum.durationMs ?? 0,
    })
    return {
      total: shape(total),
      byKind: byKind.map((r) => ({ kind: r.kind, ...shape(r) })),
      last30d: { ...shape(recent), uploaders: recentUploaders.length },
      files: fileCount,
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
      const u = await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      })
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

/**
 * Per-account switches — the two emails: "teammate added a walkthrough" and
 * the weekly digest. Each is flipped off by the one-click unsubscribe link in
 * the mail itself, back on from the /team page.
 */
const prefsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { notifyUploads: true, notifyDigest: true },
    })
    return {
      notifyUploads: user?.notifyUploads ?? true,
      notifyDigest: user?.notifyDigest ?? true,
    }
  }),
  set: protectedProcedure
    .input(z.object({ notifyUploads: z.boolean().optional(), notifyDigest: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.user.update({
        where: { id: ctx.session.user.id },
        data: {
          ...(input.notifyUploads === undefined ? {} : { notifyUploads: input.notifyUploads }),
          ...(input.notifyDigest === undefined ? {} : { notifyDigest: input.notifyDigest }),
        },
      })
      return { ok: true }
    }),
})

/**
 * The account's own usage page (/usage): storage per space, the two cloud
 * budgets, the live-token count, and anything auto-deleting soon. Read-only —
 * it reserves nothing, it reports. Every number already lives in a helper
 * (cloudStatus, the limits constants); this stitches them into one view.
 */
const usageRouter = router({
  mine: protectedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id
    const u = await prisma.user.findUnique({
      where: { id: me },
      select: { email: true, isAdmin: true, features: true },
    })
    if (!u) throw new TRPCError({ code: 'NOT_FOUND' })
    const tier: 'admin' | 'pro' | 'free' = isPlatformAdmin(u)
      ? 'admin'
      : userHasFeature(u, 'pro')
        ? 'pro'
        : 'free'

    // Personal first, then each team by name — the same order the rest of the
    // app lists spaces in (projects.all).
    const teamIds = await memberTeamIds(me)
    const teams = teamIds.length
      ? await prisma.team.findMany({
          where: { id: { in: teamIds } },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : []
    const spaces = await Promise.all(
      [{ teamId: null as string | null, name: 'Personal' }, ...teams.map((t) => ({ teamId: t.id, name: t.name }))].map(
        async (s) => {
          const totals = await prisma.walkthrough.aggregate({
            where: spaceWhere(toSpace(s.teamId, me)),
            _sum: { bytes: true },
            _count: true,
          })
          return {
            teamId: s.teamId,
            name: s.name,
            bytes: Number(totals._sum.bytes ?? 0n),
            walkthroughs: totals._count,
            quotaBytes: SPACE_QUOTA_BYTES,
            maxWalkthroughs: SPACE_MAX_WALKTHROUGHS,
          }
        }
      )
    )

    const cloud = await cloudStatus(me)
    // The ceiling behind `transcribeRemainingSeconds` — null wherever the
    // remaining is null (unmetered: admin or first-walkthrough magic), so the
    // page can render "N of M" only when both halves are real numbers.
    const transcribeLimitSeconds =
      tier === 'admin' || cloud.firstWalkthroughMagic
        ? null
        : tier === 'pro'
          ? PRO_CLOUD_TRANSCRIBE_SECONDS
          : FREE_CLOUD_TRANSCRIBE_SECONDS

    const active = await prisma.apiToken.count({ where: { userId: me, revokedAt: null } })

    const expiring = await prisma.walkthrough.findMany({
      where: {
        ...reachWhere(me, teamIds),
        expiresAt: { not: null, lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { expiresAt: 'asc' },
      take: 20,
      select: { id: true, title: true, expiresAt: true },
    })

    return {
      tier,
      spaces,
      cloud: {
        transcribeRemainingSeconds: cloud.transcribeRemainingSeconds,
        transcribeLimitSeconds,
        polishAllowed: cloud.polishAllowed,
        firstWalkthroughMagic: cloud.firstWalkthroughMagic,
      },
      tokens: { active, max: MAX_ACTIVE_TOKENS },
      // `expiresAt` is non-null by the where filter; flatMap narrows the type
      // honestly instead of asserting it.
      expiring: expiring.flatMap((g) =>
        g.expiresAt ? [{ id: g.id, title: g.title, expiresAt: g.expiresAt.toISOString() }] : []
      ),
    }
  }),
})

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ctx.session.user),
  recorder: recorderRouter,
  prefs: prefsRouter,
  teams: teamsRouter,
  invites: invitesRouter,
  tokens: tokensRouter,
  projects: projectsRouter,
  walkthroughs: walkthroughsRouter,
  usage: usageRouter,
  admin: adminRouter,
})

export type AppRouter = typeof appRouter
