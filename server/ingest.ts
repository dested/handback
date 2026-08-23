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
// Re-declaring the same (space, slug) replaces the previous upload wholesale:
// old rows cascade away and the old S3 prefix is deleted. Auth is a bearer
// ApiToken (`hb_...`); the token is its owner, and reaches their personal space
// plus every team they belong to. A declare names its destination with
// `teamId` — absent means personal.
//
// The read side is what an agent pulls through `cli/mcp.ts`:
//
//   GET  /api/ingest/walkthroughs            finalized walkthroughs the token reaches, newest first
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
  askReviewerQuestion,
  authenticateToken,
  getWalkthroughDetail,
  listWalkthroughs,
  postWalkthroughResult,
  requestEvidenceUploads,
  setWalkthroughStatus,
  type WalkthroughStatus,
  type TokenAuth,
} from './walkthroughs-api'
import { memberTeamIds, spaceId } from './access'
import { log } from './logger'
import { notifyUpload } from './notify'
import { runRefine } from './refine'
import { indexWalkthrough } from './search'
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
import { checkAndReservePolish, checkAndReserveTranscribe, cloudStatus } from './usage'

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
// 2 GB per file / 4 GB per walkthrough keeps hour-plus recordings shippable; the
// space quota below is the actual backstop — raise it per customer when someone
// legitimately needs it. Quota is per space: a user's personal space and each of
// their teams each get their own allowance.
// Exported because the cloud editor writes into an existing walkthrough over
// tRPC (`walkthroughs.presignEdit`) rather than through declare, and a second
// set of numbers is a second set to forget to raise.
export const MAX_FILE_BYTES = 2 * GB
export const MAX_WALKTHROUGH_BYTES = 4 * GB
export const SPACE_QUOTA_BYTES = 20 * GB
export const SPACE_MAX_WALKTHROUGHS = 500

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
  /** Destination space; absent = the token owner's personal space. The
   *  recorder's destination picker sends it. */
  teamId: z.string().max(60).optional(),
  /** 'human' = the edited video is the deliverable (final.mp4 primary, no
   *  distill) and the walkthrough is hidden from agent lists. Absent = 'agent',
   *  which is every recorder that predates the split. */
  kind: z.enum(['agent', 'human']).default('agent'),
  /** What the recording is FOR — drives the brief's framing and the refine
   *  prompts. Absent = untagged; never guessed server-side. */
  intent: z.enum(['bug', 'feature', 'idea']).optional(),
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

// Cloud writes (declare) and the paid AI passes (transcribe/polish) require a
// verified email; a platform admin is exempt. Reads stay open — an unverified
// agent can still see its queue. Returns false and sends the 403 when it blocks.
function requireVerifiedEmail(auth: TokenAuth, res: Response): boolean {
  if (auth.emailVerified || auth.isAdmin) return true
  fail(res, 403, 'verify your email to upload')
  return false
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

// GET /api/ingest/context — every space this token can upload into: the owner's
// personal space and each of their teams, each with its projects. The recorder
// panel's destination picker reads this, then sends the chosen `teamId` (or none
// for personal) on declare.
ingestRouter.get('/context', readLimit, async (req, res) => {
  const auth = getAuth(req)
  const projectSelect = { id: true, name: true, slug: true, originHints: true } as const
  const [user, personalProjects, memberships, cloud] = await Promise.all([
    prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, name: true, email: true },
    }),
    prisma.project.findMany({
      where: { userId: auth.userId, teamId: null },
      orderBy: { createdAt: 'asc' },
      select: projectSelect,
    }),
    prisma.membership.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: 'asc' },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            slug: true,
            projects: { orderBy: { createdAt: 'asc' }, select: projectSelect },
          },
        },
      },
    }),
    // Future recorders read this to self-configure their cloud passes; today's
    // ignore the field.
    cloudStatus(auth.userId),
  ])
  if (!user) {
    fail(res, 404, 'Unknown user')
    return
  }
  res.json({
    user,
    personal: { projects: personalProjects },
    teams: memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      slug: m.team.slug,
      projects: m.team.projects,
    })),
    cloud,
  })
})

ingestRouter.post(DECLARE, declareLimit, async (req, res) => {
  const auth = getAuth(req)
  if (!requireVerifiedEmail(auth, res)) return
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

  // Where this lands. A declare may name a team, but never a space its sender
  // isn't in — an upload is never cross-space, platform admins included.
  if (body.teamId && !(await memberTeamIds(auth.userId)).includes(body.teamId)) {
    fail(res, 400, 'Unknown team')
    return
  }
  const space = body.teamId
    ? { teamId: body.teamId, userId: null }
    : { teamId: null, userId: auth.userId }
  const spaceWhere = body.teamId ? { teamId: body.teamId } : { teamId: null, userId: auth.userId }

  // Route to a project. A project the sender named outranks the origin hint —
  // the hint is a guess, an explicit choice isn't. Validated before the
  // replace below: a bad projectId must reject the declare, not first destroy
  // the walkthrough this slug already holds.
  let projectId: string | null = null
  if (body.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: { id: true, teamId: true, userId: true },
    })
    // Same space, both sides of the pair — a project of another space is as
    // unknown as one that doesn't exist.
    if (!project || project.teamId !== space.teamId || project.userId !== space.userId) {
      fail(res, 400, 'Unknown project')
      return
    }
    projectId = project.id
  } else if (body.origin) {
    const projects = await prisma.project.findMany({
      where: spaceWhere,
      select: { id: true, originHints: true },
    })
    projectId = projects.find((p) => p.originHints.includes(body.origin!))?.id ?? null
  }

  // Same folder pushed again → the new upload replaces the old one entirely.
  // Slug uniqueness is per space and code-enforced, so this is a findFirst.
  const existing = await prisma.walkthrough.findFirst({
    where: { ...spaceWhere, slug: body.slug },
    select: { id: true, bytes: true },
  })

  // Quota is checked against what the space will hold *after* this write, so a
  // re-push of the same slug doesn't count its own predecessor twice.
  const stored = await prisma.walkthrough.aggregate({
    where: spaceWhere,
    _sum: { bytes: true },
    _count: true,
  })
  const otherBytes = (stored._sum.bytes ?? 0n) - (existing?.bytes ?? 0n)
  const otherCount = stored._count - (existing ? 1 : 0)
  if (otherBytes + BigInt(walkthroughBytes) > BigInt(SPACE_QUOTA_BYTES)) {
    fail(
      res,
      413,
      `Storage quota reached: this space holds ${gb(otherBytes)} of ${gb(SPACE_QUOTA_BYTES)}. Delete some walkthroughs, or ask us to raise it.`
    )
    return
  }
  if (otherCount >= SPACE_MAX_WALKTHROUGHS) {
    fail(
      res,
      413,
      `This space is at its limit of ${SPACE_MAX_WALKTHROUGHS} walkthroughs. Delete some first.`
    )
    return
  }

  if (existing) {
    await deletePrefix(walkthroughPrefix(spaceId(space), existing.id))
    await prisma.walkthrough.delete({ where: { id: existing.id } })
  }

  const walkthrough = await prisma.walkthrough.create({
    data: {
      ...space,
      projectId,
      slug: body.slug,
      title: body.title,
      origin: body.origin ?? null,
      kind: body.kind,
      intent: body.intent ?? null,
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
        walkthroughKey(spaceId(space), walkthrough.id, f.path),
        f.contentType,
        f.size
      ),
      contentType: f.contentType,
    }))
  )

  log.info(
    `[ingest] declared walkthrough ${body.slug} (${body.files.length} files) for ${body.teamId ? `team ${body.teamId}` : `personal ${auth.userId}`}`
  )
  res.json({ walkthroughId: walkthrough.id, uploads })
})

ingestRouter.post(FINALIZE, finalizeLimit, async (req, res) => {
  const auth = getAuth(req)
  const walkthrough = await prisma.walkthrough.findUnique({ where: { id: pathId(req) } })
  // Write path: no platform-admin bypass. Whoever finalizes an upload has to be
  // in the space it landed in.
  const owned =
    walkthrough !== null &&
    (walkthrough.userId === auth.userId ||
      (walkthrough.teamId !== null &&
        (await memberTeamIds(auth.userId)).includes(walkthrough.teamId)))
  if (!walkthrough || !owned) {
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
  // Only on the null→set transition: a client retrying finalize must not
  // re-mail the team. Fire-and-forget — email is never worth a slower upload.
  if (!walkthrough.finalizedAt) void notifyUpload(walkthrough.id)
  // Same null→set gate for the pro-gated refine pass: it runs once per upload,
  // reads its own eligibility, and never throws.
  if (!walkthrough.finalizedAt && walkthrough.kind === 'agent') void runRefine(walkthrough.id)
  // Fill the search corpus from the uploaded report/transcript. Every finalize
  // (re-push included) — the files may have changed.
  void indexWalkthrough(walkthrough.id)
  res.json({ ok: true, walkthroughId: walkthrough.id })
})

// POST /api/ingest/walkthroughs/:id/result — the agent's answer (MCP
// `post_result` reaches this through cli/mcp.ts; the hosted server calls the
// shared function directly). No /gripes alias: no shipped client posts it.
const postResultSchema = z.object({
  summary: z.string().min(1).max(2000),
  prUrl: z.string().url().max(500).optional(),
  filesTouched: z.array(z.string().max(300)).max(100).optional(),
  body: z.string().max(20_000).optional(),
})

ingestRouter.post('/walkthroughs/:id/result', statusLimit, async (req, res) => {
  const auth = getAuth(req)
  const parsed = postResultSchema.safeParse(req.body)
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return
  }
  const posted = await postWalkthroughResult(auth, pathId(req), parsed.data)
  if (!posted) {
    fail(res, 404, 'Unknown walkthrough')
    return
  }
  res.json({ ok: true })
})

// POST /api/ingest/walkthroughs/:id/question — an agent asks the reviewer a
// question instead of guessing (MCP `ask_reviewer` reaches this through
// cli/mcp.ts; the hosted server calls the shared function directly). Moves the
// walkthrough to needs_info and mails the uploader. No /gripes alias: no shipped
// client posts it.
const questionSchema = z.object({
  question: z.string().min(1).max(2000),
})

ingestRouter.post('/walkthroughs/:id/question', statusLimit, async (req, res) => {
  const auth = getAuth(req)
  const parsed = questionSchema.safeParse(req.body)
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return
  }
  const asked = await askReviewerQuestion(auth, pathId(req), parsed.data.question)
  if (!asked) {
    fail(res, 404, 'Unknown walkthrough')
    return
  }
  res.json({ ok: true, status: 'needs_info' })
})

// POST /api/ingest/walkthroughs/:id/evidence — presigned PUTs for proof
// screenshots an agent attaches to its result (the paths land on the note via
// attach_evidence). Small images only, a handful per call.
const evidenceSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z0-9._-]{1,80}$/i),
        size: z
          .number()
          .int()
          .min(1)
          .max(5 * 1024 * 1024),
        contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      })
    )
    .min(1)
    .max(4),
})

ingestRouter.post('/walkthroughs/:id/evidence', statusLimit, async (req, res) => {
  const auth = getAuth(req)
  const parsed = evidenceSchema.safeParse(req.body)
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return
  }
  const result = await requestEvidenceUploads(auth, pathId(req), parsed.data.files)
  if (!result) {
    fail(res, 404, 'Unknown walkthrough')
    return
  }
  res.json(result)
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

  // ?team=personal | <teamId>; absent lists every space the token reaches.
  const teamParam = req.query.team
  if (teamParam !== undefined && typeof teamParam !== 'string') {
    fail(res, 400, 'team must be "personal" or a team id')
    return
  }
  let space: { teamId: string | null } | undefined
  if (teamParam === 'personal') {
    space = { teamId: null }
  } else if (teamParam !== undefined) {
    if (!auth.isAdmin && !(await memberTeamIds(auth.userId)).includes(teamParam)) {
      fail(res, 403, 'Not a member of that team')
      return
    }
    space = { teamId: teamParam }
  }

  res.json(await listWalkthroughs(auth, parsed?.data, space))
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
    const auth = getAuth(req)
    if (!transcriptionConfigured()) {
      fail(res, 503, 'Server-side transcription is not configured on this server')
      return
    }
    if (!requireVerifiedEmail(auth, res)) return
    const audio = req.body
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      fail(res, 400, 'Expected a WAV body')
      return
    }
    // Estimate the take's length from the WAV body BEFORE spending Groq: a
    // 16 kHz mono 16-bit stream is 32000 bytes/sec, so seconds ≈ bytes / 32000.
    // A budget-exhausted caller gets a 429 and never reaches the provider; the
    // recorder degrades to on-device on any non-2xx.
    const estSeconds = Math.max(1, Math.round(audio.length / 32000))
    const budget = await checkAndReserveTranscribe(auth.userId, estSeconds)
    if (!budget.allowed) {
      res
        .status(429)
        .json({ error: 'cloud transcription budget exhausted', remainingSeconds: budget.remaining ?? 0 })
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
  const auth = getAuth(req)
  if (!polishConfigured()) {
    fail(res, 503, 'Transcript cleanup is not configured on this server')
    return
  }
  if (!requireVerifiedEmail(auth, res)) return
  const parsed = polishSchema.safeParse(req.body)
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return
  }
  // Polish is Pro-only past first-walkthrough magic; per-token rate limits above
  // still apply on top of this per-user budget.
  const budget = await checkAndReservePolish(auth.userId)
  if (!budget.allowed) {
    res.status(429).json({ error: 'polish unavailable on this plan' })
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
