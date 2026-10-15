import {
  distill,
  type DistillOutput,
  type ReportOptions,
  type Transcriber,
} from '@dested/video-to-prompt'
import { polishTranscript } from './polish'
import { transcribeInCloud } from './transcribe'
import { uploadWalkthrough } from './upload'
import type { ClipInput, DistillResult, StageProgress } from './types'

/**
 * The phone and upload pipeline: already-recorded clips in, an uploaded
 * walkthrough out. The distilling is @dested/video-to-prompt's `distill()` —
 * keyframes, contact sheets, report.md, MANIFEST.txt and the per-take JSON —
 * with Handback's cloud transcriber and cleanup pass plugged in. What this file
 * adds is the upload: declared, PUT and finalized, because the viewer,
 * `cli/push.ts` and the MCP brief all read that one file set.
 */

export interface DistillOptions {
  token: string
  /** null = the token owner's personal space. */
  teamId: string | null
  projectId: string | null
  title: string
  /**
   * 'human' = the video is the deliverable: no keyframes, no contact sheets and
   * no report.md (there is no agent to brief — the walkthrough is hidden from
   * agent lists), but the transcript work and the rest of the file set are
   * unchanged, so the viewer's cloud editor reads a human upload exactly like
   * an extension one. Same contract as live-upload.ts's human branch.
   */
  kind?: 'agent' | 'human'
  /** What the recording is about, for an agent handback — forwarded to the
   *  declare so the brief can frame the work. Untagged when absent. */
  intent?: 'bug' | 'feature' | 'idea'
  onProgress: (p: StageProgress) => void
  signal?: AbortSignal
}

/**
 * How the report names the cloud transcriber when the server doesn't say which
 * engine answered (one deployed before it did). Same words as the server's own
 * fallback in server/brief.ts.
 */
export const CLOUD_LABEL = 'hosted speech-to-text (Deepgram nova-3 or Whisper large-v3-turbo)'
/** recording.json's id for the cloud path. It predates Deepgram; the label says which engine actually answered. */
export const CLOUD_ID = 'groq'

/** The wording the uploaded report.md shares with the brief the server rebuilds from it. */
export const REPORT_OPTIONS: ReportOptions = { source: 'Handback', polishedBy: 'Claude' }

/** Handback's cloud speech-to-text, as the library's transcriber. */
export function cloudTranscriber(token: string): Transcriber {
  return {
    id: CLOUD_ID,
    label: CLOUD_LABEL,
    run: (audio, ctx) =>
      transcribeInCloud(audio, { token, signal: ctx.signal, onProgress: ctx.onProgress }),
  }
}

/** One decimal, no unit — the caller writes the "MB" once for the pair. */
export function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

/**
 * The distill alone, nothing uploaded: the file set exactly as distillAndUpload
 * would send it. A human handback drops report.md — the brief is authored for
 * an agent, and this walkthrough never reaches one.
 */
export async function distillForHandback(
  clips: ClipInput[],
  opts: Pick<DistillOptions, 'token' | 'title' | 'kind' | 'onProgress' | 'signal'>
): Promise<DistillOutput> {
  const human = opts.kind === 'human'
  const out = await distill(clips, {
    title: opts.title,
    transcriber: cloudTranscriber(opts.token),
    polish: (segments, ctx) =>
      polishTranscript(segments, { token: opts.token, signal: ctx.signal }),
    onProgress: opts.onProgress,
    signal: opts.signal,
    report: REPORT_OPTIONS,
    keyframes: !human,
  })
  return human ? { ...out, files: out.files.filter((f) => f.path !== 'report.md') } : out
}

export async function distillAndUpload(
  clips: ClipInput[],
  opts: DistillOptions
): Promise<DistillResult> {
  const out = await distillForHandback(clips, opts)
  if (opts.signal?.aborted) throw new Error('cancelled')

  const result = await uploadWalkthrough(out.session, out.takes, out.files, {
    token: opts.token,
    teamId: opts.teamId,
    projectId: opts.projectId,
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.intent ? { intent: opts.intent } : {}),
    signal: opts.signal,
    onProgress: (p) => {
      if (p.phase === 'upload') {
        opts.onProgress({
          stage: 'upload',
          pct: p.bytesTotal ? p.bytesDone / p.bytesTotal : 0,
          // Megabytes, not files: one video is 99% of the bytes and 1 of ~600
          // rows, so a file count reads as stuck for the whole upload.
          detail: `${megabytes(p.bytesDone)} of ${megabytes(p.bytesTotal)} MB`,
        })
        return
      }
      opts.onProgress({ stage: p.phase, pct: -1 })
    },
  })

  return {
    walkthroughId: result.walkthroughId,
    url: result.url,
    frameCount: out.frameCount,
    lineCount: out.lineCount,
    durationMs: out.durationMs,
    transcribed: out.transcribed,
    polished: out.polished,
  }
}
