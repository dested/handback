import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { EventsPanel } from './events-panel'
import { Filmstrip } from './filmstrip'
import { clockTime, mmss, numeral } from './format'
import { TranscriptPanel } from './transcript-panel'
import type { Take, TakeRecording } from './types'

/**
 * One take: video on the left with its filmstrip, narration on the right.
 *
 * The take's frames/transcript/events live in `${take.dir}/recording.json` on
 * S3, not in the database — fetched here and cached under the take id (not the
 * presigned url, which is re-signed on every `gripes.get`) because the file
 * itself never changes once uploaded.
 */
export function TakeSection({ take, urlByPath }: { take: Take; urlByPath: Map<string, string> }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoUrl = take.videoPath ? urlByPath.get(take.videoPath) : undefined
  const recordingUrl = urlByPath.get(`${take.dir}/recording.json`)

  const recording = useQuery({
    queryKey: ['inloop.recording', take.id],
    enabled: recordingUrl !== undefined,
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<TakeRecording> => {
      const res = await fetch(recordingUrl!)
      if (!res.ok) throw new Error(`recording.json failed (${res.status})`)
      return res.json() as Promise<TakeRecording>
    },
  })

  const detail = recording.data?.recording

  function seek(tMs: number) {
    const video = videoRef.current
    if (!video) return
    video.currentTime = tMs / 1000
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-cobalt font-mono text-sm">{numeral(take.index)}</span>
        <h2 className="text-base font-semibold">Take {take.index}</h2>
        {take.startedAt && (
          <span className="text-muted-foreground text-sm">{clockTime(take.startedAt)}</span>
        )}
        <span className="text-muted-foreground font-mono text-sm">{mmss(take.durationMs)}</span>
        {take.interrupted && (
          <span className="bg-review-wash text-review rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase">
            interrupted
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {videoUrl ? (
            <video
              ref={videoRef}
              controls
              preload="metadata"
              src={videoUrl}
              className="max-h-[480px] w-full rounded-md border bg-black/95"
            />
          ) : (
            <div className="border-border text-muted-foreground flex h-48 items-center justify-center rounded-md border border-dashed text-sm">
              No video for this take.
            </div>
          )}

          {detail ? (
            <Filmstrip
              frames={detail.frames}
              urlFor={(file) => urlByPath.get(`${take.dir}/${file}`)}
              onSeek={seek}
            />
          ) : (
            <p className="text-muted-foreground py-2 font-mono text-xs">
              {recordingUrl === undefined
                ? 'recording.json was never uploaded — no keyframes or transcript.'
                : recording.isError
                  ? "Couldn't load this take's keyframes and transcript."
                  : 'Loading keyframes…'}
            </p>
          )}
        </div>

        <div className="space-y-4 lg:col-span-1">
          {detail && <TranscriptPanel lines={detail.transcript} onSeek={seek} />}
          {detail && <EventsPanel events={detail.events} />}
        </div>
      </div>
    </section>
  )
}
