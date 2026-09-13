// /w/:shareToken — the public watch page behind a share link. No session, no
// app chrome: the token in the URL is the whole credential (walkthroughs.shared
// resolves it or 404s). A human handback plays its edited render (final.mp4)
// centered with the transcript under it — a screening, not the signed-in
// two-column viewer; anything else falls back to take-by-take video + narration.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Button, buttonVariants } from '~/components/ui/button'
import { useTranscriptFile } from '~/components/viewer/final-cut'
import { dateTime, mmss } from '~/components/viewer/format'
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
      <div className="mx-auto w-full max-w-3xl px-6 py-16">
        <p className="text-muted-foreground text-[13px]">Loading…</p>
      </div>
    )
  }

  if (!walkthrough) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="bg-card max-w-md space-y-3 rounded-lg border p-6">
          <h1 className="text-xl font-semibold tracking-tight">This link isn't live</h1>
          <p className="text-muted-foreground text-[13px]">
            The recording was unshared, or the link was mistyped. Ask whoever sent it for a fresh
            one.
          </p>
          <Link to="/" className="text-cobalt text-[13px] font-medium hover:underline">
            What's Handback?
          </Link>
        </div>
      </div>
    )
  }

  const finalUrl = urlByPath.get('final.mp4')

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-10">
      <div className="space-y-1.5 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{walkthrough.title}</h1>
        <p className="text-muted-foreground font-mono text-[13px]">
          {dateTime(walkthrough.recordedAt)} · {mmss(walkthrough.durationMs)}
        </p>
      </div>

      {finalUrl ? (
        <>
          <VideoStage player={player} maxHeightClass="max-h-[620px]" />
          {walkthrough.downloadUrl && (
            <p className="text-center">
              <a href={walkthrough.downloadUrl} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Download
              </a>
            </p>
          )}
          {transcript && transcript.length > 0 && (
            <div className="mx-auto max-w-2xl space-y-2 text-left text-[15px]">
              <h2 className="text-[13px] font-semibold">Transcript</h2>
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
          <div key={take.id} className="border-border border-t pt-8">
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

      <p className="border-border text-muted-foreground border-t pt-6 text-center text-[13px]">
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
      <h2 className="text-[13px] font-semibold">Notes</h2>
      {comments.length > 0 ? (
        <ul className="space-y-2">
          {comments.map((comment, i) => (
            <li key={i} className="text-[13px] leading-relaxed">
              {comment.atMs !== null && (
                <span className="text-cobalt font-mono">[{mmss(comment.atMs)}] </span>
              )}
              <span className="font-medium">{comment.authorName}</span> — {comment.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-[13px]">No notes yet.</p>
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
          className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring h-8 w-32 rounded-md border px-2.5 text-[13px] outline-none focus-visible:ring-2"
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Leave a note…"
          aria-label="Note"
          className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring h-8 min-w-0 flex-1 rounded-md border px-2.5 text-[13px] outline-none focus-visible:ring-2"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={add.isPending || !name.trim() || !text.trim()}>
          leave a note
        </Button>
      </form>
      {error && <p className="text-destructive text-[13px]">{error}</p>}
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
      <p className="text-[13px] font-medium">
        Part {take.index}{' '}
        <span className="text-muted-foreground font-mono">· {mmss(take.durationMs)}</span>
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
