import type {
  PageEvent,
  Recording,
  RecordingFrame,
  RecordingMeta,
  Session,
  TranscriptSegment,
} from './types';
import { GRID_PER_SHEET } from './types';
import type { PartSpan } from './timeline';
import { framePos, linePos, partSpans, totalMs } from './timeline';
import { dateTime, hhmm, mmss, recDirName } from './format';

/**
 * The whole point of this extension is this file. It is written for a coding
 * agent first and a human second: evidence up front, no prose the model has to
 * wade through, and every image path relative so the file set can be moved —
 * which, here, means it survives the trip through the cloud unchanged.
 *
 * A gripe is one time axis. Spoken lines and keyframes are emitted in the order they
 * sit on that axis, which is the order the human left them in after editing:
 * `src/lib/timeline.ts` computes the positions and the panel's timeline draws the same
 * ones, so a line dragged in the UI moves here too. The recording may have been made in
 * several takes; they are laid end to end and the seams never surface in the prose. Each
 * take owns a `rec-NN/` subtree, and this file is what prefixes those paths.
 *
 * Handback difference from the original: there is no local folder. The same paths are
 * uploaded as the gripe's file set and handed back by the `get_gripe` MCP tool, so the
 * report opens by naming the gripe rather than a directory on somebody's disk.
 */

/** format.ts is frozen and has no truncate; the report needs one and owns it. */
function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** The opening always applies. The paragraph after it is added only when there is a recording. */
const PREAMBLE_HEAD = `> **You are reading a gripe — a bug report recorded by a human using the running app.**
> Everything below sits on one timeline, in the order it happened — and the human
> pruned and reordered it before handing it over, so what is here is what they meant
> you to read. **Read the images:**
> they are the primary evidence, and the words are shorthand that assumes you looked.
> Every path is relative to the gripe's own file set — the paths the \`get_gripe\` MCP
> tool hands you, and the paths inside the folder if you downloaded it. Wherever
> this report caps or thins what it shows you it prints the count — when you see one,
> you are looking at a subset, and the rest is in the gripe.`;

const PREAMBLE_PARTS = `> The **walkthrough** is a narrated screen recording, distilled. Read it in this order:
> first the **contact sheets** — nine keyframes per image, in order, covering the
> *whole* recording at a fraction of the tokens — then the flow below, which is the same
> recording as text. A full still is inlined only where the narration is pointing at
> something; every other keyframe is listed by filename (\`rec-NN/frames/NN-mmss.jpg\`)
> so you can open one when you need it. **The mmss inside a filename is time within
> that file's own video** (\`rec-NN/walkthrough.webm\`); every time *printed* below is
> a position on this report's single timeline, so the two do not have to match.
> A spoken line covers a **window, not an
> instant**: it is stamped where the speaker started talking, and people narrate what
> just happened, so each line names the frames it is actually about — trust that range
> over the stamp. An accent crosshair drawn on a frame is the mouse pointer, and
> \`pointer\` under a frame names what it was over — that is how "this one over here"
> resolves. It may have been recorded in more than one sitting; those are laid end to
> end on a single clock, so every time below reads straight through and no arithmetic
> is asked of you.`;

function preamble(hasParts: boolean): string {
  const blocks = hasParts ? [PREAMBLE_HEAD, PREAMBLE_PARTS] : [PREAMBLE_HEAD];
  return blocks.join('\n>\n');
}

/**
 * Where this gripe lives, for an agent that arrived holding only the report text.
 * The original printed an absolute folder path the user had typed once; there is no
 * folder now, so it names the gripe in the workspace and how to pull the rest of it.
 * Omitted when the caller doesn't know the URL — the cloud mints the gripe's id
 * during the upload, after these bytes are already counted, so the first copy of a
 * report is deliberately silent rather than guessing at a link.
 */
function gripeLines(url?: string): string[] {
  if (!url) return [];
  return [
    `**This gripe:** \`${url}\` — pull the images, video, and per-take JSON with the handback MCP tool \`get_gripe\`; every path below is one of the files it returns.`,
    '',
  ];
}

/** How far around a spoken line we consider "the frames that line is about". */
const SPEECH_LEAD_MS = 2000;
const SPEECH_TAIL_MS = 2500;
/** Fallback line length when the transcriber gave no end time. */
const WORD_MS = 380;
const MIN_LINE_MS = 1200;
/** Ceilings on inlined stills, per take — the complaint that started all this was 68 for 6 lines. */
const MAX_INLINE = 16;
const QUIET_INLINE = 12;
/** A silence this long closes a section; whatever is said next opens the one after. */
const CHAPTER_GAP_MS = 15000;

function spokenMs(seg: TranscriptSegment): number {
  return seg.d ?? Math.max(MIN_LINE_MS, seg.text.split(/\s+/).length * WORD_MS);
}

/** A spoken line plus the window of screen time it plausibly refers to. Take-local. */
interface Spoken {
  seg: TranscriptSegment;
  end: number;
  from: number;
  to: number;
}

/** Take-local windows, for the per-take files (`transcript.txt`, `recording.json`, MANIFEST). */
function spokenWindows(rec: RecordingMeta): Spoken[] {
  return rec.transcript.map((seg) => {
    const end = seg.t + spokenMs(seg);
    return { seg, end, from: Math.max(0, seg.t - SPEECH_LEAD_MS), to: end + SPEECH_TAIL_MS };
  });
}

/** The same line, placed on the gripe's axis. This is what the report reads. */
interface Line {
  rec: Recording;
  seg: TranscriptSegment;
  pos: number;
  end: number;
  from: number;
  to: number;
}

/** A keyframe on the axis, carrying the `rec-NN/` its paths need and a key that survives takes. */
interface Shot {
  rec: Recording;
  frame: RecordingFrame;
  pos: number;
  prefix: string;
  sheet?: number;
  /** Frame numbers restart in every take, so identity is the pair. */
  key: string;
}

interface Trace {
  pos: number;
  ev: PageEvent;
}

function axisLines(recordings: Recording[], spans: PartSpan[]): Line[] {
  const out: Line[] = [];
  for (const rec of recordings) {
    const span = spans.find((s) => s.rec.id === rec.id);
    for (const seg of rec.meta.transcript) {
      const pos = linePos(rec, seg, spans);
      const end = pos + spokenMs(seg);
      let from = Math.max(0, pos - SPEECH_LEAD_MS);
      let to = end + SPEECH_TAIL_MS;
      // Takes abut with no gap, so an unmoved line's window would otherwise reach
      // across the seam and claim frames from a sitting recorded hours later. A
      // line a human dragged is a deliberate placement — that one claims globally.
      if (seg.tl === undefined && span) {
        from = Math.max(from, span.start);
        to = Math.min(to, span.end);
      }
      out.push({ rec, seg, pos, end, from, to });
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

function axisShots(recordings: Recording[], spans: PartSpan[]): Shot[] {
  const out: Shot[] = [];
  for (const rec of recordings) {
    const prefix = `${recDirName(rec.index)}/`;
    const sheets = sheetOf(rec.meta);
    for (const frame of rec.meta.frames) {
      out.push({
        rec,
        frame,
        prefix,
        pos: framePos(rec, frame, spans),
        sheet: sheets.get(frame.index),
        key: `${rec.id}:${frame.index}`,
      });
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

function axisEvents(recordings: Recording[], spans: PartSpan[]): Trace[] {
  const out: Trace[] = [];
  for (const rec of recordings) {
    // Event timestamps are absolute; the axis is not. A stamp from after the
    // recorder stopped must not drift into the next take, so pin it to this one.
    const span = spans.find((s) => s.rec.id === rec.id);
    const start = span?.start ?? 0;
    const end = span?.end ?? Infinity;
    for (const ev of rec.meta.events) {
      out.push({ pos: Math.min(end, start + Math.max(0, ev.ts - rec.meta.startedAt)), ev });
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/** frame index → the contact sheet it appears on. Batching must match `makeGrids`. */
function sheetOf(rec: RecordingMeta): Map<number, number> {
  const map = new Map<number, number>();
  rec.frames.forEach((f, i) => map.set(f.index, Math.floor(i / GRID_PER_SHEET) + 1));
  return map;
}

/**
 * Paths inside a take are stored take-relative; the report reads from the gripe root.
 *
 * Exported because the uploader has to send this exact path. On disk, a report citing
 * a file that wasn't there was a broken relative link you could go looking for; in the
 * workspace it is a 404 in the reading agent's brief. The citation and the upload are
 * built by one function so they cannot drift.
 */
export function sheetFile(n: number, prefix = ''): string {
  return `${prefix}grids/grid_${String(n).padStart(2, '0')}.jpg`;
}

/** Pick every nth of `pool` until `budget` is met — the thinning shape used for frames. */
function spread<T>(pool: T[], budget: number): T[] {
  if (budget <= 0 || !pool.length) return [];
  if (pool.length <= budget) return pool;
  const step = pool.length / budget;
  return Array.from({ length: budget }, (_, i) => pool[Math.floor(i * step)]);
}

/** The frames every take opens on, plus everything the human marked. These are never thinned. */
function mustShow(recordings: Recording[]): Set<string> {
  const keys = new Set<string>();
  for (const rec of recordings) {
    const first = rec.meta.frames[0];
    if (first) keys.add(`${rec.id}:${first.index}`);
    for (const f of rec.meta.frames) if (f.reason === 'mark') keys.add(`${rec.id}:${f.index}`);
  }
  return keys;
}

/**
 * Which frames get a full still. The must-haves always; otherwise the ones inside a
 * spoken window, thinned if the human talked the whole time. With no narration at all
 * there is nothing to aim at, so take a spread and lean on the sheets. The budget is
 * per take — a walkthrough recorded in three sittings is three times as long as one
 * recorded in one and must not be shown a third as thickly.
 */
function inlineShots(shots: Shot[], lines: Line[], recordings: Recording[]): Set<string> {
  const shown = mustShow(recordings);
  const takes = Math.max(1, recordings.length);
  const budget = (lines.length ? MAX_INLINE : QUIET_INLINE) * takes - shown.size;
  const pool = shots.filter(
    (s) => !shown.has(s.key) && (!lines.length || lines.some((l) => claims(l, s))),
  );
  for (const s of spread(pool, budget)) shown.add(s.key);
  return shown;
}

/**
 * Does this line point at this frame? Position alone is not enough: takes abut, so
 * a window ending exactly on the seam would reach the next take's first frame, 80s
 * of wall clock away. Anything a human moved is where they put it — those go by
 * position alone, which is the whole point of having moved them.
 */
function claims(line: Line, shot: Shot): boolean {
  if (shot.pos < line.from || shot.pos > line.to) return false;
  return line.seg.tl !== undefined || shot.frame.tl !== undefined || shot.rec.id === line.rec.id;
}

/** The frames a spoken line is pointing at. Frame numbers restart per take, so name files. */
function coverage(shots: Shot[], line: Line, hasSheets: boolean): string {
  const hit = shots.filter((s) => claims(line, s));
  // Never point at sheets that were never written — a take with no frames has none.
  if (!hit.length) {
    return hasSheets
      ? 'no keyframe inside that window — see the contact sheets'
      : 'no keyframe inside that window';
  }
  const first = hit[0];
  const last = hit[hit.length - 1];
  if (hit.length === 1) return `${mmss(first.pos)} — \`${first.prefix}${first.frame.file}\``;
  return `${hit.length} frames, ${mmss(first.pos)}–${mmss(last.pos)} — \`${first.prefix}${first.frame.file}\` … \`${last.prefix}${last.frame.file}\``;
}

/** A spoken line or an error, already rendered, carrying where it lands on the axis. */
interface Beat {
  pos: number;
  lines: string[];
}

function lineBeat(line: Line, shots: Shot[], hasSheets: boolean): Beat {
  return {
    pos: line.pos,
    lines: [
      '',
      `> **${mmss(line.pos)}–${mmss(line.end)}** ${line.seg.text}`,
      `> ↳ about ${coverage(shots, line, hasSheets)}`,
    ],
  };
}

function traceBeat(trace: Trace): Beat {
  const detail = trace.ev.detail ? ` — ${truncate(trace.ev.detail, 200)}` : '';
  return {
    pos: trace.pos,
    lines: [
      '',
      `- \`[${trace.ev.level}] @ ${mmss(trace.pos)}\` ${truncate(trace.ev.message, 200)}${detail}`,
    ],
  };
}

function pointerLine(frame: RecordingFrame): string | null {
  const p = frame.pointer;
  if (!p?.selector) return null;
  const text = p.text ? ` — "${truncate(p.text, 60)}"` : '';
  const drawn = p.nx === undefined ? ' (position not drawable on this capture)' : '';
  return `- **pointer** \`${p.selector}\`${text}${drawn}`;
}

/** One inlined still. */
function frameBlock(shot: Shot): string[] {
  const marked = shot.frame.reason === 'mark';
  const at = mmss(shot.pos);
  const bits = [`${marked ? '★ ' : ''}${at}`];
  if (marked) bits.push('the human marked this moment');
  bits.push(`\`${shot.prefix}${shot.frame.file}\``);
  if (shot.sheet) bits.push(`also on \`${sheetFile(shot.sheet, shot.prefix)}\``);
  const lines = [
    '---',
    '',
    `#### ${bits.join(' · ')}`,
    '',
    `![keyframe at ${at}](${shot.prefix}${shot.frame.file})`,
  ];
  const pointer = pointerLine(shot.frame);
  if (pointer) lines.push('', pointer);
  return lines;
}

/** Past this many, a run stops naming every file and hands the rest to the sheets. */
const RUN_NAMES = 6;

/**
 * A run of frames nobody narrated over: one line, not one image each — but every
 * file in it is named, because the report promises the rest are "listed by
 * filename, not dropped" and a first…last range names neither of the middles.
 */
function runLine(run: Shot[]): string {
  const first = run[0];
  const last = run[run.length - 1];
  const grids = [
    ...new Set(run.map((s) => (s.sheet ? sheetFile(s.sheet, s.prefix) : '')).filter(Boolean)),
  ];
  const on = grids.length ? ` · on ${grids.map((g) => `\`${g}\``).join(', ')}` : '';
  if (run.length === 1) return `- ${mmss(first.pos)} — \`${first.prefix}${first.frame.file}\`${on}`;
  const named = run.length <= RUN_NAMES ? run : run.slice(0, RUN_NAMES - 1);
  const rest = run.length - named.length;
  const files = named.map((s) => `\`${s.prefix}${s.frame.file}\``).join(', ');
  const more = rest ? ` (+${rest} more, all on the contact sheets)` : '';
  return `- ${mmss(first.pos)}–${mmss(last.pos)} — ${run.length} keyframes, nothing said over them: ${files}${more}${on}`;
}

/** How much to trust the words — the ASR error that sent an agent to the wrong file. */
function transcriptCaveat(recordings: Recording[]): string[] {
  const spoken = recordings.filter((r) => r.meta.transcript.length);
  if (!spoken.length) return [];
  if (spoken.every((r) => r.meta.reviewed)) {
    return [
      '> The speaker read this transcript back and corrected it — the wording is theirs.',
      '',
    ];
  }
  const engines = [...new Set(spoken.map((r) => engineName(r.meta)))];
  const some = spoken.some((r) => r.meta.reviewed);
  return [
    some
      ? `> The transcript is machine-transcribed (${engines.join(' / ')}); **only part of it was read back by the speaker**.`
      : `> The transcript is machine-transcribed (${engines.join(' / ')}) and **was not checked by the speaker**.`,
    '> Speech recognition mangles exactly the words that matter most — nouns, units, small numbers.',
    '> Where a word contradicts the frames or the code, believe the frames.',
    '',
  ];
}

function scopeLines(recordings: Recording[]): string[] {
  const scopes = recordings.map((r) => r.meta.eventScope).filter(Boolean) as string[];
  const events = recordings.reduce((n, r) => n + r.meta.events.length, 0);
  const dropped = recordings.reduce((n, r) => n + (r.meta.droppedEvents ?? 0), 0);
  if (!scopes.length || (!events && !dropped)) return [];
  const from = [...new Set(scopes)].map((s) => `\`${s}\``).join(', ');
  const lost = dropped ? ` ${dropped} event(s) from other tabs were dropped.` : '';
  return [
    `> Console/network lines below come only from ${from} — the tab that was in front while recording.${lost}`,
    '',
  ];
}

/** A recording reassembled from chunks — say so, never imply it is whole. */
function interruptedLines(recordings: Recording[]): string[] {
  const hurt = recordings.filter((r) => r.interrupted);
  if (!hurt.length) return [];
  return [
    `_(interrupted — the panel died mid-recording; ${hurt.length === 1 ? 'a stretch of' : `${hurt.length} stretches of`} the walkthrough may be missing)_`,
    '',
  ];
}

/** Where one `##` section ends and the next opens: a silence runs long. */
function chapterBreaks(lines: Line[]): number[] {
  const cuts: number[] = [];
  let reach = lines[0]?.to ?? 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].pos - reach > CHAPTER_GAP_MS) cuts.push(lines[i].from);
    reach = Math.max(reach, lines[i].to);
  }
  return [...new Set(cuts)].sort((a, b) => a - b);
}

/** A stretch of the axis, rendered, carrying the position it starts at. */
interface Block {
  pos: number;
  lines: string[];
}

/**
 * The walkthrough as `##` sections, one per stretch of narration: frames anchor the
 * flow, spoken lines and errors land under the last frame at or before them, and
 * everything nobody talked over collapses to one line per run. Computed across every
 * take at once, which is what makes a dragged line land where the human dropped it.
 */
function walkthroughBlocks(
  shots: Shot[],
  lines: Line[],
  traces: Trace[],
  shown: Set<string>,
  cuts: number[],
  hasSheets: boolean,
): Block[] {
  interface Entry {
    pos: number;
    rank: number;
    shot?: Shot;
    line?: Line;
    trace?: Trace;
  }
  const entries: Entry[] = [
    ...shots.map((shot) => ({ pos: shot.pos, rank: 0, shot })),
    ...lines.map((line) => ({ pos: line.pos, rank: 1, line })),
    ...traces.map((trace) => ({ pos: trace.pos, rank: 2, trace })),
  ];
  entries.sort((a, b) => a.pos - b.pos || a.rank - b.rank);

  const chapters: Entry[][] = [[]];
  let cut = 0;
  for (const entry of entries) {
    while (cut < cuts.length && entry.pos >= cuts[cut]) {
      cut++;
      chapters.push([]);
    }
    chapters[chapters.length - 1].push(entry);
  }

  return chapters
    .filter((chapter) => chapter.length)
    .map((chapter) => {
      const frames = chapter.flatMap((e) => (e.shot ? [e.shot] : []));
      const beats = chapter.flatMap((e) =>
        e.line ? [lineBeat(e.line, shots, hasSheets)] : e.trace ? [traceBeat(e.trace)] : [],
      );
      const opener = chapter.find((e) => e.line)?.line;
      const out: string[] = [];
      out.push(
        opener
          ? `## ${mmss(opener.pos)} — "${truncate(opener.seg.text, 80)}"`
          : `## ${mmss(chapter[0].pos)} — nothing said over these frames`,
      );
      out.push('');

      // Every beat lands under the last frame at or before it — so anything spoken
      // before the first frame rides with it, and the final frame absorbs the tail.
      let cursor = 0;
      let run: Shot[] = [];
      const flushRun = () => {
        if (run.length) out.push(runLine(run), '');
        run = [];
      };

      frames.forEach((shot, i) => {
        const end = frames[i + 1]?.pos ?? Infinity;
        const due = cursor < beats.length && beats[cursor].pos < end;
        if (shown.has(shot.key)) {
          flushRun();
          // Nothing under the heading yet: it is already the separator.
          const block = frameBlock(shot);
          out.push(...(out.length === 2 ? block.slice(2) : block));
        } else {
          // A run never crosses a seam: the mmss inside the filenames is take-local,
          // so first…last across two takes reads backwards.
          if (run.length && run[run.length - 1].rec.id !== shot.rec.id) flushRun();
          run.push(shot);
          if (due) flushRun(); // narration has to stay in order with the frames it follows
        }
        while (cursor < beats.length && beats[cursor].pos < end) {
          out.push(...beats[cursor].lines);
          cursor++;
        }
        if (shown.has(shot.key) || due) out.push('');
      });
      flushRun();
      // No frames means nothing to anchor to, but the narration still has to survive.
      for (; cursor < beats.length; cursor++) out.push(...beats[cursor].lines);
      if (out[out.length - 1] !== '') out.push('');
      return { pos: chapter[0].pos, lines: out };
    });
}

/** Every take's sheets in axis order. Batching must match `makeGrids`: meta order, nine at a time. */
function contactSheets(spans: PartSpan[]): { file: string; from: number; to: number }[] {
  const out: { file: string; from: number; to: number }[] = [];
  for (const span of spans) {
    const prefix = `${recDirName(span.rec.index)}/`;
    const frames = span.rec.meta.frames;
    for (let n = 1; n <= Math.ceil(frames.length / GRID_PER_SHEET); n++) {
      const batch = frames.slice((n - 1) * GRID_PER_SHEET, n * GRID_PER_SHEET);
      // A moved frame can leave its sheet out of order, so bound the label rather than assume.
      const at = batch.map((f) => framePos(span.rec, f, spans));
      out.push({ file: sheetFile(n, prefix), from: Math.min(...at), to: Math.max(...at) });
    }
  }
  // Moved frames can put a later take's sheet earlier on the axis; "in order"
  // has to mean axis order, which is the order everything else here is in.
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** Two sheets covering the same stretch — true only after a human reordered items. */
function sheetsOverlap(sheets: { from: number; to: number }[]): boolean {
  return sheets.some((sheet, i) => i > 0 && sheet.from < sheets[i - 1].to);
}

/**
 * One report for the whole gripe, in axis order: every moment of the walkthrough on a
 * single clock, exactly as the human left them after editing. `url` is the gripe's
 * page in the Handback workspace, printed when the caller knows it.
 */
export function buildReport(session: Session, recordings: Recording[], url?: string): string {
  const spans = partSpans(recordings);
  const takes = spans.map((s) => s.rec);
  const shots = axisShots(takes, spans);
  const lines = axisLines(takes, spans);
  const traces = axisEvents(takes, spans);
  const shown = inlineShots(shots, lines, takes);
  const marks = shots.filter((s) => s.frame.reason === 'mark').length;

  // The span the evidence covers, not when the gripe was last touched — a rename
  // hours later must not stretch the recorded window.
  const first = takes.length ? Math.min(...takes.map((r) => r.createdAt)) : session.createdAt;
  const last = takes.length
    ? Math.max(...takes.map((r) => r.createdAt + r.meta.durationMs))
    : session.updatedAt;
  const origin = takes.find((r) => r.meta.eventScope)?.meta.eventScope ?? session.origin;

  const out: string[] = [];
  out.push(`# Gripe — ${session.name}`);
  out.push('');
  const counts: string[] = [];
  if (takes.length) counts.push(`\`walkthrough ${mmss(totalMs(spans))}\``);
  if (shots.length) counts.push(`\`${shots.length} keyframe${shots.length === 1 ? '' : 's'}\``);
  if (lines.length) counts.push(`\`${lines.length} spoken line${lines.length === 1 ? '' : 's'}\``);
  if (marks) counts.push(`\`${marks} marked\``);
  if (traces.length) {
    counts.push(`\`${traces.length} error${traces.length === 1 ? '' : 's'} captured\``);
  }
  if (!counts.length) counts.push('`empty`');
  out.push(`${counts.join(' · ')} · recorded ${dateTime(first)}–${hhmm(last)} · ${origin}`);
  out.push('');
  out.push(...gripeLines(url));
  out.push(preamble(takes.length > 0));
  out.push('');

  if (takes.length) {
    const files = spans
      .map(
        (s) =>
          `\`${recDirName(s.rec.index)}/${s.rec.meta.videoFile}\` (${mmss(s.rec.meta.durationMs)})`,
      )
      .join(' · ');
    out.push(
      `**Video:** ${files} — the raw recording, for humans. Everything below is distilled from it.`,
    );
    out.push('');
  }
  out.push(...interruptedLines(takes));
  out.push(...transcriptCaveat(takes));
  out.push(...scopeLines(takes));

  const sheets = contactSheets(spans);
  if (sheets.length) {
    out.push('### Contact sheets — read these first');
    out.push('');
    const jumbled = sheetsOverlap(sheets) ? ' (ranges overlap — items were reordered)' : '';
    out.push(
      `${shots.length} keyframes across ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}, nine per image, in order, each tile labeled with its filename.${jumbled}`,
    );
    out.push('');
    sheets.forEach((sheet, i) => {
      const span = `${mmss(sheet.from)}–${mmss(sheet.to)}`;
      out.push(`![contact sheet ${i + 1} of ${sheets.length} — ${span}](${sheet.file})`);
      out.push('');
    });
  }
  if (shots.length) {
    out.push(
      `${shown.size} of ${shots.length} keyframe${shots.length === 1 ? '' : 's'} are inlined below — the moments the narration is pointing at${marks ? ', plus everything the human marked' : ''}. The rest are named by filename in the flow, run by run; only where a silent run passes ${RUN_NAMES} frames are the first ${RUN_NAMES - 1} named and the remainder counted. Nothing is dropped, and every keyframe is on the sheets above. Machine-readable: \`rec-NN/recording.json\` — frame times, pointer positions, transcript windows, events. Words alone: \`rec-NN/transcript.txt\`.`,
    );
    out.push('');
  }

  const blocks: Block[] = walkthroughBlocks(
    shots,
    lines,
    traces,
    shown,
    chapterBreaks(lines),
    sheets.length > 0,
  ).sort((a, b) => a.pos - b.pos);

  for (const block of blocks) {
    out.push('---');
    out.push('');
    out.push(...block.lines);
  }

  const machine = recordings.length ? '`rec-NN/recording.json`' : '`MANIFEST.txt`';
  out.push('---');
  out.push('');
  out.push(
    `<sub>Recorded with the Handback Recorder. Machine-readable copy: ${machine}. Full listing of this gripe: \`MANIFEST.txt\`.</sub>`,
  );
  out.push('');
  return out.join('\n');
}

export function buildTranscriptTxt(rec: RecordingMeta): string {
  if (!rec.transcript.length) return '(no narration)\n';
  const lines = spokenWindows(rec).map((s) => `[${mmss(s.seg.t)}–${mmss(s.end)}] ${s.seg.text}`);
  return `${lines.join('\n')}\n`;
}

/**
 * One take, machine-readable. The shape is frozen by two readers: the Handback viewer
 * and `cli/push.ts`, which re-derives a gripe's takes from these files when somebody
 * pushes a downloaded folder back up.
 */
export function buildRecordingJson(session: Session, recording: Recording, url?: string): string {
  const rec = recording.meta;
  return JSON.stringify(
    {
      session: {
        name: session.name,
        slug: session.slug,
        url,
        createdAt: new Date(session.createdAt).toISOString(),
        origin: session.origin,
      },
      recording: {
        part: recording.index,
        dir: recDirName(recording.index),
        interrupted: Boolean(recording.interrupted),
        startedAt: new Date(rec.startedAt).toISOString(),
        durationMs: rec.durationMs,
        sampled: rec.sampled,
        video: rec.videoFile,
        transcriber: rec.transcriber ?? 'webspeech',
        transcriptReviewed: Boolean(rec.reviewed),
        eventScope: rec.eventScope,
        droppedEvents: rec.droppedEvents ?? 0,
        frames: rec.frames.map((f) => ({
          index: f.index,
          at: mmss(f.t),
          tMs: f.t,
          file: f.file,
          reason: f.reason,
          dist: f.dist,
          pointer: f.pointer,
        })),
        transcript: spokenWindows(rec).map((s) => ({
          at: mmss(s.seg.t),
          tMs: s.seg.t,
          // The window this line is about, not just where it started.
          endMs: s.end,
          aboutFromMs: s.from,
          aboutToMs: s.to,
          text: s.seg.text,
        })),
        events: rec.events.map((e) => ({
          level: e.level,
          at: mmss(Math.max(0, e.ts - rec.startedAt)),
          message: e.message,
          detail: e.detail,
        })),
      },
    },
    null,
    2,
  );
}

/**
 * Which engine wrote the words. Named plainly, because an agent reading the
 * report should weigh a large-model pass differently from live dictation.
 */
function engineName(meta: Pick<RecordingMeta, 'transcriber' | 'polished'>): string {
  const engine =
    meta.transcriber === 'groq'
      ? 'Whisper large-v3-turbo, hosted'
      : meta.transcriber === 'whisper'
        ? 'Whisper small.en, on-device'
        : 'live dictation, Web Speech';
  // A model rewrote the wording; say so. The reader is deciding how much to
  // trust these words, and that's a fact they need.
  return meta.polished ? `${engine}, wording cleaned up by Claude` : engine;
}

/** Where the lines in transcript.txt came from — the agent should weigh them differently. */
function transcriptSource(rec: RecordingMeta): string {
  return `${engineName(rec)} — ${rec.reviewed ? 'read back and corrected by the speaker' : 'NOT checked by the speaker; treat wording as approximate'}`;
}

/** `name  description` with the descriptions lined up. */
function rowLines(rows: [string, string][]): string[] {
  const width = rows.reduce((max, [name]) => Math.max(max, name.length), 0) + 2;
  return rows.map(([name, what]) => `${name.padEnd(width)}${what}`);
}

/** Stats up top, transcripts inline — the whole gripe's file set, listed. */
export function buildManifestTxt(
  session: Session,
  recordings: Recording[],
  url?: string,
): string {
  const parts = [...recordings].sort((a, b) => a.index - b.index);
  const rows: [string, string][] = [
    ['report.md', 'the whole gripe in order, on one timeline. read this one'],
    ['MANIFEST.txt', 'this listing'],
  ];
  for (const part of parts) {
    const rec = part.meta;
    const dir = recDirName(part.index);
    const marks = rec.frames.filter((f) => f.reason === 'mark').length;
    const sheets = Math.ceil(rec.frames.length / GRID_PER_SHEET);
    rows.push([
      `${dir}/`,
      `part ${part.index} — walkthrough, ${Math.round(rec.durationMs / 1000)}s, ${rec.transcript.length} spoken line(s)${part.interrupted ? ' (interrupted — tail may be missing)' : ''}`,
    ]);
    rows.push([
      `${dir}/frames/`,
      `${rec.frames.length} keyframes, NN-mmss.jpg (the mmss is time inside this part's own ${rec.videoFile}, not a position in report.md's timeline) — 0.5s candidates + live dedup, deduped from ${rec.sampled} sampled${marks ? `, ${marks} marked by hand` : ''}`,
    ]);
    if (sheets) {
      rows.push([
        `${dir}/grids/`,
        `${sheets} contact sheet(s), ${GRID_PER_SHEET} frames each, in order`,
      ]);
    }
    rows.push([
      `${dir}/transcript.txt`,
      rec.transcript.length ? transcriptSource(rec) : '(none — no narration was captured)',
    ]);
    rows.push([
      `${dir}/recording.json`,
      `frame times, pointer positions, transcript windows, ${rec.events.length} error(s)${rec.eventScope ? ` from ${rec.eventScope}` : ''}${rec.droppedEvents ? ` (${rec.droppedEvents} dropped from other tabs)` : ''}`,
    ]);
    rows.push([`${dir}/${rec.videoFile}`, 'raw video (for humans)']);
  }

  const lines = [
    `source: handback recorder — ${session.name}`,
    ...(url ? [`gripe: ${url}`] : []),
    `recorded: ${dateTime(session.createdAt)} | ${parts.length} part(s) | ${session.origin}`,
    'note: every path below is relative to this gripe',
    '--- files ---',
    ...rowLines(rows),
  ];
  const spoken = parts.filter((p) => p.meta.transcript.length);
  if (spoken.length) {
    lines.push(
      'note: line stamps are where the speaker started; the bracketed range is the window the line is about',
    );
  }
  for (const part of parts) {
    lines.push(`--- transcript: ${recDirName(part.index)} (${mmss(part.meta.durationMs)}) ---`);
    lines.push(
      part.meta.transcript.length
        ? spokenWindows(part.meta)
            .map((s) => `[${mmss(s.seg.t)}–${mmss(s.end)}] ${s.seg.text}`)
            .join('\n')
        : '(none)',
    );
  }
  return lines.join('\n') + '\n';
}

/** How much the gripe holds, said in as few words as the prompt can afford. */
function contents(session: Session, parts: number): string {
  if (!parts) return `a gripe called ${session.name}`;
  return `${parts} recording${parts === 1 ? '' : 's'} on one timeline`;
}

/**
 * The line you paste into Claude Code. The gripe is in the cloud, so this is a
 * pointer plus the one tool call that fetches it — `report.md` inside was authored
 * for the model that pulls it, which is why the prompt stays this short.
 */
export function agentPrompt(session: Session, url?: string, parts = session.recCount): string {
  const what = contents(session, parts);
  const evidence = parts
    ? 'The images are the evidence — read the contact sheets first, then the timeline, look at every screenshot, and where the words and the frames disagree, believe the frames.'
    : 'Look at every image, then fix what it describes.';
  if (url) {
    return `The gripe is at ${url} — pull the full brief with the handback MCP tool \`get_gripe\`, then fix what it describes. I recorded it against the running app: ${what}, in the order they happened. Its \`report.md\` is authored for you. ${evidence}`;
  }
  return `Pull my newest gripe with the handback MCP tools (\`list_gripes\`, then \`get_gripe\`) and fix what it describes — "${session.name}", recorded against the running app: ${what}, in the order they happened. Its \`report.md\` is authored for you. ${evidence}`;
}
