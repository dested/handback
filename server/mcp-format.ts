// How a walkthrough reads to an agent. Pure string work, no imports — shared by the
// hosted MCP endpoint (`server/mcp.ts`) and the stdio one (`cli/mcp.ts`) so a
// walkthrough looks identical whichever way it was pulled.

/** Structural, not nominal: the hosted server passes a Prisma-derived object
 *  and the stdio client passes a parsed wire body. Both have these two fields. */
export type FormattableWalkthrough = {
  reportMd: string | null
  files: Array<{ path: string; url: string }>
  [key: string]: unknown
}

// A walkthrough can carry thousands of keyframes; dumping every URL would bury the
// report. The agent gets a workable sample and the endpoint to page the rest.
// The sample scales with the walkthrough's length for the same reason the
// recorder's own budget does (extension `frameBudget`): 30 lines describe a
// 90-second walkthrough fully and starve a twenty-minute one.
const BRIEF_FRAMES_PER_MIN = 8
const MIN_BRIEF_FRAMES = 30
const MAX_BRIEF_FRAMES = 120

/** `durationMs` arrives through an index signature, so it is `unknown` — a walkthrough
 *  declared without one still gets the floor rather than zero frames. */
export function briefFrameLimit(durationMs: unknown): number {
  const ms = typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : 0
  const byLength = Math.round((ms / 60000) * BRIEF_FRAMES_PER_MIN)
  return Math.min(MAX_BRIEF_FRAMES, Math.max(MIN_BRIEF_FRAMES, byLength))
}

const isFrame = (path: string) => path.includes('/frames/')

/** The metadata JSON, then report.md, then one `path — url` line per file. */
export function formatWalkthrough(walkthrough: FormattableWalkthrough): string {
  const { reportMd, files, ...meta } = walkthrough
  const maxFrames = briefFrameLimit(meta.durationMs)

  let framesShown = 0
  let framesOmitted = 0
  const lines: string[] = []
  for (const f of files) {
    if (isFrame(f.path)) {
      if (framesShown >= maxFrames) {
        framesOmitted++
        continue
      }
      framesShown++
    }
    lines.push(`${f.path} — ${f.url}`)
  }
  if (framesOmitted > 0) {
    lines.push(
      `(+${framesOmitted} more frames omitted; fetch via files list of GET /api/ingest/walkthroughs/:id)`
    )
  }

  return [
    JSON.stringify(meta, null, 2),
    '--- report.md ---',
    reportMd ?? '(no report.md was uploaded with this walkthrough)',
    '--- files ---',
    lines.join('\n'),
  ].join('\n\n')
}
