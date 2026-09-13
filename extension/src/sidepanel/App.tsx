import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  OutboxEntry,
  RecorderUpdate,
  Recording,
  ServerLink,
  Session,
  SessionIntent,
  SessionKind,
  Settings,
  TranscribeProgress,
  TranscribeState,
} from '../lib/types';
import { DEFAULT_SERVER, DEFAULT_SETTINGS, activeLink, linkId, sessionKind } from '../lib/types';
import { fetchContext, spaceProjects, type ServerContext } from '../lib/context';
import { send, type CaptureStartResult, type CaptureState } from '../lib/messages';
import { putOutbox } from '../lib/db';
import { hostOf, mmss, plural } from '../lib/format';
import { partSpans, totalMs } from '../lib/timeline';
import { agentPrompt } from '../lib/report';
import { Parts } from './Parts';
import { Home } from './Home';
import { OutboxStrip } from './Outbox';
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
      <span className="dest-to">To</span>
      <button
        type="button"
        className="dest-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-label="Destination"
      >
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
                          onClick={() => choose(l, s.teamId, r.id, r.id ? r.name : '')}
                        >
                          <span className="dest-mark" />
                          <span className="dest-opt-name">{r.name}</span>
                        </button>
                      );
                    })}
                    {here && !ctx && !ctxFailed && (
                      <div className="dest-note">loading projects…</div>
                    )}
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
 * state — it re-pulls on every `state:changed` and mutates nothing directly. It no
 * longer owns the recorder: as of 1.11.0 the capture runs in the offscreen document
 * so a closed panel doesn't kill the take. The offscreen document raises Chrome's
 * picker itself (getDisplayMedia needs no gesture there); the panel sends
 * `capture:start` and follows the live readout over `capture:*`.
 * Post-recording transcription moved there too: the offscreen document runs the
 * queue and the panel only mirrors it through `transcribe:update`.
 *
 * There is no folder, and the upload no longer happens here: "send to Handback"
 * drops the walkthrough into an outbox and returns, and the offscreen document
 * assembles the same file set the recorder used to write to disk and pushes it
 * (see lib/bundle.ts and offscreen/index.ts). The panel watches that queue through
 * `<OutboxStrip>`, so a slow push never keeps the human from the next walkthrough.
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

/** format.ts is frozen and has no URL helper; the panel needs exactly this much. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

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
  /**
   * Who the *next* walkthrough is for, while no walkthrough exists yet to hold
   * the answer. Once one is open its own `kind` wins — this is only the seed
   * `recording:start` carries into a fresh session.
   */
  const [pendingKind, setPendingKind] = useState<SessionKind>('agent');
  /** Discard is armed: the second click is the one that deletes takes. */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** The gear's panel, under the header. Nothing in here is needed to use the product. */
  const [showSettings, setShowSettings] = useState(false);
  /** Whether the recorded tab can host the on-page dock — chrome:// pages can't. */
  const [pageDock, setPageDock] = useState(false);
  const [recUpdate, setRecUpdate] = useState<RecorderUpdate | null>(null);
  const [stopping, setStopping] = useState(false);
  /**
   * The take being recorded, by id — the offscreen document owns it, so the panel
   * only ever holds its id (learned from `capture:update` and, on mount, from
   * `capture:state`) and mirrors the readout. null = nothing live here.
   */
  const [liveId, setLiveId] = useState<string | null>(null);
  /**
   * Whether `capture:state` has answered yet. A take still marked `recording` in
   * the store might be the live one, so orphan recovery must wait for this — before
   * it lands, "is anything recording?" is genuinely unknown, not "no".
   */
  const [captureKnown, setCaptureKnown] = useState(false);
  /**
   * The two moments Record can't do anything about until the human acts elsewhere,
   * each a full-container takeover so the panel isn't a lump behind an OS surface:
   * `micGate` is the one-time microphone grant (it happens in a tab Chrome opens);
   * `picking` is Chrome's own screen-share dialog — 'choosing' while it's up,
   * 'refused' when it closed with nothing picked.
   */
  const [micGate, setMicGate] = useState(false);
  const [picking, setPicking] = useState<'choosing' | 'refused' | null>(null);
  // The offscreen document owns transcription now; these two only mirror its queue,
  // seeded from `transcribe:state` on mount and kept current by `transcribe:update`.
  const [whisper, setWhisper] = useState<TranscribeProgress | null>(null);
  const [whisperIds, setWhisperIds] = useState<string[]>([]);
  /** What the active token can see — the spaces it reaches and their projects. Null until fetched, or when it failed. */
  const [ctx, setCtx] = useState<ServerContext | null>(null);
  /** The context fetch failed. The picker stays on screen and offers a retry — a
   *  control that vanishes is why "I can't set the project" was true. */
  const [ctxFailed, setCtxFailed] = useState(false);
  /** Bumped by that retry; the context effect is the only thing that fetches. */
  const [ctxReloads, setCtxReloads] = useState(0);
  const recovering = useRef<Set<string>>(new Set());
  // The Stop button, the page dock, and Chrome's own "Stop sharing" bar can all fire.
  const stopGuard = useRef(false);
  // The mic gate's permission watcher fires long after this render — it needs the
  // current start path, not the one captured when the gate opened.
  const startRef = useRef<() => void>(() => {});

  const session = useMemo(
    () => state.sessions.find((s) => s.id === state.activeSessionId) ?? null,
    [state.sessions, state.activeSessionId],
  );

  /**
   * Who the recording in front of us is for. An open walkthrough answers for
   * itself (pre-1.8.0 rows answer 'agent'); with nothing open it is whatever
   * was picked on the hero.
   */
  const kind: SessionKind = session ? sessionKind(session) : pendingKind;
  /** A walkthrough with a take in it is committed — the two capture differently. */
  const kindLocked = Boolean(session) && state.recordings.length > 0;

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

  /**
   * The kind picker. With a walkthrough open the choice is a mutation on it (the
   * worker refuses once it holds a take); with none, it is just the seed the
   * next `recording:start` carries into the session it opens.
   */
  const pickKind = useCallback(
    (next: SessionKind) => {
      setPendingKind(next);
      const open = state.activeSessionId;
      if (!open || state.recordings.length > 0) return;
      void (async () => {
        await send({ type: 'session:kind', id: open, kind: next });
        await refresh();
      })();
    },
    [state.activeSessionId, state.recordings.length, refresh],
  );

  /** The walkthrough's intent tag. Clicking the active chip clears it back to null. */
  const setIntent = useCallback(
    (next: SessionIntent) => {
      if (!session) return;
      const value = session.intent === next ? null : next;
      void (async () => {
        await send({ type: 'session:intent', sessionId: session.id, intent: value });
        await refresh();
      })();
    },
    [session, refresh],
  );

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

  // The one runtime listener. `state:changed` re-pulls; the `capture:*` broadcasts
  // from the offscreen document drive the live readout, and `transcribe:update`
  // mirrors its transcription queue. On mount it also asks whether a take is already
  // running (`capture:state`), so a panel reopened mid-recording reattaches its
  // readout instead of flashing Home over a live take — and answers `captureKnown`
  // so orphan recovery can start — and pulls the current queue (`transcribe:state`).
  useEffect(() => {
    void refresh();
    void send<CaptureState>({ type: 'capture:state' })
      .then((s) => {
        if (s) {
          setLiveId(s.id);
          setRecUpdate(s.update);
          setBrowsing(false);
          // The dock note is harmless on a tab with no content script, so reattach
          // it whenever a take is live rather than probing the page for one.
          setPageDock(Boolean(s.update));
        }
      })
      .catch(() => {})
      .finally(() => setCaptureKnown(true));
    void send<TranscribeState>({ type: 'transcribe:state' })
      .then((s) => {
        if (s) {
          setWhisperIds(s.queue);
          setWhisper(s.progress);
        }
      })
      .catch(() => {});
    const listener = (message: {
      type?: string;
      id?: string;
      update?: RecorderUpdate | null;
      state?: TranscribeState;
    }) => {
      if (message?.type === 'state:changed') void refresh();
      // The offscreen recorder's every emit while a take runs; `update: null` = ended.
      if (message?.type === 'capture:update') {
        setLiveId(message.update ? (message.id ?? null) : null);
        setRecUpdate(message.update ?? null);
      }
      // recording:finish has landed in the store — the offscreen document queues
      // transcription itself, so the panel just refreshes to show the new take.
      if (message?.type === 'capture:done') void refresh();
      // The offscreen transcription queue moved; mirror it into the readout.
      if (message?.type === 'transcribe:update' && message.state) {
        setWhisperIds(message.state.queue);
        setWhisper(message.state.progress);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  // A take still marked `recording` belongs to a session whose recorder died —
  // unless it's the one recording right now. Reassemble it from its chunk blobs.
  // Wait for capture:state: before it answers, an in-progress take is genuinely
  // indistinguishable from an orphan, and recovering the live one would kill it.
  useEffect(() => {
    if (!captureKnown) return;
    const orphan = state.recordings.find(
      (r) => r.state === 'recording' && r.id !== liveId && !recovering.current.has(r.id),
    );
    if (!orphan) return;
    recovering.current.add(orphan.id);
    void (async () => {
      await send({ type: 'recording:recover', id: orphan.id });
      await refresh();
      void send({ type: 'transcribe:enqueue', id: orphan.id }).catch(() => {});
      say('recovered an interrupted recording');
    })();
  }, [state.recordings, liveId, captureKnown, refresh, say]);

  // ── recording ─────────────────────────────────────────────────────────
  const stopRecording = async () => {
    // The offscreen document owns the recorder, so stopping is one message. The
    // save (recording:setActive, recording:finish), the refresh, and the
    // transcription all arrive back through the `capture:done` broadcast — which
    // reaches this panel like any other, so they must not be duplicated here.
    if (!recUpdate || stopGuard.current) return;
    stopGuard.current = true;
    setStopping(true);
    try {
      await send({ type: 'capture:stop' });
    } finally {
      setStopping(false);
      setPageDock(false);
      stopGuard.current = false;
    }
  };

  /**
   * The side panel can't render the getUserMedia prompt — it rejects without ever
   * asking. So the first Record press without a granted mic doesn't record: it
   * raises the in-panel mic gate, which opens micperm.html (prompts work there)
   * and, once the grant lands, walks straight into recording on its own. The gate
   * also offers a mic-less take for anyone who'd rather not.
   */
  const ensureMic = async (): Promise<boolean> => {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (status.state === 'granted') return true;
    } catch {
      return true; // no Permissions API — let getUserMedia decide
    }
    setMicGate(true);
    return false;
  };

  /** The mic gate's permission tab — opened by the gate, reopened on demand. */
  const openMicTab = () => void chrome.tabs.create({ url: chrome.runtime.getURL('micperm.html') });

  const startRecording = async (skipMic = false) => {
    if (liveId) return;
    if (!skipMic && !(await ensureMic())) return;
    setMicGate(false);
    // A take lands in the open walkthrough, so pressing Record from the home
    // screen is also a request to go back into it.
    setBrowsing(false);
    setConfirmDiscard(false);
    // The tab in front now is the app being walked through; everything else that
    // logs an error for the next five minutes is somebody else's noise.
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    const scope = originOf(tab?.url ?? '');
    // The events/dock scope is the tab's origin, but only for a real page.
    const origin = scope.startsWith('http') ? scope : '';
    const id = crypto.randomUUID();
    // Chrome's screen-share picker is a separate OS surface, raised by the
    // offscreen document (getDisplayMedia needs no gesture there). The panel sits
    // blank behind it, so it says what the dialog is waiting on. The offscreen
    // document must exist first — it is the thing that captures.
    setPicking('choosing');
    await send({ type: 'offscreen:ensure' });
    const started = await send<CaptureStartResult | undefined>({
      type: 'capture:start',
      id,
      lang: state.settings.lang,
      scope: origin,
      // Only read when this opens a fresh walkthrough; joining an open one keeps
      // that one's mode, which is the same mode `kind` already is.
      pristine: kind === 'human',
    });
    // No answer at all = the offscreen document isn't there to hear us.
    if (!started) {
      setPicking(null);
      say("couldn't start the recording — the recorder didn't answer");
      return;
    }
    if (!started.ok) {
      if (started.refused) {
        // Dismissed the picker: nothing was minted, so there's nothing to undo — the
        // panel stays on the pick screen with a way back rather than snapping to Home.
        setPicking('refused');
        return;
      }
      setPicking(null);
      say(`couldn't start the recording — ${started.error}`);
      return;
    }
    // The capture is running in the offscreen document; open its row in the worker.
    try {
      const opened = await send<{ sessionId?: string }>({
        type: 'recording:start',
        id,
        name: 'Walkthrough',
        origin,
        kind,
      });
      if (!opened?.sessionId) throw new Error('recording:start refused');
    } catch {
      // The take is orphaned in the offscreen document — tear it down and drop the
      // row that never opened, so nothing lingers as a phantom recording.
      await send({ type: 'capture:cancel', id }).catch(() => {});
      await send({ type: 'recording:discard', id }).catch(() => {});
      setRecUpdate(null);
      setLiveId(null);
      setPicking(null);
      say("couldn't start the recording");
      return;
    }
    setLiveId(id);
    // The dock only exists where a content script can run, and the live readout
    // must not point at a bar that isn't there.
    setPageDock(Boolean(origin));
    // Seed the live readout so the pick screen hands straight to it — the recorder's
    // first real emit is a broadcast away, and a blank Home must not flash between.
    setRecUpdate(
      (u) =>
        u ?? {
          elapsedMs: 0,
          frameCount: 0,
          segmentCount: 0,
          interim: '',
          micState: 'off',
          sysAudio: started.sysAudio,
        },
    );
    setPicking(null);
    await refresh();
  };

  // The mic gate's permission watcher fires long after this render and must start
  // recording with today's start path, not the one captured when the gate opened.
  useEffect(() => {
    startRef.current = () => void startRecording();
  });

  /**
   * While the mic gate is up, watch the extension's own microphone permission. The
   * grant happens in the tab Chrome opened — it can't happen in a side panel — so
   * this is how the panel learns it landed, and when it does the gate closes and
   * recording begins without a second Record press.
   */
  useEffect(() => {
    if (!micGate) return;
    let status: PermissionStatus | null = null;
    let disposed = false;
    const proceed = () => {
      if (disposed) return;
      setMicGate(false);
      startRef.current();
    };
    const onChange = () => {
      if (status?.state === 'granted') proceed();
    };
    void navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((s) => {
        if (disposed) return;
        status = s;
        if (s.state === 'granted') proceed();
        else s.addEventListener('change', onChange);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      status?.removeEventListener('change', onChange);
    };
  }, [micGate]);

  // ── handing the gripe over ────────────────────────────────────────────
  /**
   * Closing a gripe: enqueue it into the outbox, close the session, and drop the
   * human back on the home screen where the outbox strip shows the push going up.
   * The offscreen document does the assembling and uploading (see lib/bundle.ts
   * and offscreen/index.ts), so this returns at once and the next recording opens
   * a fresh session — takes only ever accumulate in the open gripe, so this is
   * the only way to start clean.
   *
   * The first clipboard write still goes here: it needs this click's user
   * activation, and the brief that names the walkthrough's URL isn't known until
   * the server mints the id during the declare — so this copies the URL-less brief
   * now, and the outbox strip's "copy brief" hands over the addressed one later.
   */
  const finish = async () => {
    if (!session) return;
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
    // A human handback has no agent brief to hand anyone — the artifact is the
    // video, and the next step is the editor on the web.
    const human = sessionKind(target) === 'human';
    if (!human) {
      await navigator.clipboard
        .writeText(agentPrompt(target, undefined, takes.length))
        .catch(() => {});
    }
    const entry: OutboxEntry = {
      id: crypto.randomUUID(),
      sessionId: target.id,
      title: target.name,
      createdAt: Date.now(),
      state: 'queued',
      // Snapshot the destination now — settings may change while it's in flight.
      target: { serverUrl: link.serverUrl, apiToken: link.apiToken },
      projectId,
      teamId: teamId || undefined,
      kind: human ? 'human' : 'agent',
    };
    await putOutbox(entry);
    await send({ type: 'session:close', id: target.id });
    await send({ type: 'upload:kick' });
    await refresh();
    // Land on the home screen, where the outbox strip accounts for the push.
    setBrowsing(true);
    say(
      human
        ? 'uploading in the background — you can close this panel'
        : 'uploading in the background — brief copied. you can close this panel',
    );
  };

  /** Open one from the home screen — which is also the way back into the one you left. */
  const switchSession = async (id: string) => {
    await send({ type: 'session:activate', id });
    setBrowsing(false);
    setConfirmDiscard(false);
    await refresh();
  };

  /**
   * Throw this walkthrough away: the session, its takes, and their blobs. The only
   * destructive button in the panel, so it arms first and says how much it is about
   * to lose. Anything already uploaded stays in Handback — this is local.
   */
  const discardSession = async () => {
    if (!session || recording) return;
    await send({ type: 'session:delete', id: session.id });
    setConfirmDiscard(false);
    setBrowsing(false);
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

  const takes = state.recordings.filter((r) => r.state === 'done');
  const hasContent = takes.length > 0;
  const recording = Boolean(recUpdate);
  /**
   * The editor is on screen when there is a walkthrough open and the human hasn't
   * stepped back out of it. Recording overrides both — the live readout is the
   * only thing worth showing while the screen is being captured.
   */
  const editing = Boolean(session) && !browsing;
  /**
   * A gate is a full-container takeover — the mic grant or Chrome's share dialog.
   * While one is up nothing else in the body (Home, the editor, the footer) renders,
   * so the panel is about the one thing it's waiting on, not a lump behind it.
   */
  const overlay = micGate || Boolean(picking);

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
    takes.length ? plural(takes.length, 'part') : '',
    takes.length ? mmss(totalMs(partSpans(takes))) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  // Where the next recording lands, named in the header. Derived display only —
  // the control that changes it is the footer's destination row.
  const spaceLabel = teamId ? (ctx?.teams.find((t) => t.id === teamId)?.name ?? 'team') : 'Personal';
  const projectLabel = currentProjectId
    ? (projects.find((p) => p.id === currentProjectId)?.name ?? 'General')
    : 'General';

  return (
    <div className="app">
      <header className="head">
        <Mark />
        <span className="wordmark">handback</span>
        <span className="spacer" />
        {/* While a take runs the header carries the one fact that matters — that it
            is, and for how long. Otherwise it names where the next recording lands;
            the control that changes it lives in the footer's destination row, and the
            settings drawer opens from the Home footer. */}
        {recUpdate ? (
          <span className="rec-pill">● REC {mmss(recUpdate.elapsedMs)}</span>
        ) : (
          <span className="head-dest" title="Where the next recording lands">
            {spaceLabel} · {projectLabel}
          </span>
        )}
      </header>

      {showSettings && !recording && (
        <>
          {/* Opening this used to shove the whole panel down with no explanation —
              it read as content streaming in rather than as a drawer. The header
              is what makes it legible as a thing that opened, and closable. */}
          <section className="settings">
            <div className="settings-head">
              <span>Settings</span>
              <button
                className="icon"
                title="Close settings"
                onClick={() => setShowSettings(false)}
              >
                ×
              </button>
            </div>
            <SettingsBlock
              settings={state.settings}
              onPatch={patchSettings}
              onOpenRecorder={openRecorderUrl}
            />
          </section>
        </>
      )}

      {micGate ? (
        <MicGate onOpenTab={openMicTab} onSkip={() => void startRecording(true)} />
      ) : picking ? (
        <PickGate
          mode={picking}
          onRetry={() => void startRecording(true)}
          onCancel={() => setPicking(null)}
        />
      ) : recUpdate ? (
        <section className="live">
          <div className="live-row">
            <span className="dot pulse" />
            <span className="clock">{mmss(recUpdate.elapsedMs)}</span>
          </div>
          <div className="stat">
            {plural(recUpdate.frameCount, 'keyframe')} · {plural(recUpdate.segmentCount, 'line')} ·
            tab audio{' '}
            {recUpdate.sysAudio === 'none'
              ? 'off'
              : recUpdate.sysAudio === 'silent'
                ? 'silent'
                : 'on'}
          </div>
          {/* The words being heard, in their own box with room for two lines, and the
              caveat that they are rough sits inside it. */}
          <div className="captions">
            {recUpdate.micState === 'denied' ? (
              <button
                className="ticker warn"
                title="Open the permission page in a tab"
                onClick={() =>
                  void chrome.tabs.create({ url: chrome.runtime.getURL('micperm.html') })
                }
              >
                microphone blocked — no narration on this part · fix it
              </button>
            ) : (
              <div className={`interim${recUpdate.interim ? '' : ' idle'}`}>
                {recUpdate.interim || (recUpdate.micState === 'listening' ? 'listening…' : '')}
              </div>
            )}
            {/* Web Speech drops words — the transcript that ships is written from the
                audio after you stop, so say the live text is rough. */}
            <div className="cap-note">
              rough live captions — the real transcript is written after you stop
            </div>
          </div>
          {/* Chrome's "share audio" box is easy to miss and its absence is silent —
              the take records fine, just without the app's sound. Say so now,
              while stopping and re-picking still costs seconds. 'silent' is the
              nastier cousin: the box WAS ticked but the loopback carries nothing,
              which on Windows means the sound is playing on a device Chrome
              isn't capturing. Five seconds of grace before accusing anyone. */}
          {recUpdate.sysAudio === 'none' && (
            <div className="note">
              no app audio — to capture it, stop and re-share with “share tab audio” ticked
            </div>
          )}
          {recUpdate.sysAudio === 'silent' && recUpdate.elapsedMs > 5000 && (
            <div className="note">
              app audio is shared but silent so far — if sound is playing, it isn’t reaching Chrome
              (check Windows’ default output device)
            </div>
          )}
          {pageDock && <div className="note">draw and stop from the little bar on the page</div>}
          <button className="stop-big" onClick={() => void stopRecording()} disabled={stopping}>
            {stopping ? 'saving…' : '■ Stop'}
          </button>
          {/* The whole point of capture living offscreen: the panel is disposable now.
              Say so, and say how to get back to Stop. */}
          <div className="note close-note">
            you can close this panel — recording keeps going. reopen it from the toolbar icon
            {pageDock ? ', or press s on the page,' : ''} to stop
          </div>
        </section>
      ) : editing ? null : (
        <Home
          openSessionId={browsing ? state.activeSessionId : null}
          sessions={state.sessions}
          settings={state.settings}
          link={link}
          ctx={ctx}
          ctxFailed={ctxFailed}
          kind={kind}
          kindLocked={kindLocked}
          onPickKind={pickKind}
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

      {!overlay && !recording && editing && session && (
        <>
          <section className="gripe">
            {/* The crumb carries where you are and the way to throw this away; the
                summary rides under the title as a caption. Leaving is free; the
                destructive one arms first and says what it costs. */}
            <div className="crumb">
              <button
                className="back"
                title="Back to your walkthroughs — this one stays open"
                onClick={() => {
                  setBrowsing(true);
                  setConfirmDiscard(false);
                }}
              >
                ← Walkthroughs
              </button>
              <span className="spacer" />
              {confirmDiscard ? (
                <span className="confirm">
                  <span>discard{hasContent ? ` ${plural(takes.length, 'part')}` : ' this'}?</span>
                  <button className="link danger" onClick={() => void discardSession()}>
                    yes, discard
                  </button>
                  <button className="link" onClick={() => setConfirmDiscard(false)}>
                    keep
                  </button>
                </span>
              ) : (
                <button
                  className="link discard"
                  disabled={recording}
                  title="Delete this walkthrough and its parts from this machine"
                  onClick={() => setConfirmDiscard(true)}
                >
                  Discard
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
            </div>
            <div className="gripe-meta">{hasContent ? summary : 'nothing recorded yet'}</div>
          </section>
          <OutboxStrip serverHost={serverHost} />
          <Parts
            session={session}
            recordings={state.recordings}
            busy={recording}
            transcribing={whisperIds}
            progress={whisper}
            onAdd={() => void startRecording()}
            onSay={say}
          />
        </>
      )}

      {!overlay && !recording && editing && (hasContent || !linked) && (
        <footer className="foot">
          {/* What this walkthrough is — a field row above where it lands. Hidden on
              the empty review screen; present once a part exists. The per-part bar in
              the parts list now carries transcription progress, so the footer no
              longer repeats it. */}
          {hasContent && session && (
            <div className="intent-row">
              <span className="intent-label">This is</span>
              {(['bug', 'feature', 'idea'] as const).map((it) => (
                <button
                  key={it}
                  type="button"
                  className={`intent-chip${session.intent === it ? ' on' : ''}`}
                  onClick={() => setIntent(it)}
                >
                  {it}
                </button>
              ))}
            </div>
          )}
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
                onRetry={() => setCtxReloads((n) => n + 1)}
                onOpenRecorder={openRecorderUrl}
                onOpenProjects={openProjectsUrl}
                onPick={pickDestination}
              />
              <button
                className="primary send"
                title="Upload this walkthrough in the background — the transcript is finished first"
                onClick={() => void finish()}
              >
                Send to Handback
              </button>
              <p className="foot-note">
                Uploads in the background once the transcript is done. You can close this.
              </p>
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
 * First run: the microphone grant, as the whole panel rather than a flash nobody
 * reads. Chrome won't raise the permission prompt inside a side panel, so the
 * button opens a tab where it can be answered; the moment it is, App's watcher
 * closes this and starts recording. The mic-less path is here for anyone who
 * doesn't want to narrate.
 */
function MicGate({ onOpenTab, onSkip }: { onOpenTab: () => void; onSkip: () => void }) {
  const [opened, setOpened] = useState(false);
  return (
    <section className="gate">
      <h2 className="gate-title">First, turn on your microphone</h2>
      <p className="gate-lead">
        A walkthrough carries your voice, so Handback needs the mic — just this once. Chrome won't
        ask inside this panel, so it opens a quick permission tab. Say yes there and recording
        starts on its own.
      </p>
      <button
        className="gate-cta"
        onClick={() => {
          setOpened(true);
          onOpenTab();
        }}
      >
        {opened ? 'Reopen the permission tab' : 'Enable the microphone'}
      </button>
      {opened && (
        <p className="note gate-wait">
          Waiting on that tab — grant the mic and this jumps straight into recording.
        </p>
      )}
      <button className="link gate-skip" onClick={onSkip}>
        skip — record without narration this time
      </button>
    </section>
  );
}

/**
 * A portrait of Chrome's share dialog, drawn small: the panel can't reach into
 * the real one, but it can point at the part that matters. The audio switch is
 * ringed in cobalt because it is the whole reason this picture exists — Chrome
 * leaves it wherever it was last time, a window surface doesn't offer it at
 * all, and a take recorded with it off is a silent app and no error anywhere.
 */
function ShareDialogMock() {
  return (
    <div className="sharemock" aria-hidden="true">
      <div className="sm-title">Choose what to share</div>
      <div className="sm-tabs">
        <span className="on">Chrome Tab</span>
        <span>Window</span>
        <span>Entire Screen</span>
      </div>
      <div className="sm-rows">
        <div className="sm-row">
          <i />
          <b style={{ flex: 0.9 }} />
        </div>
        <div className="sm-row">
          <i />
          <b style={{ flex: 0.6 }} />
        </div>
        <div className="sm-row">
          <i />
          <b style={{ flex: 0.75 }} />
        </div>
      </div>
      <div className="sm-audio">
        <svg viewBox="0 0 16 16" width="13" height="13">
          <path d="M2.5 6v4h2.6L9 13V3L5.1 6H2.5z" fill="currentColor" />
          <path
            d="M11 5.5a3.4 3.4 0 0 1 0 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <span className="sm-label">Also share tab audio</span>
        <span className="sm-toggle">
          <i />
        </span>
      </div>
    </div>
  );
}

/**
 * Chrome's screen-share dialog is a separate OS surface the panel can't reach into,
 * so instead of sitting blank behind it the panel walks the choice: which surface,
 * and above all the audio switch — 'choosing' while the dialog is up, 'refused'
 * when it closed with nothing chosen, the one moment there's a button to offer.
 */
function PickGate({
  mode,
  onRetry,
  onCancel,
}: {
  mode: 'choosing' | 'refused';
  onRetry: () => void;
  onCancel: () => void;
}) {
  if (mode === 'choosing') {
    return (
      <section className="gate">
        <span className="gate-dot pulse" />
        <h2 className="gate-title">Pick what to record</h2>
        <p className="gate-lead">
          Chrome just opened its share dialog. Choose the tab you’re walking through and hit{' '}
          <b>Share</b> — recording starts the moment you do.
        </p>
        <ShareDialogMock />
        <p className="gate-lead">
          <b>Turn on “Also share tab audio.”</b> That switch is how the sound your app makes —
          everything you’re hearing in your headphones — gets into the recording. Chrome leaves it
          wherever it was last time, and with it off the app records silent.
        </p>
        <p className="gate-lead">
          A <b>window</b> can’t share audio at all — pick the tab, or the entire screen if you need
          more than one.
        </p>
      </section>
    );
  }
  return (
    <section className="gate">
      <h2 className="gate-title">Nothing picked yet</h2>
      <p className="gate-lead">
        The share dialog closed without a choice. Pick a screen, window, or tab and your walkthrough
        starts recording.
      </p>
      <button className="gate-cta" onClick={onRetry}>
        <span className="dot" /> Choose a screen
      </button>
      <button className="link gate-skip" onClick={onCancel}>
        not now
      </button>
    </section>
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
