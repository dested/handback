// The recording, re-homed as a desk tab: the player and its transcript, the
// timeline under them, and the quiet way into the editor. Console lives in its
// own tab now, and the report and comments are elsewhere — this tab is only the
// video and what was said over it.

import { SectionHead } from '../section-head'
import { Timeline } from '../timeline'
import { TranscriptPanel } from '../transcript-panel'
import type { Walkthrough } from '../types'
import { VideoStage } from '../video-stage'
import type { WalkthroughMedia } from './use-walkthrough-media'

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
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <VideoStage player={player} frames={frames} />
        </div>

        <section className="space-y-2 lg:col-span-1">
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
