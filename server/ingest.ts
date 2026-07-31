// Token-authed REST ingest for the CLI / extension / MCP. Two-phase write:
//
//   POST /api/ingest/gripes            declare a gripe (metadata + file list)
//                                      → gripe row + pending files + presigned PUTs
//   POST /api/ingest/gripes/:id/finalize   confirm the uploads landed
//                                      → files flip to uploaded, gripe becomes visible
//
// Re-declaring the same (org, slug) replaces the previous upload wholesale:
// old rows cascade away and the old S3 prefix is deleted. Auth is a bearer
// ApiToken (`hb_...`); the token pins the org.
//
// The read side is what an agent pulls through `cli/mcp.ts`:
//
//   GET  /api/ingest/gripes            the org's finalized gripes, newest first
//   GET  /api/ingest/gripes/:id        one gripe's full brief (report.md + presigned files)
//   POST /api/ingest/gripes/:id/status open | in_review | resolved
//
// And one stateless helper the recorder leans on so it doesn't have to run
// Whisper on the user's laptop:
//
//   POST /api/ingest/transcribe        16 kHz mono WAV in, timed segments out

import { createHash } from 'node:crypto'
import { Router, json, raw, type Request, type Response } from 'express'
import { z } from 'zod'
import { log } from './logger'
import { polishConfigured, polishTranscript } from './polish'
import { prisma } from './prisma'
import { rateLimit } from './ratelimit'
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
const GB = 1024 * 1024 * 1024

// Limits, and why these numbers. A presigned PUT is a capability we hand to a
// browser: whoever holds it writes to our bucket, on our bill. Before these
// existed, an account created thirty seconds earlier could push objects of any
// size, in any number — an authenticated, unmetered storage endpoint.
//
// The per-file and per-gripe caps are generous against real recordings (a long
// walkthrough runs tens of megabytes) and tight against abuse. The org quota is
// the actual backstop; raise it per customer when someone legitimately needs it.
const MAX_FILE_BYTES = 512 * 1024 * 1024
const MAX_GRIPE_BYTES = 2 * GB
const ORG_QUOTA_BYTES = 20 * GB
const ORG_MAX_GRIPES = 500

const gb = (bytes: number | bigint) => `${(Number(bytes) / GB).toFixed(1)} GB`

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
  if (!raw.startsWith('hb_')) return null
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

// Same story on the other side: once a route carries more than one handler,
// Express 5's types fall back to ParamsDictionary, where every param is
// `string | string[]` (a splat route can capture several segments). Every param
// we declare is a single `:id`, so normalize it in one place.
function pathId(req: Request): string {
  const value = req.params.id
  if (typeof value === 'string') return value
  return value?.[0] ?? ''
}

export const ingestRouter = Router()

ingestRouter.use(json({ limit: '10mb' }))

// Two layers, in this order. The IP limit runs before authentication so a
// bad-token flood can't hammer the token lookup; the per-token limits below run
// after, and meter each route separately so a burst of reads can't starve a
// legitimate upload. Numbers are sized against real use — a recorder pushes one
// gripe every few minutes, an agent polls the list every few seconds — and are
// an order of magnitude below anything that would cost real money.
const byIp = (req: Request): string => req.ip ?? 'unknown'
const byToken = (req: Request): string => getAuth(req).tokenId

const HOUR = 3600

const declareLimit = rateLimit('declare', { window: HOUR, max: 40 }, byToken)
const finalizeLimit = rateLimit('finalize', { window: HOUR, max: 80 }, byToken)
const readLimit = rateLimit('read', { window: HOUR, max: 900 }, byToken)
const statusLimit = rateLimit('status', { window: HOUR, max: 200 }, byToken)
// A one-hour take is ~8 chunks, so this is roughly 35 long recordings an hour —
// far past what a person can narrate, and the only route that spends money per
// call.
const transcribeLimit = rateLimit('transcribe', { window: HOUR, max: 300 }, byToken)
// One call per take, and takes are minutes long.
const polishLimit = rateLimit('polish', { window: HOUR, max: 60 }, byToken)

ingestRouter.use(rateLimit('ingest-ip', { window: 60, max: 240 }, byIp))

ingestRouter.use(async (req, res, next) => {
  const auth = await authenticate(req)
  if (!auth) {
    fail(res, 401, 'Missing or invalid API token')
    return
  }
  ;(req as Request & { ingestAuth: TokenAuth }).ingestAuth = auth
  next()
})

ingestRouter.post('/gripes', declareLimit, async (req, res) => {
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

  const gripeBytes = body.files.reduce((sum, f) => sum + f.size, 0)
  if (gripeBytes > MAX_GRIPE_BYTES) {
    fail(res, 413, `This gripe is ${gb(gripeBytes)}; the limit is ${gb(MAX_GRIPE_BYTES)} per gripe`)
    return
  }

  // Same folder pushed again → the new upload replaces the old one entirely.
  const existing = await prisma.gripe.findUnique({
    where: { orgId_slug: { orgId: auth.orgId, slug: body.slug } },
    select: { id: true, bytes: true },
  })

  // Quota is checked against what the org will hold *after* this write, so a
  // re-push of the same slug doesn't count its own predecessor twice.
  const stored = await prisma.gripe.aggregate({
    where: { orgId: auth.orgId },
    _sum: { bytes: true },
    _count: true,
  })
  const otherBytes = (stored._sum.bytes ?? 0n) - (existing?.bytes ?? 0n)
  const otherCount = stored._count - (existing ? 1 : 0)
  if (otherBytes + BigInt(gripeBytes) > BigInt(ORG_QUOTA_BYTES)) {
    fail(
      res,
      413,
      `Storage quota reached: this org holds ${gb(otherBytes)} of ${gb(ORG_QUOTA_BYTES)}. Delete some gripes, or ask us to raise it.`
    )
    return
  }
  if (otherCount >= ORG_MAX_GRIPES) {
    fail(res, 413, `This org is at its limit of ${ORG_MAX_GRIPES} gripes. Delete some first.`)
    return
  }

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
      bytes: BigInt(gripeBytes),
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
      url: await presignPut(gripeKey(auth.orgId, gripe.id, f.path), f.contentType, f.size),
      contentType: f.contentType,
    }))
  )

  log.info(
    `[ingest] declared gripe ${body.slug} (${body.files.length} files) for org ${auth.orgId}`
  )
  res.json({ gripeId: gripe.id, uploads })
})

ingestRouter.post('/gripes/:id/finalize', finalizeLimit, async (req, res) => {
  const auth = getAuth(req)
  const gripe = await prisma.gripe.findUnique({ where: { id: pathId(req) } })
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
ingestRouter.get('/gripes', readLimit, async (req, res) => {
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
ingestRouter.get('/gripes/:id', readLimit, async (req, res) => {
  const auth = getAuth(req)
  const gripe = await prisma.gripe.findUnique({
    where: { id: pathId(req) },
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
ingestRouter.post('/gripes/:id/status', statusLimit, async (req, res) => {
  const auth = getAuth(req)
  const parsed = setStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return
  }
  const gripe = await prisma.gripe.findUnique({
    where: { id: pathId(req) },
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

// POST /api/ingest/transcribe — one chunk of 16 kHz mono WAV in, timed segments
// out. The recorder splits long takes itself and offsets the results, because
// only it knows where it cut; this endpoint is deliberately stateless and knows
// nothing about gripes. Raw body, not JSON: base64 would inflate the audio by a
// third for no reason. `json()` above ignores a non-JSON content type, so the
// raw parser here is the only one that touches this body.
const MAX_AUDIO_BYTES = 30 * 1024 * 1024

ingestRouter.post(
  '/transcribe',
  // Limit first, parse second: no point buffering 30 MB to then refuse it.
  transcribeLimit,
  raw({ type: ['audio/wav', 'application/octet-stream'], limit: MAX_AUDIO_BYTES }),
  async (req, res) => {
    if (!transcriptionConfigured()) {
      fail(res, 503, 'Server-side transcription is not configured on this server')
      return
    }
    const audio = req.body
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      fail(res, 400, 'Expected a WAV body')
      return
    }
    // A two-letter hint helps Whisper; anything else is noise, so drop it.
    const langParam = req.query.language
    const language =
      typeof langParam === 'string' && /^[a-z]{2}$/.test(langParam) ? langParam : undefined

    try {
      const segments = await transcribeChunk(new Uint8Array(audio), language)
      res.json({ segments })
    } catch (err) {
      if (err instanceof TranscribeUnavailable) {
        fail(res, 503, err.message)
        return
      }
      const detail = err instanceof TranscribeFailed ? err.message : 'unknown error'
      log.warn(`[ingest] transcribe failed: ${detail}`)
      // The recorder treats any non-2xx as "fall back to on-device", so the
      // caller never needs the provider's error text.
      fail(res, 502, 'Transcription provider failed')
    }
  }
)

// POST /api/ingest/polish — transcript lines in, the same lines back with the
// product's own nouns spelled right. Stateless like /transcribe, and just as
// optional: the recorder sends the un-polished transcript if this says no.
const polishSchema = z.object({
  lines: z
    .array(z.object({ text: z.string().max(2000) }))
    .min(1)
    .max(4000),
  context: z
    .object({
      origin: z.string().max(300).optional(),
      title: z.string().max(300).optional(),
      errors: z.array(z.string().max(2000)).max(60).optional(),
    })
    .default({}),
})

ingestRouter.post('/polish', polishLimit, async (req, res) => {
  if (!polishConfigured()) {
    fail(res, 503, 'Transcript cleanup is not configured on this server')
    return
  }
  const parsed = polishSchema.safeParse(req.body)
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return
  }
  const cleaned = await polishTranscript(parsed.data.lines, parsed.data.context).catch(
    (err: unknown) => {
      log.warn(`[ingest] polish failed: ${String(err)}`)
      return null
    }
  )
  if (!cleaned) {
    fail(res, 502, 'Transcript cleanup failed')
    return
  }
  res.json({ lines: cleaned.map((text) => ({ text })) })
})
