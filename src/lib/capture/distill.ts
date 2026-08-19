import { decodeMono } from './audio'
import { containerFor } from './container'
import { mmss, recDirName } from './format'
import { extractFrames } from './frames'
import { makeGrids, type GridFrame } from './grids'
import { polishTranscript } from './polish'
import { probeClip } from './probe'
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
  ClipInput,
  DistillResult,
  Recording,
  RecordingFrame,
  Session,
  StageProgress,
  TranscriptSegment,
} from './types'

/**
 * The phone-side pipeline, end to end: already-recorded clips in, an uploaded
 * walkthrough out. It produces exactly what the recorder extension produces —
 * dedup'd keyframes, 3×3 contact sheets, a cloud transcript, the cleanup pass,
 * report.md and MANIFEST.txt, declared and PUT and finalized — because the
 * viewer, `cli/push.ts` and the MCP brief all read that one file set.
 *
 * One clip at a time, on purpose: a phone has a few hundred MB of headroom and
 * a decoded minute of audio is ~2 MB of Float32 before the frames are counted.
 */

export interface DistillOptions {
  token: string
  /** null = the token owner's personal space. */
  teamId: string | null
  projectId: string | null
  title: string
  /**
   * 'human' = the video is the deliverable: no keyframes, no contact sheets and
   * no report.md (there is no agent to brief — the walkthrough is hidden from
   * agent lists), but the transcript work and the rest of the file set are
   * unchanged, so the viewer's cloud editor reads a human upload exactly like
   * an extension one. Same contract as live-upload.ts's human branch.
   */
  kind?: 'agent' | 'human'
  onProgress: (p: StageProgress) => void
  signal?: AbortSignal
}

/** One decimal, no unit — the caller writes the "MB" once for the pair. */
function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

export async function distillAndUpload(
  clips: ClipInput[],
  opts: DistillOptions
): Promise<DistillResult> {
  if (!clips.length) throw new Error('pick a clip first')
  const count = clips.length
  const now = Date.now()

  const stop = () => {
    if (opts.signal?.aborted) throw new Error('cancelled')
  }
  /** Cancellation travels as an error like any other; it is the one nothing may swallow. */
  const cancelled = (error: unknown): boolean =>
    Boolean(opts.signal?.aborted) || (error instanceof Error && error.message === 'cancelled')
  /** Local progress within one clip, scaled onto the whole run. -1 stays -1. */
  const report = (stage: CaptureStage, clipIdx: number, local: number, detail?: string) => {
    const pct = local < 0 ? -1 : (clipIdx + Math.min(1, Math.max(0, local))) / count
    opts.onProgress({ stage, pct, detail })
  }
  const text = (path: string, body: string): CaptureFile => {
    const contentType = contentTypeFor(path)
    return { path, blob: new Blob([body], { type: contentType }), contentType }
  }

  // Phones name clips unhelpfully but stamp them honestly, so recording order is
  // the file's own mtime. Clips that carry none keep the order they were picked in.
  const ordered = clips
    .map((clip, position) => ({
      file: clip.file,
      probe: clip.probe,
      position,
      at: Number.isFinite(clip.file.lastModified) ? clip.file.lastModified : 0,
    }))
    .sort((a, b) => a.at - b.at || a.position - b.position)

  const session: Session = {
    id: crypto.randomUUID(),
    name: opts.title,
    slug: slugify(opts.title),
    createdAt: now,
    updatedAt: now,
    origin: '',
    recCount: clips.length,
  }

  const takes: Recording[] = []
  const files: CaptureFile[] = []
  let transcribed = false
  let polished = false

  for (const [i, entry] of ordered.entries()) {
    stop()
    const file = entry.file
    const index = i + 1
    const dir = recDirName(index)
    const label = count > 1 ? `clip ${index} of ${count}` : file.name

    // Reading a clip is the most expensive thing that happens before any real
    // work does — a minute per clip on an iPhone, because readying a blob-URL
    // video there is slow. The picker already paid it, so when it hands its
    // probe over the pipeline takes it rather than decoding the file twice.
    report('probe', i, -1, label)
    const probe = entry.probe ?? (await probeClip(file))
    // The poster is for a picker screen; nothing here shows one. A borrowed
    // probe's poster belongs to whoever lent it — only revoke our own.
    if (!entry.probe && probe.posterUrl) URL.revokeObjectURL(probe.posterUrl)

    // Audio first, frames second, and the order is load-bearing. Decoding the
    // audio pulls the whole file in as an ArrayBuffer and then holds a Float32
    // channel of it — a spike measured in hundreds of MB on a long clip. Six
    // hundred JPEG blobs are a comparable pile. Overlapping the two is what kills
    // the tab, so the spike is taken and released before a single frame exists.
    report('audio', i, -1, label)
    let audio = await decodeMono(file)
    let transcript: TranscriptSegment[] = []
    if (audio) {
      report('transcribe', i, 0, label)
      const heard = await transcribeInCloud(audio, {
        token: opts.token,
        signal: opts.signal,
        onProgress: (fraction) => report('transcribe', i, fraction, label),
      })
      // Megabytes per minute of clip; the frames below need the room.
      audio = null
      if (heard) {
        transcribed = true
        transcript = heard
      }
    }
    stop()

    let takePolished = false
    if (transcript.length) {
      report('polish', i, -1, label)
      const cleaned = await polishTranscript(transcript, {
        token: opts.token,
        signal: opts.signal,
      })
      if (cleaned) {
        transcript = cleaned
        takePolished = true
        polished = true
      }
    }
    stop()

    // Keyframes and the contact sheets drawn from them are best-effort, and they
    // are the only stage that is. A phone decoder that will not step through a
    // long recording — the iOS case this exists for — costs the walkthrough its
    // stills; it must not cost the walkthrough. Video, transcript and report all
    // ship regardless, and the take degrades to zero frames.
    //
    // The rollback is the whole stage at once: half a set of frames with no
    // sheets would leave report.md citing grid files nobody wrote.
    let kept: RecordingFrame[] = []
    let sampled = 0
    const framesMark = files.length
    try {
      let frames: RecordingFrame[] = []
      let frameBlobs = new Map<number, Blob>()
      // A human handback distils nothing — the clip ships whole and stills
      // would only be storage. The stage never runs, so its rows never light.
      if (probe.hasVideo && opts.kind !== 'human') {
        const total = mmss(probe.durationMs)
        report('frames', i, 0, `0:00 of ${total}`)
        const extracted = await extractFrames(file, probe.durationMs, {
          signal: opts.signal,
          onProgress: (fraction) =>
            report('frames', i, fraction, `${mmss(fraction * probe.durationMs)} of ${total}`),
        })
        frames = extracted.frames
        frameBlobs = extracted.blobs
        sampled = extracted.sampled
      }
      stop()

      // Only frames whose JPEG exists ship, and the take carries only those — the
      // report's citations, the sheets and the declared counts then all describe
      // what is actually in the upload.
      const gridFrames: GridFrame[] = []
      for (const frame of frames) {
        const blob = frameBlobs.get(frame.index)
        if (!blob) continue
        files.push({ path: `${dir}/${frame.file}`, blob, contentType: contentTypeFor(frame.file) })
        kept.push(frame)
        gridFrames.push({ blob, label: frame.file.split('/').pop() ?? frame.file })
      }
      // `files` owns every surviving blob now; the extractor's own map does not.
      frameBlobs = new Map()
      frames = []

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
    } catch (error) {
      if (cancelled(error)) throw error
      files.length = framesMark
      kept = []
      sampled = 0
      report('frames', i, 1, 'keyframes unavailable on this phone — shipping video + transcript')
    }
    stop()

    const container = containerFor(file.type, probe.hasVideo)
    const startedAt = entry.at || now
    const take: Recording = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      index,
      createdAt: startedAt,
      state: 'done',
      mime: file.type,
      chunks: 0,
      meta: {
        startedAt,
        durationMs: probe.durationMs,
        sampled,
        frames: kept,
        transcript,
        ...(transcript.length ? { transcriber: 'groq' as const } : {}),
        ...(takePolished ? { polished: true } : {}),
        events: [],
        videoFile: container.videoFile,
      },
    }
    takes.push(take)
    // Both are written even when the take has neither frames nor words — the
    // extension writes them unconditionally and a reader counts on them existing.
    files.push(text(`${dir}/transcript.txt`, buildTranscriptTxt(take.meta)))
    files.push(text(`${dir}/recording.json`, buildRecordingJson(session, take)))
    files.push({
      path: `${dir}/${container.videoFile}`,
      blob: file,
      contentType: container.contentType,
    })
  }

  stop()
  // The summaries describe the whole set, so they go last — written from the
  // takes as shipped, not as recorded. A human handback gets no report.md: the
  // brief is authored for an agent, and this walkthrough never reaches one.
  if (opts.kind !== 'human') {
    opts.onProgress({ stage: 'build', pct: -1 })
    files.push(text('report.md', buildReport(session, takes)))
  }
  files.push(text('MANIFEST.txt', buildManifestTxt(session, takes)))

  stop()
  const result = await uploadWalkthrough(session, takes, files, {
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
    frameCount: takes.reduce((n, t) => n + t.meta.frames.length, 0),
    lineCount: takes.reduce((n, t) => n + t.meta.transcript.length, 0),
    durationMs: takes.reduce((n, t) => n + t.meta.durationMs, 0),
    transcribed,
    polished,
  }
}
