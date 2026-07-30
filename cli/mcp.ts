// handback mcp — a stdio MCP server that lets a coding agent pull gripes.
//
//   claude mcp add handback --env HANDBACK_TOKEN=hb_... -- bun /abs/path/cli/mcp.ts
//
// Three tools over the token-authed read API in server/ingest.ts: list the
// team's gripes, pull one gripe's full brief (report.md + presigned URLs for
// video/keyframes/transcript), and move a gripe through review.
//
// stdout is the JSON-RPC channel — nothing but the protocol may be written to
// it. Diagnostics go to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const DEFAULT_SERVER = 'https://handback.dev'

// A gripe can carry thousands of keyframes; dumping every URL would bury the
// report. The agent gets a workable sample and the endpoint to page the rest.
const MAX_FRAMES = 30

const server = (process.env.HANDBACK_SERVER ?? DEFAULT_SERVER).replace(/\/+$/, '')
const token = process.env.HANDBACK_TOKEN
if (!token) {
  console.error('handback mcp: no API token — set HANDBACK_TOKEN (an hb_... token from Settings)')
  process.exit(1)
}

const statusSchema = z.enum(['open', 'in_review', 'resolved'])

type GripeFile = { path: string; size: number; contentType: string; url: string }

type GripeDetail = {
  reportMd: string | null
  files: GripeFile[]
  [key: string]: unknown
}

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

const isFrame = (path: string) => path.includes('/frames/')

/** The metadata JSON, then report.md, then one `path — url` line per file. */
function formatGripe(gripe: GripeDetail): string {
  const { reportMd, files, ...meta } = gripe

  let framesShown = 0
  let framesOmitted = 0
  const lines: string[] = []
  for (const f of files) {
    if (isFrame(f.path)) {
      if (framesShown >= MAX_FRAMES) {
        framesOmitted++
        continue
      }
      framesShown++
    }
    lines.push(`${f.path} — ${f.url}`)
  }
  if (framesOmitted > 0) {
    lines.push(
      `(+${framesOmitted} more frames omitted; fetch via files list of GET /api/ingest/gripes/:id)`
    )
  }

  return [
    JSON.stringify(meta, null, 2),
    '--- report.md ---',
    reportMd ?? '(no report.md was uploaded with this gripe)',
    '--- files ---',
    lines.join('\n'),
  ].join('\n\n')
}

registerTool(
  'list_gripes',
  {
    title: 'List gripes',
    description: "List the team's gripes (recorded walkthrough bug reports), newest first.",
    inputSchema: { status: statusSchema.optional() },
  },
  async ({ status }) => {
    const query = status ? `?status=${status}` : ''
    const result = await api<unknown[]>(`/gripes${query}`)
    if ('error' in result) return result.error
    if (result.data.length === 0) {
      return text(status ? `No ${status} gripes.` : 'No gripes yet.')
    }
    return text(JSON.stringify(result.data, null, 2))
  }
)

registerTool(
  'get_gripe',
  {
    title: 'Get gripe brief',
    description:
      "Fetch one gripe's full brief: metadata, the report.md authored for agents, and presigned URLs for every file (video, keyframes, transcript).",
    inputSchema: { gripeId: z.string().describe('Gripe id from list_gripes') },
  },
  async ({ gripeId }) => {
    const result = await api<GripeDetail>(`/gripes/${encodeURIComponent(gripeId)}`)
    if ('error' in result) return result.error
    return text(formatGripe(result.data))
  }
)

registerTool(
  'set_gripe_status',
  {
    title: 'Set gripe status',
    description:
      'Move a gripe through review: open → in_review when a fix is up, resolved after human sign-off.',
    inputSchema: { gripeId: z.string(), status: statusSchema },
  },
  async ({ gripeId, status }) => {
    const result = await api<{ ok: boolean; status: string }>(
      `/gripes/${encodeURIComponent(gripeId)}/status`,
      { method: 'POST', body: { status } }
    )
    if ('error' in result) return result.error
    return text(`Gripe ${gripeId} is now ${result.data.status}.`)
  }
)

await mcp.connect(new StdioServerTransport())
console.error(`handback mcp: ready (${server})`)
