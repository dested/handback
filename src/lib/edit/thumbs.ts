// Filmstrip frames, extracted in the browser from a take that is already local
// (an object URL, or a presigned URL the page can fetch). Seek-and-draw into a
// canvas: slower than a real decoder but it needs no worker, no dependency, and
// the strip is decoration — every failure path here degrades to fewer frames,
// never to a broken editor.

/** Frames-per-take for client extraction: one per ~15s, clamped. */
export function thumbCount(durationMs: number): number {
  return Math.min(24, Math.max(8, Math.round(durationMs / 15000)))
}

/** A seek that never lands is a decoder we can't wait on — skip that frame. */
const SEEK_TIMEOUT_MS = 4000

const THUMB_WIDTH = 160

export async function extractThumbs(
  videoUrl: string,
  durationMs: number,
  count: number,
  signal?: AbortSignal
): Promise<{ atMs: number; url: string }[]> {
  const out: { atMs: number; url: string }[] = []
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  try {
    video.src = videoUrl
    await new Promise<void>((resolve, reject) => {
      const ok = () => {
        cleanup()
        resolve()
      }
      const fail = () => {
        cleanup()
        reject(new Error('metadata failed'))
      }
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', ok)
        video.removeEventListener('error', fail)
      }
      video.addEventListener('loadedmetadata', ok)
      video.addEventListener('error', fail)
    })

    const canvas = document.createElement('canvas')
    canvas.width = THUMB_WIDTH
    canvas.height =
      video.videoWidth > 0 && video.videoHeight > 0
        ? Math.round((THUMB_WIDTH * video.videoHeight) / video.videoWidth)
        : 90
    const ctx = canvas.getContext('2d')
    if (!ctx) return out

    for (let i = 0; i < count; i++) {
      if (signal?.aborted) return out
      const atMs = ((i + 0.5) * durationMs) / count
      video.currentTime = atMs / 1000
      const seeked = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          cleanup()
          resolve(false)
        }, SEEK_TIMEOUT_MS)
        const ok = () => {
          clearTimeout(timer)
          cleanup()
          resolve(true)
        }
        const cleanup = () => video.removeEventListener('seeked', ok)
        video.addEventListener('seeked', ok)
      })
      if (!seeked) continue
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      out.push({ atMs, url: canvas.toDataURL('image/jpeg', 0.6) })
    }
    return out
  } catch {
    return out
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}
