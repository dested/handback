// How a walkthrough reads to an agent. Pure string work, no imports — shared by the
// hosted MCP endpoint (`server/mcp.ts`) and the stdio one (`cli/mcp.ts`) so a
// walkthrough looks identical whichever way it was pulled.

/** Structural, not nominal: the hosted server passes a Prisma-derived object
 *  and the stdio client passes a parsed wire body. Both have these fields
 *  (`notes` is absent on a wire body from a server that predates it). */
export type FormattableWalkthrough = {
  reportMd: string | null
  files: Array<{ path: string; url: string }>
  // What the recording is FOR — drives the intent framing line. Optional so a
  // wire body from an older server (no intent) still formats.
  intent?: string | null
  // Refine's outputs, when it ran: the complete ledger and the reviewer-curated
  // keyframe set / cut spans. All optional for the same back-compat reason.
  summaryMd?: string | null
  projectInstructions?: string | null
  curation?: {
    frames: Array<{ path: string; caption: string; atMs: number | null }>
    excluded: Array<{ startMs: number; endMs: number; reason: string }>
  } | null
  notes?: Array<{
    role: string
    // 'result' | 'question' | 'answer'; absent on a pre-kind wire body, which
    // formatNote treats as a plain result/send-back.
    kind?: string
    summary: string
    prUrl: string | null
    filesTouched: string[]
    evidencePaths?: string[]
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
 *  send-back note (or, for kind 'answer', the reply to an agent's question) —
 *  the thing an agent re-pulling this walkthrough must read. */
function formatNote(n: NonNullable<FormattableWalkthrough['notes']>[number]): string {
  const when = `${n.authorName} · ${n.createdAt}`
  const head =
    n.role === 'agent'
      ? n.kind === 'question'
        ? `agent asked — ${when}`
        : `agent result — ${when}`
      : n.kind === 'answer'
        ? `reviewer answered — ${when}`
        : `reviewer sent it back — ${when}`
  const lines = [head, n.summary]
  if (n.prUrl) lines.push(`PR: ${n.prUrl}`)
  if (n.filesTouched.length > 0) lines.push(`files: ${n.filesTouched.join(', ')}`)
  // The urls for these paths are in the files section below.
  if (n.evidencePaths && n.evidencePaths.length > 0) {
    lines.push(`evidence: ${n.evidencePaths.join(', ')}`)
  }
  if (n.bodyMd) lines.push(n.bodyMd)
  return lines.join('\n')
}

/** The verbatim intent framing that opens the brief; null when untagged. */
function intentFraming(intent: string | null | undefined): string | null {
  switch (intent) {
    case 'bug':
      return 'INTENT: BUG — The narrator is reporting something broken. Reproduce it from the steps and evidence below, fix the root cause, and post_result with what changed and how you verified the fix.'
    case 'feature':
      return 'INTENT: FEATURE REQUEST — The narrator is describing something to build. Treat the narration as the spec: build what is described, note any decision you had to make, and post_result with what you built and how to try it.'
    case 'idea':
      return 'INTENT: IDEA — The narrator is thinking out loud. Do not build anything yet: assess feasibility, sketch an approach, and post_result with a short plan and open questions instead of code.'
    default:
      return null
  }
}

/** The intent framing, metadata JSON, summary and project instructions, report.md,
 *  the reviewer's cut spans, the comments and review thread, then the files — the
 *  curated key frames up top when Refine picked a set, otherwise a length-scaled
 *  sample. */
export function formatWalkthrough(walkthrough: FormattableWalkthrough): string {
  const { reportMd, files, notes, comments, intent, summaryMd, projectInstructions, curation, ...meta } =
    walkthrough
  const maxFrames = briefFrameLimit(meta.durationMs)
  const curatedFrames = curation?.frames ?? []

  // Files section. With a curated set, every frame is pulled from the flat list
  // (the curated block above is the sample that matters) and the rest are a
  // pointer; without one, we fall back to the length-scaled sample.
  const fileBlocks: string[] = []
  if (curatedFrames.length > 0) {
    const urlByPath = new Map(files.map((f) => [f.path, f.url]))
    const curatedLines = curatedFrames.flatMap((fr) => {
      const url = urlByPath.get(fr.path)
      if (url === undefined) return [] // curated frame whose file is gone — skip it
      const stamp = fr.atMs === null ? '' : `[${mmss(fr.atMs)}] `
      return [`${stamp}${fr.path} — ${fr.caption} — ${url}`]
    })
    fileBlocks.push('--- key frames (curated) ---', curatedLines.join('\n'))
  }

  const listLines: string[] = []
  let framesOmitted = 0
  if (curatedFrames.length > 0) {
    for (const f of files) {
      if (isFrame(f.path)) {
        framesOmitted++
        continue
      }
      listLines.push(`${f.path} — ${f.url}`)
    }
    if (framesOmitted > 0) {
      listLines.push(
        `(+${framesOmitted} frames omitted — the curated set above is what matters; fetch the rest via the files list of GET /api/ingest/walkthroughs/:id)`
      )
    }
  } else {
    let framesShown = 0
    for (const f of files) {
      if (isFrame(f.path)) {
        if (framesShown >= maxFrames) {
          framesOmitted++
          continue
        }
        framesShown++
      }
      listLines.push(`${f.path} — ${f.url}`)
    }
    if (framesOmitted > 0) {
      listLines.push(
        `(+${framesOmitted} more frames omitted; fetch via files list of GET /api/ingest/walkthroughs/:id)`
      )
    }
  }
  fileBlocks.push('--- files ---', listLines.join('\n'))

  const framing = intentFraming(intent)

  return [
    ...(framing ? [framing] : []),
    JSON.stringify(meta, null, 2),
    ...(summaryMd ? ['--- summary ---', summaryMd] : []),
    ...(projectInstructions ? ['--- project instructions ---', projectInstructions] : []),
    '--- report.md ---',
    reportMd ?? '(no report.md was uploaded with this walkthrough)',
    // The reviewer's cut spans: markers only (the video is never re-encoded), so
    // the agent must be told not to trust anything shown inside them.
    ...(curation && curation.excluded.length > 0
      ? [
          '--- removed from this walkthrough ---',
          [
            ...curation.excluded.map((s) => `${mmss(s.startMs)}–${mmss(s.endMs)} — ${s.reason}`),
            'These stretches were cut by the reviewer — ignore anything the video or keyframes show inside them.',
          ].join('\n'),
        ]
      : []),
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
    ...fileBlocks,
  ].join('\n\n')
}
