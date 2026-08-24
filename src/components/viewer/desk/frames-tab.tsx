// Every keyframe as the shot-by-shot slideshow, full width. Staged-delete wiring
// comes straight off the media hook; `onPlayFrom` is the bridge back to the
// recording tab (the parent switches tabs, seeks, and scrolls the player up).

import { Slideshow } from '../slideshow'
import type { Walkthrough } from '../types'
import type { WalkthroughMedia } from './use-walkthrough-media'

export function FramesTab({
  walkthrough,
  media,
  onPlayFrom,
}: {
  walkthrough: Walkthrough
  media: WalkthroughMedia
  onPlayFrom: (ms: number) => void
}) {
  return (
    <Slideshow
      frames={media.frames}
      lines={media.lines}
      activeMs={media.player.outputMs}
      onSeek={onPlayFrom}
      canEdit={walkthrough.viewerIsMember}
      stagedCount={media.staged.length}
      commitState={media.commitState}
      onDelete={media.stageDelete}
      onUndo={media.undoDelete}
      onCommit={media.commitDeletes}
    />
  )
}
