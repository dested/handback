import { blobs, listRecordings } from '../lib/db';
import type { Recording, Session } from '../lib/types';

/**
 * The way out that isn't DevTools. A walkthrough's video lives only in
 * IndexedDB — if an upload can't happen (workspace unreachable, token dead),
 * the recording is fine but trapped. These save the raw webm(s) into the
 * person's Downloads. Read-only: nothing here deletes or writes a blob back.
 */

/** The assembled video — or, for a take the worker never reassembled, its chunks read in order. */
async function takeVideo(rec: Recording): Promise<Blob | undefined> {
  const video = await blobs.get(`${rec.id}:video`).catch(() => undefined);
  if (video) return video;
  const parts: Blob[] = [];
  for (let n = 1; n <= rec.chunks; n++) {
    const chunk = await blobs.get(`${rec.id}:chunk:${n}`).catch(() => undefined);
    if (chunk) parts.push(chunk);
  }
  return parts.length ? new Blob(parts, { type: rec.mime }) : undefined;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // The click only hands the URL to the downloader — give it time to open the stream.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function fileName(session: Session, rec: Recording, mime: string, solo: boolean) {
  const base = session.slug || 'walkthrough';
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  return solo ? `${base}.${ext}` : `${base}-part-${rec.index}.${ext}`;
}

/** One part → one file in Downloads. False when there is no video to save. */
export async function saveTake(session: Session, rec: Recording): Promise<boolean> {
  const video = await takeVideo(rec);
  if (!video) return false;
  download(video, fileName(session, rec, video.type || rec.mime, session.recCount <= 1));
  return true;
}

/** Every part of a session → files in Downloads (Chrome may ask to allow multiple). Returns how many saved. */
export async function saveSession(session: Session): Promise<number> {
  const recs = await listRecordings(session.id);
  let saved = 0;
  for (const rec of recs) {
    const video = await takeVideo(rec);
    if (!video) continue;
    download(video, fileName(session, rec, video.type || rec.mime, recs.length <= 1));
    saved += 1;
  }
  return saved;
}
