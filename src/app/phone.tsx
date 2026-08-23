// /phone — Handback on the phone you already carry.
//
// A mobile browser cannot record a screen: getDisplayMedia never shipped there,
// and it isn't coming. So this page doesn't record anything. The phone's own OS
// recorder captures the walkthrough with the mic on, and this page — installed
// as an app, and on Android registered as a share target — takes that clip in,
// distils it right here in the browser (keyframes, transcript, report) and
// uploads the same file set the Chrome recorder produces.
//
// That makes it two pages in one: the guide that gets someone set up, and the
// intake surface the share sheet lands on. They are one component because the
// second is where the first always ends, and a share arriving mid-guide has to
// be able to jump straight over it.
//
// SSR renders this page like every other one, so nothing here touches
// navigator, localStorage or matchMedia during render — the server sees the
// guide on a desktop, and every correction happens in an effect after hydration.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AddClips, ClipList, type Clip } from '~/components/phone/clip-list'
import { DestinationControl, type Destination } from '~/components/phone/destination'
import { PhoneGuide, type Platform } from '~/components/phone/guide'
import { IntentControl, type Intent } from '~/components/phone/intent'
import { KindControl } from '~/components/phone/kind'
import { HUMAN_ROWS, StageList, isCommitted } from '~/components/phone/stages'
import { Button, buttonVariants } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { TokenLimitNotice, isTokenLimitError } from '~/components/token-manager'
import { useCaptureToken } from '~/lib/capture-token'
import { fetchContext, type ServerContext } from '~/lib/capture/context'
import { distillAndUpload } from '~/lib/capture/distill'
import { mmss } from '~/lib/capture/format'
import { probeClip } from '~/lib/capture/probe'
import {
  clearPendingRun,
  loadPendingRun,
  savePendingRun,
  type PendingRun,
} from '~/lib/capture/pending'
import { AuthError, type DistillResult, type StageProgress } from '~/lib/capture/types'
import {
  canInstall,
  clearSharedMedia,
  isStandalone,
  onInstallableChange,
  peekSharedMedia,
  promptInstall,
} from '~/lib/pwa'
import { useActiveSpace } from '~/lib/space'
import { cn } from '~/lib/utils'

/** Refused before a byte moves — a phone that starts a 3 GB upload just dies quietly instead. */
const CLIP_LIMIT = 2 * 1024 * 1024 * 1024
const TOTAL_LIMIT = 4 * 1024 * 1024 * 1024

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * How long the pipeline may go silent before we call it dead. Every stage
 * reports something at least every few seconds, so two minutes of nothing means
 * a decoder that will not come back — and an eternal spinner is worse than a
 * button, because the clip is safe in the pending store either way.
 */
const STALL_MS = 120_000
const WATCHDOG_MS = 15_000
const STALL_MESSAGE =
  'the phone paused the work for too long — tap try again, it picks up from your clip'

type Phase = 'guide' | 'intake' | 'working' | 'done' | 'failed'

function detectPlatform(userAgent: string, maxTouchPoints: number): Platform {
  if (/Android/.test(userAgent)) return 'android'
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios'
  // An iPad on iPadOS 13+ claims to be a Mac; a Mac has no touch points.
  if (maxTouchPoints > 1 && /Macintosh/.test(userAgent)) return 'ios'
  return 'desktop'
}

export function PhonePage() {
  const [phase, setPhase] = useState<Phase>('guide')
  // Both start at their SSR-safe answer and are corrected on mount, so the
  // server's markup and the first client paint agree.
  const [platform, setPlatform] = useState<Platform>('desktop')
  const [standalone, setStandalone] = useState(false)
  const [installable, setInstallable] = useState(false)

  const [clips, setClips] = useState<Clip[]>([])
  const [clipError, setClipError] = useState<string | null>(null)
  const [shareMissed, setShareMissed] = useState(false)
  // The share path never sees the picker and always ships 'agent' — sharing was
  // the send, and pausing it to ask would undo that. Manual intake chooses.
  const [kind, setKind] = useState<'agent' | 'human'>('agent')
  const [intent, setIntent] = useState<Intent | null>(null)
  const [title, setTitle] = useState('')
  const [placeholder, setPlaceholder] = useState('Walkthrough')

  const [progress, setProgress] = useState<StageProgress | null>(null)
  const [result, setResult] = useState<DistillResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  /** A run recovered from storage, waiting on the person to say resume or discard. */
  const [resumable, setResumable] = useState(false)
  /** The watchdog aborts the same controller Cancel does; this is how send() tells them apart. */
  const stalled = useRef(false)
  /** Wall clock of the last thing the pipeline said. The watchdog reads it. */
  const heardAt = useRef(0)
  const wakeLock = useRef<WakeLockSentinel | null>(null)

  const { spaces, space, setActiveSpace } = useActiveSpace()
  const [destination, setDestination] = useState<Destination>({ teamId: null, projectId: null })
  // The stored space arrives in a mount effect, so the destination follows the
  // active space until the moment someone sets it themselves.
  const chosen = useRef(false)

  const [ctx, setCtx] = useState<ServerContext | null>(null)
  const [ctxFailed, setCtxFailed] = useState(false)
  const [ctxAttempt, setCtxAttempt] = useState(0)

  const withToken = useCaptureToken('Phone')

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints))
    setStandalone(isStandalone())
    setInstallable(canInstall())
    const now = new Date()
    setPlaceholder(`Walkthrough — ${MONTHS[now.getMonth()]} ${now.getDate()}`)
  }, [])

  useEffect(() => onInstallableChange(setInstallable), [])

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

  /** Empties the page. Nothing here is recoverable afterwards, so it clears both stores. */
  const reset = useCallback(() => {
    setClips((prev) => {
      for (const clip of prev) if (clip.posterUrl) URL.revokeObjectURL(clip.posterUrl)
      return []
    })
    setClipError(null)
    setShareMissed(false)
    setResumable(false)
    setKind('agent')
    setIntent(null)
    setTitle('')
    setProgress(null)
    setResult(null)
    setFailure(null)
    void clearPendingRun()
    void clearSharedMedia()
    setPhase('guide')
  }, [])

  /** The resume callout's quiet half: the person is done with this walkthrough. */
  const discard = useCallback(() => {
    setClips((prev) => {
      for (const clip of prev) if (clip.posterUrl) URL.revokeObjectURL(clip.posterUrl)
      return []
    })
    setClipError(null)
    setResumable(false)
    setKind('agent')
    setIntent(null)
    setTitle('')
    void clearPendingRun()
    void clearSharedMedia()
    setPhase('intake')
  }, [])

  const intakeWith = useCallback(
    (files: File[]) => {
      addFiles(files)
      setPhase('intake')
    },
    [addFiles]
  )

  /**
   * Armed by a share that arrived with clips, disarmed by the effect below the
   * moment they have finished probing. A ref rather than state because arming it
   * must not paint, and because the guard has to survive the render that adding
   * the clips causes.
   */
  const autoStart = useRef(false)

  // Two ways onto this page, handled once.
  //
  // A share (?shared=1) means the person already pressed send — on their phone
  // it was the share sheet, and asking them to press "Send to Handback" a second
  // time is asking them to do the thing they thought they just did. So a share
  // with clips skips intake entirely and starts the run itself.
  //
  // Without ?shared=1 we look for a run that died: a walkthrough that reached
  // this page and never finished. It is NOT auto-resumed — after a crash the
  // person decides, because the crash may well have been this page.
  const consumed = useRef(false)
  const [searchParams] = useSearchParams()
  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    const shared = searchParams.get('shared') === '1'
    const shareFailed = searchParams.get('error') === 'share'
    let live = true

    if (!shared) {
      if (searchParams.get('new') === '1') {
        setPhase('intake')
        return
      }
      void loadPendingRun().then((run: PendingRun | null) => {
        if (!live || !run) return
        addFiles(run.files)
        setTitle(run.title)
        setKind(run.kind)
        setIntent(run.intent ?? null)
        // A recovered run remembers where it was going; the active space must
        // not quietly redirect it somewhere else.
        chosen.current = true
        setDestination({ teamId: run.teamId, projectId: run.projectId })
        setResumable(true)
        setPhase('intake')
      })
      return () => {
        live = false
      }
    }

    void peekSharedMedia().then((media) => {
      if (!live) return
      const files = media?.files ?? []
      if (files.length) {
        addFiles(files)
        if (media?.title) setTitle(media.title)
      }
      // An empty stash, or a share the service worker never got to intercept:
      // show the notice and let them pick the clip rather than start a run that
      // may be missing the only thing in it.
      if (shareFailed || !files.length) {
        setShareMissed(true)
        setPhase('intake')
        return
      }
      // Sharing was the send. Go straight to work; Cancel is how someone
      // changes their mind about the destination or the title.
      autoStart.current = true
      setPhase('working')
    })
    return () => {
      live = false
    }
  }, [searchParams, addFiles])

  useEffect(() => {
    if (chosen.current) return
    setDestination((current) =>
      current.teamId === space.teamId ? current : { teamId: space.teamId, projectId: null }
    )
  }, [space.teamId])

  // Projects are only worth fetching once someone is actually choosing a
  // destination, and the token is minted lazily for the same reason: opening
  // the guide should not create an account credential.
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
    // Written before the first byte of work, so a tab killed one second in still
    // leaves something to resume from.
    void savePendingRun({
      files: clips.map((clip) => clip.file),
      title,
      teamId: destination.teamId,
      projectId: destination.projectId,
      kind,
      intent,
      savedAt: Date.now(),
    })
    try {
      const shipped = await withToken((token) =>
        distillAndUpload(
          // The row's own read goes with the file: reading a clip is a minute of
          // an iPhone's life, and the pipeline should not spend it twice.
          clips.map((clip) =>
            clip.probe ? { file: clip.file, probe: clip.probe } : { file: clip.file }
          ),
          {
            token,
            teamId: destination.teamId,
            projectId: destination.projectId,
            title: sendTitle,
            kind,
            ...(intent ? { intent } : {}),
            onProgress: (update) => {
              heardAt.current = Date.now()
              setProgress(update)
            },
            signal: controller.signal,
          }
        )
      )
      // Finalize returned: the walkthrough is in the space. Only now is it safe
      // to let go of the copies that were keeping it recoverable.
      void clearPendingRun()
      void clearSharedMedia()
      setResumable(false)
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
          ? "this phone's link to your account expired — sign in again"
          : error instanceof Error
            ? error.message
            : "the walkthrough didn't finish uploading"
      )
      setPhase('failed')
    } finally {
      abort.current = null
    }
  }, [clips, destination, kind, intent, title, sendTitle, withToken])

  // Everything below keeps a run alive on a device that would rather it didn't.

  // The intake as it stands, saved on every change. A share that lands while the
  // phone is nearly out of memory can die before the person sees anything at
  // all, so the copy has to exist before the run does.
  useEffect(() => {
    if (phase !== 'intake' || !clips.length) return
    void savePendingRun({
      files: clips.map((clip) => clip.file),
      title,
      teamId: destination.teamId,
      projectId: destination.projectId,
      kind,
      intent,
      savedAt: Date.now(),
    })
  }, [phase, clips, title, destination, kind, intent])

  // The auto-start. Arming happens in the share pickup; firing waits here until
  // the clips it added are in state and done probing, because send() reads them
  // from state. Disarming before the call is what keeps it to one run — the ref
  // survives the renders that adding and probing the clips cause.
  useEffect(() => {
    if (!autoStart.current) return
    if (clips.some((clip) => clip.probing)) return
    autoStart.current = false
    if (!clips.length) {
      // Every shared file failed to read; clipError already says why.
      setPhase('intake')
      return
    }
    void send()
  }, [clips, send])

  // The screen must not sleep mid-distill: a locked phone throttles timers and
  // suspends the decoder, and the run stops making progress. A denied lock is
  // fine — it costs the person a slower run, never the walkthrough.
  useEffect(() => {
    if (phase !== 'working') return
    let live = true
    const acquire = async () => {
      if (!live || wakeLock.current) return
      if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        if (!live) {
          void sentinel.release().catch(() => {})
          return
        }
        // The browser drops the lock whenever the tab hides; this keeps the ref honest.
        sentinel.addEventListener('release', () => {
          if (wakeLock.current === sentinel) wakeLock.current = null
        })
        wakeLock.current = sentinel
      } catch {
        // Denied, unsupported, or refused on a battery saver. Not our problem.
      }
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      // Coming back from a freeze, the watchdog's clock and the pipeline thaw
      // together — reset the clock first or it kills a run that was about to
      // resume.
      heardAt.current = Date.now()
      void acquire()
    }
    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisibility)
      const held = wakeLock.current
      wakeLock.current = null
      if (held) void held.release().catch(() => {})
    }
  }, [phase])

  // Leaving mid-distill throws the work away, and on a phone "leaving" is one
  // stray back-swipe. The browser writes its own wording; all we can do is ask.
  useEffect(() => {
    if (phase !== 'working') return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [phase])

  // A stage that has gone quiet for two minutes is a decoder that isn't coming
  // back. Turn the spinner into a button — the clips are in the pending store,
  // so "try again" is a promise we can keep.
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
    <div className="max-w-3xl space-y-12">
      <header className="space-y-4">
        <p className="text-cobalt font-mono text-xs tracking-widest uppercase">Phone</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Record anywhere. Hand it back.
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          Your phone already records its own screen with your voice over it — this page takes that
          clip, distils it into keyframes and a transcript, and files it as a walkthrough your agent
          can read.
        </p>
        <p className="text-muted-foreground text-xs">
          Where your recording goes →{' '}
          <Link to="/privacy#processors" className="text-cobalt hover:underline">
            /privacy#processors
          </Link>
        </p>
      </header>

      {phase === 'guide' && (
        <PhoneGuide
          platform={platform}
          standalone={standalone}
          installable={installable}
          spaceLabel={space.name}
          onInstall={() => void promptInstall()}
          onFiles={intakeWith}
          onIntake={() => setPhase('intake')}
        />
      )}

      {phase === 'intake' && (
        <section className="space-y-6">
          {shareMissed && (
            <p className="text-muted-foreground text-sm">
              the share didn't carry a file — pick the clip below instead
            </p>
          )}

          {resumable && (
            <div className="border-review/40 bg-review-wash space-y-3 rounded-md border p-4">
              <div className="flex items-center gap-3">
                <span className="bg-review size-2 shrink-0 rounded-full" />
                <p className="text-sm font-medium">This walkthrough didn't finish uploading.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" size="sm" onClick={() => void send()}>
                  Resume upload
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={discard}>
                  discard
                </Button>
              </div>
            </div>
          )}

          {/* Who it's for decides everything downstream — distill or ship
              whole, agent queue or watch page — so it sits above the rest.
              Only manual intake sees it: a share already went as 'agent'. */}
          <KindControl value={kind} onChange={setKind} />

          {/* What it's about — only an agent handback is briefed; a human one
              is watched, so the tag would mean nothing there. */}
          {kind === 'agent' && <IntentControl value={intent} onChange={setIntent} />}

          <DestinationControl
            ctx={ctx}
            ctxFailed={ctxFailed}
            spaces={spaces}
            value={destination}
            onChange={pickDestination}
            onRetryContext={() => setCtxAttempt((n) => n + 1)}
          />

          <div className="space-y-2">
            <Label htmlFor="phone-title">Title</Label>
            <Input
              id="phone-title"
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
                that's more than this phone can distil in one go — keep each clip under 2 GB and the
                set under 4 GB.
              </p>
            )}
            <AddClips onAdd={addFiles} />
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
            {/* A share skips intake entirely, so this line is the only place the
                person sees where it is going — and Cancel is how they change it. */}
            <p className="text-muted-foreground truncate font-mono text-sm">
              to {destinationName} · {sendTitle}
              {kind === 'human' && ' · video for a person'}
            </p>
          </div>
          <StageList progress={progress} rows={kind === 'human' ? HUMAN_ROWS : undefined} />
          <p className="text-muted-foreground font-mono text-xs">
            keep this screen open — the phone pauses the work if you leave
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
            <p className="text-sm font-medium">{title.trim() || placeholder}</p>
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
              shipped without keyframes — this phone couldn't decode the video, so the clip itself
              carries the picture
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Link to={result.url} className={cn(buttonVariants())}>
              Open the walkthrough
            </Link>
            <Button type="button" variant="ghost" onClick={reset}>
              record another
            </Button>
          </div>
        </section>
      )}

      {phase === 'failed' && (
        <section className="border-border border-l-destructive bg-card space-y-3 rounded-md border border-l-2 p-5">
          <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
            Didn't make it
          </p>
          {isTokenLimitError(failure) ? (
            <TokenLimitNotice />
          ) : (
            <p className="text-sm leading-relaxed">{failure}</p>
          )}
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
 * a recording is dropped rather than left sitting in the list waiting to sink
 * the whole run at send time.
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
    setClipError(
      error instanceof Error
        ? error.message
        : "that file can't be read as a recording on this phone"
    )
  }
}
