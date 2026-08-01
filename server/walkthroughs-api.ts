// The agent-facing view of a walkthrough, in one place.
//
// Two surfaces expose it — the token-authed REST routes in `ingest.ts` (what
// `cli/push.ts` and older stdio MCP installs talk to) and the hosted MCP
// endpoint in `mcp.ts` (what `claude mcp add --transport http` talks to). They
// share this module so an agent sees the same brief either way; a change to the
// shape can't reach one caller and miss the other.
//
// Everything returned here is JSON-safe: Dates are ISO strings, sizes are
// Numbers. Auth is a bearer ApiToken (`hb_…`) and the token pins the org — no
// caller may name an org, they only ever see the one their token belongs to.
//
// One exception: a token whose owner is a **platform admin** reads and triages
// across every workspace (`TokenAuth.isAdmin` → `orgScope()` drops the filter).
// Writing walkthroughs *in* — declare, upload, finalize — is never cross-org: an
// upload always lands in the token's own workspace.

import { createHash } from 'node:crypto'
import { isPlatformAdmin } from './features'
import { log } from './logger'
import { prisma } from './prisma'
import { getObjectText, walkthroughKey, presignGet } from './storage'

export const WALKTHROUGH_STATUSES = ['open', 'in_review', 'resolved'] as const
export type WalkthroughStatus = (typeof WALKTHROUGH_STATUSES)[number]

export type TokenAuth = { orgId: string; userId: string; tokenId: string; isAdmin: boolean }

/**
 * The `where` fragment that pins a query to the token's workspace — empty for a
 * platform admin, who sees the whole platform. One place, so a new query can't
 * forget the rule or apply it twice.
 */
const orgScope = (auth: TokenAuth) => (auth.isAdmin ? {} : { orgId: auth.orgId })

/** Same rule, for a row already loaded. */
const inScope = (auth: TokenAuth, orgId: string) => auth.isAdmin || orgId === auth.orgId

/** An agent scans this list, then pulls the one walkthrough it's going to work on. */
const LIST_LIMIT = 100

/**
 * Resolve an `Authorization: Bearer hb_…` header to the org it speaks for, or
 * null for anything unrecognized. Stamps `lastUsedAt` fire-and-forget — the
 * connect page reads it to tell someone their agent actually landed.
 */
export async function authenticateToken(header: string | undefined): Promise<TokenAuth | null> {
  const raw = (header ?? '').startsWith('Bearer ') ? (header ?? '').slice(7).trim() : ''
  if (!raw.startsWith('hb_')) return null
  const tokenHash = createHash('sha256').update(raw).digest('hex')
  const token = await prisma.apiToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { email: true, isAdmin: true } } },
  })
  if (!token || token.revokedAt) return null
  prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})
  return {
    orgId: token.orgId,
    userId: token.userId,
    tokenId: token.id,
    isAdmin: isPlatformAdmin(token.user),
  }
}

export type WalkthroughListItem = {
  id: string
  slug: string
  title: string
  origin: string | null
  status: string
  recordedAt: string
  durationMs: number
  frameCount: number
  errorCount: number
  droppedCount: number
  takeCount: number
  projectName: string | null
  // Always present — the only way an admin's cross-workspace list is readable,
  // and its own workspace's name for everyone else.
  workspace: string
}

export async function listWalkthroughs(
  auth: TokenAuth,
  status?: WalkthroughStatus
): Promise<WalkthroughListItem[]> {
  const rows = await prisma.walkthrough.findMany({
    where: {
      ...orgScope(auth),
      finalizedAt: { not: null },
      ...(status ? { status } : {}),
    },
    orderBy: { recordedAt: 'desc' },
    take: LIST_LIMIT,
    include: {
      org: { select: { name: true } },
      project: { select: { name: true } },
      _count: { select: { takes: true } },
    },
  })
  return rows.map((g) => ({
    id: g.id,
    slug: g.slug,
    workspace: g.org.name,
    title: g.title,
    origin: g.origin,
    status: g.status,
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

export type WalkthroughDetail = {
  id: string
  slug: string
  workspace: string
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
  reportMd: string | null
  files: WalkthroughFileRef[]
}

/**
 * One walkthrough, everything an agent needs in a single round trip: metadata, the
 * report.md the recorder wrote for it, and a presigned GET per uploaded file.
 * Null when the id is unknown, belongs to another org (unless the token is an
 * admin's), or was never finalized — callers turn all three into the same 404,
 * on purpose.
 */
export async function getWalkthroughDetail(
  auth: TokenAuth,
  walkthroughId: string
): Promise<WalkthroughDetail | null> {
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    include: {
      org: { select: { name: true } },
      takes: { orderBy: { index: 'asc' } },
      files: { where: { status: 'uploaded' }, orderBy: { path: 'asc' } },
    },
  })
  if (!walkthrough || !inScope(auth, walkthrough.orgId) || !walkthrough.finalizedAt) return null

  // report.md is the whole point of the pull, but a walkthrough is still usable
  // without it (bad upload, hand-declared walkthrough) — degrade to null.
  const reportMd = await getObjectText(
    walkthroughKey(walkthrough.orgId, walkthrough.id, 'report.md')
  ).catch((err: unknown) => {
    log.warn(
      `[walkthroughs] report.md unreadable for walkthrough ${walkthrough.id}: ${String(err)}`
    )
    return null
  })

  return {
    id: walkthrough.id,
    slug: walkthrough.slug,
    workspace: walkthrough.org.name,
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
    reportMd,
    files: await Promise.all(
      walkthrough.files.map(async (f) => ({
        path: f.path,
        size: f.size,
        contentType: f.contentType,
        url: await presignGet(walkthroughKey(walkthrough.orgId, walkthrough.id, f.path)),
      }))
    ),
  }
}

/**
 * How an agent reports progress: in_review when a fix is up, resolved only
 * after a human signs off. Returns the slug it moved, or null if the walkthrough
 * isn't this org's.
 */
export async function setWalkthroughStatus(
  auth: TokenAuth,
  walkthroughId: string,
  status: WalkthroughStatus
): Promise<{ slug: string } | null> {
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    select: { id: true, slug: true, orgId: true },
  })
  if (!walkthrough || !inScope(auth, walkthrough.orgId)) return null
  await prisma.walkthrough.update({
    where: { id: walkthrough.id },
    data: { status, resolvedAt: status === 'resolved' ? new Date() : null },
  })
  log.info(`[walkthroughs] ${walkthrough.slug} (${walkthrough.id}) → ${status}`)
  return { slug: walkthrough.slug }
}
