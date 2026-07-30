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
  bytesDone: number;
  bytesTotal: number;
}

export interface UploadResult {
  gripeId: string;
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
function declaration(session: Session, recordings: Recording[], files: GripeFile[]) {
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
    recordedAt: new Date(session.createdAt).toISOString(),
    durationMs: takes.reduce((sum, t) => sum + t.durationMs, 0),
    frameCount: takes.reduce((sum, t) => sum + t.frameCount, 0),
    eventCount: recordings.reduce((sum, r) => sum + r.meta.events.length, 0),
    takes,
    files: files.map((f) => ({ path: f.path, size: f.blob.size, contentType: f.contentType })),
  };
}

export function totalBytes(files: GripeFile[]): number {
  return files.reduce((sum, f) => sum + f.blob.size, 0);
}

/**
 * Push one gripe to a workspace. Throws with a readable message on any failure —
 * the caller keeps the gripe open and offers to try again, because a half-uploaded
 * gripe is invisible until finalize and re-declaring the same slug replaces it
 * wholesale, so a retry is always safe.
 */
export async function pushGripe(
  target: UploadTarget,
  session: Session,
  recordings: Recording[],
  files: GripeFile[],
  onProgress?: (p: UploadProgress) => void,
): Promise<UploadResult> {
  const server = normalizeServer(target.serverUrl);
  const token = target.apiToken.trim();
  if (!server) throw new Error('no Inloop server — set one in settings');
  if (!token) throw new Error('no API token — paste one in settings');
  if (!token.startsWith('ilp_')) throw new Error('that token is not an Inloop token (ilp_…)');
  if (!recordings.length) throw new Error('nothing recorded yet');
  if (!files.some((f) => f.path === 'report.md')) throw new Error('the report is missing');

  const bytesTotal = totalBytes(files);
  const report = (p: Partial<UploadProgress> & { phase: UploadProgress['phase'] }) =>
    onProgress?.({ done: 0, total: files.length, bytesDone: 0, bytesTotal, ...p });

  report({ phase: 'declare' });
  const declareRes = await fetch(`${server}/api/ingest/gripes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(declaration(session, recordings, files)),
  });
  if (!declareRes.ok) throw await explain('declare', declareRes);
  const { gripeId, uploads } = (await declareRes.json()) as {
    gripeId: string;
    uploads: { path: string; url: string; contentType: string }[];
  };

  const byPath = new Map(files.map((f) => [f.path, f]));
  const queue = [...uploads];
  let done = 0;
  let bytesDone = 0;
  report({ phase: 'upload', total: uploads.length });
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const file = byPath.get(job.path);
      if (!file) throw new Error(`the server asked for a file we don't have: ${job.path}`);
      const res = await fetch(job.url, {
        method: 'PUT',
        headers: { 'content-type': job.contentType },
        body: file.blob,
      });
      if (!res.ok) throw await explain(`upload of ${job.path}`, res);
      done++;
      bytesDone += file.blob.size;
      report({ phase: 'upload', done, total: uploads.length, bytesDone });
    }
  };
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));

  report({ phase: 'finalize', done, total: uploads.length, bytesDone });
  const finalizeRes = await fetch(`${server}/api/ingest/gripes/${gripeId}/finalize`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!finalizeRes.ok) throw await explain('finalize', finalizeRes);

  return { gripeId, url: `${server}/gripes/${gripeId}` };
}
