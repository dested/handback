import { blobs, getRecording, getSession, listOutbox, listRecordings, listSessions } from '../lib/db';
import { send, type Broadcast } from '../lib/messages';
import { activeLink } from '../lib/types';
import type { Settings, TranscribeProgress, TranscribeState } from '../lib/types';
import { transcribeRecording } from './transcribe';
import { polishTranscript } from './polish';

/**
 * The post-recording transcription pass, run in the offscreen document rather than
 * the panel: a closed panel used to abandon a queued take mid-transcript, and the
 * upload drain now waits on this so a walkthrough never ships the live dictation
 * when the real transcript is seconds away. The panel is a pure mirror — it asks
 * for the queue on mount (`transcribe:state`) and follows every change through the
 * `transcribe:update` broadcast; it never runs a model.
 *
 * One model in memory at a time, so takes wait their turn and none are dropped.
 */

/** `queue[0]` is the take being transcribed; the rest are waiting. */
const queue: string[] = [];
/** The pump is walking the queue. */
let running = false;
/** The running take's stage, or null between takes. */
let progress: TranscribeProgress | null = null;
/** id → sessionId, so a waiter can tell whether any queued take is still its own. */
const sessions = new Map<string, string>();
/** Parked `waitForTranscripts` resolvers — re-checked after every run. */
const waiters: Array<() => void> = [];

const emit = () =>
  void chrome.runtime
    .sendMessage({ type: 'transcribe:update', state: transcriptionState() } satisfies Broadcast)
    .catch(() => {});

export function transcriptionState(): TranscribeState {
  return { queue: [...queue], progress };
}

/** True while a queued or running take belongs to `sessionId`. */
export function hasPendingTranscripts(sessionId: string): boolean {
  return queue.some((id) => sessions.get(id) === sessionId);
}

/**
 * Queue a take for transcription. Its session is looked up now so waiters can
 * match it while it sits in the queue; an id with no recording is dropped rather
 * than queued.
 */
export function enqueueTranscription(id: string): void {
  if (queue.includes(id)) return;
  void (async () => {
    const rec = await getRecording(id);
    if (!rec || queue.includes(id)) return;
    sessions.set(id, rec.sessionId);
    queue.push(id);
    emit();
    void pump();
  })();
}

/** Resolves once no queued or running transcription belongs to `sessionId`. Resolves at once when none does. */
export function waitForTranscripts(sessionId: string): Promise<void> {
  if (!hasPendingTranscripts(sessionId)) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (hasPendingTranscripts(sessionId)) return;
      const i = waiters.indexOf(check);
      if (i >= 0) waiters.splice(i, 1);
      resolve();
    };
    waiters.push(check);
  });
}

/** On load: re-queue done takes that never got a transcript. */
export async function recoverPendingTranscriptions(): Promise<void> {
  const [all, outbox] = await Promise.all([listSessions(), listOutbox()]);
  // A closed session is normally finished, but one still in the outbox (queued,
  // uploading, or failed) may be about to bundle and wants its transcript first.
  const pending = new Set(
    outbox
      .filter((e) => e.state === 'queued' || e.state === 'uploading' || e.state === 'failed')
      .map((e) => e.sessionId),
  );
  const candidates = all.filter((s) => !s.closed || pending.has(s.id));
  const now = Date.now();
  for (const session of candidates) {
    // Done, never transcribed, and recent enough to still matter — oldest first.
    const takes = (await listRecordings(session.id))
      .filter((r) => r.state === 'done' && !r.meta.transcriber && now - r.createdAt < 7 * 86_400_000)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const take of takes) enqueueTranscription(take.id);
  }
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      await runOne(queue[0]).catch(() => {});
      // Success or failure, the take is done: drop it, clear the stage, tell the
      // panel, and wake every waiter to re-check its session.
      const finished = queue.shift();
      if (finished) sessions.delete(finished);
      progress = null;
      emit();
      for (const check of [...waiters]) check();
    }
  } finally {
    running = false;
  }
}

/**
 * One take: decode + transcribe (server, or on-device when asked / offline), then
 * the cleanup pass that knows the page and its errors, then hand the lines back to
 * the worker. Settings are re-read per run — minutes may pass, and the server,
 * token, or on-device choice can have moved on since it was queued.
 */
async function runOne(id: string): Promise<void> {
  const video = await blobs.get(`${id}:video`);
  if (!video) return;
  // Takes with system audio carry a mic-only shadow — transcribe that, or the
  // app's own sound writes itself into the narration. The mixed webm is the
  // fallback for takes that never had one.
  const narration = (await blobs.get(`${id}:mic`)) ?? video;
  const settings = await send<Settings>({ type: 'settings:get' });
  const link = activeLink(settings);
  const result = await transcribeRecording(
    narration,
    {
      serverUrl: link?.serverUrl ?? '',
      apiToken: link?.apiToken ?? '',
      lang: settings.lang,
      onDevice: settings.onDeviceTranscription,
    },
    (p) => {
      progress = p;
      emit();
    },
  );
  if (!result?.segments.length) return;

  // The cleanup pass edits words, never timings; a null answer just ships the raw
  // lines — see offscreen/polish.ts.
  progress = { stage: 'polish', pct: -1 };
  emit();
  const rec = await getRecording(id);
  const session = rec ? await getSession(rec.sessionId) : undefined;
  const polished = await polishTranscript(result.segments, {
    serverUrl: link?.serverUrl ?? '',
    apiToken: link?.apiToken ?? '',
    origin: session?.origin,
    events: rec?.meta.events,
  }).catch(() => null);

  await send({
    type: 'recording:transcript',
    id,
    transcript: polished ?? result.segments,
    engine: result.engine,
    polished: Boolean(polished),
  });
}
