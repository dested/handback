import type { Recording, Session } from './types';

/**
 * The single source of truth, shared by the service worker and the side panel.
 * Images live here as Blobs (not data URLs) so a long session doesn't balloon
 * memory. Fresh product, fresh database — no legacy migrations.
 */

const DB_NAME = 'handback-recorder';
const DB_VERSION = 1;

export const STORE = {
  sessions: 'sessions',
  recordings: 'recordings',
  blobs: 'blobs',
  kv: 'kv',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE.sessions)) {
        db.createObjectStore(STORE.sessions, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE.recordings)) {
        const recordings = db.createObjectStore(STORE.recordings, { keyPath: 'id' });
        recordings.createIndex('bySession', 'sessionId');
      }
      if (!db.objectStoreNames.contains(STORE.blobs)) {
        db.createObjectStore(STORE.blobs);
      }
      if (!db.objectStoreNames.contains(STORE.kv)) {
        db.createObjectStore(STORE.kv);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return wrap(fn(db.transaction(store, mode).objectStore(store)));
}

export const kv = {
  get: <T>(key: string) => tx<T>(STORE.kv, 'readonly', (s) => s.get(key) as IDBRequest<T>),
  set: (key: string, value: unknown) => tx(STORE.kv, 'readwrite', (s) => s.put(value, key)),
  delete: (key: string) => tx(STORE.kv, 'readwrite', (s) => s.delete(key)),
};

export const blobs = {
  get: (key: string) => tx<Blob | undefined>(STORE.blobs, 'readonly', (s) => s.get(key)),
  set: (key: string, blob: Blob) => tx(STORE.blobs, 'readwrite', (s) => s.put(blob, key)),
  delete: (key: string) => tx(STORE.blobs, 'readwrite', (s) => s.delete(key)),
};

export async function putSession(session: Session) {
  await tx(STORE.sessions, 'readwrite', (s) => s.put(session));
}

export async function getSession(id: string) {
  return tx<Session | undefined>(STORE.sessions, 'readonly', (s) => s.get(id));
}

export async function listSessions(): Promise<Session[]> {
  const all = await tx<Session[]>(STORE.sessions, 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteSession(id: string) {
  const recordings = await listRecordings(id);
  await Promise.all(recordings.map((r) => deleteRecording(r.id)));
  await tx(STORE.sessions, 'readwrite', (s) => s.delete(id));
}

export async function putRecording(recording: Recording) {
  await tx(STORE.recordings, 'readwrite', (s) => s.put(recording));
}

export async function getRecording(id: string) {
  return tx<Recording | undefined>(STORE.recordings, 'readonly', (s) => s.get(id));
}

export async function listRecordings(sessionId: string): Promise<Recording[]> {
  const db = await openDb();
  const index = db
    .transaction(STORE.recordings, 'readonly')
    .objectStore(STORE.recordings)
    .index('bySession');
  const all = await wrap<Recording[]>(index.getAll(sessionId));
  return all.sort((a, b) => a.index - b.index);
}

export async function deleteRecording(id: string) {
  const recording = await getRecording(id);
  if (recording) {
    const chunks = Array.from({ length: recording.chunks }, (_, i) => `${id}:chunk:${i + 1}`);
    await Promise.all([
      ...recording.meta.frames.map((f) => blobs.delete(`${id}:frame:${f.index}`)),
      ...chunks.map((key) => blobs.delete(key)),
      blobs.delete(`${id}:video`),
    ]);
  }
  await tx(STORE.recordings, 'readwrite', (s) => s.delete(id));
}
