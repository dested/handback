// The whole walkthrough as one review surface: every take played back to back
// in one player over one scrubber, the narration and console always beside it,
// every keyframe in one numbered contact sheet below, then the report the agent
// will actually read.

import { useCallback, useMemo, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Button } from '~/components/ui/button'
import type { EditSegment } from '~/lib/edit/edl'
import { CommentsPanel } from './comments-panel'
import { EventsPanel } from './events-panel'
import { mmss } from './format'
import { FramesGrid, type GridFrame } from './frames-grid'
import { ReportPanel } from './report-panel'
import { SectionHead } from './section-head'
import { Timeline, type TimelineTake, type TimelineVoiceBar } from './timeline'
import { TranscriptPanel } from './transcript-panel'
import type { TakeEvent, TakeRecording, Walkthrough } from './types'
import { useSegmentPlayer } from './use-segment-player'
import { VideoStage } from './video-stage'

type Line = { tMs: number; endMs: number; text: string }

export function AgentView({
  walkthrough,
  urlByPath,
  onEdit,
}: {
  walkthrough: Walkthrough
  urlByPath: Map<string, string>
  /** Present when the viewer may cut these raw takes down into a render. */
  onEdit?: () => void
}) {
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

  // Seeks fired from far down the page (a keyframe near the bottom) are useless
  // if the player is scrolled off the top — so bring it back into view.
  const playerRef = useRef<HTMLDivElement>(null)
  const seekAndReveal = useCallback(
    (ms: number) => {
      // "Play from here" means play — force it even if the player was paused —
      // and bring the player back up so you can actually watch it.
      player.seekOutput(ms, true)
      playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [player]
  )

  const [showReport, setShowReport] = useState(false)

  // useQueries hands back a fresh array every render and the playhead re-renders
  // ~30×/s; the strips only change when a recording actually lands.
  const landed = recordings.map((query) => (query.data ? '1' : '0')).join('')
  const { frames, lines, events, voice } = useMemo(() => {
    const frames: GridFrame[] = []
    const lines: Line[] = []
    const events: TakeEvent[] = []
    const spoken: Array<{ startMs: number; endMs: number }> = []

    takes.forEach((take, i) => {
      const detail = recordings[i]?.data?.recording
      if (!detail) return
      const offset = offsets.byTakeId.get(take.id) ?? 0
      for (const frame of detail.frames) {
        const atMs = offset + frame.tMs
        frames.push({
          atMs,
          url: urlByPath.get(`${take.dir}/${frame.file}`) ?? null,
          label: mmss(atMs),
        })
      }
      for (const line of detail.transcript) {
        lines.push({ tMs: offset + line.tMs, endMs: offset + line.endMs, text: line.text })
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
  }, [takes, urlByPath, offsets, landed])

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

  // The report is the agent's brief, not the reviewer's — kept folded away behind
  // a button so the page reads as a video first, a document only on request.
  const report = walkthrough.kind === 'agent' && (
    <section className="rule pt-8">
      {showReport ? (
        <div className="space-y-3">
          <ReportPanel walkthroughId={walkthrough.id} url={urlByPath.get('report.md')} />
          <button
            type="button"
            onClick={() => setShowReport(false)}
            className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4">
            Hide report
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <SectionHead>report</SectionHead>
            <p className="text-muted-foreground text-sm">
              The brief your agent reads — hidden by default.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowReport(true)}>
            Show report
          </Button>
        </div>
      )}
    </section>
  )

  if (takes.length === 0) {
    return (
      <div className="space-y-8">
        <p className="text-muted-foreground text-sm">No takes were uploaded.</p>
        {report}
      </div>
    )
  }

  // Nothing to transcribe from: recording.json never uploaded for any take.
  // (A take that uploaded one and simply said nothing falls to the panel's own
  // empty line.) Distinct from every fetch FAILING — an expired presign must
  // not read as "nobody spoke".
  const noRecordings = takes.every((take) => !urlByPath.has(`${take.dir}/recording.json`))
  const recordingsFailed =
    !noRecordings && recordings.length > 0 && recordings.every((query) => query.isError)

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-3">
        <div ref={playerRef} className="scroll-mt-4 lg:col-span-2">
          <VideoStage player={player} frames={frames} />
        </div>

        <div className="space-y-5 lg:col-span-1">
          <section className="space-y-2">
            <SectionHead>transcript</SectionHead>
            {noRecordings ? (
              <p className="text-muted-foreground text-sm">No narration was uploaded.</p>
            ) : recordingsFailed ? (
              <p className="text-muted-foreground text-sm">
                Couldn't load the narration — reload the page to try again.
              </p>
            ) : (
              <TranscriptPanel
                lines={lines}
                activeMs={player.outputMs}
                onSeek={(ms) => player.seekOutput(ms)}
              />
            )}
          </section>

          {events.length > 0 && (
            <section className="border-border space-y-2 border-t pt-5">
              <SectionHead>console</SectionHead>
              <EventsPanel events={events} />
            </section>
          )}
        </div>
      </div>

      <Timeline
        totalMs={offsets.totalMs}
        takes={timelineTakes}
        frames={frames}
        voice={voice}
        playheadMs={player.outputMs}
        onScrub={(ms) => player.seekOutput(ms)}
      />

      {onEdit && (
        <div className="-mt-4 flex justify-end">
          <button
            type="button"
            onClick={onEdit}
            className="text-muted-foreground hover:text-foreground font-mono text-xs underline underline-offset-4">
            cut this video down
          </button>
        </div>
      )}

      <section className="rule space-y-3 pt-8">
        <SectionHead>comments</SectionHead>
        <CommentsPanel
          walkthroughId={walkthrough.id}
          currentMs={player.outputMs}
          canComment={walkthrough.viewerIsMember}
          onSeek={(ms) => seekAndReveal(ms)}
        />
      </section>

      <section className="rule space-y-3 pt-8">
        <SectionHead>frames</SectionHead>
        <FramesGrid frames={frames} activeMs={player.outputMs} onSeek={seekAndReveal} />
      </section>

      {report}
    </div>
  )
}
