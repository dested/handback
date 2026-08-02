/**
 * Handback's service worker. Its only job is to catch the POST the OS share
 * sheet sends to the manifest's share_target and stash the shared media in
 * IndexedDB, so the app can pick it up after the redirect.
 *
 * It deliberately caches nothing. The app is SSR-rendered against live data, so
 * a precached shell would hand people stale state; every request other than the
 * share POST falls through to the network untouched.
 */

const DB_NAME = 'handback-share'
const DB_VERSION = 1
const STORE = 'pending'
const KEY = 'current'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('indexeddb blocked'))
  })
}

function put(db, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

async function handleShare(request) {
  try {
    const form = await request.formData()
    const files = form.getAll('media').filter((f) => f instanceof File)
    const title = form.get('title')
    const text = form.get('text')
    const db = await openDb()
    try {
      await put(db, {
        title: typeof title === 'string' ? title : null,
        text: typeof text === 'string' ? text : null,
        files,
        at: Date.now(),
      })
    } finally {
      db.close()
    }
    return Response.redirect('/phone?shared=1', 303)
  } catch {
    // Never strand someone on a POST response — redirect anyway and let the
    // app explain that the handoff failed.
    return Response.redirect('/phone?shared=1&error=share', 303)
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'POST') return
  if (new URL(request.url).pathname !== '/share-target') return
  event.respondWith(handleShare(request))
})
