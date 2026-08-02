/**
 * What to call the take's raw file, and what to declare it as. The extension
 * only ever produced `walkthrough.webm` because MediaRecorder only ever handed
 * it webm; a phone hands over whatever its OS recorder writes, and the report,
 * the MANIFEST and the declare all read the name from one place — so it has to
 * be the container that actually arrived.
 */

export interface ClipContainer {
  videoFile: string
  contentType: string
}

export function containerFor(type: string, hasVideo: boolean): ClipContainer {
  const mime = type.split(';')[0].trim().toLowerCase()
  switch (mime) {
    case 'video/mp4':
      return { videoFile: 'walkthrough.mp4', contentType: 'video/mp4' }
    case 'video/webm':
      return { videoFile: 'walkthrough.webm', contentType: 'video/webm' }
    case 'video/quicktime':
      return { videoFile: 'walkthrough.mov', contentType: 'video/quicktime' }
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/aac':
      // One name for the whole m4a family; x-m4a and aac are not content types S3 should learn.
      return { videoFile: 'walkthrough.m4a', contentType: 'audio/mp4' }
    case 'audio/webm':
      return { videoFile: 'walkthrough.webm', contentType: 'audio/webm' }
    case 'audio/mpeg':
      return { videoFile: 'walkthrough.mp3', contentType: 'audio/mpeg' }
  }
  if (mime.startsWith('video/')) return { videoFile: 'walkthrough.mp4', contentType: mime }
  if (mime.startsWith('audio/')) return { videoFile: 'walkthrough.m4a', contentType: mime }
  // Some Android pickers hand over a file with no type at all; the probe already
  // knows whether there were pixels in it.
  return hasVideo
    ? { videoFile: 'walkthrough.mp4', contentType: 'video/mp4' }
    : { videoFile: 'walkthrough.m4a', contentType: 'audio/mp4' }
}
