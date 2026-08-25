import { blobs } from './db';
import { recDirName } from './format';
import { makeGrids, type GridFrame } from './grids';
import {
  buildManifestTxt,
  buildRecordingJson,
  buildReport,
  buildTranscriptTxt,
  sheetFile,
} from './report';
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

/**
 * The gripe's whole file set, built in memory at exactly the paths the original
 * wrote to disk: `report.md` and `MANIFEST.txt` at the root, one `rec-NN/` per
 * take. Those paths are the keys in the cloud, so a downloaded gripe is a
 * folder `cli/push.ts` can push straight back up.
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
  const text = (path: string, body: string) => {
    const contentType = contentTypeFor(path);
    files.push({ path, blob: new Blob([body], { type: contentType }), contentType });
  };
  for (const rec of recorded) {
    const dir = recDirName(rec.index);
    const kept: RecordingFrame[] = [];
    const gridFrames: GridFrame[] = [];
    for (const f of human ? [] : rec.meta.frames) {
      const blob = await blobs.get(`${rec.id}:frame:${f.index}`);
      if (!blob) {
        missing++;
        continue;
      }
      // f.file is take-relative (frames/03-0125.jpg) — the take dir goes in front.
      files.push({ path: `${dir}/${f.file}`, blob, contentType: contentTypeFor(f.file) });
      kept.push(f);
      gridFrames.push({ blob, label: f.file.split('/').pop()! });
    }
    // The sheets batch these kept frames nine at a time, which is exactly how the
    // report maps a frame to its sheet — one list, one batching, one set of paths.
    for (const [i, sheet] of (await makeGrids(gridFrames)).entries()) {
      const path = sheetFile(i + 1, `${dir}/`);
      files.push({ path, blob: sheet, contentType: contentTypeFor(path) });
    }
    const take: Recording = { ...rec, meta: { ...rec.meta, frames: kept } };
    takes.push(take);
    text(`${dir}/transcript.txt`, buildTranscriptTxt(take.meta));
    text(`${dir}/recording.json`, buildRecordingJson(target, take));
    const video = await blobs.get(`${rec.id}:video`);
    if (video) {
      const path = `${dir}/${take.meta.videoFile}`;
      files.push({ path, blob: video, contentType: contentTypeFor(path) });
    }
  }
  // The summaries describe the whole set, so they go last — written from the takes
  // as shipped, not as recorded.
  if (!human) {
    text('report.md', buildReport(target, takes));
    text('MANIFEST.txt', buildManifestTxt(target, takes));
  }
  return { files, takes, missing };
}
