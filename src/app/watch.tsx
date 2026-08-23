// /w/:shareToken — the public watch page behind a share link. No session, no
// app chrome: the token in the URL is the whole credential (walkthroughs.shared
// resolves it or 404s). A human handback plays its edited render (final.mp4)
// centered with the transcript under it — a screening, not the signed-in
// two-column viewer; anything else falls back to take-by-take video + narration.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Button } from '~/components/ui/button'
import { useTranscriptFile } from '~/components/viewer/final-cut'
import { dateTime, mmss } from '~/components/viewer/format'
import { SectionHead } from '~/components/viewer/section-head'
import { TranscriptPanel } from '~/components/viewer/transcript-panel'
import type { TakeRecording } from '~/components/viewer/types'
import { useSingleVideoPlayer } from '~/components/viewer/use-segment-player'
import { VideoStage } from '~/components/viewer/video-stage'
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
  const player = useSingleVideoPlayer(urlByPath.get('final.mp4'))
  const transcript = useTranscriptFile(urlByPath.get('transcript.json'))

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
    <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-10">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl font-semibold">{walkthrough.title}</h1>
        <p className="text-muted-foreground font-mono text-sm">
          {dateTime(walkthrough.recordedAt)} · {mmss(walkthrough.durationMs)}
        </p>
      </div>

      {finalUrl ? (
        <>
          <VideoStage player={player} maxHeightClass="max-h-[620px]" />
          {walkthrough.downloadUrl && (
            <p className="text-center">
              <a
                href={walkthrough.downloadUrl}
                className="text-cobalt font-mono text-sm underline underline-offset-4">
                Download the video
              </a>
            </p>
          )}
          {transcript && transcript.length > 0 && (
            <div className="mx-auto max-w-2xl space-y-2 text-left">
              <SectionHead>transcript</SectionHead>
              <TranscriptPanel
                lines={transcript}
                activeMs={player.outputMs}
                onSeek={(tMs) => player.seekOutput(tMs)}
              />
            </div>
          )}
        </>
      ) : (
        walkthrough.takes.map((take) => (
          <div key={take.id} className="rule pt-8">
            <SharedTake take={take} urlByPath={urlByPath} />
          </div>
        ))
      )}

      {shareToken && (
        <WatchNotes
          token={shareToken}
          comments={walkthrough.comments}
          currentAtMs={() => (finalUrl ? Math.round(player.outputMs) : null)}
          onAdded={() => void shared.refetch()}
        />
      )}

      <p className="rule text-muted-foreground pt-6 text-center text-sm">
        Recorded with Handback →{' '}
        <Link to="/" className="text-cobalt hover:underline">
          handback.dev
        </Link>
      </p>
    </div>
  )
}

/** The watcher's name is theirs to keep — it rides along on every note they leave. */
const NAME_KEY = 'handback.watch.name'

type WatchComment = { authorName: string; text: string; atMs: number | null }

/**
 * The public screening's back-channel: notes anyone with the link can leave,
 * optionally pinned to the moment on the player. Stamped notes lead with a mono
 * cobalt `[m:ss]`; unstamped ones skip it. The name persists per browser so a
 * repeat viewer isn't retyping it.
 */
function WatchNotes({
  token,
  comments,
  currentAtMs,
  onAdded,
}: {
  token: string
  comments: readonly WatchComment[]
  currentAtMs: () => number | null
  onAdded: () => void
}) {
  const trpc = useTRPC()
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const add = useMutation(
    trpc.walkthroughs.sharedAddComment.mutationOptions({
      onSuccess: () => {
        setText('')
        onAdded()
      },
    })
  )

  useEffect(() => {
    try {
      const stored = localStorage.getItem(NAME_KEY)
      if (stored) setName(stored)
    } catch {
      // Private mode or no storage — the field just starts empty.
    }
  }, [])

  const error =
    add.error &&
    (add.error.data?.code === 'TOO_MANY_REQUESTS'
      ? 'too many notes from this connection — try later'
      : add.error.message)

  return (
    <div className="mx-auto max-w-2xl space-y-3 text-left">
      <SectionHead>notes</SectionHead>
      {comments.length > 0 ? (
        <ul className="space-y-2">
          {comments.map((comment, i) => (
            <li key={i} className="text-sm leading-relaxed">
              {comment.atMs !== null && (
                <span className="text-cobalt font-mono">[{mmss(comment.atMs)}] </span>
              )}
              <span className="font-medium">{comment.authorName}</span> — {comment.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No notes yet.</p>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmedName = name.trim()
          const trimmedText = text.trim()
          if (!trimmedName || !trimmedText) return
          try {
            localStorage.setItem(NAME_KEY, trimmedName)
          } catch {
            // Losing the remembered name is not worth failing the submit.
          }
          add.mutate({ token, name: trimmedName, text: trimmedText, atMs: currentAtMs() })
        }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name"
          aria-label="Your name"
          className="border-input bg-background focus-visible:border-ring w-32 rounded-md border px-3 py-1.5 text-sm outline-none"
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Leave a note…"
          aria-label="Note"
          className="border-input bg-background focus-visible:border-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={add.isPending || !name.trim() || !text.trim()}>
          leave a note
        </Button>
      </form>
      {error && <p className="text-destructive text-sm">{error}</p>}
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
  const videoUrl = urlByPath.get(take.videoPath ?? `${take.dir}/walkthrough.webm`)
  const player = useSingleVideoPlayer(videoUrl)
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
      <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
        take {take.index} · {mmss(take.durationMs)}
      </p>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {videoUrl ? (
            <VideoStage player={player} />
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
              activeMs={player.outputMs}
              onSeek={(tMs) => player.seekOutput(tMs)}
            />
          )}
        </div>
      </div>
    </section>
  )
}
