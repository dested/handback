// How a gripe reads to an agent. Pure string work, no imports — shared by the
// hosted MCP endpoint (`server/mcp.ts`) and the stdio one (`cli/mcp.ts`) so a
// gripe looks identical whichever way it was pulled.

/** Structural, not nominal: the hosted server passes a Prisma-derived object
 *  and the stdio client passes a parsed wire body. Both have these two fields. */
export type FormattableGripe = {
  reportMd: string | null
  files: Array<{ path: string; url: string }>
  [key: string]: unknown
}

// A gripe can carry thousands of keyframes; dumping every URL would bury the
// report. The agent gets a workable sample and the endpoint to page the rest.
export const MAX_FRAMES = 30

const isFrame = (path: string) => path.includes('/frames/')

/** The metadata JSON, then report.md, then one `path — url` line per file. */
export function formatGripe(gripe: FormattableGripe): string {
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
