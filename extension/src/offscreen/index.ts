import { getSession, listOutbox, listRecordings, putOutbox, putSession } from '../lib/db';
import { buildFileSet } from '../lib/bundle';
import { pushGripe, type UploadProgress } from '../lib/upload';
import { agentPrompt } from '../lib/report';
import type { OutboxEntry, OutboxProgress } from '../lib/types';

/**
 * The uploader, in an offscreen document rather than the panel or the service
 * worker: it has the DOM that contact-sheet assembly needs (canvas, ImageBitmap)
 * and a lifetime the panel doesn't — the human can close the side panel, or start
 * a whole new walkthrough, and the push keeps going. It owns nothing but the
 * queue; the panel enqueues, the background wakes this, and this drains.
 *
 * Every state change is written to the outbox and broadcast as `outbox:changed`
 * so the panel's strip follows along; a finished push also touches the session's
 * `uploadedUrl` and broadcasts `state:changed` so Home shows the ↗ link.
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
  await putOutbox({ ...entry, state: 'uploading', error: undefined });
  outboxChanged();
  try {
    const session = await getSession(entry.sessionId);
    if (!session) throw new Error('the walkthrough was deleted on this machine');
    const recordings = (await listRecordings(entry.sessionId)).filter((r) => r.state === 'done');
    if (!recordings.length) throw new Error('nothing recorded');

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
      void putOutbox({ ...entry, state: 'uploading', progress }).then(outboxChanged);
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
    });
    // So Home's session list shows "handed over" and the ↗ link the moment it lands.
    await putSession({ ...session, uploadedUrl: url, updatedAt: Date.now() });
    outboxChanged();
    stateChanged();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await putOutbox({ ...entry, state: 'failed', error: message, progress: undefined });
    outboxChanged();
    // One failure must not stall the rest — the loop moves on to the next queued entry.
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type === 'upload:drain') void drain();
  // Everything else — broadcasts, panel/background chatter — is not ours; don't
  // claim the response channel.
  return false;
});

// The background creates this document and then sends upload:drain, but a create
// that races the message could drop it — draining once at load covers that gap.
void drain();
