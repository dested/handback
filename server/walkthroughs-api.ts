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
import {
  getObjectBytes,
  getObjectText,
  isSafePath,
  walkthroughKey,
  presignGet,
  presignPut,
} from './storage'
import { FRAMES_PAGE_DEFAULT, FRAMES_PAGE_MAX } from './mcp-format'
import {
  FULL_EDGE,
  INLINE_EDGE,
  briefFromRecordings,
  evidenceImages,
  imageForAgent,
  imageLabel,
  loadRecordings,
  type BriefCuration,
  type PointEvidence,
  type RecordingBrief,
  type StartHereFrame,
} from './brief'

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

// Refine's numbered obligations (Walkthrough.pointsJson) and the per-point verdict
// an agent posts back against them (WalkthroughNote.outcomesJson). Structural
// twins of the shapes refine.ts writes and mcp-format.ts renders — declared here,
// not imported, so this module doesn't depend on the ones edited alongside it.
export type KeyPoint = {
  id: string
  title: string
  detail: string
  severity: 'high' | 'medium' | 'low'
  atMs: number | null
  // What the recording holds where the point is pinned: the line said there,
  // the frame that shows it, an error beside it. Absent without a moment or a
  // readable recording.
  evidence?: PointEvidence
}
const POINT_OUTCOME_STATUSES = ['fixed', 'partial', 'skipped', 'not_applicable'] as const
type PointOutcomeStatus = (typeof POINT_OUTCOME_STATUSES)[number]
export type PointOutcome = { point: string; status: PointOutcomeStatus; note: string }

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
  // One verdict per key point this result closed out; empty on notes that carry none.
  outcomes: PointOutcome[]
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
  // Refine's condensed brief and its numbered key points; null before Refine runs.
  digestMd: string | null
  points: KeyPoint[] | null
  // Standing project context, prepended to every brief in this project.
  projectInstructions: string | null
  curation: BriefCuration | null
  // The single document an older brief formatter shows as "report.md":
  // briefMd ?? refinedBriefMd ?? recordingMd. Kept for stdio installs that
  // format with an older mcp-format.ts.
  reportMd: string | null
  // A split-out task's whole content (structure.ts); the recording is the parent's.
  briefMd: string | null
  // Refine's model-written working brief: repro steps and done-when per key point.
  refinedBriefMd: string | null
  // The recording itself, read for agents: the v2 report rebuilt from each
  // take's recording.json (`recordingRebuilt`), else the stored report.md.
  recordingMd: string | null
  recordingRebuilt: boolean
  // The frames the report's Start here names, in time order. Empty when the
  // report wasn't rebuilt.
  startHere: StartHereFrame[]
  files: WalkthroughFileRef[]
  // The review thread, oldest first: agent results and reviewer send-backs.
  notes: WalkthroughNoteRef[]
  // Margin notes from humans, oldest first — part of the brief.
  comments: WalkthroughCommentRef[]
  // Files the narration referenced that nobody attached (open suggestions from
  // server/references.ts) — the brief tells the agent the evidence is missing.
  missingFiles: Array<{ label: string; quote: string | null; atMs: number | null }>
}

/** Parses `Walkthrough.pointsJson` leniently — a bad field degrades to no points
 *  rather than failing the pull; a missing detail/severity/atMs falls to a default. */
const pointsSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    detail: z.string().catch(''),
    severity: z.enum(['high', 'medium', 'low']).catch('medium' as const),
    atMs: z.number().nullable().catch(null),
  })
)

/** Parses `WalkthroughNote.outcomesJson` leniently — a bad field degrades to []. */
const outcomesSchema = z.array(
  z.object({
    point: z.string(),
    status: z.enum(POINT_OUTCOME_STATUSES),
    note: z.string().catch(''),
  })
)

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
      // Open only: dismissed nudges and satisfied ones (the file is in `files`)
      // have nothing left to tell an agent.
      suggestions: {
        where: { dismissedAt: null, attachedPath: null },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!walkthrough || !(await inScope(auth, walkthrough)) || !walkthrough.finalizedAt) return null
  if (opts.trace !== false) traceAccess(auth, walkthrough.id, 'pulled')

  const space = spaceId({ teamId: walkthrough.teamId, userId: walkthrough.userId })

  const curationParsed = curationSchema.safeParse(walkthrough.curationJson)
  const curation = curationParsed.success ? curationParsed.data : null

  const pointsParsed = pointsSchema.safeParse(walkthrough.pointsJson)
  const parsedPoints = pointsParsed.success ? pointsParsed.data : null

  // The recording, rebuilt from the files (server/brief.ts). A split-out task
  // carries no takes: its brief is the content and the parent holds the
  // recording. When a take's recording.json can't be read, the stored
  // report.md stands in; a walkthrough without either is still usable.
  const rebuilt = walkthrough.parentId
    ? null
    : await recordingBriefFor(space, walkthrough, curation, parsedPoints)
  const recordingMd =
    rebuilt?.recordingMd ??
    (walkthrough.parentId
      ? null
      : await getObjectText(walkthroughKey(space, walkthrough.id, 'report.md')).catch(
          (err: unknown) => {
            log.warn(
              `[walkthroughs] report.md unreadable for walkthrough ${walkthrough.id}: ${String(err)}`
            )
            return null
          }
        ))
  const points =
    parsedPoints?.map((p) => {
      const evidence = rebuilt?.evidence[p.id]
      return evidence ? { ...p, evidence } : p
    }) ?? null

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
    digestMd: walkthrough.digestMd,
    points,
    projectInstructions: walkthrough.project?.instructions ?? null,
    curation,
    reportMd: walkthrough.briefMd ?? walkthrough.refinedBriefMd ?? recordingMd,
    briefMd: walkthrough.briefMd,
    refinedBriefMd: walkthrough.refinedBriefMd,
    recordingMd,
    recordingRebuilt: rebuilt !== null,
    startHere: rebuilt?.startHere ?? [],
    files: await Promise.all(
      walkthrough.files.map(async (f) => ({
        path: f.path,
        size: f.size,
        contentType: f.contentType,
        url: await presignGet(walkthroughKey(space, walkthrough.id, f.path)),
      }))
    ),
    notes: walkthrough.notes.map((n) => {
      const outcomesParsed = outcomesSchema.safeParse(n.outcomesJson)
      return {
        role: n.role,
        kind: n.kind,
        summary: n.summary,
        prUrl: n.prUrl,
        filesTouched: n.filesTouched,
        evidencePaths: n.evidencePaths,
        outcomes: outcomesParsed.success ? outcomesParsed.data : [],
        bodyMd: n.bodyMd,
        authorName: n.authorName,
        createdAt: n.createdAt.toISOString(),
      }
    }),
    comments: walkthrough.comments.map((c) => ({
      authorName: c.authorName,
      atMs: c.atMs,
      text: c.text,
      createdAt: c.createdAt.toISOString(),
    })),
    missingFiles: walkthrough.suggestions.map((s) => ({
      label: s.label,
      quote: s.quote,
      atMs: s.atMs,
    })),
  }
}

/** The rebuilt recording for a loaded walkthrough row, or null when its takes can't be read. */
async function recordingBriefFor(
  space: string,
  walkthrough: {
    id: string
    title: string
    slug: string
    origin: string | null
    recordedAt: Date
    takes: Array<{ index: number; dir: string; videoPath: string | null }>
  },
  curation: BriefCuration | null,
  points: Array<{ id: string; atMs: number | null }> | null
): Promise<RecordingBrief | null> {
  const takes = walkthrough.takes.map((t) => ({
    index: t.index,
    dir: t.dir,
    videoPath: t.videoPath,
  }))
  const recordings = await loadRecordings(space, walkthrough.id, takes)
  if (!recordings) return null
  try {
    return briefFromRecordings({ ...walkthrough, takes, curation, points }, recordings)
  } catch (err) {
    log.warn(
      `[walkthroughs] report rebuild failed for walkthrough ${walkthrough.id}: ${String(err)}`
    )
    return null
  }
}

/** Images per get_images call: six frames at INLINE_EDGE stay well inside Claude Code's 25k-token result cap. */
export const IMAGES_PER_CALL = 6

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type WalkthroughImage = {
  path: string
  /** "rec-01/frames/04-0090.jpg · 0:09 · KP2 · changed top-right (small)" — what the agent reads above the image. */
  label: string
  mimeType: 'image/jpeg'
  /** base64 */
  data: string
}

export type WalkthroughImages = {
  walkthroughId: string
  images: WalkthroughImage[]
  /** Requested paths that aren't images of this walkthrough. */
  skipped: string[]
  /** Evidence paths left out by the per-call cap; ask for them by path. */
  more: string[]
}

/**
 * Frames and contact sheets as images an agent sees inline. With no paths, the
 * evidence set: each key point's frame in point order, then the report's Start
 * here, at most IMAGES_PER_CALL. Null on the same misses as getWalkthroughDetail.
 */
export async function getWalkthroughImages(
  auth: TokenAuth,
  walkthroughId: string,
  paths?: string[]
): Promise<WalkthroughImages | null> {
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    include: {
      takes: { orderBy: { index: 'asc' } },
      files: { where: { status: 'uploaded' }, orderBy: { path: 'asc' } },
    },
  })
  if (!walkthrough || !(await inScope(auth, walkthrough)) || !walkthrough.finalizedAt) return null
  traceAccess(auth, walkthrough.id, 'pulled')
  const space = spaceId({ teamId: walkthrough.teamId, userId: walkthrough.userId })

  const curationParsed = curationSchema.safeParse(walkthrough.curationJson)
  const pointsParsed = pointsSchema.safeParse(walkthrough.pointsJson)
  const points = pointsParsed.success ? pointsParsed.data : []
  const rebuilt = walkthrough.parentId
    ? null
    : await recordingBriefFor(
        space,
        walkthrough,
        curationParsed.success ? curationParsed.data : null,
        points
      )

  // Why each evidence frame is in the set, for its label.
  const evidence = new Map(evidenceImages(rebuilt, points).map((e) => [e.path, e]))

  const images = new Map(
    walkthrough.files.filter((f) => IMAGE_TYPES.has(f.contentType)).map((f) => [f.path, f])
  )
  const wanted = paths && paths.length > 0 ? [...new Set(paths)] : [...evidence.keys()]
  const skipped = wanted.filter((p) => !images.has(p))
  const servable = wanted.filter((p) => images.has(p))
  const chosen = servable.slice(0, IMAGES_PER_CALL)

  const out = await Promise.all(
    chosen.map(async (path): Promise<WalkthroughImage> => {
      const bytes = await getObjectBytes(walkthroughKey(space, walkthrough.id, path))
      const { data, mimeType } = await imageForAgent(bytes, INLINE_EDGE)
      return { path, label: imageLabel(path, rebuilt, evidence.get(path)), mimeType, data }
    })
  )
  return {
    walkthroughId: walkthrough.id,
    images: out,
    skipped,
    more: servable.slice(IMAGES_PER_CALL),
  }
}

/** Text files up to this many characters come back inline; past it, a URL. */
const TEXT_INLINE_MAX = 400_000

export type WalkthroughFileContent =
  | { kind: 'text'; path: string; contentType: string; text: string }
  | { kind: 'image'; path: string; mimeType: 'image/jpeg'; data: string }
  | { kind: 'url'; path: string; contentType: string; size: number; url: string }

const isText = (contentType: string) =>
  contentType.startsWith('text/') || contentType === 'application/json'

/**
 * One file of a walkthrough, in the form an agent can use directly: text as
 * text, an image near full size, anything else (video, a PDF) as a presigned
 * URL. Null when the walkthrough is out of reach or has no such file.
 */
export async function getWalkthroughFile(
  auth: TokenAuth,
  walkthroughId: string,
  path: string
): Promise<WalkthroughFileContent | null> {
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    include: { files: { where: { status: 'uploaded', path } } },
  })
  if (!walkthrough || !(await inScope(auth, walkthrough)) || !walkthrough.finalizedAt) return null
  const file = walkthrough.files[0]
  if (!file) return null
  traceAccess(auth, walkthrough.id, 'pulled')
  const space = spaceId({ teamId: walkthrough.teamId, userId: walkthrough.userId })
  const key = walkthroughKey(space, walkthrough.id, file.path)

  if (IMAGE_TYPES.has(file.contentType)) {
    const { data, mimeType } = await imageForAgent(await getObjectBytes(key), FULL_EDGE)
    return { kind: 'image', path: file.path, mimeType, data }
  }
  if (isText(file.contentType) && file.size <= TEXT_INLINE_MAX) {
    return {
      kind: 'text',
      path: file.path,
      contentType: file.contentType,
      text: await getObjectText(key),
    }
  }
  return {
    kind: 'url',
    path: file.path,
    contentType: file.contentType,
    size: file.size,
    url: await presignGet(key),
  }
}

export type WalkthroughFramesPage = {
  walkthroughId: string
  total: number
  offset: number
  limit: number
  returned: number
  /** Pass as the next call's `offset`; null once this page reached the end. */
  nextOffset: number | null
  frames: Array<{ path: string; url: string }>
}

/**
 * One page of a walkthrough's keyframes, presigned. get_walkthrough only ever
 * carries a sample of frames (see mcp-format's cap); this is how an agent pages
 * the full set — every frame, in the order they were recorded — without leaving
 * MCP. Frame files sort chronologically by path (`NN-mmss.jpg`, zero-padded), so
 * list order is timeline order. Only the requested window is presigned, so
 * paging a long walkthrough doesn't sign frames it will never open. Null on the
 * same three misses as getWalkthroughDetail (unknown / out of scope / never
 * finalized).
 */
export async function getWalkthroughFrames(
  auth: TokenAuth,
  walkthroughId: string,
  opts: { offset?: number; limit?: number } = {}
): Promise<WalkthroughFramesPage | null> {
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    include: { files: { where: { status: 'uploaded' }, orderBy: { path: 'asc' } } },
  })
  if (!walkthrough || !(await inScope(auth, walkthrough)) || !walkthrough.finalizedAt) return null
  traceAccess(auth, walkthrough.id, 'pulled')

  const space = spaceId({ teamId: walkthrough.teamId, userId: walkthrough.userId })
  const frameFiles = walkthrough.files.filter((f) => f.path.includes('/frames/'))
  const total = frameFiles.length

  const offset = Math.min(Math.max(0, Math.floor(opts.offset ?? 0)), total)
  const limit = Math.min(
    FRAMES_PAGE_MAX,
    Math.max(1, Math.floor(opts.limit ?? FRAMES_PAGE_DEFAULT))
  )
  const frames = await Promise.all(
    frameFiles.slice(offset, offset + limit).map(async (f) => ({
      path: f.path,
      url: await presignGet(walkthroughKey(space, walkthrough.id, f.path)),
    }))
  )
  const end = offset + frames.length
  return {
    walkthroughId: walkthrough.id,
    total,
    offset,
    limit,
    returned: frames.length,
    nextOffset: end < total ? end : null,
    frames,
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
  // One verdict per key point in the brief; sanitized before it's stored.
  outcomes?: Array<{ point: string; status: string; note?: string }>
}

/** A status is a PointOutcome status only if it's one of the four literals. */
const isPointOutcomeStatus = (s: string): s is PointOutcomeStatus =>
  (POINT_OUTCOME_STATUSES as readonly string[]).includes(s)

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

  // Keep only well-formed outcomes: a real point id and one of the four statuses;
  // note trimmed to 500 chars, the whole set capped at 24 (one per key point, with
  // headroom). Stored only when something survives, so a note without outcomes
  // leaves the column null.
  const outcomes: PointOutcome[] = (input.outcomes ?? [])
    .flatMap((o) => {
      if (typeof o.point !== 'string' || o.point.length === 0) return []
      if (!isPointOutcomeStatus(o.status)) return []
      return [{ point: o.point, status: o.status, note: (o.note ?? '').slice(0, 500) }]
    })
    .slice(0, 24)

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
      ...(outcomes.length > 0 ? { outcomesJson: outcomes } : {}),
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
