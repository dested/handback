// /upload — the desktop twin of /phone's intake.
//
// Same pipeline, same file set, same destination control; what it drops is
// everything that exists only because phones are hostile. There is no platform
// guide (you already have the clip), no share-sheet pickup, no auto-start, and
// no pending-run store — a desktop tab does not get OOM-killed mid-distill, and
// a resume prompt you never need is a resume prompt that eventually lies. The
// watchdog stays: a decoder can wedge on any machine.
//
// SSR renders this like every other page, so nothing here touches navigator or
// localStorage during render.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CLIP_ACCEPT, ClipList, type Clip } from '~/components/phone/clip-list'
import { DestinationControl, type Destination } from '~/components/phone/destination'
import { KindControl } from '~/components/phone/kind'
import { HUMAN_ROWS, StageList, isCommitted } from '~/components/phone/stages'
import { Button, buttonVariants } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { useCaptureToken } from '~/lib/capture-token'
import { fetchContext, type ServerContext } from '~/lib/capture/context'
import { distillAndUpload } from '~/lib/capture/distill'
import { mmss } from '~/lib/capture/format'
import { probeClip } from '~/lib/capture/probe'
import { AuthError, type DistillResult, type StageProgress } from '~/lib/capture/types'
import { useActiveSpace } from '~/lib/space'
import { cn } from '~/lib/utils'

/** Refused before a byte moves — these mirror server/ingest.ts's hard caps
 *  (2 GB/file, 4 GB/walkthrough); a bigger client allowance just means a
 *  doomed declare after a long upload. */
const CLIP_LIMIT = 2 * 1024 * 1024 * 1024
const TOTAL_LIMIT = 4 * 1024 * 1024 * 1024

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * How long the pipeline may go silent before we call it dead. Every stage
 * reports something at least every few seconds, so two minutes of nothing means
 * a decoder that will not come back — and an eternal spinner is worse than a
 * button.
 */
const STALL_MS = 120_000
const WATCHDOG_MS = 15_000
const STALL_MESSAGE = 'the browser stopped making progress — try again from the clips below'

type Phase = 'intake' | 'working' | 'done' | 'failed'

export function UploadPage() {
  const [phase, setPhase] = useState<Phase>('intake')

  const [clips, setClips] = useState<Clip[]>([])
  const [clipError, setClipError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [kind, setKind] = useState<'agent' | 'human'>('agent')
  const [title, setTitle] = useState('')
  const [placeholder, setPlaceholder] = useState('Walkthrough')

  const [progress, setProgress] = useState<StageProgress | null>(null)
  const [result, setResult] = useState<DistillResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  /** The watchdog aborts the same controller Cancel does; this is how send() tells them apart. */
  const stalled = useRef(false)
  /** Wall clock of the last thing the pipeline said. The watchdog reads it. */
  const heardAt = useRef(0)
  const picker = useRef<HTMLInputElement | null>(null)

  const { spaces, space, setActiveSpace } = useActiveSpace()
  const [destination, setDestination] = useState<Destination>({ teamId: null, projectId: null })
  // The stored space arrives in a mount effect, so the destination follows the
  // active space until the moment someone sets it themselves.
  const chosen = useRef(false)

  const [ctx, setCtx] = useState<ServerContext | null>(null)
  const [ctxFailed, setCtxFailed] = useState(false)
  const [ctxAttempt, setCtxAttempt] = useState(0)

  const withToken = useCaptureToken('Upload')

  useEffect(() => {
    const now = new Date()
    setPlaceholder(`Walkthrough — ${MONTHS[now.getMonth()]} ${now.getDate()}`)
  }, [])

  // Revoke on unmount whatever posters are still alive. The list is mirrored
  // into a ref because the cleanup runs once, long after the last render.
  const alive = useRef<Clip[]>([])
  useEffect(() => {
    alive.current = clips
  }, [clips])
  useEffect(() => {
    return () => {
      for (const clip of alive.current) if (clip.posterUrl) URL.revokeObjectURL(clip.posterUrl)
    }
  }, [])

  const addFiles = useCallback((files: File[]) => {
    if (!files.length) return
    setClipError(null)
    const added: Clip[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      probing: true,
      durationMs: 0,
      hasVideo: false,
      posterUrl: null,
      probe: null,
    }))
    setClips((prev) => [...prev, ...added])
    for (const clip of added) {
      void probeInto(clip, setClips, setClipError)
    }
  }, [])

  const removeClip = useCallback((id: string) => {
    setClips((prev) => {
      const going = prev.find((clip) => clip.id === id)
      if (going?.posterUrl) URL.revokeObjectURL(going.posterUrl)
      return prev.filter((clip) => clip.id !== id)
    })
  }, [])

  /** Back to an empty page, ready for the next one. */
  const reset = useCallback(() => {
    setClips((prev) => {
      for (const clip of prev) if (clip.posterUrl) URL.revokeObjectURL(clip.posterUrl)
      return []
    })
    setClipError(null)
    setTitle('')
    setProgress(null)
    setResult(null)
    setFailure(null)
    setPhase('intake')
  }, [])

  // Projects are only worth fetching once someone is actually choosing a
  // destination, and the token is minted lazily for the same reason: opening
  // this page should not create an account credential.
  useEffect(() => {
    if (phase !== 'intake' || ctx) return
    let live = true
    setCtxFailed(false)
    void withToken((token) => fetchContext(token)).then(
      (loaded) => {
        if (live) setCtx(loaded)
      },
      () => {
        if (live) setCtxFailed(true)
      }
    )
    return () => {
      live = false
    }
  }, [phase, ctx, ctxAttempt, withToken])

  useEffect(() => {
    if (chosen.current) return
    setDestination((current) =>
      current.teamId === space.teamId ? current : { teamId: space.teamId, projectId: null }
    )
  }, [space.teamId])

  const pickDestination = useCallback(
    (next: Destination) => {
      chosen.current = true
      setDestination(next)
      // Keep the rest of the app pointed where the person just pointed this.
      if (next.teamId !== space.teamId) setActiveSpace(next.teamId)
    },
    [space.teamId, setActiveSpace]
  )

  const destinationName = spaces.find((s) => s.teamId === destination.teamId)?.name ?? 'Personal'
  const probing = clips.some((clip) => clip.probing)
  const totalBytes = clips.reduce((sum, clip) => sum + clip.file.size, 0)
  const totalMs = clips.reduce((sum, clip) => sum + clip.durationMs, 0)
  const oversized = clips.some((clip) => clip.file.size > CLIP_LIMIT) || totalBytes > TOTAL_LIMIT

  const sendTitle = title.trim() || placeholder

  const send = useCallback(async () => {
    if (!clips.length) return
    const controller = new AbortController()
    abort.current = controller
    stalled.current = false
    heardAt.current = Date.now()
    setProgress(null)
    setFailure(null)
    setPhase('working')
    try {
      const shipped = await withToken((token) =>
        distillAndUpload(
          // The row's own read goes with the file; the pipeline should not
          // decode the same clip twice.
          clips.map((clip) =>
            clip.probe ? { file: clip.file, probe: clip.probe } : { file: clip.file }
          ),
          {
            token,
            teamId: destination.teamId,
            projectId: destination.projectId,
            title: sendTitle,
            kind,
            onProgress: (update) => {
              heardAt.current = Date.now()
              setProgress(update)
            },
            signal: controller.signal,
          }
        )
      )
      setResult(shipped)
      setPhase('done')
    } catch (error) {
      // The watchdog aborts through the same controller Cancel does, and it has
      // already said its piece.
      if (stalled.current) return
      // Cancelling is not a failure — the clips are still sitting there.
      if (controller.signal.aborted || (error instanceof Error && error.message === 'cancelled')) {
        setPhase('intake')
        return
      }
      setFailure(
        error instanceof AuthError
          ? "this browser's link to your account expired — sign in again"
          : error instanceof Error
            ? error.message
            : "the walkthrough didn't finish uploading"
      )
      setPhase('failed')
    } finally {
      abort.current = null
    }
  }, [clips, destination, kind, sendTitle, withToken])

  // Nothing is stashed anywhere, so leaving mid-distill really does throw the
  // work away. The browser writes its own wording; all we can do is ask.
  useEffect(() => {
    if (phase !== 'working') return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [phase])

  // A stage that has gone quiet for two minutes is a decoder that isn't coming
  // back. Turn the spinner into a button — the clips are still in the list.
  useEffect(() => {
    if (phase !== 'working') return
    const timer = window.setInterval(() => {
      if (Date.now() - heardAt.current <= STALL_MS) return
      stalled.current = true
      abort.current?.abort()
      setFailure(STALL_MESSAGE)
      setPhase('failed')
    }, WATCHDOG_MS)
    return () => window.clearInterval(timer)
  }, [phase])

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-4">
        <p className="text-cobalt font-mono text-xs tracking-widest uppercase">Upload</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Hand back a recording.
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          Already have the clip? Drop it here — distilled into keyframes, transcript and report for
          your agent, or shipped whole for a person to review — without leaving the browser.
        </p>
        <p className="text-muted-foreground text-xs">
          Where your recording goes →{' '}
          <Link to="/privacy#processors" className="text-cobalt hover:underline">
            /privacy#processors
          </Link>
        </p>
      </header>

      {phase === 'intake' && (
        <section className="space-y-6">
          <input
            ref={picker}
            type="file"
            accept={CLIP_ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (picked.length) addFiles(picked)
            }}
          />
          {/* The whole zone is the browse button; the drag handlers are the
              other half of the same affordance, not a second one. */}
          <button
            type="button"
            onClick={() => picker.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              addFiles(Array.from(event.dataTransfer.files))
            }}
            className={cn(
              'flex w-full items-center justify-center rounded-md border border-dashed px-6 py-12 text-sm transition-colors',
              dragging
                ? 'border-cobalt bg-cobalt-wash/40 text-cobalt'
                : 'border-border bg-muted/20 text-muted-foreground hover:border-cobalt/50'
            )}>
            drop a screen recording here — or <span className="text-primary ml-1">browse</span>
          </button>

          {/* Who it's for decides everything downstream — distill or ship
              whole, agent queue or watch page — so it sits above the rest. */}
          <KindControl value={kind} onChange={setKind} />

          <DestinationControl
            ctx={ctx}
            ctxFailed={ctxFailed}
            spaces={spaces}
            value={destination}
            onChange={pickDestination}
            onRetryContext={() => setCtxAttempt((n) => n + 1)}
          />

          <div className="space-y-2">
            <Label htmlFor="upload-title">Title</Label>
            <Input
              id="upload-title"
              value={title}
              placeholder={placeholder}
              maxLength={120}
              autoComplete="off"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-3">
            <ClipList clips={clips} onRemove={removeClip} />
            {clipError && <p className="text-destructive text-sm">{clipError}</p>}
            {oversized && (
              <p className="text-destructive text-sm">
                that's more than a walkthrough can carry — keep each clip under 2 GB and the set
                under 4 GB.
              </p>
            )}
          </div>

          <Button
            type="button"
            className="h-[46px] w-full"
            disabled={!clips.length || probing || oversized}
            onClick={() => void send()}>
            Send to Handback
          </Button>
        </section>
      )}

      {phase === 'working' && (
        <section className="space-y-6">
          <div className="space-y-1">
            <p className="text-muted-foreground font-mono text-sm">
              {clips.length} {clips.length === 1 ? 'clip' : 'clips'} · {mmss(totalMs)}
            </p>
            <p className="text-muted-foreground truncate font-mono text-sm">
              to {destinationName} · {sendTitle}
              {kind === 'human' && ' · video for a person'}
            </p>
          </div>
          <StageList progress={progress} rows={kind === 'human' ? HUMAN_ROWS : undefined} />
          <p className="text-muted-foreground font-mono text-xs">
            keep this tab open — the work happens here, not on the server
          </p>
          {!isCommitted(progress) && (
            <Button type="button" variant="outline" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          )}
        </section>
      )}

      {phase === 'done' && result && (
        <section className="space-y-6">
          <div className="border-approve/40 bg-approve-wash space-y-3 rounded-md border p-5">
            <div className="flex items-center gap-3">
              <span className="bg-approve size-2 shrink-0 rounded-full" />
              <p className="font-display text-2xl font-semibold">Handed back.</p>
            </div>
            <p className="text-sm font-medium">{sendTitle}</p>
            <p className="text-muted-foreground font-mono text-xs">
              {kind === 'human'
                ? `video for a person · ${result.lineCount} lines · ${mmss(result.durationMs)}`
                : `${result.frameCount} keyframes · ${result.lineCount} lines · ${mmss(result.durationMs)}`}
            </p>
          </div>

          {!result.transcribed && (
            <p className="text-muted-foreground text-sm">
              shipped without a transcript — the server's transcription is off right now
            </p>
          )}

          {kind === 'human' && (
            <p className="text-muted-foreground text-sm">
              the clip shipped whole — open it to tighten the cut, then share the link
            </p>
          )}

          {kind !== 'human' && result.frameCount === 0 && clips.some((clip) => clip.hasVideo) && (
            <p className="text-muted-foreground text-sm">
              shipped without keyframes — this browser couldn't decode the video, so the clip itself
              carries the picture
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Link to={result.url} className={cn(buttonVariants())}>
              Open the walkthrough
            </Link>
            <Button type="button" variant="ghost" onClick={reset}>
              upload another
            </Button>
          </div>
        </section>
      )}

      {phase === 'failed' && (
        <section className="border-border border-l-destructive bg-card space-y-3 rounded-md border border-l-2 p-5">
          <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
            Didn't make it
          </p>
          <p className="text-sm leading-relaxed">{failure}</p>
          <p className="text-sm">
            <button
              type="button"
              onClick={() => void send()}
              className="text-primary underline underline-offset-4">
              try again
            </button>
            <span className="text-muted-foreground"> · </span>
            <button
              type="button"
              onClick={reset}
              className="text-muted-foreground underline underline-offset-4">
              start over
            </button>
          </p>
        </section>
      )}
    </div>
  )
}

/**
 * Read a picked file well enough to draw its row. A file that can't be read as
 * a recording is dropped rather than left in the list waiting to sink the whole
 * run at send time.
 */
async function probeInto(
  clip: Clip,
  setClips: React.Dispatch<React.SetStateAction<Clip[]>>,
  setClipError: (message: string) => void
): Promise<void> {
  try {
    const probe = await probeClip(clip.file)
    setClips((prev) => {
      if (!prev.some((entry) => entry.id === clip.id)) {
        // Removed while it was being read; nothing owns this poster now.
        if (probe.posterUrl) URL.revokeObjectURL(probe.posterUrl)
        return prev
      }
      return prev.map((entry) =>
        entry.id === clip.id
          ? {
              ...entry,
              probing: false,
              durationMs: probe.durationMs,
              hasVideo: probe.hasVideo,
              posterUrl: probe.posterUrl,
              probe,
            }
          : entry
      )
    })
  } catch (error) {
    setClips((prev) => prev.filter((entry) => entry.id !== clip.id))
    setClipError(error instanceof Error ? error.message : "that file can't be read as a recording")
  }
}
