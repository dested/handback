import type {
  PageEvent,
  PointerSample,
  RecordingMeta,
  SessionIntent,
  SessionKind,
  Settings,
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
  // One take out of the open gripe: its row, its frames, its blobs. The takes
  // that remain renumber to 1..N so the timeline stays one continuous axis —
  // same shape as `session:delete`, one rung down.
  | { type: 'take:delete'; id: string }
  // Handed off and finished: no more takes land here, and the panel goes blank
  // until the next recording opens a fresh one. `uploadedUrl` is set when the
  // close followed a successful push to Handback.
  | { type: 'session:close'; id: string; uploadedUrl?: string }
  // Pin this gripe to one project in the active space. '' clears both fields
  // and hands routing back to the server's origin hints.
  | { type: 'session:project'; id: string; projectId: string; projectName: string }
  // Who this walkthrough is for. It decides how the next take is captured, so
  // the worker refuses it once the session holds one — the two modes can't mix
  // inside a walkthrough.
  | { type: 'session:kind'; id: string; kind: SessionKind }
  // What this walkthrough is — bug, feature, or idea — picked on the review screen
  // and sent with the upload. null clears it back to untagged.
  | { type: 'session:intent'; sessionId: string; intent: SessionIntent | null }
  | { type: 'state:get' }
  // sessionId → SessionSummary for every session on this machine. Its own message
  // rather than a field on `state:get`, which lands on every broadcast: this walks
  // all takes' metadata, and only the home screen ever needs it.
  | { type: 'sessions:summary' }
  // The panel minted `id` and got the screen share; this opens the part inside
  // the active gripe (or a fresh one) and answers with its part number.
  // `kind` only takes effect when this opens a *fresh* walkthrough; a take that
  // lands in one already open inherits whatever that one is.
  | { type: 'recording:start'; id: string; name: string; origin: string; kind: SessionKind }
  // Fires every couple of seconds while recording — meta so far, plus how many
  // 1s chunk blobs are on disk (video, and the mic-only shadow when one runs).
  // Deliberately silent: no broadcast.
  | {
      type: 'recording:progress';
      id: string;
      meta: RecordingMeta;
      mime: string;
      chunks: number;
      micChunks: number;
      micMime: string;
    }
  | { type: 'recording:finish'; id: string; meta: RecordingMeta }
  // getDisplayMedia was granted but the recorder never really started.
  | { type: 'recording:discard'; id: string }
  // The panel died mid-part; reassemble the chunk blobs into the video.
  | { type: 'recording:recover'; id: string }
  | { type: 'recording:setActive'; active: boolean }
  // Lines are addressed by array position, and a Whisper pass replaces the whole
  // array — `rev` is the meta.rev the caller was looking at. Mismatch = skip.
  // An empty text deletes the line; that is the only way one goes.
  | { type: 'recording:line:update'; id: string; index: number; text: string; rev?: number }
  // The on-device Whisper pass finished and supersedes the Web Speech lines.
  // `engine` is which pass produced these — the worker stamps it on the take so
  // report.md can say who wrote the words.
  | {
      type: 'recording:transcript';
      id: string;
      transcript: TranscriptSegment[];
      engine: TranscriberId;
      /** The server's cleanup pass rewrote the wording (timings untouched). */
      polished: boolean;
    }
  // Content script → panel, relayed while a recording is live. `origin` is the
  // sender's own, so the panel can drop everything outside the recorded tab.
  | { type: 'recording:event'; event: PageEvent; origin: string }
  | { type: 'recording:pointer'; sample: PointerSample; origin: string }
  // A click or an SPA route change — force a keyframe the dedup would call
  // identical. An ink stroke finishing on the page is a click for this purpose:
  // the drawing is on screen and dedup would score it as the same screen.
  | { type: 'recording:force'; why: 'click' | 'nav'; origin: string }
  // The on-page toolbar's stop button. The panel owns the recorder, so it acts;
  // the background just answers ok.
  | { type: 'recording:stop' };

/** Background → content script. */
export type ContentCommand =
  // `origin` scopes the on-page recording toolbar to the recorded tab; `drawStart`
  // is whether the ink layer wakes up armed.
  | { type: 'recording'; active: boolean; origin?: string; drawStart?: boolean }
  // Toggle the live ink layer over the page — only meaningful while recording.
  | { type: 'draw:toggle' }
  | { type: 'ping' };

/** Background → side panel broadcast. */
export type Broadcast = { type: 'state:changed' };

/**
 * What a Handback web page may send via chrome.runtime.sendMessage(EXTENSION_ID, …).
 * A token is the user's — it reaches their personal space and every team — so
 * linking carries nothing but the token. Pages cached from 1.2.x may still send
 * `orgId`/`orgName`; they are accepted and ignored.
 */
export type ExternalRequest =
  | { type: 'handback:ping' }
  | { type: 'handback:link'; apiToken: string; orgId?: string; orgName?: string };

/** Answer to handback:ping — enough for the page to render "installed" and "linked". */
export interface ExternalPong {
  ok: true;
  version: string;
  linked: boolean;
  /** The server this extension currently uploads to. */
  serverUrl: string;
  /** Every server this recorder holds a key to, so the asking page can see itself in the list. */
  linkedOrigins: string[];
}

export interface ExternalLinkResult {
  ok: boolean;
  error?: string;
}

export function send<T = unknown>(message: Request): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
