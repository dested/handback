// The run that survives the tab dying.
//
// Distilling an hour of phone video is minutes of decoding inside one tab, and
// a phone will kill that tab for memory, a phone call, or the person swiping
// away — which is exactly how a real walkthrough was lost. So the whole intake
// (the picked files included) is written to IndexedDB the moment it exists and
// again when the run starts, and it is deleted only after finalize succeeds or
// the person explicitly discards it. Everything here is best-effort: a quota
// error, a private-mode browser, a blocked upgrade — none of them may stop the
// run that is actually in front of the person.
//
// Files persist by structured clone, so what comes back is a real `File` with
// the same bytes, not a copy we had to hold in memory.

const RUN_DB = 'handback-phone'
const RUN_DB_VERSION = 1
const RUN_STORE = 'run'
const RUN_KEY = 'current'

export interface PendingRun {
  files: File[]
  title: string
  /** null = the token owner's personal space. */
  teamId: string | null
  projectId: string | null
  /** Who the walkthrough is for. Older saved runs carry none and read as 'agent'. */
  kind: 'agent' | 'human'
  /** What it's about, for an agent handback. Absent on older runs and on any
   *  human one — reads as null (untagged). */
  intent?: 'bug' | 'feature' | 'idea' | null
  savedAt: number
}

function openRunDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RUN_DB, RUN_DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RUN_STORE)) {
        request.result.createObjectStore(RUN_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('indexeddb blocked'))
  })
}

function put(db: IDBDatabase, run: PendingRun): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RUN_STORE, 'readwrite')
    tx.objectStore(RUN_STORE).put(run, RUN_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function read(db: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RUN_STORE, 'readonly')
    const get = tx.objectStore(RUN_STORE).get(RUN_KEY)
    tx.oncomplete = () => resolve(get.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function remove(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RUN_STORE, 'readwrite')
    tx.objectStore(RUN_STORE).delete(RUN_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** What came back out of storage is untrusted — an older shape must read as "nothing saved". */
function toPendingRun(value: unknown): PendingRun | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('files' in value) || !Array.isArray(value.files)) return null
  const entries: Array<unknown> = value.files
  const files: File[] = []
  for (const entry of entries) if (entry instanceof File) files.push(entry)
  if (!files.length) return null
  const teamId = 'teamId' in value && typeof value.teamId === 'string' ? value.teamId : null
  const projectId =
    'projectId' in value && typeof value.projectId === 'string' ? value.projectId : null
  return {
    files,
    title: 'title' in value && typeof value.title === 'string' ? value.title : '',
    teamId,
    projectId,
    kind: 'kind' in value && value.kind === 'human' ? 'human' : 'agent',
    intent:
      'intent' in value &&
      (value.intent === 'bug' || value.intent === 'feature' || value.intent === 'idea')
        ? value.intent
        : null,
    savedAt: 'savedAt' in value && typeof value.savedAt === 'number' ? value.savedAt : 0,
  }
}

/** Fire-and-forget. Saving is insurance, never a step the run waits on. */
export async function savePendingRun(run: PendingRun): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    const db = await openRunDb()
    try {
      await put(db, run)
    } finally {
      db.close()
    }
  } catch {
    // Out of quota, private mode, a locked upgrade — the run carries on either way.
  }
}

export async function loadPendingRun(): Promise<PendingRun | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openRunDb()
    try {
      return toPendingRun(await read(db))
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

export async function clearPendingRun(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    const db = await openRunDb()
    try {
      await remove(db)
    } finally {
      db.close()
    }
  } catch {
    // Nothing to do about it, and nothing depends on it having happened.
  }
}
