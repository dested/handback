// The structuring pass: one recorded ramble in, discrete tasks out.
//
// A ten-minute walkthrough usually gripes about four different things. An agent
// handed the whole recording fixes the first and calls it done. This pass reads
// what the recorder already wrote — report.md carries the transcript, the frame
// citations and the console errors — and proposes a split: N tasks, each with a
// title, a severity, repro steps, acceptance criteria, and the stretch of the
// recording it came from. A human confirms before any row is written
// (walkthroughs.applySplit); this module never touches the database.
//
// Same safety posture as polish.ts: every failure — no key, bad JSON, a
// refusal, a timeout — returns null and the caller reports "couldn't structure
// this one" without having spent anything but the metered call. Unlike polish
// this is a reasoning pass over a whole walkthrough, run on demand from the
// viewer, so it gets Opus rather than Haiku — depth matters here, per-minute
// cost does not.
//
// Opus 5 notes (they differ from the Haiku call in polish.ts): assistant
// prefill is not accepted (400), so the JSON shape is enforced with structured
// outputs (`output_config.format`) instead; thinking is on by default and the
// classifiers can decline a request outright — `stop_reason: 'refusal'` is
// checked before the content is read, and degrades to null like everything else.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { env } from './env'
import { log } from './logger'

const MODEL = 'claude-sonnet-5'
const REQUEST_TIMEOUT_MS = 120_000
const MAX_TASKS = 10
/** report.md for a long walkthrough is big but bounded; cap what we send anyway. */
const MAX_REPORT_CHARS = 80_000
const MAX_COMMENT_CHARS = 4_000

export function structureConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY)
}

/** One proposed task, validated. Times are ms on the walkthrough's output clock. */
export type ProposedTask = {
  title: string
  severity: 'low' | 'medium' | 'high'
  repro: string[]
  acceptance: string[]
  startMs: number | null
  endMs: number | null
}

// The wire shape the model is asked for. Times ride as "m:ss" strings — that is
// how the transcript inside report.md is stamped, so the model copies rather
// than computes; "" means the task has no clear window.
const wireTask = z.object({
  title: z.string().trim().min(1).max(200),
  severity: z.enum(['low', 'medium', 'high']),
  repro: z.array(z.string().trim().min(1).max(500)).max(10),
  acceptance: z.array(z.string().trim().min(1).max(500)).max(10),
  start: z.string().max(10),
  end: z.string().max(10),
})

const wireSchema = z.object({ tasks: z.array(wireTask).min(1).max(MAX_TASKS) })

/** The JSON Schema handed to structured outputs — same shape as `wireSchema`. */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'repro', 'acceptance', 'start', 'end'],
        properties: {
          title: { type: 'string', description: 'Imperative, specific, ≤ 80 chars' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          repro: {
            type: 'array',
            items: { type: 'string' },
            description: 'Steps to reproduce, from the narration and frames',
          },
          acceptance: {
            type: 'array',
            items: { type: 'string' },
            description: 'Checkable "done when" criteria',
          },
          start: {
            type: 'string',
            description:
              'Where in the recording this issue is shown, as m:ss copied from the transcript timestamps. Empty string if unclear.',
          },
          end: { type: 'string', description: 'End of that stretch, m:ss. Empty string if unclear.' },
        },
      },
    },
  },
} as const

const SYSTEM = `You split a recorded product walkthrough into discrete, actionable tasks for a coding agent.

You are given the walkthrough's report — it contains the narrator's transcript with m:ss timestamps, keyframe citations, and any console errors the page logged — plus reviewer comments when there are any.

Rules:
- One task per distinct issue the narrator raises. Do not merge unrelated complaints; do not invent issues the narrator never raised. If the whole recording is genuinely about one issue, return one task.
- Titles are imperative and specific ("Fix the coupon field rejecting valid codes"), never vague ("UI issues").
- Severity reflects the narrator's own framing and the visible breakage: high = broken/blocking, medium = wrong but survivable, low = polish.
- Repro steps come from what the narrator actually did on screen. Acceptance criteria are checkable statements of what "fixed" looks like.
- start/end are copied from the transcript timestamps bracketing where the issue is discussed. Use "" when no clear stretch exists.
- Keep the narrator's language for product nouns; do not rename their features.`

/** "m:ss" (or "mm:ss") → ms, clamped to the walkthrough; null for anything else. */
function parseStamp(stamp: string, durationMs: number): number | null {
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(stamp.trim())
  if (!m) return null
  const ms = (Number(m[1]) * 60 + Number(m[2])) * 1000
  return Math.min(ms, Math.max(0, durationMs))
}

export type StructureInput = {
  title: string
  durationMs: number
  reportMd: string
  /** Already-formatted comment lines ("[2:31] Sal: this dropdown too"). */
  comments: string[]
}

/**
 * Propose the split, or null if the pass couldn't run. Never throws for model
 * misbehavior — a refusal, unparseable JSON, or an empty answer all read as
 * "the pass has no proposal", and the caller words that for the human.
 */
export async function proposeStructure(input: StructureInput): Promise<ProposedTask[] | null> {
  if (!env.ANTHROPIC_API_KEY) return null

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const comments = input.comments.join('\n').slice(0, MAX_COMMENT_CHARS)
  const body = [
    `Walkthrough: ${input.title}`,
    `Recording length: ${Math.round(input.durationMs / 1000)}s`,
    comments ? `Reviewer comments:\n${comments}` : null,
    `--- report.md ---\n${input.reportMd.slice(0, MAX_REPORT_CHARS)}`,
  ]
    .filter((part): part is string => part !== null)
    .join('\n\n')

  try {
    const message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 8_000,
        system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        messages: [{ role: 'user', content: body }],
      },
      { timeout: REQUEST_TIMEOUT_MS }
    )
    // Opus 5's classifiers can decline before or mid-answer; content is then
    // empty or partial and must not be parsed as an answer.
    if (message.stop_reason === 'refusal') {
      log.warn('[structure] model declined the request')
      return null
    }
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
    const parsed = wireSchema.safeParse(JSON.parse(text))
    if (!parsed.success) {
      log.warn('[structure] model returned an unusable shape')
      return null
    }
    const tasks = parsed.data.tasks.map((t) => ({
      title: t.title,
      severity: t.severity,
      repro: t.repro,
      acceptance: t.acceptance,
      startMs: parseStamp(t.start, input.durationMs),
      endMs: parseStamp(t.end, input.durationMs),
    }))
    log.info(`[structure] proposed ${tasks.length} tasks for "${input.title}"`)
    return tasks
  } catch (err) {
    log.warn(`[structure] pass failed: ${String(err)}`)
    return null
  }
}

/** m:ss for the child brief — same clock the transcript and comments use. */
const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

/**
 * The child walkthrough's whole content: the task as markdown, ending with the
 * pointer at the parent — a child row carries no files, so the brief must say
 * where the evidence lives in words an agent will follow.
 */
export function childBriefMd(
  task: ProposedTask,
  parent: { id: string; title: string; slug: string }
): string {
  const lines: string[] = [`# ${task.title}`, '', `Severity: ${task.severity}`]
  if (task.startMs !== null) {
    const range =
      task.endMs !== null && task.endMs > task.startMs
        ? `${mmss(task.startMs)}–${mmss(task.endMs)}`
        : mmss(task.startMs)
    lines.push(`Shown at: ${range} of the source recording`)
  }
  if (task.repro.length > 0) {
    lines.push('', '## Steps to reproduce', ...task.repro.map((s, i) => `${i + 1}. ${s}`))
  }
  if (task.acceptance.length > 0) {
    lines.push('', '## Done when', ...task.acceptance.map((s) => `- ${s}`))
  }
  lines.push(
    '',
    '## Source',
    `Split from the walkthrough "${parent.title}" (${parent.slug}).`,
    `The full recording — frames, transcript, console errors — lives there: pull it with get_walkthrough("${parent.id}") if you need more context than this brief carries.`
  )
  return lines.join('\n')
}
