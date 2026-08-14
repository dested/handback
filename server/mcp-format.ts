// How a walkthrough reads to an agent. Pure string work, no imports — shared by the
// hosted MCP endpoint (`server/mcp.ts`) and the stdio one (`cli/mcp.ts`) so a
// walkthrough looks identical whichever way it was pulled.

/** Structural, not nominal: the hosted server passes a Prisma-derived object
 *  and the stdio client passes a parsed wire body. Both have these fields
 *  (`notes` is absent on a wire body from a server that predates it). */
export type FormattableWalkthrough = {
  reportMd: string | null
  files: Array<{ path: string; url: string }>
  notes?: Array<{
    role: string
    summary: string
    prUrl: string | null
    filesTouched: string[]
    bodyMd: string | null
    authorName: string
    createdAt: string
  }>
  comments?: Array<{
    authorName: string
    atMs: number | null
    text: string
    createdAt: string
  }>
  [key: string]: unknown
}

/** m:ss on the walkthrough-wide clock — how the transcript and frames talk. */
const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

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

/** One review-thread entry as brief text. A reviewer entry's summary IS the
 *  send-back note — the thing an agent re-pulling this walkthrough must read. */
function formatNote(n: NonNullable<FormattableWalkthrough['notes']>[number]): string {
  const head =
    n.role === 'agent'
      ? `agent result — ${n.authorName} · ${n.createdAt}`
      : `reviewer sent it back — ${n.authorName} · ${n.createdAt}`
  const lines = [head, n.summary]
  if (n.prUrl) lines.push(`PR: ${n.prUrl}`)
  if (n.filesTouched.length > 0) lines.push(`files: ${n.filesTouched.join(', ')}`)
  if (n.bodyMd) lines.push(n.bodyMd)
  return lines.join('\n')
}

/** The metadata JSON, then report.md, the review thread when one exists, then
 *  one `path — url` line per file. */
export function formatWalkthrough(walkthrough: FormattableWalkthrough): string {
  const { reportMd, files, notes, comments, ...meta } = walkthrough
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
    // A comment is an instruction: "[2:31] Sal — this dropdown too". The
    // timestamp keys into the transcript/frames, which share this clock.
    ...(comments && comments.length > 0
      ? [
          '--- comments ---',
          comments
            .map(
              (c) => `${c.atMs === null ? '' : `[${mmss(c.atMs)}] `}${c.authorName}: ${c.text}`
            )
            .join('\n'),
        ]
      : []),
    // Chronological, so "what happened since the recording" reads top to
    // bottom: result, send-back, result again. Absent entirely when empty.
    ...(notes && notes.length > 0 ? ['--- review thread ---', notes.map(formatNote).join('\n\n')] : []),
    '--- files ---',
    lines.join('\n'),
  ].join('\n\n')
}
