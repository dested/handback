// Presigned-URL transfers for the in-viewer editor.
//
// Both directions go over XHR rather than fetch for the same reason the upload
// path already does: fetch cannot report how far a transfer has got, and the
// two things this moves are a raw screen recording (down) and an MP4 render
// (up). A still spinner for four minutes is not progress.
//
// This is deliberately not `capture/upload.ts`: that module speaks the
// two-phase ingest protocol (declare → PUT × n → finalize) against a walkthrough
// that doesn't exist yet. Here the walkthrough already exists and the server
// hands back the URLs through tRPC, so all that's left is the bytes.

/** A dead socket or a 5xx can heal; an expired presign reads the same in 3 s. */
const ATTEMPTS = 3
const BACKOFF_MS = [1000, 3000]

function cancelled(): Error {
  return new Error('cancelled')
}

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

/** Bytes moved so far, and the total when the transport knows one. */
export interface TransferProgress {
  loaded: number
  total: number | null
}

function transfer(
  method: 'GET' | 'PUT',
  url: string,
  body: Blob | null,
  contentType: string | null,
  onProgress: ((p: TransferProgress) => void) | undefined,
  signal: AbortSignal | undefined
): Promise<{ status: number; blob: Blob | null; text: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled())
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open(method, url, true)
    if (method === 'GET') xhr.responseType = 'blob'
    // The content-type is signed into a presigned PUT; no auth header may ride
    // along on one either.
    if (contentType !== null) xhr.setRequestHeader('content-type', contentType)
    const report = (event: ProgressEvent) =>
      onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : null })
    if (method === 'GET') xhr.onprogress = report
    else xhr.upload.onprogress = report
    const done = () => signal?.removeEventListener('abort', onAbort)
    function onAbort() {
      xhr.abort()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    xhr.onload = () => {
      done()
      const blob = xhr.response instanceof Blob ? xhr.response : null
      resolve({ status: xhr.status, blob, text: method === 'PUT' ? (xhr.responseText ?? '') : '' })
    }
    xhr.onerror = () => {
      done()
      reject(new Error('network'))
    }
    xhr.ontimeout = () => {
      done()
      reject(new Error('network'))
    }
    xhr.onabort = () => {
      done()
      reject(cancelled())
    }
    xhr.send(body)
  })
}

function failed(what: string, status: number, body: string): Error {
  const detail = body.trim().slice(0, 200)
  const where = status ? `(${status})` : '(no connection)'
  return new Error(`${what} failed ${where}${detail ? `: ${detail}` : ''}`)
}

/** Pull one presigned object down as a Blob, reporting bytes as they arrive. */
export async function fetchBlob(
  what: string,
  url: string,
  onProgress?: (p: TransferProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  for (let attempt = 1; ; attempt++) {
    let outcome
    try {
      outcome = await transfer('GET', url, null, null, onProgress, signal)
    } catch (error) {
      if (error instanceof Error && error.message === 'cancelled') throw error
      if (attempt >= ATTEMPTS) throw failed(what, 0, '')
      await backoff(BACKOFF_MS[attempt - 1] ?? 3000, signal)
      continue
    }
    if (outcome.status >= 200 && outcome.status < 300 && outcome.blob) return outcome.blob
    if (outcome.status < 500 || attempt >= ATTEMPTS) throw failed(what, outcome.status, '')
    await backoff(BACKOFF_MS[attempt - 1] ?? 3000, signal)
  }
}

/** PUT one blob to a presigned URL. The signed ContentLength is `blob.size`. */
export async function putBlob(
  what: string,
  url: string,
  contentType: string,
  blob: Blob,
  onProgress?: (p: TransferProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    let outcome
    try {
      outcome = await transfer('PUT', url, blob, contentType, onProgress, signal)
    } catch (error) {
      if (error instanceof Error && error.message === 'cancelled') throw error
      if (attempt >= ATTEMPTS) throw failed(`upload of ${what}`, 0, '')
      await backoff(BACKOFF_MS[attempt - 1] ?? 3000, signal)
      continue
    }
    if (outcome.status >= 200 && outcome.status < 300) return
    if (outcome.status < 500 || attempt >= ATTEMPTS) {
      throw failed(`upload of ${what}`, outcome.status, outcome.text)
    }
    await backoff(BACKOFF_MS[attempt - 1] ?? 3000, signal)
  }
}
