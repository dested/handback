import { LIVE_STEP_MS, LiveFrames, type FrameBox } from '@dested/video-to-prompt';
import type {
  FramePointer,
  MicState,
  PageEvent,
  PanelGeometry,
  PointerSample,
  RecorderUpdate,
  RecordingMeta,
  TranscriptSegment,
} from '../lib/types';
import { COBALT } from '../lib/types';
import { blobs } from '../lib/db';
import { send } from '../lib/messages';
import { panelCrop } from './crop';
import { PointerRing, pointerOnFrame } from './pointer';
import { rmsOf, VoiceGate } from './voice';

/**
 * Screen capture, distilled while it records. Which frames a take keeps is
 * @dested/video-to-prompt's rule (`LiveFrames`, plans/2026-10-22-live-capture.md): the
 * extractor's Selector run online over the share every LIVE_STEP_MS, so a take
 * recorded here keeps the frames a finished clip of the same screen would —
 * change boxes, close-ups of a region that changed, a page model for scrolling,
 * a picture for every spoken line, no cap. This file feeds it: the share's
 * `<video>`, speech edges from a level detector on the mic (`voice.ts`), the
 * crop that cuts the recorder's own panel out of a window share (`crop.ts`),
 * and the pointer, drawn on each whole-screen keyframe as it was at that
 * frame's own time (`pointer.ts`). Clicks and navigations no longer force a
 * frame — the rule keeps what a click changed — they are noted on the timeline
 * as `info` events instead.
 *
 * One thing the extractor has no equivalent for, from an agent that read a real
 * bundle: frames carry the mouse (drawn when the capture can be mapped, named by
 * selector always — "these over here" is otherwise unresolvable).
 *
 * Nothing here lives only in memory. Every MediaRecorder chunk is written to
 * IndexedDB as it arrives, every kept JPEG as it is encoded (under the rule's
 * pick key — frame numbers shift while recording), and the meta is pushed to the
 * worker every couple of seconds, so a document that dies mid-ramble loses the
 * last second, not the take — `recording:recover` reassembles the chunks.
 */

const VOICE_MS = 50; // mic level reading cadence — the analyser window is ~43 ms at 48 kHz
const MAX_EVENTS = 200; // console/network lines kept per take
const MAX_NOTES = 300; // click/nav notes kept per take — their own budget, so clicking never evicts an error
const CLICK_NOTE_MS = 1200; // floor between click notes — a double-click is one moment
const PROGRESS_MS = 1500; // floor between meta pushes — the worker writes IndexedDB on every one

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

/** One analyser on one audio source. */
interface Tap {
  analyser: AnalyserNode;
  /** Pinned to a plain ArrayBuffer: `getFloatTimeDomainData` refuses a view
   *  that might be backed by a SharedArrayBuffer. */
  buf: Float32Array<ArrayBuffer>;
}

/** The mouse, drawn onto the keyframe. Dark pass first so it survives a white page too. */
function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  const r = Math.max(9, Math.round(width / 110));
  const arm = r * 2.2;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [color, lineWidth] of [
    ['rgba(0,0,0,0.6)', r / 2],
    [COBALT, r / 4.5],
  ] as const) {
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
  private sysTap: Tap | null = null;
  private sysHeard = false;
  /** Level tap on the mic, read every VOICE_MS for the speech edges. */
  private micTap: Tap | null = null;
  private readonly voice = new VoiceGate();
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
  private readonly pointers = new PointerRing();
  private lastClickNote = 0;
  /** The frame rule. Null on a pristine take, which keeps no frames. */
  private live: LiveFrames | null = null;
  /** Pick keys whose JPEG is on disk (`<id>:frame:<key>`). */
  private readonly stored = new Set<number>();
  /** The part of the share the frames show — the panel cut out of a window share. */
  private crop: FrameBox | undefined;
  private startedAt = 0;

  private sampleTimer: number | null = null;
  private tickTimer: number | null = null;
  private voiceTimer: number | null = null;
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
    /**
     * Pristine capture, for a human handback: the video IS the deliverable, so
     * ask for 30 fps instead of 10, pin the encoder bitrate to the surface area
     * instead of Chrome's throwaway default, and never sample a keyframe —
     * there is no distill, and the sampling loop would only steal CPU from the
     * encode. Everything else (mix, mic shadow, chunk persistence, recovery) is
     * identical. Mirrors `src/lib/capture/live.ts`'s flag of the same name;
     * change one and change the other.
     */
    private readonly pristine = false,
    /** The side panel's size and its window's, when Record was pressed there — see crop.ts. */
    private readonly panel?: PanelGeometry,
  ) {}

  // ── lifecycle ───────────────────────────────────────────────────────────

  async start() {
    // Audio too: the sound the app makes (what's in the narrator's headphones)
    // belongs in the take. Chrome only grants it when the picker's "share audio"
    // box is ticked on a tab or full-screen surface — a window share has no box —
    // so its absence is a normal outcome, surfaced in the HUD, never an error.
    // getDisplayMedia runs HERE, in the offscreen document: Chrome allows it
    // there without a user gesture (the DISPLAY_MEDIA reason is what it's for),
    // whereas a chrome.desktopCapture stream id picked by the panel cannot be
    // consumed from another document — Chrome aborts with "Error starting tab
    // capture" (Screenity hit the same wall). Don't move the picker back.
    const displayOptions: DisplayOptions = {
      video: { frameRate: { ideal: this.pristine ? 30 : 10 } },
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

    if (!this.pristine) {
      const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
      this.crop = panelCrop(surface, video.videoWidth, video.videoHeight, this.panel);
      this.live = new LiveFrames({
        // Under the pick's key, not its index: the index can shift until the take ends.
        store: async (key, jpeg) => {
          await blobs.set(`${this.id}:frame:${key}`, jpeg);
          this.stored.add(key);
        },
        ...(this.crop ? { crop: this.crop } : {}),
        decorate: (ctx, t, width, height) => this.drawPointer(ctx, t, width, height),
      });
    }

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
    // Pristine: ~2 bits per pixel per second of captured area — 1080p ≈ 4 Mbps,
    // 1440p ≈ 7 Mbps — clamped [3,8] Mbps so a 4K share doesn't fill the disk.
    // Non-pristine (a distill source, read once for keyframes and never watched)
    // is capped at 1 Mbps instead of Chrome's default. Throttled 2026-08-12 to
    // cut storage + egress; mirror any change in src/lib/capture/live.ts.
    const bitrate = this.pristine
      ? Math.round(Math.min(8e6, Math.max(3e6, video.videoWidth * video.videoHeight * 2)))
      : 1_000_000;
    const recorder = new MediaRecorder(recorded, {
      mimeType: this.mime,
      videoBitsPerSecond: bitrate,
    });
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

    if (this.live) {
      this.sampleTimer = window.setInterval(() => {
        // Only replace `pending` when a sample actually starts — a tick that
        // no-ops against an in-flight sample must not mask the real promise,
        // or finish() would run the rule's last step while this one is writing.
        if (!this.sampling) this.pending = this.sample();
      }, LIVE_STEP_MS);
      // No mic, no tap: no lines, and the rule still keeps changes and beats.
      if (this.micTap) this.voiceTimer = window.setInterval(() => this.listen(), VOICE_MS);
    }
    this.tickTimer = window.setInterval(() => {
      this.pollAudio();
      this.emit();
      this.saveProgress();
    }, 1000);
    if (this.live) this.pending = this.sample();
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
      const tap = (source: MediaStreamAudioSourceNode): Tap => {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        return { analyser, buf: new Float32Array(analyser.fftSize) };
      };
      for (const track of [...sys, ...mic]) {
        const source = ctx.createMediaStreamSource(new MediaStream([track]));
        source.connect(dest);
        this.mixSources.push(source);
        if (track === sys[0]) this.sysTap = tap(source);
        if (track === mic[0]) this.micTap = tap(source);
      }
      // Extension pages are exempt from the autoplay policy, but a suspended
      // graph records silence — resume just in case.
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      return dest.stream.getAudioTracks();
    } catch {
      // The raw mic still records; without a graph there is no level to read,
      // so this take keeps changes and beats but opens no lines.
      this.mixSources = [];
      this.sysTap = null;
      this.micTap = null;
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
    this.keep(event);
  }

  addPointer(sample: PointerSample, origin?: string) {
    if (this.inScope(origin)) this.pointers.push(sample);
  }

  /**
   * The page said something happened — a click (a finished ink stroke counts as
   * one), or a route change. It used to force a keyframe; now the rule keeps
   * whatever the click changed, and a click that changed nothing is evidence for
   * the timeline, not a picture. So it is noted there, as an `info` line. Clicks
   * are rate-limited: a walkthrough is mostly clicking.
   */
  note(why: 'click' | 'nav', detail: string | undefined, origin?: string) {
    if (!this.stream) return;
    // A pristine take is the video itself; nothing reads its timeline.
    if (this.pristine) return;
    if (!this.inScope(origin)) return;
    const now = Date.now();
    if (why === 'click') {
      if (now - this.lastClickNote < CLICK_NOTE_MS) return;
      this.lastClickNote = now;
    }
    this.keep({ level: 'info', message: detail ? `${why}: ${detail}` : why, ts: now });
  }

  /** Errors and notes each have their own budget: a busy walkthrough's clicks never push out an error. */
  private keep(event: PageEvent) {
    this.events.push(event);
    const isNote = event.level === 'info';
    const count = this.events.filter((e) => (e.level === 'info') === isNote).length;
    if (count <= (isNote ? MAX_NOTES : MAX_EVENTS)) return;
    const oldest = this.events.findIndex((e) => (e.level === 'info') === isNote);
    if (oldest >= 0) this.events.splice(oldest, 1);
  }

  /** No scope (a chrome:// tab was in front) keeps everything — better noisy than empty. */
  private inScope(origin?: string): boolean {
    return !this.scope || !origin || origin === this.scope;
  }

  // ── sampling ────────────────────────────────────────────────────────────

  /** One step of the frame rule. A frame that fails to encode or store is a missing frame, not a dead take. */
  private async sample() {
    const live = this.live;
    const video = this.video;
    if (this.sampling || !live || !video) return;
    this.sampling = true;
    const before = this.stored.size;
    try {
      await live.push(this.elapsed(), video);
    } catch {
      /* the next step reads the screen again */
    } finally {
      this.sampling = false;
    }
    if (this.stored.size !== before) {
      this.emit();
      this.saveProgress();
    }
  }

  /** One mic reading; speech starting or stopping opens or closes the rule's line. */
  private listen() {
    const tap = this.micTap;
    const live = this.live;
    if (!tap || !live) return;
    tap.analyser.getFloatTimeDomainData(tap.buf);
    const edge = this.voice.push(this.elapsed(), rmsOf(tap.buf));
    if (edge?.kind === 'open') live.openLine(edge.t);
    else if (edge?.kind === 'close') live.closeLine(edge.t);
  }

  /**
   * The rule's `decorate`: the pointer as it was at `t` (the keyframe's own time,
   * which for a held candidate is earlier than now), drawn when it can be mapped
   * and named either way. Close-ups never get here — the library skips them.
   */
  private drawPointer(
    ctx: CanvasRenderingContext2D,
    t: number,
    width: number,
    height: number,
  ): FramePointer | undefined {
    const sample = this.pointers.at(this.startedAt + t);
    if (!sample) return undefined;
    const pointer = pointerOnFrame(sample, width, height, this.crop);
    if (pointer?.nx !== undefined && pointer.ny !== undefined) {
      drawCrosshair(ctx, pointer.nx * width, pointer.ny * height, width);
    }
    return pointer;
  }

  // ── persistence ─────────────────────────────────────────────────────────

  /**
   * The meta as it stands right now — the same object `finish()` returns. The
   * worker overwrites the take's meta wholesale with it, so a document that dies
   * still leaves a readable take behind: each frame names its own JPEG by key,
   * so a snapshot's numbering never has to agree with the next one's.
   */
  private snapshot(): RecordingMeta {
    const live = this.live;
    return {
      startedAt: this.startedAt,
      durationMs: this.elapsed(),
      sampled: live?.sampled ?? 0,
      frames: (live?.frames() ?? []).map(({ frame, key }) => ({ ...frame, blobKey: key })),
      ...(live ? { sampling: live.sampling } : {}),
      ...(this.crop ? { crop: this.crop } : {}),
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
    // A step still writing would land its JPEG after the sweep.
    await this.pending.catch(() => {});
    const frames = [...this.stored].map((key) => blobs.delete(`${this.id}:frame:${key}`));
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
    this.clearTimers();
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
    this.micTap = null;
    this.video?.remove();
    this.stream = null;
    this.micStream = null;
    this.video = null;
  }

  private clearTimers() {
    for (const timer of [this.sampleTimer, this.tickTimer, this.voiceTimer]) {
      if (timer !== null) clearInterval(timer);
    }
    this.sampleTimer = null;
    this.tickTimer = null;
    this.voiceTimer = null;
  }

  private async finish(): Promise<RecordingMeta> {
    this.clearTimers();
    this.dictation?.stop();
    this.dictation = null;

    await this.pending.catch(() => {});
    // The rule's last word, while the share still shows the final screen: a line
    // still being spoken closes here, and the end state gets its frame.
    const live = this.live;
    if (live) {
      const t = this.elapsed();
      const edge = this.voice.finish(t);
      if (edge) live.closeLine(edge.t);
      await live.finish(t, this.video).catch(() => {});
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
    this.micTap = null;
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
      frameCount: this.stored.size,
      segmentCount: this.segments.length,
      interim: this.interim,
      micState: this.micState,
      sysAudio: this.sysState,
    });
  }
}
