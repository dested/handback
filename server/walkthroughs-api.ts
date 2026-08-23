// The agent-facing view of a walkthrough, in one place.
//
// Two surfaces expose it — the token-authed REST routes in `ingest.ts` (what
// `cli/push.ts` and older stdio MCP installs talk to) and the hosted MCP
// endpoint in `mcp.ts` (what `claude mcp add --transport http` talks to). They
// share this module so an agent sees the same brief either way; a change to the
// shape can't reach one caller and miss the other.
//
// Everything returned here is JSON-safe: Dates are ISO strings, sizes are
// Numbers. Auth is a bearer ApiToken (`hb_…`) and the token is its owner — no
// caller names a space, they see the owner's personal space plus every team the
// owner belongs to.
//
// One exception: a token whose owner is a **platform admin** reads and triages
// across every space (`TokenAuth.isAdmin` → `scopeWhere()` drops the filter).
// Writing walkthroughs *in* — declare, upload, finalize — is never cross-space:
// an upload always lands in a space the token's owner is actually in.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { memberTeamIds, spaceId } from './access'
import { isPlatformAdmin } from './features'
import { log } from './logger'
import { notifyQuestion, notifyResult } from './notify'
import { prisma } from './prisma'
import { expiryFor } from './retention'
import { getObjectText, isSafePath, walkthroughKey, presignGet, presignPut } from './storage'

export const WALKTHROUGH_STATUSES = ['open', 'in_review', 'needs_info', 'resolved'] as const
export type WalkthroughStatus = (typeof WALKTHROUGH_STATUSES)[number]

export type TokenAuth = {
  userId: string
  tokenId: string
  // Denormalized into WalkthroughNote/WalkthroughAccess rows at write time —
  // the thread and the trace must survive the token's revocation.
  tokenName: string
  isAdmin: boolean
  // Carried so ingest's write/cloud gates don't run an extra query per request.
  emailVerified: boolean
}

/** The ownership pair every space-scoped row carries — exactly one side is set. */
type SpaceRef = { teamId: string | null; userId: string | null }

/**
 * The `where` fragment that pins a query to the spaces the token's owner reaches
 * — their own personal walkthroughs plus every team they're a member of, and
 * empty for a platform admin, who sees the whole platform. One place, so a new
 * query can't forget the rule or apply it twice.
 */
const scopeWhere = async (auth: TokenAuth) =>
  auth.isAdmin
    ? {}
    : { OR: [{ userId: auth.userId }, { teamId: { in: await memberTeamIds(auth.userId) } }] }

/** Same rule, for a row already loaded. */
const inScope = async (auth: TokenAuth, w: SpaceRef): Promise<boolean> =>
  auth.isAdmin ||
  w.userId === auth.userId ||
  (w.teamId !== null && (await memberTeamIds(auth.userId)).includes(w.teamId))

/** An agent scans this list, then pulls the one walkthrough it's going to work on. */
const LIST_LIMIT = 100

/**
 * Resolve an `Authorization: Bearer hb_…` header to the user it speaks for, or
 * null for anything unrecognized. Stamps `lastUsedAt` fire-and-forget — the
 * connect page reads it to tell someone their agent actually landed.
 */
export async function authenticateToken(header: string | undefined): Promise<TokenAuth | null> {
  const raw = (header ?? '').startsWith('Bearer ') ? (header ?? '').slice(7).trim() : ''
  if (!raw.startsWith('hb_')) return null
  const tokenHash = createHash('sha256').update(raw).digest('hex')
  const token = await prisma.apiToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { email: true, isAdmin: true, emailVerified: true } } },
  })
  if (!token || token.revokedAt) return null
  prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})
  return {
    userId: token.userId,
    tokenId: token.id,
    tokenName: token.name,
    isAdmin: isPlatformAdmin(token.user),
    emailVerified: token.user.emailVerified,
  }
}

// ── the activity trace ───────────────────────────────────────────────────────

/** A second 'pulled' by the same token inside this window is the same visit. */
const PULL_DEDUP_MS = 10 * 60 * 1000

/**
 * Record what a token did to a walkthrough, fire-and-forget — the trace is a
 * courtesy to the human viewer ("pulled by your agent 12m ago"), never worth a
 * failed or slower agent call. Only token surfaces log; the web viewer's own
 * reads are not agent activity.
 */
function traceAccess(
  auth: TokenAuth,
  walkthroughId: string,
  action: 'pulled' | 'status' | 'result',
  detail?: string
): void {
  void (async () => {
    if (action === 'pulled') {
      const recent = await prisma.walkthroughAccess.findFirst({
        where: {
          walkthroughId,
          tokenName: auth.tokenName,
          action: 'pulled',
          createdAt: { gt: new Date(Date.now() - PULL_DEDUP_MS) },
        },
        select: { id: true },
      })
      if (recent) return
    }
    await prisma.walkthroughAccess.create({
      data: { walkthroughId, tokenName: auth.tokenName, action, detail: detail ?? null },
    })
  })().catch(() => {})
}

export type WalkthroughListItem = {
  id: string
  slug: string
  title: string
  origin: string | null
  status: string
  // 'bug' | 'feature' | 'idea' | null — lets an agent triaging the queue see
  // what each walkthrough is FOR before it pulls the full brief.
  intent: string | null
  recordedAt: string
  durationMs: number
  frameCount: number
  errorCount: number
  droppedCount: number
  takeCount: number
  projectName: string | null
  // Always present — the only way a list spanning personal + several teams is
  // readable, and the name of the one space it came from for everyone else.
  space: string
}

/** How a row's owning space reads to an agent: a team's name, or 'Personal'. */
const spaceName = (
  auth: TokenAuth,
  w: SpaceRef & { team: { name: string } | null; user: { name: string } | null }
): string => {
  if (w.team) return w.team.name
  if (w.userId === auth.userId) return 'Personal'
  // Platform admin reading across spaces: whose personal space this is matters.
  return `${w.user?.name ?? 'Someone'} (personal)`
}

/**
 * Finalized walkthroughs the token reaches, newest first. `space` narrows it:
 * undefined = everything in scope, `{ teamId: null }` = the owner's personal
 * space, `{ teamId: X }` = that team (the caller has already checked membership).
 */
export async function listWalkthroughs(
  auth: TokenAuth,
  status?: WalkthroughStatus,
  space?: { teamId: string | null }
): Promise<WalkthroughListItem[]> {
  const spaceFilter =
    space === undefined
      ? await scopeWhere(auth)
      : space.teamId === null
        ? { userId: auth.userId, teamId: null }
        : { teamId: space.teamId }
  const rows = await prisma.walkthrough.findMany({
    where: {
      ...spaceFilter,
      finalizedAt: { not: null },
      // A human handback is a video for a person, not work for an agent — it
      // never shows up in an agent's queue. `get` by id still answers, so a
      // human can still point an agent at one deliberately.
      kind: 'agent',
      ...(status ? { status } : {}),
    },
    orderBy: { recordedAt: 'desc' },
    take: LIST_LIMIT,
    include: {
      team: { select: { name: true } },
      user: { select: { name: true } },
      project: { select: { name: true } },
      _count: { select: { takes: true } },
    },
  })
  return rows.map((g) => ({
    id: g.id,
    slug: g.slug,
    space: spaceName(auth, g),
    title: g.title,
    origin: g.origin,
    status: g.status,
    intent: g.intent,
    recordedAt: g.recordedAt.toISOString(),
    durationMs: g.durationMs,
    frameCount: g.frameCount,
    errorCount: g.errorCount,
    droppedCount: g.droppedCount,
    takeCount: g._count.takes,
    projectName: g.project?.name ?? null,
  }))
}

export type WalkthroughFileRef = { path: string; size: number; contentType: string; url: string }

/** One entry of the review thread, as an agent (or the brief formatter) sees it. */
export type WalkthroughNoteRef = {
  role: string
  // 'result' | 'question' | 'answer' — with `role`, tells an agent result from
  // a reviewer send-back from an agent question from the reviewer's reply.
  kind: string
  summary: string
  prUrl: string | null
  filesTouched: string[]
  // Walkthrough-relative paths of proof screenshots on this entry; the presigned
  // urls for them live in the `files` list (they're WalkthroughFile rows).
  evidencePaths: string[]
  bodyMd: string | null
  authorName: string
  createdAt: string
}

/** A reviewer's margin note; `atMs` pins it to the recording's output clock. */
export type WalkthroughCommentRef = {
  authorName: string
  atMs: number | null
  text: string
  createdAt: string
}

export type WalkthroughDetail = {
  id: string
  slug: string
  space: string
  title: string
  origin: string | null
  status: string
  recordedAt: string
  durationMs: number
  frameCount: number
  errorCount: number
  droppedCount: number
  takes: Array<{
    index: number
    dir: string
    interrupted: boolean
    durationMs: number
    frameCount: number
    videoPath: string | null
  }>
  // What the recording is FOR — drives the brief's intent framing.
  intent: string | null
  // The Refine pass's outputs, when it ran (server/refine.ts). `summaryMd` is the
  // complete ledger of everything raised; `curation` is the reviewer-curated
  // keyframe set plus the spans cut from the walkthrough.
  summaryMd: string | null
  // Standing project context, prepended to every brief in this project.
  projectInstructions: string | null
  curation: {
    frames: Array<{ path: string; caption: string; atMs: number | null }>
    excluded: Array<{ startMs: number; endMs: number; reason: string }>
  } | null
  reportMd: string | null
  files: WalkthroughFileRef[]
  // The review thread, oldest first: agent results and reviewer send-backs.
  notes: WalkthroughNoteRef[]
  // Margin notes from humans, oldest first — part of the brief.
  comments: WalkthroughCommentRef[]
}

/** Parses `Walkthrough.curationJson` — never throws; a malformed blob (or the
 *  null of an un-refined walkthrough) degrades to no curation. */
const curationSchema = z.object({
  frames: z
    .array(z.object({ path: z.string(), caption: z.string(), atMs: z.number().nullable() }))
    .default([]),
  excluded: z
    .array(z.object({ startMs: z.number(), endMs: z.number(), reason: z.string() }))
    .default([]),
})

/**
 * One walkthrough, everything an agent needs in a single round trip: metadata, the
 * report.md the recorder wrote for it, and a presigned GET per uploaded file.
 * Null when the id is unknown, sits in a space the token doesn't reach (unless
 * the token is an admin's), or was never finalized — callers turn all three into
 * the same 404, on purpose.
 */
export async function getWalkthroughDetail(
  auth: TokenAuth,
  walkthroughId: string,
  // /admin's debug page renders the brief through this same function under a
  // synthetic auth — a human looking at a debug view is not agent activity.
  opts: { trace?: boolean } = {}
): Promise<WalkthroughDetail | null> {
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    include: {
      team: { select: { name: true } },
      user: { select: { name: true } },
      project: { select: { instructions: true } },
      takes: { orderBy: { index: 'asc' } },
      files: { where: { status: 'uploaded' }, orderBy: { path: 'asc' } },
      notes: { orderBy: { createdAt: 'asc' } },
      comments: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!walkthrough || !(await inScope(auth, walkthrough)) || !walkthrough.finalizedAt) return null
  if (opts.trace !== false) traceAccess(auth, walkthrough.id, 'pulled')

  const space = spaceId({ teamId: walkthrough.teamId, userId: walkthrough.userId })

  // report.md is the whole point of the pull, but a walkthrough is still usable
  // without it (bad upload, hand-declared walkthrough) — degrade to null. A
  // split-out task carries no files at all: its brief IS the report, and it
  // points the agent at the parent for the recording itself. Refine's rewrite
  // (`refinedBriefMd`) is preferred over the raw report when it ran.
  const reportMd =
    walkthrough.briefMd ??
    walkthrough.refinedBriefMd ??
    (await getObjectText(walkthroughKey(space, walkthrough.id, 'report.md')).catch(
      (err: unknown) => {
        log.warn(
          `[walkthroughs] report.md unreadable for walkthrough ${walkthrough.id}: ${String(err)}`
        )
        return null
      }
    ))

  const curationParsed = curationSchema.safeParse(walkthrough.curationJson)
  const curation = curationParsed.success ? curationParsed.data : null

  return {
    id: walkthrough.id,
    slug: walkthrough.slug,
    space: spaceName(auth, walkthrough),
    title: walkthrough.title,
    origin: walkthrough.origin,
    status: walkthrough.status,
    recordedAt: walkthrough.recordedAt.toISOString(),
    durationMs: walkthrough.durationMs,
    frameCount: walkthrough.frameCount,
    errorCount: walkthrough.errorCount,
    droppedCount: walkthrough.droppedCount,
    takes: walkthrough.takes.map((t) => ({
      index: t.index,
      dir: t.dir,
      interrupted: t.interrupted,
      durationMs: t.durationMs,
      frameCount: t.frameCount,
      videoPath: t.videoPath,
    })),
    intent: walkthrough.intent,
    summaryMd: walkthrough.summaryMd,
    projectInstructions: walkthrough.project?.instructions ?? null,
    curation,
    reportMd,
    files: await Promise.all(
      walkthrough.files.map(async (f) => ({
        path: f.path,
        size: f.size,
        contentType: f.contentType,
        url: await presignGet(walkthroughKey(space, walkthrough.id, f.path)),
      }))
    ),
    notes: walkthrough.notes.map((n) => ({
      role: n.role,
      kind: n.kind,
      summary: n.summary,
      prUrl: n.prUrl,
      filesTouched: n.filesTouched,
      evidencePaths: n.evidencePaths,
      bodyMd: n.bodyMd,
      authorName: n.authorName,
      createdAt: n.createdAt.toISOString(),
    })),
    comments: walkthrough.comments.map((c) => ({
      authorName: c.authorName,
      atMs: c.atMs,
      text: c.text,
      createdAt: c.createdAt.toISOString(),
    })),
  }
}

/**
 * How an agent reports progress: in_review when a fix is up, resolved only
 * after a human signs off. Returns the slug it moved, or null if the walkthrough
 * sits in a space this token doesn't reach.
 */
export async function setWalkthroughStatus(
  auth: TokenAuth,
  walkthroughId: string,
  status: WalkthroughStatus
): Promise<{ slug: string } | null> {
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    select: { id: true, slug: true, teamId: true, userId: true },
  })
  if (!walkthrough || !(await inScope(auth, walkthrough))) return null
  await prisma.walkthrough.update({
    where: { id: walkthrough.id },
    // resolved schedules auto-deletion; flipping back off resolved clears it.
    // Identical to the tRPC setStatus path so an MCP write and a UI write behave
    // the same.
    data: {
      status,
      resolvedAt: status === 'resolved' ? new Date() : null,
      expiresAt: expiryFor(status),
    },
  })
  log.info(`[walkthroughs] ${walkthrough.slug} (${walkthrough.id}) → ${status}`)
  traceAccess(auth, walkthrough.id, 'status', status)
  return { slug: walkthrough.slug }
}

export type PostResultInput = {
  summary: string
  prUrl?: string
  filesTouched?: string[]
  body?: string
  // Walkthrough-relative paths returned by requestEvidenceUploads and since
  // PUT — the proof screenshots to hang off this result.
  evidence?: string[]
}

/**
 * The return path: an agent posts what it did — a summary, optionally the PR
 * link, the files it touched, and a markdown body — and the walkthrough carries
 * the answer for a human to sign off on. Posting a result on an `open`
 * walkthrough flips it to `in_review` (a posted result IS the fix going up);
 * any other status is left alone. Returns the slug, or null out of scope.
 */
export async function postWalkthroughResult(
  auth: TokenAuth,
  walkthroughId: string,
  input: PostResultInput
): Promise<{ slug: string } | null> {
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    select: { id: true, slug: true, status: true, teamId: true, userId: true },
  })
  if (!walkthrough || !(await inScope(auth, walkthrough))) return null

  // Evidence: only paths under evidence/ can be flipped live — anything else is
  // silently dropped rather than failing the (more important) result post. The
  // uploaded rows move pending → uploaded and their bytes join the walkthrough's
  // total, mirroring finalize's accounting.
  const evidencePaths = (input.evidence ?? []).filter((p) => p.startsWith('evidence/'))
  if (evidencePaths.length > 0) {
    const flipped = await prisma.walkthroughFile.findMany({
      where: { walkthroughId: walkthrough.id, path: { in: evidencePaths }, status: 'pending' },
      select: { size: true },
    })
    if (flipped.length > 0) {
      const addedBytes = BigInt(flipped.reduce((sum, f) => sum + f.size, 0))
      await prisma.walkthroughFile.updateMany({
        where: { walkthroughId: walkthrough.id, path: { in: evidencePaths }, status: 'pending' },
        data: { status: 'uploaded' },
      })
      await prisma.walkthrough.update({
        where: { id: walkthrough.id },
        data: { bytes: { increment: addedBytes } },
      })
    }
  }

  await prisma.walkthroughNote.create({
    data: {
      walkthroughId: walkthrough.id,
      role: 'agent',
      kind: 'result',
      summary: input.summary,
      prUrl: input.prUrl ?? null,
      filesTouched: input.filesTouched ?? [],
      evidencePaths,
      bodyMd: input.body ?? null,
      authorName: auth.tokenName,
    },
  })
  if (walkthrough.status === 'open') {
    // Same shape as setWalkthroughStatus — expiryFor must see every status
    // write (retention rule), and in_review clears any scheduled expiry.
    await prisma.walkthrough.update({
      where: { id: walkthrough.id },
      data: { status: 'in_review', resolvedAt: null, expiresAt: expiryFor('in_review') },
    })
  }
  log.info(`[walkthroughs] ${walkthrough.slug} (${walkthrough.id}) ← result from ${auth.tokenName}`)
  traceAccess(auth, walkthrough.id, 'result')
  void notifyResult(walkthrough.id, input.summary).catch(() => {})
  return { slug: walkthrough.slug }
}

/**
 * An agent stuck on an ambiguous walkthrough asks a human instead of guessing.
 * Posts a `kind:'question'` note, moves the walkthrough to needs_info (unless it
 * is already resolved — a resolved walkthrough stays resolved), and mails the
 * uploader. The answer comes back as a reviewer note the agent reads on its next
 * pull. Returns the slug, or null out of scope.
 */
export async function askReviewerQuestion(
  auth: TokenAuth,
  walkthroughId: string,
  question: string
): Promise<{ slug: string } | null> {
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    select: { id: true, slug: true, status: true, teamId: true, userId: true },
  })
  if (!walkthrough || !(await inScope(auth, walkthrough))) return null
  await prisma.walkthroughNote.create({
    data: {
      walkthroughId: walkthrough.id,
      role: 'agent',
      kind: 'question',
      summary: question,
      filesTouched: [],
      authorName: auth.tokenName,
    },
  })
  if (walkthrough.status !== 'resolved') {
    // needs_info schedules no expiry (expiryFor returns null for it) — a
    // walkthrough waiting on a human must not age out from under them.
    await prisma.walkthrough.update({
      where: { id: walkthrough.id },
      data: { status: 'needs_info', resolvedAt: null, expiresAt: expiryFor('needs_info') },
    })
    traceAccess(auth, walkthrough.id, 'status', 'needs_info')
  }
  log.info(
    `[walkthroughs] ${walkthrough.slug} (${walkthrough.id}) ← question from ${auth.tokenName}`
  )
  void notifyQuestion(walkthrough.id).catch(() => {})
  return { slug: walkthrough.slug }
}

/**
 * Hand an agent presigned PUT urls for a few proof screenshots to attach to its
 * result. The caller (MCP / REST) has already bounded count, size and content
 * type; this re-guards cheaply and returns null on any violation rather than
 * signing something the ingest rules wouldn't accept. Each file is upserted as a
 * pending WalkthroughFile; post_result flips it to uploaded. Null when the
 * walkthrough is out of scope or never finalized.
 */
export async function requestEvidenceUploads(
  auth: TokenAuth,
  walkthroughId: string,
  files: Array<{ name: string; size: number; contentType: string }>
): Promise<{ uploads: Array<{ path: string; url: string; contentType: string }> } | null> {
  if (files.length === 0 || files.length > 4) return null
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    select: { id: true, teamId: true, userId: true, finalizedAt: true },
  })
  if (!walkthrough || !(await inScope(auth, walkthrough)) || !walkthrough.finalizedAt) return null

  const space = spaceId({ teamId: walkthrough.teamId, userId: walkthrough.userId })
  const uploads: Array<{ path: string; url: string; contentType: string }> = []
  for (const f of files) {
    if (f.size < 1 || f.size > 5 * 1024 * 1024) return null
    if (!/^image\/(png|jpeg|webp)$/.test(f.contentType)) return null
    if (!/^[a-z0-9._-]{1,80}$/i.test(f.name)) return null
    const path = `evidence/${Date.now()}-${f.name.toLowerCase()}`
    if (!isSafePath(path)) return null
    await prisma.walkthroughFile.upsert({
      where: { walkthroughId_path: { walkthroughId: walkthrough.id, path } },
      create: {
        walkthroughId: walkthrough.id,
        path,
        size: f.size,
        contentType: f.contentType,
        status: 'pending',
      },
      update: { size: f.size, contentType: f.contentType, status: 'pending' },
    })
    uploads.push({
      path,
      url: await presignPut(walkthroughKey(space, walkthrough.id, path), f.contentType, f.size),
      contentType: f.contentType,
    })
  }
  return { uploads }
}
