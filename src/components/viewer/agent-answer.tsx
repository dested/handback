// The return path made visible: the review thread an agent posts into
// (post_result over MCP) and the sign-off on it. Approve resolves the
// walkthrough; Send back writes a reviewer note into the thread — the agent
// reads it in its brief when it re-pulls — and reopens it. Below the thread,
// one quiet line of agent activity ("pulled by <token> 12m ago").
//
// The thread also carries the question path: an agent that hits ambiguity posts
// a kind:'question' note and the walkthrough goes needs_info. A member answers
// inline, by voice (transcribed on the same cloud path the phone uses), or
// routes the question to whoever uploaded it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '~/components/ui/button'
import { useCaptureToken } from '~/lib/capture-token'
import { decodeMono } from '~/lib/capture/audio'
import { transcribeInCloud } from '~/lib/capture/transcribe'
import { useTRPC } from '~/lib/trpc'
import { mmss } from './format'
import { SectionHead } from './section-head'
import type { Walkthrough } from './types'

type Note = Walkthrough['notes'][number]

/** Coarse relative time — the thread cares about "just now" vs "yesterday". */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function activityLine(a: Walkthrough['activity'][number]): string {
  const verb =
    a.action === 'pulled'
      ? 'pulled by'
      : a.action === 'result'
        ? 'result posted by'
        : `marked ${a.detail ?? 'a status'} by`
  return `${verb} ${a.tokenName} · ${ago(a.createdAt)}`
}

/**
 * The proof-screenshots an agent attached to a result or a question. Paths are
 * take-relative and resolve through the walkthrough's own presigned file list;
 * a path with no matching file is dropped rather than rendered broken.
 */
function Evidence({ paths, urlByPath }: { paths: string[]; urlByPath: Map<string, string> }) {
  const shots = paths
    .map((path) => ({ path, url: urlByPath.get(path) }))
    .filter((shot): shot is { path: string; url: string } => shot.url !== undefined)
  if (shots.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
        evidence
      </p>
      <div className="flex flex-wrap gap-2">
        {shots.map((shot) => (
          <a key={shot.path} href={shot.url} target="_blank" rel="noreferrer">
            <img
              src={shot.url}
              alt=""
              className="border-border h-20 rounded-md border object-cover"
            />
          </a>
        ))}
      </div>
    </div>
  )
}

function AgentNote({ note, urlByPath }: { note: Note; urlByPath: Map<string, string> }) {
  return (
    <div className="border-border bg-card space-y-2 rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-muted-foreground font-mono text-xs">
          {note.authorName} · {ago(note.createdAt)}
        </span>
        {note.prUrl && (
          <a
            href={note.prUrl}
            target="_blank"
            rel="noreferrer"
            className="text-cobalt font-mono text-xs hover:underline">
            view the PR ↗
          </a>
        )}
      </div>
      <p className="text-sm leading-relaxed">{note.summary}</p>
      {note.filesTouched.length > 0 && (
        <p className="text-muted-foreground font-mono text-xs break-all">
          {note.filesTouched.join(' · ')}
        </p>
      )}
      {note.bodyMd && (
        <pre className="bg-muted/30 max-h-72 overflow-y-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
          {note.bodyMd}
        </pre>
      )}
      {note.evidencePaths.length > 0 && <Evidence paths={note.evidencePaths} urlByPath={urlByPath} />}
    </div>
  )
}

/** An agent's question — the AgentNote shell with a grey left rule to set it apart. */
function QuestionNote({ note, urlByPath }: { note: Note; urlByPath: Map<string, string> }) {
  return (
    <div className="border-border border-l-muted-foreground bg-card space-y-2 rounded-md border border-l-2 p-4">
      <span className="text-muted-foreground font-mono text-xs">
        agent asked — {note.authorName} · {ago(note.createdAt)}
      </span>
      <p className="text-sm leading-relaxed">{note.summary}</p>
      {note.evidencePaths.length > 0 && <Evidence paths={note.evidencePaths} urlByPath={urlByPath} />}
    </div>
  )
}

function ReviewerNote({ note }: { note: Note }) {
  return (
    <div className="border-border space-y-1 border-l-2 pl-3">
      <span className="text-muted-foreground font-mono text-xs">
        sent back — {note.authorName} · {ago(note.createdAt)}
      </span>
      <p className="text-sm leading-relaxed">{note.summary}</p>
    </div>
  )
}

/** A member's answer to a question — the reviewer-note voice, with its own head. */
function AnswerNote({ note }: { note: Note }) {
  return (
    <div className="border-border space-y-1 border-l-2 pl-3">
      <span className="text-muted-foreground font-mono text-xs">
        answered — {note.authorName} · {ago(note.createdAt)}
      </span>
      <p className="text-sm leading-relaxed">{note.summary}</p>
    </div>
  )
}

/**
 * A one-shot voice capture that ends in transcribed text — never audio the app
 * keeps. It records mic → webm, decodes it through the same 16 kHz-mono path the
 * phone pipeline uses, and posts to the cloud transcriber with this browser's
 * hb_ token; the blob is discarded either way. The caller receives the joined
 * text to drop into the answer box for review — it is never auto-submitted.
 */
const MAX_SECONDS = 120

function useVoiceAnswer(onResult: (text: string) => void) {
  const withToken = useCaptureToken('Answer')
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Held in refs so the async onstop closure and the transcribe step always see
  // the current callback/token helper, not the ones captured when recording began.
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  const withTokenRef = useRef(withToken)
  withTokenRef.current = withToken

  const stopClock = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const finish = useCallback(async (blob: Blob) => {
    setTranscribing(true)
    try {
      const audio = await decodeMono(blob)
      if (!audio) {
        setError('transcription unavailable — type it instead')
        return
      }
      const heard = await withTokenRef.current((token) => transcribeInCloud(audio, { token }))
      const text = (heard ?? [])
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join(' ')
      if (!text) {
        setError('transcription unavailable — type it instead')
        return
      }
      onResultRef.current(text)
    } catch {
      // A dead token survives one silent re-mint inside withToken; a second
      // failure, or any other throw, lands here as the same terse line.
      setError('transcription unavailable — type it instead')
    } finally {
      setTranscribing(false)
    }
  }, [])

  const stop = useCallback(() => {
    stopClock()
    setRecording(false)
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }, [stopClock])

  const start = useCallback(async () => {
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('microphone unavailable')
      return
    }
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    } catch {
      // Safari won't take an explicit webm mime — let it pick its own container;
      // decodeAudioData reads whatever comes back.
      rec = new MediaRecorder(stream)
    }
    chunksRef.current = []
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    rec.onstop = () => {
      for (const track of stream.getTracks()) track.stop()
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
      chunksRef.current = []
      void finish(blob)
    }
    recorderRef.current = rec
    rec.start()
    setSeconds(0)
    setRecording(true)
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
  }, [finish])

  // Auto-stop at the cap — kept out of the tick so the clock updater stays pure.
  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) stop()
  }, [recording, seconds, stop])

  // Tear the mic down if the panel unmounts mid-record.
  useEffect(
    () => () => {
      stopClock()
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') rec.stop()
    },
    [stopClock]
  )

  const toggle = useCallback(() => {
    setError(null)
    if (recording) stop()
    else void start()
  }, [recording, start, stop])

  return { recording, transcribing, error, clock: mmss(seconds * 1000), toggle }
}

/**
 * The needs_info answer box: always visible while the walkthrough waits, never
 * armed. Type an answer, dictate one, or hand the question to whoever uploaded
 * the walkthrough. Each path invalidates the queries the viewer reads.
 */
function AnswerForm({ walkthrough, invalidate }: { walkthrough: Walkthrough; invalidate: () => void }) {
  const trpc = useTRPC()
  const [text, setText] = useState('')
  const answer = useMutation(
    trpc.walkthroughs.answerQuestion.mutationOptions({
      onSuccess: () => setText(''),
      onSettled: invalidate,
    })
  )
  const route = useMutation(
    trpc.walkthroughs.routeQuestion.mutationOptions({ onSettled: invalidate })
  )
  const voice = useVoiceAnswer((heard) => setText(heard))

  const uploader = walkthrough.uploadedByName
  const busy = answer.isPending || voice.transcribing

  return (
    <div className="w-full max-w-xl space-y-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = text.trim()
          if (trimmed) answer.mutate({ walkthroughId: walkthrough.id, text: trimmed })
        }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          placeholder="Answer the agent…"
          aria-label="Answer the agent"
          className="border-input bg-background focus-visible:border-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none"
        />
        <Button type="submit" disabled={busy || !text.trim()}>
          Answer
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={voice.toggle}>
          {voice.recording ? `stop · ${voice.clock}` : 'Answer by voice'}
        </Button>
        {uploader &&
          (route.isSuccess ? (
            <span className="text-muted-foreground font-mono text-xs">sent to {uploader}</span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              disabled={busy || route.isPending}
              onClick={() => route.mutate({ walkthroughId: walkthrough.id })}>
              Ask {uploader}
            </Button>
          ))}
      </form>
      {voice.transcribing && (
        <p className="text-muted-foreground font-mono text-sm">transcribing…</p>
      )}
      {voice.error && <p className="text-destructive font-mono text-sm">{voice.error}</p>}
      {answer.error && <p className="text-destructive text-sm">{answer.error.message}</p>}
      {route.error && <p className="text-destructive text-sm">{route.error.message}</p>}
    </div>
  )
}

export function AgentAnswer({ walkthrough }: { walkthrough: Walkthrough }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
    })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.list.queryKey() })
    queryClient.invalidateQueries({ queryKey: trpc.walkthroughs.inbox.queryKey() })
  }
  const setStatus = useMutation(trpc.walkthroughs.setStatus.mutationOptions({ onSettled: invalidate }))
  const sendBack = useMutation(
    trpc.walkthroughs.sendBack.mutationOptions({
      onSuccess: () => setArmed(false),
      onSettled: invalidate,
    })
  )
  const [armed, setArmed] = useState(false)

  // Evidence paths resolve against the walkthrough's own presigned file list.
  const urlByPath = useMemo(
    () => new Map(walkthrough.files.map((file) => [file.path, file.url])),
    [walkthrough.files]
  )

  const notes = walkthrough.notes
  const latestActivity = walkthrough.activity[0]
  if (notes.length === 0 && !latestActivity) return null

  const hasAnswer = notes.some((n) => n.role === 'agent')
  const awaitingAnswer = walkthrough.status === 'needs_info' && walkthrough.viewerIsMember
  const busy = setStatus.isPending || sendBack.isPending

  return (
    <section className="space-y-3">
      <SectionHead>{hasAnswer ? "agent's answer" : 'review thread'}</SectionHead>

      {notes.length > 0 && (
        <div className="space-y-3">
          {notes.map((note) =>
            note.kind === 'question' ? (
              <QuestionNote key={note.id} note={note} urlByPath={urlByPath} />
            ) : note.kind === 'answer' ? (
              <AnswerNote key={note.id} note={note} />
            ) : note.role === 'agent' ? (
              <AgentNote key={note.id} note={note} urlByPath={urlByPath} />
            ) : (
              <ReviewerNote key={note.id} note={note} />
            )
          )}
        </div>
      )}

      {/* The walkthrough is waiting on us — answer it, in text or voice, or pass
          the question along. Sits directly under the latest question card. */}
      {awaitingAnswer && <AnswerForm walkthrough={walkthrough} invalidate={invalidate} />}

      {/* The sign-off. Only a member can act, and only an actual answer is
          worth approving — a thread of send-backs is still waiting. */}
      {walkthrough.viewerIsMember && hasAnswer && (
        <div className="flex flex-wrap items-center gap-3">
          {walkthrough.status === 'resolved' ? (
            <span className="stamp">signed off</span>
          ) : armed ? (
            <form
              className="flex w-full max-w-xl flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const input = e.currentTarget.elements.namedItem('note')
                const note = input instanceof HTMLInputElement ? input.value.trim() : ''
                if (note) sendBack.mutate({ walkthroughId: walkthrough.id, note })
              }}>
              <input
                name="note"
                autoFocus
                disabled={busy}
                placeholder="What still needs doing?"
                aria-label="Send-back note"
                className="border-input bg-background focus-visible:border-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setArmed(false)
                }}
              />
              <Button type="submit" variant="outline" disabled={busy}>
                Send to agent
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setArmed(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  setStatus.mutate({ walkthroughId: walkthrough.id, status: 'resolved' })
                }>
                Approve &amp; resolve
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setArmed(true)}>
                Send back
              </Button>
            </>
          )}
          {sendBack.error && (
            <p className="text-destructive text-sm">{sendBack.error.message}</p>
          )}
        </div>
      )}

      {latestActivity && (
        <p className="text-muted-foreground font-mono text-xs">{activityLine(latestActivity)}</p>
      )}
    </section>
  )
}
