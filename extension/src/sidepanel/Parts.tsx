import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { blobs } from '../lib/db';
import { mmss, plural } from '../lib/format';
import { send } from '../lib/messages';
import { saveTake } from './save';
import type { Recording, Session, TranscribeProgress } from '../lib/types';
import { sessionKind } from '../lib/types';

/**
 * The review screen. A walkthrough is a collection of parts — one recording each,
 * in the order they were recorded — and this is the vertical list of them: play a
 * part, read what was said over it, fix a line, drop the whole thing, or record
 * another. It replaced the scrubber timeline: the person decides how the gripe is
 * cut up, part by part, rather than dragging one continuous axis.
 *
 * Like the timeline it replaced, this keeps no copy of the data. Every mutation —
 * a fixed line, a deleted part — goes out as a `send()` message; the worker
 * broadcasts `state:changed`, App re-pulls, and the new props redraw the card.
 */

export function Parts({
  session,
  recordings,
  busy,
  transcribing,
  progress,
  onAdd,
  onSay,
}: {
  session: Session;
  recordings: Recording[];
  /** Recording or uploading: nothing may be deleted, and no part may be added. */
  busy: boolean;
  /** Recording ids still queued for transcription; `transcribing[0]` is the one running now. */
  transcribing: string[];
  /** The running take's transcription progress, for its per-part bar. */
  progress: TranscribeProgress | null;
  onAdd: () => void;
  onSay: (text: string) => void;
}) {
  // Recorded order, oldest first — a part still recording is not one yet.
  const parts = useMemo(
    () =>
      recordings
        .filter((r) => r.state === 'done')
        .sort((a, b) => a.createdAt - b.createdAt),
    [recordings],
  );
  // A part being recorded right now: the add row hides (you are already at it) and
  // the empty line stays silent (the live readout above is saying it instead).
  const live = recordings.some((r) => r.state === 'recording');
  const empty = parts.length === 0;

  return (
    <div className="parts">
      {empty && !live && (
        <div className="parts-empty">
          nothing recorded yet — record the first part and talk through what's wrong
        </div>
      )}

      {parts.map((rec, i) => (
        <PartCard
          key={rec.id}
          session={session}
          rec={rec}
          n={i + 1}
          busy={busy}
          transcribing={transcribing.includes(rec.id)}
          progress={transcribing[0] === rec.id ? progress : null}
          onSay={onSay}
        />
      ))}

      {!live && (
        <button
          className="parts-add"
          disabled={busy}
          title={
            busy
              ? 'Not while this walkthrough is recording or uploading'
              : 'Record another part into this walkthrough'
          }
          onClick={onAdd}
        >
          {empty ? '+ Record the first part' : '+ Record another part'}
        </button>
      )}
    </div>
  );
}

function PartCard({
  session,
  rec,
  n,
  busy,
  transcribing,
  progress,
  onSay,
}: {
  session: Session;
  rec: Recording;
  n: number;
  busy: boolean;
  transcribing: boolean;
  progress: TranscribeProgress | null;
  onSay: (text: string) => void;
}) {
  /** The part's own recorded length — the seek denominator and the head-row clock. */
  const durMs = Math.max(rec.meta.durationMs, 1);
  const lines = rec.meta.transcript;
  const human = sessionKind(session) === 'human';

  // ── the video, or the still that stands in for it ─────────────────────────
  // A recovered session (or the preview harness) has the keyframes but not the
  // webm: the card shows the first frame dimmed rather than a broken player.
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [armed, setArmed] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [seeking, setSeeking] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const scriptRef = useRef<HTMLDivElement | null>(null);
  /** Escape unmounts the line input, which still fires blur — this tells blur to drop the edit. */
  const cancelled = useRef(false);

  useEffect(() => {
    let dead = false;
    let vUrl: string | null = null;
    let pUrl: string | null = null;
    setVideoUrl(null);
    setPosterUrl(null);
    setLoaded(false);
    setPlaying(false);
    setPlayhead(0);
    void (async () => {
      const video = await blobs.get(`${rec.id}:video`).catch(() => undefined);
      if (dead) return;
      if (video) {
        vUrl = URL.createObjectURL(video);
        setVideoUrl(vUrl);
        return;
      }
      const first = rec.meta.frames[0];
      if (!first) return;
      const frame = await blobs.get(`${rec.id}:frame:${first.index}`).catch(() => undefined);
      if (dead || !frame) return;
      pUrl = URL.createObjectURL(frame);
      setPosterUrl(pUrl);
    })();
    return () => {
      dead = true;
      if (vUrl) URL.revokeObjectURL(vUrl);
      if (pUrl) URL.revokeObjectURL(pUrl);
    };
  }, [rec.id]);

  // MediaRecorder webm ships with no duration, so a fresh <video> reports
  // Infinity and won't seek. Seeking to the far end forces Chrome to index the
  // file; the resulting `seeked` snaps it back to 0, and now the bar works.
  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    if (Number.isFinite(v.duration)) {
      setLoaded(true);
      return;
    }
    const onSeeked = () => {
      v.removeEventListener('seeked', onSeeked);
      v.currentTime = 0;
      setPlayhead(0);
      setLoaded(true);
    };
    v.addEventListener('seeked', onSeeked);
    v.currentTime = 1e9;
  };

  // The playhead follows the clock: rAF while it is moving, the timeupdate event
  // when it is parked (which is cheaper and enough).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setPlayhead(v.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const seekTo = useCallback(
    (clientX: number) => {
      const el = barRef.current;
      const v = videoRef.current;
      if (!el || !v) return;
      const rect = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const t = (frac * durMs) / 1000;
      v.currentTime = t;
      setPlayhead(t * 1000);
    },
    [durMs],
  );

  // Pointer-down seeks; dragging keeps seeking — window listeners so the drag
  // survives the pointer leaving the slim bar, the way the old scrubber did.
  useEffect(() => {
    if (!seeking) return;
    const onMove = (e: PointerEvent) => seekTo(e.clientX);
    const onUp = () => setSeeking(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [seeking, seekTo]);

  const seekToMs = (ms: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    setPlayhead(ms);
  };

  // The line being spoken right now: the last one whose start is at or behind the
  // playhead. Reading follows it, but only while playing — a click never yanks.
  const activeLine = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t <= playhead) idx = i;
      else break;
    }
    return idx;
  }, [lines, playhead]);

  useEffect(() => {
    if (!playing || activeLine < 0) return;
    scriptRef.current
      ?.querySelector(`[data-line="${activeLine}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [playing, activeLine]);

  const commitLine = async (index: number, text: string) => {
    setEditing(null);
    const seg = lines[index];
    if (!seg || text === seg.text) return;
    const res = await send<{ ok: boolean; stale?: boolean }>({
      type: 'recording:line:update',
      id: rec.id,
      index,
      text,
      rev: rec.meta.rev ?? 0,
    });
    if (res?.stale) onSay('the transcript changed underneath — that edit was dropped');
  };

  const deletePart = async () => {
    videoRef.current?.pause();
    setArmed(false);
    await send({ type: 'take:delete', id: rec.id });
  };

  const savePart = async () => {
    const ok = await saveTake(session, rec);
    onSay(ok ? 'saved to your Downloads' : 'this part has no video to save');
  };

  const frac = Math.min(1, Math.max(0, playhead / durMs));
  // The duration hack briefly reports a garbage currentTime; the display clamps it.
  const clockMs = Math.min(Math.max(playhead, 0), durMs);
  const errors = rec.meta.events.filter((e) => e.level === 'error').length;
  // Only upload/download stages report a real fraction; the rest slide indeterminate.
  const pct =
    progress && (progress.stage === 'upload' || progress.stage === 'download') ? progress.pct : -1;
  // The transcript's state, for agent walkthroughs only — a human video isn't transcribed.
  const transcriptState = transcribing
    ? 'writing the transcript'
    : lines.length > 0
      ? 'transcript ready'
      : '';

  const meta = [
    human ? 'full-rate video' : plural(rec.meta.frames.length, 'keyframe'),
    errors > 0 ? plural(errors, 'console error') : '',
    rec.interrupted ? 'recovered after the panel closed' : '',
    human ? '' : transcriptState,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section className="part">
      <div className="part-head">
        {armed ? (
          <span className="part-arm">
            delete part {n} ({mmss(durMs)})?
            <button className="part-yes" onClick={() => void deletePart()}>
              yes
            </button>
            <button onClick={() => setArmed(false)}>keep</button>
          </span>
        ) : (
          <>
            {/* The first keyframe when this machine still holds it, else a plain
                slot — the card reads as a clip either way. */}
            <span className="part-thumb">
              {posterUrl && <img src={posterUrl} alt="" draggable={false} />}
            </span>
            <span className="part-id">
              <span className="part-n">
                Part {n} · {mmss(durMs)}
              </span>
              <span className="part-meta">{meta}</span>
            </span>
            {transcribing ? (
              pct >= 0 ? (
                <span className="part-pct">{Math.round(pct)}%</span>
              ) : null
            ) : !human && lines.length > 0 ? (
              <span className="part-done" title="Transcript ready">
                ✓
              </span>
            ) : null}
            <button
              className="part-save"
              title={`Save part ${n}'s video to this computer`}
              onClick={() => void savePart()}
            >
              save
            </button>
            <button
              className="part-kill"
              disabled={busy}
              title={
                busy
                  ? 'Not while this walkthrough is recording or uploading'
                  : `Delete part ${n} and everything in it`
              }
              onClick={() => setArmed(true)}
            >
              ×
            </button>
          </>
        )}
      </div>

      {transcribing && (
        <div className={`part-prog${pct < 0 ? ' indeterminate' : ''}`}>
          <i style={pct >= 0 ? { width: `${pct}%` } : undefined} />
        </div>
      )}

      <div
        className={`part-well${videoUrl ? '' : ' poster'}`}
        onClick={videoUrl ? togglePlay : undefined}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            className="part-video"
            src={videoUrl}
            playsInline
            preload="metadata"
            onLoadedMetadata={onLoadedMetadata}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={() => {
              if (playing) return;
              const v = videoRef.current;
              if (v) setPlayhead(v.currentTime * 1000);
            }}
          />
        ) : (
          <>
            {posterUrl && <img className="part-still" src={posterUrl} alt="" draggable={false} />}
            <span className="part-novideo">video isn't on this machine</span>
          </>
        )}
      </div>

      {videoUrl && loaded && (
        <div className="part-controls">
          <button className="part-play" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <div
            className="part-seek"
            ref={barRef}
            onPointerDown={(e) => {
              seekTo(e.clientX);
              setSeeking(true);
            }}
          >
            <div className="part-seek-track">
              <i className="part-seek-fill" style={{ width: `${frac * 100}%` }} />
            </div>
          </div>
          <span className="part-clock">
            {mmss(clockMs)} / {mmss(durMs)}
          </span>
        </div>
      )}

      <div className="part-script">
        <div className="part-script-head">
          <span>transcript · {plural(lines.length, 'line')}</span>
          {lines.length > 0 && <span className="part-hint">click seeks · double-click fixes a line</span>}
        </div>
        {lines.length === 0 ? (
          <div className="part-noscript">
            {transcribing ? 'transcribing the narration…' : 'no narration on this part'}
          </div>
        ) : (
          <div className="part-lines" ref={scriptRef}>
            {lines.map((seg, i) => {
              const open = editing === i;
              const now = activeLine === i;
              return (
                <div
                  key={i}
                  data-line={i}
                  className={`part-line${now ? ' now' : ''}`}
                  onClick={() => {
                    if (open) return;
                    seekToMs(seg.t);
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    setEditing(i);
                  }}
                >
                  <span className="part-line-t">{mmss(seg.t)}</span>
                  {open ? (
                    <input
                      className="part-linein"
                      autoFocus
                      defaultValue={seg.text}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        if (cancelled.current) {
                          cancelled.current = false;
                          setEditing(null);
                          return;
                        }
                        void commitLine(i, e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        else if (e.key === 'Escape') {
                          cancelled.current = true;
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  ) : (
                    <span className="part-line-x">{seg.text}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
