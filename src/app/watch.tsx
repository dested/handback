// /w/:shareToken — the public watch page behind a share link. No session, no
// app chrome: the token in the URL is the whole credential (walkthroughs.shared
// resolves it or 404s). A human handback plays its edited render (final.mp4)
// with the transcript beside it; anything else falls back to take-by-take video
// + narration, the same reading the signed-in viewer does.

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { FinalCut } from '~/components/viewer/final-cut'
import { dateTime, mmss, numeral } from '~/components/viewer/format'
import { TranscriptPanel } from '~/components/viewer/transcript-panel'
import type { TakeRecording } from '~/components/viewer/types'
import { useTRPC } from '~/lib/trpc'

// Presigns inside the payload live 1h; refetch comfortably before they lapse so
// a tab left open overnight still plays on the next click.
const PRESIGN_REFRESH_MS = 50 * 60 * 1000

export function WatchPage() {
  const { shareToken } = useParams<{ shareToken: string }>()
  const trpc = useTRPC()
  const shared = useQuery({
    ...trpc.walkthroughs.shared.queryOptions({ token: shareToken ?? '' }),
    enabled: Boolean(shareToken),
    staleTime: PRESIGN_REFRESH_MS,
    refetchInterval: PRESIGN_REFRESH_MS,
    retry: false,
  })

  const walkthrough = shared.data
  const urlByPath = useMemo(
    () => new Map((walkthrough?.files ?? []).map((file) => [file.path, file.url])),
    [walkthrough]
  )

  if (shareToken && shared.isPending) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    )
  }

  if (!walkthrough) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <div className="bg-card max-w-md space-y-3 rounded-md border p-6">
          <h1 className="font-display text-xl font-semibold">This link isn't live</h1>
          <p className="text-muted-foreground text-sm">
            The recording was unshared, or the link was mistyped. Ask whoever sent it for a fresh
            one.
          </p>
          <Link to="/" className="text-cobalt text-sm hover:underline">
            What's Handback?
          </Link>
        </div>
      </div>
    )
  }

  const finalUrl = urlByPath.get('final.mp4')

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">{walkthrough.title}</h1>
        <p className="text-muted-foreground text-sm">
          {dateTime(walkthrough.recordedAt)} · {mmss(walkthrough.durationMs)}
        </p>
      </div>

      {finalUrl ? (
        <FinalCut
          videoUrl={finalUrl}
          transcriptUrl={urlByPath.get('transcript.json')}
          downloadUrl={walkthrough.downloadUrl}
        />
      ) : (
        walkthrough.takes.map((take) => (
          <div key={take.id} className="rule pt-8">
            <SharedTake take={take} urlByPath={urlByPath} />
          </div>
        ))
      )}
    </div>
  )
}

type SharedTakeRow = {
  id: string
  index: number
  dir: string
  durationMs: number
  videoPath: string | null
}

/** One raw take — the fallback when a walkthrough has no edited render. */
function SharedTake({ take, urlByPath }: { take: SharedTakeRow; urlByPath: Map<string, string> }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoUrl = take.videoPath ? urlByPath.get(take.videoPath) : undefined
  const recordingUrl = urlByPath.get(`${take.dir}/recording.json`)

  const recording = useQuery({
    queryKey: ['handback.shared-recording', take.id],
    enabled: recordingUrl !== undefined,
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<TakeRecording> => {
      const res = await fetch(recordingUrl!)
      if (!res.ok) throw new Error(`recording.json failed (${res.status})`)
      return res.json() as Promise<TakeRecording>
    },
  })
  const lines = recording.data?.recording.transcript ?? []

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-cobalt font-mono text-sm">{numeral(take.index)}</span>
        <h2 className="text-base font-semibold">Take {take.index}</h2>
        <span className="text-muted-foreground font-mono text-sm">{mmss(take.durationMs)}</span>
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
        </div>
        <div className="lg:col-span-1">
          {lines.length > 0 && (
            <TranscriptPanel
              lines={lines}
              onSeek={(tMs) => {
                const video = videoRef.current
                if (video) video.currentTime = tMs / 1000
              }}
            />
          )}
        </div>
      </div>
    </section>
  )
}
