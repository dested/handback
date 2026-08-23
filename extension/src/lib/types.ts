/**
 * A gripe is a narrated screen recording, taken in one or more sittings, and
 * everything here describes one: the takes, what was said over them, the frames
 * that survived dedup, and what the page complained about while it was running.
 *
 * Semantics are ported from the original Gripe extension and must not drift —
 * the Handback cloud viewer and report reader consume exactly these shapes.
 */

export interface PageEvent {
  level: 'error' | 'warn' | 'network';
  message: string;
  detail?: string;
  ts: number;
}

/**
 * Which engine wrote the transcript that shipped. `groq` is the server's
 * hosted pass (fast, audio leaves the machine); `whisper` is the on-device
 * fallback — same model family, minutes instead of seconds, nothing uploaded.
 * The report cites this, so it is a fact about the recording, not a setting.
 */
export type TranscriberId = 'whisper' | 'groq';

export interface TranscriptSegment {
  /** ms from recording start — where the speaker *started* the line */
  t: number;
  /** Spoken length in ms when the transcriber reported one. A line covers a window, not an instant. */
  d?: number;
  /** Position on the gripe's unified axis, ms. Set only when a human moved it; absent = computed from t. */
  tl?: number;
  text: string;
}

/** The live dictation engine's state, as the panel reports it. */
export type MicState = 'listening' | 'off' | 'denied' | 'error';

/** Where the mouse was, sampled by the recorded tab while a walkthrough runs. All lengths are CSS px. */
export interface PointerSample {
  /** Absolute ms — the panel converts it to recording-relative. */
  ts: number;
  /** Viewport coordinates. */
  x: number;
  y: number;
  /** Screen coordinates (`MouseEvent.screenX/Y`). */
  sx: number;
  sy: number;
  /** Viewport size, for the tab-capture mapping. */
  vw: number;
  vh: number;
  /** Screen size, for the full-screen mapping. */
  sw: number;
  sh: number;
  selector?: string;
  text?: string;
}

/** The pointer as it applies to one keyframe. */
export interface FramePointer {
  /** Position inside the frame, 0–1. Absent when the capture couldn't be mapped (window capture, second monitor). */
  nx?: number;
  ny?: number;
  /** What the cursor was over, in the recorded tab. */
  selector?: string;
  text?: string;
}

export interface RecordingFrame {
  index: number;
  /** ms from recording start */
  t: number;
  /** Path relative to the gripe folder’s take dir, e.g. frames/03-0125.jpg */
  file: string;
  /**
   * Why this frame exists: first frame, dedup said "new", a click just happened
   * in the recorded tab (drawing a stroke counts as one), the page navigated (SPA
   * route or full load), or the heartbeat fired — nothing had been kept for a
   * while and the screen wasn't strictly identical.
   */
  reason: 'start' | 'change' | 'click' | 'nav' | 'beat';
  /** Changed-cell count (of 64×64) vs the closest of the last kept frames (absent on the first). */
  dist?: number;
  /** Mouse at capture time, when the recorded tab was reporting it. */
  pointer?: FramePointer;
  /** Position on the gripe's unified axis, ms. Set only when a human moved it; absent = computed from t. */
  tl?: number;
}

export interface RecordingMeta {
  startedAt: number;
  durationMs: number;
  /** Candidate frames examined; frames[] is what survived dedup. */
  sampled: number;
  frames: RecordingFrame[];
  transcript: TranscriptSegment[];
  /** Set when a real transcription pass replaced the live Web Speech lines; absent = Web Speech or none. */
  transcriber?: TranscriberId;
  /**
   * The server's cleanup pass rewrote the wording — product nouns spelled
   * right, sentences punctuated, filler dropped. Timings are the transcriber's
   * either way. The report says so, because a reader deserves to know a model
   * touched the words.
   */
  polished?: boolean;
  /** Bumped on every content mutation; a line edit against a stale rev is skipped. */
  rev?: number;
  /** True once a human read the transcript back and said it was right. Reset when Whisper replaces it. */
  reviewed?: boolean;
  /** Console/network events forwarded by content scripts while recording. ts is absolute. */
  events: PageEvent[];
  /** Origin the events are scoped to — the tab that was in front at Record. Absent = no scope (kept everything). */
  eventScope?: string;
  /** Events from other origins that were thrown away; reported rather than hidden. */
  droppedEvents?: number;
  videoFile: string;
}

/**
 * One part of a gripe. Recording and re-recording appends parts to the same
 * session, so a walkthrough is not a kind of session — it's a record inside one.
 */
export interface Recording {
  id: string;
  sessionId: string;
  /** 1-based part number within the gripe; names the rec-NN folder. */
  index: number;
  createdAt: number;
  state: 'recording' | 'done';
  /** Set when the panel died mid-recording and the chunks were reassembled. */
  interrupted?: boolean;
  /** MediaRecorder mime, needed to reassemble chunks. */
  mime: string;
  /** Count of persisted 1s chunk blobs (`<id>:chunk:<n>`, n from 1) while state is 'recording'. */
  chunks: number;
  /**
   * The mic-only shadow recording (`<id>:micchunk:<n>` → `<id>:mic`), kept so
   * transcription hears narration and not the app audio mixed into the video.
   * Absent/0 on takes with no system audio — there the video's track IS the mic.
   */
  micChunks?: number;
  /** MediaRecorder mime of the mic-only chunks. */
  micMime?: string;
  meta: RecordingMeta;
}

/**
 * Who a walkthrough is FOR, which is the one thing that changes how it is
 * captured: 'agent' distils (10 fps, keyframes, report.md); 'human' is the
 * video itself (30 fps, no keyframes, tightened and shared on the web).
 */
export type SessionKind = 'agent' | 'human';

/** What a walkthrough is about: a bug to fix, a feature to build, or an idea to weigh. Absent/null = untagged. */
export type SessionIntent = 'bug' | 'feature' | 'idea';

export interface Session {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  origin: string;
  /**
   * Optional on purpose: every session recorded before 1.8.0 is on disk without
   * it, and a required field would be a lie about those rows. Read it through
   * `sessionKind()`, which answers 'agent' for them.
   */
  kind?: SessionKind;
  /** What the walkthrough is — chosen on the review screen, shipped with the declare. Absent/null = untagged. */
  intent?: SessionIntent | null;
  /** How many takes this gripe holds — the next one is `recCount + 1`. Deleting a
   *  take renumbers the rest contiguously, so this is always their count. */
  recCount: number;
  /** Handed off and finished. A closed session never receives another part; activating it reopens it. */
  closed?: boolean;
  /** Set once the gripe uploaded to Handback — the cloud viewer URL. */
  uploadedUrl?: string;
  /** The project this gripe ships to. Absent = let the server route it by origin. */
  projectId?: string;
  /** The project's name as the panel last saw it — display fallback when the list can't be fetched. */
  projectName?: string;
}

/**
 * What one session amounts to, without shipping its takes. `state:get` carries
 * the *active* session's recordings and nothing else — deliberately, since a
 * take's frame list runs to hundreds of entries — so the home screen's list of
 * everything on this machine asks for these instead.
 */
export interface SessionSummary {
  /** Finished takes. A take still being recorded is not one yet. */
  takes: number;
  /** Every take's length added up — the same figure the panel's timeline shows. */
  durationMs: number;
  frames: number;
  lines: number;
}

/** One thing sitting on the gripe's timeline, addressed the way the store finds it again. */
export type TimelineRef =
  | { kind: 'frame'; recId: string; index: number } // RecordingFrame.index — identity, survives deletes
  | { kind: 'line'; recId: string; index: number }; // array position in meta.transcript

/**
 * One Handback server this recorder can upload to. A token is the user's, not a
 * space's — it already reaches their personal space and every team they're in —
 * so a link is a server and the key that opens it, and nothing else.
 */
export interface ServerLink {
  /** The server URL. One link per server, so the id is the server. */
  id: string;
  serverUrl: string;
  apiToken: string;
  addedAt: number;
}

export interface Settings {
  /** Start every recording with the on-page ink active — draw first, click through on demand. */
  drawStart: boolean;
  lang: string;
  /**
   * Transcribe in this browser instead of on the server. Slower by minutes and
   * it spins the fan, but no audio ever leaves the machine — the answer for
   * anyone who can't send a recording to a third party. Off by default.
   */
  onDeviceTranscription: boolean;
  /**
   * Every Handback server this recorder holds a key to — one per server; the
   * token spans the owner's personal space and teams.
   */
  links: ServerLink[];
  /** Which link uploads go to; '' = none. */
  activeLinkId: string;
  /** Where uploads land on that server: '' = the token owner's personal space, else a team id. */
  activeTeamId: string;
}

export const DEFAULT_SERVER = 'https://handback.dev';

export const DEFAULT_SETTINGS: Settings = {
  drawStart: true,
  lang: '',
  onDeviceTranscription: false,
  links: [],
  activeLinkId: '',
  activeTeamId: '',
};

/** The id of the link for a server. Kept as a helper so call sites stay uniform. */
export function linkId(serverUrl: string): string {
  return serverUrl;
}

/** A session's kind, with the pre-1.8.0 rows that have none reading as 'agent'. */
export function sessionKind(session: Pick<Session, 'kind'> | null | undefined): SessionKind {
  return session?.kind === 'human' ? 'human' : 'agent';
}

export function activeLink(settings: Settings): ServerLink | null {
  return settings.links.find((l) => l.id === settings.activeLinkId) ?? settings.links[0] ?? null;
}

/** The reviewer's-pen cobalt — Handback's one accent. Never orange, never dark UI. */
export const COBALT = '#2f56d8';

/** Contact sheet shape. The sheet builder and the report that cites the sheets must agree. */
export const GRID_COLS = 3;
export const GRID_ROWS = 3;
export const GRID_PER_SHEET = GRID_COLS * GRID_ROWS;
