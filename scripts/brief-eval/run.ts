// Old brief vs new brief, measured. The same narrated walkthrough goes to Opus
// 5.5 twice: once as the agent brief read before 2026-10-15 (the v1 recorder's
// files, Refine's working brief standing in for the report, presigned URLs to
// fetch) and once as it reads now (the v2 files, the report rebuilt from
// recording.json, key points with their evidence, get_images/get_file). Each
// run ends in the agent's written understanding; grade those by hand against
// the walkthrough's planted complaints.
//
// Everything runs on production code: Refine's prompt and request, the brief
// writers, the evidence-set and image helpers. The old condition runs the
// snapshots `old-format.ts` and `old-refine.ts` (as of 2333867). What it skips:
// Haiku frame curation (in both), the database, S3.
//
// From the repo root, so bun loads .env (ANTHROPIC_API_KEY):
//   bun scripts/brief-eval/run.ts --fixture <dir with v1/ and v2/> --out <dir> [--stage refine|agent] [--cond old|new] [--runs 3] [--from 1]
// `refine` writes refine-*.json and brief-*.txt (one Sonnet call per condition, cached in --out);
// `agent` runs the Opus loop for runs from..from+runs-1 in each condition (or just --cond).

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { Recording } from '@dested/video-to-prompt'
import { z } from 'zod'
import {
  FULL_EDGE,
  INLINE_EDGE,
  briefFromRecordings,
  evidenceImages,
  imageForAgent,
  imageLabel,
  recordingFromJson,
  type RecordingBrief,
} from '../../server/brief'
import { env } from '../../server/env'
import {
  FRAMES_PAGE_DEFAULT,
  TOOL_DESCRIPTIONS,
  fileContent,
  formatWalkthrough,
  imagesContent,
  type ToolContent,
} from '../../server/mcp-format'
import {
  SYNTH_FRAMES,
  SYNTH_MAX_TOKENS,
  SYNTH_MODEL,
  SYNTH_OUTPUT_SCHEMA,
  SYNTH_SYSTEM,
  synthContent,
  synthFrameLabel,
  synthWireSchema,
} from '../../server/refine'
import { formatWalkthrough as formatOld } from './old-format'
import { OLD_SYNTH_SYSTEM } from './old-refine'

// ── setup ──────────────────────────────────────────────────────────────────

const AGENT_MODEL = 'claude-opus-5-5'
/** $ per million tokens, input / output. */
const PRICE: Record<string, [number, number]> = {
  [AGENT_MODEL]: [4, 20],
  [SYNTH_MODEL]: [2, 10],
}
const MAX_TURNS = 16

const ID = 'cmgeval0fixture000001'
const SLUG = '2026-10-15-1402-recording'
/** A recorder default, so Refine's title is adopted as in production. */
const RECORDER_TITLE = '2026-10-15 14:02'
const RECORDED_AT = '2026-10-15T19:02:00.000Z'
const SCOPE =
  ' This is a platform-admin token: it spans EVERY space on this Handback, not just its owner’s — read the `space` field on each walkthrough before acting.'

const SYSTEM =
  "You are Claude Code, Anthropic's CLI for Claude, working with a developer on their software. Handback's MCP tools are connected: Handback is how the developer hands you narrated screen recordings of their running app."
const ASK = `Pick up Handback walkthrough ${ID}. I don't have the repo open in this session, so no code yet: tell me what you understand. List every problem I raised, what the screen actually shows for each (cite the frame paths you looked at), and anything you're unsure of.`

type Cond = 'old' | 'new'
const CONDS: Cond[] = ['old', 'new']
const DIR: Record<Cond, string> = { old: 'v1', new: 'v2' }

function args() {
  const get = (name: string) => {
    const at = process.argv.indexOf(`--${name}`)
    return at >= 0 ? process.argv[at + 1] : undefined
  }
  const fixture = get('fixture')
  const out = get('out')
  if (!fixture || !out) throw new Error('usage: --fixture <dir> --out <dir>')
  const stage = get('stage')
  const only = get('cond')
  return {
    fixture,
    out,
    stage: stage === 'refine' || stage === 'agent' ? stage : 'all',
    runs: Number(get('runs') ?? 1),
    from: Number(get('from') ?? 1),
    conds: CONDS.filter((c) => only === undefined || c === only),
  }
}

const apiKey = env.ANTHROPIC_API_KEY
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env')
const client = new Anthropic({ apiKey })

// ── the walkthrough's files ────────────────────────────────────────────────

type StoredFile = { path: string; size: number; contentType: string; abs: string }

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  md: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  webm: 'video/webm',
  mp4: 'video/mp4',
}

async function listFiles(root: string, rel = ''): Promise<StoredFile[]> {
  const out: StoredFile[] = []
  for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      out.push(...(await listFiles(root, path)))
      continue
    }
    const abs = join(root, path)
    const ext = entry.name.slice(entry.name.lastIndexOf('.') + 1)
    const bytes = await readFile(abs)
    out.push({
      path,
      size: bytes.length,
      contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
      abs,
    })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** A presigned R2 URL as long as the real ones, mapped back to the file by fetch_url. */
function presign(path: string): string {
  const sig = createHash('sha256').update(path).digest('hex')
  return (
    `https://handback-files.4f1c0de2a7b9e3d5c6f8a1b2c3d4e5f6.r2.cloudflarestorage.com/spaces/u_eval/walkthroughs/${ID}/${path}` +
    `?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD` +
    `&X-Amz-Credential=8c2e5f1a9b3d7c4e6f0a2b8d1c3e5f7a%2F20261015%2Fauto%2Fs3%2Faws4_request` +
    `&X-Amz-Date=20261015T190500Z&X-Amz-Expires=3600&X-Amz-Signature=${sig}&X-Amz-SignedHeaders=host&x-id=GetObject`
  )
}

const isImage = (f: StoredFile) => f.contentType.startsWith('image/')
const isFrame = (f: StoredFile) => /\/frames\/[^/]+$/.test(f.path)
const isText = (f: StoredFile) =>
  f.contentType.startsWith('text/') || f.contentType === 'application/json'

// ── refine (Sonnet, once per condition) ────────────────────────────────────

type Synth = z.infer<typeof synthWireSchema>
type Usage = { input: number; output: number; costUsd: number }

function usageOf(model: string, u: Anthropic.Usage): Usage {
  const [inPrice, outPrice] = PRICE[model] ?? [0, 0]
  const input =
    u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  return {
    input,
    output: u.output_tokens,
    costUsd: (input * inPrice + u.output_tokens * outPrice) / 1e6,
  }
}

type Fixture = {
  cond: Cond
  root: string
  files: StoredFile[]
  recordings: Recording[]
  durationMs: number
}

async function loadFixture(fixtureDir: string, cond: Cond): Promise<Fixture> {
  const root = join(fixtureDir, DIR[cond])
  const files = await listFiles(root)
  const recording = recordingFromJson(
    await readFile(join(root, 'rec-01/recording.json'), 'utf8'),
    1
  )
  if (!recording) throw new Error(`${root}/rec-01/recording.json is not a recording`)
  return { cond, root, files, recordings: [recording], durationMs: recording.meta.durationMs }
}

const briefInput = (
  fx: Fixture,
  title: string,
  points: Array<{ id: string; atMs: number | null }>
) => ({
  id: ID,
  title,
  slug: SLUG,
  origin: null,
  recordedAt: new Date(RECORDED_AT),
  takes: [{ index: 1, dir: 'rec-01', videoPath: 'rec-01/walkthrough.webm' }],
  curation: { frames: [], excluded: [] },
  points,
})

/** The body runRefine builds, minus what this walkthrough doesn't have (health notes, curated frames, comments, project instructions). */
const refineBody = (fx: Fixture, report: string) =>
  [
    `Title: ${RECORDER_TITLE}`,
    'Intent: bug',
    `Recording length: ${Math.round(fx.durationMs / 1000)}s`,
    `--- report.md ---\n${report}`,
  ].join('\n\n')

/**
 * What Refine was sent. Before: the old prompt and the uploaded report.md.
 * Now: the rebuilt report, with its Start here frames as images.
 */
async function refineRequest(
  fx: Fixture
): Promise<{ system: string; content: string | Anthropic.ContentBlockParam[] }> {
  if (fx.cond === 'old') {
    const report = await readFile(join(fx.root, 'report.md'), 'utf8')
    return { system: OLD_SYNTH_SYSTEM, content: refineBody(fx, report) }
  }
  const rebuilt = briefFromRecordings(briefInput(fx, RECORDER_TITLE, []), fx.recordings)
  const frames = await Promise.all(
    rebuilt.startHere.slice(0, SYNTH_FRAMES).map(async (f) => {
      const { data } = await imageForAgent(await readFile(join(fx.root, f.path)), INLINE_EDGE)
      return { label: synthFrameLabel(f), data }
    })
  )
  return {
    system: SYNTH_SYSTEM,
    content: synthContent(refineBody(fx, rebuilt.recordingMd), frames),
  }
}

async function refine(fx: Fixture, out: string): Promise<{ synth: Synth; usage: Usage | null }> {
  const cached = join(out, `refine-${fx.cond}.json`)
  const prior = await readFile(cached, 'utf8').catch(() => null)
  if (prior !== null) return { synth: synthWireSchema.parse(JSON.parse(prior)), usage: null }

  const { system, content } = await refineRequest(fx)
  const message = await client.messages.create({
    model: SYNTH_MODEL,
    max_tokens: SYNTH_MAX_TOKENS,
    system,
    output_config: { format: { type: 'json_schema', schema: SYNTH_OUTPUT_SCHEMA } },
    messages: [{ role: 'user', content }],
  })
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  const synth = synthWireSchema.parse(JSON.parse(text))
  await writeFile(cached, JSON.stringify(synth, null, 2))
  return { synth, usage: usageOf(SYNTH_MODEL, message.usage) }
}

/** m:ss on the walkthrough clock, as Refine's parseStamp reads it. */
function stampMs(at: string, durationMs: number): number | null {
  const m = /^(\d+):(\d{2})$/.exec(at.trim())
  if (!m) return null
  const ms = (Number(m[1]) * 60 + Number(m[2])) * 1000
  return ms <= durationMs + 1000 ? ms : null
}

// ── the two briefs ─────────────────────────────────────────────────────────

type Condition = {
  fx: Fixture
  brief: string
  rebuilt: RecordingBrief | null
  points: Array<{ id: string }>
  tools: Anthropic.Tool[]
}

const idSchema = { walkthroughId: z.string() }
const ID_PROP = {
  walkthroughId: { type: 'string', description: 'Walkthrough id from list_walkthroughs' },
}

function framesTool(description: string): Anthropic.Tool {
  return {
    name: 'get_frames',
    description: description + SCOPE,
    input_schema: {
      type: 'object',
      properties: {
        ...ID_PROP,
        offset: {
          type: 'integer',
          minimum: 0,
          description: '0-based frame index to start at (default 0)',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 300,
          description: 'How many frames to return (default 120, max 300)',
        },
      },
      required: ['walkthroughId'],
    },
  }
}

const FETCH_TOOL: Anthropic.Tool = {
  name: 'fetch_url',
  description:
    'Download a URL and read it, as curl followed by Read would: an image comes back as an image you can see, a text file as text.',
  input_schema: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
  },
}

function buildCondition(fx: Fixture, synth: Synth): Condition {
  const points = synth.key_points.map((p, i) => ({
    id: `kp${i + 1}`,
    title: p.title,
    detail: p.detail,
    severity: p.severity,
    atMs: p.at.trim() === '' ? null : stampMs(p.at, fx.durationMs),
  }))
  const files = fx.files.map((f) => ({
    path: f.path,
    size: f.size,
    contentType: f.contentType,
    url: presign(f.path),
  }))
  const frameCount = fx.files.filter(isFrame).length
  const detail = {
    id: ID,
    slug: SLUG,
    space: 'Personal',
    title: synth.title,
    origin: null,
    status: 'open',
    recordedAt: RECORDED_AT,
    durationMs: fx.durationMs,
    frameCount,
    errorCount: 0,
    droppedCount: 0,
    takes: [
      {
        index: 1,
        dir: 'rec-01',
        interrupted: false,
        durationMs: fx.durationMs,
        frameCount,
        videoPath: 'rec-01/walkthrough.webm',
      },
    ],
    intent: 'bug',
    summaryMd: synth.summary_md,
    digestMd: synth.digest,
    projectInstructions: null,
    curation: { frames: [], excluded: [] },
    files,
    notes: [],
    comments: [],
    missingFiles: [],
  }

  if (fx.cond === 'old') {
    return {
      fx,
      // Before: Refine's brief replaced the report outright.
      brief: formatOld({ ...detail, points, reportMd: synth.brief_md }),
      rebuilt: null,
      points,
      tools: [
        {
          name: 'get_walkthrough',
          description:
            "Fetch one walkthrough's full brief — a narrated screen recording made by a human in the running app, whether that's a bug, review feedback, or a change request: metadata, the report.md authored for agents, and presigned URLs for its files (video, transcript, and the keyframes — every frame for a normal-length walkthrough, a sample for a long one, with get_frames to page the full set)." +
            SCOPE,
          input_schema: { type: 'object', properties: ID_PROP, required: ['walkthroughId'] },
        },
        framesTool(
          'Page the full keyframe set for a walkthrough — presigned image URLs in the order they were recorded. get_walkthrough only carries a sample of frames once a walkthrough runs long; use this to fetch the rest, or all of them, without leaving MCP. Returns { total, offset, limit, returned, nextOffset, frames:[{path,url}] }; keep calling with offset = the previous nextOffset until nextOffset is null. Default 120 frames per call, max 300.'
        ),
        FETCH_TOOL,
      ],
    }
  }

  const rebuilt = briefFromRecordings(briefInput(fx, synth.title, points), fx.recordings)
  const withEvidence = points.map((p) => {
    const evidence = rebuilt.evidence[p.id]
    return evidence ? { ...p, evidence } : p
  })
  return {
    fx,
    brief: formatWalkthrough({
      ...detail,
      points: withEvidence,
      reportMd: synth.brief_md,
      briefMd: null,
      refinedBriefMd: synth.brief_md,
      recordingMd: rebuilt.recordingMd,
      recordingRebuilt: true,
      startHere: rebuilt.startHere,
    }),
    rebuilt,
    points,
    tools: [
      {
        name: 'get_walkthrough',
        description: TOOL_DESCRIPTIONS.get_walkthrough + SCOPE,
        input_schema: { type: 'object', properties: ID_PROP, required: ['walkthroughId'] },
      },
      {
        name: 'get_images',
        description: TOOL_DESCRIPTIONS.get_images + SCOPE,
        input_schema: {
          type: 'object',
          properties: {
            ...ID_PROP,
            paths: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 6,
              description:
                'Frame or contact-sheet paths from the brief, at most 6. Omit for the evidence set.',
            },
          },
          required: ['walkthroughId'],
        },
      },
      {
        name: 'get_file',
        description: TOOL_DESCRIPTIONS.get_file + SCOPE,
        input_schema: {
          type: 'object',
          properties: {
            ...ID_PROP,
            path: {
              type: 'string',
              description: 'A path from the brief, e.g. rec-01/transcript.txt',
            },
          },
          required: ['walkthroughId', 'path'],
        },
      },
      framesTool(
        "Page download URLs for a walkthrough's keyframes, in the order they were recorded (get_images shows them as images). Returns { total, offset, limit, returned, nextOffset, frames:[{path,url}] }; keep calling with offset = the previous nextOffset until nextOffset is null. Default 120 frames per call, max 300."
      ),
      FETCH_TOOL,
    ],
  }
}

// ── tools ──────────────────────────────────────────────────────────────────

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
function mediaType(m: string): MediaType {
  switch (m) {
    case 'image/jpeg':
    case 'image/png':
    case 'image/webp':
    case 'image/gif':
      return m
    default:
      throw new Error(`not an image type: ${m}`)
  }
}

function blocks(
  content: ToolContent[]
): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
  return content.map((c) =>
    c.type === 'text'
      ? { type: 'text', text: c.text }
      : {
          type: 'image',
          source: { type: 'base64', media_type: mediaType(c.mimeType), data: c.data },
        }
  )
}

class ToolError extends Error {}

const getFramesInput = z.object({
  ...idSchema,
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(300).optional(),
})

async function runTool(
  c: Condition,
  name: string,
  input: unknown,
  seen: string[]
): Promise<ToolContent[]> {
  const byPath = new Map(c.fx.files.map((f) => [f.path, f]))
  const checkId = (id: string) => {
    if (id !== ID) throw new ToolError(`No walkthrough ${id} on this Handback.`)
  }
  switch (name) {
    case 'get_walkthrough': {
      checkId(z.object(idSchema).parse(input).walkthroughId)
      return [{ type: 'text', text: c.brief }]
    }
    case 'get_frames': {
      const { walkthroughId, offset = 0, limit = FRAMES_PAGE_DEFAULT } = getFramesInput.parse(input)
      checkId(walkthroughId)
      const frames = c.fx.files.filter(isFrame)
      const page = frames.slice(offset, offset + limit)
      const next = offset + page.length
      return [
        {
          type: 'text',
          text: JSON.stringify(
            {
              walkthroughId: ID,
              total: frames.length,
              offset,
              limit,
              returned: page.length,
              nextOffset: next < frames.length ? next : null,
              frames: page.map((f) => ({ path: f.path, url: presign(f.path) })),
            },
            null,
            2
          ),
        },
      ]
    }
    case 'get_images': {
      if (c.fx.cond !== 'new') break
      const { walkthroughId, paths } = z
        .object({ ...idSchema, paths: z.array(z.string()).max(6).optional() })
        .parse(input)
      checkId(walkthroughId)
      const evidence = new Map(evidenceImages(c.rebuilt, c.points).map((e) => [e.path, e]))
      const wanted = paths && paths.length > 0 ? [...new Set(paths)] : [...evidence.keys()]
      const servable = wanted.filter((p) => {
        const f = byPath.get(p)
        return f !== undefined && isImage(f)
      })
      const chosen = servable.slice(0, 6)
      const images = await Promise.all(
        chosen.map(async (path) => {
          seen.push(path)
          const { data, mimeType } = await imageForAgent(
            await readFile(join(c.fx.root, path)),
            INLINE_EDGE
          )
          return { label: imageLabel(path, c.rebuilt, evidence.get(path)), data, mimeType }
        })
      )
      return imagesContent({
        images,
        skipped: wanted.filter((p) => !servable.includes(p)),
        more: servable.slice(6),
      })
    }
    case 'get_file': {
      if (c.fx.cond !== 'new') break
      const { walkthroughId, path } = z.object({ ...idSchema, path: z.string() }).parse(input)
      checkId(walkthroughId)
      const f = byPath.get(path)
      if (!f)
        throw new ToolError(
          `No file ${path} on walkthrough ${walkthroughId} that this token can read.`
        )
      if (isImage(f)) {
        seen.push(path)
        const { data, mimeType } = await imageForAgent(await readFile(f.abs), FULL_EDGE)
        return fileContent({ kind: 'image', path, mimeType, data })
      }
      if (isText(f)) {
        return fileContent({
          kind: 'text',
          path,
          contentType: f.contentType,
          text: await readFile(f.abs, 'utf8'),
        })
      }
      return fileContent({
        kind: 'url',
        path,
        contentType: f.contentType,
        size: f.size,
        url: presign(path),
      })
    }
    case 'fetch_url': {
      const { url } = z.object({ url: z.string() }).parse(input)
      const m = new RegExp(`/walkthroughs/${ID}/([^?]+)`).exec(url)
      const f = m?.[1] ? byPath.get(decodeURIComponent(m[1])) : undefined
      if (!f) throw new ToolError(`curl: (22) The requested URL returned error: 404`)
      if (isImage(f)) {
        seen.push(f.path)
        // Claude Code's Read hands the image over as stored.
        const data = (await readFile(f.abs)).toString('base64')
        return [{ type: 'image', data, mimeType: f.contentType }]
      }
      if (isText(f)) return [{ type: 'text', text: await readFile(f.abs, 'utf8') }]
      return [
        {
          type: 'text',
          text: `Downloaded ${f.size} bytes of ${f.contentType}. This is binary; it can't be shown here.`,
        },
      ]
    }
  }
  throw new ToolError(`No such tool: ${name}`)
}

// ── the agent loop ─────────────────────────────────────────────────────────

type RunResult = {
  cond: Cond
  run: number
  turns: number
  calls: Array<{ name: string; input: unknown; error?: string }>
  imagesSeen: string[]
  usage: Usage
  stop: string | null
  answer: string
}

/** Transcript JSON with the image and signature payloads elided. */
const elide = (key: string, value: unknown) =>
  (key === 'data' || key === 'signature') && typeof value === 'string' && value.length > 200
    ? `<${value.length} chars>`
    : value

async function agentRun(c: Condition, run: number, out: string): Promise<RunResult> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: ASK }]
  const calls: RunResult['calls'] = []
  const seen: string[] = []
  const usage: Usage = { input: 0, output: 0, costUsd: 0 }
  let stop: string | null = null
  let turns = 0
  let answer = ''

  while (turns < MAX_TURNS) {
    turns++
    const resp = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: 16_000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      tools: c.tools,
      messages,
    })
    const u = usageOf(AGENT_MODEL, resp.usage)
    usage.input += u.input
    usage.output += u.output
    usage.costUsd += u.costUsd
    stop = resp.stop_reason
    messages.push({ role: 'assistant', content: resp.content })
    answer = resp.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')

    if (resp.stop_reason !== 'tool_use') break
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue
      try {
        const content = await runTool(c, block.name, block.input, seen)
        calls.push({ name: block.name, input: block.input })
        results.push({ type: 'tool_result', tool_use_id: block.id, content: blocks(content) })
      } catch (err) {
        const message =
          err instanceof ToolError
            ? err.message
            : err instanceof z.ZodError
              ? `Invalid input: ${err.message}`
              : String(err)
        calls.push({ name: block.name, input: block.input, error: message })
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: message,
          is_error: true,
        })
      }
    }
    messages.push({ role: 'user', content: results })
  }

  const result: RunResult = {
    cond: c.fx.cond,
    run,
    turns,
    calls,
    imagesSeen: seen,
    usage,
    stop,
    answer,
  }
  const base = join(out, `run-${c.fx.cond}-${run}`)
  await writeFile(`${base}.json`, JSON.stringify({ result, messages }, elide, 2))
  await writeFile(`${base}.md`, answer)
  return result
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const a = args()
  await mkdir(a.out, { recursive: true })
  const conditions: Condition[] = []
  for (const cond of a.conds) {
    const fx = await loadFixture(a.fixture, cond)
    const { synth, usage } = await refine(fx, a.out)
    if (usage)
      console.log(
        `refine ${cond}: ${usage.input} in / ${usage.output} out, $${usage.costUsd.toFixed(4)}`
      )
    const c = buildCondition(fx, synth)
    await writeFile(join(a.out, `brief-${cond}.txt`), c.brief)
    console.log(`brief ${cond}: ${c.brief.length} chars, ${synth.key_points.length} key points`)
    conditions.push(c)
  }
  if (a.stage === 'refine') return

  const jobs = conditions.flatMap((c) =>
    Array.from({ length: a.runs }, (_, i) => () => agentRun(c, a.from + i, a.out))
  )
  const results = await Promise.all(jobs.map((job) => job()))
  for (const r of results) {
    console.log(
      `${r.cond} #${r.run}: ${r.turns} turns, ${r.calls.length} calls (${r.calls.map((x) => x.name).join(', ')}), ` +
        `${r.imagesSeen.length} images, ${r.usage.input} in / ${r.usage.output} out, $${r.usage.costUsd.toFixed(3)}, stop ${r.stop}`
    )
  }
  const total = results.reduce((n, r) => n + r.usage.costUsd, 0)
  console.log(`agent total: $${total.toFixed(3)}`)
}

await main()
