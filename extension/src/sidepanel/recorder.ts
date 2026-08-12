import type {
  FramePointer,
  MicState,
  PageEvent,
  PointerSample,
  RecordingFrame,
  RecordingMeta,
  TranscriptSegment,
} from '../lib/types';
import { COBALT } from '../lib/types';
import { blobs } from '../lib/db';
import { send } from '../lib/messages';
import { pad2, mmssFile } from '../lib/format';

/**
 * Screen capture, distilled while it records — claude-real-video's dedup shape
 * (sliding window of KEPT frames, forced keyframes only where the page said so:
 * clicks, navigations, and a 15 s heartbeat when the screen is
 * drifting below the dedup bar, uniform thinning past a length-scaled budget —
 * see `frameBudget`), recalibrated for
 * screen recordings. The reference compares 16×16 RGB
 * signatures by *percent* changed with an 8% bar — tuned for full-frame video.
 * On a screen recording the action usually lives in one region (a game canvas,
 * a terminal pane), and a 16×16 signature averages it into nothing: run against
 * a real capture, the original tool kept 1 frame of 22 and every reject scored
 * under 6%. So: 64×64 cells, and a frame is new when more than a handful of
 * cells changed — an absolute count, not a percent, because "how much of the
 * screen moved" is the wrong question when the answer is "one corner of it".
 * A-B-A cutaways still don't re-capture A, a static screen still adds nothing.
 * Speech is stamped where the sentence started, not where recognition finally
 * admitted what it heard.
 *
 * One thing the reference has no equivalent for, from an agent that read a real
 * bundle: frames carry the mouse (drawn when the capture can be mapped, named by
 * selector always — "these over here" is otherwise unresolvable).
 *
 * Nothing here lives only in panel memory. Every MediaRecorder chunk is written to
 * IndexedDB as it arrives and the meta is pushed to the worker every couple of
 * seconds, so a panel that dies mid-ramble loses the last second, not the take —
 * `recording:recover` reassembles the chunks into the video.
 */

const SAMPLE_MS = 500; // candidate cadence — stands in for the reference's scene-detect + 1s density floor
const SIG_SIZE = 64; // 64×64 RGB cells — fine enough that a sprite-sized change still flips whole cells
const PIX_TOL = 25; // a cell counts as changed if any channel moves more than this
const DEDUP_THRESHOLD = 8; // cells that must change for a frame to be new (~0.2% of 4096 — localized action counts)
const DEDUP_WINDOW = 4; // vs the last N KEPT frames — A-B-A cutaways don't come back
const BEAT_MS = 15000; // a minute of narration over a slowly-shifting screen must not produce zero frames
const CLICK_FORCE_MS = 1200; // floor between click-forced keyframes — a double-click is one moment
// The keyframe budget scales with how long the take ran, because a flat cap is
// wrong at both ends: a 90-second walkthrough never came near the old 150, while
// a twenty-minute one lost real detail to it. The floor keeps short takes exactly
// as generous as they were; the ceiling keeps a marathon take inside the per-gripe
// upload budget (a frame is ~200-400 KB at MAX_FRAME_W/JPEG_QUALITY).
const FRAMES_PER_MIN = 40;
const MIN_FRAME_BUDGET = 150;
const MAX_FRAME_BUDGET = 600;
const MAX_FRAME_W = 1920;
const JPEG_QUALITY = 0.9;
const MAX_EVENTS = 200;
const POINTER_STALE_MS = 2500; // a pointer older than this says nothing about this frame
const MAP_TOLERANCE = 0.02; // aspect-ratio match required before we believe a coordinate mapping
const PROGRESS_MS = 1500; // floor between meta pushes — the worker writes IndexedDB on every one

/** How many keyframes a take of this length may keep after dedup. Uniform thinning
 *  past this point, so survivors stay spread across the whole recording. */
export function frameBudget(durationMs: number): number {
  const byLength = Math.round((durationMs / 60000) * FRAMES_PER_MIN);
  return Math.min(MAX_FRAME_BUDGET, Math.max(MIN_FRAME_BUDGET, byLength));
}

const MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm'];

/**
 * Raw capture on purpose, for both the mic and the shared audio: Chrome's echo
 * cancellation / noise suppression / auto gain exist to isolate one voice on a
 * call, and they do it by shredding everything else — the app's sound, the
 * second voice across the desk, the room. A walkthrough wants all of that.
 * The trade: on speakers the app audio leaks into the mic slightly phased
 * (headphones keep the two clean), which is livable; narration vanishing under
 * noise suppression is not.
 */
const RAW_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
} as const;

/** Chrome's picker offers "share audio" on tab and screen surfaces; ask it to. */
type DisplayOptions = DisplayMediaStreamOptions & { systemAudio?: 'include' | 'exclude' };

/** MicState moved to lib/types — the content script speaks it too. */
export type { MicState };

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

export interface RecorderHandlers {
  onUpdate(update: RecorderUpdate): void;
  /** The user ended the screen share from Chrome's own UI. */
  onEnd(): void;
}

/**
 * The live ticker's callbacks — Web Speech, whose only job is the interim line in
 * the HUD and a rough set of lines the take can save with before Whisper lands.
 */
export interface TickerHandlers {
  onFinal(text: string): void;
  onInterim(text: string): void;
  onState(state: MicState, detail?: string): void;
}

export interface Ticker {
  start(): void;
  stop(): void;
}

/**
 * The dictation class, passed in rather than imported: `SpeechRecognition` lives
 * in the content script's module and the recorder must not reach across into it.
 * Omit it and the take simply saves with no live lines — Whisper still runs.
 */
export type TickerCtor = new (handlers: TickerHandlers, lang: string) => Ticker;

/**
 * Count of cells whose max channel delta exceeds PIX_TOL — the reference's
 * pct_diff, kept as a count.
 */
function cellDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const cells = SIG_SIZE * SIG_SIZE;
  let changed = 0;
  for (let i = 0; i < cells; i++) {
    const p = i * 4;
    const d = Math.max(
      Math.abs(a[p] - b[p]),
      Math.abs(a[p + 1] - b[p + 1]),
      Math.abs(a[p + 2] - b[p + 2]),
    );
    if (d > PIX_TOL) changed++;
  }
  return changed;
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('frame encode failed'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

/**
 * Where the pointer lands inside the captured frame, 0–1, or null when we can't
 * be sure. getDisplayMedia never says *what* it handed us, so the frame's shape
 * is the only evidence: a frame shaped like the screen is the screen (map from
 * `screenX/Y`), a frame shaped like the viewport is the tab (map from
 * `clientX/Y`). A window capture matches neither and a second monitor pushes
 * screen coordinates out of range — both draw nothing rather than draw a lie.
 * The selector still ships in the report either way.
 */
function mapPointer(p: PointerSample, w: number, h: number): { nx: number; ny: number } | null {
  if (!w || !h) return null;
  const aspect = w / h;
  const fits = (a: number) => Math.abs(aspect - a) / a;
  const options: { off: number; nx: number; ny: number }[] = [];
  if (p.sw && p.sh) options.push({ off: fits(p.sw / p.sh), nx: p.sx / p.sw, ny: p.sy / p.sh });
  if (p.vw && p.vh) options.push({ off: fits(p.vw / p.vh), nx: p.x / p.vw, ny: p.y / p.vh });
  const best = options.filter((o) => o.off <= MAP_TOLERANCE).sort((a, b) => a.off - b.off)[0];
  if (!best) return null;
  const out = [best.nx, best.ny];
  if (out.some((v) => v < -0.02 || v > 1.02)) return null;
  return { nx: Math.min(1, Math.max(0, best.nx)), ny: Math.min(1, Math.max(0, best.ny)) };
}

/** The mouse, drawn onto the keyframe. Dark pass first so it survives a white page too. */
function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  const r = Math.max(9, Math.round(width / 110));
  const arm = r * 2.2;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [color, lineWidth] of [['rgba(0,0,0,0.6)', r / 2], [COBALT, r / 4.5]] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.moveTo(x - arm, y);
    ctx.lineTo(x - r - 2, y);
    ctx.moveTo(x + r + 2, y);
    ctx.lineTo(x + arm, y);
    ctx.moveTo(x, y - arm);
    ctx.lineTo(x, y - r - 2);
    ctx.moveTo(x, y + r + 2);
    ctx.lineTo(x, y + arm);
    ctx.stroke();
  }
  ctx.restore();
}

export class Recorder {
  private stream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private recorder: MediaRecorder | null = null;
  private mime = 'video/webm';
  private chunks: Blob[] = [];
  /** Chunk blobs known to be on disk. Only bumped after the write lands, so a
   *  recovery never reads a key that isn't there yet. */
  private chunkCount = 0;
  private chunkSeq = 0;
  private lastProgress = 0;

  /** Mixes shared audio + mic into the one track the webm records. */
  private audioCtx: AudioContext | null = null;
  /** Mixer source nodes held as fields on purpose: an unreferenced node is GC
   *  bait, and a collected node drops out of the graph mid-take — silently. */
  private mixSources: MediaStreamAudioSourceNode[] = [];
  /** Level tap on the system source. 'silent' vs 'live' in the HUD is the only
   *  tell for a granted-but-dead loopback (sound reaching the ears through a
   *  device Chrome isn't capturing). */
  private sysTap: { analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null;
  private sysHeard = false;
  /**
   * The mic-only shadow recorder, running only when the take ALSO has system
   * audio: the webm's mixed track is what a human plays back, but Whisper must
   * hear narration alone or the transcript fills with the app's own sound.
   * Without system audio the video's track already is the mic, and this stays null.
   */
  private micRecorder: MediaRecorder | null = null;
  private micMime = 'audio/webm';
  private micChunks: Blob[] = [];
  private micChunkCount = 0;
  private micChunkSeq = 0;

  private dictation: Ticker | null = null;
  private micState: MicState = 'off';
  private interim = '';
  private utteranceStart: number | null = null;
  private segments: TranscriptSegment[] = [];
  private events: PageEvent[] = [];
  /** Events from tabs that aren't the one being recorded — counted, not kept. */
  private dropped = 0;
  private pointer: PointerSample | null = null;
  private frames: RecordingFrame[] = [];
  /** Something demanded the next sample be kept whatever dedup thinks, and what it was. */
  private forcedWhy: 'click' | 'nav' | null = null;
  private lastClickForce = 0;
  /** When the last kept frame landed, ms from start — the heartbeat measures from here. */
  private lastKeptT = 0;
  /** Signatures of the KEPT frames only — that ring *is* the dedup window. */
  private sigs: Uint8ClampedArray[] = [];
  private sampled = 0;
  private startedAt = 0;

  private sigCtx: CanvasRenderingContext2D | null = null;
  private frameCtx: CanvasRenderingContext2D | null = null;

  private sampleTimer: number | null = null;
  private tickTimer: number | null = null;
  private sampling = false;
  private pending: Promise<void> = Promise.resolve();
  private stopped: Promise<RecordingMeta> | null = null;

  constructor(
    private handlers: RecorderHandlers,
    private lang: string,
    /** Origin of the tab that was in front at Record. Telemetry from anywhere else is noise. */
    readonly scope: string,
    /** The take's id, minted by the panel so `recording:start` and every blob key agree. */
    readonly id: string,
    /** The live dictation class. Absent = frames and Whisper only, no interim line. */
    private ticker: TickerCtor | null = null,
  ) {}

  // ── lifecycle ───────────────────────────────────────────────────────────

  async start() {
    // Audio too: the sound the app makes (what's in the narrator's headphones)
    // belongs in the take. Chrome only grants it when the picker's "share audio"
    // box is ticked on a tab or full-screen surface — a window share has no box —
    // so its absence is a normal outcome, surfaced in the HUD, never an error.
    const displayOptions: DisplayOptions = {
      video: { frameRate: { ideal: 10 } },
      audio: { ...RAW_AUDIO },
      systemAudio: 'include',
    };
    const stream = await navigator.mediaDevices.getDisplayMedia(displayOptions);
    this.stream = stream;
    this.startedAt = Date.now();
    // Hold the first push off by one throttle window: the panel only sends
    // `recording:start` once this resolves, and progress for a take the worker
    // hasn't opened yet is dropped on the floor.
    this.lastProgress = this.startedAt;

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.style.cssText = 'position:fixed; left:-9999px; top:0; width:4px;';
    document.body.appendChild(video);
    video.srcObject = stream;
    await video.play();
    this.video = video;

    const sig = document.createElement('canvas');
    sig.width = SIG_SIZE;
    sig.height = SIG_SIZE;
    this.sigCtx = sig.getContext('2d', { willReadFrequently: true });
    this.frameCtx = document.createElement('canvas').getContext('2d');
    if (this.frameCtx) this.frameCtx.imageSmoothingQuality = 'high';

    // The mic is grabbed for real, not as a throwaway probe: its track is mixed
    // into the webm so the raw video carries the narration, and acquiring it
    // here is also the only chance SpeechRecognition gets at a permission
    // prompt from an extension page. Raw constraints — see RAW_AUDIO — so the
    // room survives: the second voice, the notification chime, the thing the
    // narrator is reacting to.
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { ...RAW_AUDIO } });
    } catch {
      this.micState = 'denied';
    }

    this.mime = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'video/webm';
    const recorded = new MediaStream([...stream.getVideoTracks(), ...this.mixAudio()]);
    const recorder = new MediaRecorder(recorded, { mimeType: this.mime });
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      this.chunks.push(e.data);
      // Also to disk: in memory these die with the panel, and a webm assembled
      // from chunk 1..n is playable even when nobody ever called stop().
      const n = ++this.chunkSeq;
      void blobs
        .set(`${this.id}:chunk:${n}`, e.data)
        .then(() => {
          if (n > this.chunkCount) this.chunkCount = n;
        })
        .catch(() => {});
    };
    recorder.start(1000);
    this.recorder = recorder;
    this.startMicShadow();

    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.handlers.onEnd());
    if (this.micState !== 'denied' && this.ticker) {
      this.dictation = new this.ticker(
        {
          onInterim: (text) => {
            if (text && this.utteranceStart === null) this.utteranceStart = this.elapsed();
            this.interim = text;
            this.emit();
          },
          onFinal: (text) => {
            if (text) this.segments.push({ t: this.utteranceStart ?? this.elapsed(), text });
            this.utteranceStart = null;
            this.emit();
            this.saveProgress();
          },
          onState: (state) => {
            this.micState = state;
            this.emit();
          },
        },
        this.lang,
      );
      this.dictation.start();
    }

    this.sampleTimer = window.setInterval(() => {
      // Only replace `pending` when a sample actually starts — a tick that
      // no-ops against an in-flight sample must not mask the real promise,
      // or finish() would thin/renumber while that sample is still writing.
      if (!this.sampling) this.pending = this.sample();
    }, SAMPLE_MS);
    this.tickTimer = window.setInterval(() => {
      this.pollAudio();
      this.emit();
      this.saveProgress();
    }, 1000);
    this.pending = this.sample();
  }

  stop(): Promise<RecordingMeta> {
    if (!this.stopped) this.stopped = this.finish();
    return this.stopped;
  }

  /** Whether the share came with an audio track — decided at start, never changes. */
  get hasSystemAudio(): boolean {
    return (this.stream?.getAudioTracks().length ?? 0) > 0;
  }

  /** What the HUD shows for app audio — see RecorderUpdate.sysAudio. */
  get sysState(): 'none' | 'silent' | 'live' {
    if (!this.hasSystemAudio) return 'none';
    return this.sysHeard ? 'live' : 'silent';
  }

  /**
   * One audio track for the webm, whatever arrived: every source mixed through
   * Web Audio (MediaRecorder records ONE audio track; handing it two silently
   * drops the second), each tapped by an analyser so silence is a fact the HUD
   * can state instead of a surprise at playback. A mixer failure falls back to
   * the raw mic — narration over silence beats app sound over a missing voice.
   */
  private mixAudio(): MediaStreamTrack[] {
    const sys = this.stream?.getAudioTracks() ?? [];
    const mic = this.micStream?.getAudioTracks() ?? [];
    if (!sys.length && !mic.length) return [];
    try {
      const ctx = new AudioContext();
      this.audioCtx = ctx;
      const dest = ctx.createMediaStreamDestination();
      for (const track of [...sys, ...mic]) {
        const source = ctx.createMediaStreamSource(new MediaStream([track]));
        source.connect(dest);
        this.mixSources.push(source);
        if (track === sys[0]) {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
          this.sysTap = { analyser, buf: new Float32Array(analyser.fftSize) };
        }
      }
      // Extension pages are exempt from the autoplay policy, but a suspended
      // graph records silence — resume just in case.
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      return dest.stream.getAudioTracks();
    } catch {
      this.mixSources = [];
      this.sysTap = null;
      return mic;
    }
  }

  /** Latches sysHeard the first time the loopback carries real signal. */
  private pollAudio() {
    const tap = this.sysTap;
    if (!tap || this.sysHeard) return;
    tap.analyser.getFloatTimeDomainData(tap.buf);
    for (let i = 0; i < tap.buf.length; i++) {
      if (Math.abs(tap.buf[i]) > 0.001) {
        this.sysHeard = true;
        return;
      }
    }
  }

  /** The mic-only shadow, persisted exactly the way the video's chunks are. */
  private startMicShadow() {
    const mic = this.micStream;
    if (!mic || !this.hasSystemAudio || !mic.getAudioTracks().length) return;
    this.micMime =
      AUDIO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'audio/webm';
    try {
      const shadow = new MediaRecorder(new MediaStream(mic.getAudioTracks()), {
        mimeType: this.micMime,
      });
      shadow.ondataavailable = (e) => {
        if (!e.data.size) return;
        this.micChunks.push(e.data);
        const n = ++this.micChunkSeq;
        void blobs
          .set(`${this.id}:micchunk:${n}`, e.data)
          .then(() => {
            if (n > this.micChunkCount) this.micChunkCount = n;
          })
          .catch(() => {});
      };
      shadow.start(1000);
      this.micRecorder = shadow;
    } catch {
      // No shadow: transcription decodes the mixed webm instead. Words over app
      // sound is a degraded transcript, not a lost take.
      this.micRecorder = null;
    }
  }

  addEvent(event: PageEvent, origin?: string) {
    if (!this.inScope(origin)) {
      this.dropped++;
      return;
    }
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  addPointer(sample: PointerSample, origin?: string) {
    if (this.inScope(origin)) this.pointer = sample;
  }

  /**
   * The page said something happened — a click (a finished ink stroke counts as
   * one), or a route change. Keep the next sample whatever dedup thinks. Clicks
   * are rate-limited: a walkthrough is mostly clicking.
   */
  force(why: 'click' | 'nav', origin?: string) {
    if (!this.stream) return;
    if (!this.inScope(origin)) return;
    if (why === 'click') {
      const now = Date.now();
      if (now - this.lastClickForce < CLICK_FORCE_MS) return;
      this.lastClickForce = now;
    }
    this.forcedWhy = why;
    if (!this.sampling) this.pending = this.sample();
  }

  /** No scope (a chrome:// tab was in front) keeps everything — better noisy than empty. */
  private inScope(origin?: string): boolean {
    return !this.scope || !origin || origin === this.scope;
  }

  // ── sampling ────────────────────────────────────────────────────────────

  private async sample() {
    const video = this.video;
    const sigCtx = this.sigCtx;
    const frameCtx = this.frameCtx;
    if (this.sampling || !video || !sigCtx || !frameCtx) return;
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    this.sampling = true;
    const forced = this.forcedWhy;
    this.forcedWhy = null;
    try {
      this.sampled++;
      sigCtx.drawImage(video, 0, 0, SIG_SIZE, SIG_SIZE);
      const sig = sigCtx.getImageData(0, 0, SIG_SIZE, SIG_SIZE).data;

      const t = this.elapsed();
      const minDist = this.sigs.length
        ? Math.min(...this.sigs.map((k) => cellDiff(sig, k)))
        : undefined;
      let reason: RecordingFrame['reason'];
      if (forced) {
        // A click or a nav that changed literally nothing is a duplicate, and a
        // duplicate spends one of the slots the whole walkthrough shares.
        if (minDist !== undefined && minDist === 0) return;
        reason = forced;
      } else if (minDist === undefined) {
        reason = 'start';
      } else if (minDist <= DEDUP_THRESHOLD) {
        // Below the bar, but the screen *is* moving and nothing has been kept in
        // a while — a drifting low-contrast UI would otherwise go dark for minutes.
        if (!(minDist > 0 && t - this.lastKeptT > BEAT_MS)) return;
        reason = 'beat';
      } else {
        reason = 'change';
      }
      const dist = minDist; // changed-cell count vs the closest kept frame

      const width = Math.min(video.videoWidth, MAX_FRAME_W);
      const height = Math.round((video.videoHeight * width) / video.videoWidth);
      const canvas = frameCtx.canvas;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        frameCtx.imageSmoothingQuality = 'high';
      }
      frameCtx.drawImage(video, 0, 0, width, height);
      const pointer = this.pointerNow(width, height);
      if (pointer?.nx !== undefined && pointer.ny !== undefined) {
        drawCrosshair(frameCtx, pointer.nx * width, pointer.ny * height, width);
      }

      const index = this.frames.length + 1;
      await blobs.set(`${this.id}:frame:${index}`, await toJpeg(canvas));
      this.frames.push({
        index,
        t,
        file: `frames/${pad2(index)}-${mmssFile(t)}.jpg`,
        reason,
        ...(dist === undefined ? {} : { dist }),
        ...(pointer ? { pointer } : {}),
      });
      this.lastKeptT = t;
      this.sigs.push(sig);
      if (this.sigs.length > DEDUP_WINDOW) this.sigs.shift();
      this.emit();
      this.saveProgress();
    } finally {
      this.sampling = false;
    }
  }

  /** The pointer as it applies to the frame being written, while it's fresh enough to mean anything. */
  private pointerNow(width: number, height: number): FramePointer | undefined {
    const p = this.pointer;
    if (p && Date.now() - p.ts <= POINTER_STALE_MS) {
      const mapped = mapPointer(p, width, height);
      if (mapped || p.selector) return { ...(mapped ?? {}), selector: p.selector, text: p.text };
    }
    return undefined;
  }

  // ── persistence ─────────────────────────────────────────────────────────

  /**
   * The meta as it stands right now — the same object `finish()` returns, minus
   * the thinning pass. The worker overwrites the take's meta wholesale with it,
   * so a panel that dies still leaves a readable take behind.
   */
  private snapshot(): RecordingMeta {
    return {
      startedAt: this.startedAt,
      durationMs: this.elapsed(),
      sampled: this.sampled,
      frames: this.frames,
      transcript: this.segments,
      events: this.events,
      ...(this.scope ? { eventScope: this.scope } : {}),
      ...(this.dropped ? { droppedEvents: this.dropped } : {}),
      videoFile: 'walkthrough.webm',
    };
  }

  /** Throttled: this is a write to IndexedDB, not a render. */
  private saveProgress() {
    if (this.stopped) return;
    const now = Date.now();
    if (now - this.lastProgress < PROGRESS_MS) return;
    this.lastProgress = now;
    void send({
      type: 'recording:progress',
      id: this.id,
      meta: this.snapshot(),
      mime: this.mime,
      chunks: this.chunkCount,
      micChunks: this.micChunkCount,
      micMime: this.micMime,
    }).catch(() => {});
  }

  // ── teardown ────────────────────────────────────────────────────────────

  /**
   * Give up the take without producing one: the screen share was granted but
   * `recording:start` never landed, so there is nothing for these bytes to
   * belong to. Tracks first — a share left running is the visible failure.
   */
  async cancel() {
    this.stopped = Promise.reject(new Error('cancelled'));
    this.stopped.catch(() => {});
    this.teardown();
    const frames = this.frames.map((f) => blobs.delete(`${this.id}:frame:${f.index}`));
    const chunks = Array.from({ length: this.chunkSeq }, (_, i) =>
      blobs.delete(`${this.id}:chunk:${i + 1}`),
    );
    const micChunks = Array.from({ length: this.micChunkSeq }, (_, i) =>
      blobs.delete(`${this.id}:micchunk:${i + 1}`),
    );
    await Promise.all([...frames, ...chunks, ...micChunks]).catch(() => {});
  }

  /** Timers, dictation, streams, the offscreen video element. Safe to call twice. */
  private teardown() {
    if (this.sampleTimer !== null) clearInterval(this.sampleTimer);
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.sampleTimer = null;
    this.tickTimer = null;
    this.dictation?.stop();
    this.dictation = null;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
    if (this.micRecorder && this.micRecorder.state !== 'inactive') this.micRecorder.stop();
    this.micRecorder = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.micStream?.getTracks().forEach((track) => track.stop());
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.mixSources = [];
    this.sysTap = null;
    this.video?.remove();
    this.stream = null;
    this.micStream = null;
    this.video = null;
  }

  private async finish(): Promise<RecordingMeta> {
    if (this.sampleTimer !== null) clearInterval(this.sampleTimer);
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.sampleTimer = null;
    this.tickTimer = null;
    this.dictation?.stop();
    this.dictation = null;

    await this.pending;
    await this.sample(); // the last screen state gets its fair shot through dedup, nothing more

    const allowed = frameBudget(this.elapsed());
    if (this.frames.length > allowed) {
      // A uniform thin: survivors stay spread across the whole take, so nothing
      // is protected from it and nothing gets a run of neighbours it doesn't earn.
      const keepIdx = new Set<number>();
      const step = this.frames.length / allowed;
      for (let i = 0; i < allowed; i++) keepIdx.add(Math.floor(i * step));
      const survivors = this.frames.filter((_, i) => keepIdx.has(i));
      const dropped = this.frames.filter((_, i) => !keepIdx.has(i));
      await Promise.all(dropped.map((f) => blobs.delete(`${this.id}:frame:${f.index}`)));
      // Renumber ascending: a survivor's new index is always ≤ its old one, and the
      // slot it moves into has already been vacated — never re-key out of order.
      for (let n = 0; n < survivors.length; n++) {
        const f = survivors[n];
        const newIndex = n + 1;
        if (newIndex !== f.index) {
          const blob = await blobs.get(`${this.id}:frame:${f.index}`);
          if (blob) await blobs.set(`${this.id}:frame:${newIndex}`, blob);
          await blobs.delete(`${this.id}:frame:${f.index}`);
          f.index = newIndex;
          f.file = `frames/${pad2(newIndex)}-${mmssFile(f.t)}.jpg`; // t survives — citations stay valid
        }
      }
      this.frames = survivors;
    }

    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }
    this.recorder = null;
    const micRecorder = this.micRecorder;
    if (micRecorder && micRecorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        micRecorder.onstop = () => resolve();
        micRecorder.stop();
      });
    }
    this.micRecorder = null;
    await blobs.set(`${this.id}:video`, new Blob(this.chunks, { type: this.mime }));
    if (this.micChunks.length) {
      await blobs.set(`${this.id}:mic`, new Blob(this.micChunks, { type: this.micMime }));
    }
    // The whole video is on disk now, so the pieces it was insurance against go.
    // Only after the write — a crash between the two must still be recoverable.
    for (let n = 1; n <= this.chunkSeq; n++) await blobs.delete(`${this.id}:chunk:${n}`);
    for (let n = 1; n <= this.micChunkSeq; n++) await blobs.delete(`${this.id}:micchunk:${n}`);

    this.stream?.getTracks().forEach((track) => track.stop());
    this.micStream?.getTracks().forEach((track) => track.stop());
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.mixSources = [];
    this.sysTap = null;
    this.video?.remove();
    this.stream = null;
    this.micStream = null;
    this.video = null;

    return this.snapshot();
  }

  // ── plumbing ────────────────────────────────────────────────────────────

  private elapsed() {
    return Date.now() - this.startedAt;
  }

  private emit() {
    this.handlers.onUpdate({
      elapsedMs: this.elapsed(),
      frameCount: this.frames.length,
      segmentCount: this.segments.length,
      interim: this.interim,
      micState: this.micState,
      sysAudio: this.sysState,
    });
  }
}
