import type {
  ContentCommand,
  ExternalLinkResult,
  ExternalPong,
  ExternalRequest,
  Request,
} from '../lib/messages';
import type {
  RecordingMeta,
  ServerLink,
  Session,
  SessionKind,
  SessionSummary,
  Settings,
} from '../lib/types';
import { COBALT, DEFAULT_SERVER, DEFAULT_SETTINGS, activeLink, linkId } from '../lib/types';
import {
  blobs,
  deleteOutbox,
  deleteRecording,
  deleteSession,
  getOutbox,
  getRecording,
  getSession,
  kv,
  listOutbox,
  listRecordings,
  listSessions,
  putOutbox,
  putRecording,
  putSession,
} from '../lib/db';
import { slugify, stamp } from '../lib/format';

/**
 * The service worker is the only component that's always alive when it needs to
 * be, so it owns: the draw hotkey, the on-page dock's reach into every tab, and
 * the write path into IndexedDB. The side panel is a view over that state — a
 * part recorded while it's closed is still captured, and uploaded later.
 */

const ACTIVE_SESSION = 'activeSessionId';
const SETTINGS = 'settings';
const RECORDING_ACTIVE = 'recordingActive';
/** Origin of the tab being recorded — scopes the on-page dock to that app's tabs. */
const RECORDING_ORIGIN = 'recordingOrigin';
/** The recording badge's red — a red, never orange (ui.md). Distinct from COBALT so REC reads as live. */
const RECORDING_RED = '#c8322b';

chrome.runtime.onInstalled.addListener((details) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Only on a fresh install — an update or a browser restart must not steal a tab.
  if (details.reason === 'install') {
    chrome.tabs.create({ url: `${DEFAULT_SERVER}/recorder` }).catch(() => {});
  }
});

// A browser restart leaves any half-sent walkthrough sitting in the outbox — the
// offscreen document doesn't survive the restart. Bring the uploader back up and
// let it finish what was queued or interrupted.
chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    const pending = (await listOutbox()).some(
      (e) => e.state === 'queued' || e.state === 'uploading',
    );
    if (pending) await kickDrain();
  })();
});

/** A 1.2.x row: one link per workspace, `${serverUrl}::${orgId}`. */
type LegacyLink = ServerLink & { orgId?: string; orgName?: string };

/** Everything this recorder has ever written under `settings`, in one shape. */
type StoredSettings = Partial<Omit<Settings, 'links'>> & {
  links?: LegacyLink[];
  /** 1.1.x kept its single workspace in three flat fields. */
  serverUrl?: string;
  apiToken?: string;
  orgName?: string;
};

/**
 * Settings, with every shipped shape folded into today's. A token is the user's
 * now — it reaches their personal space and every team — so the recorder holds
 * one link per server rather than one per workspace, and the fold is where the
 * old rows collapse. It persists once, so nobody's setup unlinks on update.
 */
async function getSettings(): Promise<Settings> {
  const stored = (await kv.get<StoredSettings>(SETTINGS)) ?? {};
  const base: Settings = {
    ...DEFAULT_SETTINGS,
    drawStart: stored.drawStart ?? DEFAULT_SETTINGS.drawStart,
    lang: stored.lang ?? '',
    onDeviceTranscription: stored.onDeviceTranscription ?? false,
    links: [],
    activeLinkId: '',
    // Personal is the safe default: which workspace an old link uploaded to
    // can't be mapped to a team without asking the server first.
    activeTeamId: stored.activeTeamId ?? '',
  };

  if (!Array.isArray(stored.links)) {
    // 1.1.x: three flat fields, one workspace.
    if (!stored.apiToken) return base;
    const serverUrl = stored.serverUrl || DEFAULT_SERVER;
    const next: Settings = {
      ...base,
      links: [{ id: linkId(serverUrl), serverUrl, apiToken: stored.apiToken, addedAt: Date.now() }],
      activeLinkId: linkId(serverUrl),
    };
    await kv.set(SETTINGS, next);
    return next;
  }

  // 1.2.x: one row per (server, workspace). Several rows can name the same
  // server, and any of their tokens now reaches all of it — so keep the one that
  // was active, else the newest, and throw the duplicates away.
  const survivors = new Map<string, LegacyLink>();
  for (const row of stored.links) {
    if (!row?.serverUrl || !row.apiToken) continue;
    const kept = survivors.get(row.serverUrl);
    if (!kept) {
      survivors.set(row.serverUrl, row);
      continue;
    }
    if (kept.id === stored.activeLinkId) continue;
    if (row.id === stored.activeLinkId || row.addedAt > kept.addedAt) {
      survivors.set(row.serverUrl, row);
    }
  }
  const links: ServerLink[] = [...survivors.values()].map((row) => ({
    id: linkId(row.serverUrl),
    serverUrl: row.serverUrl,
    apiToken: row.apiToken,
    addedAt: row.addedAt,
  }));
  const wasActive = stored.links.find((row) => row?.id === stored.activeLinkId);
  const activeServer = wasActive?.serverUrl ?? stored.activeLinkId ?? '';
  const activeLinkId = links.some((l) => l.id === activeServer)
    ? activeServer
    : (links[0]?.id ?? '');
  const next: Settings = { ...base, links, activeLinkId };
  const folded =
    links.length !== stored.links.length ||
    stored.links.some((row) => row?.id !== row?.serverUrl || row?.orgId !== undefined) ||
    stored.activeTeamId === undefined ||
    activeLinkId !== stored.activeLinkId;
  if (folded) await kv.set(SETTINGS, next);
  return next;
}

async function broadcast() {
  chrome.runtime.sendMessage({ type: 'state:changed' }).catch(() => {
    /* no side panel listening — fine */
  });
}

async function broadcastOutbox() {
  chrome.runtime.sendMessage({ type: 'outbox:changed' }).catch(() => {
    /* no side panel listening — fine */
  });
}

/**
 * The uploader lives in an offscreen document — it needs a DOM (canvas for the
 * contact sheets) and a lifetime the panel doesn't have. This makes sure one
 * exists. A create that throws means it already does (or a create race), which is
 * the same "it's there" from the caller's side. A create that *succeeds* means the
 * document is fresh — so the previous uploader died mid-flight, and any entry it
 * left marked 'uploading' belongs to a run that will never finish. Put those back
 * in the queue for the new document to pick up.
 */
async function ensureOffscreen(): Promise<void> {
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [
        chrome.offscreen.Reason.BLOBS,
        chrome.offscreen.Reason.USER_MEDIA,
        chrome.offscreen.Reason.DISPLAY_MEDIA,
      ],
      justification:
        'Record the screen and microphone, transcribe, and upload walkthroughs while the side panel is closed',
    });
    const stuck = (await listOutbox()).filter((e) => e.state === 'uploading');
    for (const entry of stuck) await putOutbox({ ...entry, state: 'queued', progress: undefined });
    if (stuck.length) await broadcastOutbox();
  } catch {
    /* already exists / create race — the document is there, which is all we need */
  }
}

/** Wake the uploader: make sure the offscreen doc is up, then tell it to drain. */
async function kickDrain(): Promise<void> {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: 'upload:drain' }).catch(() => {});
}

/**
 * The toolbar icon is the only surface a closed panel has. While a take is
 * recording it says so in red — the whole point of moving capture offscreen is
 * that it keeps going with the panel shut, and the badge is how you know. Idle,
 * it falls back to a cobalt count of what the open gripe holds.
 */
async function updateBadge() {
  if (await kv.get<boolean>(RECORDING_ACTIVE)) {
    await chrome.action.setBadgeText({ text: 'REC' });
    await chrome.action.setBadgeBackgroundColor({ color: RECORDING_RED });
    return;
  }
  const session = await activeSession();
  const count = session?.recCount ?? 0;
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: COBALT });
}

async function activeSession(): Promise<Session | undefined> {
  const id = await kv.get<string>(ACTIVE_SESSION);
  return id ? getSession(id) : undefined;
}

/** After a delete, fall back to the newest gripe that hasn't been handed off — never a closed one. */
async function resumeOpen() {
  const next = (await listSessions()).find((s) => !s.closed);
  await kv.set(ACTIVE_SESSION, next?.id ?? null);
}

async function uniqueSlug(label: string, now: number): Promise<string> {
  const existing = await listSessions();
  const taken = new Set(existing.map((s) => s.slug));
  let slug = `${stamp(now)}-${slugify(label)}`;
  let n = 2;
  while (taken.has(slug)) slug = `${stamp(now)}-${slugify(label)}-${n++}`;
  return slug;
}

async function createSession(name: string, origin: string, kind: SessionKind): Promise<Session> {
  const now = Date.now();
  const label = name.trim() || 'Session';
  const session: Session = {
    id: crypto.randomUUID(),
    name: label,
    slug: await uniqueSlug(label, now),
    createdAt: now,
    updatedAt: now,
    origin,
    kind,
    recCount: 0,
  };
  await putSession(session);
  await kv.set(ACTIVE_SESSION, session.id);
  return session;
}

/**
 * Every part lands in the open gripe; only closing it starts a new one — which
 * is also why `kind` is only read on the fresh path. A take joining a
 * walkthrough that already exists is captured the way that walkthrough is.
 */
async function ensureSession(name: string, origin: string, kind: SessionKind): Promise<Session> {
  const current = await activeSession();
  if (current && !current.closed) return current;
  return createSession(name, origin, kind);
}

/** What a part starts life with — `recording:progress` overwrites it wholesale. */
function emptyMeta(now: number): RecordingMeta {
  return {
    startedAt: now,
    durationMs: 0,
    sampled: 0,
    frames: [],
    transcript: [],
    events: [],
    videoFile: 'walkthrough.webm',
  };
}

async function tellTab(tabId: number, command: ContentCommand): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, command);
    return true;
  } catch {
    return false;
  }
}

/** Content scripts don't exist in tabs that were already open at install time. */
async function ensureContentScript(tabId: number): Promise<boolean> {
  if (await tellTab(tabId, { type: 'ping' })) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch {
    return false;
  }
}

/** The ink layer lives in the page, so the hotkey has to be relayed to the tab. */
async function drawLive() {
  const id = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (id === undefined) return false;
  if (!(await ensureContentScript(id))) return false;
  return tellTab(id, { type: 'draw:toggle' });
}

async function setRecordingActive(active: boolean, origin = '') {
  await kv.set(RECORDING_ACTIVE, active);
  await kv.set(RECORDING_ORIGIN, active ? origin : '');
  // While recording, a toolbar click must OPEN the panel, never toggle it shut —
  // closing the panel no longer stops the take, but a human who closed it by
  // accident and can't find the Stop button is worse than one who just reopens it.
  // The onClicked listener below does the open; this is what routes the click there.
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !active }).catch(() => {});
  const { drawStart } = await getSettings();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const id = tab.id;
    const command = { type: 'recording', active, origin, drawStart } as const;
    void (async () => {
      if (await tellTab(id, command)) return;
      // Reloading the extension orphans every open tab's content script — the
      // listener is dead and the tab would silently lose the dock and the ink.
      // Recording is the moment it must exist, so revive it and tell it again.
      if (!active || !/^https?:/.test(tab.url ?? '')) return;
      if (await ensureContentScript(id)) await tellTab(id, command);
    })();
  }
  await updateBadge();
}

/**
 * A restarted service worker forgets the panel behaviour, so a take that was
 * running when it died would let a click toggle the panel shut again. Re-sync it
 * from the recording flag the moment the worker loads.
 */
function syncPanelBehavior() {
  void kv
    .get<boolean>(RECORDING_ACTIVE)
    .then((active) => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !active }))
    .catch(() => {});
}
syncPanelBehavior();

/**
 * Fires only while `openPanelOnActionClick` is false — i.e. while recording — so
 * a click that would otherwise toggle the panel opens it instead.
 */
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  void (async () => {
    if (!(await kv.get<boolean>(RECORDING_ACTIVE))) return;
    const origin = (await kv.get<string>(RECORDING_ORIGIN)) ?? '';
    const { drawStart } = await getSettings();
    void tellTab(tabId, { type: 'recording', active: true, origin, drawStart });
  })();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'draw-live') void drawLive();
});

chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
  // capture:* and transcribe:* are answered by the offscreen document; if the
  // background also called sendResponse, its {ok:true} would win the race and the
  // panel would read a bogus success for a recording or a transcription that never ran.
  if (
    typeof message?.type === 'string' &&
    (message.type.startsWith('capture:') || message.type.startsWith('transcribe:'))
  )
    return false;
  (async () => {
    switch (message.type) {
      case 'settings:get':
        return getSettings();
      case 'settings:set': {
        const next = { ...(await getSettings()), ...message.patch };
        await kv.set(SETTINGS, next);
        await broadcast();
        return next;
      }
      case 'session:rename': {
        const session = await getSession(message.id);
        if (session) await putSession({ ...session, name: message.name });
        await broadcast();
        return { ok: true };
      }
      case 'session:activate': {
        const session = await getSession(message.id);
        // Picking a closed gripe out of the list is how you reopen it.
        if (session?.closed) await putSession({ ...session, closed: false });
        await kv.set(ACTIVE_SESSION, message.id);
        await updateBadge();
        await broadcast();
        return { ok: true };
      }
      case 'session:close': {
        const session = await getSession(message.id);
        if (!session) return { ok: false };
        await putSession({
          ...session,
          closed: true,
          // Set only when the close followed a successful push, so the panel can
          // offer the link afterwards. A local close keeps whatever was there.
          uploadedUrl: message.uploadedUrl ?? session.uploadedUrl,
          updatedAt: Date.now(),
        });
        // No new active session: the next recording mints one. An empty panel is
        // the honest state after a handoff.
        if ((await kv.get<string>(ACTIVE_SESSION)) === message.id) {
          await kv.set(ACTIVE_SESSION, null);
        }
        await updateBadge();
        await broadcast();
        return { ok: true };
      }
      case 'session:intent': {
        const session = await getSession(message.sessionId);
        if (session) await putSession({ ...session, intent: message.intent ?? undefined });
        await broadcast();
        return { ok: true };
      }
      case 'session:project': {
        const session = await getSession(message.id);
        if (!session) return { ok: false };
        await putSession({
          ...session,
          projectId: message.projectId || undefined,
          projectName: message.projectName || undefined,
        });
        await broadcast();
        return { ok: true };
      }
      case 'session:kind': {
        const session = await getSession(message.id);
        if (!session) return { ok: false };
        // Capture differs between the two (frame rate, bitrate, whether
        // keyframes are sampled at all), so a walkthrough that already holds a
        // take is committed. The panel locks the control for the same reason;
        // this is the half that can't be clicked around.
        const takes = await listRecordings(session.id);
        if (takes.length) return { ok: false, locked: true };
        await putSession({ ...session, kind: message.kind, updatedAt: Date.now() });
        await broadcast();
        return { ok: true };
      }
      case 'session:delete': {
        await deleteSession(message.id);
        if ((await kv.get<string>(ACTIVE_SESSION)) === message.id) await resumeOpen();
        await updateBadge();
        await broadcast();
        return { ok: true };
      }
      case 'take:delete': {
        const rec = await getRecording(message.id);
        if (!rec) return { ok: false };
        await deleteRecording(message.id);
        // The takes that remain are re-laid 1..N in the order they were recorded:
        // `rec-NN` is a position in this gripe, not a serial number, and a gap in
        // it would put a hole in the axis the report and the upload both walk.
        const rest = (await listRecordings(rec.sessionId)).sort(
          (a, b) => a.createdAt - b.createdAt,
        );
        for (const [i, take] of rest.entries()) {
          if (take.index !== i + 1) await putRecording({ ...take, index: i + 1 });
        }
        const session = await getSession(rec.sessionId);
        if (session) {
          await putSession({ ...session, recCount: rest.length, updatedAt: Date.now() });
        }
        await updateBadge();
        await broadcast();
        return { ok: true };
      }
      case 'state:get': {
        const sessions = await listSessions();
        const current = await activeSession();
        return {
          sessions,
          activeSessionId: current?.id ?? null,
          recordings: current ? await listRecordings(current.id) : [],
          settings: await getSettings(),
        };
      }
      case 'sessions:summary': {
        const sessions = await listSessions();
        const summaries: Record<string, SessionSummary> = {};
        for (const session of sessions) {
          const takes = (await listRecordings(session.id)).filter((r) => r.state === 'done');
          summaries[session.id] = {
            takes: takes.length,
            durationMs: takes.reduce((n, r) => n + r.meta.durationMs, 0),
            frames: takes.reduce((n, r) => n + r.meta.frames.length, 0),
            lines: takes.reduce((n, r) => n + r.meta.transcript.length, 0),
          };
        }
        return summaries;
      }
      case 'recording:start': {
        const now = Date.now();
        const session = await ensureSession(
          message.name.trim() || 'Walkthrough',
          message.origin,
          message.kind,
        );
        const index = session.recCount + 1;
        await putRecording({
          id: message.id,
          sessionId: session.id,
          index,
          createdAt: now,
          state: 'recording',
          mime: '',
          chunks: 0,
          meta: emptyMeta(now),
        });
        await putSession({ ...session, recCount: index, updatedAt: now });
        await kv.set(ACTIVE_SESSION, session.id);
        // setRecordingActive flips the badge to REC and re-routes the toolbar click.
        await setRecordingActive(true, message.origin);
        await broadcast();
        return { sessionId: session.id, index };
      }
      case 'recording:progress': {
        const rec = await getRecording(message.id);
        if (!rec) return { ok: false };
        // No broadcast — this lands every couple of seconds and the panel already
        // holds the live meta in memory. It's here so a dead panel loses nothing.
        await putRecording({
          ...rec,
          meta: message.meta,
          mime: message.mime,
          chunks: message.chunks,
          micChunks: message.micChunks,
          micMime: message.micMime,
        });
        return { ok: true };
      }
      case 'recording:finish': {
        const rec = await getRecording(message.id);
        if (!rec) return { ok: false };
        // The chunk blobs are gone by now — the panel assembled the video (and
        // the mic-only shadow, when one ran) from them.
        await putRecording({ ...rec, state: 'done', chunks: 0, micChunks: 0, meta: message.meta });
        await setRecordingActive(false);
        await broadcast();
        return { ok: true };
      }
      case 'recording:discard': {
        // The part index is spent either way; parts never renumber.
        await deleteRecording(message.id);
        await broadcast();
        return { ok: true };
      }
      case 'recording:recover': {
        const rec = await getRecording(message.id);
        if (!rec) return { ok: false };
        const parts: Blob[] = [];
        for (let n = 1; n <= rec.chunks; n++) {
          const chunk = await blobs.get(`${message.id}:chunk:${n}`);
          if (chunk) parts.push(chunk);
        }
        if (parts.length) {
          await blobs.set(`${message.id}:video`, new Blob(parts, { type: rec.mime }));
        }
        for (let n = 1; n <= rec.chunks; n++) await blobs.delete(`${message.id}:chunk:${n}`);
        // The mic-only shadow gets the same reassembly, so a recovered take still
        // transcribes from narration rather than the mixed track.
        const micParts: Blob[] = [];
        const micChunks = rec.micChunks ?? 0;
        for (let n = 1; n <= micChunks; n++) {
          const chunk = await blobs.get(`${message.id}:micchunk:${n}`);
          if (chunk) micParts.push(chunk);
        }
        if (micParts.length) {
          await blobs.set(
            `${message.id}:mic`,
            new Blob(micParts, { type: rec.micMime || 'audio/webm' }),
          );
        }
        for (let n = 1; n <= micChunks; n++) await blobs.delete(`${message.id}:micchunk:${n}`);
        // The last kept frame is the only clock we have — the panel that knew the
        // real duration died before it could tell us.
        const last = rec.meta.frames[rec.meta.frames.length - 1];
        await putRecording({
          ...rec,
          state: 'done',
          interrupted: true,
          chunks: 0,
          micChunks: 0,
          meta: { ...rec.meta, durationMs: last ? last.t : rec.meta.durationMs },
        });
        // A recovered take means the live capture is gone — the offscreen doc that
        // held it died with the worker. Stop the toolbar saying REC and re-arm the click.
        await setRecordingActive(false);
        await broadcast();
        return { ok: true };
      }
      case 'recording:setActive': {
        await setRecordingActive(message.active);
        return { ok: true };
      }
      case 'recording:line:update': {
        const rec = await getRecording(message.id);
        if (!rec) return { ok: false };
        // The caller aimed at position `index` in a transcript that has since been
        // replaced — editing that slot now would edit somebody else's words.
        if (message.rev !== undefined && message.rev !== (rec.meta.rev ?? 0)) {
          return { ok: true, stale: true };
        }
        const text = message.text.trim();
        const transcript = text
          ? rec.meta.transcript.map((s, i) => (i === message.index ? { ...s, text } : s))
          : rec.meta.transcript.filter((_, i) => i !== message.index); // emptied = deleted
        await putRecording({
          ...rec,
          meta: { ...rec.meta, transcript, rev: (rec.meta.rev ?? 0) + 1 },
        });
        await broadcast();
        return { ok: true };
      }
      case 'recording:transcript': {
        const rec = await getRecording(message.id);
        if (!rec) return { ok: false };
        await putRecording({
          ...rec,
          meta: {
            ...rec.meta,
            transcript: message.transcript,
            transcriber: message.engine,
            polished: message.polished,
            // New words nobody has read yet — an earlier confirmation doesn't carry over.
            reviewed: false,
            rev: (rec.meta.rev ?? 0) + 1,
          },
        });
        await broadcast();
        return { ok: true };
      }
      case 'upload:kick': {
        // The panel just enqueued a walkthrough — spin up the uploader and drain.
        await kickDrain();
        return { ok: true };
      }
      case 'outbox:retry': {
        const entry = await getOutbox(message.id);
        if (entry && entry.state === 'failed') {
          await putOutbox({ ...entry, state: 'queued', error: undefined, progress: undefined });
          await broadcastOutbox();
        }
        await kickDrain();
        return { ok: true };
      }
      case 'outbox:dismiss': {
        const entry = await getOutbox(message.id);
        // Only a settled entry can be dismissed — a queued or in-flight one is
        // still the uploader's to finish.
        if (entry && (entry.state === 'done' || entry.state === 'failed')) {
          await deleteOutbox(message.id);
          await broadcastOutbox();
        }
        return { ok: true };
      }
      case 'upload:drain':
        // Meant for the offscreen document; the background only needs to not
        // treat it as unknown.
        return { ok: true };
      case 'offscreen:ensure': {
        // The panel asks for this right before capture:start, so the offscreen
        // document is up to receive the stream id.
        await ensureOffscreen();
        return { ok: true };
      }
      case 'recording:event':
      case 'recording:pointer':
      case 'recording:force':
      case 'recording:stop':
        // The offscreen document consumes these via its own onMessage listener
        // (it owns the recorder now); the background only needs to not treat them
        // as unknown.
        return { ok: true };
      default:
        return { ok: false };
    }
  })().then(sendResponse, (error) => sendResponse({ error: String(error) }));
  return true;
});

/** Anything a web page sends is unvalidated input; nothing past this is trusted. */
function isExternalRequest(message: unknown): message is ExternalRequest {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false;
  if (message.type === 'handback:ping') return true;
  if (message.type !== 'handback:link') return false;
  if (!('apiToken' in message) || typeof message.apiToken !== 'string') return false;
  if ('orgId' in message && typeof message.orgId !== 'string') return false;
  return !('orgName' in message) || typeof message.orgName === 'string';
}

/**
 * A Handback page (the manifest says which ones) can ask whether the extension is
 * installed and hand it a token for its own server. The server linked is
 * `sender.origin` and never a URL from the payload — a matched page could
 * otherwise point every future upload at a server the human never chose.
 */
chrome.runtime.onMessageExternal.addListener((message: unknown, sender, sendResponse) => {
  (async (): Promise<ExternalPong | ExternalLinkResult> => {
    const origin = sender.origin;
    if (typeof origin !== 'string' || !origin.startsWith('http')) {
      return { ok: false, error: 'unknown sender' };
    }
    if (!isExternalRequest(message)) return { ok: false, error: 'unknown request' };
    switch (message.type) {
      case 'handback:ping': {
        const settings = await getSettings();
        const active = activeLink(settings);
        return {
          ok: true,
          version: chrome.runtime.getManifest().version,
          linked: settings.links.length > 0,
          serverUrl: active?.serverUrl ?? DEFAULT_SERVER,
          linkedOrigins: settings.links.map((l) => l.serverUrl),
        };
      }
      case 'handback:link': {
        // A page cached from 1.2.x may still send orgId/orgName. There is no org
        // to link to any more, so they are ignored: the token reaches the whole
        // account, and the panel picks the space.
        const apiToken = message.apiToken;
        if (!apiToken.startsWith('hb_') || apiToken.length > 200) {
          return { ok: false, error: 'that is not a Handback token' };
        }
        const settings = await getSettings();
        const id = linkId(origin);
        // One slot per server, and this token is the newer key for it.
        const known = settings.links.some((l) => l.id === id);
        const links = settings.links.filter((l) => l.id !== id);
        links.push({ id, serverUrl: origin, apiToken, addedAt: Date.now() });
        await kv.set(SETTINGS, {
          ...settings,
          links,
          activeLinkId: id,
          // Re-linking a server keeps the space it was uploading to; a server
          // this recorder has never seen starts on the owner's personal space.
          activeTeamId: known ? settings.activeTeamId : '',
        });
        await broadcast();
        return { ok: true };
      }
    }
  })().then(sendResponse, (error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
