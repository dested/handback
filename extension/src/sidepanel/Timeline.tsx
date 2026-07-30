import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { blobs } from '../lib/db';
import { mmss } from '../lib/format';
import { send } from '../lib/messages';
import { framePos, linePos, partSpans, totalMs } from '../lib/timeline';
import type { Recording, Session, TimelineMove, TimelineRef } from '../lib/types';
import './timeline.css';

/**
 * The editor. A gripe is one time axis and this is the surface that edits it:
 * scrub it, read back what you said, fix a word, sweep a junk stretch and delete
 * it, drag something to where it belongs. The uploaded report is generated from
 * these same positions, so an edit here is an edit to the handoff.
 *
 * Every position comes from lib/timeline — nothing here does take arithmetic.
 * Every mutation goes out as a message and comes back as new props: the worker
 * broadcasts, the panel re-pulls, this component redraws. It keeps no copy.
 *
 * Two shapes, one tree: it measures its own box and sits the monitor beside the
 * axis when that box is landscape (the popped editor strip), stacked otherwise
 * (the side rail).
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
  mark?: boolean;
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

type Drag =
  | { mode: 'scrub' }
  /** Ruler and filmstrip both resolve to a time range; `click` is what a sub-slop drag meant. */
  | { mode: 'range'; a: number; b: number; click?: { key?: string; pos: number } }
  | { mode: 'marquee'; x0: number; y0: number; x1: number; y1: number }
  | { mode: 'move'; x0: number; dx: number; live: boolean };

/** Both edges get breathing room so a clip at 0:00 and one at the end are both whole. */
const EDGE = 8;
/** A drag has to beat this before a click stops being a click. */
const SLOP = 3;
const TICKS = [1e3, 2e3, 5e3, 1e4, 15e3, 3e4, 6e4, 12e4, 3e5, 6e5, 12e5];
/** Narrower than this and a line is a block, not a label — the readout carries its text. */
const TEXT_MIN = 48;
/** Past this many cells the strip renders only what is near the viewport. */
const WINDOW_AT = 300;
/** How far a cell will reach for a keyframe before it gives up and reads as a gap. */
const GAP_MS = 8000;
const CELL_FALLBACK = 72;
const MAX_ZOOM = 64;
/** Monitor beside the axis only when the box is genuinely landscape, not merely big. */
const WIDE_MIN_W = 900;
const WIDE_RATIO = 2.2;
/** A box mid-layout is 0 tall, and 0 tall divides into any width — that is not landscape. */
const WIDE_MIN_H = 120;
/** Frame blobs are read in batches so 150 of them don't open 150 transactions at once. */
const LOAD_BATCH = 12;
/** A quiet notice is a notice, not a state — it goes away on its own. */
const NOTICE_MS = 8000;

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

export function Timeline({ session, recordings }: { session: Session; recordings: Recording[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  /** Set only when the selection came from a time sweep — the bar says so. */
  const [range, setRange] = useState<{ a: number; b: number } | null>(null);
  const [ph, setPh] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewW, setViewW] = useState(0);
  const [cellW, setCellW] = useState(CELL_FALLBACK);
  const [scrollX, setScrollX] = useState(0);
  /** Landscape enough to sit the monitor beside the axis — the popped editor strip. */
  const [wide, setWide] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Which line is open AND on which surface. The readout usually covers the same
  // line the selected block holds, and two autofocused inputs blur each other shut.
  const [editing, setEditing] = useState<{ key: string; at: 'clip' | 'read' | 'script' } | null>(
    null,
  );
  /** The transcript, whole. The axis shows where words sit; this is where you read them. */
  const [script, setScript] = useState(true);
  /** A frame held in the monitor until the next click — double-click parks it there. */
  const [pinned, setPinned] = useState<string | null>(null);
  /** What someone is typing into the playhead readout, while they are typing it. */
  const [clockDraft, setClockDraft] = useState<string | null>(null);
  /** The transcript moved underneath an edit. Said quietly, then gone. */
  const [notice, setNotice] = useState<{ text: string; tone: 'stale' | 'plain' } | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tracksRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const boxRef = useRef<DOMRect | null>(null);
  const anchorZoom = useRef<{ ms: number; px: number } | null>(null);
  /** Where a shift-click extends from. */
  const anchorKey = useRef<string | null>(null);
  const scrollTick = useRef(0);
  const scriptRef = useRef<HTMLDivElement | null>(null);

  const spans = useMemo(() => partSpans(recordings), [recordings]);
  /** Takes laid end to end are the whole axis: it opens at 0 and ends when the talking does. */
  const axisEnd = useMemo(() => totalMs(spans), [spans]);

  // ── the frames, as pictures ───────────────────────────────────────────
  // The monitor is an image lookup, not a video seek, so it has to be instant
  // while the playhead is being dragged — every keyframe of the open gripe is
  // held as an object URL, and a URL is revoked the moment its frame is gone.
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
          mark: frame.reason === 'mark',
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
  const marks = useMemo(() => frames.filter((f) => f.mark), [frames]);

  // Handlers live for a whole drag; the data under them doesn't.
  const selRef = useRef(sel);
  const itemsRef = useRef(items);
  const recsRef = useRef(recordings);
  useLayoutEffect(() => {
    selRef.current = sel;
    itemsRef.current = items;
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

  // Lines are positional and a transcription pass replaces the whole array — every
  // batch says which rev it was drawn from, and the worker skips a take that moved on.
  const revsFor = (refs: TimelineRef[]) => {
    const revs: Record<string, number> = {};
    for (const ref of refs) {
      const rec = recsRef.current.find((r) => r.id === ref.recId);
      if (rec) revs[ref.recId] = rec.meta.rev ?? 0;
    }
    return revs;
  };

  const span = Math.max(axisEnd, 1000) * 1.04;
  const contentW = Math.max(viewW - EDGE * 2, 200) * zoom;
  const pxPerMs = contentW / span;
  const playhead = ph ?? 0;
  const hasContent = recordings.length > 0;

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
    // --cell-w steps at the same breakpoints the width does, and the shape
    // restyles it too, so both are read together.
    const read = () => {
      setViewW(el.clientWidth);
      const w = parseFloat(getComputedStyle(el).getPropertyValue('--cell-w'));
      if (w > 0) setCellW(w);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasContent, wide]);

  // The shape question is about the component's own box, not the window: the same
  // component is a 380px rail, a tab, and a 400px-tall strip across the screen.
  const measure = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setWide(height >= WIDE_MIN_H && width >= WIDE_MIN_W && width > height * WIDE_RATIO);
  }, []);

  // Whatever sits above the timeline settles over several commits while a gripe
  // loads, and this box is the height they leave behind — one observation during
  // that is a shape that never existed. Re-read every commit; `wide` changes
  // nothing about the root's own box, so it cannot feed back.
  useLayoutEffect(measure);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasContent, measure]);

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
  }, [hasContent]);

  const setDragBoth = useCallback((next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const clearSel = useCallback(() => {
    setSel(new Set());
    setRange(null);
    setEditing(null);
    anchorKey.current = null;
  }, []);

  const doDelete = useCallback(async () => {
    const refs = itemsRef.current.filter((i) => selRef.current.has(i.key)).map((i) => i.ref);
    if (!refs.length) return;
    clearSel();
    setPinned(null);
    const res = await send<{ ok: boolean; stale?: boolean }>({
      type: 'timeline:delete',
      items: refs,
      revs: revsFor(refs),
    });
    if (res?.stale) say('the transcript changed underneath — check what remains', 'stale');
    else say(`deleted ${refs.length} item${refs.length === 1 ? '' : 's'}`);
  }, [clearSel, say]);

  const commitMove = useCallback(
    async (dms: number) => {
      const picked = itemsRef.current.filter((i) => selRef.current.has(i.key));
      if (!picked.length) return;
      const moves: TimelineMove[] = picked.map((i) => ({
        kind: i.ref.kind,
        recId: i.ref.recId,
        index: i.ref.index,
        tl: Math.max(0, Math.round(i.pos + dms)),
      }));
      const res = await send<{ ok: boolean; stale?: boolean }>({
        type: 'timeline:move',
        moves,
        revs: revsFor(moves),
      });
      if (res?.stale) say('the transcript changed underneath — that drag partly missed', 'stale');
    },
    [say],
  );

  /** Everything whose extent intersects a stretch of the axis — including frames no cell is showing. */
  const selectRange = useCallback((a: number, b: number) => {
    const [from, to] = a <= b ? [a, b] : [b, a];
    setRange({ a: from, b: to });
    setSel(new Set(itemsRef.current.filter((i) => i.pos + i.dur >= from && i.pos <= to).map((i) => i.key)));
    setEditing(null);
  }, []);

  // ── dragging ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      if (current.mode === 'scrub') setPh(Math.max(0, msAt(e.clientX)));
      else if (current.mode === 'range') setDragBoth({ ...current, b: msAt(e.clientX) });
      else if (current.mode === 'marquee') {
        const box = boxRef.current;
        if (!box) return;
        setDragBoth({ ...current, x1: e.clientX - box.left, y1: e.clientY - box.top });
      } else {
        const dx = e.clientX - current.x0;
        if (!current.live && Math.abs(dx) < SLOP) return;
        setDragBoth({ ...current, dx, live: true });
      }
    };
    const onUp = () => {
      const current = dragRef.current;
      setDragBoth(null);
      if (!current) return;
      if (current.mode === 'range') {
        const [a, b] = [Math.min(current.a, current.b), Math.max(current.a, current.b)];
        // Under the slop it was a click: the ruler only moved the playhead, a cell
        // also hands over the frame it was showing.
        if ((b - a) * pxPerMs < SLOP) {
          const click = current.click;
          if (!click) return;
          setSel(click.key ? new Set([click.key]) : new Set());
          setRange(null);
          setPh(Math.max(0, click.pos));
          setPinned(null);
          setEditing(null);
          anchorKey.current = click.key ?? null;
          return;
        }
        selectRange(a, b);
      } else if (current.mode === 'marquee') {
        const box = boxRef.current;
        const inner = tracksRef.current;
        if (!box || !inner) return;
        const [lx, rx] = [Math.min(current.x0, current.x1), Math.max(current.x0, current.x1)];
        const [ty, by] = [Math.min(current.y0, current.y1), Math.max(current.y0, current.y1)];
        // A pointerup that never travelled is a click on empty space: clear.
        if (rx - lx < SLOP && by - ty < SLOP) {
          clearSel();
          return;
        }
        const hit = new Set<string>();
        for (const node of inner.querySelectorAll<HTMLElement>('[data-key]')) {
          const r = node.getBoundingClientRect();
          const l = r.left - box.left;
          const t = r.top - box.top;
          if (l <= rx && l + r.width >= lx && t <= by && t + r.height >= ty) {
            hit.add(node.dataset.key!);
          }
        }
        setRange(null);
        setSel(hit);
      } else if (current.mode === 'move' && current.live) {
        void commitMove(current.dx / pxPerMs);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDragBoth(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [drag?.mode, msAt, pxPerMs, setDragBoth, commitMove, selectRange, clearSel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'Escape') {
        setEditing(null);
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (typing || !selRef.current.size) return;
      e.preventDefault();
      void doDelete();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doDelete]);

  const toggle = (key: string) => {
    setRange(null);
    anchorKey.current = key;
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Shift-click reaches back to the last thing clicked and takes the stretch between. */
  const extendTo = (pos: number) => {
    const from = anchorKey.current ? byKey.get(anchorKey.current)?.pos : undefined;
    selectRange(from ?? playhead, pos);
  };

  /** A cell you don't own yet sweeps a range; one you do drags the whole selection. */
  const onCellDown = (e: React.PointerEvent, cell: Cell) => {
    e.stopPropagation();
    const frame = cell.frame;
    if (e.shiftKey) {
      extendTo(frame ? frame.pos : cell.mid);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && frame) {
      toggle(frame.key);
      return;
    }
    if (frame && sel.has(frame.key)) {
      setDragBoth({ mode: 'move', x0: e.clientX, dx: 0, live: false });
      return;
    }
    const at = msAt(e.clientX);
    setDragBoth({
      mode: 'range',
      a: at,
      b: at,
      click: { key: frame?.key, pos: frame ? frame.pos : cell.mid },
    });
  };

  const onClipDown = (e: React.PointerEvent, item: Item, roomy: boolean) => {
    if (editing?.key === item.key) return;
    e.stopPropagation();
    if (e.shiftKey) {
      extendTo(item.pos);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      toggle(item.key);
      return;
    }
    if (!sel.has(item.key)) {
      setRange(null);
      setSel(new Set([item.key]));
      setPh(item.pos);
      setPinned(null);
      setEditing(null);
      anchorKey.current = item.key;
      return;
    }
    if (sel.size === 1) {
      // Already the one thing selected: the second click is the edit. A block too
      // narrow to type in hands the job to the readout, which is why it exists.
      // preventDefault, or pointerdown's focus default blurs the input as it mounts.
      e.preventDefault();
      setEditing({ key: item.key, at: roomy ? 'clip' : 'read' });
      if (!roomy) setPh(item.pos);
      return;
    }
    // Grabbing anything in the selection drags the whole selection.
    setDragBoth({ mode: 'move', x0: e.clientX, dx: 0, live: false });
  };

  const onTracksDown = (e: React.PointerEvent) => {
    const inner = tracksRef.current;
    if (!inner) return;
    boxRef.current = inner.getBoundingClientRect();
    const box = boxRef.current;
    setEditing(null);
    setDragBoth({
      mode: 'marquee',
      x0: e.clientX - box.left,
      y0: e.clientY - box.top,
      x1: e.clientX - box.left,
      y1: e.clientY - box.top,
    });
  };

  const onRulerDown = (e: React.PointerEvent) => {
    const at = msAt(e.clientX);
    setPh(Math.max(0, at));
    setDragBoth({ mode: 'range', a: at, b: at });
  };

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

  // ── the filmstrip ─────────────────────────────────────────────────────
  const cells = useMemo<Cell[]>(() => {
    if (!hasContent) return [];
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
  }, [hasContent, frames, contentW, cellW, pxPerMs, scrollX, viewW]);

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

  // The popped strip has no vertical room to spare; the tall panel does.
  useEffect(() => setScript(!wide), [wide]);

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

  // ── status, honestly ──────────────────────────────────────────────────
  /** Takes with words nobody has read back yet. This is the one thing an agent can't recover from. */
  const unread = recordings.filter((r) => r.meta.transcript.length && !r.meta.reviewed);
  const readBack =
    !unread.length && recordings.some((r) => r.meta.transcript.length && r.meta.reviewed);
  const live = recordings.some((r) => r.state === 'recording');
  const recovered = recordings.some((r) => r.interrupted);
  const status = live
    ? 'recording — the axis grows as you talk'
    : recovered
      ? 'one take was recovered after the panel closed'
      : '';

  const dx = drag?.mode === 'move' && drag.live ? drag.dx : 0;
  const sweep = drag?.mode === 'range' ? drag : null;
  const marquee = drag?.mode === 'marquee' ? drag : null;
  const shift = dx ? `translateX(${dx}px)` : undefined;

  if (!hasContent) {
    return (
      <div className="tl" ref={rootRef}>
        <div className="tl-empty">
          <span>nothing yet</span>
          hit <b>Record</b> and talk through what's wrong
        </div>
      </div>
    );
  }

  // Two shapes, one tree: the monitor and the axis are siblings, and `wide` is the
  // only thing that decides whether CSS stacks them or sits them side by side.
  return (
    <div className={`tl${wide ? ' wide' : ''}`} ref={rootRef}>
      <div className="tl-monitor">
        <div className="tl-screen">{shot && <img src={shot} alt="" draggable={false} />}</div>
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
        </div>

        {(status || notice) && (
          <div className={`tl-status${notice?.tone === 'stale' ? ' stale' : ''}`}>
            {notice ? notice.text : status}
          </div>
        )}

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
            <div className="tl-ruler" onPointerDown={onRulerDown}>
              {ticks.map((t) => (
                <span className="tl-tickmark" key={t} style={{ left: EDGE + t * pxPerMs }}>
                  {mmss(t)}
                </span>
              ))}
              <span
                className="tl-knob"
                style={{ left: x(playhead) }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDragBoth({ mode: 'scrub' });
                }}
              />
            </div>

            <div className="tl-tracks" ref={tracksRef} onPointerDown={onTracksDown}>
              {frames.length > 0 && (
                <div className="tl-strip">
                  <span className="tl-label">frames</span>
                  {cells.map((cell) => {
                    const on = !!cell.frame && sel.has(cell.frame.key);
                    return (
                      <div
                        key={cell.i}
                        data-key={cell.frame?.key}
                        className={`tl-cell${on ? ' on' : ''}${cell.frame ? '' : ' gap'}`}
                        style={{
                          left: cell.left,
                          width: cell.w,
                          transform: on ? shift : undefined,
                        }}
                        onPointerDown={(e) => onCellDown(e, cell)}
                        onDoubleClick={() => {
                          if (!cell.frame) return;
                          setPinned(cell.frame.key);
                          setRange(null);
                          setSel(new Set([cell.frame.key]));
                          anchorKey.current = cell.frame.key;
                        }}
                      >
                        {cell.frame?.url && <img src={cell.frame.url} alt="" draggable={false} />}
                      </div>
                    );
                  })}
                  {/* Marks are instants, not cells — they ride the strip's top edge. */}
                  <span className="tl-marks">
                    {marks.map((m) => (
                      <span className="tl-mark" key={m.key} style={{ left: x(m.pos) }} />
                    ))}
                  </span>
                </div>
              )}

              {lines.length > 0 && (
                <div className="tl-voice">
                  <span className="tl-label">voice</span>
                  {lines.map((item, idx) => {
                    const on = sel.has(item.key);
                    // Width is duration — except a transcriber that overruns the next
                    // line would bury it, and a buried block can't be clicked. The
                    // overrun is trimmed, never the block: a well-formed transcript
                    // is untouched by this.
                    const next = lines[idx + 1];
                    const room = next ? next.pos - item.pos : Infinity;
                    const w = Math.max(Math.min(item.dur, room) * pxPerMs, 2);
                    const roomy = w >= TEXT_MIN;
                    const open = editing?.key === item.key && editing.at === 'clip';
                    const now = playhead >= item.pos && playhead <= item.pos + item.dur;
                    return (
                      <div
                        key={item.key}
                        data-key={item.key}
                        className={`tl-clip${on ? ' on' : ''}${open ? ' edit' : ''}${now ? ' now' : ''}`}
                        style={{
                          left: x(item.pos),
                          // Editing drops the duration width — a 22px block can't be typed in.
                          width: open ? undefined : w,
                          transform: on ? shift : undefined,
                        }}
                        onPointerDown={(e) => onClipDown(e, item, roomy)}
                      >
                        {open ? (
                          <input
                            className="tl-linein"
                            autoFocus
                            defaultValue={item.text}
                            onPointerDown={(e) => e.stopPropagation()}
                            onBlur={(e) => void commitLine(item, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                          />
                        ) : (
                          roomy && <span>{item.text}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {seams.map((s) => (
                <span className="tl-seam" key={s} style={{ left: x(s) }} />
              ))}
              {sweep && (
                <span
                  className="tl-range"
                  style={{
                    left: x(Math.min(sweep.a, sweep.b)),
                    width: Math.abs(sweep.b - sweep.a) * pxPerMs,
                  }}
                />
              )}
              {marquee && (
                <span
                  className="tl-marquee"
                  style={{
                    left: Math.min(marquee.x0, marquee.x1),
                    width: Math.abs(marquee.x1 - marquee.x0),
                    top: Math.min(marquee.y0, marquee.y1),
                    height: Math.abs(marquee.y1 - marquee.y0),
                  }}
                />
              )}
            </div>

            <span className="tl-head" style={{ left: x(playhead) }} />
          </div>
        </div>

        {sel.size > 0 && (
          <div className="tl-bar">
            <span className="tl-count">
              {range
                ? `${mmss(range.a)}–${mmss(range.b)} · ${sel.size} item${sel.size === 1 ? '' : 's'}`
                : `${sel.size} selected`}
            </span>
            <button className="tl-del" onClick={() => void doDelete()}>
              delete
            </button>
            <button onClick={clearSel}>clear</button>
          </div>
        )}

        <div className="tl-zoom">
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
          {zoom > 1 && (
            <button className="tl-fit" onClick={() => zoomTo(1)}>
              fit
            </button>
          )}
        </div>

        {lines.length > 0 && (
          <div className="tl-script">
            <div className="tl-script-head">
              <button className="tl-script-toggle" onClick={() => setScript((v) => !v)}>
                <i aria-hidden="true">{script ? '▾' : '▸'}</i> transcript · {lines.length} line
                {lines.length === 1 ? '' : 's'}
              </button>
              <span className="tl-script-hint">click seeks · double-click fixes a line</span>
              {unread.length > 0 ? (
                <button
                  className="tl-script-ok"
                  title="Confirm the wording is yours — the agent then treats it as exact"
                  onClick={async () => {
                    for (const rec of unread) {
                      await send({ type: 'recording:reviewed', id: rec.id });
                    }
                    say('transcript confirmed');
                  }}
                >
                  reads right
                </button>
              ) : (
                readBack && <span className="tl-script-done">✓ confirmed</span>
              )}
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
