// Tightening a human handback whose raw takes are in the cloud.
//
// /record edits before it uploads — the takes never leave the machine. The
// extension can't: its IndexedDB lives on the chrome-extension:// origin, no
// page can read it, and external messaging is JSON, so blobs can't cross. So an
// extension human handback ships its raw takes through the normal ingest path
// and the edit happens *here*, in the viewer, against files it pulls back down.
//
// Everything below the download is the /record editor, unchanged: the same
// `Editor` component, the same `edl` / `silence` / `remux` / `render` engine,
// the same auto-tighten on entry. The only real difference is the take id —
// `take.dir` (`rec-01`) rather than a session-local uuid, because edit.json has
// to still make sense in a different browser next week.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Editor } from '~/components/edit/editor'
import { Button } from '~/components/ui/button'
import { SectionHead } from '~/components/viewer/section-head'
import { mmss } from '~/lib/capture/format'
import type { LiveTake } from '~/lib/capture/live-store'
import type { TranscriptSegment } from '~/lib/capture/types'
import {
  editSegments,
  initialEditState,
  parseEditState,
  withSilenceCuts,
  type EditState,
} from '~/lib/edit/edl'
import { useEditHistory } from '~/lib/edit/history'
import { renderEdit } from '~/lib/edit/render'
import { seekableBlob } from '~/lib/edit/remux'
import { computeEnvelope, silenceCuts, type Envelope } from '~/lib/edit/silence'
import { editedTranscriptLines } from '~/lib/edit/transcript'
import { fetchBlob, putBlob } from '~/lib/edit/transfer'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

/** One raw take of the walkthrough, as `walkthroughs.get` describes it. */
export interface CloudTake {
  index: number
  /** `rec-01` — the take's folder, and the id the whole edit is keyed by. */
  dir: string
  durationMs: number
  startedAt: string | null
  /** Walkthrough-relative path of the take's video, when one was uploaded. */
  videoPath: string | null
}

export interface CloudEditorProps {
  walkthroughId: string
  /** ISO — the wall-clock fallback for a take that never reported a start. */
  recordedAt: string
  takes: CloudTake[]
  /** Every file's presigned GET, straight off `walkthroughs.get`. */
  urlByPath: Map<string, string>
  /** Leave the editor. The caller re-renders the viewer around it. */
  onClose(): void
}

type Prep =
  | { status: 'loading'; detail: string; pct: number | null }
  | { status: 'ready' }
  | { status: 'failed'; detail: string }

/** Where attaching the render has got to; null while the person is still editing. */
type Attach = { stage: 'render' | 'upload' | 'finalize'; pct: number; detail?: string }

/** The default the tight edit opens at, same as /record's. */
const AUTO_TIGHTEN_MS = 800

const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1)

/**
 * `rec-NN/recording.json` is a file on S3, so it is untrusted input like
 * anything else that comes back off disk — narrowed by hand for the same reason
 * `parseEditState` is, and answering "no words" rather than throwing when the
 * shape is wrong. `recording.transcript` carries `{tMs, endMs, text}`; the
 * editor speaks `{t, d, text}`.
 */
function parseTakeTranscript(value: unknown): TranscriptSegment[] {
  if (typeof value !== 'object' || value === null) return []
  const recording = (value as { recording?: unknown }).recording
  if (typeof recording !== 'object' || recording === null) return []
  const raw = (recording as { transcript?: unknown }).transcript
  if (!Array.isArray(raw)) return []
  const out: TranscriptSegment[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const { tMs, endMs, text } = entry as { tMs?: unknown; endMs?: unknown; text?: unknown }
    if (typeof tMs !== 'number' || !Number.isFinite(tMs) || typeof text !== 'string') continue
    const line: TranscriptSegment = { t: Math.max(0, tMs), text }
    if (typeof endMs === 'number' && Number.isFinite(endMs) && endMs > tMs) line.d = endMs - tMs
    out.push(line)
  }
  return out
}

export function CloudEditor({
  walkthroughId,
  recordedAt,
  takes,
  urlByPath,
  onClose,
}: CloudEditorProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const presignEdit = useMutation(trpc.walkthroughs.presignEdit.mutationOptions())
  const finalizeEdit = useMutation(trpc.walkthroughs.finalizeEdit.mutationOptions())

  const [prep, setPrep] = useState<Prep>({ status: 'loading', detail: '', pct: null })
  const [liveTakes, setLiveTakes] = useState<LiveTake[]>([])
  const { state: editState, commit, setBase, undo, redo, canUndo, canRedo } = useEditHistory()
  const [videoUrls, setVideoUrls] = useState<Map<string, string>>(new Map())
  const [attach, setAttach] = useState<Attach | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  /** Raw webms by take id — the render's source, never rendered into the DOM. */
  const media = useRef<Map<string, Blob>>(new Map())
  const envelopes = useRef<Map<string, Envelope | null>>(new Map())
  const abort = useRef<AbortController | null>(null)
  /** Mirrors the preview URLs so unmount can revoke them long after last render. */
  const videoUrlsRef = useRef(videoUrls)
  videoUrlsRef.current = videoUrls

  /**
   * The props the preparation walks, behind a ref: it runs once per attempt,
   * and a parent re-render handing it a fresh Map must not restart a download.
   */
  const source = useRef({ takes, urlByPath, recordedAt })
  source.current = { takes, urlByPath, recordedAt }

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

  // Pull the takes down and build the same editor surface /record builds
  // locally: a seekable preview URL, the transcript, and a loudness envelope
  // per take, then either the saved edit or a freshly tightened one.
  useEffect(() => {
    const controller = new AbortController()
    let live = true
    /** Object URLs this run made. Once state owns them, unmount does the revoking. */
    const urls = new Map<string, string>()
    let handedOff = false
    void (async () => {
      const { takes: cloudTakes, urlByPath: urlFor, recordedAt: fallbackAt } = source.current
      try {
        if (!cloudTakes.length) throw new Error('this walkthrough has no takes to edit')
        const built: LiveTake[] = []
        for (const [i, take] of cloudTakes.entries()) {
          const label = `take ${i + 1} of ${cloudTakes.length}`
          const videoPath = take.videoPath ?? `${take.dir}/walkthrough.webm`
          const videoUrl = urlFor.get(videoPath)
          if (!videoUrl) throw new Error(`${label} has no video in this walkthrough`)

          setPrep({ status: 'loading', detail: `downloading ${label}…`, pct: 0 })
          const webm = await fetchBlob(
            videoPath,
            videoUrl,
            (p) => {
              if (!live) return
              setPrep({
                status: 'loading',
                detail: `downloading ${label} — ${megabytes(p.loaded)}${
                  p.total ? ` of ${megabytes(p.total)}` : ''
                } MB`,
                pct: p.total ? p.loaded / p.total : null,
              })
            },
            controller.signal
          )
          if (!live) return
          media.current.set(take.dir, webm)

          setPrep({ status: 'loading', detail: `preparing ${label} for seeking…`, pct: null })
          urls.set(take.dir, URL.createObjectURL(await seekableBlob(webm)))
          if (!live) return

          // The words are the edit surface. A take whose recording.json is
          // missing or unreadable is still editable — the silence pass works
          // off the envelope alone.
          let transcript: TranscriptSegment[] = []
          const metaUrl = urlFor.get(`${take.dir}/recording.json`)
          if (metaUrl) {
            const meta = await fetchBlob(
              `${take.dir}/recording.json`,
              metaUrl,
              undefined,
              controller.signal
            ).catch(() => null)
            if (meta) {
              transcript = parseTakeTranscript(
                await meta
                  .text()
                  .then((body): unknown => JSON.parse(body))
                  .catch(() => null)
              )
            }
          }
          if (!live) return

          setPrep({ status: 'loading', detail: `listening for silences in ${label}…`, pct: null })
          envelopes.current.set(take.dir, await computeEnvelope(webm))
          if (!live) return

          const startedAt = Date.parse(take.startedAt ?? fallbackAt)
          built.push({
            // `dir` is the id on purpose: it is the one handle that survives a
            // different browser, a different day, and a re-edit — which is
            // exactly what edit.json's takeOrder and cuts are keyed by.
            id: take.dir,
            sessionId: walkthroughId,
            index: take.index,
            createdAt: Number.isNaN(startedAt) ? 0 : startedAt,
            state: 'done',
            mime: webm.type || 'video/webm',
            chunks: 0,
            meta: {
              startedAt: Number.isNaN(startedAt) ? 0 : startedAt,
              durationMs: take.durationMs,
              sampled: 0,
              frames: [],
              transcript,
              events: [],
              videoFile: videoPath.split('/').pop() ?? 'walkthrough.webm',
            },
          })
        }

        // A previous edit of this walkthrough, if one shipped. It is keyed by
        // dir, so it still describes today's takes — `parseEditState` is what
        // says so, and refuses the moment it doesn't.
        const ids = built.map((t) => t.id)
        let saved: EditState | null = null
        const editUrl = urlFor.get('edit.json')
        if (editUrl) {
          const blob = await fetchBlob('edit.json', editUrl, undefined, controller.signal).catch(
            () => null
          )
          if (blob) {
            saved = parseEditState(
              await blob
                .text()
                .then((body): unknown => JSON.parse(body))
                .catch(() => null),
              ids
            )
          }
        }
        if (!live) return

        setLiveTakes(built)
        setVideoUrls(new Map(urls))
        handedOff = true
        setBase(saved ?? retighten(initialEditState(ids), AUTO_TIGHTEN_MS, built))
        setPrep({ status: 'ready' })
      } catch (error) {
        if (!live) return
        setPrep({
          status: 'failed',
          detail: error instanceof Error ? error.message : "couldn't prepare the edit",
        })
      }
    })()
    return () => {
      live = false
      controller.abort()
      // A run torn down before it handed over owns URLs nobody will ever see.
      if (!handedOff) urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [attempt, walkthroughId, retighten, setBase])

  // The preview URLs and the raw webms are the biggest things this page holds;
  // leaving the editor must not leave them behind.
  useEffect(() => {
    return () => {
      abort.current?.abort()
      videoUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      media.current = new Map()
      envelopes.current = new Map()
    }
  }, [])

  const orderedTakes = useMemo(() => [...liveTakes].sort((a, b) => a.index - b.index), [liveTakes])

  /**
   * Render the EDL to an MP4 in this tab, then attach it: presign, PUT each
   * artifact, finalize. Only the finalize makes it real — a failure part way
   * through leaves pending rows the next attempt overwrites, and the viewer
   * still shows whatever was there before.
   */
  const renderAndAttach = useCallback(async () => {
    if (!editState) return
    const controller = new AbortController()
    abort.current = controller
    setFailure(null)
    setAttach({ stage: 'render', pct: 0 })
    try {
      const durations = new Map(orderedTakes.map((t) => [t.id, t.meta.durationMs]))
      const segments = editSegments(editState, durations)
      const rendered = await renderEdit(
        segments,
        media.current,
        (p) => setAttach({ stage: 'render', pct: p.fraction }),
        controller.signal
      )

      const lines = editedTranscriptLines(
        orderedTakes.map((t) => ({
          id: t.id,
          startedAt: t.meta.startedAt,
          transcript: t.meta.transcript,
        })),
        editState,
        segments,
        rendered.durationMs
      )
      const json = (body: unknown) =>
        new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' })
      const payload = [
        { path: 'final.mp4', blob: rendered.blob, contentType: 'video/mp4' },
        { path: 'transcript.json', blob: json({ lines }), contentType: 'application/json' },
        {
          path: 'edit.json',
          blob: json({ ...editState, segments, renderedDurationMs: rendered.durationMs }),
          contentType: 'application/json',
        },
      ] as const

      setAttach({ stage: 'upload', pct: 0 })
      const { uploads } = await presignEdit.mutateAsync({
        walkthroughId,
        files: payload.map((f) => ({
          path: f.path,
          size: f.blob.size,
          contentType: f.contentType,
        })),
      })

      const byPath = new Map<string, Blob>(payload.map((f) => [f.path, f.blob] as const))
      const bytesTotal = payload.reduce((sum, f) => sum + f.blob.size, 0)
      let settled = 0
      for (const job of uploads) {
        const blob = byPath.get(job.path)
        if (!blob) throw new Error(`the server asked for a file we don't have: ${job.path}`)
        await putBlob(
          job.path,
          job.url,
          job.contentType,
          blob,
          (p) =>
            setAttach({
              stage: 'upload',
              pct: bytesTotal ? (settled + p.loaded) / bytesTotal : 0,
              detail: `${megabytes(settled + p.loaded)} of ${megabytes(bytesTotal)} MB`,
            }),
          controller.signal
        )
        settled += blob.size
      }

      setAttach({ stage: 'finalize', pct: 1 })
      await finalizeEdit.mutateAsync({
        walkthroughId,
        paths: payload.map((f) => f.path),
        durationMs: Math.round(rendered.durationMs),
      })
      await queryClient.invalidateQueries({
        queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId }),
      })
      // The page flips to the render on its own once the query comes back.
      onClose()
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.message === 'cancelled')) {
        setAttach(null)
        return
      }
      setFailure(
        error instanceof Error ? error.message : "the video didn't finish rendering or uploading"
      )
      setAttach(null)
    } finally {
      abort.current = null
    }
  }, [
    editState,
    orderedTakes,
    walkthroughId,
    presignEdit,
    finalizeEdit,
    queryClient,
    trpc,
    onClose,
  ])

  const working = attach !== null
  const totalMs = orderedTakes.reduce((sum, t) => sum + t.meta.durationMs, 0)

  return (
    <section className="space-y-6">
      <SectionHead>The tight edit</SectionHead>

      {prep.status === 'loading' && (
        <div className="space-y-2">
          <p className="text-muted-foreground font-mono text-sm">{prep.detail}</p>
          {prep.pct !== null && (
            <div className="bg-muted h-1 w-full overflow-hidden rounded-full">
              <div
                className="bg-cobalt h-full transition-[width]"
                style={{ width: `${Math.round(Math.min(1, Math.max(0, prep.pct)) * 100)}%` }}
              />
            </div>
          )}
          <p className="text-muted-foreground text-sm">
            The raw takes come down to this browser once — the cut, the render and the MP4 all
            happen here.
          </p>
        </div>
      )}

      {prep.status === 'failed' && (
        <div className="border-border border-l-destructive bg-card space-y-3 rounded-md border border-l-2 p-5">
          <p className="text-sm leading-relaxed">{prep.detail}</p>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="text-primary text-sm underline underline-offset-4">
              try again
            </button>
            {/* The failed state renders no Editor footer, so it needs its own exit. */}
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4">
              back to the takes
            </button>
          </div>
        </div>
      )}

      {prep.status === 'ready' && editState && !working && (
        <>
          <p className="text-muted-foreground font-mono text-xs">
            {orderedTakes.length} {orderedTakes.length === 1 ? 'take' : 'takes'} · {mmss(totalMs)}{' '}
            recorded
          </p>
          <Editor
            takes={orderedTakes}
            state={editState}
            onChange={commit}
            onThreshold={(ms) => commit(retighten(editState, ms, orderedTakes), 'threshold')}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            videoUrls={videoUrls}
            envelopes={envelopes.current}
          />
          {failure && <p className="text-destructive text-sm">{failure}</p>}
          <div className="flex flex-wrap items-center gap-4">
            <Button type="button" onClick={() => void renderAndAttach()}>
              Render &amp; share
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4">
              discard edit
            </button>
          </div>
          <p className="text-muted-foreground font-mono text-xs">
            renders the tight cut as an MP4 in this tab, then attaches it to this walkthrough — the
            raw takes stay where they are, so you can re-cut it later
          </p>
        </>
      )}

      {working && attach && (
        <>
          <ul className="divide-border divide-y">
            {(['render', 'upload', 'finalize'] as const).map((stage, i) => {
              const order = ['render', 'upload', 'finalize'].indexOf(attach.stage)
              const active = attach.stage === stage
              const done = i < order
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
                    {stage === 'render'
                      ? 'rendering the tight cut'
                      : stage === 'upload'
                        ? 'uploading'
                        : 'attaching it'}
                  </span>
                  {active && (
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {attach.detail ?? ''}
                      {attach.detail && ' · '}
                      {`${Math.round(attach.pct * 100)}%`}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="text-muted-foreground font-mono text-xs">
            keep this tab open — the work happens here, not on the server
          </p>
          {attach.stage === 'render' && (
            <Button type="button" variant="outline" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          )}
        </>
      )}
    </section>
  )
}
