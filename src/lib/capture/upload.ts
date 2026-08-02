import { assertAuthorized, authHeaders, explain, finalizePath, INGEST } from './api'
import { recDirName } from './format'
import type { Recording, Session } from './types'

/**
 * Ported from `extension/src/lib/upload.ts`. The same two-phase write as
 * `cli/push.ts` — declare the walkthrough and its whole file list, PUT every
 * file to the presigned URL the declare handed back, then finalize — because
 * that is the only shape `server/ingest.ts` accepts, and a walkthrough that
 * never finalizes is invisible in the space.
 *
 * Nothing here touches storage: the paths the recorder would have written to
 * disk (`report.md`, `MANIFEST.txt`, `rec-NN/…`) are assembled in memory and
 * those paths become the keys in the cloud, so a downloaded walkthrough is a
 * folder `cli/push.ts` can push straight back up.
 */

/** One file of the set, at the path it will live under. */
export interface CaptureFile {
  /** Walkthrough-relative, forward slashes: `report.md`, `rec-01/frames/03-0125.jpg`. */
  path: string
  blob: Blob
  contentType: string
}

export interface UploadProgress {
  phase: 'declare' | 'upload' | 'finalize'
  /** Files fully uploaded so far, and the total the server asked for. */
  done: number
  total: number
  bytesDone: number
  bytesTotal: number
}

export interface UploadResult {
  walkthroughId: string
  /** Relative — this app is the viewer. */
  url: string
}

export interface UploadOptions {
  token: string
  /** null = the token owner's personal space. */
  teamId: string | null
  projectId: string | null
  onProgress?: (p: UploadProgress) => void
}

/** Same table as `cli/push.ts`, so a file pushed either way declares the same type. */
const CONTENT_TYPES: Record<string, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webm: 'video/webm',
}

/** Four at a time: a walkthrough is mostly small JPEGs, and the video wants the bandwidth. */
const UPLOAD_CONCURRENCY = 4

/**
 * Refused before a byte moves. The server enforces its own caps, but a phone on
 * a hotel Wi-Fi should not spend twenty minutes uploading toward a 413.
 */
// Mirrors server/ingest.ts (2 GB/file, 4 GB/walkthrough) — checked here only to
// fail before any bytes move, never as the real limit.
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024

export function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

export function totalBytes(files: CaptureFile[]): number {
  return files.reduce((sum, f) => sum + f.blob.size, 0)
}

/**
 * The declare body. Every field mirrors what `cli/push.ts` derives from the
 * `rec-NN/recording.json` files, so every client produces identical rows.
 */
function declaration(
  session: Session,
  recordings: Recording[],
  files: CaptureFile[],
  opts: UploadOptions
) {
  const paths = new Set(files.map((f) => f.path))
  const takes = [...recordings]
    .sort((a, b) => a.index - b.index)
    .map((rec) => {
      const dir = recDirName(rec.index)
      const videoPath = `${dir}/${rec.meta.videoFile}`
      return {
        index: rec.index,
        dir,
        interrupted: Boolean(rec.interrupted),
        startedAt: new Date(rec.meta.startedAt).toISOString(),
        durationMs: Math.max(0, Math.round(rec.meta.durationMs)),
        frameCount: rec.meta.frames.length,
        // No transcript, no claim about who wrote one.
        ...(rec.meta.transcriber ? { transcriber: rec.meta.transcriber } : {}),
        // Only claim a video the upload actually carries — a take whose blob went
        // missing must not leave the viewer with a link to nothing.
        videoPath: paths.has(videoPath) ? videoPath : undefined,
      }
    })
  const first = takes[0]
  return {
    slug: session.slug,
    title: session.name || session.slug,
    origin: session.origin || undefined,
    ...(opts.projectId ? { projectId: opts.projectId } : {}),
    // Which space this lands in: absent = the token owner's personal one.
    ...(opts.teamId ? { teamId: opts.teamId } : {}),
    // The first take's own clock, not when the phone opened the form.
    recordedAt: first ? first.startedAt : new Date(session.createdAt).toISOString(),
    durationMs: takes.reduce((sum, t) => sum + t.durationMs, 0),
    frameCount: takes.reduce((sum, t) => sum + t.frameCount, 0),
    // A phone clip has no console tap, so there is nothing to count either way.
    errorCount: 0,
    droppedCount: 0,
    takes,
    files: files.map((f) => ({ path: f.path, size: f.blob.size, contentType: f.contentType })),
  }
}

/**
 * Push one walkthrough. Throws with a readable message on any failure — the
 * caller keeps the clips and offers to try again, because a half-uploaded
 * walkthrough is invisible until finalize and re-declaring the same slug
 * replaces it wholesale, so a retry is always safe.
 */
export async function uploadWalkthrough(
  session: Session,
  recordings: Recording[],
  files: CaptureFile[],
  opts: UploadOptions
): Promise<UploadResult> {
  const onProgress = opts.onProgress
  const token = opts.token.trim()
  if (!token) throw new Error('sign in on this phone first')
  if (!recordings.length) throw new Error('nothing recorded yet')
  if (!files.some((f) => f.path === 'report.md')) throw new Error('the report is missing')

  const oversized = files.find((f) => f.blob.size > MAX_FILE_BYTES)
  if (oversized) throw new Error('that clip is over the 2 GB limit — trim it and try again')
  const bytesTotal = totalBytes(files)
  if (bytesTotal > MAX_TOTAL_BYTES) {
    throw new Error('these clips are over the 4 GB limit — upload them in smaller batches')
  }

  const report = (p: Partial<UploadProgress> & { phase: UploadProgress['phase'] }) =>
    onProgress?.({ done: 0, total: files.length, bytesDone: 0, bytesTotal, ...p })

  report({ phase: 'declare' })
  const declareRes = await fetch(INGEST.declare, {
    method: 'POST',
    headers: { ...authHeaders(token), 'content-type': 'application/json' },
    body: JSON.stringify(declaration(session, recordings, files, opts)),
  })
  assertAuthorized(declareRes)
  if (!declareRes.ok) throw await explain('declare', declareRes)
  const { walkthroughId, uploads } = (await declareRes.json()) as {
    walkthroughId: string
    uploads: { path: string; url: string; contentType: string }[]
  }

  const byPath = new Map(files.map((f) => [f.path, f]))
  const queue = [...uploads]
  let done = 0
  let bytesDone = 0
  report({ phase: 'upload', total: uploads.length })
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const file = byPath.get(job.path)
      if (!file) throw new Error(`the server asked for a file we don't have: ${job.path}`)
      // Presigned PUT: the content-type is signed, and no auth header may ride along.
      const res = await fetch(job.url, {
        method: 'PUT',
        headers: { 'content-type': job.contentType },
        body: file.blob,
      })
      if (!res.ok) throw await explain(`upload of ${job.path}`, res)
      done++
      bytesDone += file.blob.size
      report({ phase: 'upload', done, total: uploads.length, bytesDone })
    }
  }
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker))

  report({ phase: 'finalize', done, total: uploads.length, bytesDone })
  const finalizeRes = await fetch(finalizePath(walkthroughId), {
    method: 'POST',
    headers: authHeaders(token),
  })
  assertAuthorized(finalizeRes)
  if (!finalizeRes.ok) throw await explain('finalize', finalizeRes)

  return { walkthroughId, url: `/walkthroughs/${walkthroughId}` }
}
