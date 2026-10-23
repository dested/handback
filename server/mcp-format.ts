// How a walkthrough reads to an agent. Pure string work, no imports — shared by the
// hosted MCP endpoint (`server/mcp.ts`) and the stdio one (`cli/mcp.ts`) so a
// walkthrough looks identical whichever way it was pulled.
//
// The brief is written for a model like Opus 5.5, which needs evidence and
// orientation more than instruction. Order: what the recording is for, the key
// points with the evidence for each (the words, the frame, the error), whatever
// humans said since (review thread, comments, project instructions), Refine's
// working brief labelled as model-written, then the recording itself (the v2
// report, rebuilt server-side, verbatim narration on one timeline). Files are
// listed as paths: images come through `get_images`, everything else through
// `get_file`, so the brief carries no wall of presigned URLs.

/** Structural, not nominal: the hosted server passes its detail object and the
 *  stdio client passes a parsed wire body, possibly from an older server, so
 *  everything past the original fields is optional. */
export type FormattableWalkthrough = {
  reportMd: string | null
  files: Array<{ path: string; url: string }>
  // What the recording is FOR — drives the intent framing line.
  intent?: string | null
  // Refine's outputs, when it ran. The digest and the summary ledger are for
  // humans; the brief carries the key points and the working brief instead.
  summaryMd?: string | null
  digestMd?: string | null
  points?: Array<{
    id: string
    title: string
    detail: string
    severity: string
    atMs: number | null
    evidence?: {
      said?: { text: string; atMs: number; endMs: number }
      frame?: { path: string; atMs: number; what: string }
      error?: { message: string; atMs: number }
    }
  }> | null
  projectInstructions?: string | null
  curation?: {
    frames: Array<{ path: string; caption: string; atMs: number | null }>
    excluded: Array<{ startMs: number; endMs: number; reason: string }>
  } | null
  // From servers since 2026-10-15: the parts reportMd used to be one of.
  briefMd?: string | null
  refinedBriefMd?: string | null
  recordingMd?: string | null
  recordingRebuilt?: boolean
  startHere?: Array<{ path: string; atMs: number; what: string }>
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
  missingFiles?: Array<{
    label: string
    quote: string | null
    atMs: number | null
  }>
  [key: string]: unknown
}

/** m:ss on the walkthrough-wide clock, floored — how comments and key points are stamped. */
const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

/** m:ss rounded to the nearest second — how the recording's own report stamps frames
 *  and lines, so a time quoted from it matches the timeline character for character. */
export const recStamp = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// A walkthrough can carry thousands of keyframes. The brief names them by path;
// get_frames pages their download URLs.

/** get_frames paging window — the default and hard-max frames one call returns. */
export const FRAMES_PAGE_DEFAULT = 120
export const FRAMES_PAGE_MAX = 300

/**
 * Recording order for frame paths: take folder, then the frame number that
 * leads the file name. Names are `NN-mmss.jpg` with NN only padded to two, so
 * past frame 99 a plain path sort puts `100-…` before `11-…`.
 */
export function byFrameOrder(a: string, b: string): number {
  const parse = (p: string) => {
    const m = /^(.*)\/frames\/(\d+)-/.exec(p)
    return m ? { dir: m[1] ?? '', n: Number(m[2]) } : { dir: p, n: -1 }
  }
  const x = parse(a)
  const y = parse(b)
  return x.dir.localeCompare(y.dir) || x.n - y.n || a.localeCompare(b)
}

/** Tool descriptions, shared so both servers say exactly the same thing. */
export const TOOL_DESCRIPTIONS = {
  get_walkthrough:
    "Fetch one walkthrough's brief: a narrated screen recording a human made in the running app (a bug, review feedback, or a change request). It holds the key points to address with the evidence for each, the review thread and comments, and the recording itself: every keyframe and spoken line on one timeline, by file path. Call get_images next to see the evidence frames.",
  get_images:
    'See a walkthrough’s frames and contact sheets as images, at most 6 per call. With no paths: the evidence set, each key point’s frame and then the frames the report says to start with, labelled with time and why. With paths (from the brief): those images. A close-up (one region of the screen at full resolution) is labelled with the frame it sits on, and the evidence set shows that frame first. Each image is downscaled to 1600 px; get_file serves one near full size.',
  get_frames: `Page download URLs for a walkthrough's keyframes, in the order they were recorded (get_images shows them as images). Returns { total, offset, limit, returned, nextOffset, frames:[{path,url,closeUpOf?}] }; closeUpOf marks a close-up, one region of the screen at full resolution, and names the frame whose screen it sits on (the rest of the screen was that frame). Keep calling with offset = the previous nextOffset until nextOffset is null. Default ${FRAMES_PAGE_DEFAULT} frames per call, max ${FRAMES_PAGE_MAX}.`,
  get_file:
    'Read one file of a walkthrough by its path from the brief: text files (transcript.txt, recording.json, MANIFEST.txt, attached notes) come back as text, an image near full size, anything else (the video, a PDF) as a download URL.',
} as const

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

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null

/** Title plus one line of the facts an agent acts on: the id its tools take,
 *  whose space this is, where it stands, and what was captured. */
function header(w: FormattableWalkthrough): string[] {
  const title = str(w.title) ?? str(w.slug) ?? 'Walkthrough'
  const facts: string[] = []
  const id = str(w.id)
  if (id) facts.push(`walkthroughId ${id}`)
  const space = str(w.space)
  if (space) facts.push(`space ${space}`)
  const status = str(w.status)
  if (status) facts.push(`status ${status}`)
  const recordedAt = str(w.recordedAt)
  if (recordedAt) facts.push(`recorded ${recordedAt}`)
  const duration = int(w.durationMs)
  if (duration) facts.push(recStamp(duration))
  const takes = Array.isArray(w.takes) ? w.takes.length : 0
  if (takes > 1) facts.push(`${takes} takes`)
  const origin = str(w.origin)
  if (origin) facts.push(`on ${origin}`)
  const errors = int(w.errorCount) ?? 0
  const dropped = int(w.droppedCount) ?? 0
  if (errors > 0) facts.push(`${errors} error${errors === 1 ? '' : 's'} captured`)
  if (dropped > 0) facts.push(`${dropped} from other tabs dropped`)
  return [`# ${title}`, facts.join(' · ')]
}

/** Key points as obligations, each carrying what the recording holds where it was raised. */
function keyPoints(points: NonNullable<FormattableWalkthrough['points']>): string {
  const blocks = points.map((p) => {
    const at = p.atMs === null ? '' : ` at ${mmss(p.atMs)}`
    const lines = [`${p.id.toUpperCase()} (${p.severity})${at} — ${p.title}`]
    if (p.detail) lines.push(`  ${p.detail}`)
    const e = p.evidence
    if (e?.said) {
      lines.push(`  said ${recStamp(e.said.atMs)}–${recStamp(e.said.endMs)}: "${e.said.text}"`)
    }
    if (e?.frame) {
      lines.push(`  frame ${e.frame.path} (${recStamp(e.frame.atMs)}, ${e.frame.what})`)
    }
    if (e?.error) lines.push(`  error at ${recStamp(e.error.atMs)}: ${e.error.message}`)
    return lines.join('\n')
  })
  const evidenced = points.some((p) => p.evidence?.said || p.evidence?.frame)
  return [
    ...(evidenced
      ? [
          'A model distilled these from the recording. Under each: the words said where it was raised, the frame that shows it, and any error captured beside it. Check a point against its evidence before acting on it.',
          '',
        ]
      : []),
    blocks.join('\n\n'),
    '',
    "Address every key point. When you post_result, pass outcomes: one entry per key point — {point: 'kp1', status: 'fixed'|'partial'|'skipped'|'not_applicable', note: one line on what you did or why not}.",
  ].join('\n')
}

const isFrame = (path: string) => path.includes('/frames/')
const isSheet = (path: string) => path.includes('/grids/')
const isVideo = (path: string) => /\.(webm|mp4|mov|m4a|mp3|wav)$/i.test(path)

/** Paths, grouped: per take its video (with a URL, for anyone who wants to run
 *  ffmpeg), its frames as a range, its sheets and text files; then the rest.
 *  When the recording was rebuilt, the uploaded report.md is the older copy. */
function fileListing(files: FormattableWalkthrough['files'], rebuilt: boolean): string[] {
  const takes = new Map<string, Array<{ path: string; url: string }>>()
  const loose: Array<{ path: string; url: string }> = []
  for (const f of files) {
    if (f.path.startsWith('attachments/')) continue
    const dir = /^(rec-\d+)\//.exec(f.path)?.[1]
    if (dir) takes.set(dir, [...(takes.get(dir) ?? []), f])
    else loose.push(f)
  }
  const out: string[] = []
  for (const [dir, list] of [...takes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const parts: string[] = []
    for (const v of list.filter((f) => isVideo(f.path))) parts.push(`video ${v.path} — ${v.url}`)
    const frames = list
      .filter((f) => isFrame(f.path))
      .map((f) => f.path)
      .sort(byFrameOrder)
    const first = frames[0]
    const last = frames[frames.length - 1]
    if (first && last) {
      parts.push(
        frames.length === 1 ? `1 frame ${first}` : `${frames.length} frames ${first} … ${last}`
      )
    }
    const sheets = list.filter((f) => isSheet(f.path)).map((f) => f.path)
    if (sheets.length > 0) parts.push(`contact sheets ${sheets.join(', ')}`)
    const other = list
      .filter((f) => !isVideo(f.path) && !isFrame(f.path) && !isSheet(f.path))
      .map((f) => f.path)
    if (other.length > 0) parts.push(other.join(', '))
    out.push(`${dir}: ${parts.join('; ')}`)
  }
  if (loose.length > 0) {
    out.push(
      loose
        .map((f) =>
          rebuilt && f.path === 'report.md'
            ? 'report.md (as uploaded; the recording above is newer)'
            : f.path
        )
        .join(', ')
    )
  }
  return out
}

/** The whole brief. */
export function formatWalkthrough(walkthrough: FormattableWalkthrough): string {
  const w = walkthrough
  const framing = intentFraming(w.intent)
  // A server from before 2026-10-15 sends one document in reportMd.
  const modern = w.recordingMd !== undefined
  const recording = modern ? (w.recordingMd ?? null) : w.reportMd
  const task = modern ? (w.briefMd ?? null) : null
  const working = modern ? (w.refinedBriefMd ?? null) : null
  const rebuilt = w.recordingRebuilt === true

  const attachmentLines = [
    ...w.files.filter((f) => f.path.startsWith('attachments/')).map((f) => f.path),
    ...(w.missingFiles ?? []).map(
      (m) =>
        `MISSING: the recording mentions "${m.label}"${m.atMs === null ? '' : ` at ${mmss(m.atMs)}`} but no file was attached${m.quote ? ` — "${m.quote}"` : ''}`
    ),
  ]

  const hasImages = w.files.some((f) => isFrame(f.path) || isSheet(f.path))
  const listing = fileListing(w.files, rebuilt)
  const filesBlock = [
    hasImages
      ? 'Paths only. Start with get_images(walkthroughId): the key-point frames and the report’s Start here, as images. Any frame or contact sheet below: get_images with its path. Anything else: get_file. Download URLs: get_frames.'
      : 'Paths only: read any of them with get_file.',
    ...listing,
  ].join('\n')

  return [
    ...(framing ? [framing] : []),
    header(w).join('\n'),
    ...(w.points && w.points.length > 0 ? ['--- key points ---', keyPoints(w.points)] : []),
    // On a re-pull, a send-back or an answer is the newest instruction there is.
    ...(w.notes && w.notes.length > 0
      ? ['--- review thread ---', w.notes.map(formatNote).join('\n\n')]
      : []),
    ...(w.comments && w.comments.length > 0
      ? [
          '--- comments ---',
          [
            'Reviewers’ margin notes. Each is an instruction; a stamp is a time on the recording’s clock.',
            ...w.comments.map(
              (c) => `${c.atMs === null ? '' : `[${mmss(c.atMs)}] `}${c.authorName}: ${c.text}`
            ),
          ].join('\n'),
        ]
      : []),
    ...(w.projectInstructions ? ['--- project instructions ---', w.projectInstructions] : []),
    ...(task ? ['--- task ---', task] : []),
    ...(working
      ? [
          '--- working brief ---',
          `Written by a model from the recording below: repro steps and done-when checks per key point. Where it and the recording disagree, the recording wins.\n\n${working}`,
        ]
      : []),
    '--- the recording ---',
    recording ??
      (task
        ? '(This task was split out of a longer walkthrough; the recording lives on that one.)'
        : '(no report came with this walkthrough)'),
    // A rebuilt report already leaves the cut spans out and marks them.
    ...(!rebuilt && w.curation && w.curation.excluded.length > 0
      ? [
          '--- removed from this walkthrough ---',
          [
            ...w.curation.excluded.map((s) => `${mmss(s.startMs)}–${mmss(s.endMs)} — ${s.reason}`),
            'These stretches were cut by the reviewer — ignore anything the video or keyframes show inside them.',
          ].join('\n'),
        ]
      : []),
    ...(attachmentLines.length > 0
      ? [
          '--- attachments ---',
          [
            'Files a human attached to back up the narration; read them like the recording (get_file).',
            ...attachmentLines,
          ].join('\n'),
        ]
      : []),
    ...(listing.length > 0 ? ['--- files ---', filesBlock] : []),
  ].join('\n\n')
}

// ── tool results that carry images ───────────────────────────────────────────

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

/** get_images as MCP content: each image under its label, then what was left out. */
export function imagesContent(result: {
  images: Array<{ label: string; data: string; mimeType: string }>
  skipped: string[]
  more: string[]
}): ToolContent[] {
  const out: ToolContent[] = []
  for (const img of result.images) {
    out.push({ type: 'text', text: img.label })
    out.push({ type: 'image', data: img.data, mimeType: img.mimeType })
  }
  const tail: string[] = []
  if (result.images.length === 0 && result.skipped.length === 0) {
    tail.push(
      'No evidence frames for this walkthrough (no key points pinned to a moment and no rebuilt report). Pass frame or contact-sheet paths from the brief.'
    )
  }
  if (result.skipped.length > 0) {
    tail.push(`Not images of this walkthrough: ${result.skipped.join(', ')}`)
  }
  if (result.more.length > 0) {
    tail.push(`Also in the evidence set (ask by path): ${result.more.join(', ')}`)
  }
  if (result.images.length > 0) tail.push('Near full size: get_file with a path.')
  if (tail.length > 0) out.push({ type: 'text', text: tail.join('\n') })
  return out
}

/** get_file as MCP content. */
export function fileContent(
  file:
    | { kind: 'text'; path: string; contentType: string; text: string }
    | { kind: 'image'; path: string; mimeType: string; data: string }
    | { kind: 'url'; path: string; contentType: string; size: number; url: string }
): ToolContent[] {
  switch (file.kind) {
    case 'text':
      return [{ type: 'text', text: file.text }]
    case 'image':
      return [
        { type: 'text', text: file.path },
        { type: 'image', data: file.data, mimeType: file.mimeType },
      ]
    case 'url':
      return [
        {
          type: 'text',
          text: `${file.path} (${file.contentType}, ${file.size} bytes) isn't text or an image; download it: ${file.url}`,
        },
      ]
  }
}
