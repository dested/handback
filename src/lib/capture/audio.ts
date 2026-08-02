/**
 * The clip's narration, decoded once for the transcriber. Ported from the
 * `decode()` in `extension/src/sidepanel/transcribe.ts`: OfflineAudioContext
 * rather than a live one, because this runs with nothing to play and an offline
 * context resamples inside `decodeAudioData` without claiming an output device
 * or tripping an autoplay policy.
 *
 * Handed a video container, `decodeAudioData` extracts the audio track — that
 * is the point. A screen recording and a voice memo take the same path.
 */

export const SAMPLE_RATE = 16000
/** Below this peak there is nothing to transcribe; sending it burns a request to hear silence. */
const SILENCE_FLOOR = 0.001

/** Mixdown to mono at 16 kHz. Null when there's no decodable audio, or it's silent. */
export async function decodeMono(file: Blob): Promise<Float32Array | null> {
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  try {
    // A clip recorded with the mic off has no audio track at all, and decoding throws.
    const buf = await ctx.decodeAudioData(await file.arrayBuffer())
    const mono = new Float32Array(buf.length)
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const channel = buf.getChannelData(c)
      for (let i = 0; i < channel.length; i++) mono[i] += channel[i]
    }
    if (buf.numberOfChannels > 1) {
      for (let i = 0; i < mono.length; i++) mono[i] /= buf.numberOfChannels
    }
    for (let i = 0; i < mono.length; i++) {
      if (Math.abs(mono[i]) > SILENCE_FLOOR) return mono
    }
    return null
  } catch {
    return null
  }
}
