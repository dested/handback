// MediaRecorder writes a streaming webm: no duration in the header, no cue
// index — which is why scrubbing a raw take is a lurch. A lossless remux
// through mediabunny (stream copy, no re-encode, sub-second even on long
// takes) writes both, and the editor's preview gets real seeking. Best-effort:
// on any failure the raw blob plays instead, just seeks badly.

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Output,
  WebMOutputFormat,
} from 'mediabunny'

export async function seekableBlob(media: Blob): Promise<Blob> {
  try {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(media) })
    const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() })
    const conversion = await Conversion.init({ input, output })
    if (!conversion.isValid) return media
    await conversion.execute()
    const buffer = output.target.buffer
    if (!buffer) return media
    return new Blob([buffer], { type: 'video/webm' })
  } catch {
    return media
  }
}
