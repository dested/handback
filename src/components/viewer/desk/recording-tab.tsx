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
