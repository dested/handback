// The recording half of the agent brief, rebuilt from the stored files on every
// pull. Each take's recording.json goes through the library's own reader and
// report writer (`@dested/video-to-prompt`), so every walkthrough, old uploads
// included, reads as the current format: Start here, errors beside frames, the
// verbatim narration on one timeline. And it reads as it is now, not as it was
// at upload: a re-transcribed take shows its new words, a reviewer's cut is left
// out and marked, and Refine's vision captions sit beside their frames.
//
// The S3 report.md the recorder wrote stays untouched; it is the fallback when a
// take's recording.json can't be read.

import {
  buildReport,
  evidenceAt,
  framePos,
  partSpans,
  rankFrames,
  readRecordingJson,
  recDirName,
  type Recording,
  type ReportCut,
} from '@dested/video-to-prompt'
import sharp from 'sharp'
import { env } from './env'
import { closeUpsOf, type CloseUpOf } from './frame-labels'
import { log } from './logger'
import { getObjectText, walkthroughKey } from './storage'

/** What Handback's recorders write as `transcriber`, in words an agent can weigh. */
const TRANSCRIBER_LABELS: Record<string, string> = {
  // The id predates Deepgram: the cloud path prefers nova-3 and falls back to Groq.
  groq: 'hosted speech-to-text (Deepgram nova-3 or Whisper large-v3-turbo)',
  cloud: 'hosted speech-to-text (Deepgram nova-3 or Whisper large-v3-turbo)',
  whisper: 'Whisper small.en, on-device',
}

export type BriefTake = { index: number; dir: string; videoPath: string | null }

export type BriefCuration = {
  frames: Array<{ path: string; caption: string; atMs: number | null }>
  excluded: Array<{ startMs: number; endMs: number; reason: string }>
}

export type FrameRef = { path: string; atMs: number; what: string }

/** What the recording holds where a key point is pinned. */
export type PointEvidence = {
  said?: { text: string; atMs: number; endMs: number; speaker?: number }
  frame?: FrameRef
  error?: { message: string; atMs: number }
}

export type StartHereFrame = FrameRef & { line?: string; error?: string }

export type RecordingBrief = {
  /** The v2 report, rebuilt from recording.json. */
  recordingMd: string
  /** The report's Start here frames, as data. */
  startHere: StartHereFrame[]
  /** Evidence per key point id, for points pinned to a moment. */
  evidence: Record<string, PointEvidence>
  /** Every keyframe's position on the walkthrough clock, by path. */
  frameAt: Record<string, number>
  /** Library 1.2+ close-ups, by path: the frame each one sits on. */
  closeUps: Record<string, CloseUpOf>
}
/**
 * Every take's recording.json, parsed. Null when any one is missing or
 * unreadable: a report silently missing a take is worse than the stored one.
 */
export async function loadRecordings(
  space: string,
  walkthroughId: string,
  takes: BriefTake[]
): Promise<Recording[] | null> {
  if (takes.length === 0) return null
  try {
    const recordings = await Promise.all(
      takes.map(async (take) => {
        const text = await getObjectText(
          walkthroughKey(space, walkthroughId, `${take.dir}/recording.json`)
        )
        const recording = recordingFromJson(text, take.index)
        if (!recording) throw new Error(`${take.dir}/recording.json is not a recording`)
        return recording
      })
    )
    return recordings
  } catch (err) {
    log.warn(`[brief] recordings unreadable for walkthrough ${walkthroughId}: ${String(err)}`)
    return null
  }
}

/** One take's recording.json as Handback reads it: its transcriber named in words. Null when it isn't a recording. */
export function recordingFromJson(text: string, index: number): Recording | null {
  const read = readRecordingJson(text)
  if (!read) return null
  const meta = read.recording.meta
  const label = meta.transcriber ? TRANSCRIBER_LABELS[meta.transcriber] : undefined
  return {
    ...read.recording,
    // The row is the authority on which folder this take is.
    index,
    meta: label && !meta.transcriberLabel ? { ...meta, transcriberLabel: label } : meta,
  }
}

export type BriefInput = {
  id: string
  title: string
  slug: string
  origin: string | null
  recordedAt: Date
  takes: BriefTake[]
  curation: BriefCuration | null
  points: Array<{ id: string; atMs: number | null }> | null
}

/** The reviewer's cut spans, as the library's cuts. */
export function cutsOf(curation: BriefCuration | null): ReportCut[] {
  return (curation?.excluded ?? []).map((s) => ({
    fromMs: s.startMs,
    toMs: s.endMs,
    reason: s.reason,
  }))
}

/** Pure: the report, its Start here and the key-point evidence, from parsed takes. */
export function briefFromRecordings(input: BriefInput, recordings: Recording[]): RecordingBrief {
  const cuts = cutsOf(input.curation)
  const captions: Record<string, string> = {}
  for (const f of input.curation?.frames ?? []) {
    if (f.caption.trim()) captions[f.path] = f.caption.trim()
  }
  const videoByIndex = new Map(input.takes.map((t) => [t.index, t.videoPath]))
  const recordedAt = input.recordedAt.getTime()

  const recordingMd = buildReport(
    {
      id: input.id,
      name: input.title,
      slug: input.slug,
      createdAt: recordedAt,
      updatedAt: recordedAt,
      origin: input.origin ?? '',
      recCount: recordings.length,
    },
    recordings,
    {
      url: `${env.BETTER_AUTH_URL}/walkthroughs/${input.id}`,
      urlHint: 'the page a human reviews it on',
      source: 'Handback',
      pathsHint:
        'pass a frame or contact-sheet path to `get_images`, any other path to `get_file`, with this walkthrough id',
      polishedBy: 'Claude',
      videoPath: (part, file) => videoByIndex.get(part) ?? `${recDirName(part)}/${file}`,
      cuts,
      captions,
    }
  )

  const startHere = rankFrames(recordings, { cuts }).map((r) => ({
    path: r.path,
    atMs: r.pos,
    what: r.what,
    ...(r.line ? { line: r.line } : {}),
    ...(r.error ? { error: r.error } : {}),
  }))

  const evidence: Record<string, PointEvidence> = {}
  for (const p of input.points ?? []) {
    if (p.atMs === null) continue
    const e = evidenceAt(recordings, p.atMs, { cuts })
    evidence[p.id] = {
      ...(e.line
        ? {
            said: {
              text: e.line.text,
              atMs: e.line.pos,
              endMs: e.line.end,
              ...(e.line.speaker === undefined ? {} : { speaker: e.line.speaker }),
            },
          }
        : {}),
      ...(e.frame ? { frame: { path: e.frame.path, atMs: e.frame.pos, what: e.frame.what } } : {}),
      ...(e.error ? { error: { message: e.error.message, atMs: e.error.pos } } : {}),
    }
  }

  const spans = partSpans(recordings)
  const frameAt: Record<string, number> = {}
  for (const rec of recordings) {
    for (const f of rec.meta.frames) {
      frameAt[`${recDirName(rec.index)}/${f.file}`] = framePos(rec, f, spans)
    }
  }

  return { recordingMd, startHere, evidence, frameAt, closeUps: closeUpsOf(recordings) }
}

// The evidence set and image labels live in frame-labels.ts (no env, so tests import them).
export { evidenceImages, imageLabel, type EvidenceImage } from './frame-labels'

// ── images for the agent ─────────────────────────────────────────────────────

/**
 * Longest edge of an image handed to an agent inline. Claude Code caps an
 * image-bearing tool result at 25k tokens by default; six frames at this size
 * stay well under it, and UI text still reads.
 */
export const INLINE_EDGE = 1600
/** `get_file` serves an image near full size, for reading small text. */
export const FULL_EDGE = 2576

/** An image re-encoded for a model: JPEG, longest edge capped, never enlarged. */
export async function imageForAgent(
  bytes: Uint8Array,
  maxEdge: number
): Promise<{ data: string; mimeType: 'image/jpeg' }> {
  const out = await sharp(bytes)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  return { data: out.toString('base64'), mimeType: 'image/jpeg' }
}
