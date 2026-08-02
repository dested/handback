import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { blobs } from '../lib/db';
import { mmss } from '../lib/format';
import { send } from '../lib/messages';
import { framePos, linePos, partSpans, totalMs } from '../lib/timeline';
import type { Recording, Session, TimelineRef } from '../lib/types';
import './timeline.css';

/**
 * The editor. A walkthrough is one time axis and this is the surface that reads
 * it: drag anywhere to scrub, watch the monitor follow, read back what you said,
 * fix a word, drop a whole take. The uploaded report is generated from these same
 * positions, so what is drawn here is what the agent gets.
 *
 * **One gesture.** Pointer-down on the ruler, the filmstrip, the voice lane or
 * bare track scrubs, and keeping the button down keeps scrubbing. There is no
 * selection: no sweep, no marquee, no modifier, no click-versus-drag fork. The
 * only other things you can do to the axis are fixing a line (the readout row or
 * the transcript below) and deleting a take (its own label in the strip).
 *
 * Every position comes from lib/timeline — nothing here does take arithmetic.
 * Every mutation goes out as a message and comes back as new props: the worker
 * broadcasts, the panel re-pulls, this component redraws. It keeps no copy.
 */

type Row = 'frames' | 'voice';

/** One thing on the axis, already resolved to a position — the render and every hit test read this. */
interface Item {
  key: string;
  ref: TimelineRef;
  row: Row;
  pos: number;
  /** ms of width. Only spoken lines cover a window; everything else is an instant. */
  dur: number;
  text?: string;
  url?: string;
}

/** One slot of the filmstrip. The strip is cells, not frames — that is the whole point. */
interface Cell {
  i: number;
  /** Middle of the slice this cell covers. */
  mid: number;
  left: number;
  w: number;
  frame?: Item;
}

/** Both edges get breathing room so a clip at 0:00 and one at the end are both whole. */
const EDGE = 8;
const TICKS = [1e3, 2e3, 5e3, 1e4, 15e3, 3e4, 6e4, 12e4, 3e5, 6e5, 12e5];
/** Narrower than this and a line is a block, not a label — the readout carries its text. */
const TEXT_MIN = 48;
/** Past this many cells the strip renders only what is near the viewport. */
const WINDOW_AT = 300;
/** How far a cell will reach for a keyframe before it gives up and reads as a gap. */
const GAP_MS = 8000;
const CELL_FALLBACK = 72;
const MAX_ZOOM = 64;
/** Frame blobs are read in batches so a few hundred of them don't open a few hundred
 *  transactions at once — a long take's budget scales (recorder.ts `frameBudget`). */
const LOAD_BATCH = 12;
/** A quiet notice is a notice, not a state — it goes away on its own. */
const NOTICE_MS = 8000;
/** Roughly how wide the armed take's question renders — enough to keep it on screen. */
const ASK_W = 210;

/** No transcriber told us how long the line took, so guess from the words. */
const estimate = (text: string) => Math.max(700, text.trim().split(/\s+/).length * 320);

/** `1:23`, `83`, `1:23.5` — what someone types into the playhead readout. */
function parseClock(text: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}(?:\.\d+)?)$/.exec(text.trim());
  if (!match) return null;
  const minutes = match[1] ? parseInt(match[1], 10) : 0;
  const seconds = parseFloat(match[2]);
  if (match[1] && seconds >= 60) return null;
  return Math.round((minutes * 60 + seconds) * 1000);
}

/** Items are sorted by pos, so the one under any time is a bisect away, not a scan. */
function nearest(list: Item[], t: number): Item | undefined {
  if (!list.length) return undefined;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].pos < t) lo = mid + 1;
    else hi = mid;
  }
  const before = list[lo - 1];
  const after = list[lo];
  if (!before) return after;
  if (!after) return before;
  return t - before.pos <= after.pos - t ? before : after;
}

export function Timeline({
  session,
  recordings,
  /** Recording or uploading: the axis is still readable, but nothing may be destroyed. */
  busy,
}: {
  session: Session;
  recordings: Recording[];
  busy: boolean;
}) {
  const [ph, setPh] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewW, setViewW] = useState(0);
  const [cellW, setCellW] = useState(CELL_FALLBACK);
  const [scrollX, setScrollX] = useState(0);
  /** The pointer is down on the axis. There is exactly one drag in this component. */
  const [scrubbing, setScrubbing] = useState(false);
  /** Which line is open AND on which surface — two autofocused inputs blur each other shut. */
  const [editing, setEditing] = useState<{ key: string; at: 'read' | 'script' } | null>(null);
  /** The transcript, whole. The axis shows where words sit; this is where you read them. */
  const [script, setScript] = useState(true);
  /** A frame held in the monitor until the next scrub — double-click parks it there. */
  const [pinned, setPinned] = useState<string | null>(null);
  /** What someone is typing into the playhead readout, while they are typing it. */
  const [clockDraft, setClockDraft] = useState<string | null>(null);
  /** The transcript moved underneath an edit. Said quietly, then gone. */
  const [notice, setNotice] = useState<{ text: string; tone: 'stale' | 'plain' } | null>(null);
  /** A take's delete is armed. Same discipline as discard: it names what it costs first. */
  const [confirmTake, setConfirmTake] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const anchorZoom = useRef<{ ms: number; px: number } | null>(null);
  const scrollTick = useRef(0);
  const scriptRef = useRef<HTMLDivElement | null>(null);

  const spans = useMemo(() => partSpans(recordings), [recordings]);
  /** Takes laid end to end are the whole axis: it opens at 0 and ends when the talking does. */
  const axisEnd = useMemo(() => totalMs(spans), [spans]);

  // ── the frames, as pictures ───────────────────────────────────────────
  // The monitor is an image lookup, not a video seek, so it has to be instant
  // while the playhead is being dragged — every keyframe of the open walkthrough
  // is held as an object URL, and a URL is revoked the moment its frame is gone.
  const urlsRef = useRef(new Map<string, string>());
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    return () => {
      for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
      urlsRef.current.clear();
      setUrls({});
    };
  }, [session.id]);

  useEffect(() => {
    let cancelled = false;
    const want = new Set<string>();
    for (const rec of recordings) {
      for (const frame of rec.meta.frames) want.add(`${rec.id}:frame:${frame.index}`);
    }
    let dropped = false;
    for (const [key, url] of urlsRef.current) {
      if (want.has(key)) continue;
      URL.revokeObjectURL(url);
      urlsRef.current.delete(key);
      dropped = true;
    }
    const missing = [...want].filter((key) => !urlsRef.current.has(key));
    if (dropped && !missing.length) setUrls(Object.fromEntries(urlsRef.current));
    if (!missing.length) return;
    void (async () => {
      for (let i = 0; i < missing.length; i += LOAD_BATCH) {
        const batch = missing.slice(i, i + LOAD_BATCH);
        const loaded = await Promise.all(batch.map((key) => blobs.get(key).catch(() => undefined)));
        if (cancelled) return;
        batch.forEach((key, n) => {
          const blob = loaded[n];
          if (blob && !urlsRef.current.has(key)) {
            urlsRef.current.set(key, URL.createObjectURL(blob));
          }
        });
        setUrls(Object.fromEntries(urlsRef.current));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordings]);

  // ── everything on the axis ────────────────────────────────────────────
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const rec of recordings) {
      for (const frame of rec.meta.frames) {
        out.push({
          key: `f:${rec.id}:${frame.index}`,
          ref: { kind: 'frame', recId: rec.id, index: frame.index },
          row: 'frames',
          pos: framePos(rec, frame, spans),
          dur: 0,
          url: urls[`${rec.id}:frame:${frame.index}`],
        });
      }
      rec.meta.transcript.forEach((seg, i) => {
        out.push({
          key: `l:${rec.id}:${i}`,
          ref: { kind: 'line', recId: rec.id, index: i },
          row: 'voice',
          pos: linePos(rec, seg, spans),
          dur: seg.d ?? estimate(seg.text),
          text: seg.text,
        });
      });
    }
    return out.sort((a, b) => a.pos - b.pos);
  }, [recordings, spans, urls]);

  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const frames = useMemo(() => items.filter((i) => i.row === 'frames'), [items]);
  const lines = useMemo(() => items.filter((i) => i.row === 'voice'), [items]);

  const recsRef = useRef(recordings);
  useLayoutEffect(() => {
    recsRef.current = recordings;
  });

  const say = useCallback((text: string, tone: 'stale' | 'plain' = 'plain') => {
    setNotice({ text, tone });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const span = Math.max(axisEnd, 1000) * 1.04;
  const contentW = Math.max(viewW - EDGE * 2, 200) * zoom;
  const pxPerMs = contentW / span;
  const playhead = ph ?? 0;
  /** Nothing to draw: no picture, no words. The axis collapses to one line. */
  const bare = frames.length === 0 && lines.length === 0;

  const x = useCallback((pos: number) => EDGE + pos * pxPerMs, [pxPerMs]);
  const msAt = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return (clientX - rect.left + el.scrollLeft - EDGE) / pxPerMs;
    },
    [pxPerMs],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // --cell-w steps at the same breakpoints the width does, so both are read together.
    const read = () => {
      setViewW(el.clientWidth);
      const w = parseFloat(getComputedStyle(el).getPropertyValue('--cell-w'));
      if (w > 0) setCellW(w);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bare]);

  // Zoom keeps whatever was under the cursor (or the middle) where it was.
  const zoomTo = useCallback(
    (next: number, clientX?: number) => {
      const el = scrollRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const px = clientX === undefined ? rect.width / 2 : clientX - rect.left;
        anchorZoom.current = { ms: msAt(rect.left + px), px };
      }
      setZoom(Math.min(MAX_ZOOM, Math.max(1, next)));
    },
    [msAt],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const at = anchorZoom.current;
    if (!el || !at) return;
    anchorZoom.current = null;
    el.scrollLeft = EDGE + at.ms * pxPerMs - at.px;
    setScrollX(el.scrollLeft);
  }, [zoom, pxPerMs]);

  // React's wheel listener is passive, and this one has to cancel the page zoom.
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  useLayoutEffect(() => {
    wheel.current = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomTo(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX);
    };
  });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheel.current(e);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [bare]);

  // ── the one gesture ───────────────────────────────────────────────────
  /** Land the playhead where the pointer is. Bounded by the axis: past the end there is nothing. */
  const scrubTo = useCallback(
    (clientX: number) => setPh(Math.min(Math.max(0, msAt(clientX)), Math.max(axisEnd, 0))),
    [msAt, axisEnd],
  );

  const startScrub = (e: React.PointerEvent) => {
    scrubTo(e.clientX);
    setPinned(null);
    setEditing(null);
    setScrubbing(true);
  };

  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (e: PointerEvent) => scrubTo(e.clientX);
    const onUp = () => setScrubbing(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [scrubbing, scrubTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commitLine = async (item: Item, text: string) => {
    setEditing(null);
    if (text === item.text) return;
    const ref = item.ref;
    if (ref.kind !== 'line') return;
    const res = await send<{ ok: boolean; stale?: boolean }>({
      type: 'recording:line:update',
      id: ref.recId,
      index: ref.index,
      text,
      rev: recsRef.current.find((r) => r.id === ref.recId)?.meta.rev ?? 0,
    });
    if (res?.stale) say('the transcript changed underneath — that edit was dropped', 'stale');
  };

  const commitClock = (text: string) => {
    setClockDraft(null);
    const at = parseClock(text);
    if (at === null) return;
    setPh(Math.min(Math.max(0, at), axisEnd));
    setPinned(null);
  };

  /**
   * Drop a whole take: its row, its frames, its blobs. The worker re-lays what is
   * left as takes 1..N, so the axis stays one continuous clock and the playhead is
   * pointing at the wrong moment afterwards — it goes home rather than lie.
   */
  const deleteTake = async (recId: string) => {
    setConfirmTake(null);
    setPinned(null);
    setPh(0);
    await send({ type: 'take:delete', id: recId });
  };

  // ── the filmstrip ─────────────────────────────────────────────────────
  const cells = useMemo<Cell[]>(() => {
    if (!frames.length) return [];
    const count = Math.max(1, Math.ceil(contentW / cellW));
    const sliceMs = cellW / pxPerMs;
    // Every cell reaches for the keyframe nearest its middle; past that reach the
    // footage genuinely has nothing there and the cell reads as a gap.
    const reach = Math.max(sliceMs * 1.5, GAP_MS);
    const from = count > WINDOW_AT ? Math.max(0, Math.floor((scrollX - viewW) / cellW)) : 0;
    const to = count > WINDOW_AT ? Math.min(count, Math.ceil((scrollX + viewW * 2) / cellW)) : count;
    const out: Cell[] = [];
    for (let i = from; i < to; i++) {
      const mid = (i + 0.5) * sliceMs;
      const frame = nearest(frames, mid);
      out.push({
        i,
        mid,
        left: EDGE + i * cellW,
        w: Math.max(1, Math.min(cellW, contentW - i * cellW)),
        frame: frame && Math.abs(frame.pos - mid) <= reach ? frame : undefined,
      });
    }
    return out;
  }, [frames, contentW, cellW, pxPerMs, scrollX, viewW]);

  // ── what the monitor is showing ───────────────────────────────────────
  const shot = useMemo(() => {
    if (pinned) {
      const held = byKey.get(pinned);
      if (held?.url) return held.url;
    }
    let best: Item | undefined;
    for (const frame of frames) {
      if (!frame.url) continue;
      if (frame.pos <= playhead) best = frame;
      else if (!best) return frame.url;
      else break;
    }
    return best?.url;
  }, [pinned, byKey, frames, playhead]);

  /** Under the picture: what is being said right here, big enough to read and fix. */
  const readout = useMemo(() => {
    let before: Item | undefined;
    for (const line of lines) {
      if (line.pos <= playhead && playhead <= line.pos + line.dur) return line;
      if (line.pos <= playhead) before = line;
      else break;
    }
    return before ?? lines[0];
  }, [lines, playhead]);

  // Reading follows the playhead — the current line stays in view, never yanked.
  useEffect(() => {
    if (!script || !readout) return;
    scriptRef.current
      ?.querySelector(`[data-line="${CSS.escape(readout.key)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [script, readout]);

  const ticks = useMemo(() => {
    const step = TICKS.find((s) => s * pxPerMs >= 56) ?? TICKS[TICKS.length - 1];
    const out: number[] = [];
    for (let t = 0; t <= span && out.length < 240; t += step) out.push(t);
    return out;
  }, [pxPerMs, span]);

  const seams = useMemo(() => spans.slice(1).map((s) => s.start), [spans]);

  /** The take whose delete is armed, and which number it wears on the axis. */
  const armed = useMemo(() => {
    const i = spans.findIndex((s) => s.rec.id === confirmTake);
    return i < 0 ? null : { n: i + 1, span: spans[i] };
  }, [spans, confirmTake]);

  // ── status, honestly ──────────────────────────────────────────────────
  const live = recordings.some((r) => r.state === 'recording');
  const recovered = recordings.some((r) => r.interrupted);
  const status = live
    ? 'recording — the axis grows as you talk'
    : recovered
      ? 'one take was recovered after the panel closed'
      : // Drag-to-scrub is not a thing anyone discovers by accident, and it is now
        // the only gesture there is, so the row spends its one line saying it.
        'drag anywhere to scrub';

  /**
   * Nothing recorded and nothing said yet — a fresh walkthrough, or one that is
   * three seconds into its first take. There is no axis to draw, so it does not
   * draw one: no monitor, no ruler, no empty well, no zoom. One line.
   */
  if (bare) {
    return (
      <div className="tl bare">
        <div className="tl-empty">
          {live ? (
            'listening — the axis appears as the screen changes'
          ) : (
            <>
              hit <b>Record</b> and talk through what's wrong
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="tl">
      {/* With no frame to show, the monitor is a blank slab that eats the panel and
          crushes the axis against the bottom edge. Empty, it collapses to a line
          that says why it is empty; full, it still never takes more than half. */}
      <div className={`tl-monitor${shot ? '' : ' bare'}`}>
        <div className="tl-screen">
          {shot ? (
            <img src={shot} alt="" draggable={false} />
          ) : (
            <span className="tl-noshot">no frame here</span>
          )}
        </div>
      </div>

      <div className="tl-axis">
        <div className="tl-read">
          {/* The clock is an input: typing 1:23 into it seeks there. */}
          <span className="tl-at">
            <input
              className="tl-clockin"
              value={clockDraft ?? mmss(playhead)}
              aria-label="playhead"
              onChange={(e) => setClockDraft(e.target.value)}
              onFocus={(e) => setClockDraft(e.target.value)}
              onBlur={(e) => commitClock(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <span className="tl-of">/ {mmss(axisEnd)}</span>
          </span>

          {/* Opens on click, not pointerdown: mousedown's own focus default lands
              after the input mounts and would blur it straight back shut. */}
          {readout ? (
            editing?.key === readout.key && editing.at === 'read' ? (
              <input
                className="tl-linein"
                autoFocus
                defaultValue={readout.text}
                onBlur={(e) => void commitLine(readout, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            ) : (
              <span
                className="tl-said"
                title="click to fix this line"
                onClick={() => setEditing({ key: readout.key, at: 'read' })}
              >
                {readout.text}
              </span>
            )
          ) : (
            <span className="tl-said tl-none">no words on this stretch</span>
          )}

          {/* Zoom is a preference, not an action: small, muted, out of the way at
              the end of the row it belongs to. It used to be a full-width band. */}
          <span className="tl-zoom">
            <button onClick={() => zoomTo(zoom / 1.5)} disabled={zoom <= 1} title="zoom out">
              –
            </button>
            <input
              className="tl-slider"
              type="range"
              min={0}
              max={Math.log2(MAX_ZOOM)}
              step={0.05}
              value={Math.log2(zoom)}
              aria-label="zoom"
              onChange={(e) => zoomTo(2 ** Number(e.target.value))}
            />
            <button onClick={() => zoomTo(zoom * 1.5)} disabled={zoom >= MAX_ZOOM} title="zoom in">
              +
            </button>
            <button className="tl-fit" onClick={() => zoomTo(1)} disabled={zoom <= 1}>
              fit
            </button>
          </span>
        </div>

        <div className={`tl-status${notice?.tone === 'stale' ? ' stale' : ''}`}>
          {notice ? notice.text : status}
        </div>

        <div
          className="tl-scroll"
          ref={scrollRef}
          onScroll={(e) => {
            // One read per frame: the strip only windows on this, it doesn't animate.
            const left = e.currentTarget.scrollLeft;
            if (scrollTick.current) return;
            scrollTick.current = requestAnimationFrame(() => {
              scrollTick.current = 0;
              setScrollX(left);
            });
          }}
        >
          <div className="tl-inner" style={{ width: contentW + EDGE * 2 }}>
            <div className="tl-ruler" onPointerDown={startScrub}>
              {ticks.map((t) => (
                <span className="tl-tickmark" key={t} style={{ left: EDGE + t * pxPerMs }}>
                  {mmss(t)}
                </span>
              ))}
              <span className="tl-knob" style={{ left: x(playhead) }} onPointerDown={startScrub} />
            </div>

            <div className="tl-tracks" onPointerDown={startScrub}>
              {/* Each take says which one it is and offers the only way to remove it.
                  It arms in place — the row is a fixed height, so the question never
                  shoves the axis around while it is being answered. */}
              <div className="tl-takes">
                {spans.map((s, i) => (
                  <div
                    key={s.rec.id}
                    className={`tl-take${confirmTake === s.rec.id ? ' arm' : ''}`}
                    style={{ left: x(s.start), width: Math.max(2, (s.end - s.start) * pxPerMs) }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <span className="tl-take-name">
                      take {i + 1} · {mmss(s.end - s.start)}
                    </span>
                    <button
                      className="tl-take-kill"
                      disabled={busy}
                      title={
                        busy
                          ? 'Not while this walkthrough is recording or uploading'
                          : `Delete take ${i + 1} and everything in it`
                      }
                      onClick={() => setConfirmTake(s.rec.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {/* The question is a sibling of the labels, not a child of one: a
                    take can be four seconds wide or start off the right edge, and
                    the one thing that must never happen is a confirm you can read
                    half of. It rides its take, clamped into the viewport. */}
                {armed && (
                  <span
                    className="tl-take-ask"
                    style={{
                      left: Math.max(
                        scrollX + 2,
                        Math.min(x(armed.span.start), scrollX + viewW - ASK_W),
                      ),
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    delete take {armed.n} ({mmss(armed.span.end - armed.span.start)})?
                    <button className="tl-take-yes" onClick={() => void deleteTake(armed.span.rec.id)}>
                      yes
                    </button>
                    <button onClick={() => setConfirmTake(null)}>keep</button>
                  </span>
                )}
              </div>

              {frames.length > 0 && (
                <div className="tl-strip">
                  <span className="tl-label">frames</span>
                  {cells.map((cell) => (
                    <div
                      key={cell.i}
                      className={`tl-cell${cell.frame ? '' : ' gap'}`}
                      style={{ left: cell.left, width: cell.w }}
                      onDoubleClick={() => cell.frame && setPinned(cell.frame.key)}
                    >
                      {cell.frame?.url && <img src={cell.frame.url} alt="" draggable={false} />}
                    </div>
                  ))}
                </div>
              )}

              {lines.length > 0 && (
                <div className="tl-voice">
                  <span className="tl-label">voice</span>
                  {lines.map((item, idx) => {
                    // Width is duration — except a transcriber that overruns the next
                    // line would bury it. The overrun is trimmed, never the block: a
                    // well-formed transcript is untouched by this.
                    const next = lines[idx + 1];
                    const room = next ? next.pos - item.pos : Infinity;
                    const w = Math.max(Math.min(item.dur, room) * pxPerMs, 2);
                    const now = playhead >= item.pos && playhead <= item.pos + item.dur;
                    return (
                      <div
                        key={item.key}
                        className={`tl-clip${now ? ' now' : ''}`}
                        style={{ left: x(item.pos), width: w }}
                      >
                        {w >= TEXT_MIN && <span>{item.text}</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {seams.map((s) => (
                <span className="tl-seam" key={s} style={{ left: x(s) }} />
              ))}
            </div>

            <span className="tl-head" style={{ left: x(playhead) }} />
          </div>
        </div>

        {lines.length > 0 && (
          <div className="tl-script">
            <div className="tl-script-head">
              <button className="tl-script-toggle" onClick={() => setScript((v) => !v)}>
                <i aria-hidden="true">{script ? '▾' : '▸'}</i> transcript · {lines.length} line
                {lines.length === 1 ? '' : 's'}
              </button>
              <span className="tl-script-hint">click seeks · double-click fixes a line</span>
            </div>
            {script && (
              <div className="tl-script-list" ref={scriptRef}>
                {lines.map((item) => {
                  const open = editing?.key === item.key && editing.at === 'script';
                  const now = readout?.key === item.key;
                  return (
                    <div
                      key={item.key}
                      data-line={item.key}
                      className={`tl-line${now ? ' now' : ''}`}
                      onClick={() => {
                        if (open) return;
                        setPh(item.pos);
                        setPinned(null);
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        setEditing({ key: item.key, at: 'script' });
                      }}
                    >
                      <span className="tl-line-t">{mmss(item.pos)}</span>
                      {open ? (
                        <input
                          className="tl-linein"
                          autoFocus
                          defaultValue={item.text}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => void commitLine(item, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                        />
                      ) : (
                        <span className="tl-line-x">{item.text}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
