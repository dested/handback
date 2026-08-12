// /record — a Handback recording without the extension.
//
// The same recorder, in a tab. `src/lib/capture/live.ts` is the extension's
// capture engine with the content-script half removed (it cannot exist in a
// page); everything after the last frame — transcript, cleanup pass, contact
// sheets, report.md, MANIFEST.txt, declare/PUT/finalize — is the pipeline
// /phone and /upload already run, so a walkthrough recorded here is
// indistinguishable from one recorded in the extension apart from the page
// telemetry nobody could have collected.
//
// The extension stays the better tool and this page says so: it draws on the
// page, it captures the console, it marks the moment you clicked. This is the
// door for someone who won't install anything.
//
// SSR renders this like every other page, so nothing here touches navigator,
// indexedDB or documentPictureInPicture during render.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Editor } from '~/components/edit/editor'
import { DestinationControl, type Destination } from '~/components/phone/destination'
import { RECORD_ROWS, StageList, isCommitted } from '~/components/phone/stages'
import { RecordingHud } from '~/components/record/hud'
import { RecordingPanel } from '~/components/record/panel'
import { PipHost, usePipWindow } from '~/components/record/pip'
import { TakeList } from '~/components/record/takes'
import { Button, buttonVariants } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { useCopy } from '~/components/viewer/use-copy'
import { useCaptureToken } from '~/lib/capture-token'
import { fetchContext, type ServerContext } from '~/lib/capture/context'
import { mmss } from '~/lib/capture/format'
import {
  canRecordScreen,
  isPickerRefusal,
  LiveRecorder,
  type LiveThumb,
  type LiveUpdate,
} from '~/lib/capture/live'
import {
  blobs,
  clearAll,
  deleteTake,
  listTakes,
  loadDraft,
  loadEditState,
  recoverTake,
  renumberTakes,
  saveDraft,
  saveEditState,
  type LiveTake,
} from '~/lib/capture/live-store'
import {
  ensureTranscript,
  sendHumanWalkthrough,
  sendLiveWalkthrough,
} from '~/lib/capture/live-upload'
import { AuthError, type DistillResult, type StageProgress } from '~/lib/capture/types'
import {
  editSegments,
  initialEditState,
  parseEditState,
  withSilenceCuts,
  type EditState,
} from '~/lib/edit/edl'
import { renderEdit } from '~/lib/edit/render'
import { seekableBlob } from '~/lib/edit/remux'
import { computeEnvelope, silenceCuts, type Envelope } from '~/lib/edit/silence'
import { useActiveSpace } from '~/lib/space'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The floating HUD's window. Small — it is a clock, two lines and a button. */
const PIP_SIZE = { width: 320, height: 300 }

/**
 * How long the send may go silent before we call it dead. Every stage reports
 * something every few seconds, so two minutes of nothing is a decoder that is
 * not coming back — and an eternal spinner is worse than a button. The takes are
 * still on disk either way.
 */
const STALL_MS = 120_000
const WATCHDOG_MS = 15_000
const STALL_MESSAGE = 'the browser stopped making progress — the takes are still here, try again'

type Phase = 'idle' | 'recording' | 'review' | 'edit' | 'working' | 'done' | 'failed'

/** Where the edit-phase preparation is: transcripts + envelopes per take. */
type EditPrep =
  | { status: 'loading'; detail: string }
  | { status: 'ready' }
  | { status: 'failed'; detail: string }

export function RecordPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [takes, setTakes] = useState<LiveTake[]>([])
  const [live, setLive] = useState<LiveUpdate | null>(null)
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)
  const [thumbs, setThumbs] = useState<LiveThumb[]>([])
  const [stopping, setStopping] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)
  /** Undefined until the mount check answers; false is a real "this browser can't". */
  const [capable, setCapable] = useState<boolean | undefined>(undefined)
  const [recovered, setRecovered] = useState(false)

  // Who the recording is FOR — the fork the whole page follows. 'agent' =
  // distill into keyframes + report; 'human' = pristine 30 fps video, no
  // distill, tightened and shared with a person. Fixed once a take exists:
  // the two modes capture differently, and a session can't mix them.
  const [kind, setKind] = useState<'agent' | 'human'>('agent')
  const [title, setTitle] = useState('')
  const [placeholder, setPlaceholder] = useState('Walkthrough')
  const [progress, setProgress] = useState<StageProgress | null>(null)
  const [result, setResult] = useState<DistillResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)

  // The human-handback edit. Envelopes and raw blobs live in refs (decoded
  // once, never rendered); the object URLs feed the preview and are revoked
  // when the edit ends.
  const [editState, setEditState] = useState<EditState | null>(null)
  const [editPrep, setEditPrep] = useState<EditPrep>({ status: 'loading', detail: '' })
  const [videoUrls, setVideoUrls] = useState<Map<string, string>>(new Map())
  const [humanProgress, setHumanProgress] = useState<{
    stage: 'render' | 'upload'
    pct: number
    detail?: string
  } | null>(null)
  const [finalBlob, setFinalBlob] = useState<Blob | null>(null)
  const envelopes = useRef<Map<string, Envelope | null>>(new Map())
  const takeBlobs = useRef<Map<string, Blob>>(new Map())

  const recorder = useRef<LiveRecorder | null>(null)
  const session = useRef<string>('')
  const abort = useRef<AbortController | null>(null)
  const stalled = useRef(false)
  const heardAt = useRef(0)
  /** Mirrors `thumbs` so the unmount cleanup can revoke the filmstrip's object
   *  URLs — the cleanup runs once, long after the last render. */
  const thumbsRef = useRef<LiveThumb[]>([])

  const pip = usePipWindow(PIP_SIZE)
  const withToken = useCaptureToken('Recorder')

  const { spaces, space, setActiveSpace } = useActiveSpace()
  const [destination, setDestination] = useState<Destination>({ teamId: null, projectId: null })
  const chosen = useRef(false)

  const [ctx, setCtx] = useState<ServerContext | null>(null)
  const [ctxFailed, setCtxFailed] = useState(false)
  const [ctxAttempt, setCtxAttempt] = useState(0)

  const sendTitle = title.trim() || placeholder
  const recording = phase === 'recording'
  const working = phase === 'working'

  useEffect(() => {
    const now = new Date()
    setPlaceholder(`Walkthrough — ${MONTHS[now.getMonth()]} ${now.getDate()}`)
    setCapable(canRecordScreen())
  }, [])

  // Whatever is still on disk from a previous visit. A take left mid-recording
  // is one whose tab died: its chunks are there, so it is reassembled into the
  // video it never got rather than thrown away.
  useEffect(() => {
    let liveMount = true
    void (async () => {
      try {
        const stored = await listTakes()
        if (!stored.length) return
        const repaired: LiveTake[] = []
        for (const take of stored) {
          repaired.push(take.state === 'recording' ? await recoverTake(take) : take)
        }
        const laid = await renumberTakes(repaired)
        const draft = await loadDraft()
        if (!liveMount) return
        session.current = draft?.sessionId ?? laid[0]?.sessionId ?? ''
        if (draft?.title) setTitle(draft.title)
        if (draft) {
          chosen.current = true
          setDestination({ teamId: draft.teamId, projectId: draft.projectId })
          setKind(draft.kind)
        }
        setTakes(laid)
        setRecovered(repaired.some((take) => take.interrupted))
        setPhase('review')
      } catch {
        // A blocked or private-mode IndexedDB just means nothing to resume.
      }
    })()
    return () => {
      liveMount = false
    }
  }, [])

  // Projects are only worth fetching once someone is actually choosing a
  // destination — which is only on the review screen — and the token is minted
  // lazily for the same reason: opening this page, or recording into it, should
  // not by itself create an account credential.
  useEffect(() => {
    if (ctx || phase !== 'review') return
    let liveFetch = true
    setCtxFailed(false)
    void withToken((token) => fetchContext(token)).then(
      (loaded) => {
        if (liveFetch) setCtx(loaded)
      },
      () => {
        if (liveFetch) setCtxFailed(true)
      }
    )
    return () => {
      liveFetch = false
    }
  }, [ctx, phase, ctxAttempt, withToken])

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

  // The draft is what lets a reload land back on the same walkthrough rather
  // than an untitled one pointed at the wrong space.
  useEffect(() => {
    if (!takes.length || !session.current) return
    void saveDraft({
      sessionId: session.current,
      title,
      createdAt: takes[0]?.createdAt ?? Date.now(),
      teamId: destination.teamId,
      projectId: destination.projectId,
      kind,
    }).catch(() => {})
  }, [takes, title, destination, kind])

  const finishTake = useCallback(async () => {
    const active = recorder.current
    if (!active) return
    setStopping(true)
    try {
      const take = await active.stop()
      recorder.current = null
      setTakes(await renumberTakes([...(await listTakes()).filter((t) => t.id !== take.id), take]))
      setPhase('review')
      setLive(null)
    } catch (error) {
      recorder.current = null
      setPhase(takes.length ? 'review' : 'idle')
      setRecordError(error instanceof Error ? error.message : "the take didn't finish")
    } finally {
      setStopping(false)
    }
  }, [takes.length])

  // The browser's own "Stop sharing" bar ends the take too — it is the control
  // most people will reach for, and it must not just orphan the recorder.
  const onEnd = useRef(finishTake)
  useEffect(() => {
    onEnd.current = finishTake
  })

  const startTake = useCallback(async () => {
    if (recorder.current) return
    setRecordError(null)
    if (!session.current) session.current = crypto.randomUUID()
    const index = takes.length + 1
    const next = new LiveRecorder(
      {
        onUpdate: setLive,
        onFrame: (thumb) => setThumbs((prev) => [...prev, thumb]),
        onEnd: () => void onEnd.current(),
      },
      session.current,
      index,
      kind === 'human'
    )
    try {
      await next.start()
      recorder.current = next
      setPreviewStream(next.previewStream)
      setPhase('recording')
    } catch (error) {
      // A dismissed picker is a change of mind, not something to report.
      if (!isPickerRefusal(error)) {
        setRecordError(
          error instanceof Error ? error.message : "this browser wouldn't start a screen share"
        )
      }
      await next.cancel().catch(() => {})
    }
  }, [takes.length, kind])

  const removeTake = useCallback(async (take: LiveTake) => {
    await deleteTake(take).catch(() => {})
    const left = await renumberTakes(await listTakes())
    setTakes(left)
    if (!left.length) {
      await clearAll().catch(() => {})
      session.current = ''
      setPhase('idle')
    }
  }, [])

  /** Everything the edit phase accumulated; both exits (discard, reset) drop it. */
  const clearEditArtifacts = useCallback(() => {
    setVideoUrls((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url))
      return new Map()
    })
    envelopes.current = new Map()
    takeBlobs.current = new Map()
    setEditState(null)
    setFinalBlob(null)
    setHumanProgress(null)
  }, [])

  const discard = useCallback(async () => {
    await clearAll().catch(() => {})
    session.current = ''
    setTakes([])
    setDiscarding(false)
    setRecovered(false)
    setTitle('')
    clearEditArtifacts()
    setPhase('idle')
  }, [clearEditArtifacts])

  /** Back to an empty page, ready for the next walkthrough. */
  const reset = useCallback(() => {
    setResult(null)
    setFailure(null)
    setProgress(null)
    setTakes([])
    setTitle('')
    setRecovered(false)
    session.current = ''
    clearEditArtifacts()
    setPhase('idle')
  }, [clearEditArtifacts])

  const send = useCallback(async () => {
    if (!takes.length) return
    const controller = new AbortController()
    abort.current = controller
    stalled.current = false
    heardAt.current = Date.now()
    setProgress(null)
    setFailure(null)
    setPhase('working')
    try {
      const sent = await withToken((token) =>
        sendLiveWalkthrough(session.current, takes, {
          token,
          teamId: destination.teamId,
          projectId: destination.projectId,
          kind,
          title: sendTitle,
          onProgress: (update) => {
            heardAt.current = Date.now()
            setProgress(update)
          },
          signal: controller.signal,
        })
      )
      // Finalize returned: the walkthrough is real, and only now do the local
      // copies go. This is one of exactly two places anything is deleted.
      await clearAll().catch(() => {})
      session.current = ''
      setResult(sent)
      setPhase('done')
    } catch (error) {
      // The watchdog aborts through the same controller Cancel does, and it has
      // already said its piece.
      if (stalled.current) return
      // Cancelling is not a failure — the takes are still sitting there.
      if (controller.signal.aborted || (error instanceof Error && error.message === 'cancelled')) {
        setPhase('review')
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
  }, [takes, destination, kind, sendTitle, withToken])

  // ── the human-handback edit ─────────────────────────────────────────────

  const trpc = useTRPC()
  const { copied: linkCopied, copy: copyLink } = useCopy()
  const share = useMutation(trpc.walkthroughs.share.mutationOptions())

  const orderedTakes = useMemo(() => [...takes].sort((a, b) => a.index - b.index), [takes])

  /** Silence cuts for every take at a threshold — the Tighten slider's work. */
  const retighten = useCallback((state: EditState, thresholdMs: number, ts: LiveTake[]) => {
    const tighten = { ...state.tighten, thresholdMs }
    const cuts = ts.flatMap((take) => {
      const env = envelopes.current.get(take.id)
      if (!env) return []
      const speech = take.meta.transcript.map((l) => ({ tMs: l.t, endMs: l.t + (l.d ?? 1500) }))
      return silenceCuts(take.id, env, speech, tighten)
    })
    return withSilenceCuts({ ...state, tighten }, cuts)
  }, [])

  const changeEdit = useCallback((next: EditState) => {
    setEditState(next)
    void saveEditState(next).catch(() => {})
  }, [])

  /**
   * Into the editor: per take, make the preview seekable (remux), get the
   * transcript (the edit surface), decode the loudness envelope (the silence
   * pass). All resumable — transcripts persist onto the takes, and a saved
   * edit for these exact takes is picked up where it was left.
   */
  const enterEdit = useCallback(async () => {
    setPhase('edit')
    setFailure(null)
    setEditPrep({ status: 'loading', detail: 'reading the takes…' })
    try {
      const ordered = [...(await listTakes())].sort((a, b) => a.index - b.index)
      const urls = new Map(videoUrls)
      for (const take of ordered) {
        const media = await blobs.get(`${take.id}:video`)
        if (!media) throw new Error(`take ${take.index}'s video is missing from this browser`)
        takeBlobs.current.set(take.id, media)
        if (!urls.has(take.id)) {
          setEditPrep({ status: 'loading', detail: `preparing take ${take.index} for seeking…` })
          urls.set(take.id, URL.createObjectURL(await seekableBlob(media)))
        }
        if (!take.meta.transcript.length) {
          setEditPrep({
            status: 'loading',
            detail: `transcribing take ${take.index} of ${ordered.length}…`,
          })
          // Best-effort: a dead transcription service leaves an editable video
          // with no words — the silence pass still works from the envelope.
          await withToken((token) => ensureTranscript(take, { token })).catch(() => {})
        }
        if (!envelopes.current.has(take.id)) {
          setEditPrep({
            status: 'loading',
            detail: `listening for silences in take ${take.index}…`,
          })
          envelopes.current.set(take.id, await computeEnvelope(media))
        }
      }
      setVideoUrls(urls)
      setTakes(ordered)

      const ids = ordered.map((t) => t.id)
      const saved = parseEditState(await loadEditState().catch(() => null), ids)
      // A fresh edit opens already tightened — "give me the tightest edit" is
      // the default, and every proposed cut is a chip that can be vetoed.
      const state = saved ?? retighten(initialEditState(ids), 800, ordered)
      setEditState(state)
      void saveEditState(state).catch(() => {})
      setEditPrep({ status: 'ready' })
    } catch (error) {
      setEditPrep({
        status: 'failed',
        detail: error instanceof Error ? error.message : "couldn't prepare the edit",
      })
    }
  }, [videoUrls, withToken, retighten])

  /** Render the EDL to final.mp4 in the tab, then the two-phase upload. */
  const renderAndSend = useCallback(async () => {
    if (!editState) return
    const durations = new Map(orderedTakes.map((t) => [t.id, t.meta.durationMs]))
    const segments = editSegments(editState, durations)
    const controller = new AbortController()
    abort.current = controller
    stalled.current = false
    heardAt.current = Date.now()
    setHumanProgress({ stage: 'render', pct: 0 })
    setFailure(null)
    setPhase('working')
    try {
      const rendered = await renderEdit(
        segments,
        takeBlobs.current,
        (p) => {
          heardAt.current = Date.now()
          setHumanProgress({ stage: 'render', pct: p.fraction })
        },
        controller.signal
      )
      setFinalBlob(rendered.blob)
      const sent = await withToken((token) =>
        sendHumanWalkthrough(
          session.current,
          orderedTakes,
          { state: editState, segments, video: rendered.blob, durationMs: rendered.durationMs },
          {
            token,
            teamId: destination.teamId,
            projectId: destination.projectId,
            title: sendTitle,
            onProgress: (update) => {
              heardAt.current = Date.now()
              setHumanProgress({
                stage: 'upload',
                pct: update.pct,
                detail: update.detail,
              })
            },
            signal: controller.signal,
          }
        )
      )
      await clearAll().catch(() => {})
      session.current = ''
      setResult(sent)
      setPhase('done')
    } catch (error) {
      if (stalled.current) return
      if (controller.signal.aborted || (error instanceof Error && error.message === 'cancelled')) {
        setPhase('edit')
        return
      }
      setFailure(
        error instanceof AuthError
          ? "this browser's link to your account expired — sign in again"
          : error instanceof Error
            ? error.message
            : "the video didn't finish rendering or uploading"
      )
      setPhase('failed')
    } finally {
      abort.current = null
    }
  }, [editState, orderedTakes, destination, sendTitle, withToken])

  // Leaving mid-recording loses the last second at worst — the take is on disk.
  // Leaving mid-send abandons an upload that would have to start over. Both are
  // worth a prompt; the browser writes its own wording.
  useEffect(() => {
    if (!recording && !working) return
    const guard = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [recording, working])

  // A stage quiet for two minutes is not coming back. Turn the spinner into a
  // button — the takes are still in the list.
  useEffect(() => {
    if (!working) return
    const timer = window.setInterval(() => {
      if (Date.now() - heardAt.current <= STALL_MS) return
      stalled.current = true
      abort.current?.abort()
      setFailure(STALL_MESSAGE)
      setPhase('failed')
    }, WATCHDOG_MS)
    return () => window.clearInterval(timer)
  }, [working])

  // The floating HUD belongs to the take. Once the take ends there is nothing
  // for it to show, and a window left hovering over everything with a dead
  // clock in it reads as a recorder that never stopped.
  const pipWin = pip.win
  const pipClose = pip.close
  useEffect(() => {
    if (!recording && pipWin) pipClose()
  }, [recording, pipWin, pipClose])

  // The filmstrip belongs to the take. Once recording ends there is nothing to
  // show and the object URLs behind it are pure leak — free them and clear the
  // rail. The preview stream's tracks are stopped by the recorder's teardown;
  // dropping the reference just lets the <video> detach.
  useEffect(() => {
    thumbsRef.current = thumbs
  }, [thumbs])
  useEffect(() => {
    if (recording) return
    setThumbs((prev) => {
      prev.forEach((thumb) => URL.revokeObjectURL(thumb.url))
      return prev.length ? [] : prev
    })
    setPreviewStream(null)
  }, [recording])

  // A recorder still running when this page goes away would hold the screen
  // share open with nothing able to stop it; its filmstrip URLs would leak —
  // and so would the edit preview's.
  const videoUrlsRef = useRef(videoUrls)
  useEffect(() => {
    videoUrlsRef.current = videoUrls
  }, [videoUrls])
  useEffect(() => {
    return () => {
      void recorder.current?.stop().catch(() => {})
      thumbsRef.current.forEach((thumb) => URL.revokeObjectURL(thumb.url))
      videoUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const destinationName = spaces.find((s) => s.teamId === destination.teamId)?.name ?? 'Personal'
  const totalMs = takes.reduce((sum, take) => sum + take.meta.durationMs, 0)
  const totalFrames = takes.reduce((sum, take) => sum + take.meta.frames.length, 0)

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-4">
        <p className="text-cobalt font-mono text-xs tracking-widest uppercase">Record</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Record it right here.
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          Share a tab, a window or your whole screen, talk through what's wrong, and this page
          distils it into the same walkthrough the recorder extension produces — keyframes,
          transcript, report — with nothing installed.
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          The{' '}
          <Link to="/recorder" className="text-primary underline underline-offset-4">
            extension
          </Link>{' '}
          still does more: it draws on the page, captures console errors, and keyframes the moment
          you click. This page can't reach inside the page it's recording — everything else is the
          same.
        </p>
      </header>

      {capable === false && (
        <section className="border-border border-l-destructive bg-card space-y-3 rounded-md border border-l-2 p-5">
          <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
            Not here
          </p>
          <p className="text-sm leading-relaxed">
            This browser can't capture the screen — no mobile browser can, and that isn't going to
            change. On a phone, record with the OS recorder and hand the clip over.
          </p>
          <p className="text-sm">
            <Link to="/phone" className="text-primary underline underline-offset-4">
              Handback on the phone
            </Link>
            <span className="text-muted-foreground"> · </span>
            <Link to="/upload" className="text-primary underline underline-offset-4">
              upload a clip you already have
            </Link>
          </p>
        </section>
      )}

      {capable && (phase === 'idle' || phase === 'review') && (
        <section className="space-y-6">
          {phase === 'idle' ? (
            <div className="border-border bg-muted/20 flex flex-col items-center gap-4 rounded-md border px-6 py-12 text-center">
              <p className="font-display text-xl font-semibold">Ready when you are</p>

              {/* Who it's for decides everything downstream — capture rate,
                  distill, where it shows up — so it's the first choice, not a
                  setting. Locked once a take exists. */}
              <div
                role="radiogroup"
                aria-label="Who is this recording for?"
                className="grid w-full max-w-xs grid-cols-2 gap-2">
                {(
                  [
                    { value: 'agent', label: 'for an agent' },
                    { value: 'human', label: 'for a person' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={kind === option.value}
                    onClick={() => setKind(option.value)}
                    className={cn(
                      'rounded-md border px-3 py-2 font-mono text-xs transition-colors',
                      kind === option.value
                        ? 'border-primary bg-accent text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}>
                    {option.label}
                  </button>
                ))}
              </div>

              <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
                {kind === 'human'
                  ? 'Full-rate, full-quality video for a person to watch — you tighten it up here, then send a link or the file. Nothing is distilled.'
                  : "Pick a tab, a window, or your whole screen, and talk through what's wrong. Stop when you're done — the keyframes, transcript and report are built right here."}
              </p>
              <Button
                type="button"
                className="h-[46px] w-full max-w-xs"
                onClick={() => void startTake()}>
                {kind === 'human' ? 'Record a video' : 'Record a walkthrough'}
              </Button>
              <p className="text-muted-foreground font-mono text-xs">
                a computer with Chrome or Edge · your mic turns on when the share starts
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
                    {takes.length} {takes.length === 1 ? 'take' : 'takes'}
                    {kind === 'human' && ' · video for a person'}
                  </p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {kind === 'human'
                      ? mmss(totalMs)
                      : `${mmss(totalMs)} · ${totalFrames} keyframes`}
                  </p>
                </div>
                <TakeList takes={takes} onDelete={(take) => void removeTake(take)} busy={false} />
                {recovered && (
                  <p className="text-muted-foreground text-sm">
                    one of these was still recording when the tab closed — it was rebuilt from what
                    reached disk, so it may stop a moment early.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void startTake()}
                  className="text-primary text-sm underline underline-offset-4">
                  ● add another recording
                </button>
              </div>

              <DestinationControl
                ctx={ctx}
                ctxFailed={ctxFailed}
                spaces={spaces}
                value={destination}
                onChange={pickDestination}
                onRetryContext={() => setCtxAttempt((n) => n + 1)}
              />

              <div className="space-y-2">
                <Label htmlFor="record-title">Title</Label>
                <Input
                  id="record-title"
                  value={title}
                  placeholder={placeholder}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>

              {kind === 'human' ? (
                <Button type="button" className="h-[46px] w-full" onClick={() => void enterEdit()}>
                  Tighten it up
                </Button>
              ) : (
                <Button type="button" className="h-[46px] w-full" onClick={() => void send()}>
                  Send to Handback
                </Button>
              )}

              {discarding ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">
                    discard {takes.length} {takes.length === 1 ? 'take' : 'takes'}?{' '}
                  </span>
                  <button
                    type="button"
                    onClick={() => void discard()}
                    className="text-destructive underline underline-offset-4">
                    yes, discard
                  </button>
                  <span className="text-muted-foreground"> · </span>
                  <button
                    type="button"
                    onClick={() => setDiscarding(false)}
                    className="text-muted-foreground underline underline-offset-4">
                    keep
                  </button>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setDiscarding(true)}
                  className="text-muted-foreground hover:text-destructive text-sm underline underline-offset-4">
                  discard
                </button>
              )}
            </>
          )}

          {recordError && <p className="text-destructive text-sm">{recordError}</p>}
        </section>
      )}

      {recording && (
        <section className="space-y-4">
          <RecordingPanel
            live={live}
            stream={previewStream}
            thumbs={thumbs}
            stopping={stopping}
            onStop={() => void finishTake()}
            floating={pip.win !== null}
            pipSupported={pip.supported}
            onPopOut={() => void pip.open()}
            pristine={kind === 'human'}
          />

          {/* The compact controls, floating over everything else. Only mounted
              when a window is actually open — otherwise the panel above owns the
              stop button, so there is exactly one. */}
          {pip.win && (
            <PipHost win={pip.win}>
              <RecordingHud
                live={live}
                stopping={stopping}
                onStop={() => void finishTake()}
                onReturn={pip.close}
              />
            </PipHost>
          )}

          {!pip.supported && (
            <p className="text-muted-foreground font-mono text-xs">
              keep this tab open — the recording happens here, not on the server
            </p>
          )}
        </section>
      )}

      {phase === 'edit' && (
        <section className="space-y-6">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
              The tight edit
            </p>
            <button
              type="button"
              onClick={() => setPhase('review')}
              className="text-muted-foreground text-sm underline underline-offset-4">
              ← back to the takes
            </button>
          </div>

          {editPrep.status === 'loading' && (
            <p className="text-muted-foreground font-mono text-sm">{editPrep.detail}</p>
          )}

          {editPrep.status === 'failed' && (
            <div className="border-border border-l-destructive bg-card space-y-3 rounded-md border border-l-2 p-5">
              <p className="text-sm leading-relaxed">{editPrep.detail}</p>
              <button
                type="button"
                onClick={() => void enterEdit()}
                className="text-primary text-sm underline underline-offset-4">
                try again
              </button>
            </div>
          )}

          {editPrep.status === 'ready' && editState && (
            <>
              <Editor
                takes={orderedTakes}
                state={editState}
                onChange={changeEdit}
                onThreshold={(ms) => changeEdit(retighten(editState, ms, orderedTakes))}
                videoUrls={videoUrls}
              />
              <Button
                type="button"
                className="h-[46px] w-full"
                onClick={() => void renderAndSend()}>
                Render &amp; send
              </Button>
              <p className="text-muted-foreground font-mono text-xs">
                renders the tight cut as an MP4 right here, then uploads it — the raw takes never
                leave this machine
              </p>
            </>
          )}
        </section>
      )}

      {working && kind === 'human' && (
        <section className="space-y-6">
          <div className="space-y-1">
            <p className="text-muted-foreground truncate font-mono text-sm">
              to {destinationName} · {sendTitle}
            </p>
          </div>
          <ul className="divide-border divide-y">
            {(['render', 'upload'] as const).map((stage) => {
              const active = humanProgress?.stage === stage
              const done = stage === 'render' && humanProgress?.stage === 'upload'
              return (
                <li
                  key={stage}
                  className={cn(
                    'flex items-center gap-3 py-2.5 font-mono text-sm',
                    active ? 'text-foreground' : 'text-muted-foreground'
                  )}>
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      done ? 'bg-approve' : active ? 'bg-cobalt' : 'border-border border'
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {stage === 'render' ? 'rendering the tight cut' : 'uploading'}
                  </span>
                  {active && humanProgress && (
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {humanProgress.detail ?? ''}
                      {humanProgress.detail && humanProgress.pct >= 0 && ' · '}
                      {humanProgress.pct >= 0 && `${Math.round(humanProgress.pct * 100)}%`}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="text-muted-foreground font-mono text-xs">
            keep this tab open — the work happens here, not on the server
          </p>
          {humanProgress?.stage === 'render' && (
            <Button type="button" variant="outline" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          )}
        </section>
      )}

      {working && kind !== 'human' && (
        <section className="space-y-6">
          <div className="space-y-1">
            <p className="text-muted-foreground font-mono text-sm">
              {takes.length} {takes.length === 1 ? 'take' : 'takes'} · {mmss(totalMs)}
            </p>
            <p className="text-muted-foreground truncate font-mono text-sm">
              to {destinationName} · {sendTitle}
            </p>
          </div>
          <StageList progress={progress} rows={RECORD_ROWS} />
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
                ? `${result.lineCount} lines · ${mmss(result.durationMs)}`
                : `${result.frameCount} keyframes · ${result.lineCount} lines · ${mmss(result.durationMs)}`}
            </p>
          </div>

          {!result.transcribed && (
            <p className="text-muted-foreground text-sm">
              shipped without a transcript — either nothing was said, or the server's transcription
              is off right now
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {/* A human handback exists to be handed to a person: the share
                link is the primary act, minted on the click that asks for it. */}
            {kind === 'human' && (
              <Button
                type="button"
                disabled={share.isPending}
                onClick={() => {
                  share.mutate(
                    { walkthroughId: result.walkthroughId },
                    {
                      onSuccess: (data) =>
                        copyLink(`${window.location.origin}/w/${data.shareToken}`),
                    }
                  )
                }}>
                {linkCopied
                  ? 'Link copied'
                  : share.isPending
                    ? 'Creating link…'
                    : 'Copy share link'}
              </Button>
            )}
            <Link
              to={result.url}
              className={cn(buttonVariants({ variant: kind === 'human' ? 'outline' : 'default' }))}>
              Open the walkthrough
            </Link>
            {kind === 'human' && finalBlob && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  // The render is still in memory — hand it over without a
                  // server round trip.
                  const url = URL.createObjectURL(finalBlob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${sendTitle.replace(/[^\w\- ]+/g, '').trim() || 'walkthrough'}.mp4`
                  a.click()
                  setTimeout(() => URL.revokeObjectURL(url), 10_000)
                }}>
                Download MP4
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={reset}>
              record another
            </Button>
          </div>
          {kind === 'human' && share.error && (
            <p className="text-destructive text-sm">{share.error.message}</p>
          )}
        </section>
      )}

      {phase === 'failed' && (
        <section className="border-border border-l-destructive bg-card space-y-3 rounded-md border border-l-2 p-5">
          <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
            Didn't make it
          </p>
          <p className="text-sm leading-relaxed">{failure}</p>
          <p className="text-muted-foreground text-sm">
            The takes are still on this machine — nothing was lost.
          </p>
          <p className="text-sm">
            <button
              type="button"
              onClick={() => void (kind === 'human' && editState ? renderAndSend() : send())}
              className="text-primary underline underline-offset-4">
              try again
            </button>
            <span className="text-muted-foreground"> · </span>
            <button
              type="button"
              onClick={() => setPhase(kind === 'human' && editState ? 'edit' : 'review')}
              className="text-muted-foreground underline underline-offset-4">
              {kind === 'human' && editState ? 'back to the edit' : 'back to the takes'}
            </button>
          </p>
        </section>
      )}
    </div>
  )
}
