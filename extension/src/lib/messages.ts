import type {
  PageEvent,
  PointerSample,
  RecordingMeta,
  Settings,
  TimelineMove,
  TimelineRef,
  TranscriberId,
  TranscriptSegment,
} from './types';

/** Content script / side panel → background. */
export type Request =
  | { type: 'settings:get' }
  | { type: 'settings:set'; patch: Partial<Settings> }
  | { type: 'session:rename'; id: string; name: string }
  | { type: 'session:activate'; id: string }
  | { type: 'session:delete'; id: string }
  // Handed off and finished: no more takes land here, and the panel goes blank
  // until the next recording opens a fresh one. `uploadedUrl` is set when the
  // close followed a successful push to Handback.
  | { type: 'session:close'; id: string; uploadedUrl?: string }
  | { type: 'state:get' }
  // The panel minted `id` and got the screen share; this opens the part inside
  // the active gripe (or a fresh one) and answers with its part number.
  | { type: 'recording:start'; id: string; name: string; origin: string }
  // Fires every couple of seconds while recording — meta so far, plus how many
  // 1s chunk blobs are on disk. Deliberately silent: no broadcast.
  | { type: 'recording:progress'; id: string; meta: RecordingMeta; mime: string; chunks: number }
  | { type: 'recording:finish'; id: string; meta: RecordingMeta }
  // getDisplayMedia was granted but the recorder never really started.
  | { type: 'recording:discard'; id: string }
  // The panel died mid-part; reassemble the chunk blobs into the video.
  | { type: 'recording:recover'; id: string }
  | { type: 'recording:setActive'; active: boolean }
  | { type: 'recording:frame:delete'; id: string; index: number }
  // Lines are addressed by array position, and a Whisper pass replaces the whole
  // array — `rev` is the meta.rev the caller was looking at. Mismatch = skip.
  | { type: 'recording:line:update'; id: string; index: number; text: string; rev?: number }
  | { type: 'recording:line:delete'; id: string; index: number; rev?: number }
  // A drag on the timeline landed: every moved item's new position on the gripe's
  // unified axis, in one write. `revs` is recId → the meta.rev that recording had
  // when the panel drew what was dragged.
  | { type: 'timeline:move'; moves: TimelineMove[]; revs?: Record<string, number> }
  // The selection bar's delete — frames and lines in one go. This is how a ramble
  // gets sanitized before it reaches the agent.
  | { type: 'timeline:delete'; items: TimelineRef[]; revs?: Record<string, number> }
  // The on-device Whisper pass finished and supersedes the Web Speech lines.
  // `engine` is which pass produced these — the worker stamps it on the take so
  // report.md can say who wrote the words.
  | {
      type: 'recording:transcript';
      id: string;
      transcript: TranscriptSegment[];
      engine: TranscriberId;
    }
  // The human read the transcript back and confirmed it.
  | { type: 'recording:reviewed'; id: string }
  // Content script → panel, relayed while a recording is live. `origin` is the
  // sender's own, so the panel can drop everything outside the recorded tab.
  | { type: 'recording:event'; event: PageEvent; origin: string }
  | { type: 'recording:pointer'; sample: PointerSample; origin: string }
  // A click or an SPA route change — force a keyframe the dedup would call identical.
  | { type: 'recording:force'; why: 'click' | 'nav'; origin: string }
  // The on-page toolbar's stop button. The panel owns the recorder, so it acts;
  // the background just answers ok.
  | { type: 'recording:stop' }
  // The editor strip was popped out over `parentId`'s bottom edge; the worker
  // re-pins it on every parent move/resize so it behaves docked.
  | { type: 'strip:track'; stripId: number; parentId: number };

/** Background → content script. */
export type ContentCommand =
  // `origin` scopes the on-page recording toolbar to the recorded tab; `drawStart`
  // is whether the ink layer wakes up armed.
  | { type: 'recording'; active: boolean; origin?: string; drawStart?: boolean }
  // Toggle the live ink layer over the page — only meaningful while recording.
  | { type: 'draw:toggle' }
  | { type: 'ping' };

/** Background → side panel broadcast. */
export type Broadcast =
  | { type: 'state:changed' }
  // The mark hotkey fired. It's a command, so only the worker hears it.
  | { type: 'recording:mark' };

export function send<T = unknown>(message: Request): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
