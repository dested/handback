// The edited render of a human handback: one player, the narration beside it,
// a real Download (content-disposition presign — the `download` attribute is
// ignored cross-origin). Shared by the signed-in viewer and the public /w page
// so the two can't drift.

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TranscriptPanel } from './transcript-panel'
import type { TranscriptLine } from './types'

export function FinalCut({
  videoUrl,
  transcriptUrl,
  downloadUrl,
}: {
  videoUrl: string
  transcriptUrl: string | undefined
  downloadUrl: string | null
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const transcript = useTranscriptFile(transcriptUrl)

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <video
          ref={videoRef}
          controls
          preload="metadata"
          src={videoUrl}
          className="max-h-[560px] w-full rounded-md border bg-black/95"
        />
        {downloadUrl && (
          <a href={downloadUrl} className="text-cobalt text-sm hover:underline">
            Download the video
          </a>
        )}
      </div>
      <div className="lg:col-span-1">
        {transcript && transcript.length > 0 && (
          <TranscriptPanel
            lines={transcript}
            onSeek={(tMs) => {
              const video = videoRef.current
              if (video) video.currentTime = tMs / 1000
            }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * transcript.json — flat `{ lines: TranscriptLine[] }` on the *edited* timeline,
 * written by the editor's render step alongside final.mp4. Null while loading
 * or when the file was never uploaded (video still plays).
 */
export function useTranscriptFile(url: string | undefined): TranscriptLine[] | null {
  const query = useQuery({
    queryKey: ['handback.final-transcript', url],
    enabled: url !== undefined,
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<{ lines: TranscriptLine[] }> => {
      const res = await fetch(url!)
      if (!res.ok) throw new Error(`transcript.json failed (${res.status})`)
      return res.json() as Promise<{ lines: TranscriptLine[] }>
    },
  })
  return query.data?.lines ?? null
}
