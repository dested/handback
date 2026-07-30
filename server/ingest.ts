// Token-authed REST ingest for the CLI / extension / MCP. Two-phase write:
//
//   POST /api/ingest/gripes            declare a gripe (metadata + file list)
//                                      → gripe row + pending files + presigned PUTs
//   POST /api/ingest/gripes/:id/finalize   confirm the uploads landed
//                                      → files flip to uploaded, gripe becomes visible
//
// Re-declaring the same (org, slug) replaces the previous upload wholesale:
// old rows cascade away and the old S3 prefix is deleted. Auth is a bearer
// ApiToken (`ilp_...`); the token pins the org.
//
// The read side is what an agent pulls through `cli/mcp.ts`:
//
//   GET  /api/ingest/gripes            the org's finalized gripes, newest first
//   GET  /api/ingest/gripes/:id        one gripe's full brief (report.md + presigned files)
//   POST /api/ingest/gripes/:id/status open | in_review | resolved

import { createHash } from 'node:crypto'
import { Router, json, raw, type Request, type Response } from 'express'
import { z } from 'zod'
import { log } from './logger'
import { prisma } from './prisma'
import {
  TranscribeFailed,
  TranscribeUnavailable,
  transcribeChunk,
  transcriptionConfigured,
} from './transcribe'
import {
  deletePrefix,
  getObjectText,
  gripeKey,
  gripePrefix,
  isSafePath,
  presignGet,
  presignPut,
} from './storage'

const MAX_FILES = 4000
const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024 // one webm can be big; presigned PUT caps at 5GB

const takeSchema = z.object({
  index: z.number().int().min(1).max(999),
  dir: z.string().regex(/^rec-\d{2,3}$/),
  interrupted: z.boolean().default(false),
  startedAt: z.string().datetime().optional(),
  durationMs: z.number().int().min(0),
  frameCount: z.number().int().min(0),
  transcriber: z.string().max(40).optional(),
  videoPath: z.string().max(512).optional(),
})

const declareSchema = z.object({
  slug: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  origin: z.string().trim().max(300).optional(),
  recordedAt: z.string().datetime(),
  durationMs: z.number().int().min(0),
  frameCount: z.number().int().min(0),
  eventCount: z.number().int().min(0).default(0),
  takes: z.array(takeSchema).min(1).max(200),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(512),
        size: z.number().int().min(0).max(MAX_FILE_BYTES),
        contentType: z.string().min(1).max(120),
      })
    )
    .min(1)
    .max(MAX_FILES),
})

const statusSchema = z.enum(['open', 'in_review', 'resolved'])

const setStatusSchema = z.object({ status: statusSchema })

const LIST_LIMIT = 100

type TokenAuth = { orgId: string; userId: string; tokenId: string }

async function authenticate(req: Request): Promise<TokenAuth | null> {
  const header = req.header('authorization') ?? ''
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!raw.startsWith('ilp_')) return null
  const tokenHash = createHash('sha256').update(raw).digest('hex')
  const token = await prisma.apiToken.findUnique({ where: { tokenHash } })
  if (!token || token.revokedAt) return null
  // Fire-and-forget freshness stamp; ingest shouldn't wait on it.
  prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})
  return { orgId: token.orgId, userId: token.userId, tokenId: token.id }
}

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ error })
}

// The auth middleware stashes the token's identity on the request; express's
// generics don't compose with route params, so retrieval goes through unknown.
function getAuth(req: Request): TokenAuth {
  return (req as unknown as { ingestAuth: TokenAuth }).ingestAuth
}

export const ingestRouter = Router()

ingestRouter.use(json({ limit: '10mb' }))

ingestRouter.use(async (req, res, next) => {
  const auth = await authenticate(req)
  if (!auth) {
    fail(res, 401, 'Missing or invalid API token')
    return
  }
  ;(req as Request & { ingestAuth: TokenAuth }).ingestAuth = auth
  next()
})

ingestRouter.post('/gripes', async (req, res) => {
  const auth = getAuth(req)
  const parsed = declareSchema.safeParse(req.body)
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return
  }
  const body = parsed.data

  const badPath = body.files.find((f) => !isSafePath(f.path))
  if (badPath) {
    fail(res, 400, `Unsafe file path: ${badPath.path}`)
    return
  }

  // Same folder pushed again → the new upload replaces the old one entirely.
  const existing = await prisma.gripe.findUnique({
    where: { orgId_slug: { orgId: auth.orgId, slug: body.slug } },
    select: { id: true },
  })
  if (existing) {
    await deletePrefix(gripePrefix(auth.orgId, existing.id))
    await prisma.gripe.delete({ where: { id: existing.id } })
  }

  // Route to a project when the recorded origin matches a hint.
  let projectId: string | null = null
  if (body.origin) {
    const projects = await prisma.project.findMany({
      where: { orgId: auth.orgId },
      select: { id: true, originHints: true },
    })
    projectId = projects.find((p) => p.originHints.includes(body.origin!))?.id ?? null
  }

  const gripe = await prisma.gripe.create({
    data: {
      orgId: auth.orgId,
      projectId,
      slug: body.slug,
      title: body.title,
      origin: body.origin ?? null,
      recordedAt: new Date(body.recordedAt),
      uploadedById: auth.userId,
      durationMs: body.durationMs,
      frameCount: body.frameCount,
      eventCount: body.eventCount,
      bytes: BigInt(body.files.reduce((sum, f) => sum + f.size, 0)),
      takes: {
        create: body.takes.map((t) => ({
          index: t.index,
          dir: t.dir,
          interrupted: t.interrupted,
          startedAt: t.startedAt ? new Date(t.startedAt) : null,
          durationMs: t.durationMs,
          frameCount: t.frameCount,
          transcriber: t.transcriber ?? null,
          videoPath: t.videoPath ?? null,
        })),
      },
      files: {
        create: body.files.map((f) => ({
          path: f.path,
          size: f.size,
          contentType: f.contentType,
        })),
      },
    },
  })

  const uploads = await Promise.all(
    body.files.map(async (f) => ({
      path: f.path,
      url: await presignPut(gripeKey(auth.orgId, gripe.id, f.path), f.contentType),
      contentType: f.contentType,
    }))
  )

  log.info(
    `[ingest] declared gripe ${body.slug} (${body.files.length} files) for org ${auth.orgId}`
  )
  res.json({ gripeId: gripe.id, uploads })
})

ingestRouter.post('/gripes/:id/finalize', async (req, res) => {
  const auth = getAuth(req)
  const gripe = await prisma.gripe.findUnique({ where: { id: req.params.id } })
  if (!gripe || gripe.orgId !== auth.orgId) {
    fail(res, 404, 'Unknown gripe')
    return
  }
  await prisma.gripeFile.updateMany({
    where: { gripeId: gripe.id },
    data: { status: 'uploaded' },
  })
  await prisma.gripe.update({
    where: { id: gripe.id },
    data: { finalizedAt: new Date() },
  })
  log.info(`[ingest] finalized gripe ${gripe.slug} (${gripe.id})`)
  res.json({ ok: true, gripeId: gripe.id })
})

// The org's finalized gripes, newest recording first. Deliberately thin — an
// agent scans this list, then pulls the one gripe it's going to work on.
ingestRouter.get('/gripes', async (req, res) => {
  const auth = getAuth(req)
  const status = req.query.status
  if (status !== undefined && !statusSchema.safeParse(status).success) {
    fail(res, 400, `status must be one of ${statusSchema.options.join(', ')}`)
    return
  }
  const rows = await prisma.gripe.findMany({
    where: {
      orgId: auth.orgId,
      finalizedAt: { not: null },
      ...(typeof status === 'string' ? { status } : {}),
    },
    orderBy: { recordedAt: 'desc' },
    take: LIST_LIMIT,
    include: {
      project: { select: { name: true } },
      _count: { select: { takes: true } },
    },
  })
  res.json(
    rows.map((g) => ({
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
  )
})

// One gripe, everything an agent needs in a single round trip: metadata, the
// report.md the recorder wrote for it, and a presigned GET per uploaded file.
ingestRouter.get('/gripes/:id', async (req, res) => {
  const auth = getAuth(req)
  const gripe = await prisma.gripe.findUnique({
    where: { id: req.params.id },
    include: {
      takes: { orderBy: { index: 'asc' } },
      files: { where: { status: 'uploaded' }, orderBy: { path: 'asc' } },
    },
  })
  if (!gripe || gripe.orgId !== auth.orgId || !gripe.finalizedAt) {
    fail(res, 404, 'Unknown gripe')
    return
  }

  // report.md is the whole point of the pull, but a gripe is still usable
  // without it (bad upload, hand-declared gripe) — degrade to null.
  const reportMd = await getObjectText(gripeKey(gripe.orgId, gripe.id, 'report.md')).catch(
    (err: unknown) => {
      log.warn(`[ingest] report.md unreadable for gripe ${gripe.id}: ${String(err)}`)
      return null
    }
  )

  res.json({
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
  })
})

// How an agent reports progress: in_review when a fix is up, resolved only
// after a human signs off.
ingestRouter.post('/gripes/:id/status', async (req, res) => {
  const auth = getAuth(req)
  const parsed = setStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return
  }
  const gripe = await prisma.gripe.findUnique({
    where: { id: req.params.id },
    select: { id: true, slug: true, orgId: true },
  })
  if (!gripe || gripe.orgId !== auth.orgId) {
    fail(res, 404, 'Unknown gripe')
    return
  }
  const { status } = parsed.data
  await prisma.gripe.update({
    where: { id: gripe.id },
    data: { status, resolvedAt: status === 'resolved' ? new Date() : null },
  })
  log.info(`[ingest] gripe ${gripe.slug} (${gripe.id}) → ${status}`)
  res.json({ ok: true, status })
})
