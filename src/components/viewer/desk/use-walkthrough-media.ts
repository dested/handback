// Every piece of playable/inspectable material a walkthrough carries, assembled
// once and shared by the desk's Recording, Frames and Console tabs: the takes
// played back to back through one SegmentPlayer, the frames/transcript/console
// pulled out of each take's recording.json, the timeline lanes, and the staged
// keyframe-delete stack. Lifted verbatim in behavior out of the old agent-view
// so the desk reads the same clocks the take view always did.

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import type { EditSegment } from '~/lib/edit/edl'
import { useTRPC } from '~/lib/trpc'
import { mmss } from '../format'
import type { ViewerFrame } from '../slideshow'
import type { TimelineTake, TimelineVoiceBar } from '../timeline'
import type { TakeEvent, TakeRecording, Walkthrough } from '../types'
import { useSegmentPlayer } from '../use-segment-player'

type Line = { tMs: number; endMs: number; text: string; speaker?: number }

export function useWalkthroughMedia(walkthrough: Walkthrough, urlByPath: Map<string, string>) {
  const takes = useMemo(
    () => [...walkthrough.takes].sort((a, b) => a.index - b.index),
    [walkthrough.takes]
  )

  // A take's frames/transcript/events live in `${take.dir}/recording.json` on S3,
  // not in the database — fetched here and cached under the take id (not the
  // presigned url, which is re-signed on every `walkthroughs.get`) because the
  // file itself never changes once uploaded.
  const recordings = useQueries({
    queries: takes.map((take) => {
      const url = urlByPath.get(`${take.dir}/recording.json`)
      return {
        queryKey: ['handback.recording', take.id],
        enabled: url !== undefined,
        staleTime: Infinity,
        retry: 1,
        queryFn: async (): Promise<TakeRecording> => {
          if (!url) throw new Error('recording.json was never uploaded')
          const res = await fetch(url)
          if (!res.ok) throw new Error(`recording.json failed (${res.status})`)
          return res.json() as Promise<TakeRecording>
        },
      }
    }),
  })

  /** Where each take starts on the walkthrough-wide clock, and the whole length. */
  const offsets = useMemo(() => {
    const byTakeId = new Map<string, number>()
    let totalMs = 0
    for (const take of takes) {
      byTakeId.set(take.id, totalMs)
      totalMs += take.durationMs
    }
    return { byTakeId, totalMs }
  }, [takes])

  const videoUrls = useMemo(() => {
    const map = new Map<string, string>()
    for (const take of takes) {
      const url = urlByPath.get(take.videoPath ?? `${take.dir}/walkthrough.webm`)
      if (url) map.set(take.id, url)
    }
    return map
  }, [takes, urlByPath])

  // One uncut segment per take. Nothing is removed here, so the player's output
  // clock IS the walkthrough-wide clock — the timeline, transcript and contact
  // sheet can all read `player.outputMs` directly.
  const segments = useMemo<EditSegment[]>(
    () =>
      takes
        .filter((take) => videoUrls.has(take.id))
        .map((take) => ({ takeId: take.id, srcStartMs: 0, srcEndMs: take.durationMs })),
    [takes, videoUrls]
  )

  const player = useSegmentPlayer(segments, videoUrls)

  const trpc = useTRPC()
  const queryClient = useQueryClient()
  // Server S3 deletes can't be undone, so deletes are staged locally (the shot
  // just vanishes from `frames`) and committed as one batch on leaving edit mode.
  // The stack is ordered so undo pops the most recent.
  const [staged, setStaged] = useState<string[]>([])
  const stagedSet = useMemo(() => new Set(staged), [staged])
  const stageDelete = useCallback((path: string) => {
    setStaged((prev) => (prev.includes(path) ? prev : [...prev, path]))
  }, [])
  const undoDelete = useCallback(() => setStaged((prev) => prev.slice(0, -1)), [])
  const deleteFrames = useMutation(
    trpc.walkthroughs.deleteFrames.mutationOptions({
      // Clear only what this call sent — more may have been staged while it saved.
      onSuccess: async (_data, vars) => {
        await queryClient.invalidateQueries({
          queryKey: trpc.walkthroughs.get.queryKey({ walkthroughId: walkthrough.id }),
        })
        setStaged((prev) => prev.filter((p) => !vars.paths.includes(p)))
      },
    })
  )
  const commitDeletes = useCallback(() => {
    for (let i = 0; i < staged.length; i += 500) {
      deleteFrames.mutate({ walkthroughId: walkthrough.id, paths: staged.slice(i, i + 500) })
    }
  }, [staged, deleteFrames, walkthrough.id])
  const commitState: 'saving' | 'error' | 'idle' = deleteFrames.isPending
    ? 'saving'
    : deleteFrames.isError
      ? 'error'
      : 'idle'

  // useQueries hands back a fresh array every render and the playhead re-renders
  // ~30×/s; the strips only change when a recording actually lands.
  const landed = recordings.map((query) => (query.data ? '1' : '0')).join('')
  const { frames, lines, events, voice } = useMemo(() => {
    const frames: ViewerFrame[] = []
    const lines: Line[] = []
    const events: TakeEvent[] = []
    const spoken: Array<{ startMs: number; endMs: number }> = []

    takes.forEach((take, i) => {
      const detail = recordings[i]?.data?.recording
      if (!detail) return
      const offset = offsets.byTakeId.get(take.id) ?? 0
      for (const frame of detail.frames) {
        const atMs = offset + frame.tMs
        const path = `${take.dir}/${frame.file}`
        const url = urlByPath.get(path)
        // A frame that never uploaded has nothing to show; a staged one is gone.
        if (url === undefined || stagedSet.has(path)) continue
        frames.push({ atMs, url, label: mmss(atMs), path })
      }
      for (const line of detail.transcript) {
        lines.push({
          tMs: offset + line.tMs,
          endMs: offset + line.endMs,
          text: line.text,
          speaker: line.speaker,
        })
        spoken.push({ startMs: offset + line.tMs, endMs: offset + line.endMs })
      }
      // `event.at` is a preformatted clock string the recorder wrote, not a
      // number — it is shown verbatim and never re-clocked onto this timeline.
      events.push(...detail.events)
    })

    // The viewer has no decoded audio, so the voice lane is a deterministic
    // pseudo-waveform: tall inside a spoken window, a flat floor outside one.
    const voice: TimelineVoiceBar[] = []
    for (let t = 500; t < offsets.totalMs; t += 1000) {
      const speaking = spoken.some((w) => t >= w.startMs && t < w.endMs)
      voice.push({ atMs: t, level: speaking ? 0.35 + 0.6 * Math.abs(Math.sin(t / 700)) : 0.08 })
    }

    return { frames, lines, events, voice }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takes, urlByPath, offsets, landed, stagedSet])

  const timelineTakes = useMemo<TimelineTake[]>(
    () =>
      takes.map((take) => ({
        id: take.id,
        label: `take ${take.index} · ${mmss(take.durationMs)}`,
        offsetMs: offsets.byTakeId.get(take.id) ?? 0,
        durationMs: take.durationMs,
      })),
    [takes, offsets]
  )

  // Nothing to transcribe from: recording.json never uploaded for any take.
  // (A take that uploaded one and simply said nothing falls to the panel's own
  // empty line.) Distinct from every fetch FAILING — an expired presign must
  // not read as "nobody spoke".
  const noRecordings = takes.every((take) => !urlByPath.has(`${take.dir}/recording.json`))
  const recordingsFailed =
    !noRecordings && recordings.length > 0 && recordings.every((query) => query.isError)

  return {
    player,
    frames,
    lines,
    events,
    voice,
    // The webm per take, keyed by take id — the re-transcribe flow fetches
    // these to decode the audio in the browser.
    videoUrls,
    totalMs: offsets.totalMs,
    timelineTakes,
    noRecordings,
    recordingsFailed,
    staged,
    stageDelete,
    undoDelete,
    commitDeletes,
    commitState,
    takes,
  }
}

export type WalkthroughMedia = ReturnType<typeof useWalkthroughMedia>
