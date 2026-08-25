// Re-run speech-to-text on a finalized walkthrough's takes, from the browser.
// The server can never decode a webm (no ffmpeg — owner's law), so the decode +
// transcribe + polish all happen here: each take's audio is pulled from S3,
// decoded to mono, sent through /api/ingest/transcribe (and polish), and the
// fresh segments are written back into every take's recording.json in ONE
// walkthroughs.applyTranscript mutation. report.md is never touched — the
// uploader re-runs Refine to fold the new words into the brief.
//
// Nothing is persisted until the final mutation, so a reload mid-run abandons it
// harmlessly. No IDB, no resume.

import { useCallback, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCaptureToken } from '~/lib/capture-token'
import { decodeMono } from '~/lib/capture/audio'
import { polishTranscript } from '~/lib/capture/polish'
import { transcribeInCloud } from '~/lib/capture/transcribe'
import type { TranscriptSegment } from '~/lib/capture/types'
import { useTRPC } from '~/lib/trpc'
import type { Take, Walkthrough } from '../types'

/** Progress while a run is live, or the error that ended one. `null` = idle/done. */
export type RetranscribeState =
  | null
  | { stage: 'decode' | 'transcribe' | 'polish' | 'save'; takeIndex: number; takeCount: number }
  | { error: string }

/** One take's payload in the applyTranscript mutation input. */
type ApplyTake = {
  takeId: string
  segments: Array<{ t: number; d?: number; text: string; speaker?: number }>
}

/**
 * The transcriber and recorder report float milliseconds; the mutation input is
 * integers only. Round `t`/`d`, drop a `d` that rounds to zero (the schema wants
 * it positive), and carry `speaker` through untouched.
 */
function cleanSegments(segments: TranscriptSegment[]): ApplyTake['segments'] {
  return segments.map((s) => {
    const d = s.d !== undefined ? Math.round(s.d) : undefined
    return {
      t: Math.max(0, Math.round(s.t)),
      text: s.text,
      ...(d !== undefined && d > 0 ? { d } : {}),
      ...(s.speaker !== undefined ? { speaker: s.speaker } : {}),
    }
  })
}

export function useRetranscribe({
  walkthrough,
  takes,
  videoUrls,
  onDone,
}: {
  walkthrough: Walkthrough
  takes: Take[]
  videoUrls: Map<string, string>
  onDone?: () => void
}): { state: RetranscribeState; start: () => void; cancel: () => void } {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  // Same mint/re-mint-on-401 token every in-browser capture page uses; the kind
  // string matches /upload's ('Upload') so a re-transcribe reuses that key.
  const withToken = useCaptureToken('Upload')
  const applyTranscript = useMutation(trpc.walkthroughs.applyTranscript.mutationOptions())

  const [state, setState] = useState<RetranscribeState>(null)
  const running = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(() => {
    if (running.current) return
    running.current = true
    const controller = new AbortController()
    abortRef.current = controller

    void (async () => {
      try {
        const processable = takes.filter((t) => videoUrls.has(t.id))
        if (processable.length === 0) {
          setState({ error: 'These takes have no recording to transcribe.' })
          return
        }
        const takeCount = processable.length

        // The whole run inside one withToken so a token that dies mid-run is
        // re-minted and the work retried once (from the top).
        const collected = await withToken(async (token): Promise<ApplyTake[]> => {
          const out: ApplyTake[] = []
          for (let i = 0; i < processable.length; i++) {
            const take = processable[i]
            const url = videoUrls.get(take.id)
            if (!url) continue
            const takeIndex = i + 1

            setState({ stage: 'decode', takeIndex, takeCount })
            const res = await fetch(url, { signal: controller.signal })
            if (!res.ok) throw new Error(`couldn't load take ${take.index}'s recording`)
            const audio = await decodeMono(await res.blob())
            if (!audio) throw new Error(`couldn't decode take ${take.index}'s audio`)

            setState({ stage: 'transcribe', takeIndex, takeCount })
            const heard = await transcribeInCloud(audio, { token, signal: controller.signal })
            if (!heard) {
              // transcribeInCloud collapses every failure (a 503 when
              // transcription isn't configured included) and an abort to null.
              if (controller.signal.aborted) throw new Error('cancelled')
              throw new Error(
                `couldn't transcribe take ${take.index} — transcription may be unavailable right now`
              )
            }

            // Polish is best-effort: a failed cleanup keeps the raw words rather
            // than losing the take's transcript.
            let segments = heard
            if (segments.length > 0) {
              setState({ stage: 'polish', takeIndex, takeCount })
              const cleaned = await polishTranscript(segments, { token, signal: controller.signal })
              if (cleaned) segments = cleaned
            }

            out.push({ takeId: take.id, segments: cleanSegments(segments) })
          }
          return out
        })

        if (controller.signal.aborted) {
          setState(null)
          return
        }

        setState({ stage: 'save', takeIndex: takeCount, takeCount })
        await applyTranscript.mutateAsync({ walkthroughId: walkthrough.id, takes: collected })

        // Blow both caches the transcript is read through: the walkthrough row
        // and the per-take recording.json (staleTime Infinity — it never refetches
        // on its own, so it must be invalidated or the UI shows the old words).
        await queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
        })
        await queryClient.invalidateQueries({ queryKey: ['handback.recording'] })

        setState(null)
        onDone?.()
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          setState(null)
        } else {
          setState({ error: err instanceof Error ? err.message : 'Re-transcribe failed.' })
        }
      } finally {
        running.current = false
        abortRef.current = null
      }
    })()
  }, [takes, videoUrls, withToken, applyTranscript, queryClient, trpc, walkthrough.id, onDone])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { state, start, cancel }
}
