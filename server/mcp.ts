// The hosted MCP server — what `claude mcp add --transport http` connects to.
//
//   claude mcp add --transport http handback https://handback.dev/mcp \
//     --header "Authorization: Bearer hb_…"
//
// Same four tools as the stdio server in `cli/mcp.ts`, over the same
// implementation (`walkthroughs-api.ts`), except nothing has to be installed: no
// clone, no bun, no repo. That matters because the person who fixes a walkthrough is
// usually not the person who deployed Handback.
//
// **Stateless on purpose.** A fresh McpServer + transport per POST, torn down
// when the response closes. Sessions would pin a client to one process, and
// this runs behind a load balancer as a single ECS service that gets replaced
// on every deploy — a session id would be a promise we can't keep. The cost is
// re-registering four tools per request, which is object allocation.
//
// Auth is the same `hb_` bearer token as /api/ingest, read off the standard
// Authorization header, so a token reaches its owner's personal space and every
// team they belong to, exactly like it does there — and, exactly like there, a
// platform admin's token spans every space.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Router, json, type Request, type Response } from 'express'
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
 * One MCP server bound to one token's spaces, for the life of one request —
 * except for a platform admin's token, which spans every space on this Handback.
 * The tool descriptions say which, because an agent decides how to read the
 * results from them: `space` on each row tells one team's walkthroughs from
 * another's, and is the whole point in the admin case.
 */
function buildServer(auth: TokenAuth): McpServer {
  const mcp = new McpServer({ name: 'handback', version: '1.0.0' })
  const scope = auth.isAdmin
    ? ' This is a platform-admin token: it spans EVERY space on this Handback, not just its owner’s — read the `space` field on each walkthrough before acting.'
    : ''
  const notFound = (walkthroughId: string) =>
    auth.isAdmin
      ? `No walkthrough ${walkthroughId} on this Handback.`
      : `No walkthrough ${walkthroughId} in any space this token reaches.`

  registerTool(
    mcp,
    'list_walkthroughs',
    {
      title: 'List walkthroughs',
      description:
        'Lists walkthroughs across your personal space and every team your token’s owner belongs to; each item carries `space`. A walkthrough is a narrated screen recording made by a human in the running app: a bug, review feedback, or a change request. Newest first.' +
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

  registerTool(
    mcp,
    'post_result',
    {
      title: 'Post your result',
      description:
        'When you have addressed a walkthrough, post what you did so the human can sign off: a one-paragraph summary, and optionally the PR url, the files you touched, and a longer markdown body. This is what the reviewer reads before approving — write it for them. Posting also moves an open walkthrough to in_review.' +
        scope,
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
      },
    },
    async ({ walkthroughId, summary, prUrl, filesTouched, body, evidence }) => {
      const posted = await postWalkthroughResult(auth, walkthroughId, {
        summary,
        prUrl,
        filesTouched,
        body,
        evidence,
      })
      if (!posted) return toolError(notFound(walkthroughId))
      return text(
        `Result posted on ${posted.slug} (${walkthroughId}) — the reviewer will see it on the walkthrough page.`
      )
    }
  )

  registerTool(
    mcp,
    'ask_reviewer',
    {
      title: 'Ask the reviewer a question',
      description:
        'When a walkthrough is ambiguous or you need a human decision, ask instead of guessing. The walkthrough moves to needs_info, the human is emailed, and their answer appears in the review thread — re-pull the walkthrough later and read it there. Stop working on this walkthrough until it is answered.' +
        scope,
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
      const asked = await askReviewerQuestion(auth, walkthroughId, question)
      if (!asked) return toolError(notFound(walkthroughId))
      return text(
        `Question posted on ${asked.slug} — status is needs_info; the reviewer has been notified. Re-pull this walkthrough later to read the answer in the review thread.`
      )
    }
  )

  registerTool(
    mcp,
    'attach_evidence',
    {
      title: 'Attach proof screenshots',
      description:
        'Before post_result, attach up to 4 proof screenshots (before/after, the fixed screen). Returns one presigned PUT url per file: upload each file\'s raw bytes with curl -X PUT -H "Content-Type: <type>" --data-binary @file "<url>" (size must match exactly), then pass the returned paths as post_result\'s evidence.' +
        scope,
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
      const requested = await requestEvidenceUploads(auth, walkthroughId, files)
      if (!requested) return toolError(notFound(walkthroughId))
      return text(JSON.stringify(requested, null, 2))
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
