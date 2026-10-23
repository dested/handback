import type {
  RecordingFrame as LibRecordingFrame,
  RecordingMeta as LibRecordingMeta,
} from '@dested/video-to-prompt';

/**
 * A gripe is a narrated screen recording, taken in one or more sittings, and
 * everything here describes one: the takes, what was said over them, the frames
 * that survived dedup, and what the page complained about while it was running.
 *
 * The recording shapes are @dested/video-to-prompt's (since Recorder 1.12.0): the
 * library builds the report, recording.json and the sheets from them, and the
 * Handback cloud viewer and report reader consume exactly those fields.
 */

export type { PageEvent, TranscriptSegment } from '@dested/video-to-prompt';

/**
 * Which engine wrote the transcript that shipped. `groq` is the server's
 * hosted pass (fast, audio leaves the machine); `whisper` is the on-device
 * fallback — same model family, minutes instead of seconds, nothing uploaded.
 * The report cites this, so it is a fact about the recording, not a setting.
 * (The recording shape itself takes any engine id — see the library's.)
 */
export type TranscriberId = 'whisper' | 'groq';

/** How far the post-recording transcription pass has got, stage and a 0–100 pct (−1 = indeterminate). */
export interface TranscribeProgress {
  stage: 'decode' | 'upload' | 'download' | 'model' | 'transcribe' | 'polish';
  pct: number;
}

/** The offscreen transcription queue as the panel sees it. `queue[0]` is the take being transcribed; `progress` is its stage, null before the first tick. */
export interface TranscribeState {
  queue: string[];
  progress: TranscribeProgress | null;
}

/** The live dictation engine's state, as the panel reports it. */
export type MicState = 'listening' | 'off' | 'denied' | 'error';

/**
 * The recorder's live readout, emitted on every tick. It lives in lib/types
 * rather than the recorder module because both sides of the wire speak it: the
 * offscreen document (which owns the recorder) fills it, and the side panel
 * renders it — the recorder now runs where the panel can't reach it directly.
 */
export interface RecorderUpdate {
  elapsedMs: number;
  frameCount: number;
  segmentCount: number;
  interim: string;
  micState: MicState;
  /**
   * App/system audio: 'none' = the share came without a track (checkbox missed,
   * or a window was picked), 'silent' = a track exists but nothing has been
   * heard on it yet, 'live' = real signal has landed. 'silent' minutes into a
   * take with sound playing means the loopback is dead — the sound is reaching
   * the ears but not Chrome (wrong default output device, virtual audio driver).
   */
  sysAudio: 'none' | 'silent' | 'live';
}

/** What the side panel reports about itself at Record, for cutting it out of a window share (offscreen/crop.ts). CSS px. */
export interface PanelGeometry {
  /** The panel's `innerWidth`. */
  width: number;
  /** The Chrome window holding it, outer size. */
  windowWidth: number;
  windowHeight: number;
}

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

export type { FramePointer } from '@dested/video-to-prompt';

/**
 * One keyframe as this recorder stores it: the library's frame (format 2 —
 * change boxes, close-ups, `seen` spans) plus where its JPEG is. `LiveFrames`
 * renumbers frames while a take records (a spoken line's frame lands before
 * frames kept after it), so the JPEG lives at `<id>:frame:<blobKey>`, never at
 * the index. Takes recorded before Recorder 1.12.0 have no `blobKey`: their JPEG is at
 * the index — read it through `frameBlobKey()` (lib/db.ts).
 */
export interface RecordingFrame extends LibRecordingFrame {
  blobKey?: number;
}

/** The library's take meta, its frames carrying their blob keys. */
export interface RecordingMeta extends Omit<LibRecordingMeta, 'frames'> {
  frames: RecordingFrame[];
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

/** How far one outbox upload has got — mirrors upload.ts's UploadProgress. */
export interface OutboxProgress {
  phase: 'declare' | 'upload' | 'finalize';
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
}

/**
 * One walkthrough queued for upload. "send to Handback" writes one of these and
 * returns; the offscreen document drains the queue oldest-first, so a slow push
 * never holds the panel hostage. The `target` is snapshotted at enqueue time —
 * the human may re-link or switch spaces while a big video is still going up.
 */
export interface OutboxEntry {
  id: string;
  sessionId: string;
  /** session.name at enqueue time — the session may be renamed or discarded mid-flight. */
  title: string;
  createdAt: number;
  state: 'queued' | 'uploading' | 'done' | 'failed';
  /** uploading only — the drain is holding for this session's transcripts before it bundles. */
  waiting?: 'transcript';
  /** failed only — the raw pushGripe message, for explainUpload to turn into a sentence. */
  error?: string;
  /** Live while uploading. */
  progress?: OutboxProgress;
  /** done only — the walkthrough's page in the workspace. */
  url?: string;
  /** done only, agent kind — the agentPrompt naming the URL, for the copy button. */
  brief?: string;
  /** Keyframes whose blob had gone missing at bundle time. */
  missing?: number;
  /** Snapshot of where it uploads — settings may change while it's in flight. */
  target: { serverUrl: string; apiToken: string };
  projectId?: string;
  teamId?: string;
  kind: SessionKind;
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
