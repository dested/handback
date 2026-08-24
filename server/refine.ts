// The refine pass: a pro-gated second read of a finalized walkthrough that turns
// the recorder's raw report + takes into the two documents a coding agent and its
// human actually read — a complete ledger (summaryMd) and an intent-aware working
// brief (refinedBriefMd) — plus capture-health notes and a vision curation of the
// keyframes that carry the story.
//
// It runs fire-and-forget from ingest finalize (the null→set transition only), so
// it OWNS its safety: runRefine never throws. Every failure — no key, not pro, a
// refusal, a timeout, unparseable JSON — leaves refineStatus 'failed' and the row
// otherwise untouched. The original report.md in S3 is never rewritten; the
// refined text lives on the walkthrough row and the brief prefers it.
//
// Same model posture as structure.ts: Sonnet 5 for the synthesis (no assistant
// prefill; JSON shape via structured outputs; `stop_reason: 'refusal'` degrades
// like any other failure — Sonnet-not-Opus is the 2026-08-24 pricing decision,
// decisions.md) and Haiku for the per-batch vision curation, which is cheap
// classification against images the prompt already carries. Vision frames are
// downscaled to 800px JPEGs before sending, near-duplicate frames are skipped by
// a dHash pass (click/nav/start frames immune), and the narration prefix is
// prompt-cached so batches 2+ read it at a tenth of the price.

import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import { z } from 'zod'
import { spaceId } from './access'
import { env } from './env'
import { userIsPro } from './features'
import { log } from './logger'
import { prisma } from './prisma'
import { indexWalkthrough } from './search'
import { getObjectBytes, getObjectText, walkthroughKey } from './storage'
import { checkAndReservePolish } from './usage'

const VISION_MODEL = 'claude-haiku-4-5'
const SYNTH_MODEL = 'claude-sonnet-5'
const VISION_TIMEOUT_MS = 60_000
const SYNTH_TIMEOUT_MS = 120_000
const SYNTH_MAX_TOKENS = 16_000

/** report.md for a long walkthrough is big but bounded; cap what we send. */
const MAX_REPORT_CHARS = 80_000
const MAX_NARRATION_CHARS = 20_000
const MAX_COMMENT_CHARS = 4_000
/** Frames per vision request, and the ceiling of frames the pass will look at. */
const VISION_BATCH = 12
const MAX_VISION_FRAMES = 84
/** Vision frames are downscaled before sending — classification survives 800px, tokens don't. */
const VISION_MAX_EDGE = 800
const VISION_JPEG_QUALITY = 70
/** dHash hamming distance at or under this = near-duplicate of the last kept frame. */
const DEDUP_HAMMING_MAX = 6
/** Frames captured on an interaction are never deduped away — a click frame is load-bearing. */
const PROTECTED_REASONS = new Set(['click', 'nav', 'start'])
/** Ceiling on frames fetched+hashed for dedup, so a pathological recording stays bounded. */
const MAX_DEDUP_CANDIDATES = 400
/** Keepers past this get pruned by weight — a brief cites a handful, not a reel. */
const MAX_KEEPERS = 20

export function refineConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY)
}

/** One capture-QC note for the uploader. `atMs` is the walkthrough-wide clock. */
export type HealthNote = { severity: 'info' | 'warn'; text: string; atMs: number | null }

/** One distinct thing the narrator raised — the structured spine the brief
 *  numbers as obligations and post_result answers point by point. */
export type KeyPoint = {
  id: string // 'kp1'… assigned in code, in ledger order
  title: string
  detail: string
  severity: 'high' | 'medium' | 'low'
  atMs: number | null
}

/** The keyframe curation: the frames worth citing, and the spans marked skippable
 *  (excluded is markers only — the video is never re-encoded). */
export type Curation = {
  frames: Array<{ path: string; caption: string; atMs: number | null }>
  excluded: Array<{ startMs: number; endMs: number; reason: string }>
}

// --- recording.json (per take) --------------------------------------------
// Written by the recorder extension (src/components/viewer/types.ts). Parsed
// defensively here: a missing or broken file yields empty arrays, never a throw.

const recFrameSchema = z
  .object({ tMs: z.number(), file: z.string(), reason: z.string().optional() })
  .passthrough()
const recLineSchema = z
  .object({ tMs: z.number(), endMs: z.number(), text: z.string() })
  .passthrough()
const recordingSchema = z.object({
  recording: z.object({
    frames: z.array(recFrameSchema).catch([]),
    transcript: z.array(recLineSchema).catch([]),
  }),
})

type RecFrame = z.infer<typeof recFrameSchema>
type RecLine = z.infer<typeof recLineSchema>

function parseRecording(text: string | null): { frames: RecFrame[]; transcript: RecLine[] } {
  if (text === null) return { frames: [], transcript: [] }
  try {
    const parsed = recordingSchema.safeParse(JSON.parse(text))
    if (!parsed.success) return { frames: [], transcript: [] }
    return { frames: parsed.data.recording.frames, transcript: parsed.data.recording.transcript }
  } catch {
    return { frames: [], transcript: [] }
  }
}

/** "m:ss" (or "mm:ss") → ms, clamped to the walkthrough; null for anything else.
 *  Copied from structure.ts so the two passes read the transcript's stamps
 *  identically. */
function parseStamp(stamp: string, durationMs: number): number | null {
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(stamp.trim())
  if (!m) return null
  const ms = (Number(m[1]) * 60 + Number(m[2])) * 1000
  return Math.min(ms, Math.max(0, durationMs))
}

/** ms → m:ss on the same clock the transcript and comments use. */
const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

// --- vision curation ------------------------------------------------------

const VISION_SYSTEM =
  'You pick the keyframes that carry a screen recording\'s story for a coding agent, and caption them. Keep a frame only if it shows something the narration references, a bug visibly occurring, an error state, or a distinct step in the flow. Captions are one factual sentence tied to what is visible — never speculation.'

const visionWireSchema = z.object({
  frames: z.array(
    z.object({
      k: z.number().int(),
      keep: z.boolean(),
      weight: z.number(),
      caption: z.string(),
    })
  ),
})

const VISION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['frames'],
  properties: {
    frames: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['k', 'keep', 'weight', 'caption'],
        properties: {
          k: { type: 'number', description: 'The frame number shown to you' },
          keep: { type: 'boolean', description: 'Whether this frame carries the story' },
          weight: { type: 'number', description: 'How much it matters, 1 (minor) to 5 (essential)' },
          caption: { type: 'string', description: 'One factual sentence about what is visible' },
        },
      },
    },
  },
} as const

/** media_type from a frame path's extension; null for anything the vision model
 *  can't take (the frame is then skipped). */
function mediaTypeFor(path: string): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  return null
}

/** Evenly-spaced `count` items out of `items` (keeps first and last). */
function pickEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items
  const out: T[] = []
  for (let i = 0; i < count; i++) {
    out.push(items[Math.round((i * (items.length - 1)) / (count - 1))]!)
  }
  return out
}

type Candidate = { path: string; key: string; atMs: number | null; reason: string | null }
type Keeper = { path: string; caption: string; atMs: number | null; weight: number }

/** A frame ready to send: downscaled JPEG bytes (or original bytes when sharp
 *  couldn't process it) plus the media type those bytes carry. */
type PreparedFrame = {
  path: string
  atMs: number | null
  jpeg: Buffer
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
}

/** 64-bit dHash of a 9×8 grayscale raw buffer (72 bytes): bit(y*8+x) set when the
 *  pixel is darker than its right neighbour. */
function dHash(px: Buffer): bigint {
  let hash = 0n
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (px[y * 9 + x]! < px[y * 9 + x + 1]!) hash |= 1n << BigInt(y * 8 + x)
    }
  }
  return hash
}

/** Hamming distance between two dHashes — popcount of their xor. */
function hamming(a: bigint, b: bigint): number {
  let x = a ^ b
  let count = 0
  while (x > 0n) {
    count += Number(x & 1n)
    x >>= 1n
  }
  return count
}

/** Fetch, downscale, and perceptually dedup the candidate frames the vision pass
 *  will see. Owns all frame I/O (curateFrames does no fetching). A sharp failure
 *  degrades one frame to its raw bytes — it never throws, refine's contract holds. */
async function prepareFrames(candidates: Candidate[]): Promise<PreparedFrame[]> {
  type Prepared = PreparedFrame & { reason: string | null }
  const prepared: Prepared[] = []
  // The dHash of the most recent frame we kept (that had a hash); a near-duplicate
  // of it is dropped. Corrupt frames carry a null hash and never set this.
  let lastKeptHash: bigint | null = null

  for (const c of pickEvenly(candidates, MAX_DEDUP_CANDIDATES)) {
    let bytes: Buffer
    try {
      bytes = Buffer.from(await getObjectBytes(c.key))
    } catch (err) {
      log.warn(`[refine] frame ${c.path} unreadable: ${String(err)}`)
      continue
    }

    let jpeg: Buffer
    let mediaType: PreparedFrame['mediaType']
    let hash: bigint | null
    try {
      jpeg = await sharp(bytes)
        .resize(VISION_MAX_EDGE, VISION_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: VISION_JPEG_QUALITY })
        .toBuffer()
      mediaType = 'image/jpeg'
      const gray = await sharp(bytes).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
      hash = dHash(gray)
    } catch (err) {
      // A corrupt image can't be downscaled or hashed: send it raw, and let a null
      // hash keep it out of the dedup comparison entirely.
      log.warn(`[refine] frame ${c.path} not processable, sending raw: ${String(err)}`)
      const raw = mediaTypeFor(c.path)
      if (!raw) continue
      jpeg = bytes
      mediaType = raw
      hash = null
    }

    const isDuplicate =
      !PROTECTED_REASONS.has(c.reason ?? '') &&
      lastKeptHash !== null &&
      hash !== null &&
      hamming(hash, lastKeptHash) <= DEDUP_HAMMING_MAX
    if (isDuplicate) continue
    if (hash !== null) lastKeptHash = hash
    prepared.push({ path: c.path, atMs: c.atMs, jpeg, mediaType, reason: c.reason })
  }

  if (prepared.length <= MAX_VISION_FRAMES) return prepared

  // Over the cap: interaction frames survive whole, the rest fill what's left —
  // blind sampling could drop a click frame, so protect them explicitly.
  const isProtected = (f: Prepared) => PROTECTED_REASONS.has(f.reason ?? '')
  const protectedFrames = prepared.filter(isProtected)
  const unprotected = prepared.filter((f) => !isProtected(f))
  const kept =
    protectedFrames.length >= MAX_VISION_FRAMES
      ? pickEvenly(protectedFrames, MAX_VISION_FRAMES)
      : [...protectedFrames, ...pickEvenly(unprotected, MAX_VISION_FRAMES - protectedFrames.length)]
  kept.sort((a, b) => (a.atMs ?? Infinity) - (b.atMs ?? Infinity))
  return kept
}

async function curateFrames(
  client: Anthropic,
  frames: PreparedFrame[],
  narration: string
): Promise<Keeper[]> {
  const keepers: Keeper[] = []
  // A running number keys each shown frame back to its source — the model
  // echoes `k`, so it must be unique across every batch.
  let nextK = 0

  for (let start = 0; start < frames.length; start += VISION_BATCH) {
    const batch = frames.slice(start, start + VISION_BATCH)
    const content: Anthropic.ContentBlockParam[] = []
    const shown = new Map<number, PreparedFrame>()

    // The narration is byte-identical across batches and leads the message so it
    // caches: batch 1 writes the prefix, batches 2+ read it at a tenth of the price.
    content.push({
      type: 'text',
      text: `Narration (timestamped):\n${narration}`,
      cache_control: { type: 'ephemeral' },
    })

    for (const frame of batch) {
      const k = nextK++
      shown.set(k, frame)
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: frame.mediaType, data: frame.jpeg.toString('base64') },
      })
      content.push({
        type: 'text',
        text: `frame ${k} — ${frame.atMs === null ? '??:??' : mmss(frame.atMs)}`,
      })
    }
    if (shown.size === 0) continue

    content.push({ type: 'text', text: 'Return a verdict for every frame shown.' })

    try {
      const message = await client.messages.create(
        {
          model: VISION_MODEL,
          max_tokens: 4_000,
          system: VISION_SYSTEM,
          output_config: { format: { type: 'json_schema', schema: VISION_OUTPUT_SCHEMA } },
          messages: [{ role: 'user', content }],
        },
        { timeout: VISION_TIMEOUT_MS }
      )
      if (message.stop_reason === 'refusal') {
        log.warn('[refine] vision batch declined')
        continue
      }
      const text = message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('')
      const parsed = visionWireSchema.safeParse(JSON.parse(text))
      if (!parsed.success) {
        log.warn('[refine] vision batch returned an unusable shape')
        continue
      }
      for (const verdict of parsed.data.frames) {
        const cand = shown.get(verdict.k)
        if (!cand || !verdict.keep) continue
        keepers.push({
          path: cand.path,
          caption: verdict.caption.trim(),
          atMs: cand.atMs,
          weight: Math.max(1, Math.min(5, verdict.weight)),
        })
      }
    } catch (err) {
      // A bad batch loses its own frames; the rest of the curation still runs.
      log.warn(`[refine] vision batch at ${start} failed: ${String(err)}`)
    }
  }

  // Too many keepers dilutes the brief — keep the heaviest, then restore the
  // reading order (chronological, null-timed last).
  let pruned = keepers
  if (pruned.length > MAX_KEEPERS) {
    pruned = [...pruned].sort((a, b) => b.weight - a.weight).slice(0, MAX_KEEPERS)
  }
  pruned.sort((a, b) => (a.atMs ?? Infinity) - (b.atMs ?? Infinity))
  return pruned
}

// --- synthesis ------------------------------------------------------------

const SYNTH_SYSTEM = `You are Handback's refine pass. You read one narrated screen walkthrough — its report, transcript, keyframe captions and capture-health notes — and write the documents a coding agent and its human will actually read.
Rules:
- digest is what the human sees first: 2–4 plain sentences — what this recording is, what the narrator wants, how urgent it reads. Written like a person, never a machine.
- key_points is the structured spine: one entry per distinct thing raised — title in the narrator's own nouns, one-sentence detail, severity from the narrator's framing (high only when real damage is said or shown), at = the m:ss where it is raised (empty string when there is no moment). Complete but never padded; never invent.
- summary_md is the LEDGER: one terse bullet per distinct thing the narrator raised — every bug, feature request, and idea, none merged, none invented — each with its m:ss stamp copied from the transcript and a severity word (high/medium/low) where the narrator's framing supports one. An hour-long recording gets a complete ledger, not a synopsis.
- brief_md opens with a one-paragraph situation statement, then one section PER KEY POINT headed 'KP1 — <title>' (KP numbering in key_points order), each with concrete repro steps and checkable done-when criteria drawn only from what was said or shown, citing curated frames by path and transcript moments by m:ss. Keep the narrator's own product nouns.
- Respect the intent: bug = frame as defects to fix; feature = frame as things to build; idea = frame as an assessment to write, not work to do; untagged = no presumption.
- title: a specific, ≤80-char name for the walkthrough in the narrator's own nouns.
- health_extra: only genuine comprehension problems you noticed (audio that stops making sense, narration referring to something never visible), severity info or warn, at as m:ss or empty string.`

const synthWireSchema = z.object({
  title: z.string().trim().min(1).max(200),
  digest: z.string().trim().min(1),
  key_points: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        detail: z.string(),
        severity: z.enum(['high', 'medium', 'low']),
        at: z.string().max(10),
      })
    )
    .max(24),
  summary_md: z.string(),
  brief_md: z.string(),
  health_extra: z.array(
    z.object({
      severity: z.enum(['info', 'warn']),
      text: z.string(),
      at: z.string().max(10),
    })
  ),
})

const SYNTH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'digest', 'key_points', 'summary_md', 'brief_md', 'health_extra'],
  properties: {
    title: { type: 'string', description: 'Specific ≤80-char name in the narrator\'s nouns' },
    digest: {
      type: 'string',
      description: '2–4 plain sentences a person reads first: what this recording is and what the narrator wants',
    },
    key_points: {
      type: 'array',
      description: 'every distinct thing the narrator raised, in order; typically 2–8; never invented',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'severity', 'at'],
        properties: {
          title: { type: 'string', description: 'The point in the narrator\'s own nouns' },
          detail: { type: 'string', description: 'One sentence on what was raised' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          at: { type: 'string', description: 'm:ss where it is raised, or empty string when there is no moment' },
        },
      },
    },
    summary_md: { type: 'string', description: 'The complete ledger, one bullet per raised item' },
    brief_md: { type: 'string', description: 'The intent-aware working brief an agent reads' },
    health_extra: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'text', 'at'],
        properties: {
          severity: { type: 'string', enum: ['info', 'warn'] },
          text: { type: 'string' },
          at: { type: 'string', description: 'm:ss, or empty string when there is no moment' },
        },
      },
    },
  },
} as const

// --- the pass -------------------------------------------------------------

/**
 * Refine one walkthrough in place, or leave it be. NEVER throws: fire-and-forget
 * from finalize, so any failure is swallowed to a 'failed' status and logged.
 */
export async function runRefine(
  walkthroughId: string,
  // A manual re-run from the viewer meters and pro-gates the CALLER, not the
  // uploader — a pro teammate may refine a non-pro teammate's upload.
  opts: { byUserId?: string } = {}
): Promise<void> {
  const walkthrough = await prisma.walkthrough.findUnique({
    where: { id: walkthroughId },
    include: {
      takes: { orderBy: { index: 'asc' } },
      files: true,
      project: { select: { instructions: true } },
    },
  })

  // Bail silently unless this is a finalized, top-level agent walkthrough on a
  // configured server. None of these are error conditions — they just mean the
  // pass doesn't apply.
  if (
    !walkthrough ||
    !walkthrough.finalizedAt ||
    walkthrough.kind !== 'agent' ||
    walkthrough.parentId !== null ||
    !refineConfigured()
  ) {
    return
  }
  if (walkthrough.refineStatus === 'running') return

  const payerId = opts.byUserId ?? walkthrough.uploadedById
  if (payerId === null || !(await userIsPro(payerId))) return

  // Refine spends one metered Anthropic call, on the same per-user budget polish
  // uses. A refused reservation ends the pass before any provider is touched.
  const budget = await checkAndReservePolish(payerId)
  if (!budget.allowed) return

  // Live progress for the viewer; a failed write never derails the pass.
  const setStage = (stage: string | null) =>
    prisma.walkthrough
      .update({ where: { id: walkthrough.id }, data: { refineStage: stage } })
      .catch(() => {})

  await prisma.walkthrough.update({
    where: { id: walkthrough.id },
    data: { refineStatus: 'running', refineStage: 'reading', refineRuns: { increment: 1 } },
  })

  try {
    const space = spaceId({ teamId: walkthrough.teamId, userId: walkthrough.userId })
    const durationMs = walkthrough.durationMs

    // report.md — the recorder's own writeup, when it uploaded one.
    const reportMd = await getObjectText(walkthroughKey(space, walkthrough.id, 'report.md'))
      .then((t) => t.slice(0, MAX_REPORT_CHARS))
      .catch(() => null)

    // Each take's global offset is the sum of every earlier take's duration —
    // the walkthrough-wide output clock every stamp below rides on.
    const takes = walkthrough.takes
    const offsets: number[] = []
    let acc = 0
    for (const take of takes) {
      offsets.push(acc)
      acc += take.durationMs
    }

    // Pull every take's recording.json once; reused by health checks, curation
    // and the narration block.
    const recordings = await Promise.all(
      takes.map((take) =>
        getObjectText(walkthroughKey(space, walkthrough.id, `${take.dir}/recording.json`))
          .then((t) => parseRecording(t))
          .catch(() => parseRecording(null))
      )
    )

    // Reviewer comments, oldest first, on the same clock.
    const commentRows = await prisma.walkthroughComment.findMany({
      where: { walkthroughId: walkthrough.id },
      orderBy: { createdAt: 'asc' },
    })
    const comments = commentRows
      .map((c) =>
        c.atMs !== null ? `[${mmss(c.atMs)}] ${c.authorName}: ${c.text}` : `${c.authorName}: ${c.text}`
      )
      .join('\n')
      .slice(0, MAX_COMMENT_CHARS)

    const instructions = walkthrough.project?.instructions ?? null

    // --- deterministic health checks -----------------------------------
    const health: HealthNote[] = []
    if (reportMd === null) {
      health.push({ severity: 'warn', text: 'no report.md was uploaded with this walkthrough', atMs: null })
    }
    let spokenMs = 0
    const gapNotes: HealthNote[] = []
    takes.forEach((take, i) => {
      const offset = offsets[i]!
      const rec = recordings[i]!
      const partN = take.index
      if (take.frameCount === 0 && take.durationMs > 60_000) {
        health.push({
          severity: 'warn',
          text: `part ${partN} captured no keyframes — the screen may not have recorded`,
          atMs: offset,
        })
      }
      if (rec.transcript.length === 0 && take.durationMs > 30_000) {
        health.push({
          severity: 'warn',
          text: `part ${partN} has no transcript — the mic may have been muted or transcription failed`,
          atMs: offset,
        })
      }
      if (take.interrupted) {
        health.push({
          severity: 'info',
          text: `part ${partN} was interrupted mid-recording`,
          atMs: offset,
        })
      }
      for (const line of rec.transcript) spokenMs += Math.max(0, line.endMs - line.tMs)

      // A long stretch with no new keyframe while the narrator is still talking
      // reads as a frozen or unrecorded screen. Cap the noise at three notes.
      if (gapNotes.length < 3) {
        for (let f = 0; f + 1 < rec.frames.length && gapNotes.length < 3; f++) {
          const a = rec.frames[f]!
          const b = rec.frames[f + 1]!
          if (b.tMs - a.tMs <= 120_000) continue
          const overlaps = rec.transcript.some(
            (line) => line.endMs > a.tMs && line.tMs < b.tMs
          )
          if (!overlaps) continue
          gapNotes.push({
            severity: 'info',
            text: `no screen change captured between ${mmss(offset + a.tMs)} and ${mmss(offset + b.tMs)}`,
            atMs: offset + a.tMs,
          })
        }
      }
    })
    if (durationMs > 120_000 && spokenMs / durationMs < 0.2) {
      health.push({
        severity: 'info',
        text: 'narration covers less than a fifth of the recording',
        atMs: null,
      })
    }
    if (walkthrough.droppedCount > 0) {
      health.push({
        severity: 'info',
        text: `${walkthrough.droppedCount} console errors fired on tabs other than the recorded one`,
        atMs: null,
      })
    }
    health.push(...gapNotes)

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

    // --- vision curation ------------------------------------------------
    // Candidate frames are the uploaded keyframe images, each mapped to a global
    // time via its take's recording.json entry (matched on filename). Unmatched
    // frames sort last with a null time.
    const candidates: Candidate[] = []
    for (const file of walkthrough.files) {
      if (file.status !== 'uploaded' || !file.path.includes('/frames/')) continue
      if (!mediaTypeFor(file.path)) continue
      const takeIdx = takes.findIndex((t) => file.path.startsWith(`${t.dir}/`))
      let atMs: number | null = null
      let reason: string | null = null
      if (takeIdx >= 0) {
        const base = file.path.slice(file.path.lastIndexOf('/') + 1)
        const entry = recordings[takeIdx]!.frames.find(
          (fr) => fr.file.slice(fr.file.lastIndexOf('/') + 1) === base
        )
        if (entry) {
          atMs = offsets[takeIdx]! + entry.tMs
          reason = entry.reason ?? null
        }
      }
      candidates.push({
        path: file.path,
        key: walkthroughKey(space, walkthrough.id, file.path),
        atMs,
        reason,
      })
    }
    candidates.sort((a, b) => (a.atMs ?? Infinity) - (b.atMs ?? Infinity))
    const sampled = await prepareFrames(candidates)

    const narration = takes
      .flatMap((_, i) =>
        recordings[i]!.transcript.map((line) => `${mmss(offsets[i]! + line.tMs)} ${line.text}`)
      )
      .join('\n')
      .slice(0, MAX_NARRATION_CHARS)

    let keepers: Keeper[] = []
    if (sampled.length > 0) {
      await setStage('frames')
      keepers = await curateFrames(client, sampled, narration)
    }
    const curation: Curation | null =
      keepers.length === 0
        ? null
        : {
            frames: keepers.map((k) => ({ path: k.path, caption: k.caption, atMs: k.atMs })),
            excluded: [],
          }

    // --- synthesis ------------------------------------------------------
    const healthBlock = health
      .map((n) => `- (${n.severity}) ${n.atMs !== null ? `${mmss(n.atMs)} ` : ''}${n.text}`)
      .join('\n')
    const frameBlock = keepers
      .map((k) => `[${k.atMs !== null ? mmss(k.atMs) : '??:??'}] ${k.path} — ${k.caption}`)
      .join('\n')
    const body = [
      `Title: ${walkthrough.title}`,
      `Intent: ${walkthrough.intent ?? 'untagged'}`,
      `Recording length: ${Math.round(durationMs / 1000)}s`,
      instructions ? `Project instructions:\n${instructions}` : null,
      healthBlock ? `Capture-health notes:\n${healthBlock}` : null,
      frameBlock ? `Curated frames:\n${frameBlock}` : null,
      comments ? `Reviewer comments:\n${comments}` : null,
      `--- report.md ---\n${reportMd ?? '(none uploaded)'}`,
    ]
      .filter((part): part is string => part !== null)
      .join('\n\n')

    await setStage('writing')
    const message = await client.messages.create(
      {
        model: SYNTH_MODEL,
        max_tokens: SYNTH_MAX_TOKENS,
        system: SYNTH_SYSTEM,
        output_config: { format: { type: 'json_schema', schema: SYNTH_OUTPUT_SCHEMA } },
        messages: [{ role: 'user', content: body }],
      },
      { timeout: SYNTH_TIMEOUT_MS }
    )
    // Opus 5 can decline before or mid-answer; a refusal is a failure like any
    // other, handled by the outer catch.
    if (message.stop_reason === 'refusal') throw new Error('synthesis declined')
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
    const parsed = synthWireSchema.safeParse(JSON.parse(text))
    if (!parsed.success) throw new Error('synthesis returned an unusable shape')
    const synth = parsed.data

    // The structured spine: numbered in ledger order, stamps on the walkthrough clock.
    const points: KeyPoint[] = synth.key_points.map((p, i) => ({
      id: `kp${i + 1}`,
      title: p.title,
      detail: p.detail,
      severity: p.severity,
      atMs: p.at.trim() === '' ? null : parseStamp(p.at, durationMs),
    }))

    // Model-flagged comprehension notes join the deterministic ones; their m:ss
    // parses on the same clock, an empty `at` means no moment.
    const healthExtra: HealthNote[] = synth.health_extra.map((h) => ({
      severity: h.severity,
      text: h.text,
      atMs: h.at.trim() === '' ? null : parseStamp(h.at, durationMs),
    }))
    const healthJson: HealthNote[] = [...health, ...healthExtra]

    // Preserve any excluded spans a prior run (or the editor) recorded — this
    // pass only rebuilds the frame list.
    const priorExcluded = readExcluded(walkthrough.curationJson)
    const curationJson: Curation = {
      frames: curation?.frames ?? [],
      excluded: priorExcluded,
    }

    // Adopt the model's title only when the current one is a recorder default —
    // never overwrite a name a human already chose. When a human named it, the
    // model's title becomes a suggestion instead of a rewrite.
    const t = walkthrough.title.trim()
    const isDefaultTitle =
      /^\d{4}-\d{2}-\d{2}[-_ ]/.test(t) ||
      t === walkthrough.slug ||
      /^(session|recording|screen recording|walkthrough|untitled|new recording)( \d+)?$/i.test(t)

    await prisma.walkthrough.update({
      where: { id: walkthrough.id },
      data: {
        digestMd: synth.digest,
        pointsJson: points,
        summaryMd: synth.summary_md,
        refinedBriefMd: synth.brief_md,
        healthJson,
        curationJson,
        refineStatus: 'done',
        refineStage: null,
        refinedAt: new Date(),
        ...(isDefaultTitle
          ? { title: synth.title, suggestedTitle: null }
          : { suggestedTitle: synth.title !== walkthrough.title ? synth.title : null }),
      },
    })

    log.info(
      `[refine] refined "${walkthrough.title}" (${walkthrough.id}): ${points.length} key points, ${healthJson.length} notes, ${curationJson.frames.length} curated frames`
    )

    // Refined text is searchable; re-index off the fresh row.
    void indexWalkthrough(walkthrough.id)

    // A warn-level note is worth a heads-up to the uploader. notify.ts is added
    // by a sibling agent — import it lazily so this file compiles without it and
    // swallow if it's not there yet.
    if (healthJson.some((n) => n.severity === 'warn')) {
      try {
        const { notifyHealth } = await import('./notify')
        void notifyHealth(walkthrough.id)
      } catch (err) {
        log.warn(`[refine] notifyHealth unavailable: ${String(err)}`)
      }
    }
  } catch (err) {
    await prisma.walkthrough
      .update({ where: { id: walkthrough.id }, data: { refineStatus: 'failed', refineStage: null } })
      .catch(() => {})
    log.warn(`[refine] pass failed for ${walkthrough.id}: ${String(err)}`)
  }
}

/** Pull an existing curation's `excluded` spans out of the stored JSON, tolerating
 *  any earlier shape — the frame list is rebuilt, the spans are carried through. */
function readExcluded(value: unknown): Curation['excluded'] {
  const schema = z.array(
    z.object({ startMs: z.number(), endMs: z.number(), reason: z.string() }).passthrough()
  )
  if (value === null || typeof value !== 'object' || !('excluded' in value)) return []
  const parsed = schema.safeParse((value as { excluded: unknown }).excluded)
  if (!parsed.success) return []
  return parsed.data.map((s) => ({ startMs: s.startMs, endMs: s.endMs, reason: s.reason }))
}
