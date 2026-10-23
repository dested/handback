import {
  buildManifestTxt,
  buildRecordingJson,
  buildReport,
  buildTranscriptTxt,
  makeGrids,
  mmss,
  pad2,
  recDirName,
  sheetFile,
  type GridFrame,
  type ReportOptions,
} from '@dested/video-to-prompt';
import { blobs, frameBlobKey } from './db';
import { contentTypeFor, type GripeFile } from './upload';
import { sessionKind, type Recording, type RecordingFrame, type Session } from './types';

/** The upload, and the takes exactly as it describes them. */
export interface Bundle {
  files: GripeFile[];
  /** Takes whose frame lists hold only the frames that are really in `files`. */
  takes: Recording[];
  /** Keyframes whose blob had gone missing — evidence we no longer have. */
  missing: number;
}

/** The report's producer line and polish credit — the server rebuilds the brief with its own. */
const REPORT_OPTIONS: ReportOptions = { source: 'Handback Recorder', polishedBy: 'Claude' };

/**
 * What the report says wrote the words, for a take that only carries the id.
 * `groq` is the server's /transcribe (the same endpoint and label /record ships
 * with), `whisper` the on-device pass.
 */
const TRANSCRIBER_LABELS: Record<string, string> = {
  groq: 'hosted speech-to-text (Deepgram nova-3 or Whisper large-v3-turbo)',
  whisper: 'Whisper small.en, on-device',
};

/** A take with no measured duration still occupies a second of the clock, as in the library's timeline. */
const MIN_SPAN_MS = 1000;

/** A contact-sheet tile's caption — the library's distill writes the same one. */
function tileLabel(frame: RecordingFrame, axisStart: number): string {
  const held =
    frame.transient && frame.held !== undefined
      ? ` · gone after ${(frame.held / 1000).toFixed(1)} s`
      : '';
  const detail = frame.detail ? ` · on ${pad2(frame.detail.of)}` : '';
  return `${pad2(frame.index)} · ${mmss(axisStart + frame.t)}${detail}${held}`;
}

/**
 * The gripe's whole file set, built in memory at exactly the paths the original
 * wrote to disk: `report.md` and `MANIFEST.txt` at the root, one `rec-NN/` per
 * take. Those paths are the keys in the cloud, so a downloaded gripe is a
 * folder `cli/push.ts` can push straight back up. The prose and the sheets are
 * @dested/video-to-prompt's builders, the same ones /record and /upload ship
 * through, so the extension's walkthroughs carry change boxes, close-ups and
 * `seenMs` like every other door's.
 *
 * The frame blobs are resolved *before* any prose is written, and the takes handed
 * back carry only the frames that resolved. Everything downstream then describes
 * what is actually in the upload: the report's citations, its frame-to-sheet map,
 * the contact sheets, and the declared counts. This matters more here than it did
 * on disk — a report citing a file that never made it was a dangling relative path
 * you could go hunting for, and is now a 404 inside the reading agent's brief.
 */
export async function buildFileSet(target: Session, recorded: Recording[]): Promise<Bundle> {
  // A human handback ships the raw takes and nothing written for a reader:
  // no frames (there are none), no contact sheets, no report.md, no
  // MANIFEST. The editing happens in Handback — see the cloud editor — and
  // it needs exactly the video, the machine-readable take, and the words.
  const human = sessionKind(target) === 'human';
  const files: GripeFile[] = [];
  const takes: Recording[] = [];
  let missing = 0;
  /** Where this take starts on the walkthrough's one clock: the sheets caption frames by it. */
  let axisStart = 0;
  const text = (path: string, body: string) => {
    const contentType = contentTypeFor(path);
    files.push({ path, blob: new Blob([body], { type: contentType }), contentType });
  };
  for (const rec of [...recorded].sort((a, b) => a.index - b.index)) {
    const dir = recDirName(rec.index);
    const kept: RecordingFrame[] = [];
    const gridFrames: GridFrame[] = [];
    /** Index → JPEG, so a close-up's tile can lay itself over the frame it is part of. */
    const byIndex = new Map<number, Blob>();
    for (const f of human ? [] : rec.meta.frames) {
      const blob = await blobs.get(frameBlobKey(rec.id, f));
      if (!blob) {
        missing++;
        continue;
      }
      byIndex.set(f.index, blob);
      // f.file is take-relative (frames/03-0125.jpg) — the take dir goes in front.
      files.push({ path: `${dir}/${f.file}`, blob, contentType: contentTypeFor(f.file) });
      kept.push(f);
    }
    for (const f of kept) {
      const blob = byIndex.get(f.index);
      if (!blob) continue;
      const base = f.detail ? byIndex.get(f.detail.of) : undefined;
      gridFrames.push({
        blob,
        label: tileLabel(f, axisStart),
        change: f.change,
        ...(f.detail && base ? { detail: { base, box: f.detail.box } } : {}),
      });
    }
    // The sheets batch these kept frames nine at a time, which is exactly how the
    // report maps a frame to its sheet — one list, one batching, one set of paths.
    for (const [i, sheet] of (await makeGrids(gridFrames)).entries()) {
      const path = sheetFile(i + 1, `${dir}/`);
      files.push({ path, blob: sheet, contentType: contentTypeFor(path) });
    }
    const label = rec.meta.transcriber ? TRANSCRIBER_LABELS[rec.meta.transcriber] : undefined;
    const take: Recording = {
      ...rec,
      meta: {
        ...rec.meta,
        frames: kept,
        ...(label && !rec.meta.transcriberLabel ? { transcriberLabel: label } : {}),
      },
    };
    takes.push(take);
    text(`${dir}/transcript.txt`, buildTranscriptTxt(take.meta));
    text(`${dir}/recording.json`, buildRecordingJson(target, take));
    const video = await blobs.get(`${rec.id}:video`);
    if (video) {
      const path = `${dir}/${take.meta.videoFile}`;
      files.push({ path, blob: video, contentType: contentTypeFor(path) });
    }
    axisStart += Math.max(rec.meta.durationMs, MIN_SPAN_MS);
  }
  // The summaries describe the whole set, so they go last — written from the takes
  // as shipped, not as recorded.
  if (!human) {
    text('report.md', buildReport(target, takes, REPORT_OPTIONS));
    text('MANIFEST.txt', buildManifestTxt(target, takes, REPORT_OPTIONS));
  }
  return { files, takes, missing };
}
