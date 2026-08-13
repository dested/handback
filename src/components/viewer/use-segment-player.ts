// Playing an edit with one <video>. The segment list is the score: inside a
// segment the element just plays, and at a segment's end the hook jumps to the
// next one — a seek within the same take, a src swap across takes. A frame or
// two of slop at each jump is acceptable; the render is sample-exact.
//
// Generalized out of the editor's private preview hook so the editor and the
// viewer's scrubber read the same playhead, on the same output clock.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { EditSegment } from '~/lib/edit/edl'

export interface SegmentPlayer {
  videoRef: RefObject<HTMLVideoElement | null>
  currentSrc: string | undefined
  playing: boolean
  /** Playhead on the output clock (cuts removed), state-updated ~30fps while playing. */
  outputMs: number
  /** Sum of segment lengths. */
  durationMs: number
  /** Seek on the output clock. Pass forcePlay to start playing regardless of the paused state. */
  seekOutput(outMs: number, forcePlay?: boolean): void
  /** Toggle play/pause; restarts from 0 when parked at the end. */
  togglePlay(): void
  onTimeUpdate(): void
  onEnded(): void
  onPlay(): void
  onPause(): void
}

/** State updates any faster than this buy nothing a scrubber can show. */
const TICK_MS = 33

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function useSegmentPlayer(
  segments: EditSegment[],
  videoUrls: Map<string, string>
): SegmentPlayer {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const segIndex = useRef(0)
  const [currentSrc, setCurrentSrc] = useState<string | undefined>(undefined)
  const [playing, setPlaying] = useState(false)
  const [outputMs, setOutputMs] = useState(0)

  // Where each segment starts on the output clock, plus the total.
  const { starts, durationMs } = useMemo(() => {
    const acc: number[] = []
    let sum = 0
    for (const seg of segments) {
      acc.push(sum)
      sum += seg.srcEndMs - seg.srcStartMs
    }
    return { starts: acc, durationMs: sum }
  }, [segments])

  /** The playhead as the element reports it right now, on the output clock. */
  const readOutputMs = useCallback((): number | null => {
    const video = videoRef.current
    const seg = segments[segIndex.current]
    const start = starts[segIndex.current]
    if (!video || !seg || start === undefined) return null
    return clamp(start + (video.currentTime * 1000 - seg.srcStartMs), 0, durationMs)
  }, [segments, starts, durationMs])

  const enter = useCallback(
    (index: number, offsetMs: number, play: boolean) => {
      const seg = segments[index]
      const video = videoRef.current
      if (!seg || !video) return
      segIndex.current = index
      const src = videoUrls.get(seg.takeId)
      const at = (seg.srcStartMs + offsetMs) / 1000
      if (src && video.currentSrc !== src && currentSrc !== src) {
        setCurrentSrc(src)
        // Seek once the new source can seek; canplay fires after src swap.
        const onCanPlay = () => {
          video.currentTime = at
          if (play) void video.play().catch(() => {})
          video.removeEventListener('canplay', onCanPlay)
        }
        video.addEventListener('canplay', onCanPlay)
        return
      }
      video.currentTime = at
      if (play) void video.play().catch(() => {})
    },
    [segments, videoUrls, currentSrc]
  )

  // Segments changed under the player (a cut toggled, a take reordered, the
  // urls re-signed by a refetch): hold the moment being watched instead of
  // restarting. The element still carries the OLD clock, so the moment is
  // (takeId, source ms) — map it through the new list onto the first kept span
  // at or after it in the same take; only a moment whose whole tail was cut
  // (or a first render) falls back to the top.
  const prevSegments = useRef<EditSegment[]>([])
  useEffect(() => {
    const video = videoRef.current
    const prev = prevSegments.current[segIndex.current]
    prevSegments.current = segments
    const srcMs = video ? video.currentTime * 1000 : null
    if (video && prev && srcMs !== null) {
      let acc = 0
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        if (!seg) continue
        if (seg.takeId === prev.takeId && srcMs < seg.srcEndMs) {
          const offset = Math.max(0, srcMs - seg.srcStartMs)
          enter(i, offset, !video.paused)
          setOutputMs(clamp(acc + offset, 0, durationMs))
          return
        }
        acc += seg.srcEndMs - seg.srcStartMs
      }
    }
    segIndex.current = 0
    const first = segments[0]
    setCurrentSrc(first ? videoUrls.get(first.takeId) : undefined)
    setOutputMs(0)
    // enter() is identity-stable per (segments, videoUrls); listing it would not
    // add runs beyond the two real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, videoUrls])

  const seekOutput = useCallback(
    (outMs: number, forcePlay?: boolean) => {
      const target = clamp(outMs, 0, durationMs)
      setOutputMs(target)
      const wantPlay = forcePlay ?? !videoRef.current?.paused
      let acc = 0
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        if (!seg) continue
        const len = seg.srcEndMs - seg.srcStartMs
        if (target < acc + len) {
          enter(i, target - acc, wantPlay)
          return
        }
        acc += len
      }
    },
    [segments, enter, durationMs]
  )

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (!video.paused) {
      video.pause()
      return
    }
    // Parked at the end: a play press restarts from the top rather than
    // firing `ended` on the spot.
    if (durationMs > 0 && outputMs >= durationMs - 60) {
      seekOutput(0, true)
      return
    }
    void video.play().catch(() => {})
  }, [durationMs, outputMs, seekOutput])

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current
    const seg = segments[segIndex.current]
    if (!video || !seg) return
    const tMs = video.currentTime * 1000
    if (tMs >= seg.srcEndMs - 40) {
      if (segIndex.current + 1 < segments.length) {
        enter(segIndex.current + 1, 0, !video.paused)
      } else {
        video.pause()
        setPlaying(false)
        setOutputMs(durationMs)
      }
    } else if (tMs < seg.srcStartMs - 250) {
      // The native scrubber jumped into cut material; snap back into the edit.
      video.currentTime = seg.srcStartMs / 1000
    }
  }, [segments, enter, durationMs])

  const onEnded = useCallback(() => {
    if (segIndex.current + 1 < segments.length) {
      enter(segIndex.current + 1, 0, true)
    } else {
      setPlaying(false)
      setOutputMs(durationMs)
    }
  }, [segments, enter, durationMs])

  const onPlay = useCallback(() => setPlaying(true), [])

  const onPause = useCallback(() => {
    setPlaying(false)
    // The rAF loop stops with `playing`; land the playhead where it actually is.
    const at = readOutputMs()
    if (at !== null) setOutputMs(at)
  }, [readOutputMs])

  // `timeupdate` fires ~4×/s — too coarse for a playhead, so poll while playing.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (now - last < TICK_MS) return
      last = now
      const at = readOutputMs()
      if (at !== null) setOutputMs(at)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, readOutputMs])

  return {
    videoRef,
    currentSrc,
    playing,
    outputMs,
    durationMs,
    seekOutput,
    togglePlay,
    onTimeUpdate,
    onEnded,
    onPlay,
    onPause,
  }
}

// A single, already-muxed source (final.mp4) has a real duration and needs no
// segment bookkeeping — but it drives the same custom chrome as the multi-take
// player, so it wears the SegmentPlayer shape too. The output clock is just the
// element's own currentTime.
export function useSingleVideoPlayer(src: string | undefined): SegmentPlayer {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [outputMs, setOutputMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)

  const seekOutput = useCallback(
    (outMs: number, forcePlay?: boolean) => {
      const video = videoRef.current
      if (!video) return
      const ceiling = durationMs > 0 ? durationMs : outMs
      const target = clamp(outMs, 0, ceiling)
      video.currentTime = target / 1000
      setOutputMs(target)
      if (forcePlay) void video.play().catch(() => {})
    },
    [durationMs]
  )

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (!video.paused) {
      video.pause()
      return
    }
    if (durationMs > 0 && outputMs >= durationMs - 60) video.currentTime = 0
    void video.play().catch(() => {})
  }, [durationMs, outputMs])

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (video) setOutputMs(video.currentTime * 1000)
  }, [])
  const onEnded = useCallback(() => setPlaying(false), [])
  const onPlay = useCallback(() => setPlaying(true), [])
  const onPause = useCallback(() => setPlaying(false), [])

  // Duration lands with metadata; MediaRecorder webm can report Infinity, so a
  // final.mp4 (finite by construction) is the only thing this hook ever plays.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const read = () => {
      if (Number.isFinite(video.duration)) setDurationMs(video.duration * 1000)
    }
    video.addEventListener('loadedmetadata', read)
    video.addEventListener('durationchange', read)
    read()
    return () => {
      video.removeEventListener('loadedmetadata', read)
      video.removeEventListener('durationchange', read)
    }
  }, [src])

  // `timeupdate` alone is too coarse for a playhead — poll while playing.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (now - last < TICK_MS) return
      last = now
      const video = videoRef.current
      if (video) setOutputMs(video.currentTime * 1000)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  return {
    videoRef,
    currentSrc: src,
    playing,
    outputMs,
    durationMs,
    seekOutput,
    togglePlay,
    onTimeUpdate,
    onEnded,
    onPlay,
    onPause,
  }
}
