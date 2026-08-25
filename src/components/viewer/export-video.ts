// Export an agent walkthrough's raw takes as one H.264/AAC MP4, straight in the
// tab. The take webms come down over their presigned urls, then the existing
// renderEdit stitches them into a single file — the same encoder the tight-cut
// render uses, just fed one full-length segment per take. mediabunny lives
// behind a dynamic import so it never lands in the viewer's initial bundle.

import type { EditSegment } from '~/lib/edit/edl'
import type { Walkthrough } from './types'

export interface ExportProgress {
  stage: 'download' | 'render'
  /** 0..1 across the whole export (download is the first quarter). */
  fraction: number
}

/**
 * Fetch every take's video and re-encode them into one MP4. Takes without a
 * resolvable url are skipped; if none resolve, there's nothing to export.
 */
export async function exportWalkthroughMp4(opts: {
  takes: Walkthrough['takes']
  urlByPath: Map<string, string>
  onProgress: (p: ExportProgress) => void
  signal?: AbortSignal
}): Promise<Blob> {
  const { takes, urlByPath, onProgress, signal } = opts

  // Same resolution the player uses: an explicit videoPath, else the take dir's
  // walkthrough.webm. Output order is take index.
  const resolved = [...takes]
    .sort((a, b) => a.index - b.index)
    .map((take) => ({ take, url: urlByPath.get(take.videoPath ?? `${take.dir}/walkthrough.webm`) }))
    .filter((r): r is { take: Walkthrough['takes'][number]; url: string } => r.url !== undefined)

  if (resolved.length === 0) throw new Error('this walkthrough has no video to export')

  const total = resolved.length
  const segments: EditSegment[] = []
  const takeMedia = new Map<string, Blob>()

  for (const [i, { take, url }] of resolved.entries()) {
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`couldn't fetch take ${take.index} (${res.status})`)
    takeMedia.set(take.id, await res.blob())
    segments.push({ takeId: take.id, srcStartMs: 0, srcEndMs: take.durationMs })
    onProgress({ stage: 'download', fraction: 0.25 * ((i + 1) / total) })
  }

  // Dynamic ON PURPOSE — renderEdit pulls in mediabunny, which must stay out of
  // the viewer's initial bundle. Do not turn this into a static import.
  const { renderEdit } = await import('~/lib/edit/render')
  const result = await renderEdit(
    segments,
    takeMedia,
    (p) => onProgress({ stage: 'render', fraction: 0.25 + 0.75 * p.fraction }),
    signal
  )
  return result.blob
}

/** Hand a blob to the browser's downloader as a named file. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke late: the click hands the URL to the downloader, which reads it
  // asynchronously — revoking now can cancel the save mid-flight.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
