// The tight edit, made real: walk the EDL's kept segments in output order,
// decode each span of the source takes, and encode one continuous MP4
// (H.264 + AAC — the pair that plays anywhere a link gets pasted). All
// WebCodecs via mediabunny, so the encode is hardware and a few minutes of
// video renders in seconds, in the tab, touching no server.

import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
} from 'mediabunny'
import type { EditSegment } from './edl'

export interface RenderProgress {
  /** 0..1 across the whole render, by output time produced. */
  fraction: number
}

export interface RenderResult {
  blob: Blob
  durationMs: number
}

interface OpenTake {
  input: Input
  video: VideoSampleSink | null
  audio: AudioBufferSink | null
  /** H.264 requires even dimensions; odd captures go through a canvas re-draw. */
  needsEvenFix: boolean
  width: number
  height: number
}

/**
 * Render `segments` (output order, take-local ms) into one MP4.
 * `takeMedia` maps take id → the raw recorded webm.
 */
export async function renderEdit(
  segments: EditSegment[],
  takeMedia: Map<string, Blob>,
  onProgress?: (p: RenderProgress) => void,
  signal?: AbortSignal
): Promise<RenderResult> {
  if (!segments.length) throw new Error('the edit removed everything — nothing to render')
  const stop = () => {
    if (signal?.aborted) throw new Error('cancelled')
  }

  // One Input per take, opened once — segments from the same take share it.
  const open = new Map<string, OpenTake>()
  for (const seg of segments) {
    if (open.has(seg.takeId)) continue
    const media = takeMedia.get(seg.takeId)
    if (!media) throw new Error('a take went missing from local storage')
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(media) })
    const videoTrack = await input.getPrimaryVideoTrack()
    const audioTrack = await input.getPrimaryAudioTrack()
    const width = videoTrack?.displayWidth ?? 0
    const height = videoTrack?.displayHeight ?? 0
    open.set(seg.takeId, {
      input,
      video: videoTrack ? new VideoSampleSink(videoTrack) : null,
      audio: audioTrack ? new AudioBufferSink(audioTrack) : null,
      needsEvenFix: width % 2 !== 0 || height % 2 !== 0,
      width,
      height,
    })
  }

  const anyAudio = [...open.values()].some((t) => t.audio !== null)
  const totalOutMs = segments.reduce((sum, s) => sum + (s.srcEndMs - s.srcStartMs), 0)

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  const videoSource = new VideoSampleSource({
    codec: 'avc',
    quality: QUALITY_HIGH,
    // Takes can differ in size (a re-share picks a different window); the first
    // frame sets the box and later takes letterbox into it rather than throwing.
    sizeChangeBehavior: 'contain',
  })
  output.addVideoTrack(videoSource)
  const audioSource = anyAudio
    ? new AudioBufferSource({ codec: 'aac', quality: QUALITY_HIGH })
    : null
  if (audioSource) output.addAudioTrack(audioSource)
  await output.start()

  // The canvas fix-up for odd-dimension captures, allocated once, lazily.
  let fixCtx: CanvasRenderingContext2D | null = null

  let outMs = 0
  for (const seg of segments) {
    stop()
    const take = open.get(seg.takeId)!
    const startS = seg.srcStartMs / 1000
    const endS = seg.srcEndMs / 1000
    const outStartS = outMs / 1000

    if (take.video) {
      let first = true
      for await (const sample of take.video.samples(startS, endS)) {
        stop()
        const t = outStartS + Math.max(0, sample.timestamp - startS)
        if (take.needsEvenFix) {
          // Encoders reject odd dimensions; redraw on an even canvas. Slow path,
          // only ever taken when the capture itself was odd-sized.
          const w = take.width - (take.width % 2)
          const h = take.height - (take.height % 2)
          if (!fixCtx) fixCtx = document.createElement('canvas').getContext('2d')
          if (fixCtx) {
            const canvas = fixCtx.canvas
            if (canvas.width !== w || canvas.height !== h) {
              canvas.width = w
              canvas.height = h
            }
            sample.draw(fixCtx, 0, 0, w, h)
            const redrawn = new VideoSample(canvas, { timestamp: t, duration: sample.duration })
            await videoSource.add(redrawn, first ? { keyFrame: true } : undefined)
            redrawn.close()
          }
          sample.close()
        } else {
          sample.setTimestamp(t)
          await videoSource.add(sample, first ? { keyFrame: true } : undefined)
          sample.close()
        }
        first = false
        onProgress?.({
          fraction: Math.min(1, (outMs + (sample.timestamp - startS) * 1000) / totalOutMs),
        })
      }
    }

    if (audioSource) {
      if (take.audio) {
        // AudioBufferSource stacks buffers seamlessly from t=0, so feeding the
        // exact windows in output order IS the edited audio track. Edge buffers
        // are trimmed to the window or A/V drifts by up to one decode chunk.
        for await (const { buffer, timestamp } of take.audio.buffers(startS, endS)) {
          stop()
          const trimmed = trimBuffer(buffer, timestamp, startS, endS)
          if (trimmed) await audioSource.add(trimmed)
        }
      } else {
        // A take with no audio still occupies output time; feed silence so the
        // takes after it stay in sync.
        const silent = silentBuffer(endS - startS)
        if (silent) await audioSource.add(silent)
      }
    }

    outMs += seg.srcEndMs - seg.srcStartMs
    onProgress?.({ fraction: Math.min(1, outMs / totalOutMs) })
  }

  await output.finalize()
  for (const take of open.values()) void take.input.dispose()
  const buffer = output.target.buffer
  if (!buffer) throw new Error('the encoder produced nothing')
  return { blob: new Blob([buffer], { type: 'video/mp4' }), durationMs: Math.round(outMs) }
}

/** Clip an AudioBuffer to the [startS, endS) window it straddles. */
function trimBuffer(
  buffer: AudioBuffer,
  timestamp: number,
  startS: number,
  endS: number
): AudioBuffer | null {
  const bufEnd = timestamp + buffer.duration
  const from = Math.max(0, Math.round((startS - timestamp) * buffer.sampleRate))
  const to = buffer.length - Math.max(0, Math.round((bufEnd - endS) * buffer.sampleRate))
  if (to <= from) return null
  if (from === 0 && to === buffer.length) return buffer
  const out = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: to - from,
    sampleRate: buffer.sampleRate,
  })
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = new Float32Array(to - from)
    buffer.copyFromChannel(channel, c, from)
    out.copyToChannel(channel, c)
  }
  return out
}

function silentBuffer(durationS: number): AudioBuffer | null {
  const length = Math.round(durationS * 48000)
  if (length <= 0) return null
  return new AudioBuffer({ numberOfChannels: 1, length, sampleRate: 48000 })
}
