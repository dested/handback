import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PageEvent,
  PointerSample,
  Recording,
  RecordingFrame,
  Session,
  Settings,
} from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/types';
import { send } from '../lib/messages';
import { blobs, kv } from '../lib/db';
import { dateTime, mmss, recDirName } from '../lib/format';
import { partSpans, totalMs } from '../lib/timeline';
import {
  agentPrompt,
  buildManifestTxt,
  buildRecordingJson,
  buildReport,
  buildTranscriptTxt,
  sheetFile,
} from '../lib/report';
import { contentTypeFor, pushGripe, type GripeFile, type UploadProgress } from '../lib/upload';
import { Recorder, type RecorderUpdate } from './recorder';
import { Dictation } from '../content/speech';
import { makeGrids, type GridFrame } from './grids';
import { polishTranscript } from './polish';
import { transcribeRecording, type TranscribeProgress } from './transcribe';
import { Timeline } from './Timeline';
import './panel.css';

/**
 * The side panel is the remote: Record, a live readout while it runs, the editor,
 * and the one button that hands the gripe over. It is a pure view over the worker's
 * state — it re-pulls on every `state:changed` and mutates nothing directly. Two
 * things it owns because the worker can't: the `MediaRecorder` (the display-media
 * grant belongs to the document that asked for it) and, at `done`, the upload.
 *
 * There is no folder. Where the original wrote a gripe through to disk as each take
 * finished, this builds the same file set in memory at `done` and pushes it to the
 * Handback workspace — so nothing lands anywhere until the human says the gripe is
 * finished, and what lands is exactly what the timeline showed them.
 */

interface PanelState {
  sessions: Session[];
  activeSessionId: string | null;
  /** The active gripe's takes, oldest first — one timeline, however many sittings. */
  recordings: Recording[];
  settings: Settings;
}

const EMPTY: PanelState = {
  sessions: [],
  activeSessionId: null,
  recordings: [],
  settings: DEFAULT_SETTINGS,
};

/** The upload, and the takes exactly as it describes them. */
interface Bundle {
  files: GripeFile[];
  /** Takes whose frame lists hold only the frames that are really in `files`. */
  takes: Recording[];
  /** Keyframes whose blob had gone missing — evidence we no longer have. */
  missing: number;
}

/** What a finished handoff leaves on screen, after the gripe itself is closed. */
interface Shipped {
  url: string;
  title: string;
  brief: string;
  /** Whether the brief naming the URL made it onto the clipboard without a fresh click. */
  copied: boolean;
}

/** The popped-out editor is this same page; it just doesn't offer to pop itself out again. */
const popped = new URLSearchParams(location.search).has('pop');

/** format.ts is frozen and has no URL helper; the panel needs exactly this much. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** The workspace as a person would name it — `handback.dev`, not the whole URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function reason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, ' ').trim().slice(0, 300) || 'something went wrong';
}

/** An upload failure as a sentence, plus the raw server words for whoever wants them. */
interface UploadExplanation {
  line: string;
  detail?: string;
  /** The token itself is the problem — the panel offers the workspace page, not a retry. */
  relink?: boolean;
}

/**
 * `upload.ts` throws `declare failed (500): <body…>`, and the body is whatever the
 * server felt like sending — often an HTML error page. The status is the only part
 * worth trusting, so it picks the sentence and the body is demoted to a detail the
 * reader can open if the sentence isn't enough.
 */
function explainUpload(raw: string, host: string): UploadExplanation {
  const status = Number(/\((\d{3})\)/.exec(raw)?.[1] ?? 0);
  const stripped = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  const says = (line: string) => (stripped && stripped !== line ? stripped : undefined);

  if (status === 401 || status === 403) {
    return { line: 'the workspace turned the token away — re-link and try again', relink: true };
  }
  if (status === 413 || /quota|too large|limit/i.test(raw)) {
    const line = "the workspace refused the upload — it's over a size limit";
    return { line, detail: says(line) };
  }
  if (status >= 500) {
    const line = `the workspace hit an error (${status}). nothing is lost — the gripe is still here`;
    return { line, detail: says(line) };
  }
  if (status >= 400) {
    const line = `the workspace said no (${status})`;
    return { line, detail: says(line) };
  }
  return { line: `couldn't reach ${host} — check the connection and try again` };
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function App() {
  const [state, setState] = useState<PanelState>(EMPTY);
  const [flash, setFlash] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [showSessions, setShowSessions] = useState(false);
  /** The gear's panel, under the header. Nothing in here is needed to use the product. */
  const [showSettings, setShowSettings] = useState(false);
  /** Whether the recorded tab can host the on-page dock — chrome:// pages can't. */
  const [pageDock, setPageDock] = useState(false);
  const [recUpdate, setRecUpdate] = useState<RecorderUpdate | null>(null);
  const [stopping, setStopping] = useState(false);
  const [whisper, setWhisper] = useState<TranscribeProgress | null>(null);
  // The queue, mirrored into state so the panel can say `queued` / `transcribing…`.
  // A single-slot guard silently dropped the second of a back-to-back pair.
  const [whisperIds, setWhisperIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** The server's own words, folded away until someone asks for them. */
  const [showErrDetail, setShowErrDetail] = useState(false);
  const [shipped, setShipped] = useState<Shipped | null>(null);
  const whisperQueue = useRef<string[]>([]);
  const whisperRunning = useRef(false);
  const recorderRef = useRef<Recorder | null>(null);
  /** micperm.html is opened once per panel life — a second Record records silent. */
  const micTabOpened = useRef(false);
  const recovering = useRef<Set<string>>(new Set());
  // The Stop button, the page dock, and Chrome's own "Stop sharing" bar can all fire.
  const stopGuard = useRef(false);
  // The runtime listener is installed once, but the stop path closes over today's
  // state. Keep the latest copy behind a ref.
  const stopRef = useRef<() => void>(() => {});
  // Transcription runs off a queue, minutes after the settings it needs were read.
  // A ref keeps it on the current server, token, and on-device choice.
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  settingsRef.current = state.settings;
  // Same reason, one step further along: the cleanup pass wants the take's own
  // console errors and origin, read after the transcript comes back.
  const stateRef = useRef<PanelState>(EMPTY);
  stateRef.current = state;

  const session = useMemo(
    () => state.sessions.find((s) => s.id === state.activeSessionId) ?? null,
    [state.sessions, state.activeSessionId],
  );

  const refresh = useCallback(async () => {
    const next = await send<PanelState>({ type: 'state:get' });
    setState(next);
    return next;
  }, []);

  const say = useCallback((text: string) => {
    setFlash(text);
    window.setTimeout(() => setFlash(null), 1700);
  }, []);

  useEffect(() => {
    void refresh();
    const listener = (message: { type?: string; origin?: string }) => {
      if (message?.type === 'state:changed') void refresh();
      // The stop button on the page dock. The panel owns the recorder, so it acts.
      if (message?.type === 'recording:stop') stopRef.current();
      const recorder = recorderRef.current;
      if (!recorder) return;
      // Telemetry and pointer arrive from every tab; the recorder keeps only what
      // came from the one being recorded.
      if (message?.type === 'recording:event') {
        recorder.addEvent((message as { event: PageEvent }).event, message.origin);
      }
      if (message?.type === 'recording:pointer') {
        recorder.addPointer((message as { sample: PointerSample }).sample, message.origin);
      }
      // A click or a route change in the recorded tab — dedup gets overruled.
      if (message?.type === 'recording:force') {
        recorder.force((message as { why: 'click' | 'nav' }).why, message.origin);
      }
      if (message?.type === 'recording:mark') {
        recorder.mark();
        say('marked');
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh, say]);

  useEffect(() => {
    setName(session?.name ?? '');
  }, [session?.id, session?.name]);

  // ── transcription queue ───────────────────────────────────────────────
  /**
   * Runs after the take is already saved, never before: on success it swaps in the
   * Whisper lines. Fail, or close the panel, and the live Web Speech lines stand —
   * and the report says which engine wrote them.
   */
  const runWhisper = useCallback(
    async (id: string) => {
      const video = await blobs.get(`${id}:video`);
      if (!video) return;
      const result = await transcribeRecording(video, settingsRef.current, setWhisper);
      if (!result?.segments.length) return;

      // Then the cleanup pass, which knows what the page was called and what it
      // logged. It edits words, never timings, and a null answer just means the
      // raw lines ship — see extension/src/sidepanel/polish.ts.
      setWhisper({ stage: 'polish', pct: -1 });
      const rec = stateRef.current.recordings.find((r) => r.id === id);
      const origin = stateRef.current.sessions.find((s) => s.id === rec?.sessionId)?.origin;
      const polished = await polishTranscript(result.segments, {
        serverUrl: settingsRef.current.serverUrl,
        apiToken: settingsRef.current.apiToken,
        origin,
        events: rec?.meta.events,
      }).catch(() => null);

      await send({
        type: 'recording:transcript',
        id,
        transcript: polished ?? result.segments,
        engine: result.engine,
        polished: Boolean(polished),
      });
      await refresh();
    },
    [refresh],
  );

  const enqueueWhisper = useCallback(
    (id: string) => {
      if (whisperQueue.current.includes(id)) return;
      whisperQueue.current.push(id);
      setWhisperIds([...whisperQueue.current]);
      if (whisperRunning.current) return;
      whisperRunning.current = true;
      void (async () => {
        try {
          // One model in memory at a time — takes wait their turn, none are dropped.
          while (whisperQueue.current.length) {
            await runWhisper(whisperQueue.current[0]).catch(() => {});
            whisperQueue.current.shift();
            setWhisperIds([...whisperQueue.current]);
            setWhisper(null);
          }
        } finally {
          whisperRunning.current = false;
        }
      })();
    },
    [runWhisper],
  );

  // A take still marked `recording` belongs to a panel that died mid-ramble —
  // unless it's the one recording right now. Reassemble it from its chunk blobs.
  useEffect(() => {
    const live = recorderRef.current?.id;
    const orphan = state.recordings.find(
      (r) => r.state === 'recording' && r.id !== live && !recovering.current.has(r.id),
    );
    if (!orphan) return;
    recovering.current.add(orphan.id);
    void (async () => {
      await send({ type: 'recording:recover', id: orphan.id });
      await refresh();
      enqueueWhisper(orphan.id);
      say('recovered an interrupted recording');
    })();
  }, [state.recordings, refresh, enqueueWhisper, say]);

  // ── recording ─────────────────────────────────────────────────────────
  const stopRecording = async () => {
    const r = recorderRef.current;
    if (!r || stopGuard.current) return;
    stopGuard.current = true;
    setStopping(true);
    try {
      await send({ type: 'recording:setActive', active: false });
      const meta = await r.stop();
      await send({ type: 'recording:finish', id: r.id, meta });
      await refresh();
      say('saved — on the timeline');
      // Transcription is queued, not awaited: Record has to be pressable again
      // right now — stopping and starting again is what takes are for.
      enqueueWhisper(r.id);
    } finally {
      recorderRef.current = null;
      setRecUpdate(null);
      setStopping(false);
      setPageDock(false);
      stopGuard.current = false;
    }
  };

  /**
   * The side panel can't render the getUserMedia prompt — it rejects without
   * ever asking. First Record press without a granted mic opens micperm.html
   * in a tab (prompts work there); a second press records anyway, silent.
   */
  const ensureMic = async (): Promise<boolean> => {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (status.state === 'granted') return true;
    } catch {
      return true; // no Permissions API — let getUserMedia decide
    }
    if (!micTabOpened.current) {
      micTabOpened.current = true;
      await chrome.tabs.create({ url: chrome.runtime.getURL('micperm.html') });
      say('grant the mic in the new tab, then hit Record');
      return false;
    }
    return true;
  };

  const startRecording = async () => {
    if (recorderRef.current) return;
    if (!(await ensureMic())) return;
    setShipped(null);
    setUploadError(null);
    // The tab in front now is the app being walked through; everything else that
    // logs an error for the next five minutes is somebody else's noise.
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    const scope = originOf(tab?.url ?? '');
    const id = crypto.randomUUID();
    const r = new Recorder(
      { onUpdate: setRecUpdate, onEnd: () => void stopRecording() },
      state.settings.lang,
      scope.startsWith('http') ? scope : '',
      id,
      Dictation,
    );
    try {
      await r.start();
    } catch {
      // Refused the screen share: nothing was minted, so there's nothing to undo.
      say('screen share refused');
      return;
    }
    // Claim the take *before* announcing it: `recording:start` broadcasts, and a
    // refresh that lands before this ref is set reads the new take as an orphan.
    recorderRef.current = r;
    try {
      const started = await send<{ sessionId?: string }>({
        type: 'recording:start',
        id,
        name: 'Walkthrough',
        origin: r.scope,
      });
      if (!started?.sessionId) throw new Error('recording:start refused');
    } catch {
      recorderRef.current = null;
      await r.cancel();
      await send({ type: 'recording:discard', id }).catch(() => {});
      setRecUpdate(null);
      say("couldn't start the recording");
      return;
    }
    // The dock only exists where a content script can run, and the live readout
    // must not point at a bar that isn't there.
    setPageDock(Boolean(r.scope));
    await refresh();
  };

  // Every stop path — this button, Chrome's own "Stop sharing" bar, the page dock —
  // lands in stopRecording, and the listener above needs today's copy.
  useEffect(() => {
    stopRef.current = () => void stopRecording();
  });

  /**
   * The editor pops out as a strip along the bottom of the browser window the user
   * is looking at — a timeline is a wide object, and Chrome refuses to dock the side
   * panel anywhere but the side. The worker re-pins it on every parent move or
   * resize (`strip:track`), so it behaves like DevTools docked to the bottom.
   */
  const STRIP_H = 400;
  const popOut = async () => {
    // One strip. A second press brings the existing one forward.
    const dock = await kv.get<{ stripId: number }>('stripDock');
    if (dock) {
      const existing = await chrome.windows.get(dock.stripId).catch(() => null);
      if (existing) {
        await chrome.windows.update(dock.stripId, { focused: true });
        return;
      }
    }
    const win = await chrome.windows.getCurrent().catch(() => null);
    const bounds =
      win?.left !== undefined &&
      win.width !== undefined &&
      win.top !== undefined &&
      win.height !== undefined
        ? { left: win.left, top: win.top + win.height - STRIP_H, width: win.width, height: STRIP_H }
        : { width: 1400, height: STRIP_H };
    const strip = await chrome.windows.create({
      url: chrome.runtime.getURL('sidepanel.html?pop=1'),
      type: 'popup',
      ...bounds,
    });
    if (strip?.id !== undefined && win?.id !== undefined) {
      await send({ type: 'strip:track', stripId: strip.id, parentId: win.id });
    }
  };

  // ── handing the gripe over ────────────────────────────────────────────
  /**
   * The gripe's whole file set, built in memory at exactly the paths the original
   * wrote to disk: `report.md` and `MANIFEST.txt` at the root, one `rec-NN/` per
   * take. Those paths are the keys in the workspace, so a downloaded gripe is a
   * folder `cli/push.ts` can push straight back up.
   *
   * The frame blobs are resolved *before* any prose is written, and the takes handed
   * back carry only the frames that resolved. Everything downstream then describes
   * what is actually in the upload: the report's citations, its frame-to-sheet map,
   * the contact sheets, and the declared counts. This matters more here than it did
   * on disk — a report citing a file that never made it was a dangling relative path
   * you could go hunting for, and is now a 404 inside the reading agent's brief.
   */
  const buildFileSet = useCallback(
    async (target: Session, recorded: Recording[]): Promise<Bundle> => {
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
        for (const f of rec.meta.frames) {
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
      text('report.md', buildReport(target, takes));
      text('MANIFEST.txt', buildManifestTxt(target, takes));
      return { files, takes, missing };
    },
    [],
  );

  /**
   * Closing a gripe: build every byte, push it to the workspace, hand over the
   * brief, then let go of the session. The next recording opens a fresh one — takes
   * only ever accumulate in the open gripe, so this is the only way to start clean.
   *
   * The clipboard write goes first: it needs this click's user activation and the
   * upload burns straight through it. That first copy can't name the gripe's URL —
   * the workspace mints the id during the declare — so a second copy is attempted
   * once there is an address, and the card offers it again if that was refused.
   *
   * Any failure leaves the gripe open and says what broke. Re-declaring the same
   * slug replaces the previous attempt wholesale, so retrying is always safe.
   */
  const finish = async () => {
    if (!session || progress) return;
    const target = session;
    const takes = state.recordings.filter((r) => r.state === 'done');
    if (!takes.length) {
      say('nothing recorded yet');
      return;
    }
    if (!state.settings.apiToken.trim()) {
      setShowSettings(true);
      say('link a workspace first');
      return;
    }
    await navigator.clipboard
      .writeText(agentPrompt(target, undefined, takes.length))
      .catch(() => {});
    setUploadError(null);
    setShowErrDetail(false);
    setProgress({ phase: 'declare', done: 0, total: 0, bytesDone: 0, bytesTotal: 0 });
    try {
      const bundle = await buildFileSet(target, takes);
      // Say it out loud rather than quietly shipping a thinner gripe than the
      // timeline showed. The report already describes only what is really here.
      if (bundle.missing) {
        say(`${bundle.missing} keyframe${bundle.missing === 1 ? '' : 's'} had gone missing`);
      }
      const { url } = await pushGripe(
        { serverUrl: state.settings.serverUrl, apiToken: state.settings.apiToken },
        target,
        bundle.takes,
        bundle.files,
        setProgress,
      );
      const brief = agentPrompt(target, url, bundle.takes.length);
      const copied = await navigator.clipboard
        .writeText(brief)
        .then(() => true)
        .catch(() => false);
      await send({ type: 'session:close', id: target.id, uploadedUrl: url });
      await refresh();
      setShipped({ url, title: target.name, brief, copied });
    } catch (error) {
      setUploadError(reason(error));
    } finally {
      setProgress(null);
    }
  };

  const switchSession = async (id: string) => {
    await send({ type: 'session:activate', id });
    setShowSessions(false);
    setShipped(null);
    await refresh();
  };

  const renameSession = async (value: string) => {
    if (!session || value.trim() === session.name) return;
    await send({ type: 'session:rename', id: session.id, name: value.trim() || session.name });
    await refresh();
  };

  const patchSettings = async (patch: Partial<Settings>) => {
    await send({ type: 'settings:set', patch });
    await refresh();
  };

  /** `queued` / the live stage / nothing — where the transcriber has got to. */
  const whisperLabel = useMemo((): string | null => {
    if (!whisperIds.length) return null;
    const waiting = whisperIds.length > 1 ? ` · ${whisperIds.length - 1} waiting` : '';
    if (!whisper) return `transcribing…${waiting}`;
    if (whisper.stage === 'decode') return `reading the audio…${waiting}`;
    if (whisper.stage === 'upload') return `transcribing the narration…${waiting}`;
    if (whisper.stage === 'transcribe') return `transcribing on this device…${waiting}`;
    if (whisper.stage === 'model') return `loading the speech model…${waiting}`;
    if (whisper.stage === 'polish') return `cleaning up the transcript…${waiting}`;
    return `fetching the speech model — ${Math.round(whisper.pct)}%${waiting}`;
  }, [whisper, whisperIds]);

  const takes = state.recordings.filter((r) => r.state === 'done');
  const hasContent = takes.length > 0;
  const recording = Boolean(recUpdate);
  const uploading = Boolean(progress);
  /** Other gripes than this one — the only reason the history button exists. */
  const others = state.sessions.filter((s) => s.id !== state.activeSessionId).length;

  /**
   * A token is the whole of "linked": without one the recorder still records, it
   * just has nowhere to hand anything to. The workspace's /recorder page is where
   * that gets fixed in one click, so every dead end in the panel points at it.
   */
  const linked = Boolean(state.settings.apiToken);
  const serverUrl = state.settings.serverUrl || 'https://handback.dev';
  const serverHost = hostOf(serverUrl);
  const recorderUrl = `${serverUrl.replace(/\/+$/, '')}/recorder`;
  const openRecorderUrl = () => void chrome.tabs.create({ url: recorderUrl });

  const summary = [
    // Duration, not a count — the panel presents one timeline.
    takes.length ? `${mmss(totalMs(partSpans(takes)))} recorded` : '',
    takes.length > 1 ? `${takes.length} takes` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const uploadLine = progress
    ? progress.phase === 'declare'
      ? 'opening the gripe in your workspace…'
      : progress.phase === 'finalize'
        ? 'finishing up…'
        : `uploading ${progress.done}/${progress.total} · ${mb(progress.bytesDone)} of ${mb(progress.bytesTotal)}`
    : null;
  const uploadPct =
    progress && progress.bytesTotal ? (progress.bytesDone / progress.bytesTotal) * 100 : 0;

  const explained = uploadError ? explainUpload(uploadError, serverHost) : null;

  /** What the handoff is doing, or why it stopped. Shown in the panel and the strip. */
  const statusRow = (
    <>
      {uploadLine && (
        <div className="prog">
          <div className="prog-line">{uploadLine}</div>
          <div className="bar">
            <i style={{ width: `${uploadPct}%` }} />
          </div>
        </div>
      )}
      {explained && (
        <div className="err">
          <div className="err-head">upload failed</div>
          <p>{explained.line}</p>
          <div className="err-actions">
            <button className="link" onClick={() => void finish()}>
              try again
            </button>
            {explained.relink && (
              <button className="link" onClick={openRecorderUrl}>
                re-link
              </button>
            )}
            {explained.detail && (
              <button className="link" onClick={() => setShowErrDetail((v) => !v)}>
                details
              </button>
            )}
          </div>
          {showErrDetail && explained.detail && <pre className="err-detail">{explained.detail}</pre>}
        </div>
      )}
      {!uploading && !uploadError && hasContent && whisperLabel && (
        <div className="note">
          still transcribing — hand it over now and it ships the live dictation instead
        </div>
      )}
    </>
  );

  /** The footer is the handoff. With nothing to hand over and nothing to say, it isn't there. */
  const hasStatus = Boolean(uploadLine || uploadError || (hasContent && whisperLabel));

  const shippedCard = shipped && (
    <div className="shipped">
      <div className="shipped-head">handed over</div>
      <a className="shipped-link" href={shipped.url} target="_blank" rel="noreferrer">
        {shipped.title || 'the gripe'} →
      </a>
      {shipped.copied ? (
        <div className="note">the brief is on your clipboard — paste it into Claude Code</div>
      ) : (
        <button
          className="link"
          onClick={() => void navigator.clipboard.writeText(shipped.brief).then(() => say('copied'))}
        >
          copy the brief for Claude Code
        </button>
      )}
    </div>
  );

  // The strip is the editor: one slim bar of chrome, and every remaining pixel
  // belongs to the timeline. Capture lives in the side panel; this is where a
  // ramble gets read, cut, and shipped.
  if (popped) {
    return (
      <div className="app pop">
        <header className="head">
          <Mark />
          <input
            className="title slim"
            value={name}
            placeholder="Untitled gripe"
            onChange={(e) => setName(e.target.value)}
            onBlur={(e) => void renameSession(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <span className="spacer" />
          <span className="count">{whisperLabel ?? summary}</span>
          {recUpdate ? (
            <button className="rec live mini" onClick={() => void stopRecording()} disabled={stopping}>
              <span className="dot" />
              {stopping ? 'saving…' : mmss(recUpdate.elapsedMs)}
            </button>
          ) : (
            <button className="rec mini" onClick={() => void startRecording()}>
              <span className="dot" />
              record
            </button>
          )}
          <button
            className="primary slim"
            disabled={!hasContent || recording || uploading}
            onClick={() => void finish()}
          >
            {uploading ? 'sending…' : 'send'}
          </button>
        </header>
        {(uploadLine || uploadError) && <div className="striprow">{statusRow}</div>}
        {session ? (
          <Timeline session={session} recordings={state.recordings} />
        ) : (
          <div className="empty">{shipped ? shippedCard : 'no open gripe — hit record'}</div>
        )}
        {flash && <div className="flash">{flash}</div>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="head">
        <Mark />
        <span className="wordmark">handback</span>
        {/* The gripe's own line below says the duration; up here it would only repeat it. */}
        <span className="spacer" />
        <button className="icon" title="Settings" onClick={() => setShowSettings((v) => !v)}>
          ⚙
        </button>
        <button className="icon" title="Pop the editor out along the bottom" onClick={() => void popOut()}>
          ⧉
        </button>
      </header>
      <div className="rule" />

      {showSettings && (
        <>
          <section className="settings">
            <SettingsBlock
              settings={state.settings}
              onPatch={patchSettings}
              onOpenRecorder={openRecorderUrl}
              serverHost={serverHost}
            />
          </section>
          <div className="rule" />
        </>
      )}

      {recUpdate ? (
        <section className="live">
          <div className="live-row">
            <span className="dot pulse" />
            <span className="clock">{mmss(recUpdate.elapsedMs)}</span>
            <span className="stat">
              {recUpdate.frameCount} frames kept · {recUpdate.segmentCount} lines
              {recUpdate.markCount ? ` · ${recUpdate.markCount} marked` : ''}
            </span>
          </div>
          {recUpdate.micState === 'denied' ? (
            <button
              className="ticker warn"
              title="Open the permission page in a tab"
              onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('micperm.html') })}
            >
              microphone blocked — no narration this take · fix it
            </button>
          ) : (
            <div className="ticker">
              {recUpdate.interim || (recUpdate.micState === 'listening' ? 'listening…' : '')}
            </div>
          )}
          {pageDock && <div className="note">draw and stop from the little bar on the page</div>}
          <button className="stop-big" onClick={() => void stopRecording()} disabled={stopping}>
            {stopping ? 'saving…' : 'stop recording'}
          </button>
        </section>
      ) : session ? null : (
        <>
          {!linked && (
            <div className="linkbar">
              <span>Not linked to a workspace yet — recordings stay on this machine.</span>
              <button className="link" onClick={openRecorderUrl}>
                link it →
              </button>
            </div>
          )}
          <section className="hero">
            {shippedCard}
            <button className="rec-hero" onClick={() => void startRecording()}>
              <span className="dot" />
              Record a walkthrough
            </button>
            <p className="hero-sub">
              Screen + voice. Talk through what's wrong — it becomes a brief your team's agent can
              act on.
            </p>
            <p className="hero-keys">alt+shift+M mark a moment · alt+shift+D draw</p>
            {others > 0 && (
              <button className="link" onClick={() => setShowSessions((v) => !v)}>
                {showSessions ? 'hide earlier gripes' : `earlier gripes · ${others}`}
              </button>
            )}
          </section>
        </>
      )}

      {showSessions && (
        <div className="sessions">
          {state.sessions.map((s) => (
            <div
              key={s.id}
              className={`srow ${s.id === state.activeSessionId ? 'on' : ''}`}
              onClick={() => void switchSession(s.id)}
            >
              <div className="sname">
                {s.name}
                {s.closed && <span className="stag">{s.uploadedUrl ? 'handed over' : 'closed'}</span>}
              </div>
              <div className="smeta">{dateTime(s.createdAt)}</div>
              <button
                className="kill"
                title="Forget this gripe here (anything already uploaded stays in the workspace)"
                onClick={async (e) => {
                  e.stopPropagation();
                  await send({ type: 'session:delete', id: s.id });
                  await refresh();
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {session && (
        <>
          <section className="gripe">
            <input
              className="title"
              value={name}
              placeholder="Untitled gripe"
              onChange={(e) => setName(e.target.value)}
              onBlur={(e) => void renameSession(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <div className="meta">
              {whisperLabel ?? (hasContent ? summary : 'recording lands here')}
            </div>
            {!recording && (
              <div className="takerow">
                <button className="rec ghost" onClick={() => void startRecording()}>
                  <span className="dot" />
                  record another take
                </button>
                {others > 0 && (
                  <button className="link" onClick={() => setShowSessions((v) => !v)}>
                    {showSessions ? 'hide earlier gripes' : `earlier gripes · ${others}`}
                  </button>
                )}
              </div>
            )}
          </section>
          <Timeline session={session} recordings={state.recordings} />
        </>
      )}

      {session && (hasContent || !linked || hasStatus) && (
        <footer className="foot">
          {statusRow}
          {linked && hasContent && (
            <>
              <button
                className="primary send"
                disabled={recording || uploading}
                title="Upload this gripe to your workspace, copy the brief, and close it"
                onClick={() => void finish()}
              >
                {uploading ? 'sending…' : 'send to Handback'}
              </button>
              <p className="send-sub">uploads to {serverHost} · copies a brief for your agent</p>
            </>
          )}
          {!linked && (
            <div className="linkcard">
              <strong>Link your workspace to send</strong>
              <p>One click on the workspace page connects this recorder — no keys to paste.</p>
              <button className="primary" onClick={openRecorderUrl}>
                link workspace →
              </button>
              <button className="link" onClick={() => setShowSettings(true)}>
                or paste a token by hand
              </button>
            </div>
          )}
        </footer>
      )}
      {flash && <div className="flash">{flash}</div>}
    </div>
  );
}

/**
 * The return mark: out along the top in ink, a U-turn, and back in cobalt with the
 * arrowhead landing left. Same geometry as the web app's `ReturnMark` and the
 * extension icons — the panel must not carry a second logo.
 */
function Mark() {
  return (
    <svg className="mark" viewBox="0 0 28 20" fill="none" aria-hidden>
      <path
        d="M4 6.2 H18 A3.8 3.8 0 0 1 21.8 10"
        stroke="var(--ink)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M21.8 10 A3.8 3.8 0 0 1 18 13.8 H8"
        stroke="var(--cobalt)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M11.4 9.4 L6.2 13.8 L11.4 18.2"
        stroke="var(--cobalt)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Everything optional, in sentences. The server and token live in this browser's
 * IndexedDB and nowhere else — worth saying out loud next to a password field.
 * The link state leads because the fields below it are the manual way round; a
 * hand-pasted token has no workspace name to show, so pasting one clears it.
 */
function SettingsBlock({
  settings,
  onPatch,
  onOpenRecorder,
  serverHost,
}: {
  settings: Settings;
  onPatch: (patch: Partial<Settings>) => Promise<void>;
  onOpenRecorder: () => void;
  serverHost: string;
}) {
  const [server, setServer] = useState(settings.serverUrl);
  const [token, setToken] = useState(settings.apiToken);
  const [lang, setLang] = useState(settings.lang);
  useEffect(() => {
    setServer(settings.serverUrl);
    setToken(settings.apiToken);
    setLang(settings.lang);
  }, [settings.serverUrl, settings.apiToken, settings.lang]);

  const commit = (patch: Partial<Settings>) => void onPatch(patch);

  return (
    <div className="fields">
      {settings.apiToken ? (
        <div className="linked">
          <span>
            linked to <strong>{settings.orgName || serverHost}</strong>
          </span>
          <span className="linked-actions">
            <button className="link" onClick={onOpenRecorder}>
              manage
            </button>
            <button className="link" onClick={() => commit({ apiToken: '', orgName: '' })}>
              unlink
            </button>
          </span>
        </div>
      ) : (
        <>
          <button className="primary linkcta" onClick={onOpenRecorder}>
            link your workspace →
          </button>
          <em>Or paste a server and token by hand below.</em>
        </>
      )}
      <label className="field">
        <span>Where your team's gripes go</span>
        <input
          value={server}
          spellCheck={false}
          placeholder="https://handback.dev"
          onChange={(e) => setServer(e.target.value)}
          onBlur={() => commit({ serverUrl: server })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      <label className="field">
        <span>Your API token, from Team → API tokens</span>
        <input
          type="password"
          value={token}
          spellCheck={false}
          placeholder="hb_…"
          onChange={(e) => setToken(e.target.value)}
          onBlur={() =>
            // An unchanged field must not cost the workspace name — only a new
            // token has an unknown home.
            commit(token === settings.apiToken ? {} : { apiToken: token, orgName: '' })
          }
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <em>It stays in this browser on this machine — nothing else reads it.</em>
      </label>
      <button
        className={`toggle ${settings.drawStart ? 'on' : ''}`}
        onClick={() => commit({ drawStart: !settings.drawStart })}
      >
        <i />
        Start recordings with drawing on
      </button>
      <button
        className={`toggle ${settings.onDeviceTranscription ? 'on' : ''}`}
        onClick={() => commit({ onDeviceTranscription: !settings.onDeviceTranscription })}
      >
        <i />
        Transcribe on this device
      </button>
      <em>
        Off, your narration is transcribed by your workspace in seconds. On, it never leaves this
        machine — but expect minutes and a warm laptop.
      </em>
      <label className="field">
        <span>The language you narrate in, if it isn't the browser's</span>
        <input
          value={lang}
          spellCheck={false}
          placeholder="en-US"
          onChange={(e) => setLang(e.target.value)}
          onBlur={() => commit({ lang })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
    </div>
  );
}
