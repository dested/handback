// The recording, re-homed as a desk tab: the player and its transcript, the
// timeline under them, and the quiet way into the editor. Console lives in its
// own tab now, and the report and comments are elsewhere — this tab is only the
// video and what was said over it.

import { useState } from 'react'
import { TokenLimitNotice, isTokenLimitError } from '~/components/token-manager'
import { SectionHead } from '../section-head'
import { Timeline } from '../timeline'
import { TranscriptPanel } from '../transcript-panel'
import type { Walkthrough } from '../types'
import { VideoStage } from '../video-stage'
import { useRetranscribe } from './use-retranscribe'
import type { WalkthroughMedia } from './use-walkthrough-media'

const STAGE_WORD = {
  decode: 'decoding',
  transcribe: 'transcribing',
  polish: 'cleaning up',
  save: 'saving',
} as const

/**
 * Re-run speech-to-text on this walkthrough's takes from the browser, writing
 * the fresh transcript back into each recording.json. Quiet by default; arms
 * inline (no confirm dialog, no layout jump) before it spends the transcribe
 * budget. Members only, agent kind only, and only when there's audio to decode.
 */
function RetranscribeControl({
  walkthrough,
  media,
}: {
  walkthrough: Walkthrough
  media: WalkthroughMedia
}) {
  const [armed, setArmed] = useState(false)
  const [done, setDone] = useState(false)
  const n = media.videoUrls.size
  const { state, start } = useRetranscribe({
    walkthrough,
    takes: media.takes,
    videoUrls: media.videoUrls,
    onDone: () => {
      setArmed(false)
      setDone(true)
    },
  })

  if (walkthrough.viewerIsMember === false || walkthrough.kind === 'human' || n === 0) return null

  const progress = state !== null && 'stage' in state ? state : null
  const error = state !== null && 'error' in state ? state.error : null

  const run = () => {
    setDone(false)
    start()
  }

  return (
    // Reserve height so arming (or a wrapped prompt) never shoves the timeline
    // mid-decision — ui.md's no-jump law.
    <div className="min-h-[3.5rem] pt-3 font-mono text-xs leading-relaxed">
      {progress ? (
        <span className="text-muted-foreground">
          take {progress.takeIndex} of {progress.takeCount} — {STAGE_WORD[progress.stage]}…
        </span>
      ) : error ? (
        isTokenLimitError(error) ? (
          // The mint hit the active-token cap. Same recovery as /upload and
          // /record: revoke where you are, then go again — never a dead end.
          <div className="max-w-md space-y-2 font-sans">
            <TokenLimitNotice />
            <button
              type="button"
              onClick={run}
              className="text-primary font-mono underline underline-offset-4">
              try again
            </button>
          </div>
        ) : (
          <span className="text-muted-foreground">
            {error}{' '}
            <button
              type="button"
              onClick={run}
              className="text-primary underline underline-offset-4">
              try again
            </button>
          </span>
        )
      ) : armed ? (
        <span className="text-muted-foreground">
          replaces the transcript for {n} take{n === 1 ? '' : 's'} using the recording's mixed
          audio{' '}
          <button
            type="button"
            onClick={run}
            className="text-primary underline underline-offset-4">
            go
          </button>{' '}
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="hover:text-foreground underline underline-offset-4">
            cancel
          </button>
        </span>
      ) : done ? (
        <span className="text-muted-foreground">
          transcript replaced — re-run Refine to update the brief{' '}
          <button
            type="button"
            onClick={() => {
              setDone(false)
              setArmed(true)
            }}
            className="text-primary underline underline-offset-4">
            re-transcribe
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="text-muted-foreground hover:text-foreground underline underline-offset-4">
          re-transcribe
        </button>
      )}
    </div>
  )
}

export function RecordingTab({
  walkthrough,
  media,
  onEdit,
}: {
  walkthrough: Walkthrough
  media: WalkthroughMedia
  /** Present when the viewer may cut these raw takes down into a render. */
  onEdit?: () => void
}) {
  const { player, frames, lines, totalMs, timelineTakes, voice, noRecordings, recordingsFailed } =
    media

  if (media.takes.length === 0) {
    return <p className="text-muted-foreground text-sm">No takes were uploaded.</p>
  }

  return (
    <div className="space-y-8">
      {/* The stage takes what the video's aspect leaves; the transcript keeps a
          readable fixed column instead of splitting the row proportionally —
          a portrait phone recording must not shred it into one-word lines. */}
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          <VideoStage player={player} frames={frames} />
        </div>

        <section className="space-y-2 lg:w-[300px] lg:shrink-0">
          <SectionHead>transcript</SectionHead>
          {noRecordings ? (
            <p className="text-muted-foreground text-sm">No narration was uploaded.</p>
          ) : recordingsFailed ? (
            <p className="text-muted-foreground text-sm">
              Couldn't load the narration — reload the page to try again.
            </p>
          ) : (
            // Bounded beside the stage so a long narration scrolls in place
            // instead of setting the height of the whole desk row.
            <div className="lg:max-h-[440px] lg:overflow-y-auto">
              <TranscriptPanel
                lines={lines}
                activeMs={player.outputMs}
                onSeek={(ms) => player.seekOutput(ms)}
              />
            </div>
          )}
          <RetranscribeControl walkthrough={walkthrough} media={media} />
        </section>
      </div>

      <Timeline
        totalMs={totalMs}
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
    </div>
  )
}
