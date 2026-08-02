import type {
  ContentCommand,
  ExternalLinkResult,
  ExternalPong,
  ExternalRequest,
  Request,
} from '../lib/messages';
import type {
  RecordingMeta,
  Session,
  SessionSummary,
  Settings,
  WorkspaceLink,
} from '../lib/types';
import { COBALT, DEFAULT_SERVER, DEFAULT_SETTINGS, activeLink, linkId } from '../lib/types';
import {
  blobs,
  deleteRecording,
  deleteSession,
  getRecording,
  getSession,
  kv,
  listRecordings,
  listSessions,
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

chrome.runtime.onInstalled.addListener((details) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Only on a fresh install — an update or a browser restart must not steal a tab.
  if (details.reason === 'install') {
    chrome.tabs.create({ url: `${DEFAULT_SERVER}/recorder` }).catch(() => {});
  }
});

async function getSettings(): Promise<Settings> {
  const stored =
    (await kv.get<Partial<Settings> & { serverUrl?: string; apiToken?: string; orgName?: string }>(
      SETTINGS,
    )) ?? {};
  if (!Array.isArray(stored.links) && stored.apiToken) {
    // 1.1.x stored exactly one workspace in three flat fields. Fold it into a
    // link once and persist, so nobody's existing setup unlinks on update.
    const serverUrl = stored.serverUrl || DEFAULT_SERVER;
    const link: WorkspaceLink = {
      id: linkId(serverUrl, ''),
      serverUrl,
      orgId: '',
      orgName: stored.orgName ?? '',
      apiToken: stored.apiToken,
      addedAt: Date.now(),
    };
    const next: Settings = {
      ...DEFAULT_SETTINGS,
      drawStart: stored.drawStart ?? DEFAULT_SETTINGS.drawStart,
      lang: stored.lang ?? '',
      onDeviceTranscription: stored.onDeviceTranscription ?? false,
      links: [link],
      activeLinkId: link.id,
    };
    await kv.set(SETTINGS, next);
    return next;
  }
  return { ...DEFAULT_SETTINGS, ...stored, links: Array.isArray(stored.links) ? stored.links : [] };
}

async function broadcast() {
  chrome.runtime.sendMessage({ type: 'state:changed' }).catch(() => {
    /* no side panel listening — fine */
  });
}

/** The toolbar icon is the only surface a closed panel has: it says a gripe is open and how full it is. */
async function updateBadge() {
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

async function createSession(name: string, origin: string): Promise<Session> {
  const now = Date.now();
  const label = name.trim() || 'Session';
  const session: Session = {
    id: crypto.randomUUID(),
    name: label,
    slug: await uniqueSlug(label, now),
    createdAt: now,
    updatedAt: now,
    origin,
    recCount: 0,
  };
  await putSession(session);
  await kv.set(ACTIVE_SESSION, session.id);
  return session;
}

/** Every part lands in the open gripe; only closing it starts a new one. */
async function ensureSession(name: string, origin: string): Promise<Session> {
  const current = await activeSession();
  if (current && !current.closed) return current;
  return createSession(name, origin);
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
}

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
        const session = await ensureSession(message.name.trim() || 'Walkthrough', message.origin);
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
        await setRecordingActive(true, message.origin);
        await updateBadge();
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
        });
        return { ok: true };
      }
      case 'recording:finish': {
        const rec = await getRecording(message.id);
        if (!rec) return { ok: false };
        // The chunk blobs are gone by now — the panel assembled the video from them.
        await putRecording({ ...rec, state: 'done', chunks: 0, meta: message.meta });
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
        // The last kept frame is the only clock we have — the panel that knew the
        // real duration died before it could tell us.
        const last = rec.meta.frames[rec.meta.frames.length - 1];
        await putRecording({
          ...rec,
          state: 'done',
          interrupted: true,
          chunks: 0,
          meta: { ...rec.meta, durationMs: last ? last.t : rec.meta.durationMs },
        });
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
      case 'recording:event':
      case 'recording:pointer':
      case 'recording:force':
      case 'recording:stop':
        // The side panel consumes these via its own onMessage listener; the
        // background only needs to not treat them as unknown.
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
 * installed and hand it a token for its own workspace. The workspace linked is
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
          orgs: settings.links
            .filter((l) => l.serverUrl === origin && l.orgId)
            .map((l) => ({ id: l.orgId, name: l.orgName })),
        };
      }
      case 'handback:link': {
        const apiToken = message.apiToken;
        if (!apiToken.startsWith('hb_') || apiToken.length > 200) {
          return { ok: false, error: 'that is not a Handback token' };
        }
        const orgId = (message.orgId ?? '').slice(0, 60);
        const orgName = (message.orgName ?? '').slice(0, 80);
        const settings = await getSettings();
        const id = linkId(origin, orgId);
        // One slot per (server, org). A link that finally learned its org id absorbs
        // the anonymous slot the same server held before.
        const links = settings.links.filter(
          (l) => l.id !== id && !(orgId && l.serverUrl === origin && !l.orgId),
        );
        links.push({ id, serverUrl: origin, orgId, orgName, apiToken, addedAt: Date.now() });
        await kv.set(SETTINGS, { ...settings, links, activeLinkId: id });
        await broadcast();
        return { ok: true };
      }
    }
  })().then(sendResponse, (error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
