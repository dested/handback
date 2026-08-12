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
  /** 'human' = the video is the deliverable (hidden from agent lists, viewer
   *  plays the render). Absent = 'agent', the default the server also assumes. */
  kind?: 'agent' | 'human'
  /** Overrides the declared walkthrough duration. The human path sends the
   *  edited render's length — the sum of raw takes would overstate what a
   *  viewer actually watches. Take rows keep their real (source) durations. */
  durationMs?: number
  onProgress?: (p: UploadProgress) => void
  /** Aborts every in-flight PUT and rejects with `cancelled`. */
  signal?: AbortSignal
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
 * A phone on a moving train drops a connection mid-PUT and that is not a lost
 * walkthrough. Three tries per file, backing off, but only for the failures that
 * can heal: a dead socket or a 5xx. A 403 is an expired or wrong presign and
 * will read the same way in three seconds, so it fails straight through.
 */
const PUT_ATTEMPTS = 3
const PUT_BACKOFF_MS = [1000, 3000]

/** The video is the whole upload on this path, so bytes are the only honest progress. */
const PROGRESS_INTERVAL_MS = 250

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
    ...(opts.kind ? { kind: opts.kind } : {}),
    // The first take's own clock, not when the phone opened the form.
    recordedAt: first ? first.startedAt : new Date(session.createdAt).toISOString(),
    durationMs: opts.durationMs ?? takes.reduce((sum, t) => sum + t.durationMs, 0),
    frameCount: takes.reduce((sum, t) => sum + t.frameCount, 0),
    // A phone clip has no console tap, so there is nothing to count either way.
    errorCount: 0,
    droppedCount: 0,
    takes,
    files: files.map((f) => ({ path: f.path, size: f.blob.size, contentType: f.contentType })),
  }
}

function cancelled(): Error {
  return new Error('cancelled')
}

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === 'cancelled'
}

/** `explain()`'s wording, for a transport that has no `Response` to read it off. */
function putFailed(path: string, status: number, body: string): Error {
  const detail = body.trim().slice(0, 200)
  const where = status ? `(${status})` : '(no connection)'
  return new Error(`upload of ${path} failed ${where}${detail ? `: ${detail}` : ''}`)
}

/** Resolves after `ms`, or rejects the moment the run is cancelled. */
function backoff(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled())
      return
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      window.clearTimeout(timer)
      reject(cancelled())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** The status and body of one PUT attempt. A transport failure throws instead. */
interface PutAttempt {
  status: number
  body: string
}

/**
 * One presigned PUT over XHR rather than fetch, for exactly one reason: fetch
 * cannot report how far an upload has got, so a 180 MB video showed the person
 * a still spinner for four minutes and then either worked or didn't.
 */
function putOnce(
  url: string,
  contentType: string,
  blob: Blob,
  onBytes: (loaded: number) => void,
  live: Set<XMLHttpRequest>
): Promise<PutAttempt> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    live.add(xhr)
    const settle = () => live.delete(xhr)
    xhr.open('PUT', url, true)
    // The content-type is signed; no auth header may ride along on a presign.
    xhr.setRequestHeader('content-type', contentType)
    xhr.upload.onprogress = (event) => onBytes(event.loaded)
    xhr.onload = () => {
      settle()
      resolve({ status: xhr.status, body: xhr.responseText ?? '' })
    }
    xhr.onerror = () => {
      settle()
      reject(new Error('network'))
    }
    xhr.ontimeout = () => {
      settle()
      reject(new Error('network'))
    }
    xhr.onabort = () => {
      settle()
      reject(cancelled())
    }
    xhr.send(blob)
  })
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

  if (opts.signal?.aborted) throw cancelled()
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
  /** Bytes of the files that finished. In-flight bytes are added on top, live. */
  let settledBytes = 0
  /** Per-file `loaded` while a PUT is running, so the total never double-counts a retry. */
  const inFlight = new Map<string, number>()
  const live = new Set<XMLHttpRequest>()
  let lastEmit = 0

  const emit = (force: boolean) => {
    const now = Date.now()
    if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return
    lastEmit = now
    let bytesDone = settledBytes
    for (const loaded of inFlight.values()) bytesDone += loaded
    report({ phase: 'upload', done, total: uploads.length, bytesDone })
  }

  // One abort takes down every socket at once; the workers then unwind on the
  // `cancelled` their own PUT rejects with.
  const stopAll = () => {
    for (const xhr of live) xhr.abort()
  }
  opts.signal?.addEventListener('abort', stopAll)

  report({ phase: 'upload', total: uploads.length })
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const file = byPath.get(job.path)
      if (!file) throw new Error(`the server asked for a file we don't have: ${job.path}`)
      if (opts.signal?.aborted) throw cancelled()

      for (let attempt = 1; ; attempt++) {
        inFlight.set(job.path, 0)
        let outcome: PutAttempt
        try {
          outcome = await putOnce(
            job.url,
            job.contentType,
            file.blob,
            (loaded) => {
              inFlight.set(job.path, loaded)
              emit(false)
            },
            live
          )
        } catch (error) {
          inFlight.delete(job.path)
          if (isCancelled(error)) throw error
          // A dead socket is the retryable case; the last attempt still fails.
          if (attempt >= PUT_ATTEMPTS) throw putFailed(job.path, 0, '')
          await backoff(PUT_BACKOFF_MS[attempt - 1] ?? 3000, opts.signal)
          continue
        }

        if (outcome.status >= 200 && outcome.status < 300) {
          inFlight.delete(job.path)
          settledBytes += file.blob.size
          done++
          emit(true)
          break
        }

        inFlight.delete(job.path)
        // A 4xx won't heal — an expired presign reads the same in three seconds.
        if (outcome.status < 500 || attempt >= PUT_ATTEMPTS) {
          throw putFailed(job.path, outcome.status, outcome.body)
        }
        await backoff(PUT_BACKOFF_MS[attempt - 1] ?? 3000, opts.signal)
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker))
  } finally {
    opts.signal?.removeEventListener('abort', stopAll)
    stopAll()
  }

  const bytesDone = settledBytes
  report({ phase: 'finalize', done, total: uploads.length, bytesDone })
  const finalizeRes = await fetch(finalizePath(walkthroughId), {
    method: 'POST',
    headers: authHeaders(token),
  })
  assertAuthorized(finalizeRes)
  if (!finalizeRes.ok) throw await explain('finalize', finalizeRes)

  return { walkthroughId, url: `/walkthroughs/${walkthroughId}` }
}
