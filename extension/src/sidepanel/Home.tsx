import { useEffect, useMemo, useState } from 'react';
import type { ServerLink, Session, SessionKind, SessionSummary, Settings } from '../lib/types';
import { DEFAULT_SERVER } from '../lib/types';
import { spaceName, spaceProjects, type ServerContext } from '../lib/context';
import { send } from '../lib/messages';
import { ago, hostOf, mmss, plural } from '../lib/format';
import { saveSession } from './save';
import { OutboxStrip } from './Outbox';
import {
  fetchWalkthroughs,
  inboxUrl,
  walkthroughUrl,
  type SpaceWalkthrough,
  type WalkthroughStatus,
} from '../lib/walkthroughs';

/**
 * The panel with nothing open. It used to be one button and a lot of paper —
 * which said, accurately, that this window was empty, and nothing else. This is
 * the same button over the answer to "where does it go, and what happened to the
 * last ten?": the space it uploads to and the ones it could, that space's queue
 * with the status somebody put each one in, its projects, and the sessions still
 * sitting in this browser.
 *
 * Everything below the Record button is a read. Nothing here can lose work, so
 * every failure degrades to a line of text — an unreachable server still leaves
 * a recorder you can record with.
 */

const STATUS_LABEL: Record<WalkthroughStatus, string> = {
  open: 'open',
  in_review: 'in review',
  resolved: 'resolved',
};

/** How much of the queue fits before the list stops being a glance. */
const FEED_SHOWN = 6;

interface HomeProps {
  sessions: Session[];
  /**
   * A walkthrough is open and the human stepped back here to look around. Its row
   * is the way back in, so it says so — this screen is navigation, not an archive.
   */
  openSessionId: string | null;
  settings: Settings;
  /** Where uploads go — null when this recorder holds no server key at all. */
  link: ServerLink | null;
  ctx: ServerContext | null;
  ctxFailed: boolean;
  /** Who the next take is for — the fork that decides how it is captured. */
  kind: SessionKind;
  /**
   * The open walkthrough already holds a take, so the mode is settled: the two
   * capture differently and one walkthrough can't hold both.
   */
  kindLocked: boolean;
  onPickKind: (kind: SessionKind) => void;
  onRecord: () => void;
  onOpenSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  /** Both halves of the destination at once: which server, and which space on it. */
  onPickSpace: (serverUrl: string, teamId: string) => void;
  onOpenRecorder: () => void;
  onOpenSettings: () => void;
}

const openTab = (url: string) => void chrome.tabs.create({ url });

export function Home({
  sessions,
  openSessionId,
  settings,
  link,
  ctx,
  ctxFailed,
  kind,
  kindLocked,
  onPickKind,
  onRecord,
  onOpenSession,
  onDeleteSession,
  onPickSpace,
  onOpenRecorder,
  onOpenSettings,
}: HomeProps) {
  const [feed, setFeed] = useState<SpaceWalkthrough[] | null>(null);
  const [feedFailed, setFeedFailed] = useState(false);
  /** Bumped by the retry link — the effect below is the only thing that fetches. */
  const [reloads, setReloads] = useState(0);
  const [status, setStatus] = useState<WalkthroughStatus | 'all'>('all');
  const [projectName, setProjectName] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({});
  const [showAll, setShowAll] = useState(false);

  const serverUrl = link?.serverUrl ?? '';
  /** The queue is the active space's, not the whole account's. */
  const teamId = settings.activeTeamId;

  useEffect(() => {
    if (!link) {
      setFeed(null);
      return;
    }
    const control = new AbortController();
    setFeed(null);
    setFeedFailed(false);
    void fetchWalkthroughs(link, teamId, control.signal).then(
      (rows) => setFeed(rows),
      () => {
        // An aborted fetch is this effect being torn down, not a failure worth
        // telling anyone about.
        if (!control.signal.aborted) setFeedFailed(true);
      },
    );
    return () => control.abort();
  }, [link?.id, link?.apiToken, teamId, reloads]);

  // Takes and durations for every session, not just the open one — the summaries
  // are metadata only, so this is cheap next to what `state:get` already carries.
  const sessionKey = sessions.map((s) => s.id).join(',');
  useEffect(() => {
    let live = true;
    void send<Record<string, SessionSummary>>({ type: 'sessions:summary' })
      .then((answer) => {
        if (live && answer) setSummaries(answer);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sessionKey]);

  const counts = useMemo(() => {
    const by: Record<WalkthroughStatus, number> = { open: 0, in_review: 0, resolved: 0 };
    for (const w of feed ?? []) by[w.status]++;
    return by;
  }, [feed]);

  /** Projects the space named, and any the queue mentions that it didn't. */
  const projects = useMemo(() => {
    const names = new Set(spaceProjects(ctx, teamId).map((p) => p.name));
    for (const w of feed ?? []) if (w.projectName) names.add(w.projectName);
    return [...names];
  }, [ctx, teamId, feed]);

  const filtered = useMemo(() => {
    return (feed ?? []).filter(
      (w) =>
        (status === 'all' || w.status === status) &&
        (projectName === null || w.projectName === projectName),
    );
  }, [feed, status, projectName]);

  const shown = showAll ? filtered : filtered.slice(0, FEED_SHOWN);

  /**
   * The one you stepped out of first, then unfinished work, then the most recently
   * touched. The worker hands these back newest-first, which buries a draft under
   * whatever was handed over after it — and a draft is the only row here anyone
   * still has to do something about.
   */
  const local = useMemo(
    () =>
      [...sessions].sort(
        (a, b) =>
          Number(b.id === openSessionId) - Number(a.id === openSessionId) ||
          Number(Boolean(a.closed)) - Number(Boolean(b.closed)) ||
          (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
      ),
    [sessions, openSessionId],
  );
  /**
   * The space this recorder is pointed at. Only the active server's teams are
   * known — the context fetch follows the active link — so every other server
   * offers its personal space here and grows its teams once it is picked.
   */
  const activeSpace = spaceName(ctx, teamId) || (link ? hostOf(link.serverUrl) : '');
  const spaces = settings.links.flatMap((l) =>
    l.id === link?.id
      ? [
          { key: `${l.serverUrl}::`, serverUrl: l.serverUrl, teamId: '', name: 'Personal' },
          ...(ctx?.teams ?? []).map((t) => ({
            key: `${l.serverUrl}::${t.id}`,
            serverUrl: l.serverUrl,
            teamId: t.id,
            name: t.name,
          })),
        ]
      : [{ key: `${l.serverUrl}::`, serverUrl: l.serverUrl, teamId: '', name: 'Personal' }],
  );

  return (
    <div className="home">
      <OutboxStrip serverHost={hostOf(serverUrl || DEFAULT_SERVER)} />

      <section className="hero">
        {/* Who it's for decides everything downstream — frame rate, whether
            anything is distilled, where it ends up — so it is the first choice,
            not a setting. Locked once the open walkthrough holds a take. */}
        <div className="kindpick" role="radiogroup" aria-label="Who is this recording for?">
          {(
            [
              { value: 'agent', label: 'for an agent' },
              { value: 'human', label: 'for a person' },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={kind === option.value}
              className={`kindpick-opt${kind === option.value ? ' on' : ''}`}
              disabled={kindLocked && kind !== option.value}
              title={
                kindLocked
                  ? 'This walkthrough already has a recording — its mode is settled'
                  : undefined
              }
              onClick={() => onPickKind(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button className="rec-hero" onClick={onRecord}>
          <span className="dot" />
          {kind === 'human' ? 'Record a video' : 'Record a walkthrough'}
        </button>
        <p className="hero-sub">
          {kind === 'human'
            ? 'Full-rate, full-quality video for a person to watch. Nothing is distilled — you tighten it up in Handback and send a link.'
            : "Screen + voice. Talk through what's wrong — it becomes a brief your team's agent can act on."}
        </p>
        <p className="hero-keys">alt+shift+D draw on the page</p>
      </section>

      {link ? (
        <>
          {/* Where the next recording lands, said before it is recorded rather than
              only at the send button. Clicking it is also how a second server
              gets added, so the switcher is the whole destination story in one row. */}
          <section className="wsbar">
            <button
              className={`wsbar-main${switching ? ' on' : ''}`}
              aria-expanded={switching}
              title="The space this recorder uploads to"
              onClick={() => setSwitching((v) => !v)}
            >
              <span className="wsbar-dot" />
              <span className="wsbar-text">
                <span className="wsbar-name">{activeSpace}</span>
                <span className="wsbar-meta">
                  {hostOf(serverUrl)}
                  {ctx ? ` · ${plural(spaceProjects(ctx, teamId).length, 'project')}` : ''}
                </span>
              </span>
              <span className="chev">{switching ? '▴' : '▾'}</span>
            </button>
            {switching && (
              <div className="wspick">
                {spaces.map((s) => (
                  <button
                    key={s.key}
                    className={`wspick-row${s.serverUrl === link.serverUrl && s.teamId === teamId ? ' on' : ''}`}
                    onClick={() => {
                      onPickSpace(s.serverUrl, s.teamId);
                      setSwitching(false);
                    }}
                  >
                    <i className="wsdot" />
                    <span className="wsname">{s.name}</span>
                    <span className="wshost">{hostOf(s.serverUrl)}</span>
                  </button>
                ))}
                <button
                  className="wspick-row add"
                  onClick={() => {
                    onOpenRecorder();
                    setSwitching(false);
                  }}
                >
                  + link another server…
                </button>
              </div>
            )}
          </section>

          <section className="feed">
            <div className="sec-head">
              <span>In {activeSpace}</span>
              <button className="link" onClick={() => openTab(inboxUrl(serverUrl))}>
                open inbox →
              </button>
            </div>

            {/* The three statuses are Handback's whole vocabulary, so they are
                the filter — and their counts are the only summary anyone wants. */}
            {feed && feed.length > 0 && (
              <div className="chips">
                <Chip
                  label="all"
                  n={feed.length}
                  on={status === 'all'}
                  pick={() => setStatus('all')}
                />
                {(['open', 'in_review', 'resolved'] as const).map((s) => (
                  <Chip
                    key={s}
                    label={STATUS_LABEL[s]}
                    tone={s}
                    n={counts[s]}
                    on={status === s}
                    pick={() => setStatus(status === s ? 'all' : s)}
                  />
                ))}
              </div>
            )}
            {projects.length > 1 && (
              <div className="chips">
                {projects.map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    on={projectName === name}
                    pick={() => setProjectName(projectName === name ? null : name)}
                  />
                ))}
              </div>
            )}

            {feed === null && !feedFailed && (
              <div className="feed-skel">
                <i />
                <i />
                <i />
              </div>
            )}

            {feedFailed && (
              <p className="note">
                couldn't reach {hostOf(serverUrl)} ·{' '}
                <button className="link" onClick={() => setReloads((n) => n + 1)}>
                  try again
                </button>
              </p>
            )}

            {feed?.length === 0 && (
              <p className="note">
                Nothing here yet. The first walkthrough you hand over shows up in this list — and in
                your agent's queue.
              </p>
            )}

            {feed !== null && feed.length > 0 && filtered.length === 0 && (
              <p className="note">Nothing matches that filter.</p>
            )}

            {shown.map((w) => (
              <button
                key={w.id}
                className="wtrow"
                title={`Open ${w.slug} in Handback`}
                onClick={() => openTab(walkthroughUrl(serverUrl, w.id))}
              >
                <span className={`sdot ${w.status}`} />
                <span className="wt-body">
                  <span className="wt-title">{w.title}</span>
                  <span className="wt-meta">
                    {[
                      STATUS_LABEL[w.status],
                      mmss(w.durationMs),
                      w.takeCount > 1 ? plural(w.takeCount, 'part') : '',
                      w.projectName ?? (w.origin ? hostOf(w.origin) : ''),
                      ago(w.recordedAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {w.errorCount > 0 && (
                  <span
                    className="wt-err"
                    title="Console errors the page threw while it was recorded"
                  >
                    {w.errorCount} err
                  </span>
                )}
              </button>
            ))}

            {filtered.length > FEED_SHOWN && (
              <button className="link" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'show fewer' : `show all ${filtered.length}`}
              </button>
            )}
          </section>
        </>
      ) : (
        <section className="feed">
          <div className="linkcard">
            <strong>Link Handback</strong>
            <p>
              Recordings stay on this machine until this recorder holds a key. One click on the
              recorder page connects it — nothing to paste.
            </p>
            <button className="primary" onClick={onOpenRecorder}>
              link handback →
            </button>
            <button className="link" onClick={onOpenSettings}>
              or paste a token by hand
            </button>
          </div>
        </section>
      )}

      {sessions.length > 0 && (
        <section className="local">
          <div className="sec-head">
            <span>On this machine</span>
            <span className="count">{sessions.length}</span>
          </div>
          {local.map((s) => {
            const sum = summaries[s.id];
            const meta = [
              sum && sum.takes ? plural(sum.takes, 'part') : 'nothing recorded',
              sum && sum.durationMs ? mmss(sum.durationMs) : '',
              s.origin ? hostOf(s.origin) : '',
              ago(s.updatedAt || s.createdAt),
            ]
              .filter(Boolean)
              .join(' · ');
            const isOpen = s.id === openSessionId;
            return (
              <div key={s.id} className={`lrow${isOpen ? ' on' : ''}`}>
                <button
                  className="lrow-main"
                  title={
                    isOpen
                      ? 'Back into this walkthrough'
                      : s.closed
                        ? 'Reopen this walkthrough here'
                        : 'Open this walkthrough'
                  }
                  onClick={() => onOpenSession(s.id)}
                >
                  <span className="lrow-title">
                    {s.name}
                    {isOpen ? (
                      <span className="ltag draft">open · resume</span>
                    ) : s.uploadedUrl ? (
                      <span className="ltag done">handed over</span>
                    ) : s.closed ? (
                      <span className="ltag">closed</span>
                    ) : (
                      <span className="ltag draft">draft</span>
                    )}
                  </span>
                  <span className="lrow-meta">{meta}</span>
                </button>
                {s.uploadedUrl && (
                  <button
                    className="lrow-open"
                    title="Open it in Handback"
                    onClick={() => openTab(s.uploadedUrl ?? '')}
                  >
                    ↗
                  </button>
                )}
                {(sum?.takes ?? 0) > 0 && (
                  <button
                    className="lrow-save"
                    title="Save this walkthrough's video to this computer"
                    onClick={() => void saveSession(s)}
                  >
                    ↓
                  </button>
                )}
                <button
                  className="kill"
                  title="Forget this walkthrough here (anything already uploaded stays in Handback)"
                  onClick={() => onDeleteSession(s.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </section>
      )}

      {/* The one thing the panel can't answer for itself, and the reason a
          walkthrough is worth recording at all. */}
      {link && !ctxFailed && (
        <p className="home-foot">
          An agent pulls these over MCP —{' '}
          <button className="link" onClick={() => openTab(`${serverUrl}/connect`)}>
            connect one
          </button>
        </p>
      )}
    </div>
  );
}

/** A count you can filter by. Off-state is a hairline; on-state is the ink. */
function Chip({
  label,
  n,
  on,
  tone,
  pick,
}: {
  label: string;
  n?: number;
  on: boolean;
  tone?: WalkthroughStatus;
  pick: () => void;
}) {
  return (
    <button className={`chip${on ? ' on' : ''}${tone ? ` ${tone}` : ''}`} onClick={pick}>
      {label}
      {n !== undefined && <span className="chip-n">{n}</span>}
    </button>
  );
}
