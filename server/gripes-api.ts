// The agent-facing view of a gripe, in one place.
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

import { createHash } from 'node:crypto'
import { log } from './logger'
import { prisma } from './prisma'
import { getObjectText, gripeKey, presignGet } from './storage'

export const GRIPE_STATUSES = ['open', 'in_review', 'resolved'] as const
export type GripeStatus = (typeof GRIPE_STATUSES)[number]

export type TokenAuth = { orgId: string; userId: string; tokenId: string }

/** An agent scans this list, then pulls the one gripe it's going to work on. */
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
  const token = await prisma.apiToken.findUnique({ where: { tokenHash } })
  if (!token || token.revokedAt) return null
  prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})
  return { orgId: token.orgId, userId: token.userId, tokenId: token.id }
}

export type GripeListItem = {
  id: string
  slug: string
  title: string
  origin: string | null
  status: string
  recordedAt: string
  durationMs: number
  frameCount: number
  eventCount: number
  takeCount: number
  projectName: string | null
}

export async function listGripes(orgId: string, status?: GripeStatus): Promise<GripeListItem[]> {
  const rows = await prisma.gripe.findMany({
    where: {
      orgId,
      finalizedAt: { not: null },
      ...(status ? { status } : {}),
    },
    orderBy: { recordedAt: 'desc' },
    take: LIST_LIMIT,
    include: {
      project: { select: { name: true } },
      _count: { select: { takes: true } },
    },
  })
  return rows.map((g) => ({
    id: g.id,
    slug: g.slug,
    title: g.title,
    origin: g.origin,
    status: g.status,
    recordedAt: g.recordedAt.toISOString(),
    durationMs: g.durationMs,
    frameCount: g.frameCount,
    eventCount: g.eventCount,
    takeCount: g._count.takes,
    projectName: g.project?.name ?? null,
  }))
}

export type GripeFileRef = { path: string; size: number; contentType: string; url: string }

export type GripeDetail = {
  id: string
  slug: string
  title: string
  origin: string | null
  status: string
  recordedAt: string
  durationMs: number
  frameCount: number
  eventCount: number
  takes: Array<{
    index: number
    dir: string
    interrupted: boolean
    durationMs: number
    frameCount: number
    videoPath: string | null
  }>
  reportMd: string | null
  files: GripeFileRef[]
}

/**
 * One gripe, everything an agent needs in a single round trip: metadata, the
 * report.md the recorder wrote for it, and a presigned GET per uploaded file.
 * Null when the id is unknown, belongs to another org, or was never finalized —
 * callers turn all three into the same 404, on purpose.
 */
export async function getGripeDetail(orgId: string, gripeId: string): Promise<GripeDetail | null> {
  const gripe = await prisma.gripe.findUnique({
    where: { id: gripeId },
    include: {
      takes: { orderBy: { index: 'asc' } },
      files: { where: { status: 'uploaded' }, orderBy: { path: 'asc' } },
    },
  })
  if (!gripe || gripe.orgId !== orgId || !gripe.finalizedAt) return null

  // report.md is the whole point of the pull, but a gripe is still usable
  // without it (bad upload, hand-declared gripe) — degrade to null.
  const reportMd = await getObjectText(gripeKey(gripe.orgId, gripe.id, 'report.md')).catch(
    (err: unknown) => {
      log.warn(`[gripes] report.md unreadable for gripe ${gripe.id}: ${String(err)}`)
      return null
    }
  )

  return {
    id: gripe.id,
    slug: gripe.slug,
    title: gripe.title,
    origin: gripe.origin,
    status: gripe.status,
    recordedAt: gripe.recordedAt.toISOString(),
    durationMs: gripe.durationMs,
    frameCount: gripe.frameCount,
    eventCount: gripe.eventCount,
    takes: gripe.takes.map((t) => ({
      index: t.index,
      dir: t.dir,
      interrupted: t.interrupted,
      durationMs: t.durationMs,
      frameCount: t.frameCount,
      videoPath: t.videoPath,
    })),
    reportMd,
    files: await Promise.all(
      gripe.files.map(async (f) => ({
        path: f.path,
        size: f.size,
        contentType: f.contentType,
        url: await presignGet(gripeKey(gripe.orgId, gripe.id, f.path)),
      }))
    ),
  }
}

/**
 * How an agent reports progress: in_review when a fix is up, resolved only
 * after a human signs off. Returns the slug it moved, or null if the gripe
 * isn't this org's.
 */
export async function setGripeStatus(
  orgId: string,
  gripeId: string,
  status: GripeStatus
): Promise<{ slug: string } | null> {
  const gripe = await prisma.gripe.findUnique({
    where: { id: gripeId },
    select: { id: true, slug: true, orgId: true },
  })
  if (!gripe || gripe.orgId !== orgId) return null
  await prisma.gripe.update({
    where: { id: gripe.id },
    data: { status, resolvedAt: status === 'resolved' ? new Date() : null },
  })
  log.info(`[gripes] ${gripe.slug} (${gripe.id}) → ${status}`)
  return { slug: gripe.slug }
}
