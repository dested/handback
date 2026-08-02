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
// Three tools over the token-authed read API in server/ingest.ts: list every
// walkthrough the token reaches (its owner's personal space plus every team
// they're in), pull one walkthrough's full brief (report.md + presigned URLs for
// video/keyframes/transcript), and move a walkthrough through review.
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

await mcp.connect(new StdioServerTransport())
console.error(`handback mcp: ready (${server})`)
