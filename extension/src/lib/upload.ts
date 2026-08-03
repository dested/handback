import type { Recording, Session } from './types';
import { recDirName } from './format';

/**
 * The ingest client. Same two-phase write as `cli/push.ts` — declare the gripe and
 * its whole file list, PUT every file to the presigned URL the declare handed back,
 * then finalize — because that is the only shape `server/ingest.ts` accepts, and a
 * gripe that never finalizes is invisible in the workspace.
 *
 * Nothing here touches the disk: the panel assembles the same paths the recorder
 * used to write into a folder (`report.md`, `MANIFEST.txt`, `rec-NN/…`) as blobs in
 * memory, and those paths become the keys in the cloud. A downloaded gripe is
 * byte-identical to a folder the CLI can push straight back up.
 */

/** One file of the gripe's set, at the path it will live under in the workspace. */
export interface GripeFile {
  /** Gripe-relative, forward slashes: `report.md`, `rec-01/frames/03-0125.jpg`. */
  path: string;
  blob: Blob;
  contentType: string;
}

export interface UploadTarget {
  serverUrl: string;
  apiToken: string;
}

export interface UploadProgress {
  phase: 'declare' | 'upload' | 'finalize';
  /** Files fully uploaded so far, and the total the server asked for. */
  done: number;
  total: number;
  /** Live: finished files plus what the in-flight PUTs have pushed so far. */
  bytesDone: number;
  bytesTotal: number;
}

export interface UploadResult {
  walkthroughId: string;
  /** The gripe's page in the workspace — what the panel shows and the prompt carries. */
  url: string;
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
};

/** Four at a time: a walkthrough is mostly small JPEGs, and the webm wants the bandwidth. */
const UPLOAD_CONCURRENCY = 4;

/**
 * A laptop that sleeps or drops Wi-Fi mid-PUT is not a lost walkthrough. Three
 * tries per file, backing off, but only for the failures that can heal: a dead
 * socket or a 5xx. A 403 is an expired or wrong presign and will read the same
 * way in three seconds, so it fails straight through.
 */
const PUT_ATTEMPTS = 3;
const PUT_BACKOFF_MS = [1000, 3000];

/** The video is most of the upload, so bytes are the only honest progress. */
const PROGRESS_INTERVAL_MS = 250;

export function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** Trailing slashes make `${server}/api/…` a 404 that looks like a bad token. */
function normalizeServer(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** A failed request, said in words the panel can put in front of a person. */
async function explain(what: string, res: Response): Promise<Error> {
  const body = await res.text().catch(() => '');
  const detail = body.trim().slice(0, 200);
  return new Error(`${what} failed (${res.status})${detail ? `: ${detail}` : ''}`);
}

/**
 * The declare body. Every field mirrors what `cli/push.ts` derives from the
 * `rec-NN/recording.json` files, so the two clients produce identical rows —
 * `recordedAt` is the gripe's own creation time, the takes are the takes.
 */
function declaration(
  session: Session,
  recordings: Recording[],
  files: GripeFile[],
  projectId?: string,
  teamId?: string,
) {
  const paths = new Set(files.map((f) => f.path));
  const takes = [...recordings]
    .sort((a, b) => a.index - b.index)
    .map((rec) => {
      const dir = recDirName(rec.index);
      const videoPath = `${dir}/${rec.meta.videoFile}`;
      return {
        index: rec.index,
        dir,
        interrupted: Boolean(rec.interrupted),
        startedAt: new Date(rec.meta.startedAt).toISOString(),
        durationMs: Math.max(0, Math.round(rec.meta.durationMs)),
        frameCount: rec.meta.frames.length,
        transcriber: rec.meta.transcriber ?? 'webspeech',
        // Only claim a video the upload actually carries — a take whose blob went
        // missing must not leave the viewer with a link to nothing.
        videoPath: paths.has(videoPath) ? videoPath : undefined,
      };
    });
  return {
    slug: session.slug,
    title: session.name || session.slug,
    origin: session.origin || undefined,
    ...(projectId ? { projectId } : {}),
    // Which space this lands in: absent = the token owner's personal one.
    ...(teamId ? { teamId } : {}),
    recordedAt: new Date(session.createdAt).toISOString(),
    durationMs: takes.reduce((sum, t) => sum + t.durationMs, 0),
    frameCount: takes.reduce((sum, t) => sum + t.frameCount, 0),
    errorCount: recordings.reduce((sum, r) => sum + r.meta.events.length, 0),
    // Errors the recorder saw on other tabs and threw away. Sent so the workspace
    // can tell "the page never complained" from "we weren't watching that tab".
    droppedCount: recordings.reduce((sum, r) => sum + (r.meta.droppedEvents ?? 0), 0),
    takes,
    files: files.map((f) => ({ path: f.path, size: f.blob.size, contentType: f.contentType })),
  };
}

export function totalBytes(files: GripeFile[]): number {
  return files.reduce((sum, f) => sum + f.blob.size, 0);
}

/** `explain()`'s wording, for a transport that has no `Response` to read it off. */
function putFailed(path: string, status: number, body: string): Error {
  const detail = body.trim().slice(0, 200);
  const where = status ? `(${status})` : '(no connection)';
  return new Error(`upload of ${path} failed ${where}${detail ? `: ${detail}` : ''}`);
}

function backoff(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** The status and body of one PUT attempt. A transport failure throws instead. */
interface PutAttempt {
  status: number;
  body: string;
}

/**
 * One presigned PUT over XHR rather than fetch, for exactly one reason: fetch
 * cannot report how far an upload has got, so the 50 MB video at the end of a
 * walkthrough parked the bar at 99% for minutes and then either worked or didn't.
 * Mirrors `src/lib/capture/upload.ts` — keep the two in step.
 */
function putOnce(
  url: string,
  contentType: string,
  blob: Blob,
  onBytes: (loaded: number) => void,
): Promise<PutAttempt> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    // The content-type is signed; no auth header may ride along on a presign.
    xhr.setRequestHeader('content-type', contentType);
    xhr.upload.onprogress = (event) => onBytes(event.loaded);
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText ?? '' });
    xhr.onerror = () => reject(new Error('network'));
    xhr.ontimeout = () => reject(new Error('network'));
    xhr.send(blob);
  });
}

/**
 * Push one gripe to a workspace. Throws with a readable message on any failure —
 * the caller keeps the gripe open and offers to try again, because a half-uploaded
 * gripe is invisible until finalize and re-declaring the same slug replaces it
 * wholesale, so a retry is always safe.
 *
 * An explicit `projectId` pins the gripe to that project; absent, the workspace
 * routes it by the recorded origin.
 */
export async function pushGripe(
  target: UploadTarget,
  session: Session,
  recordings: Recording[],
  files: GripeFile[],
  opts?: { projectId?: string; teamId?: string; onProgress?: (p: UploadProgress) => void },
): Promise<UploadResult> {
  const onProgress = opts?.onProgress;
  const server = normalizeServer(target.serverUrl);
  const token = target.apiToken.trim();
  if (!server) throw new Error('no Handback server — set one in settings');
  if (!token) throw new Error('no API token — paste one in settings');
  if (!token.startsWith('hb_')) throw new Error('that token is not a Handback token (hb_…)');
  if (!recordings.length) throw new Error('nothing recorded yet');
  if (!files.some((f) => f.path === 'report.md')) throw new Error('the report is missing');

  const bytesTotal = totalBytes(files);
  const report = (p: Partial<UploadProgress> & { phase: UploadProgress['phase'] }) =>
    onProgress?.({ done: 0, total: files.length, bytesDone: 0, bytesTotal, ...p });

  report({ phase: 'declare' });
  const declareRes = await fetch(`${server}/api/ingest/walkthroughs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(declaration(session, recordings, files, opts?.projectId, opts?.teamId)),
  });
  if (!declareRes.ok) throw await explain('declare', declareRes);
  const { walkthroughId, uploads } = (await declareRes.json()) as {
    walkthroughId: string;
    uploads: { path: string; url: string; contentType: string }[];
  };

  const byPath = new Map(files.map((f) => [f.path, f]));
  const queue = [...uploads];
  let done = 0;
  /** Bytes of the files that finished. In-flight bytes are added on top, live. */
  let settledBytes = 0;
  /** Per-file `loaded` while a PUT is running, so the total never double-counts a retry. */
  const inFlight = new Map<string, number>();
  let lastEmit = 0;

  const emit = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = now;
    let bytesDone = settledBytes;
    for (const loaded of inFlight.values()) bytesDone += loaded;
    report({ phase: 'upload', done, total: uploads.length, bytesDone });
  };

  report({ phase: 'upload', total: uploads.length });
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const file = byPath.get(job.path);
      if (!file) throw new Error(`the server asked for a file we don't have: ${job.path}`);

      for (let attempt = 1; ; attempt++) {
        inFlight.set(job.path, 0);
        let outcome: PutAttempt;
        try {
          outcome = await putOnce(job.url, job.contentType, file.blob, (loaded) => {
            inFlight.set(job.path, loaded);
            emit(false);
          });
        } catch {
          inFlight.delete(job.path);
          // A dead socket is the retryable case; the last attempt still fails.
          if (attempt >= PUT_ATTEMPTS) throw putFailed(job.path, 0, '');
          await backoff(PUT_BACKOFF_MS[attempt - 1] ?? 3000);
          continue;
        }

        if (outcome.status >= 200 && outcome.status < 300) {
          inFlight.delete(job.path);
          settledBytes += file.blob.size;
          done++;
          emit(true);
          break;
        }

        inFlight.delete(job.path);
        // A 4xx won't heal — an expired presign reads the same in three seconds.
        if (outcome.status < 500 || attempt >= PUT_ATTEMPTS) {
          throw putFailed(job.path, outcome.status, outcome.body);
        }
        await backoff(PUT_BACKOFF_MS[attempt - 1] ?? 3000);
      }
    }
  };
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));

  const bytesDone = settledBytes;
  report({ phase: 'finalize', done, total: uploads.length, bytesDone });
  const finalizeRes = await fetch(`${server}/api/ingest/walkthroughs/${walkthroughId}/finalize`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!finalizeRes.ok) throw await explain('finalize', finalizeRes);

  return { walkthroughId, url: `${server}/walkthroughs/${walkthroughId}` };
}
