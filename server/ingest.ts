// Token-authed REST ingest for the CLI / extension / MCP. Two-phase write:
//
//   POST /api/ingest/walkthroughs            declare a walkthrough (metadata + file list)
//                                      → walkthrough row + pending files + presigned PUTs
//   POST /api/ingest/walkthroughs/:id/finalize   confirm the uploads landed
//                                      → files flip to uploaded, walkthrough becomes visible
//
// Every walkthrough route is also registered under its old `/gripes` spelling —
// see the DECLARE / FINALIZE / DETAIL / STATUS path lists below.
//
// Re-declaring the same (org, slug) replaces the previous upload wholesale:
// old rows cascade away and the old S3 prefix is deleted. Auth is a bearer
// ApiToken (`hb_...`); the token pins the org.
//
// The read side is what an agent pulls through `cli/mcp.ts`:
//
//   GET  /api/ingest/walkthroughs            the org's finalized walkthroughs, newest first
//   GET  /api/ingest/walkthroughs/:id        one walkthrough's full brief (report.md + presigned files)
//   POST /api/ingest/walkthroughs/:id/status open | in_review | resolved
//
// And one stateless helper the recorder leans on so it doesn't have to run
// Whisper on the user's laptop:
//
//   POST /api/ingest/transcribe        16 kHz mono WAV in, timed segments out

import { Router, json, raw, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  WALKTHROUGH_STATUSES,
  authenticateToken,
  getWalkthroughDetail,
  listWalkthroughs,
  setWalkthroughStatus,
  type WalkthroughStatus,
  type TokenAuth,
} from './walkthroughs-api'
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
import { deletePrefix, walkthroughKey, walkthroughPrefix, isSafePath, presignPut } from './storage'

const MAX_FILES = 4000
const GB = 1024 * 1024 * 1024

// Limits, and why these numbers. A presigned PUT is a capability we hand to a
// browser: whoever holds it writes to our bucket, on our bill. Before these
// existed, an account created thirty seconds earlier could push objects of any
// size, in any number — an authenticated, unmetered storage endpoint.
//
// The per-file cap has to clear a real walkthrough's webm: a 20-minute
// screen recording runs past 512 MB at capture bitrates, and it arrives as ONE
// file (2026-07-31: a 20-minute session hit exactly this wall in the field).
// 2 GB per file / 4 GB per walkthrough keeps hour-plus recordings shippable; the org
// quota below is the actual backstop — raise it per customer when someone
// legitimately needs it.
const MAX_FILE_BYTES = 2 * GB
const MAX_WALKTHROUGH_BYTES = 4 * GB
export const ORG_QUOTA_BYTES = 20 * GB
export const ORG_MAX_WALKTHROUGHS = 500

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
  errorCount: z.number().int().min(0).default(0),
  droppedCount: z.number().int().min(0).default(0),
  /** Pin the walkthrough to this project; absent = auto-route by originHints. */
  projectId: z.string().max(60).optional(),
  /** @deprecated Recorder ≤1.1.0 called `errorCount` this. Read when it's the only one sent. */
  eventCount: z.number().int().min(0).optional(),
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

const statusSchema = z.enum(WALKTHROUGH_STATUSES)

const setStatusSchema = z.object({ status: statusSchema })

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

// Recorder ≤1.2.x and older CLIs post /gripes — keep until no old installs
// remain. Each route registers both spellings against the same handler and the
// same limiter instance, so the alias shares one budget rather than doubling it.
const DECLARE = ['/walkthroughs', '/gripes']
const FINALIZE = ['/walkthroughs/:id/finalize', '/gripes/:id/finalize']
const DETAIL = ['/walkthroughs/:id', '/gripes/:id']
const STATUS = ['/walkthroughs/:id/status', '/gripes/:id/status']

ingestRouter.use(json({ limit: '10mb' }))

// Two layers, in this order. The IP limit runs before authentication so a
// bad-token flood can't hammer the token lookup; the per-token limits below run
// after, and meter each route separately so a burst of reads can't starve a
// legitimate upload. Numbers are sized against real use — a recorder pushes one
// walkthrough every few minutes, an agent polls the list every few seconds — and are
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
  const auth = await authenticateToken(req.header('authorization'))
  if (!auth) {
    fail(res, 401, 'Missing or invalid API token')
    return
  }
  ;(req as Request & { ingestAuth: TokenAuth }).ingestAuth = auth
  next()
})

// GET /api/ingest/context — who this token speaks for. The recorder panel
// calls it to show the workspace's real name and offer its projects as
// upload destinations; the token already pins the org.
ingestRouter.get('/context', readLimit, async (req, res) => {
  const auth = getAuth(req)
  const [org, projects] = await Promise.all([
    prisma.org.findUnique({
      where: { id: auth.orgId },
      select: { id: true, name: true, slug: true },
    }),
    prisma.project.findMany({
      where: { orgId: auth.orgId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, slug: true, originHints: true },
    }),
  ])
  if (!org) {
    fail(res, 404, 'Unknown org')
    return
  }
  res.json({ org, projects })
})

ingestRouter.post(DECLARE, declareLimit, async (req, res) => {
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

  const walkthroughBytes = body.files.reduce((sum, f) => sum + f.size, 0)
  if (walkthroughBytes > MAX_WALKTHROUGH_BYTES) {
    fail(
      res,
      413,
      `This walkthrough is ${gb(walkthroughBytes)}; the limit is ${gb(MAX_WALKTHROUGH_BYTES)} per walkthrough`
    )
    return
  }

  // Route to a project. A project the sender named outranks the origin hint —
  // the hint is a guess, an explicit choice isn't. Validated before the
  // replace below: a bad projectId must reject the declare, not first destroy
  // the walkthrough this slug already holds.
  let projectId: string | null = null
  if (body.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: { id: true, orgId: true },
    })
    if (!project || project.orgId !== auth.orgId) {
      fail(res, 400, 'Unknown project')
      return
    }
    projectId = project.id
  } else if (body.origin) {
    const projects = await prisma.project.findMany({
      where: { orgId: auth.orgId },
      select: { id: true, originHints: true },
    })
    projectId = projects.find((p) => p.originHints.includes(body.origin!))?.id ?? null
  }

  // Same folder pushed again → the new upload replaces the old one entirely.
  const existing = await prisma.walkthrough.findUnique({
    where: { orgId_slug: { orgId: auth.orgId, slug: body.slug } },
    select: { id: true, bytes: true },
  })

  // Quota is checked against what the org will hold *after* this write, so a
  // re-push of the same slug doesn't count its own predecessor twice.
  const stored = await prisma.walkthrough.aggregate({
    where: { orgId: auth.orgId },
    _sum: { bytes: true },
    _count: true,
  })
  const otherBytes = (stored._sum.bytes ?? 0n) - (existing?.bytes ?? 0n)
  const otherCount = stored._count - (existing ? 1 : 0)
  if (otherBytes + BigInt(walkthroughBytes) > BigInt(ORG_QUOTA_BYTES)) {
    fail(
      res,
      413,
      `Storage quota reached: this org holds ${gb(otherBytes)} of ${gb(ORG_QUOTA_BYTES)}. Delete some walkthroughs, or ask us to raise it.`
    )
    return
  }
  if (otherCount >= ORG_MAX_WALKTHROUGHS) {
    fail(
      res,
      413,
      `This org is at its limit of ${ORG_MAX_WALKTHROUGHS} walkthroughs. Delete some first.`
    )
    return
  }

  if (existing) {
    await deletePrefix(walkthroughPrefix(auth.orgId, existing.id))
    await prisma.walkthrough.delete({ where: { id: existing.id } })
  }

  const walkthrough = await prisma.walkthrough.create({
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
      // A recorder that predates the rename only sends `eventCount`; it meant
      // the same thing, so honour it rather than silently storing zero.
      errorCount: body.errorCount || (body.eventCount ?? 0),
      droppedCount: body.droppedCount,
      bytes: BigInt(walkthroughBytes),
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
      url: await presignPut(
        walkthroughKey(auth.orgId, walkthrough.id, f.path),
        f.contentType,
        f.size
      ),
      contentType: f.contentType,
    }))
  )

  log.info(
    `[ingest] declared walkthrough ${body.slug} (${body.files.length} files) for org ${auth.orgId}`
  )
  res.json({ walkthroughId: walkthrough.id, uploads })
})

ingestRouter.post(FINALIZE, finalizeLimit, async (req, res) => {
  const auth = getAuth(req)
  const walkthrough = await prisma.walkthrough.findUnique({ where: { id: pathId(req) } })
  if (!walkthrough || walkthrough.orgId !== auth.orgId) {
    fail(res, 404, 'Unknown walkthrough')
    return
  }
  await prisma.walkthroughFile.updateMany({
    where: { walkthroughId: walkthrough.id },
    data: { status: 'uploaded' },
  })
  await prisma.walkthrough.update({
    where: { id: walkthrough.id },
    data: { finalizedAt: new Date() },
  })
  log.info(`[ingest] finalized walkthrough ${walkthrough.slug} (${walkthrough.id})`)
  res.json({ ok: true, walkthroughId: walkthrough.id })
})

// The read side is three thin wrappers over `walkthroughs-api.ts` — the hosted MCP
// endpoint calls the same functions, so a change to what an agent sees lands on
// both surfaces at once.

ingestRouter.get(DECLARE, readLimit, async (req, res) => {
  const auth = getAuth(req)
  const status = req.query.status
  const parsed = status === undefined ? undefined : statusSchema.safeParse(status)
  if (parsed && !parsed.success) {
    fail(res, 400, `status must be one of ${statusSchema.options.join(', ')}`)
    return
  }
  res.json(await listWalkthroughs(auth, parsed?.data))
})

ingestRouter.get(DETAIL, readLimit, async (req, res) => {
  const auth = getAuth(req)
  const walkthrough = await getWalkthroughDetail(auth, pathId(req))
  if (!walkthrough) {
    fail(res, 404, 'Unknown walkthrough')
    return
  }
  res.json(walkthrough)
})

ingestRouter.post(STATUS, statusLimit, async (req, res) => {
  const auth = getAuth(req)
  const parsed = setStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return
  }
  const status: WalkthroughStatus = parsed.data.status
  const moved = await setWalkthroughStatus(auth, pathId(req), status)
  if (!moved) {
    fail(res, 404, 'Unknown walkthrough')
    return
  }
  res.json({ ok: true, status })
})

// POST /api/ingest/transcribe — one chunk of 16 kHz mono WAV in, timed segments
// out. The recorder splits long takes itself and offsets the results, because
// only it knows where it cut; this endpoint is deliberately stateless and knows
// nothing about walkthroughs. Raw body, not JSON: base64 would inflate the audio by a
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
