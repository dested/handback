// handback mcp — a stdio MCP server that lets a coding agent pull walkthroughs.
//
//   claude mcp add handback --env HANDBACK_TOKEN=hb_... -- bun /abs/path/cli/mcp.ts
//
// **Most people should not use this.** The hosted endpoint (`server/mcp.ts`,
// `claude mcp add --transport http handback https://handback.dev/mcp`) needs no
// clone and no bun, and /connect walks you through it. This one stays for
// contributors working against a local server and for anyone who'd rather their
// agent talk to a process they can read.
//
// Four tools over the token-authed API in server/ingest.ts: list every
// walkthrough the token reaches (its owner's personal space plus every team
// they're in), pull one walkthrough's full brief (report.md + presigned URLs for
// video/keyframes/transcript), move a walkthrough through review, and post the
// result a human signs off on.
//
// stdout is the JSON-RPC channel — nothing but the protocol may be written to
// it. Diagnostics go to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { formatWalkthrough, type FormattableWalkthrough } from '../server/mcp-format'

const DEFAULT_SERVER = 'https://handback.dev'

const server = (process.env.HANDBACK_SERVER ?? DEFAULT_SERVER).replace(/\/+$/, '')
const token = process.env.HANDBACK_TOKEN
if (!token) {
  console.error('handback mcp: no API token — set HANDBACK_TOKEN (an hb_... token from Settings)')
  process.exit(1)
}

const statusSchema = z.enum(['open', 'in_review', 'resolved'])

type ToolResult = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

const mcp = new McpServer({ name: 'handback', version: '0.1.0' })

/**
 * Typed shim over `mcp.registerTool`. The SDK's own generics blow the
 * TypeScript instantiation budget (TS2589, under both tsgo and tsc) for any
 * input shape past a single plain field, because `OutputArgs` is only
 * inferrable from an `outputSchema` we don't want. Pinning the shape here keeps
 * handler arguments fully typed and confines the escape hatch to one line.
 */
function registerTool<S extends Record<string, z.ZodTypeAny>>(
  name: string,
  config: { title: string; description: string; inputSchema: S },
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>
): void {
  const register = mcp.registerTool.bind(mcp) as unknown as (
    n: string,
    c: unknown,
    h: unknown
  ) => unknown
  register(name, config, handler)
}

function text(body: string): ToolResult {
  return { content: [{ type: 'text', text: body }] }
}

function toolError(body: string): ToolResult {
  return { content: [{ type: 'text', text: body }], isError: true }
}

/**
 * One call against /api/ingest. Resolves to the parsed body, or a ToolResult
 * carrying the failure — callers hand that straight back to the client.
 */
async function api<T>(
  path: string,
  init?: { method: string; body: unknown }
): Promise<{ data: T } | { error: ToolResult }> {
  const url = `${server}/api/ingest${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(init ? { 'content-type': 'application/json' } : {}),
      },
      body: init ? JSON.stringify(init.body) : undefined,
    })
  } catch (err) {
    return { error: toolError(`Could not reach ${url}: ${String(err)}`) }
  }
  if (!res.ok) {
    return { error: toolError(`${res.status} ${res.statusText} from ${url}: ${await res.text()}`) }
  }
  return { data: (await res.json()) as T }
}

registerTool(
  'list_walkthroughs',
  {
    title: 'List walkthroughs',
    description:
      'List the walkthroughs in every space you can reach — narrated screen recordings made by a human in the running app: a bug, review feedback, or a change request — newest first. Each item names its space (your personal space, or a team).',
    inputSchema: { status: statusSchema.optional() },
  },
  async ({ status }) => {
    const query = status ? `?status=${status}` : ''
    const result = await api<unknown[]>(`/walkthroughs${query}`)
    if ('error' in result) return result.error
    if (result.data.length === 0) {
      return text(status ? `No ${status} walkthroughs.` : 'No walkthroughs yet.')
    }
    return text(JSON.stringify(result.data, null, 2))
  }
)

registerTool(
  'get_walkthrough',
  {
    title: 'Get walkthrough brief',
    description:
      "Fetch one walkthrough's full brief — a narrated screen recording made by a human in the running app, whether that's a bug, review feedback, or a change request: metadata, the report.md authored for agents, and presigned URLs for every file (video, keyframes, transcript).",
    inputSchema: { walkthroughId: z.string().describe('Walkthrough id from list_walkthroughs') },
  },
  async ({ walkthroughId }) => {
    const result = await api<FormattableWalkthrough>(
      `/walkthroughs/${encodeURIComponent(walkthroughId)}`
    )
    if ('error' in result) return result.error
    return text(formatWalkthrough(result.data))
  }
)

registerTool(
  'set_walkthrough_status',
  {
    title: 'Set walkthrough status',
    description:
      'Move a walkthrough through review: open → in_review when a fix is up, resolved after human sign-off.',
    inputSchema: { walkthroughId: z.string(), status: statusSchema },
  },
  async ({ walkthroughId, status }) => {
    const result = await api<{ ok: boolean; status: string }>(
      `/walkthroughs/${encodeURIComponent(walkthroughId)}/status`,
      { method: 'POST', body: { status } }
    )
    if ('error' in result) return result.error
    return text(`Walkthrough ${walkthroughId} is now ${result.data.status}.`)
  }
)

registerTool(
  'post_result',
  {
    title: 'Post your result',
    description:
      'When you have addressed a walkthrough, post what you did so the human can sign off: a one-paragraph summary, and optionally the PR url, the files you touched, and a longer markdown body. This is what the reviewer reads before approving — write it for them. Posting also moves an open walkthrough to in_review.',
    inputSchema: {
      walkthroughId: z.string(),
      summary: z.string().min(1).max(2000).describe('What you did, in a sentence or two'),
      prUrl: z.string().url().max(500).optional().describe('Link to the PR or commit, if any'),
      filesTouched: z.array(z.string().max(300)).max(100).optional(),
      body: z
        .string()
        .max(20_000)
        .optional()
        .describe('Optional longer markdown: what changed, how to verify, anything left open'),
      evidence: z
        .array(z.string().max(300))
        .max(4)
        .optional()
        .describe('Paths returned by attach_evidence, after uploading'),
      outcomes: z
        .array(
          z.object({
            point: z.string(),
            status: z.enum(['fixed', 'partial', 'skipped', 'not_applicable']),
            note: z.string().optional(),
          })
        )
        .optional()
        .describe('One entry per key point in the brief — how you addressed it'),
    },
  },
  async ({ walkthroughId, summary, prUrl, filesTouched, body, evidence, outcomes }) => {
    const result = await api<{ ok: boolean }>(
      `/walkthroughs/${encodeURIComponent(walkthroughId)}/result`,
      { method: 'POST', body: { summary, prUrl, filesTouched, body, evidence, outcomes } }
    )
    if ('error' in result) return result.error
    return text(
      `Result posted on ${walkthroughId} — the reviewer will see it on the walkthrough page.`
    )
  }
)

registerTool(
  'ask_reviewer',
  {
    title: 'Ask the reviewer a question',
    description:
      'When a walkthrough is ambiguous or you need a human decision, ask instead of guessing. The walkthrough moves to needs_info, the human is emailed, and their answer appears in the review thread — re-pull the walkthrough later and read it there. Stop working on this walkthrough until it is answered.',
    inputSchema: {
      walkthroughId: z.string(),
      question: z
        .string()
        .min(1)
        .max(2000)
        .describe('The specific question — what you need decided or clarified before you can proceed'),
    },
  },
  async ({ walkthroughId, question }) => {
    const result = await api<{ ok: boolean; status: string }>(
      `/walkthroughs/${encodeURIComponent(walkthroughId)}/question`,
      { method: 'POST', body: { question } }
    )
    if ('error' in result) return result.error
    return text(
      `Question posted on ${walkthroughId} — status is needs_info; the reviewer has been notified. Re-pull this walkthrough later to read the answer in the review thread.`
    )
  }
)

registerTool(
  'attach_evidence',
  {
    title: 'Attach proof screenshots',
    description:
      'Before post_result, attach up to 4 proof screenshots (before/after, the fixed screen). Returns one presigned PUT url per file: upload each file\'s raw bytes with curl -X PUT -H "Content-Type: <type>" --data-binary @file "<url>" (size must match exactly), then pass the returned paths as post_result\'s evidence.',
    inputSchema: {
      walkthroughId: z.string(),
      files: z
        .array(
          z.object({
            name: z.string().regex(/^[a-z0-9._-]{1,80}$/i),
            contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
            size: z
              .number()
              .int()
              .min(1)
              .max(5 * 1024 * 1024),
          })
        )
        .min(1)
        .max(4),
    },
  },
  async ({ walkthroughId, files }) => {
    const result = await api<{ uploads: { path: string; url: string; contentType: string }[] }>(
      `/walkthroughs/${encodeURIComponent(walkthroughId)}/evidence`,
      { method: 'POST', body: { files } }
    )
    if ('error' in result) return result.error
    return text(JSON.stringify(result.data, null, 2))
  }
)

await mcp.connect(new StdioServerTransport())
console.error(`handback mcp: ready (${server})`)
