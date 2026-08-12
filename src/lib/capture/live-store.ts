import type { Recording } from './types'

/**
 * Where a web recording lives while it is being made.
 *
 * Modelled on `extension/src/lib/db.ts`, and for the same two reasons. Memory
 * first: twenty minutes of screen capture is a few hundred MB of webm chunks and
 * six hundred JPEGs, and a tab that holds all of it in the JS heap is a tab that
 * dies before it can upload. Then survival: a take written chunk by chunk is
 * still a playable webm after a reload, a crash, or a closed laptop, because a
 * webm assembled from chunk 1..n plays even when nobody ever called stop().
 *
 * `/upload` deliberately has no store like this — a distill can always be run
 * again from the clip that is still on disk. A *recording* cannot: the narration
 * happened once. That is the whole difference, and it is why this file exists.
 *
 * Its own database, not the extension's `handback-recorder`: same origin never
 * meets, but a user with both installed would have two writers on one schema and
 * the extension's worker owns that one.
 */

const DB_NAME = 'handback-web-recorder'
const DB_VERSION = 1

const STORE = {
  takes: 'takes',
  blobs: 'blobs',
  kv: 'kv',
} as const

/**
 * A take as it sits on disk. It IS a `Recording` — the shape `buildReport`,
 * `buildRecordingJson` and `uploadWalkthrough` all read — plus the mic-shadow
 * bookkeeping only a live capture has.
 */
export interface LiveTake extends Recording {
  /** Count of `<id>:micchunk:<n>` blobs written, `n` from 1. */
  micChunks?: number
  micMime?: string
}

/** The walkthrough being assembled: what it's called and where it's going. */
export interface LiveDraft {
  sessionId: string
  title: string
  createdAt: number
  /** null = the token owner's personal space. */
  teamId: string | null
  projectId: string | null
  /** Who it's for — 'human' = pristine video, no distill. A property of the
   *  whole session (takes must all be captured the same way), so it lives
   *  here and survives a reload with the rest of the draft. */
  kind: 'agent' | 'human'
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE.takes)) {
        db.createObjectStore(STORE.takes, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE.blobs)) db.createObjectStore(STORE.blobs)
      if (!db.objectStoreNames.contains(STORE.kv)) db.createObjectStore(STORE.kv)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('indexeddb blocked'))
  })
  return dbPromise
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb()
  return wrap(run(db.transaction(store, mode).objectStore(store)))
}

/**
 * Blob keys are the extension's, character for character —
 * `<id>:chunk:<n>`, `<id>:micchunk:<n>`, `<id>:frame:<index>`, `<id>:video`,
 * `<id>:mic` — so the recovery and teardown rules read the same in both places.
 */
export const blobs = {
  get: (key: string) => tx<Blob | undefined>(STORE.blobs, 'readonly', (s) => s.get(key)),
  set: (key: string, blob: Blob) => tx(STORE.blobs, 'readwrite', (s) => s.put(blob, key)),
  delete: (key: string) => tx(STORE.blobs, 'readwrite', (s) => s.delete(key)),
}

export async function putTake(take: LiveTake): Promise<void> {
  await tx(STORE.takes, 'readwrite', (s) => s.put(take))
}

export async function listTakes(): Promise<LiveTake[]> {
  const all = await tx<LiveTake[]>(STORE.takes, 'readonly', (s) => s.getAll())
  return all.sort((a, b) => a.index - b.index)
}

/** Take, frames, chunks and assembled media — everything the id owns. */
export async function deleteTake(take: LiveTake): Promise<void> {
  const keys = [
    ...take.meta.frames.map((f) => `${take.id}:frame:${f.index}`),
    ...Array.from({ length: take.chunks }, (_, i) => `${take.id}:chunk:${i + 1}`),
    ...Array.from({ length: take.micChunks ?? 0 }, (_, i) => `${take.id}:micchunk:${i + 1}`),
    `${take.id}:video`,
    `${take.id}:mic`,
  ]
  await Promise.all(keys.map((key) => blobs.delete(key).catch(() => undefined)))
  await tx(STORE.takes, 'readwrite', (s) => s.delete(take.id))
}

/**
 * Lay the survivors out as 1..N in recording order. `rec-NN` is a **position**
 * in the walkthrough, not a serial — the report and the viewer walk the takes as
 * one continuous axis, and a hole in the numbering puts a hole in that axis.
 * The extension does the same on `take:delete`.
 */
export async function renumberTakes(takes: LiveTake[]): Promise<LiveTake[]> {
  const ordered = [...takes].sort((a, b) => a.createdAt - b.createdAt)
  const laid = ordered.map((take, i) => ({ ...take, index: i + 1 }))
  for (const take of laid) await putTake(take)
  return laid
}

/**
 * The end of a walkthrough, by either exit: uploaded, or discarded on purpose.
 * Both are explicit acts — nothing here is ever cleared by merely reading it
 * (the rule `/phone` learned the hard way; cliffnotes' un-losable clip note).
 */
export async function clearAll(): Promise<void> {
  for (const take of await listTakes()) await deleteTake(take)
  await tx(STORE.kv, 'readwrite', (s) => s.delete('draft'))
  await tx(STORE.kv, 'readwrite', (s) => s.delete('edit'))
}

/**
 * The in-progress edit (a human handback's cut list), crash-survivable like
 * everything else here. Opaque to this module — the editor owns the shape and
 * validates what comes back out.
 */
export async function saveEditState(state: unknown): Promise<void> {
  await tx(STORE.kv, 'readwrite', (s) => s.put(state, 'edit'))
}

export async function loadEditState(): Promise<unknown> {
  return tx<unknown>(STORE.kv, 'readonly', (s) => s.get('edit'))
}

export async function saveDraft(draft: LiveDraft): Promise<void> {
  await tx(STORE.kv, 'readwrite', (s) => s.put(draft, 'draft'))
}

/** What comes back out of storage is untrusted — an older shape reads as "nothing saved". */
function toDraft(value: unknown): LiveDraft | null {
  if (typeof value !== 'object' || value === null) return null
  const { sessionId, title, createdAt, teamId, projectId, kind } = value as {
    sessionId?: unknown
    title?: unknown
    createdAt?: unknown
    teamId?: unknown
    projectId?: unknown
    kind?: unknown
  }
  if (typeof sessionId !== 'string' || typeof title !== 'string') return null
  return {
    sessionId,
    title,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    teamId: typeof teamId === 'string' ? teamId : null,
    projectId: typeof projectId === 'string' ? projectId : null,
    // Drafts from before the split are agent handbacks by definition.
    kind: kind === 'human' ? 'human' : 'agent',
  }
}

export async function loadDraft(): Promise<LiveDraft | null> {
  return toDraft(await tx<unknown>(STORE.kv, 'readonly', (s) => s.get('draft')))
}

/**
 * A take still marked `recording` is one whose `finish()` never ran — the tab
 * died mid-narration. Its chunks are on disk, so assemble them into the video
 * the take never got and hand it back as an interrupted one. Ported from the
 * worker's `recording:recover`.
 *
 * `durationMs` comes from the last kept frame rather than the clock: the meta
 * was last written up to `PROGRESS_MS` before the end, and a duration longer
 * than the video that survived would leave the timeline pointing past it.
 */
export async function recoverTake(take: LiveTake): Promise<LiveTake> {
  const parts: Blob[] = []
  for (let n = 1; n <= take.chunks; n++) {
    const chunk = await blobs.get(`${take.id}:chunk:${n}`)
    if (chunk) parts.push(chunk)
  }
  if (parts.length) await blobs.set(`${take.id}:video`, new Blob(parts, { type: take.mime }))

  const micParts: Blob[] = []
  for (let n = 1; n <= (take.micChunks ?? 0); n++) {
    const chunk = await blobs.get(`${take.id}:micchunk:${n}`)
    if (chunk) micParts.push(chunk)
  }
  if (micParts.length) {
    await blobs.set(`${take.id}:mic`, new Blob(micParts, { type: take.micMime ?? 'audio/webm' }))
  }

  const lastFrame = take.meta.frames[take.meta.frames.length - 1]
  const recovered: LiveTake = {
    ...take,
    state: 'done',
    interrupted: true,
    meta: {
      ...take.meta,
      durationMs: lastFrame ? lastFrame.t : take.meta.durationMs,
    },
  }
  await putTake(recovered)
  // Only after the assembled media is on disk: a crash between the two must
  // still leave the pieces it was insurance against.
  for (let n = 1; n <= take.chunks; n++) await blobs.delete(`${take.id}:chunk:${n}`)
  for (let n = 1; n <= (take.micChunks ?? 0); n++) {
    await blobs.delete(`${take.id}:micchunk:${n}`)
  }
  return recovered
}
