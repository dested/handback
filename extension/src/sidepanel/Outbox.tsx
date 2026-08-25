import { useEffect, useState } from 'react';
import type { OutboxEntry } from '../lib/types';
import { listOutbox } from '../lib/db';
import { send } from '../lib/messages';

/**
 * The strip of in-flight and just-finished uploads, shown above the walkthrough
 * lists on the home screen and the editor. "send to Handback" no longer blocks —
 * it drops the walkthrough into an outbox the offscreen document drains — so this
 * is where the push you can no longer see is accounted for: what's going up, what
 * landed (with the link and the brief), and what failed (with a retry).
 *
 * Self-contained: it reads the outbox on mount and again on every `outbox:changed`
 * the offscreen document broadcasts, and renders nothing when the queue is empty.
 */

/** `41.2 MB` — the offscreen uploader can't hand its `mbPair` over, so bytes get named here. */
const mb = (n: number) => `${(n / 1e6).toFixed(n < 10e6 ? 1 : 0)} MB`;

/** An upload failure as a sentence, plus the raw server words for whoever wants them. */
interface UploadExplanation {
  line: string;
  detail?: string;
  /** The token itself is the problem — the strip points at the recorder page, not a retry. */
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

export function OutboxStrip({ serverHost }: { serverHost: string }) {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);

  useEffect(() => {
    let live = true;
    const load = () =>
      void listOutbox().then((rows) => {
        if (live) setEntries(rows);
        // Watchdog: an entry can sit 'uploading' forever if Chrome tore the
        // offscreen doc down mid-push — opening the panel is the moment to
        // recover it. kick is idempotent (create-catch + draining guard), and a
        // fresh offscreen doc re-queues whatever was stuck.
        if (live && rows.some((r) => r.state === 'queued' || r.state === 'uploading')) {
          void send({ type: 'upload:kick' }).catch(() => {});
        }
      });
    load();
    const listener = (message: { type?: string }) => {
      if (message?.type === 'outbox:changed') load();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      live = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  if (!entries.length) return null;

  // Newest first — the one you just sent is the one you're looking for.
  const rows = [...entries].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section className="outbox">
      {rows.map((e) => (
        <OutboxRow key={e.id} entry={e} serverHost={serverHost} />
      ))}
    </section>
  );
}

function OutboxRow({ entry, serverHost }: { entry: OutboxEntry; serverHost: string }) {
  const [copied, setCopied] = useState(false);

  if (entry.state === 'uploading') {
    const p = entry.progress;
    const pct = p && p.bytesTotal > 0 ? Math.min(100, (p.bytesDone / p.bytesTotal) * 100) : 0;
    if (!p || p.phase === 'declare') {
      return (
        <div className="ob-row">
          <div className="ob-line">preparing “{entry.title}”…</div>
        </div>
      );
    }
    if (p.phase === 'finalize') {
      return (
        <div className="ob-row">
          <div className="ob-line">finishing “{entry.title}”…</div>
        </div>
      );
    }
    return (
      <div className="ob-row">
        <div className="ob-head">
          <span className="ob-line">
            uploading “{entry.title}” — {Math.floor(pct)}%
          </span>
          <span className="ob-bytes">
            {mb(p.bytesDone)} of {mb(p.bytesTotal)}
          </span>
        </div>
        <div className="ob-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (entry.state === 'queued') {
    return (
      <div className="ob-row">
        <div className="ob-line muted">queued “{entry.title}”</div>
      </div>
    );
  }

  if (entry.state === 'failed') {
    const explained = explainUpload(entry.error ?? '', serverHost);
    return (
      <div className="ob-row">
        <div className="ob-line">upload of “{entry.title}” failed</div>
        <div className="ob-sub">{explained.line}</div>
        <div className="ob-actions">
          <button className="link" onClick={() => void send({ type: 'outbox:retry', id: entry.id })}>
            retry
          </button>
          <button
            className="ob-dismiss"
            title="Forget this — the walkthrough is still on this machine"
            onClick={() => void send({ type: 'outbox:dismiss', id: entry.id })}
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  // done
  const copyBrief = () => {
    if (!entry.brief) return;
    void navigator.clipboard.writeText(entry.brief).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="ob-row">
      <div className="ob-head">
        <span className="ob-line">“{entry.title}” uploaded</span>
        <span className="ob-actions">
          {entry.url && (
            <button
              className="ob-open"
              title="Open it in Handback"
              onClick={() => entry.url && void chrome.tabs.create({ url: entry.url })}
            >
              ↗
            </button>
          )}
          {entry.brief && (
            <button className="link" onClick={copyBrief}>
              {copied ? 'copied' : 'copy brief'}
            </button>
          )}
          <button
            className="ob-dismiss"
            title="Clear this from the strip"
            onClick={() => void send({ type: 'outbox:dismiss', id: entry.id })}
          >
            ×
          </button>
        </span>
      </div>
      {entry.missing ? (
        <div className="ob-sub">
          {entry.missing} keyframe{entry.missing === 1 ? '' : 's'} had gone missing
        </div>
      ) : null}
    </div>
  );
}
