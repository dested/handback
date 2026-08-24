// The walkthrough agent: an Opus 5 tool loop the reviewer talks to on the viewer.
//
// A walkthrough is a narrated screen recording someone made for a coding agent.
// This module lets the human who owns it edit its DERIVED content by talking —
// the title, the summary ledger, the agent brief, transcript line text, which
// keyframes are curated, and which time spans are marked excluded. It never
// touches the video (excluded spans are markers only — nothing is re-encoded),
// the transcript timings, or the original uploaded report.md.
//
// Same provider posture as refine.ts/structure.ts (Opus 5, structured refusal
// handling), but a conversation rather than a single synthesis: real tools whose
// handlers mutate the row and S3, run in a bounded loop. The caller (router) has
// already authenticated, pro-gated and metered the reviewer — this module trusts
// the ids it is handed. It must never throw into the router: every failure ends
// as a persisted assistant message the viewer can render.

import Anthropic from '@anthropic-ai/sdk'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { spaceId } from './access'
import { env } from './env'
import { log } from './logger'
import { prisma } from './prisma'
import { indexWalkthrough } from './search'
import { deleteKeys, getObjectText, putObjectText, walkthroughKey } from './storage'
import type { Curation } from './refine'

const MODEL = 'claude-sonnet-5'
const MAX_TOKENS = 8_000
const REQUEST_TIMEOUT_MS = 120_000
const MAX_ITERATIONS = 12

/** Caps on what read_walkthrough hands the model, so one long recording can't
 *  blow the context: summary/brief are trimmed, the whole transcript is bounded. */
const READ_SUMMARY_CHARS = 20_000
const READ_BRIEF_CHARS = 40_000
const READ_TRANSCRIPT_CHARS = 30_000

export function agentConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY)
}

/** One applied tool call, for the transcript's meta line under an assistant turn. */
export type ChatAction = { action: string; detail: string }

// --- clock helpers --------------------------------------------------------

/** ms → m:ss on the walkthrough-wide clock the transcript and comments use. */
const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

/** A span label, en dash between the two stamps. */
const spanLabel = (startMs: number, endMs: number) => `${mmss(startMs)}–${mmss(endMs)}`

// --- recording.json (per take) --------------------------------------------
// Written by the recorder extension; parsed defensively. Reads tolerate a broken
// file (empty arrays); writes validate strictly and preserve every unknown field
// via passthrough, so rewriting a file only touches the parts a tool changed.

const recFrameSchema = z.object({ tMs: z.number(), file: z.string() }).passthrough()
const recLineSchema = z
  .object({ tMs: z.number(), endMs: z.number(), text: z.string() })
  .passthrough()
const recordingSchema = z
  .object({
    recording: z
      .object({
        frames: z.array(recFrameSchema),
        transcript: z.array(recLineSchema),
      })
      .passthrough(),
  })
  .passthrough()

type RecordingDoc = z.infer<typeof recordingSchema>

/** The take-relative frame file (`frames/03.jpg`) as a walkthrough-relative path
 *  (`rec-01/frames/03.jpg`). The recorder sometimes already writes the take dir
 *  into `file`, so normalize rather than blindly prefix. */
function framePath(dir: string, file: string): string {
  return file.startsWith(`${dir}/`) ? file : `${dir}/${file}`
}

// --- curation.json --------------------------------------------------------
// Same defensive read as refine.ts's readExcluded, extended to the frame list:
// any earlier shape degrades to an empty curation rather than throwing.

const curationReadSchema = z.object({
  frames: z
    .array(
      z.object({ path: z.string(), caption: z.string(), atMs: z.number().nullable() }).passthrough()
    )
    .catch([]),
  excluded: z
    .array(z.object({ startMs: z.number(), endMs: z.number(), reason: z.string() }).passthrough())
    .catch([]),
})

function readCuration(value: unknown): Curation {
  if (value === null || typeof value !== 'object') return { frames: [], excluded: [] }
  const parsed = curationReadSchema.safeParse(value)
  if (!parsed.success) return { frames: [], excluded: [] }
  return {
    frames: parsed.data.frames.map((f) => ({ path: f.path, caption: f.caption, atMs: f.atMs })),
    excluded: parsed.data.excluded.map((s) => ({
      startMs: s.startMs,
      endMs: s.endMs,
      reason: s.reason,
    })),
  }
}

// --- key points (Walkthrough.pointsJson) ----------------------------------
// Refine's key-point ledger. Read leniently for the model's payload; written
// strictly by update_key_points with ids assigned in order.

const keyPointReadSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    detail: z.string().catch(''),
    severity: z.enum(['high', 'medium', 'low']).catch('medium' as const),
    atMs: z.number().nullable().catch(null),
  })
)

type KeyPoint = z.infer<typeof keyPointReadSchema>[number]

function readKeyPoints(value: unknown): KeyPoint[] {
  const parsed = keyPointReadSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

// --- the loop's shared context -------------------------------------------
// Immutable for the life of one conversation: takes, offsets and the space never
// change under the tools (remove_span deletes frames, never takes). Everything
// mutable — title, summary, brief, curation, counts, the recording files — is
// re-read from the source of truth inside each handler.

type TakeCtx = { index: number; dir: string; durationMs: number; offsetMs: number }

type Ctx = {
  walkthroughId: string
  sid: string
  durationMs: number
  takes: TakeCtx[]
  projectName: string | null
}

/** A take's recording.json, tolerant of absence/corruption — for reads and for
 *  resolving a frame's time. */
async function readRecordingLenient(
  ctx: Ctx,
  dir: string
): Promise<{ frames: z.infer<typeof recFrameSchema>[]; transcript: z.infer<typeof recLineSchema>[] }> {
  try {
    const text = await getObjectText(walkthroughKey(ctx.sid, ctx.walkthroughId, `${dir}/recording.json`))
    const parsed = recordingSchema.safeParse(JSON.parse(text))
    if (!parsed.success) return { frames: [], transcript: [] }
    return { frames: parsed.data.recording.frames, transcript: parsed.data.recording.transcript }
  } catch {
    return { frames: [], transcript: [] }
  }
}

/** A take's recording.json for rewriting — throws if it can't be read/parsed, so
 *  a write tool reports the failure rather than silently dropping content. */
async function readRecordingForWrite(ctx: Ctx, dir: string): Promise<RecordingDoc> {
  const text = await getObjectText(walkthroughKey(ctx.sid, ctx.walkthroughId, `${dir}/recording.json`))
  const parsed = recordingSchema.safeParse(JSON.parse(text))
  if (!parsed.success) throw new Error(`${dir}/recording.json is not in the expected shape`)
  return parsed.data
}

// --- tool definitions -----------------------------------------------------

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_walkthrough',
    description:
      'Read the full current state of the walkthrough — title, intent, summary, digest, key points, brief, health notes, curation, and every take\'s transcript on the walkthrough-wide m:ss clock. Call this before your first edit in a conversation.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'update_title',
    description: 'Replace the walkthrough title.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['title'],
      properties: { title: { type: 'string', description: 'The new title, 1–300 chars' } },
    },
  },
  {
    name: 'update_summary',
    description: 'Replace the summary ledger (markdown).',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary_md'],
      properties: { summary_md: { type: 'string', description: 'The full replacement summary' } },
    },
  },
  {
    name: 'update_brief',
    description: 'Replace the agent brief (markdown). Keep its existing structure.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['brief_md'],
      properties: { brief_md: { type: 'string', description: 'The full replacement brief' } },
    },
  },
  {
    name: 'update_digest',
    description: 'Replace the human-facing digest (markdown).',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['digest_md'],
      properties: { digest_md: { type: 'string', description: 'The full replacement digest, 1–2000 chars' } },
    },
  },
  {
    name: 'update_key_points',
    description:
      'Replace the key-point ledger. Points are re-ordered as given and re-ided kp1, kp2, … Up to 12 points.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['points'],
      properties: {
        points: {
          type: 'array',
          description: '0–12 key points, in the order they should read',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'severity'],
            properties: {
              title: { type: 'string', description: 'Short point title, 1–200 chars' },
              detail: { type: 'string', description: 'Supporting detail, ≤300 chars' },
              severity: { type: 'string', enum: ['high', 'medium', 'low'] },
              at_ms: {
                type: ['integer', 'null'],
                description: 'Time on the walkthrough-wide clock in ms, or null if untimed',
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'edit_transcript_lines',
    description:
      'Rewrite the text of specific transcript lines in one take, addressed by the line index shown in read_walkthrough. Timings are never changed. Out-of-range indexes are reported back, not errors.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['take_dir', 'edits'],
      properties: {
        take_dir: { type: 'string', description: "The take's dir, e.g. rec-01" },
        edits: {
          type: 'array',
          description: '1–50 line edits',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['index', 'text'],
            properties: {
              index: { type: 'integer', description: 'The line index within this take' },
              text: { type: 'string', description: 'The replacement line text' },
            },
          },
        },
      },
    },
  },
  {
    name: 'remove_span',
    description:
      'Mark a time span (on the walkthrough-wide clock) as excluded: strike its transcript lines, delete the keyframes inside it, and record the span as excluded. The video itself is not re-encoded.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['start_ms', 'end_ms', 'reason'],
      properties: {
        start_ms: { type: 'integer', description: 'Span start in ms on the walkthrough clock' },
        end_ms: { type: 'integer', description: 'Span end in ms; must be greater than start' },
        reason: { type: 'string', description: 'Why this span is being removed, 1–200 chars' },
      },
    },
  },
  {
    name: 'set_curated_frames',
    description:
      'Replace the set of curated keyframes. Each path must be an uploaded keyframe file (its path contains /frames/). Excluded spans are preserved. 0–24 frames.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['frames'],
      properties: {
        frames: {
          type: 'array',
          description: '0–24 curated frames',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'caption'],
            properties: {
              path: { type: 'string', description: 'Walkthrough-relative frame path' },
              caption: { type: 'string', description: 'One-line caption, 1–300 chars' },
            },
          },
        },
      },
    },
  },
]

// --- tool input schemas ---------------------------------------------------

const titleInput = z.object({ title: z.string().trim().min(1).max(300) })
const summaryInput = z.object({ summary_md: z.string().max(30_000) })
const briefInput = z.object({ brief_md: z.string().max(60_000) })
const digestInput = z.object({ digest_md: z.string().trim().min(1).max(2_000) })
const keyPointsInput = z.object({
  points: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        detail: z.string().max(300).default(''),
        severity: z.enum(['high', 'medium', 'low']),
        at_ms: z.number().int().nullable().default(null),
      })
    )
    .max(12),
})
const editLinesInput = z.object({
  take_dir: z.string().min(1),
  edits: z
    .array(z.object({ index: z.number().int().min(0), text: z.string().max(2_000) }))
    .min(1)
    .max(50),
})
const removeSpanInput = z.object({
  start_ms: z.number().int().min(0),
  end_ms: z.number().int(),
  reason: z.string().trim().min(1).max(200),
})
const curatedInput = z.object({
  frames: z.array(z.object({ path: z.string().min(1), caption: z.string().trim().min(1).max(300) })).max(24),
})

// --- tool result ----------------------------------------------------------

/** What a handler returns: the JSON tool_result text, and — for a mutating call
 *  that succeeded — the action to surface. Read tools return no action. */
type ToolOutcome = { content: string; action?: ChatAction }

/** Append one row to the append-only revision log. Concrete `detail` per call so
 *  Prisma's Json typing validates the shape at the call site. */
async function logRevision(
  walkthroughId: string,
  action: string,
  detail: Prisma.InputJsonValue
): Promise<void> {
  await prisma.walkthroughRevision.create({
    data: { walkthroughId, authorName: 'assistant', action, detail },
  })
}

async function runTool(ctx: Ctx, name: string, rawInput: unknown): Promise<ToolOutcome> {
  switch (name) {
    case 'read_walkthrough':
      return { content: await readWalkthroughTool(ctx) }
    case 'update_title':
      return updateTitleTool(ctx, rawInput)
    case 'update_summary':
      return updateSummaryTool(ctx, rawInput)
    case 'update_brief':
      return updateBriefTool(ctx, rawInput)
    case 'update_digest':
      return updateDigestTool(ctx, rawInput)
    case 'update_key_points':
      return updateKeyPointsTool(ctx, rawInput)
    case 'edit_transcript_lines':
      return editTranscriptLinesTool(ctx, rawInput)
    case 'remove_span':
      return removeSpanTool(ctx, rawInput)
    case 'set_curated_frames':
      return setCuratedFramesTool(ctx, rawInput)
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

async function readWalkthroughTool(ctx: Ctx): Promise<string> {
  const wt = await prisma.walkthrough.findUnique({
    where: { id: ctx.walkthroughId },
    select: {
      title: true,
      intent: true,
      summaryMd: true,
      digestMd: true,
      pointsJson: true,
      refinedBriefMd: true,
      healthJson: true,
      curationJson: true,
    },
  })
  if (!wt) throw new Error('walkthrough not found')

  // Transcript, numbered per take on the global clock, bounded overall.
  const transcript: Record<string, string[]> = {}
  let transcriptChars = 0
  let transcriptTruncated = false
  for (const take of ctx.takes) {
    const rec = await readRecordingLenient(ctx, take.dir)
    const lines: string[] = []
    for (let i = 0; i < rec.transcript.length; i++) {
      if (transcriptTruncated) break
      const line = rec.transcript[i]!
      const rendered = `${i} [${mmss(take.offsetMs + line.tMs)}] ${line.text}`
      if (transcriptChars + rendered.length > READ_TRANSCRIPT_CHARS) {
        transcriptTruncated = true
        break
      }
      transcriptChars += rendered.length + 1
      lines.push(rendered)
    }
    transcript[take.dir] = lines
  }

  const commentRows = await prisma.walkthroughComment.findMany({
    where: { walkthroughId: ctx.walkthroughId },
    orderBy: { createdAt: 'asc' },
  })
  const comments = commentRows.map((c) =>
    c.atMs !== null ? `[${mmss(c.atMs)}] ${c.authorName}: ${c.text}` : `${c.authorName}: ${c.text}`
  )

  const out = {
    title: wt.title,
    intent: wt.intent ?? null,
    project: ctx.projectName,
    durationMs: ctx.durationMs,
    summaryMd: wt.summaryMd ? wt.summaryMd.slice(0, READ_SUMMARY_CHARS) : null,
    digestMd: wt.digestMd ? wt.digestMd.slice(0, READ_SUMMARY_CHARS) : null,
    // id, severity, m:ss (null when untimed), title, detail — the ledger the
    // reviewer and coding agents read.
    keyPoints: readKeyPoints(wt.pointsJson).map((p) => ({
      id: p.id,
      severity: p.severity,
      at: p.atMs === null ? null : mmss(p.atMs),
      title: p.title,
      detail: p.detail,
    })),
    briefMd: wt.refinedBriefMd ? wt.refinedBriefMd.slice(0, READ_BRIEF_CHARS) : null,
    health: wt.healthJson ?? [],
    curation: readCuration(wt.curationJson),
    takes: ctx.takes.map((t) => ({
      index: t.index,
      dir: t.dir,
      durationMs: t.durationMs,
      offsetMs: t.offsetMs,
    })),
    transcript,
    transcriptTruncated,
    comments,
  }
  return JSON.stringify(out)
}

async function updateTitleTool(ctx: Ctx, rawInput: unknown): Promise<ToolOutcome> {
  const { title } = titleInput.parse(rawInput)
  await prisma.walkthrough.update({ where: { id: ctx.walkthroughId }, data: { title } })
  await logRevision(ctx.walkthroughId, 'update_title', { title })
  return {
    content: JSON.stringify({ ok: true }),
    action: { action: 'update_title', detail: `title → "${title}"` },
  }
}

async function updateSummaryTool(ctx: Ctx, rawInput: unknown): Promise<ToolOutcome> {
  const { summary_md } = summaryInput.parse(rawInput)
  await prisma.walkthrough.update({
    where: { id: ctx.walkthroughId },
    data: { summaryMd: summary_md },
  })
  await logRevision(ctx.walkthroughId, 'update_summary', { summary_md })
  return {
    content: JSON.stringify({ ok: true }),
    action: { action: 'update_summary', detail: 'summary rewritten' },
  }
}

async function updateBriefTool(ctx: Ctx, rawInput: unknown): Promise<ToolOutcome> {
  const { brief_md } = briefInput.parse(rawInput)
  await prisma.walkthrough.update({
    where: { id: ctx.walkthroughId },
    data: { refinedBriefMd: brief_md },
  })
  await logRevision(ctx.walkthroughId, 'update_brief', { brief_md })
  return {
    content: JSON.stringify({ ok: true }),
    action: { action: 'update_brief', detail: 'brief rewritten' },
  }
}

async function updateDigestTool(ctx: Ctx, rawInput: unknown): Promise<ToolOutcome> {
  const { digest_md } = digestInput.parse(rawInput)
  await prisma.walkthrough.update({
    where: { id: ctx.walkthroughId },
    data: { digestMd: digest_md },
  })
  await logRevision(ctx.walkthroughId, 'update_digest', { digest_md })
  return {
    content: JSON.stringify({ ok: true }),
    action: { action: 'update_digest', detail: 'digest rewritten' },
  }
}

async function updateKeyPointsTool(ctx: Ctx, rawInput: unknown): Promise<ToolOutcome> {
  const { points } = keyPointsInput.parse(rawInput)
  // Ids are assigned in order — kp1 is the first point, and so on.
  const nextPoints: KeyPoint[] = points.map((p, i) => ({
    id: `kp${i + 1}`,
    title: p.title,
    detail: p.detail,
    severity: p.severity,
    atMs: p.at_ms,
  }))
  await prisma.walkthrough.update({
    where: { id: ctx.walkthroughId },
    data: { pointsJson: nextPoints },
  })
  await logRevision(ctx.walkthroughId, 'update_key_points', { points })
  return {
    content: JSON.stringify({ set: nextPoints.length }),
    action: {
      action: 'update_key_points',
      detail: `set ${nextPoints.length} key point${nextPoints.length === 1 ? '' : 's'}`,
    },
  }
}

async function editTranscriptLinesTool(ctx: Ctx, rawInput: unknown): Promise<ToolOutcome> {
  const { take_dir, edits } = editLinesInput.parse(rawInput)
  const take = ctx.takes.find((t) => t.dir === take_dir)
  if (!take) throw new Error(`no take with dir "${take_dir}"`)

  const doc = await readRecordingForWrite(ctx, take_dir)
  const lines = doc.recording.transcript
  const skipped: number[] = []
  let edited = 0
  for (const edit of edits) {
    const line = lines[edit.index]
    if (!line) {
      skipped.push(edit.index)
      continue
    }
    // Timings are never touched — only the spoken text is rewritten.
    line.text = edit.text
    edited++
  }
  await putObjectText(
    walkthroughKey(ctx.sid, ctx.walkthroughId, `${take_dir}/recording.json`),
    JSON.stringify(doc)
  )
  await logRevision(ctx.walkthroughId, 'edit_transcript_lines', { take_dir, edits })
  return {
    content: JSON.stringify({ edited, skipped }),
    action: {
      action: 'edit_transcript_lines',
      detail: `edited ${edited} line${edited === 1 ? '' : 's'} in ${take_dir}${
        skipped.length ? ` (${skipped.length} skipped)` : ''
      }`,
    },
  }
}

async function removeSpanTool(ctx: Ctx, rawInput: unknown): Promise<ToolOutcome> {
  const { start_ms, end_ms, reason } = removeSpanInput.parse(rawInput)
  if (end_ms <= start_ms) throw new Error('end_ms must be greater than start_ms')
  const clampedStart = Math.max(0, Math.min(start_ms, ctx.durationMs))
  const clampedEnd = Math.max(0, Math.min(end_ms, ctx.durationMs))
  if (clampedEnd <= clampedStart) throw new Error('the span is empty after clamping to the recording')

  let linesRemoved = 0
  const removedPaths: string[] = []

  for (const take of ctx.takes) {
    const takeStart = take.offsetMs
    const takeEnd = take.offsetMs + take.durationMs
    // Intersection of the requested span with this take, in the take's local clock.
    const localStart = Math.max(clampedStart, takeStart) - takeStart
    const localEnd = Math.min(clampedEnd, takeEnd) - takeStart
    if (localEnd <= localStart) continue

    const doc = await readRecordingForWrite(ctx, take.dir)
    const rec = doc.recording

    const keptLines = rec.transcript.filter((line) => {
      const mid = (line.tMs + line.endMs) / 2
      const inSpan = mid >= localStart && mid <= localEnd
      if (inSpan) linesRemoved++
      return !inSpan
    })
    const keptFrames = rec.frames.filter((frame) => {
      const inSpan = frame.tMs >= localStart && frame.tMs <= localEnd
      if (inSpan) removedPaths.push(framePath(take.dir, frame.file))
      return !inSpan
    })

    if (keptLines.length !== rec.transcript.length || keptFrames.length !== rec.frames.length) {
      rec.transcript = keptLines
      rec.frames = keptFrames
      await putObjectText(
        walkthroughKey(ctx.sid, ctx.walkthroughId, `${take.dir}/recording.json`),
        JSON.stringify(doc)
      )
    }
  }

  // Delete the frame rows + objects and fix the counts EXACTLY as
  // walkthroughs.deleteFrames does: rows first, per-dir take decrement,
  // walkthrough counts floored at 0, S3 delete last.
  const current = await prisma.walkthrough.findUnique({
    where: { id: ctx.walkthroughId },
    select: { frameCount: true, bytes: true, curationJson: true },
  })
  if (!current) throw new Error('walkthrough not found')

  const framesRemoved = removedPaths.length
  if (framesRemoved > 0) {
    const files = await prisma.walkthroughFile.findMany({
      where: { walkthroughId: ctx.walkthroughId, path: { in: removedPaths }, status: 'uploaded' },
    })
    if (files.length > 0) {
      await prisma.walkthroughFile.deleteMany({ where: { id: { in: files.map((f) => f.id) } } })
      const byDir = new Map<string, number>()
      for (const f of files) {
        const dir = f.path.split('/')[0] ?? ''
        byDir.set(dir, (byDir.get(dir) ?? 0) + 1)
      }
      for (const [dir, n] of byDir) {
        await prisma.take.updateMany({
          where: { walkthroughId: ctx.walkthroughId, dir, frameCount: { gte: n } },
          data: { frameCount: { decrement: n } },
        })
      }
      const bytesFreed = files.reduce((n, f) => n + f.size, 0)
      const bytes = current.bytes - BigInt(bytesFreed)
      await prisma.walkthrough.update({
        where: { id: ctx.walkthroughId },
        data: {
          frameCount: Math.max(0, current.frameCount - files.length),
          bytes: bytes < 0n ? 0n : bytes,
        },
      })
      await deleteKeys(files.map((f) => walkthroughKey(ctx.sid, ctx.walkthroughId, f.path)))
    }
  }

  // Curation: drop curated frames whose object was deleted or whose time falls in
  // the span; append the span to excluded, keeping prior spans.
  const removedSet = new Set(removedPaths)
  const curation = readCuration(current.curationJson)
  const nextCuration: Curation = {
    frames: curation.frames.filter(
      (f) =>
        !removedSet.has(f.path) &&
        !(f.atMs !== null && f.atMs >= clampedStart && f.atMs <= clampedEnd)
    ),
    excluded: [...curation.excluded, { startMs: clampedStart, endMs: clampedEnd, reason }],
  }
  await prisma.walkthrough.update({
    where: { id: ctx.walkthroughId },
    data: { curationJson: nextCuration },
  })

  await logRevision(ctx.walkthroughId, 'remove_span', { start_ms, end_ms, reason })
  const label = spanLabel(clampedStart, clampedEnd)
  return {
    content: JSON.stringify({ linesRemoved, framesRemoved, span: label }),
    action: {
      action: 'remove_span',
      detail: `removed ${label} (${linesRemoved} line${linesRemoved === 1 ? '' : 's'}, ${framesRemoved} frame${
        framesRemoved === 1 ? '' : 's'
      })`,
    },
  }
}

async function setCuratedFramesTool(ctx: Ctx, rawInput: unknown): Promise<ToolOutcome> {
  const { frames } = curatedInput.parse(rawInput)

  const uploaded = await prisma.walkthroughFile.findMany({
    where: { walkthroughId: ctx.walkthroughId, status: 'uploaded' },
    select: { path: true },
  })
  const validPaths = new Set(uploaded.filter((f) => f.path.includes('/frames/')).map((f) => f.path))

  // recording.json per take is read at most once while resolving times.
  const recCache = new Map<string, Awaited<ReturnType<typeof readRecordingLenient>>>()
  const resolveAtMs = async (path: string): Promise<number | null> => {
    const take = ctx.takes.find((t) => path.startsWith(`${t.dir}/`))
    if (!take) return null
    let rec = recCache.get(take.dir)
    if (!rec) {
      rec = await readRecordingLenient(ctx, take.dir)
      recCache.set(take.dir, rec)
    }
    const base = path.slice(path.lastIndexOf('/') + 1)
    const entry = rec.frames.find((fr) => fr.file.slice(fr.file.lastIndexOf('/') + 1) === base)
    return entry ? take.offsetMs + entry.tMs : null
  }

  const nextFrames: Curation['frames'] = []
  let skipped = 0
  for (const frame of frames) {
    if (!validPaths.has(frame.path)) {
      skipped++
      continue
    }
    nextFrames.push({ path: frame.path, caption: frame.caption, atMs: await resolveAtMs(frame.path) })
  }

  const current = await prisma.walkthrough.findUnique({
    where: { id: ctx.walkthroughId },
    select: { curationJson: true },
  })
  const excluded = readCuration(current?.curationJson ?? null).excluded
  const nextCuration: Curation = { frames: nextFrames, excluded }
  await prisma.walkthrough.update({
    where: { id: ctx.walkthroughId },
    data: { curationJson: nextCuration },
  })

  await logRevision(ctx.walkthroughId, 'set_curated_frames', { frames })
  return {
    content: JSON.stringify({ set: nextFrames.length, skipped }),
    action: {
      action: 'set_curated_frames',
      detail: `curated ${nextFrames.length} frame${nextFrames.length === 1 ? '' : 's'}${
        skipped ? ` (${skipped} skipped)` : ''
      }`,
    },
  }
}

// --- the conversation -----------------------------------------------------

const SYSTEM = `You are the walkthrough assistant inside Handback. A walkthrough is a narrated screen recording a person made for a coding agent; you are talking to the REVIEWER who owns it, and you hold real tools over its content.
What you can change: the title, the summary ledger, the digest, the key points, the agent brief, transcript line text, which keyframes are curated, and which time spans are excluded from the result. What you can never change: the video itself (excluded spans are markers — the video is not re-encoded), transcript timings, or the original uploaded report.md.
The digest and key points are the human-facing read of the recording and drive what coding agents answer, so keep every edit to them faithful to what the narrator actually said and showed.
Rules:
- Act, then report. When the request is clear, apply it with tools in this turn and answer with one terse paragraph of what you changed. Ask a question only when genuinely ambiguous.
- Read before you write: call read_walkthrough before your first edit of a conversation.
- Corrections are the reviewer's authority — if they say 'when I said X I meant Y', fix the transcript lines and then update the brief and summary so all three agree.
- Removing a section = remove_span: it strikes the transcript lines and deletes the keyframes in that span and marks the span excluded. Use the reviewer's described boundaries; when they name a topic rather than times, find the span in the transcript first.
- Never invent content the narrator didn't say or show. Keep the narrator's product nouns.
- Keep summaries terse but complete; keep the brief in the same structure it already has.`

const FALLBACK_REPLY = 'Done.'
const CRASH_REPLY =
  'Something went wrong applying that — I stopped without finishing. Nothing beyond the actions listed was changed.'

/**
 * One conversational turn against the walkthrough agent. Persists the reviewer's
 * message first (so it survives a crash mid-turn), runs the bounded tool loop,
 * then persists the assistant's reply with the actions it applied. Never throws
 * into the router: any failure resolves to a persisted assistant message.
 */
export async function runWalkthroughChat(input: {
  walkthroughId: string
  userId: string
  userName: string
  message: string
}): Promise<{ reply: string; actions: ChatAction[] }> {
  // The reviewer's message lands first and unconditionally — a crash in the loop
  // must not lose what they asked for.
  const userRow = await prisma.walkthroughChat.create({
    data: { walkthroughId: input.walkthroughId, userId: input.userId, role: 'user', content: input.message },
  })

  const actions: ChatAction[] = []
  try {
    log.info(`[agent] chat on ${input.walkthroughId} from ${input.userName}`)

    const wt = await prisma.walkthrough.findUnique({
      where: { id: input.walkthroughId },
      include: {
        takes: { orderBy: { index: 'asc' } },
        project: { select: { name: true } },
      },
    })
    if (!wt) throw new Error('walkthrough not found')

    // Each take's global offset is the sum of every earlier take's duration.
    const takes: TakeCtx[] = []
    let acc = 0
    for (const take of wt.takes) {
      takes.push({ index: take.index, dir: take.dir, durationMs: take.durationMs, offsetMs: acc })
      acc += take.durationMs
    }
    const ctx: Ctx = {
      walkthroughId: wt.id,
      sid: spaceId({ teamId: wt.teamId, userId: wt.userId }),
      durationMs: wt.durationMs,
      takes,
      projectName: wt.project?.name ?? null,
    }

    // History: the last 30 turns before this one, oldest first, text only.
    const history = await prisma.walkthroughChat.findMany({
      where: { walkthroughId: input.walkthroughId, id: { not: userRow.id } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    })
    const messages: Anthropic.MessageParam[] = history
      .reverse()
      .map((row) => ({
        role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: row.content,
      }))
    // A 30-row slice can begin mid-exchange on an assistant turn; the API rejects
    // a leading assistant message, so drop any before the first user turn.
    while (messages.length > 0 && messages[0]!.role === 'assistant') messages.shift()
    messages.push({ role: 'user', content: input.message })

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    let mutated = false
    let reply = ''

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const response = await client.messages.create(
        { model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM, tools: TOOLS, messages },
        { timeout: REQUEST_TIMEOUT_MS }
      )

      // A refusal ends the turn with a fixed reply — content is not an answer.
      if (response.stop_reason === 'refusal') {
        reply = "I can't help with that."
        break
      }

      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('')

      if (response.stop_reason !== 'tool_use') {
        reply = text
        break
      }

      // Preserve the assistant turn verbatim (thinking blocks included) so the
      // follow-up carrying tool results is a valid continuation.
      messages.push({ role: 'assistant', content: response.content })

      const toolUses = response.content.flatMap((block) =>
        block.type === 'tool_use' ? [block] : []
      )
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const use of toolUses) {
        try {
          const outcome = await runTool(ctx, use.name, use.input)
          results.push({ type: 'tool_result', tool_use_id: use.id, content: outcome.content })
          if (outcome.action) {
            actions.push(outcome.action)
            mutated = true
          }
        } catch (err) {
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: err instanceof Error ? err.message : String(err),
            is_error: true,
          })
        }
      }
      messages.push({ role: 'user', content: results })
    }

    // Refined text (summary/brief) is searchable; re-index off the fresh row.
    if (mutated) void indexWalkthrough(input.walkthroughId)

    const finalReply = reply.trim() || FALLBACK_REPLY
    await prisma.walkthroughChat.create({
      data: {
        walkthroughId: input.walkthroughId,
        userId: null,
        role: 'assistant',
        content: finalReply,
        actions,
      },
    })
    return { reply: finalReply, actions }
  } catch (err) {
    log.warn(`[agent] chat failed for ${input.walkthroughId}: ${String(err)}`)
    await prisma.walkthroughChat
      .create({
        data: {
          walkthroughId: input.walkthroughId,
          userId: null,
          role: 'assistant',
          content: CRASH_REPLY,
          actions,
        },
      })
      .catch(() => {})
    return { reply: CRASH_REPLY, actions }
  }
}
