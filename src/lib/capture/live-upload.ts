import { sourceToOutputMs, type EditSegment, type EditState } from '../edit/edl'
import { decodeMono } from './audio'
import { containerFor } from './container'
import { recDirName } from './format'
import { makeGrids, type GridFrame } from './grids'
import { blobs, putTake, type LiveTake } from './live-store'
import { polishTranscript } from './polish'
import {
  buildManifestTxt,
  buildRecordingJson,
  buildReport,
  buildTranscriptTxt,
  sheetFile,
} from './report'
import { slugify } from './slug'
import { transcribeInCloud } from './transcribe'
import { contentTypeFor, uploadWalkthrough, type CaptureFile } from './upload'
import type {
  CaptureStage,
  DistillResult,
  RecordingFrame,
  Session,
  StageProgress,
  TranscriptSegment,
} from './types'

/**
 * The other half of a web recording: takes that already exist on disk in, an
 * uploaded walkthrough out.
 *
 * `distill.ts` is the same journey starting one step earlier — it has to pull
 * keyframes out of a finished clip by seek-stepping it. Here the recorder
 * already kept them as it went, exactly like the extension's, so this picks up
 * at the audio and shares everything downstream: the same transcriber and
 * cleanup pass, the same 3×3 contact sheets, the same `report.md`,
 * `MANIFEST.txt` and `rec-NN/recording.json` builders, the same two-phase
 * upload. That is the point — the viewer, `cli/push.ts` and the MCP brief all
 * read one file set, and it must not matter which door a walkthrough came
 * through.
 */

export interface LiveUploadOptions {
  token: string
  /** null = the token owner's personal space. */
  teamId: string | null
  projectId: string | null
  title: string
  /**
   * 'human' = the video is the deliverable: no contact sheets and no report.md
   * (there is no agent to brief — the walkthrough is hidden from agent lists),
   * but the per-take transcript work and file set are unchanged, so the viewer
   * and the /w page read a human upload exactly like any other take set until
   * the editor's final.mp4 supersedes it.
   */
  kind?: 'agent' | 'human'
  onProgress: (p: StageProgress) => void
  signal?: AbortSignal
}

/** One decimal, no unit — the caller writes the "MB" once for the pair. */
function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

/**
 * Give one take its transcript, if it doesn't already have one: decode the
 * mic-only shadow (or the mixed webm), transcribe in the cloud, run the cleanup
 * pass, and persist onto the take — so the work survives a failed upload and a
 * retry costs the upload, never Groq. Extracted from the send path so the
 * human-handback editor can run it *before* editing: the transcript is its
 * edit surface.
 */
export async function ensureTranscript(
  take: LiveTake,
  opts: {
    token: string
    signal?: AbortSignal
    onStage?: (stage: 'audio' | 'transcribe' | 'polish', fraction: number) => void
  }
): Promise<void> {
  if (take.meta.transcript.length) return
  const audioSource =
    (await blobs.get(`${take.id}:mic`)) ?? (await blobs.get(`${take.id}:video`)) ?? null
  if (!audioSource) return

  let transcript: TranscriptSegment[] = []
  let takePolished = false

  opts.onStage?.('audio', -1)
  let audio = await decodeMono(audioSource)
  if (audio) {
    opts.onStage?.('transcribe', 0)
    const heard = await transcribeInCloud(audio, {
      token: opts.token,
      signal: opts.signal,
      onProgress: (fraction) => opts.onStage?.('transcribe', fraction),
    })
    // Megabytes per minute of take; whatever runs next wants the room.
    audio = null
    if (heard?.length) transcript = heard
  }
  if (opts.signal?.aborted) throw new Error('cancelled')

  if (transcript.length) {
    opts.onStage?.('polish', -1)
    const cleaned = await polishTranscript(transcript, { token: opts.token, signal: opts.signal })
    if (cleaned) {
      transcript = cleaned
      takePolished = true
    }
  }
  if (!transcript.length) return

  take.meta.transcript = transcript
  if (takePolished) take.meta.polished = true
  take.meta.transcriber = 'groq'
  await putTake(take).catch(() => {})
}

export async function sendLiveWalkthrough(
  sessionId: string,
  takes: LiveTake[],
  opts: LiveUploadOptions
): Promise<DistillResult> {
  if (!takes.length) throw new Error('record something first')
  const count = takes.length
  const now = Date.now()

  const stop = () => {
    if (opts.signal?.aborted) throw new Error('cancelled')
  }
  /** Local progress within one take, scaled onto the whole run. -1 stays -1. */
  const report = (stage: CaptureStage, takeIdx: number, local: number, detail?: string) => {
    const pct = local < 0 ? -1 : (takeIdx + Math.min(1, Math.max(0, local))) / count
    opts.onProgress({ stage, pct, detail })
  }
  const text = (path: string, body: string): CaptureFile => {
    const contentType = contentTypeFor(path)
    return { path, blob: new Blob([body], { type: contentType }), contentType }
  }

  const ordered = [...takes].sort((a, b) => a.index - b.index)
  const first = ordered[0]
  const session: Session = {
    id: sessionId,
    name: opts.title,
    slug: slugify(opts.title),
    createdAt: first ? first.createdAt : now,
    updatedAt: now,
    origin: '',
    recCount: ordered.length,
  }

  const files: CaptureFile[] = []
  const shipped: LiveTake[] = []
  let transcribed = false
  let polished = false

  for (const [i, take] of ordered.entries()) {
    stop()
    const dir = recDirName(take.index)
    const label = count > 1 ? `take ${take.index} of ${count}` : `take ${take.index}`

    // A transcript already on the take is one a previous attempt paid for — a
    // retry after a failed upload costs the upload again, never Groq. The mic
    // shadow / decode / transcribe / polish rules live in ensureTranscript.
    await ensureTranscript(take, {
      token: opts.token,
      signal: opts.signal,
      onStage: (stage, fraction) => report(stage, i, fraction, label),
    })
    const transcript = take.meta.transcript
    const takePolished = Boolean(take.meta.polished)
    if (transcript.length) transcribed = true
    if (takePolished) polished = true
    stop()

    // Only frames whose JPEG is still on disk ship, and the take carries only
    // those — the report's citations, the sheets and the declared counts then
    // all describe what is actually in the upload. A pristine take sampled no
    // frames, so the human path walks an empty list and says nothing about it
    // (its stage rows don't have a keyframes line to light).
    if (opts.kind !== 'human') report('frames', i, 0, label)
    const kept: RecordingFrame[] = []
    const gridFrames: GridFrame[] = []
    for (const frame of take.meta.frames) {
      const blob = await blobs.get(`${take.id}:frame:${frame.index}`)
      if (!blob) continue
      files.push({ path: `${dir}/${frame.file}`, blob, contentType: contentTypeFor(frame.file) })
      kept.push(frame)
      gridFrames.push({ blob, label: frame.file.split('/').pop() ?? frame.file })
    }
    if (opts.kind !== 'human') report('frames', i, 1, label)
    stop()

    if (gridFrames.length) {
      report('sheets', i, 0, label)
      // Nine at a time in frame order — exactly how report.ts maps a frame to its sheet.
      for (const [n, sheet] of (await makeGrids(gridFrames)).entries()) {
        const path = sheetFile(n + 1, `${dir}/`)
        files.push({ path, blob: sheet, contentType: contentTypeFor(path) })
      }
      // The sheets are drawn; these were only ever the source pixels.
      gridFrames.length = 0
    }
    stop()

    const video = await blobs.get(`${take.id}:video`)
    const container = containerFor(video?.type || take.mime, true)
    const outgoing: LiveTake = {
      ...take,
      meta: {
        ...take.meta,
        frames: kept,
        transcript,
        ...(transcript.length ? { transcriber: 'groq' as const } : {}),
        ...(takePolished ? { polished: true } : {}),
        videoFile: container.videoFile,
      },
    }
    shipped.push(outgoing)

    // Both are written even when the take has neither frames nor words — the
    // extension writes them unconditionally and a reader counts on them existing.
    files.push(text(`${dir}/transcript.txt`, buildTranscriptTxt(outgoing.meta)))
    files.push(text(`${dir}/recording.json`, buildRecordingJson(session, outgoing)))
    if (video) {
      files.push({
        path: `${dir}/${container.videoFile}`,
        blob: video,
        contentType: container.contentType,
      })
    }
  }

  stop()
  // The summaries describe the whole set, so they go last — written from the
  // takes as shipped, not as recorded. A human handback gets no report.md: the
  // brief is authored for an agent, and this walkthrough never reaches one.
  if (opts.kind !== 'human') {
    opts.onProgress({ stage: 'build', pct: -1 })
    files.push(text('report.md', buildReport(session, shipped)))
  }
  files.push(text('MANIFEST.txt', buildManifestTxt(session, shipped)))

  stop()
  const result = await uploadWalkthrough(session, shipped, files, {
    token: opts.token,
    teamId: opts.teamId,
    projectId: opts.projectId,
    ...(opts.kind ? { kind: opts.kind } : {}),
    signal: opts.signal,
    onProgress: (p) => {
      if (p.phase === 'upload') {
        opts.onProgress({
          stage: 'upload',
          pct: p.bytesTotal ? p.bytesDone / p.bytesTotal : 0,
          // Megabytes, not files: one video is 99% of the bytes and 1 of ~600
          // rows, so a file count reads as stuck for the whole upload.
          detail: `${megabytes(p.bytesDone)} of ${megabytes(p.bytesTotal)} MB`,
        })
        return
      }
      opts.onProgress({ stage: p.phase, pct: -1 })
    },
  })

  return {
    walkthroughId: result.walkthroughId,
    url: result.url,
    frameCount: shipped.reduce((n, t) => n + t.meta.frames.length, 0),
    lineCount: shipped.reduce((n, t) => n + t.meta.transcript.length, 0),
    durationMs: shipped.reduce((n, t) => n + t.meta.durationMs, 0),
    transcribed,
    polished,
  }
}

/** The rendered tight edit, handed over by the editor for upload. */
export interface HumanEdit {
  /** The whole edit as data — serialized into edit.json for a future re-edit. */
  state: EditState
  /** The kept spans, output order — what the render actually contains. */
  segments: EditSegment[]
  /** final.mp4. */
  video: Blob
  durationMs: number
}

/**
 * Upload a human handback: the edited render is the artifact. Files are
 * `final.mp4`, `transcript.json` (the surviving lines, re-timed onto the
 * edited timeline), and `edit.json` (the EDL, so a future editor can re-cut).
 * Raw takes deliberately stay local — a 30 fps capture would eat the space
 * quota for a video whose tight cut already shipped. No report.md, no frames:
 * there is no agent on the other end of this one.
 */
export async function sendHumanWalkthrough(
  sessionId: string,
  takes: LiveTake[],
  edit: HumanEdit,
  opts: LiveUploadOptions
): Promise<DistillResult> {
  if (!takes.length) throw new Error('record something first')
  const now = Date.now()
  const stop = () => {
    if (opts.signal?.aborted) throw new Error('cancelled')
  }
  const text = (path: string, body: string): CaptureFile => {
    const contentType = contentTypeFor(path)
    return { path, blob: new Blob([body], { type: contentType }), contentType }
  }

  const ordered = [...takes].sort((a, b) => a.index - b.index)
  const first = ordered[0]
  const session: Session = {
    id: sessionId,
    name: opts.title,
    slug: slugify(opts.title),
    createdAt: first ? first.createdAt : now,
    updatedAt: now,
    origin: '',
    recCount: ordered.length,
  }

  // Surviving lines, moved onto the edited clock. A line whose start was cut
  // is gone — its words are not in the video, and a transcript that says
  // otherwise would lie to the person scrubbing by it.
  const byId = new Map(ordered.map((t) => [t.id, t]))
  const lines: Array<{ at: string; tMs: number; endMs: number; text: string }> = []
  for (const takeId of edit.state.takeOrder) {
    const take = byId.get(takeId)
    if (!take) continue
    for (const line of take.meta.transcript) {
      const out = sourceToOutputMs(edit.segments, takeId, line.t)
      if (out === null) continue
      lines.push({
        at: new Date(take.meta.startedAt + line.t).toISOString(),
        tMs: Math.round(out),
        endMs: Math.round(Math.min(out + (line.d ?? 1500), edit.durationMs)),
        text: line.text,
      })
    }
  }
  lines.sort((a, b) => a.tMs - b.tMs)

  const files: CaptureFile[] = [
    { path: 'final.mp4', blob: edit.video, contentType: 'video/mp4' },
    text('transcript.json', JSON.stringify({ lines }, null, 2)),
    text(
      'edit.json',
      JSON.stringify(
        { ...edit.state, segments: edit.segments, renderedDurationMs: edit.durationMs },
        null,
        2
      )
    ),
  ]

  stop()
  const result = await uploadWalkthrough(session, ordered, files, {
    token: opts.token,
    teamId: opts.teamId,
    projectId: opts.projectId,
    kind: 'human',
    // The inbox row should read as the video a human will watch, not the sum
    // of the raw takes it was cut from.
    durationMs: edit.durationMs,
    signal: opts.signal,
    onProgress: (p) => {
      if (p.phase === 'upload') {
        opts.onProgress({
          stage: 'upload',
          pct: p.bytesTotal ? p.bytesDone / p.bytesTotal : 0,
          detail: `${megabytes(p.bytesDone)} of ${megabytes(p.bytesTotal)} MB`,
        })
        return
      }
      opts.onProgress({ stage: p.phase, pct: -1 })
    },
  })

  return {
    walkthroughId: result.walkthroughId,
    url: result.url,
    frameCount: 0,
    lineCount: lines.length,
    durationMs: edit.durationMs,
    transcribed: ordered.some((t) => t.meta.transcript.length > 0),
    polished: ordered.some((t) => Boolean(t.meta.polished)),
  }
}
