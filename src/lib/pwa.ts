// Client-only PWA glue: service-worker registration, the deferred install
// prompt, and pickup of media the OS share sheet handed to the service worker.
// Every DOM access sits inside a function so the module stays importable from
// an SSR build.

// Not in lib.dom — Chromium-only, and only ever seen through this narrowing.
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// iOS reports installed-ness on navigator, not via display-mode.
type NavigatorMaybeStandalone = Navigator & { standalone?: boolean }

export type SharedMedia = { title: string | null; text: string | null; files: File[]; at: number }

// Must match public/sw.js.
const SHARE_DB = 'handback-share'
const SHARE_DB_VERSION = 1
const SHARE_STORE = 'pending'
const SHARE_KEY = 'current'

let deferredPrompt: BeforeInstallPromptEvent | null = null
let wired = false
const subscribers = new Set<(installable: boolean) => void>()

function isBeforeInstallPrompt(event: Event): event is BeforeInstallPromptEvent {
  return 'prompt' in event && 'userChoice' in event
}

function notify() {
  for (const subscriber of subscribers) subscriber(deferredPrompt !== null)
}

export function registerPwa(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  if (wired) return
  wired = true

  navigator.serviceWorker.register('/sw.js').catch(() => {})

  window.addEventListener('beforeinstallprompt', (event) => {
    if (!isBeforeInstallPrompt(event)) return
    event.preventDefault()
    deferredPrompt = event
    notify()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

export function canInstall(): boolean {
  return deferredPrompt !== null
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredPrompt
  if (!event) return 'unavailable'
  // A deferred prompt is single-use, so it is spent whichever way this goes.
  deferredPrompt = null
  notify()
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    return outcome
  } catch {
    return 'unavailable'
  }
}

export function onInstallableChange(cb: (installable: boolean) => void): () => void {
  subscribers.add(cb)
  cb(deferredPrompt !== null)
  return () => {
    subscribers.delete(cb)
  }
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  const nav: NavigatorMaybeStandalone = navigator
  return nav.standalone === true
}

function openShareDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, SHARE_DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SHARE_STORE)) {
        request.result.createObjectStore(SHARE_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('indexeddb blocked'))
  })
}

function readAndClear(db: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readwrite')
    const store = tx.objectStore(SHARE_STORE)
    const get = store.get(SHARE_KEY)
    get.onsuccess = () => {
      store.delete(SHARE_KEY)
    }
    tx.oncomplete = () => resolve(get.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function toSharedMedia(value: unknown): SharedMedia | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('files' in value) || !Array.isArray(value.files)) return null
  const entries: Array<unknown> = value.files
  const files: Array<File> = []
  for (const entry of entries) if (entry instanceof File) files.push(entry)
  return {
    title: 'title' in value && typeof value.title === 'string' ? value.title : null,
    text: 'text' in value && typeof value.text === 'string' ? value.text : null,
    files,
    at: 'at' in value && typeof value.at === 'number' ? value.at : 0,
  }
}

/** Reads the media the share sheet stashed, clearing it so it is consumed once. */
export async function takeSharedMedia(): Promise<SharedMedia | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openShareDb()
    try {
      return toSharedMedia(await readAndClear(db))
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}
