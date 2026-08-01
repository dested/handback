// The hosted MCP server — what `claude mcp add --transport http` connects to.
//
//   claude mcp add --transport http handback https://handback.dev/mcp \
//     --header "Authorization: Bearer hb_…"
//
// Same three tools as the stdio server in `cli/mcp.ts`, over the same
// implementation (`walkthroughs-api.ts`), except nothing has to be installed: no
// clone, no bun, no repo. That matters because the person who fixes a walkthrough is
// usually not the person who deployed Handback.
//
// **Stateless on purpose.** A fresh McpServer + transport per POST, torn down
// when the response closes. Sessions would pin a client to one process, and
// this runs behind a load balancer as a single ECS service that gets replaced
// on every deploy — a session id would be a promise we can't keep. The cost is
// re-registering three tools per request, which is object allocation.
//
// Auth is the same `hb_` bearer token as /api/ingest, read off the standard
// Authorization header, so a token pins the org exactly like it does there —
// and, exactly like there, a platform admin's token spans every workspace.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Router, json, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  WALKTHROUGH_STATUSES,
  authenticateToken,
  getWalkthroughDetail,
  listWalkthroughs,
  setWalkthroughStatus,
  type TokenAuth,
} from './walkthroughs-api'
import { log } from './logger'
import { formatWalkthrough } from './mcp-format'
import { rateLimit } from './ratelimit'

const statusSchema = z.enum(WALKTHROUGH_STATUSES)

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

const text = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }] })
const toolError = (body: string): ToolResult => ({
  content: [{ type: 'text', text: body }],
  isError: true,
})

/**
 * Typed shim over `mcp.registerTool`, for the same reason `cli/mcp.ts` has one:
 * the SDK's generics blow the TypeScript instantiation budget (TS2589, under
 * both tsgo and tsc) for any input shape past a single plain field, because
 * `OutputArgs` is only inferrable from an `outputSchema` we don't want. Pinning
 * the shape here keeps handler arguments fully typed and confines the escape
 * hatch to one line.
 */
function registerTool<S extends Record<string, z.ZodTypeAny>>(
  mcp: McpServer,
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

/**
 * One MCP server bound to one token's org, for the life of one request — except
 * for a platform admin's token, which spans every workspace on this Handback.
 * The tool descriptions say which, because an agent decides how to read the
 * results from them: `workspace` on each row is noise in the org-pinned case and
 * the whole point in the admin one.
 */
function buildServer(auth: TokenAuth): McpServer {
  const mcp = new McpServer({ name: 'handback', version: '1.0.0' })
  const scope = auth.isAdmin
    ? ' This is a platform-admin token: it spans EVERY workspace on this Handback, not just one — read the `workspace` field on each walkthrough before acting.'
    : ''
  const notFound = (walkthroughId: string) =>
    auth.isAdmin
      ? `No walkthrough ${walkthroughId} on this Handback.`
      : `No walkthrough ${walkthroughId} in this workspace.`

  registerTool(
    mcp,
    'list_walkthroughs',
    {
      title: 'List walkthroughs',
      description:
        "List the team's walkthroughs — narrated screen recordings made by a human in the running app: a bug, review feedback, or a change request — newest first." +
        scope,
      inputSchema: { status: statusSchema.optional() },
    },
    async ({ status }) => {
      const rows = await listWalkthroughs(auth, status)
      if (rows.length === 0) {
        return text(status ? `No ${status} walkthroughs.` : 'No walkthroughs yet.')
      }
      return text(JSON.stringify(rows, null, 2))
    }
  )

  registerTool(
    mcp,
    'get_walkthrough',
    {
      title: 'Get walkthrough brief',
      description:
        "Fetch one walkthrough's full brief — a narrated screen recording made by a human in the running app, whether that's a bug, review feedback, or a change request: metadata, the report.md authored for agents, and presigned URLs for every file (video, keyframes, transcript)." +
        scope,
      inputSchema: { walkthroughId: z.string().describe('Walkthrough id from list_walkthroughs') },
    },
    async ({ walkthroughId }) => {
      const walkthrough = await getWalkthroughDetail(auth, walkthroughId)
      if (!walkthrough) return toolError(notFound(walkthroughId))
      return text(formatWalkthrough(walkthrough))
    }
  )

  registerTool(
    mcp,
    'set_walkthrough_status',
    {
      title: 'Set walkthrough status',
      description:
        'Move a walkthrough through review: open → in_review when a fix is up, resolved after human sign-off.' +
        scope,
      inputSchema: { walkthroughId: z.string(), status: statusSchema },
    },
    async ({ walkthroughId, status }) => {
      const moved = await setWalkthroughStatus(auth, walkthroughId, status)
      if (!moved) return toolError(notFound(walkthroughId))
      return text(`Walkthrough ${moved.slug} (${walkthroughId}) is now ${status}.`)
    }
  )

  return mcp
}

/** JSON-RPC shaped errors, because the caller is a JSON-RPC client. */
function rpcError(res: Response, http: number, code: number, message: string) {
  res.status(http).json({ jsonrpc: '2.0', error: { code, message }, id: null })
}

export const mcpRouter = Router()

mcpRouter.use(json({ limit: '4mb' }))

// Two layers, same order as ingest: the IP limit runs before authentication so
// a bad-token flood can't hammer the token lookup, the token limit after.
mcpRouter.use(rateLimit('mcp-ip', { window: 60, max: 240 }, (req: Request) => req.ip ?? 'unknown'))

mcpRouter.use(async (req, res, next) => {
  const auth = await authenticateToken(req.header('authorization'))
  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="handback"')
    rpcError(
      res,
      401,
      -32001,
      'Missing or invalid API token. Create one at /connect and pass it as: --header "Authorization: Bearer hb_…"'
    )
    return
  }
  ;(req as Request & { mcpAuth: TokenAuth }).mcpAuth = auth
  next()
})

// Express 5's handler generics collapse to ParamsDictionary once a route has
// more than one handler, so the stashed identity comes back through unknown —
// same shape as ingest.ts.
const getAuth = (req: Request): TokenAuth => (req as unknown as { mcpAuth: TokenAuth }).mcpAuth

// An agent working a queue makes a handful of calls per walkthrough; this is an order
// of magnitude above that.
const mcpLimit = rateLimit('mcp', { window: 3600, max: 900 }, (req) => getAuth(req).tokenId)

mcpRouter.post('/', mcpLimit, async (req, res) => {
  const auth = getAuth(req)
  const server = buildServer(auth)
  const transport = new StreamableHTTPServerTransport({
    // Stateless: no session id in responses, no session validation. See header.
    sessionIdGenerator: undefined,
    // Answer with a plain JSON body instead of holding an SSE stream open.
    // Caddy and ECS both prefer short requests, and none of our three tools
    // stream or send server-initiated notifications.
    enableJsonResponse: true,
  })

  res.on('close', () => {
    void transport.close()
    void server.close()
  })

  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    log.error(`[mcp] request failed: ${String(err)}`)
    if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error')
  }
})

// Stateless means there is no stream to resume and no session to delete. Say so
// rather than letting these fall through to the SSR catch-all, which would
// answer a JSON-RPC client with a page of HTML.
const noStream = (_req: Request, res: Response) =>
  rpcError(res, 405, -32000, 'This MCP endpoint is stateless; use POST.')

mcpRouter.get('/', noStream)
mcpRouter.delete('/', noStream)
