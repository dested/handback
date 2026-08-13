import { pad2, mmssFile } from './format'
import {
  BEAT_MS,
  cellDiff,
  DEDUP_THRESHOLD,
  DEDUP_WINDOW,
  frameBudget,
  JPEG_QUALITY,
  MAX_FRAME_W,
  PIX_TOL,
  SIG_SIZE,
} from './frames'
import { blobs, putTake, type LiveTake } from './live-store'
import { toJpeg } from './media'
import type { RecordingFrame, RecordingMeta } from './types'

/**
 * Screen capture in a plain tab — the extension's `Recorder`
 * (`extension/src/sidepanel/recorder.ts`) with the half a web page can't have
 * taken out, and nothing else changed.
 *
 * What is identical, because it is all plain web platform: the picker call and
 * its constraints, the 64×64 keep/drop decision and every constant it reads
 * (imported from `frames.ts` rather than copied), the 15 s heartbeat, the
 * length-scaled frame budget and its uniform thin, the Web Audio mix of app
 * audio with a raw mic, the mic-only shadow recorder that transcription hears
 * instead of that mix, and chunk-by-chunk persistence so a dead tab loses the
 * last second rather than the take.
 *
 * What is gone, because it arrived from `extension/src/content/*` injected into
 * the recorded page — which no page can do to another origin: console and
 * network events, pointer telemetry and the crosshair drawn from it, and the
 * clicks and navigations that forced a keyframe. So a web take carries
 * `events: []`, no `pointer` on any frame, and only the `start` / `change` /
 * `beat` reasons — the same three `/phone` produces, and everything downstream
 * already reads that. Live dictation goes with them; it never wrote the shipped
 * transcript, and a level tap answers the question it actually answered.
 */

const SAMPLE_MS = 500 // candidate cadence — free here, the share was going to paint the frame anyway
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
  index: number
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

  private frames: RecordingFrame[] = []
  private sigs: Uint8ClampedArray[] = []
  private lastKeptT = 0
  private sampled = 0
  private startedAt = 0
  private lastProgress = 0

  private sigCtx: CanvasRenderingContext2D | null = null
  private frameCtx: CanvasRenderingContext2D | null = null

  private sampleTimer: number | null = null
  private tickTimer: number | null = null
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

    const sig = document.createElement('canvas')
    sig.width = SIG_SIZE
    sig.height = SIG_SIZE
    this.sigCtx = sig.getContext('2d', { willReadFrequently: true })
    this.frameCtx = document.createElement('canvas').getContext('2d')
    if (this.frameCtx) this.frameCtx.imageSmoothingQuality = 'high'

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
    // cut storage + egress; mirror any change in extension/src/sidepanel/recorder.ts.
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

    if (!this.pristine) {
      this.sampleTimer = window.setInterval(() => {
        // Only replace `pending` when a sample actually starts — a tick that
        // no-ops against an in-flight sample must not mask the real promise, or
        // finish() would thin and renumber while that sample is still writing.
        if (!this.sampling) this.pending = this.sample()
      }, SAMPLE_MS)
    }
    this.tickTimer = window.setInterval(() => {
      this.pollAudio()
      this.emit()
      void this.saveProgress()
    }, 1000)
    if (!this.pristine) this.pending = this.sample()
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

  private async sample(): Promise<void> {
    const video = this.video
    const sigCtx = this.sigCtx
    const frameCtx = this.frameCtx
    if (this.sampling || !video || !sigCtx || !frameCtx) return
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return

    this.sampling = true
    try {
      this.sampled++
      sigCtx.drawImage(video, 0, 0, SIG_SIZE, SIG_SIZE)
      const sig = sigCtx.getImageData(0, 0, SIG_SIZE, SIG_SIZE).data

      const t = this.elapsed()
      const minDist = this.sigs.length
        ? Math.min(...this.sigs.map((k) => cellDiff(sig, k)))
        : undefined
      let reason: RecordingFrame['reason']
      if (minDist === undefined) {
        reason = 'start'
      } else if (minDist <= DEDUP_THRESHOLD) {
        // Below the bar, but the screen *is* moving and nothing has been kept in
        // a while — a drifting low-contrast UI would otherwise go dark for minutes.
        if (!(minDist > 0 && t - this.lastKeptT > BEAT_MS)) return
        reason = 'beat'
      } else {
        reason = 'change'
      }

      const width = Math.min(video.videoWidth, MAX_FRAME_W)
      const height = Math.round((video.videoHeight * width) / video.videoWidth)
      const canvas = frameCtx.canvas
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        frameCtx.imageSmoothingQuality = 'high'
      }
      frameCtx.drawImage(video, 0, 0, width, height)

      const index = this.frames.length + 1
      const jpeg = await toJpeg(canvas, JPEG_QUALITY)
      await blobs.set(`${this.id}:frame:${index}`, jpeg)
      this.frames.push({
        index,
        t,
        file: `frames/${pad2(index)}-${mmssFile(t)}.jpg`,
        reason,
        ...(minDist === undefined ? {} : { dist: minDist }),
      })
      this.lastKeptT = t
      this.sigs.push(sig)
      if (this.sigs.length > DEDUP_WINDOW) this.sigs.shift()
      // The same JPEG that just went to disk, handed to the filmstrip. The page
      // owns this URL and revokes it when the take ends.
      this.handlers.onFrame?.({ index, t, url: URL.createObjectURL(jpeg) })
      this.emit()
      void this.saveProgress()
    } finally {
      this.sampling = false
    }
  }

  // ── persistence ─────────────────────────────────────────────────────────

  /**
   * The take as it stands right now — what `finish()` returns, minus the
   * thinning pass. Written whole, so a tab that dies still leaves a readable
   * take behind.
   */
  private snapshot(): LiveTake {
    const meta: RecordingMeta = {
      startedAt: this.startedAt,
      durationMs: this.elapsed(),
      sampled: this.sampled,
      frames: this.frames,
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
    const keys = [
      ...this.frames.map((f) => `${this.id}:frame:${f.index}`),
      ...Array.from({ length: this.chunkSeq }, (_, i) => `${this.id}:chunk:${i + 1}`),
      ...Array.from({ length: this.micChunkSeq }, (_, i) => `${this.id}:micchunk:${i + 1}`),
    ]
    await Promise.all(keys.map((key) => blobs.delete(key).catch(() => undefined)))
  }

  /** Timers, streams, the offscreen video element. Safe to call twice. */
  private teardown(): void {
    if (this.sampleTimer !== null) clearInterval(this.sampleTimer)
    if (this.tickTimer !== null) clearInterval(this.tickTimer)
    this.sampleTimer = null
    this.tickTimer = null
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

  private async finish(): Promise<LiveTake> {
    if (this.sampleTimer !== null) clearInterval(this.sampleTimer)
    if (this.tickTimer !== null) clearInterval(this.tickTimer)
    this.sampleTimer = null
    this.tickTimer = null

    await this.pending
    // The last screen state gets its fair shot through dedup, nothing more.
    if (!this.pristine) await this.sample()

    const allowed = frameBudget(this.elapsed())
    if (this.frames.length > allowed) {
      // A uniform thin: survivors stay spread across the whole take, so nothing
      // is protected from it and nothing gets a run of neighbours it doesn't earn.
      const keepIdx = new Set<number>()
      const step = this.frames.length / allowed
      for (let i = 0; i < allowed; i++) keepIdx.add(Math.floor(i * step))
      const survivors = this.frames.filter((_, i) => keepIdx.has(i))
      const dropped = this.frames.filter((_, i) => !keepIdx.has(i))
      await Promise.all(dropped.map((f) => blobs.delete(`${this.id}:frame:${f.index}`)))
      // Renumber ascending: a survivor's new index is always ≤ its old one, and
      // the slot it moves into has already been vacated — never re-key out of order.
      for (let n = 0; n < survivors.length; n++) {
        const frame = survivors[n]
        const newIndex = n + 1
        if (newIndex !== frame.index) {
          const blob = await blobs.get(`${this.id}:frame:${frame.index}`)
          if (blob) await blobs.set(`${this.id}:frame:${newIndex}`, blob)
          await blobs.delete(`${this.id}:frame:${frame.index}`)
          frame.index = newIndex
          frame.file = `frames/${pad2(newIndex)}-${mmssFile(frame.t)}.jpg` // t survives — citations stay valid
        }
      }
      this.frames = survivors
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
      frameCount: this.frames.length,
      micState: this.micState,
      micAudio: this.sourceState(this.micTap, this.micState === 'listening'),
      sysAudio: this.sourceState(this.sysTap, this.hasSystemAudio),
    })
  }
}
