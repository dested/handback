/**
 * The bits of the DOM every stage of the pipeline needs: an offscreen video
 * element to read a picked file through, seeks that can't hang forever, and a
 * canvas→JPEG encoder. Nothing here touches the DOM at module scope, so the
 * whole folder stays importable from an SSR render.
 */

/** A seek that never lands means a container we can't step through. Give up rather than wedge. */
export const SEEK_TIMEOUT_MS = 10000
/** Metadata for a file already on the device is instant; this is only a wedge guard. */
export const LOAD_TIMEOUT_MS = 30000
/** After 'seeked' the decoder usually has the frame; rVFC says so for certain. Don't wait long for it. */
const PRESENT_GRACE_MS = 150
/** currentTime is a float — a seek to where we already are fires no 'seeked'. */
const SEEK_EPSILON = 0.001

export const UNREADABLE = "that file can't be read as a recording on this phone"

/** Offscreen, muted, inline: the element is a decoder, never something anyone sees. */
export function hiddenVideo(src: string): HTMLVideoElement {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'metadata'
  video.style.cssText = 'position:fixed; left:-9999px; top:0; width:4px; height:4px; opacity:0;'
  document.body.appendChild(video)
  video.src = src
  return video
}

/** Drop the decoder as well as the node — a mobile browser has very few of them. */
export function releaseVideo(video: HTMLVideoElement): void {
  try {
    video.pause()
  } catch {
    // Pausing a never-started element throws on some engines; nothing depends on it.
  }
  video.removeAttribute('src')
  video.load()
  video.remove()
}

/** Resolve on the first of `events`, reject on 'error' or after `timeoutMs`. */
export function waitFor(
  el: HTMLVideoElement,
  events: string[],
  timeoutMs: number,
  message: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer)
      for (const name of events) el.removeEventListener(name, onDone)
      el.removeEventListener('error', onError)
    }
    const onDone = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(message))
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error(message))
    }, timeoutMs)
    for (const name of events) el.addEventListener(name, onDone)
    el.addEventListener('error', onError)
  })
}

/**
 * Wait for the decoder to actually present the frame we seeked to. 'seeked'
 * fires when the position moved; `requestVideoFrameCallback` fires when there
 * are pixels to read — and reading a canvas one frame early is how a sweep ends
 * up with duplicates of the previous keyframe.
 */
function presented(video: HTMLVideoElement): Promise<void> {
  if (typeof video.requestVideoFrameCallback !== 'function') return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(finish, PRESENT_GRACE_MS)
    video.requestVideoFrameCallback(() => finish())
  })
}

/** Seek and wait for the picture. Throws `message` if the seek doesn't land in time. */
export async function seekTo(
  video: HTMLVideoElement,
  timeSec: number,
  message: string
): Promise<void> {
  if (Math.abs(video.currentTime - timeSec) < SEEK_EPSILON && video.readyState >= 2) {
    await presented(video)
    return
  }
  const landed = waitFor(video, ['seeked'], SEEK_TIMEOUT_MS, message)
  video.currentTime = timeSec
  await landed
  await presented(video)
}

export function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('frame encode failed'))),
      'image/jpeg',
      quality
    )
  })
}
