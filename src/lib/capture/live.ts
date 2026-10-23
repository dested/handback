import { LIVE_STEP_MS, LiveFrames } from '@dested/video-to-prompt'
import { blobs, putTake, type LiveTake } from './live-store'
import { rmsOf, VoiceGate } from './voice'

/**
 * Screen capture in a plain tab — the extension's `Recorder`
 * (`extension/src/offscreen/recorder.ts`) with the half a web page can't have
 * taken out, and nothing else changed.
 *
 * What is identical, because it is all plain web platform: the picker call and
 * its constraints, the frame rule (@dested/video-to-prompt's `LiveFrames`, the
 * extractor's Selector run online over the share every LIVE_STEP_MS, so a take
 * keeps what a finished clip of the same screen would — change boxes, close-ups,
 * a picture per spoken line, no cap), the speech edges that rule hears from a
 * level detector on the mic (`voice.ts`), the Web Audio mix of app audio with a
 * raw mic, the mic-only shadow recorder that transcription hears instead of that
 * mix, and chunk-by-chunk persistence so a dead tab loses the last second rather
 * than the take.
 *
 * What is gone, because it arrived from `extension/src/content/*` injected into
 * the recorded page — which no page can do to another origin: console and
 * network events, pointer telemetry and the crosshair drawn from it, and the
 * click and navigation notes. So a web take carries `events: []` and no
 * `pointer` on any frame. Live dictation goes with them; it never wrote the
 * shipped transcript, and a level tap answers the question it actually answered.
 */

const VOICE_MS = 50 // mic level reading cadence — the analyser window is ~43 ms at 48 kHz
const PROGRESS_MS = 1500 // floor between meta writes — this is IndexedDB, not a render

const MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
const AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm']

/**
 * Raw capture on purpose, for both the mic and the shared audio: Chrome's echo
 * cancellation / noise suppression / auto gain exist to isolate one voice on a
 * call, and they do it by shredding everything else — the app's sound, the
 * second voice across the desk, the room. A walkthrough wants all of that.
 */
const RAW_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
} as const

/** Chrome's picker offers "share audio" on tab and screen surfaces; ask it to. */
type DisplayOptions = DisplayMediaStreamOptions & { systemAudio?: 'include' | 'exclude' }

/**
 * Whether the mic is in the take at all. Narrower than the extension's
 * `MicState`, which also carried Web Speech's own failures.
 */
export type MicState = 'listening' | 'off' | 'denied'

/**
 * A sound source, as the HUD states it. 'none' = no track (the picker's "share
 * audio" box was never ticked, or a window was picked — Chrome offers no box
 * there), 'silent' = a track exists but nothing has been heard on it yet, 'live'
 * = real signal has landed. 'silent' minutes into a take with sound playing is
 * the tell for a dead loopback: the sound is reaching the ears through a device
 * the browser isn't capturing.
 */
export type SourceState = 'none' | 'silent' | 'live'

export interface LiveUpdate {
  elapsedMs: number
  frameCount: number
  micState: MicState
  micAudio: SourceState
  sysAudio: SourceState
}

/**
 * A keyframe the moment it is kept, for the live filmstrip — the closest a page
 * gets to the extension's timeline building under you as you narrate. The `url`
 * is an object URL the page owns and must revoke when the take ends.
 */
export interface LiveThumb {
  /** The frame rule's pick key — what names the JPEG on disk. Stable; the frame's index is not. */
  key: number
  t: number
  url: string
}

export interface LiveHandlers {
  onUpdate(update: LiveUpdate): void
  /** Each kept keyframe, as it lands — drives the filmstrip. Optional: the take
   *  is complete without it. */
  onFrame?(thumb: LiveThumb): void
  /** The user ended the share from the browser's own "Stop sharing" UI. */
  onEnd(): void
}

/** Is there a screen to capture here at all? False on every mobile browser. */
export function canRecordScreen(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  )
}

/** A picker the person dismissed is a change of mind, not a failure to report. */
export function isPickerRefusal(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  )
}

/** One analyser on one source, latching the first time real signal arrives. */
interface Tap {
  analyser: AnalyserNode
  /** Pinned to a plain ArrayBuffer: `getFloatTimeDomainData` refuses a view
   *  that might be backed by a SharedArrayBuffer. */
  buf: Float32Array<ArrayBuffer>
  heard: boolean
}

export class LiveRecorder {
  readonly id = crypto.randomUUID()

  private stream: MediaStream | null = null
  private micStream: MediaStream | null = null
  private video: HTMLVideoElement | null = null

  private recorder: MediaRecorder | null = null
  private mime = 'video/webm'
  private chunkCount = 0
  private chunkSeq = 0
  private chunks: Blob[] = []

  /** Mixes shared audio + mic into the one track the webm records. */
  private audioCtx: AudioContext | null = null
  /** Held as a field on purpose: an unreferenced node is GC bait, and a
   *  collected node drops out of the graph mid-take — silently. */
  private mixSources: MediaStreamAudioSourceNode[] = []
  private sysTap: Tap | null = null
  private micTap: Tap | null = null

  /**
   * The mic-only shadow, running only when the take ALSO has system audio: the
   * webm's mixed track is what a human plays back, but Whisper must hear
   * narration alone or the transcript fills with the app's own sound. Without
   * system audio the video's track already is the mic, and this stays null.
   */
  private micRecorder: MediaRecorder | null = null
  private micMime = 'audio/webm'
  private micChunks: Blob[] = []
  private micChunkCount = 0
  private micChunkSeq = 0
  private micState: MicState = 'off'

  /** The frame rule. Null on a pristine take, which keeps no frames. */
  private live: LiveFrames | null = null
  /** Pick keys whose JPEG is on disk (`<id>:frame:<key>`). */
  private readonly stored = new Set<number>()
  /** JPEGs stored since the filmstrip last heard, until their frame's time is known. */
  private readonly fresh = new Map<number, Blob>()
  private readonly voice = new VoiceGate()
  private startedAt = 0
  private lastProgress = 0

  private sampleTimer: number | null = null
  private tickTimer: number | null = null
  private voiceTimer: number | null = null
  private sampling = false
  private pending: Promise<void> = Promise.resolve()
  private stopped: Promise<LiveTake> | null = null

  constructor(
    private handlers: LiveHandlers,
    private sessionId: string,
    /** 1-based part number; names the rec-NN folder. */
    readonly index: number,
    /**
     * Pristine capture, for a human handback: the video IS the deliverable, so
     * ask for 30 fps instead of 10, pin the encoder bitrate to the surface area
     * instead of Chrome's throwaway default, and never sample a keyframe —
     * there is no distill, and the sampling loop would only steal CPU from the
     * encode. Everything else (mix, mic shadow, chunk persistence) is identical.
     */
    private readonly pristine = false
  ) {}

  // ── lifecycle ───────────────────────────────────────────────────────────

  /** Opens the picker. Throws if it is dismissed — nothing is created until it resolves. */
  async start(): Promise<void> {
    // Audio too: the sound the app makes (what's in the narrator's headphones)
    // belongs in the take. The browser only grants it when the picker's "share
    // audio" box is ticked on a tab or full-screen surface — a window share has
    // no box — so its absence is a normal outcome, surfaced in the HUD, never an
    // error.
    const options: DisplayOptions = {
      video: { frameRate: { ideal: this.pristine ? 30 : 10 } },
      audio: { ...RAW_AUDIO },
      systemAudio: 'include',
    }
    const stream = await navigator.mediaDevices.getDisplayMedia(options)
    this.stream = stream
    this.startedAt = Date.now()
    this.lastProgress = this.startedAt

    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.style.cssText = 'position:fixed; left:-9999px; top:0; width:4px;'
    document.body.appendChild(video)
    video.srcObject = stream
    await video.play()
    this.video = video

    if (!this.pristine) {
      this.live = new LiveFrames({
        // Under the pick's key, not its index: the index can shift until the take ends.
        store: async (key, jpeg) => {
          await blobs.set(`${this.id}:frame:${key}`, jpeg)
          this.stored.add(key)
          if (this.handlers.onFrame) this.fresh.set(key, jpeg)
        },
      })
    }

    // The mic is grabbed for real, not as a probe: its track is mixed into the
    // webm so the raw video carries the narration. Raw constraints — see
    // RAW_AUDIO — so the room survives.
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { ...RAW_AUDIO } })
      this.micState = 'listening'
    } catch {
      this.micState = 'denied'
    }

    this.mime = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'video/webm'
    const recorded = new MediaStream([...stream.getVideoTracks(), ...this.mixAudio()])
    // Pristine: ~2 bits per pixel per second of captured area — 1080p ≈ 4 Mbps,
    // 1440p ≈ 7 Mbps — clamped [3,8] Mbps so a 4K share doesn't fill the disk.
    // Non-pristine (a distill source, read once for keyframes and never watched)
    // is capped at 1 Mbps instead of Chrome's default. Throttled 2026-08-12 to
    // cut storage + egress; mirror any change in extension/src/offscreen/recorder.ts.
    const bitrate = this.pristine
      ? Math.round(Math.min(8e6, Math.max(3e6, video.videoWidth * video.videoHeight * 2)))
      : 1_000_000
    const recorder = new MediaRecorder(recorded, {
      mimeType: this.mime,
      videoBitsPerSecond: bitrate,
    })
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return
      this.chunks.push(e.data)
      // Also to disk: in memory these die with the tab, and a webm assembled
      // from chunk 1..n is playable even when nobody ever called stop().
      const n = ++this.chunkSeq
      void blobs
        .set(`${this.id}:chunk:${n}`, e.data)
        .then(() => {
          if (n > this.chunkCount) this.chunkCount = n
        })
        .catch(() => {})
    }
    recorder.start(1000)
    this.recorder = recorder
    this.startMicShadow()

    // "Stop sharing" from the browser's own bar ends the take, not just the share.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.handlers.onEnd())

    // The take exists on disk from its first moment, before a single chunk has
    // landed — a row with no chunks recovers as an empty take, a chunk with no
    // row recovers as nothing at all.
    await putTake(this.snapshot())

    if (this.live) {
      this.sampleTimer = window.setInterval(() => {
        // Only replace `pending` when a sample actually starts — a tick that
        // no-ops against an in-flight sample must not mask the real promise, or
        // finish() would run the rule's last step while this one is writing.
        if (!this.sampling) this.pending = this.sample()
      }, LIVE_STEP_MS)
      // No mic, no tap: no lines, and the rule still keeps changes and beats.
      if (this.micTap) this.voiceTimer = window.setInterval(() => this.listen(), VOICE_MS)
    }
    this.tickTimer = window.setInterval(() => {
      this.pollAudio()
      this.emit()
      void this.saveProgress()
    }, 1000)
    if (this.live) this.pending = this.sample()
    this.emit()
  }

  stop(): Promise<LiveTake> {
    if (!this.stopped) this.stopped = this.finish()
    return this.stopped
  }

  /** Whether the share came with an audio track — decided at start, never changes. */
  get hasSystemAudio(): boolean {
    return (this.stream?.getAudioTracks().length ?? 0) > 0
  }

  /** The shared stream, for a live `<video>` preview. Null before start / after teardown. */
  get previewStream(): MediaStream | null {
    return this.stream
  }

  private sourceState(tap: Tap | null, present: boolean): SourceState {
    if (!present) return 'none'
    return tap?.heard ? 'live' : 'silent'
  }

  /**
   * One audio track for the webm, whatever arrived: every source mixed through
   * Web Audio (MediaRecorder records ONE audio track; handing it two silently
   * drops the second), each tapped by an analyser so silence is a fact the HUD
   * can state instead of a surprise at playback. A mixer failure falls back to
   * the raw mic — narration over silence beats app sound over a missing voice.
   */
  private mixAudio(): MediaStreamTrack[] {
    const sys = this.stream?.getAudioTracks() ?? []
    const mic = this.micStream?.getAudioTracks() ?? []
    if (!sys.length && !mic.length) return []
    try {
      const ctx = new AudioContext()
      this.audioCtx = ctx
      const dest = ctx.createMediaStreamDestination()
      const tap = (source: MediaStreamAudioSourceNode): Tap => {
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        source.connect(analyser)
        return { analyser, buf: new Float32Array(analyser.fftSize), heard: false }
      }
      for (const track of [...sys, ...mic]) {
        const source = ctx.createMediaStreamSource(new MediaStream([track]))
        source.connect(dest)
        this.mixSources.push(source)
        if (track === sys[0]) this.sysTap = tap(source)
        if (track === mic[0]) this.micTap = tap(source)
      }
      // A page's graph starts suspended until a gesture; the click that opened
      // the picker is one, but resume anyway — a suspended graph records silence.
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
      return dest.stream.getAudioTracks()
    } catch {
      // The raw mic still records; without a graph there is no level to read,
      // so this take keeps changes and beats but opens no lines.
      this.mixSources = []
      this.sysTap = null
      this.micTap = null
      return mic
    }
  }

  /** Latches each tap the first time it carries real signal. */
  private pollAudio(): void {
    for (const tap of [this.sysTap, this.micTap]) {
      if (!tap || tap.heard) continue
      tap.analyser.getFloatTimeDomainData(tap.buf)
      for (let i = 0; i < tap.buf.length; i++) {
        if (Math.abs(tap.buf[i]) > 0.001) {
          tap.heard = true
          break
        }
      }
    }
  }

  /** The mic-only shadow, persisted exactly the way the video's chunks are. */
  private startMicShadow(): void {
    const mic = this.micStream
    if (!mic || !this.hasSystemAudio || !mic.getAudioTracks().length) return
    this.micMime =
      AUDIO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'audio/webm'
    try {
      const shadow = new MediaRecorder(new MediaStream(mic.getAudioTracks()), {
        mimeType: this.micMime,
      })
      shadow.ondataavailable = (e) => {
        if (!e.data.size) return
        this.micChunks.push(e.data)
        const n = ++this.micChunkSeq
        void blobs
          .set(`${this.id}:micchunk:${n}`, e.data)
          .then(() => {
            if (n > this.micChunkCount) this.micChunkCount = n
          })
          .catch(() => {})
      }
      shadow.start(1000)
      this.micRecorder = shadow
    } catch {
      // No shadow: transcription decodes the mixed webm instead. Words over app
      // sound is a degraded transcript, not a lost take.
      this.micRecorder = null
    }
  }

  // ── sampling ────────────────────────────────────────────────────────────

  /** One step of the frame rule. A frame that fails to encode or store is a missing frame, not a dead take. */
  private async sample(): Promise<void> {
    const live = this.live
    const video = this.video
    if (this.sampling || !live || !video) return
    this.sampling = true
    const before = this.stored.size
    try {
      await live.push(this.elapsed(), video)
    } catch {
      /* the next step reads the screen again */
    } finally {
      this.sampling = false
    }
    if (this.stored.size !== before) {
      this.thumbs()
      this.emit()
      void this.saveProgress()
    }
  }

  /** One mic reading; speech starting or stopping opens or closes the rule's line. */
  private listen(): void {
    const tap = this.micTap
    const live = this.live
    if (!tap || !live) return
    tap.analyser.getFloatTimeDomainData(tap.buf)
    const edge = this.voice.push(this.elapsed(), rmsOf(tap.buf))
    if (edge?.kind === 'open') live.openLine(edge.t)
    else if (edge?.kind === 'close') live.closeLine(edge.t)
  }

  /**
   * The JPEGs that just went to disk, handed to the filmstrip once the rule says
   * when each was on screen. The page owns these URLs and revokes them when the
   * take ends.
   */
  private thumbs(): void {
    const onFrame = this.handlers.onFrame
    if (!onFrame || !this.fresh.size || !this.live) return
    for (const { frame, key } of this.live.frames()) {
      const jpeg = this.fresh.get(key)
      if (!jpeg) continue
      this.fresh.delete(key)
      onFrame({ key, t: frame.t, url: URL.createObjectURL(jpeg) })
    }
  }

  // ── persistence ─────────────────────────────────────────────────────────

  /**
   * The take as it stands right now — what `finish()` returns. Written whole,
   * so a tab that dies still leaves a readable take behind: each frame names its
   * own JPEG by key, so a snapshot's numbering never has to agree with the next.
   */
  private snapshot(): LiveTake {
    const live = this.live
    const meta: LiveTake['meta'] = {
      startedAt: this.startedAt,
      durationMs: this.elapsed(),
      sampled: live?.sampled ?? 0,
      frames: (live?.frames() ?? []).map(({ frame, key }) => ({ ...frame, blobKey: key })),
      ...(live ? { sampling: live.sampling } : {}),
      transcript: [],
      // Nothing tapped a console here — see the header. An empty list is the
      // honest answer, and the one `/phone` also gives.
      events: [],
      videoFile: 'walkthrough.webm',
    }
    return {
      id: this.id,
      sessionId: this.sessionId,
      index: this.index,
      createdAt: this.startedAt,
      state: this.stopped ? 'done' : 'recording',
      mime: this.mime,
      chunks: this.chunkCount,
      ...(this.micChunkCount ? { micChunks: this.micChunkCount, micMime: this.micMime } : {}),
      meta,
    }
  }

  /** Throttled: this is a write to IndexedDB, not a render. */
  private async saveProgress(): Promise<void> {
    if (this.stopped) return
    const now = Date.now()
    if (now - this.lastProgress < PROGRESS_MS) return
    this.lastProgress = now
    await putTake(this.snapshot()).catch(() => {})
  }

  // ── teardown ────────────────────────────────────────────────────────────

  /**
   * Give up the take without producing one: the share was granted but the
   * person changed their mind. Tracks first — a share left running is the
   * visible failure.
   */
  async cancel(): Promise<void> {
    this.stopped = Promise.reject(new Error('cancelled'))
    this.stopped.catch(() => {})
    this.teardown()
    // A step still writing would land its JPEG after the sweep.
    await this.pending.catch(() => {})
    const keys = [
      ...[...this.stored].map((key) => `${this.id}:frame:${key}`),
      ...Array.from({ length: this.chunkSeq }, (_, i) => `${this.id}:chunk:${i + 1}`),
      ...Array.from({ length: this.micChunkSeq }, (_, i) => `${this.id}:micchunk:${i + 1}`),
    ]
    await Promise.all(keys.map((key) => blobs.delete(key).catch(() => undefined)))
  }

  /** Timers, streams, the offscreen video element. Safe to call twice. */
  private teardown(): void {
    this.clearTimers()
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    this.recorder = null
    if (this.micRecorder && this.micRecorder.state !== 'inactive') this.micRecorder.stop()
    this.micRecorder = null
    this.releaseMedia()
  }

  private releaseMedia(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.micStream?.getTracks().forEach((track) => track.stop())
    void this.audioCtx?.close().catch(() => {})
    this.audioCtx = null
    this.mixSources = []
    this.sysTap = null
    this.micTap = null
    this.video?.remove()
    this.stream = null
    this.micStream = null
    this.video = null
  }

  private clearTimers(): void {
    for (const timer of [this.sampleTimer, this.tickTimer, this.voiceTimer]) {
      if (timer !== null) clearInterval(timer)
    }
    this.sampleTimer = null
    this.tickTimer = null
    this.voiceTimer = null
  }

  private async finish(): Promise<LiveTake> {
    this.clearTimers()

    await this.pending.catch(() => {})
    // The rule's last word, while the share still shows the final screen: a line
    // still being spoken closes here, and the end state gets its frame.
    const live = this.live
    if (live) {
      const t = this.elapsed()
      const edge = this.voice.finish(t)
      if (edge) live.closeLine(edge.t)
      await live.finish(t, this.video).catch(() => {})
      this.thumbs()
    }

    const recorder = this.recorder
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        recorder.stop()
      })
    }
    this.recorder = null
    const micRecorder = this.micRecorder
    if (micRecorder && micRecorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        micRecorder.onstop = () => resolve()
        micRecorder.stop()
      })
    }
    this.micRecorder = null

    await blobs.set(`${this.id}:video`, new Blob(this.chunks, { type: this.mime }))
    if (this.micChunks.length) {
      await blobs.set(`${this.id}:mic`, new Blob(this.micChunks, { type: this.micMime }))
    }
    // The whole video is on disk now, so the pieces it was insurance against go.
    // Only after the write — a crash between the two must still be recoverable.
    for (let n = 1; n <= this.chunkSeq; n++) await blobs.delete(`${this.id}:chunk:${n}`)
    for (let n = 1; n <= this.micChunkSeq; n++) await blobs.delete(`${this.id}:micchunk:${n}`)

    this.releaseMedia()

    // `stopped` is already set by stop(), so snapshot() reads state 'done'.
    const take = this.snapshot()
    await putTake(take)
    return take
  }

  // ── plumbing ────────────────────────────────────────────────────────────

  private elapsed(): number {
    return Date.now() - this.startedAt
  }

  private emit(): void {
    this.handlers.onUpdate({
      elapsedMs: this.elapsed(),
      frameCount: this.stored.size,
      micState: this.micState,
      micAudio: this.sourceState(this.micTap, this.micState === 'listening'),
      sysAudio: this.sourceState(this.sysTap, this.hasSystemAudio),
    })
  }
}
