import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PageEvent,
  PointerSample,
  Recording,
  RecordingFrame,
  ServerLink,
  Session,
  Settings,
} from '../lib/types';
import { DEFAULT_SERVER, DEFAULT_SETTINGS, activeLink, linkId } from '../lib/types';
import { fetchContext, spaceProjects, type ServerContext } from '../lib/context';
import { send } from '../lib/messages';
import { blobs } from '../lib/db';
import { hostOf, mmss, plural, recDirName } from '../lib/format';
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
import { Home } from './Home';
import './panel.css';

/**
 * The destination as one control: a trigger reading "to <space> · <project>",
 * and one panel grouped by space where a single row picks the space and the
 * project together. Only the active link's teams and projects are known (context
 * follows the active link), so every other linked server offers just its personal
 * space until it's the one selected. "General" is the project-less row.
 */
function DestinationPicker({
  links,
  activeLinkId,
  ctx,
  ctxFailed,
  teamId,
  currentProjectId,
  disabled,
  onRetry,
  onOpenRecorder,
  onOpenProjects,
  onPick,
}: {
  links: ServerLink[];
  activeLinkId: string;
  ctx: ServerContext | null;
  ctxFailed: boolean;
  teamId: string;
  currentProjectId: string;
  disabled: boolean;
  onRetry: () => void;
  onOpenRecorder: () => void;
  onOpenProjects: () => void;
  onPick: (linkId: string, teamId: string, projectId: string, projectName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const multi = links.length > 1;
  const active = links.find((l) => l.id === activeLinkId) ?? links[0] ?? null;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The spaces of one link, as sections of the panel.
  const spacesOf = (l: ServerLink): { teamId: string; name: string }[] => {
    if (l.id !== active?.id) return [{ teamId: '', name: 'Personal' }];
    const spaces = [{ teamId: '', name: 'Personal' }];
    for (const t of ctx?.teams ?? []) spaces.push({ teamId: t.id, name: t.name });
    return spaces;
  };

  const spaceLabel = teamId
    ? (ctx?.teams.find((t) => t.id === teamId)?.name ?? 'team')
    : 'Personal';
  const projectLabel = currentProjectId
    ? (spaceProjects(ctx, teamId).find((p) => p.id === currentProjectId)?.name ?? 'General')
    : 'General';

  const choose = (l: ServerLink, tId: string, pId: string, pName: string) => {
    onPick(l.id, tId, pId, pName);
    setOpen(false);
  };

  return (
    <div className="dest" ref={wrap}>
      <span className="dest-to">to</span>
      <button
        type="button"
        className="dest-trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label="Destination">
        <span className="dest-space">{spaceLabel}</span>
        <span className="dest-sep">·</span>
        <span className="dest-proj">{projectLabel}</span>
      </button>

      {open && (
        <div className="dest-pop">
          {links.map((l) => (
            <div key={l.id}>
              {multi && <div className="dest-host">{hostOf(l.serverUrl)}</div>}
              {spacesOf(l).map((s) => {
                const activeSpace = l.id === active?.id;
                const projects = activeSpace ? spaceProjects(ctx, s.teamId) : [];
                const here = activeSpace && s.teamId === teamId;
                const rows = [{ id: '', name: 'General' }, ...projects];
                return (
                  <div className="dest-grp" key={`${l.id}:${s.teamId}`}>
                    <div className="dest-grp-h">{s.name}</div>
                    {rows.map((r) => {
                      const on = here && r.id === currentProjectId;
                      return (
                        <button
                          type="button"
                          key={r.id || 'general'}
                          className={`dest-opt${on ? ' on' : ''}`}
                          onClick={() => choose(l, s.teamId, r.id, r.id ? r.name : '')}>
                          <span className="dest-mark" />
                          <span className="dest-opt-name">{r.name}</span>
                        </button>
                      );
                    })}
                    {here && !ctx && !ctxFailed && <div className="dest-note">loading projects…</div>}
                    {here && ctxFailed && (
                      <div className="dest-note">
                        projects unavailable ·{' '}
                        <button type="button" className="link" onClick={onRetry}>
                          retry
                        </button>
                      </div>
                    )}
                    {here && ctx && projects.length === 0 && (
                      <button type="button" className="dest-opt dest-make" onClick={onOpenProjects}>
                        <span className="dest-mark dest-mark-ghost" />
                        <span className="dest-opt-name">+ new project…</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="dest-foot">
            <button type="button" className="link" onClick={onOpenProjects}>
              manage projects
            </button>
            <button type="button" className="link" onClick={onOpenRecorder}>
              + link a server
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The side panel is the remote: Record, a live readout while it runs, the editor,
 * and the one button that hands the gripe over. It is a pure view over the worker's
 * state — it re-pulls on every `state:changed` and mutates nothing directly. Two
 * things it owns because the worker can't: the `MediaRecorder` (the display-media
 * grant belongs to the document that asked for it) and, at `done`, the upload.
 *
 * There is no folder. Where the original wrote a gripe through to disk as each take
 * finished, this builds the same file set in memory at `done` and pushes it to the
 * Handback server — so nothing lands anywhere until the human says the gripe is
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

/** format.ts is frozen and has no URL helper; the panel needs exactly this much. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
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
  /** The token itself is the problem — the panel offers the recorder page, not a retry. */
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
    return { line: 'the server turned the token away — re-link and try again', relink: true };
  }
  if (status === 413 || /quota|too large|limit/i.test(raw)) {
    const line = "the server refused the upload — it's over a size limit";
    return { line, detail: says(line) };
  }
  if (status >= 500) {
    const line = `the server hit an error (${status}). nothing is lost — the walkthrough is still here`;
    return { line, detail: says(line) };
  }
  if (status >= 400) {
    const line = `the server said no (${status})`;
    return { line, detail: says(line) };
  }
  return { line: `couldn't reach ${host} — check the connection and try again` };
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function App() {
  const [state, setState] = useState<PanelState>(EMPTY);
  const [flash, setFlash] = useState<string | null>(null);
  const [name, setName] = useState('');
  /**
   * The human stepped back to the home screen with a walkthrough still open. It is
   * view state and nothing else — the session stays active in the worker, so the
   * next take still lands in it, and reopening the panel lands back in the work.
   * Leaving a walkthrough must never be the same gesture as ending one.
   */
  const [browsing, setBrowsing] = useState(false);
  /** Discard is armed: the second click is the one that deletes takes. */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
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
  /** What the active token can see — the spaces it reaches and their projects. Null until fetched, or when it failed. */
  const [ctx, setCtx] = useState<ServerContext | null>(null);
  /** The context fetch failed. The picker stays on screen and offers a retry — a
   *  control that vanishes is why "I can't set the project" was true. */
  const [ctxFailed, setCtxFailed] = useState(false);
  /** Bumped by that retry; the context effect is the only thing that fetches. */
  const [ctxReloads, setCtxReloads] = useState(0);
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

  /**
   * The server uploads go to. A recorder can hold keys to several; everything
   * that used to read `settings.serverUrl` / `settings.apiToken` reads this.
   */
  const link = activeLink(state.settings);
  /** The space on that server: '' is the token owner's own, anything else a team. */
  const teamId = state.settings.activeTeamId;
  /**
   * A token is the whole of "linked": without one the recorder still records, it
   * just has nowhere to hand anything to. Handback's /recorder page is where
   * that gets fixed in one click, so every dead end in the panel points at it.
   */
  const linked = Boolean(link);
  const serverUrl = link?.serverUrl ?? DEFAULT_SERVER;
  /** The projects of the active space — a project belongs to exactly one. */
  const projects = useMemo(() => spaceProjects(ctx, teamId), [ctx, teamId]);

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
      // A click, an ink stroke, or a route change in the recorded tab — dedup
      // gets overruled.
      if (message?.type === 'recording:force') {
        recorder.force((message as { why: 'click' | 'nav' }).why, message.origin);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  useEffect(() => {
    setName(session?.name ?? '');
  }, [session?.id, session?.name]);

  /**
   * What the active token can see: the spaces it reaches — the owner's personal
   * one and every team — and the projects a gripe may be pinned to in each. It
   * feeds both pickers in the destination row. A failure is not an error state:
   * without it the gripe still routes by origin.
   */
  useEffect(() => {
    let live = true;
    setCtx(null);
    setCtxFailed(false);
    if (!link) return;
    const current = link;
    void (async () => {
      const answer = await fetchContext(current).catch(() => null);
      if (!live) return;
      if (!answer) {
        setCtxFailed(true);
        return;
      }
      setCtx(answer);
    })();
    return () => {
      live = false;
    };
  }, [link?.id, link?.apiToken, ctxReloads]);

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
      const l = activeLink(settingsRef.current);
      const result = await transcribeRecording(
        video,
        {
          serverUrl: l?.serverUrl ?? '',
          apiToken: l?.apiToken ?? '',
          lang: settingsRef.current.lang,
          onDevice: settingsRef.current.onDeviceTranscription,
        },
        setWhisper,
      );
      if (!result?.segments.length) return;

      // Then the cleanup pass, which knows what the page was called and what it
      // logged. It edits words, never timings, and a null answer just means the
      // raw lines ship — see extension/src/sidepanel/polish.ts.
      setWhisper({ stage: 'polish', pct: -1 });
      const rec = stateRef.current.recordings.find((r) => r.id === id);
      const origin = stateRef.current.sessions.find((s) => s.id === rec?.sessionId)?.origin;
      const polished = await polishTranscript(result.segments, {
        serverUrl: l?.serverUrl ?? '',
        apiToken: l?.apiToken ?? '',
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
    // A take lands in the open walkthrough, so pressing Record from the home
    // screen is also a request to go back into it.
    setBrowsing(false);
    setConfirmDiscard(false);
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

  // ── handing the gripe over ────────────────────────────────────────────
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
   * Closing a gripe: build every byte, push it to the active space, hand over the
   * brief, then let go of the session. The next recording opens a fresh one — takes
   * only ever accumulate in the open gripe, so this is the only way to start clean.
   *
   * The clipboard write goes first: it needs this click's user activation and the
   * upload burns straight through it. That first copy can't name the gripe's URL —
   * the server mints the id during the declare — so a second copy is attempted
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
    if (!link?.apiToken.trim()) {
      setShowSettings(true);
      say('link handback first');
      return;
    }
    // A project picked in another space, or one this token never confirmed, would
    // 400 the declare. Let the server route by origin instead.
    const projectId =
      target.projectId && projects.some((p) => p.id === target.projectId)
        ? target.projectId
        : undefined;
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
        { serverUrl: link.serverUrl, apiToken: link.apiToken },
        target,
        bundle.takes,
        bundle.files,
        { projectId, teamId: teamId || undefined, onProgress: setProgress },
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

  /** Open one from the home screen — which is also the way back into the one you left. */
  const switchSession = async (id: string) => {
    await send({ type: 'session:activate', id });
    setBrowsing(false);
    setConfirmDiscard(false);
    setShipped(null);
    await refresh();
  };

  /**
   * Throw this walkthrough away: the session, its takes, and their blobs. The only
   * destructive button in the panel, so it arms first and says how much it is about
   * to lose. Anything already uploaded stays in Handback — this is local.
   */
  const discardSession = async () => {
    if (!session || recording || uploading) return;
    await send({ type: 'session:delete', id: session.id });
    setConfirmDiscard(false);
    setBrowsing(false);
    setShipped(null);
    const next = await refresh();
    // The worker falls back to the newest walkthrough still open, which would drop
    // the human straight into somebody else's work. Land on the home screen instead.
    if (next.activeSessionId) setBrowsing(true);
    say('discarded');
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
  /**
   * The editor is on screen when there is a walkthrough open and the human hasn't
   * stepped back out of it. Recording overrides both — the live readout is the
   * only thing worth showing while the screen is being captured.
   */
  const editing = Boolean(session) && !browsing;

  const serverHost = hostOf(serverUrl);
  const appUrl = (path: string) => `${serverUrl.replace(/\/+$/, '')}${path}`;
  const openRecorderUrl = () => void chrome.tabs.create({ url: appUrl('/recorder') });
  /** Handback's projects page — the only place a project can actually be made. */
  const openProjectsUrl = () => void chrome.tabs.create({ url: appUrl('/projects') });

  /**
   * The destination is one choice — which space on which server, and which
   * project within it — so it is one control (`DestinationPicker`): a trigger
   * that reads "to <space> · <project>" and one grouped panel where a single
   * row sets the space and the project together. Switching space drops the
   * project (a project belongs to exactly one space); "General" is the
   * project-less row — the server still routes by origin when it's chosen.
   */
  const currentProjectId =
    session && session.projectId && projects.some((p) => p.id === session.projectId)
      ? session.projectId
      : '';
  const pickDestination = (
    nextLinkId: string,
    nextTeamId: string,
    projectId: string,
    projectName: string,
  ) =>
    void (async () => {
      if (nextLinkId !== link?.id || nextTeamId !== teamId) {
        await patchSettings({ activeLinkId: nextLinkId, activeTeamId: nextTeamId });
      }
      if (session) {
        await send({ type: 'session:project', id: session.id, projectId, projectName });
      }
      await refresh();
    })();

  const summary = [
    // Duration, not a count — the panel presents one timeline.
    takes.length ? `${mmss(totalMs(partSpans(takes)))} recorded` : '',
    takes.length > 1 ? `${takes.length} takes` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const uploadLine = progress
    ? progress.phase === 'declare'
      ? 'opening the walkthrough in Handback…'
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
        {shipped.title || 'the walkthrough'} →
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

  return (
    <div className="app">
      <header className="head">
        <Mark />
        <span className="wordmark">handback</span>
        {/* The gripe's own line below says the duration; up here it would only repeat it. */}
        <span className="spacer" />
        {/* A bare glyph here read as decoration — nobody guessed the settings
            lived behind it. It says what it is, and says when it is open. */}
        <button
          className={`icon labelled${showSettings ? ' on' : ''}`}
          title="Server, transcription and language"
          aria-expanded={showSettings}
          onClick={() => setShowSettings((v) => !v)}
        >
          ⚙ <span>settings</span>
        </button>
      </header>
      <div className="rule" />

      {showSettings && (
        <>
          {/* Opening this used to shove the whole panel down with no explanation —
              it read as content streaming in rather than as a drawer. The header
              is what makes it legible as a thing that opened, and closable. */}
          <section className="settings">
            <div className="settings-head">
              <span>Settings</span>
              <button className="icon" title="Close settings" onClick={() => setShowSettings(false)}>
                ×
              </button>
            </div>
            <SettingsBlock
              settings={state.settings}
              onPatch={patchSettings}
              onOpenRecorder={openRecorderUrl}
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
              {plural(recUpdate.frameCount, 'frame')} kept · {plural(recUpdate.segmentCount, 'line')}
            </span>
          </div>
          {/* The words being heard are the reason to look at this block at all, so
              they get their own ruled well with room for two lines. On one nowrap
              line they were guillotined mid-sentence, and the well kept collapsing
              to nothing between phrases and shoving the button around. */}
          {recUpdate.micState === 'denied' ? (
            <button
              className="ticker warn"
              title="Open the permission page in a tab"
              onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('micperm.html') })}
            >
              microphone blocked — no narration this take · fix it
            </button>
          ) : (
            <div className={`ticker${recUpdate.interim ? '' : ' idle'}`}>
              {recUpdate.interim || (recUpdate.micState === 'listening' ? 'listening…' : '')}
            </div>
          )}
          {pageDock && <div className="note">draw and stop from the little bar on the page</div>}
          <button className="stop-big" onClick={() => void stopRecording()} disabled={stopping}>
            {stopping ? 'saving…' : 'stop recording'}
          </button>
        </section>
      ) : editing ? null : (
        <Home
          openSessionId={browsing ? state.activeSessionId : null}
          sessions={state.sessions}
          settings={state.settings}
          link={link}
          ctx={ctx}
          ctxFailed={ctxFailed}
          shipped={shippedCard}
          onRecord={() => void startRecording()}
          onOpenSession={(id) => void switchSession(id)}
          onDeleteSession={(id) =>
            void (async () => {
              await send({ type: 'session:delete', id });
              await refresh();
            })()
          }
          onPickSpace={(nextServer, nextTeam) =>
            void patchSettings({ activeLinkId: nextServer, activeTeamId: nextTeam })
          }
          onOpenRecorder={openRecorderUrl}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      {editing && session && (
        <>
          <section className="gripe">
            {/* Two rows, not four. The crumb row carries where you are, what this
                walkthrough amounts to, and the way to throw it away; the title row
                carries its name and the one thing you do to it next. Leaving is
                free; the destructive one arms first and says what it costs. */}
            <div className="crumb">
              <button
                className="back"
                title="Back to your walkthroughs — this one stays open"
                onClick={() => {
                  setBrowsing(true);
                  setConfirmDiscard(false);
                }}
              >
                ← all walkthroughs
              </button>
              <span className="meta">
                {whisperLabel ?? (hasContent ? summary : 'nothing recorded yet')}
              </span>
              <span className="spacer" />
              {confirmDiscard ? (
                <span className="confirm">
                  <span>
                    discard{hasContent ? ` ${plural(takes.length, 'take')}` : ' this'}?
                  </span>
                  <button className="link danger" onClick={() => void discardSession()}>
                    yes, discard
                  </button>
                  <button className="link" onClick={() => setConfirmDiscard(false)}>
                    keep
                  </button>
                </span>
              ) : (
                <button
                  className="link"
                  disabled={recording || uploading}
                  title="Delete this walkthrough and its takes from this machine"
                  onClick={() => setConfirmDiscard(true)}
                >
                  discard
                </button>
              )}
            </div>
            <div className="titlerow">
              <input
                className="title"
                value={name}
                placeholder="Untitled walkthrough"
                onChange={(e) => setName(e.target.value)}
                onBlur={(e) => void renameSession(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              {/* It says what it does: another take, on this walkthrough. "add
                  more" said neither what was added nor to what. */}
              {!recording && (
                <button
                  className="rec ghost"
                  title="Record another take into this walkthrough"
                  onClick={() => void startRecording()}
                >
                  <span className="dot" />
                  add another recording
                </button>
              )}
            </div>
          </section>
          <Timeline session={session} recordings={state.recordings} busy={recording || uploading} />
        </>
      )}

      {editing && (hasContent || !linked || hasStatus) && (
        <footer className="foot">
          {statusRow}
          {linked && hasContent && (
            <>
              {/* Where it lands — space and project as one control, read before
                  the trigger is pulled. One panel, one click sets both. */}
              <DestinationPicker
                links={state.settings.links}
                activeLinkId={state.settings.activeLinkId}
                ctx={ctx}
                ctxFailed={ctxFailed}
                teamId={teamId}
                currentProjectId={currentProjectId}
                disabled={recording || uploading}
                onRetry={() => setCtxReloads((n) => n + 1)}
                onOpenRecorder={openRecorderUrl}
                onOpenProjects={openProjectsUrl}
                onPick={pickDestination}
              />
              <button
                className="primary send"
                disabled={recording || uploading}
                title="Upload this walkthrough, copy the brief, and close it"
                onClick={() => void finish()}
              >
                {uploading ? 'sending…' : 'send to Handback'}
              </button>
              {/*<p className="send-sub">copies a brief for your agent</p>*/}
            </>
          )}
          {!linked && (
            <div className="linkcard">
              <strong>Link Handback to send</strong>
              <p>One click on the recorder page connects this — no keys to paste.</p>
              <button className="primary" onClick={openRecorderUrl}>
                link handback →
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
 * Everything optional, in sentences. The servers lead: a recorder can hold keys
 * to several, one of them is where the next gripe goes, and clicking a row is
 * how that changes. The tokens live in this browser's IndexedDB and nowhere
 * else — worth saying out loud next to a password field. The fields at the
 * bottom are the manual way round; a hand-pasted token doesn't know its spaces
 * until the panel asks the server for them.
 */
function SettingsBlock({
  settings,
  onPatch,
  onOpenRecorder,
}: {
  settings: Settings;
  onPatch: (patch: Partial<Settings>) => Promise<void>;
  onOpenRecorder: () => void;
}) {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [token, setToken] = useState('');
  const [lang, setLang] = useState(settings.lang);
  useEffect(() => {
    setLang(settings.lang);
  }, [settings.lang]);

  const commit = (patch: Partial<Settings>) => void onPatch(patch);

  const unlink = (id: string) => {
    const links = settings.links.filter((l) => l.id !== id);
    // Losing the active server falls to whatever is left, never to nothing while
    // a link still exists — and the space it was pointing at goes with it.
    const moved = settings.activeLinkId === id;
    const activeLinkId = moved ? (links[0]?.id ?? '') : settings.activeLinkId;
    commit({ links, activeLinkId, ...(moved ? { activeTeamId: '' } : {}) });
  };

  const addByHand = () => {
    const serverUrl = server.trim().replace(/\/+$/, '');
    const apiToken = token.trim();
    const added: ServerLink = {
      id: linkId(serverUrl),
      serverUrl,
      apiToken,
      addedAt: Date.now(),
    };
    const known = settings.links.some((l) => l.id === added.id);
    const links = settings.links.filter((l) => l.id !== added.id).concat(added);
    commit({
      links,
      activeLinkId: added.id,
      ...(known ? {} : { activeTeamId: '' }),
    });
    setToken('');
  };

  return (
    <div className="fields">
      {settings.links.length > 0 ? (
        <>
          <span className="field-head">Servers</span>
          {settings.links.map((l) => {
            const on = l.id === (activeLink(settings)?.id ?? '');
            return (
              <div
                key={l.id}
                className={`wsrow ${on ? 'on' : ''}`}
                onClick={() => commit({ activeLinkId: l.id })}
              >
                <i className="wsdot" />
                <span className="wsname">{hostOf(l.serverUrl)}</span>
                <span className="wshost">…{l.apiToken.slice(-4)}</span>
                <button
                  className="kill"
                  title="Forget this server's token"
                  onClick={(e) => {
                    e.stopPropagation();
                    unlink(l.id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button className="link" onClick={onOpenRecorder}>
            link another server →
          </button>
        </>
      ) : (
        <>
          <button className="primary linkcta" onClick={onOpenRecorder}>
            link your server →
          </button>
          <em>Or paste a server and token by hand below.</em>
        </>
      )}
      <label className="field">
        <span>Where your team's walkthroughs go</span>
        <input
          value={server}
          spellCheck={false}
          placeholder="https://handback.dev"
          onChange={(e) => setServer(e.target.value)}
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
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <em>
          It stays in this browser on this machine — the panel checks it and fills in your spaces.
        </em>
      </label>
      <button className="link" disabled={!token.trim().startsWith('hb_')} onClick={addByHand}>
        add server
      </button>
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
        Off, your narration is transcribed by your Handback server in seconds. On, it never leaves
        this machine — but expect minutes and a warm laptop.
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
