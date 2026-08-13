// The edited render of a human handback: one player, the narration beside it,
// a real Download (content-disposition presign — the `download` attribute is
// ignored cross-origin). Shared by the signed-in viewer and the public /w page
// so the two can't drift.

import { useQuery } from '@tanstack/react-query'
import { SectionHead } from './section-head'
import { TranscriptPanel } from './transcript-panel'
import type { TranscriptLine } from './types'
import { useSingleVideoPlayer } from './use-segment-player'
import { VideoStage } from './video-stage'

export function FinalCut({
  videoUrl,
  transcriptUrl,
  downloadUrl,
}: {
  videoUrl: string
  transcriptUrl: string | undefined
  downloadUrl: string | null
}) {
  const player = useSingleVideoPlayer(videoUrl)
  const transcript = useTranscriptFile(transcriptUrl)

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <VideoStage player={player} maxHeightClass="max-h-[560px]" />
        {downloadUrl && (
          <div className="flex flex-wrap items-center gap-5">
            <a
              href={downloadUrl}
              className="text-cobalt font-mono text-sm underline underline-offset-4">
              Download the video
            </a>
          </div>
        )}
      </div>
      <div className="space-y-2 lg:col-span-1">
        <SectionHead>transcript</SectionHead>
        {transcript && transcript.length > 0 ? (
          <TranscriptPanel
            lines={transcript}
            activeMs={player.outputMs}
            onSeek={(tMs) => player.seekOutput(tMs)}
          />
        ) : (
          <p className="text-muted-foreground text-sm">No transcript came with this cut.</p>
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
