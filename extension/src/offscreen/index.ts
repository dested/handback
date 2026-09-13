import { getSession, listOutbox, listRecordings, putOutbox, putSession } from '../lib/db';
import { buildFileSet } from '../lib/bundle';
import { pushGripe, type UploadProgress } from '../lib/upload';
import { agentPrompt } from '../lib/report';
import type { OutboxEntry, OutboxProgress, RecorderUpdate } from '../lib/types';
import type { Broadcast, CaptureStartResult, Request } from '../lib/messages';
import { send } from '../lib/messages';
import { Recorder } from './recorder';
import {
  enqueueTranscription,
  hasPendingTranscripts,
  recoverPendingTranscriptions,
  transcriptionState,
  waitForTranscripts,
} from './transcription';
import { Dictation, speechSupported } from '../content/speech';

/**
 * The offscreen document owns the two things with a DOM and a lifetime the panel
 * hasn't got: the uploader (contact-sheet assembly needs canvas/ImageBitmap; a
 * push must outlive the panel and the next walkthrough), and — since 1.11.0 —
 * the screen+mic capture itself. Capture used to live in the panel, so closing
 * the panel silently killed the recording; here it survives. Chrome's picker is
 * raised from here too (getDisplayMedia needs no gesture in an offscreen document,
 * and a desktopCapture stream id picked elsewhere can't be consumed here), and the
 * panel is a pure view that follows the live readout through `capture:*` broadcasts.
 *
 * Every upload state change is written to the outbox and broadcast as
 * `outbox:changed` so the panel's strip follows along; a finished push also
 * touches the session's `uploadedUrl` and broadcasts `state:changed` so Home
 * shows the ↗ link.
 */

const outboxChanged = () =>
  void chrome.runtime.sendMessage({ type: 'outbox:changed' }).catch(() => {});
const stateChanged = () => void chrome.runtime.sendMessage({ type: 'state:changed' }).catch(() => {});

/** One push at a time: the panel can enqueue several, but they go up in order. */
let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      // listOutbox is createdAt-ascending, so the first queued entry is the oldest.
      const next = (await listOutbox()).find((e) => e.state === 'queued');
      if (!next) break;
      await runOne(next);
    }
  } finally {
    draining = false;
  }
}

async function runOne(entry: OutboxEntry): Promise<void> {
  await putOutbox({ ...entry, state: 'uploading', error: undefined, waiting: undefined });
  outboxChanged();
  try {
    const session = await getSession(entry.sessionId);
    if (!session) throw new Error('the walkthrough was deleted on this machine');
    let recordings = (await listRecordings(entry.sessionId)).filter((r) => r.state === 'done');
    if (!recordings.length) throw new Error('nothing recorded');

    // A transcript for this session may still be running here; hold the bundle
    // until it lands so the walkthrough ships the real lines and not the live
    // dictation, then re-read the takes so the fresh transcript is picked up.
    if (hasPendingTranscripts(session.id)) {
      await putOutbox({ ...entry, state: 'uploading', waiting: 'transcript' });
      outboxChanged();
      await waitForTranscripts(session.id);
      await putOutbox({ ...entry, state: 'uploading', waiting: undefined });
      outboxChanged();
      recordings = (await listRecordings(entry.sessionId)).filter((r) => r.state === 'done');
    }

    const bundle = await buildFileSet(session, recordings);

    // The video is most of the bytes and the panel wants a live bar, but a write
    // per progress tick would hammer IndexedDB — one every 500ms, except the
    // finalize phase, which is the last thing before done and should land at once.
    let lastWrite = 0;
    const onProgress = (p: UploadProgress) => {
      const now = Date.now();
      if (p.phase !== 'finalize' && now - lastWrite < 500) return;
      lastWrite = now;
      const progress: OutboxProgress = {
        phase: p.phase,
        done: p.done,
        total: p.total,
        bytesDone: p.bytesDone,
        bytesTotal: p.bytesTotal,
      };
      void putOutbox({ ...entry, state: 'uploading', progress, waiting: undefined }).then(
        outboxChanged,
      );
    };

    const { url } = await pushGripe(entry.target, session, bundle.takes, bundle.files, {
      projectId: entry.projectId,
      teamId: entry.teamId,
      kind: entry.kind,
      onProgress,
    });

    await putOutbox({
      ...entry,
      state: 'done',
      url,
      brief: entry.kind === 'human' ? undefined : agentPrompt(session, url, bundle.takes.length),
      missing: bundle.missing || undefined,
      progress: undefined,
      waiting: undefined,
    });
    // So Home's session list shows "handed over" and the ↗ link the moment it lands.
    await putSession({ ...session, uploadedUrl: url, updatedAt: Date.now() });
    outboxChanged();
    stateChanged();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await putOutbox({ ...entry, state: 'failed', error: message, progress: undefined, waiting: undefined });
    outboxChanged();
    // One failure must not stall the rest — the loop moves on to the next queued entry.
  }
}

// ── capture ─────────────────────────────────────────────────────────────
/**
 * The take being recorded right now, or null. `update` is the last readout the
 * recorder emitted — held so a panel that mounts mid-take (`capture:state`) can
 * reattach its live view without waiting for the next tick.
 */
let live: { id: string; recorder: Recorder; update: RecorderUpdate } | null = null;
/** In-flight stop, so the Stop button, the on-page dock, and Chrome's own bar don't stop it thrice. */
let stopping: Promise<void> | null = null;

const broadcast = (message: Broadcast) => void chrome.runtime.sendMessage(message).catch(() => {});

async function startCapture(
  msg: Extract<Request, { type: 'capture:start' }>,
): Promise<CaptureStartResult> {
  if (live) return { ok: false, refused: false, error: 'already recording' };
  const recorder = new Recorder(
    {
      onUpdate: (u) => {
        if (live?.id === msg.id) {
          live.update = u;
          broadcast({ type: 'capture:update', id: msg.id, update: u });
        }
      },
      onEnd: () => void stopCapture(),
    },
    msg.lang,
    msg.scope,
    msg.id,
    speechSupported ? Dictation : null,
    msg.pristine,
  );
  // Seed `live` BEFORE awaiting start, so a capture:state that races the start
  // sees a take in progress rather than "nothing recording".
  live = {
    id: msg.id,
    recorder,
    update: {
      elapsedMs: 0,
      frameCount: 0,
      segmentCount: 0,
      interim: '',
      micState: 'off',
      sysAudio: 'none',
    },
  };
  try {
    await recorder.start();
  } catch (err) {
    live = null;
    // NotAllowedError is the human closing Chrome's picker — a normal outcome the
    // panel shows as "refused", not a failure. Anything else carries its name so
    // the flash says what actually went wrong instead of a bare "couldn't".
    const name = err instanceof DOMException ? err.name : '';
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, refused: name === 'NotAllowedError', error: name ? `${name}: ${message}` : message };
  }
  live.update.sysAudio = recorder.sysState;
  return { ok: true, sysAudio: recorder.sysState };
}

/**
 * Stop, save, and let the panel know — idempotent through `stopping`, since every
 * stop path (the panel's button, the page dock's `s`, Chrome's "Stop sharing"
 * bar via the track's `ended`) can fire at once. The video and its meta land via
 * `recording:finish`; transcription is queued here, and the panel refreshes off
 * `capture:done` while it mirrors the queue through `transcribe:update`.
 */
async function stopCapture(): Promise<void> {
  if (stopping) return stopping;
  stopping = (async () => {
    const current = live;
    if (!current) return;
    await send({ type: 'recording:setActive', active: false }).catch(() => {});
    const meta = await current.recorder.stop();
    await send({ type: 'recording:finish', id: current.id, meta });
    live = null;
    // The take is saved — start its transcript here rather than in the panel, so a
    // closed panel doesn't abandon it and the upload drain can wait on it.
    enqueueTranscription(current.id);
    broadcast({ type: 'capture:update', id: current.id, update: null });
    broadcast({ type: 'capture:done', id: current.id });
  })().finally(() => {
    stopping = null;
  });
  return stopping;
}

/** The share was granted but `recording:start` never landed: drop the bytes, no take. */
async function cancelCapture(id: string): Promise<void> {
  if (live?.id !== id) return;
  const current = live;
  await current.recorder.cancel();
  live = null;
  broadcast({ type: 'capture:update', id, update: null });
}

/** Anything on the wire is unvalidated; only shapes with a string `type` are ours to read. */
function isMessage(message: unknown): message is Request | Broadcast {
  return typeof message === 'object' && message !== null && 'type' in message;
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isMessage(message)) return false;
  switch (message.type) {
    case 'upload:drain':
      void drain();
      return false;
    case 'capture:start':
      void startCapture(message).then(sendResponse);
      return true;
    case 'capture:stop':
      void stopCapture().then(() => sendResponse({ ok: true }));
      return true;
    case 'capture:cancel':
      void cancelCapture(message.id).then(() => sendResponse({ ok: true }));
      return true;
    case 'capture:state':
      sendResponse(live ? { id: live.id, update: live.update } : null);
      return false;
    case 'transcribe:enqueue':
      enqueueTranscription(message.id);
      return false;
    case 'transcribe:state':
      sendResponse(transcriptionState());
      return false;
    // The recorded tab's telemetry and pointer, and the forces that overrule
    // dedup — the recorder keeps only what came from the tab it's scoped to.
    case 'recording:event':
      live?.recorder.addEvent(message.event, message.origin);
      return false;
    case 'recording:pointer':
      live?.recorder.addPointer(message.sample, message.origin);
      return false;
    case 'recording:force':
      live?.recorder.force(message.why, message.origin);
      return false;
    // The on-page dock's `s`. The offscreen document owns the recorder now, so it acts.
    case 'recording:stop':
      void stopCapture();
      return false;
    // Everything else — broadcasts, panel/background chatter — is not ours; don't
    // claim the response channel.
    default:
      return false;
  }
});

// The background creates this document and then sends upload:drain, but a create
// that races the message could drop it — draining once at load covers that gap.
void drain();
// A fresh offscreen document (Chrome tore the last one down, or a restart) leaves
// done takes that never got a transcript; re-queue them so the drain still waits.
void recoverPendingTranscriptions();
