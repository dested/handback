import { COBALT } from '../lib/types';
import type { MicState, PuckTelemetry } from '../lib/types';

/**
 * The puck: a Document Picture-in-Picture window that is the walkthrough's
 * pointer everywhere Chrome isn't — Excel, a terminal, another browser. Nothing
 * extension-side can paint a pixel outside a tab, but a PiP window is
 * always-on-top and sits *in front of the camera*: `getDisplayMedia` records it
 * for free, so what the user sees is exactly what the take keeps.
 *
 * Why it exists at all: the moment a walkthrough leaves Chrome, every affordance
 * dies — no ink, no click ripples, no pointer trail, no dock. The puck is all of
 * them in one draggable object. Its tip is the pointer (the keyframes get the
 * cobalt crosshair where it points), parking it marks the moment, clicking it
 * drops numbered pins, and its body is the out-of-Chrome dock: clock, live
 * captions, mark, stop — so a spreadsheet complaint never has to alt-tab home.
 *
 * It opens from HERE, the content script, because Chrome only honours
 * `requestWindow()` in real tabs — side panels, popups and offscreen documents
 * all hang. The dock's button is the user gesture. The cost of living in the
 * page's world is the page's CSP: the PiP document inherits it, so nothing here
 * uses innerHTML (Trusted Types) or injected <style> tags (style-src) — every
 * element is built by hand and every style is a CSSOM write, which no CSP
 * blocks. The price is paid once, in this file.
 *
 * Chrome's other realities shape the body. The window is an opaque rectangle
 * with its own irremovable title bar and a real minimum size, so it is drawn as
 * a cursor, not a reticle — a big cobalt arrow whose tip is the content's
 * top-left pixel, body hanging below-and-right of the target. It cannot be
 * moved from script, only dragged; `app-region: drag` on the body makes the
 * whole card a handle, not just Chrome's bar. It dies with this page — a
 * navigation of the host tab closes it; the dock button brings it back.
 */

const POLL_MS = 150;
/** Polls the window must hold still after moving before it counts as parked. */
const PARK_POLLS = 3;
/** A park closer than this to the last one is jitter, not a decision. */
const PARK_MIN_PX = 12;
const PUCK_W = 320;
const PUCK_H = 118;
/** Idle copy rotates so the thing explains itself while nobody is talking. */
const HINT_MS = 4200;

const INK = '#23262e';
const MUTED = '#6b7078';
const PAPER = '#fdfcfa';
const LINE = '#e6e4dd';
const WASH = '#eef1fc';

const HINTS = [
  'park the tip on it — parking marks the moment',
  'click the arrow to drop a numbered pin',
  'talk — your words land in the walkthrough',
  'this card is in the recording. that’s the point',
];

interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
}

/** Not in lib.dom yet — the one typed boundary for the PiP API. */
interface DocumentPictureInPicture {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function puckSupported(): boolean {
  return typeof window.documentPictureInPicture?.requestWindow === 'function';
}

export interface PuckHandlers {
  /** Fresh geometry, every poll. The reply tells the puck what to show. */
  onBeat(t: PuckTelemetry): void;
  /** A drag came to rest — the human parked the arrow on something. */
  onParked(): void;
  /** The arrow was clicked (or `p`): pin this spot. Resolves the pin number for the flash. */
  onPin(): Promise<number | null>;
  onMark(): void;
  onStop(): void;
  /** The window is gone — user closed it, navigation, or `close()`. Fires exactly once. */
  onClosed(): void;
}

export interface PuckUpdate {
  elapsedMs: number;
  interim: string;
  micState: MicState;
  /** Whether the tip currently maps into the captured frame. */
  onFrame: boolean;
}

export interface PuckHandle {
  update(u: PuckUpdate): void;
  close(): void;
}

/** `screen.availLeft/Top` exist in Chrome but not lib.dom; they anchor a secondary
 *  monitor's global coordinates back to that monitor's own origin. */
function screenOrigin(s: Screen): { left: number; top: number } {
  const o: Screen & { availLeft?: unknown; availTop?: unknown } = s;
  return {
    left: typeof o.availLeft === 'number' ? o.availLeft : 0,
    top: typeof o.availTop === 'number' ? o.availTop : 0,
  };
}

/** CSSOM property writes — the one styling channel no page CSP can refuse. */
function css(el: HTMLElement | SVGElement, styles: Partial<CSSStyleDeclaration>) {
  Object.assign(el.style, styles);
}

/** Whether this element moves the window when dragged. Best-effort — a Chrome
 *  that doesn't honour app-region in PiP just leaves the title bar as the handle. */
function dragRegion(el: HTMLElement | SVGElement, drag: boolean) {
  const value = drag ? 'drag' : 'no-drag';
  el.style.setProperty('app-region', value);
  el.style.setProperty('-webkit-app-region', value);
}

function mmssPuck(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** Needs transient activation — call it from the dock's click, nowhere else. */
export async function openPuck(handlers: PuckHandlers): Promise<PuckHandle> {
  const api = window.documentPictureInPicture;
  if (!api) throw new Error('document PiP unavailable');
  const win = await api.requestWindow({ width: PUCK_W, height: PUCK_H });
  const doc = win.document;

  // ── the body, by hand ───────────────────────────────────────────────────
  css(doc.documentElement, { width: '100%', height: '100%', overflow: 'hidden' });
  css(doc.body, {
    margin: '0',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    font: '12px/1.45 "Segoe UI", system-ui, sans-serif',
    background: PAPER,
    color: INK,
    userSelect: 'none',
    cursor: 'grab',
  });
  dragRegion(doc.body, true);

  const root = doc.createElement('div');
  css(root, {
    position: 'relative',
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'stretch',
  });

  // The rail: a cobalt wash the arrow lives on, fading into the card — reads as
  // "this edge is the business end".
  const rail = doc.createElement('div');
  css(rail, {
    width: '52px',
    flex: 'none',
    background: `linear-gradient(135deg, ${WASH} 0%, ${PAPER} 78%)`,
    borderRight: `1px solid ${LINE}`,
  });

  // The cursor: hot pixel at the content's (0,0). The whole window aims with this.
  const arrow = doc.createElement('button');
  arrow.title = 'drop a numbered pin here (p)';
  css(arrow, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '46px',
    height: '54px',
    border: '0',
    background: 'none',
    padding: '0',
    cursor: 'pointer',
    filter: 'drop-shadow(0 1px 2px rgba(35, 38, 46, 0.35))',
  });
  dragRegion(arrow, false);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '46');
  svg.setAttribute('height', '54');
  svg.setAttribute('viewBox', '0 0 46 54');
  const arrowPath = doc.createElementNS(SVG_NS, 'path');
  arrowPath.setAttribute(
    'd',
    'M2 2 L2 41 L12.5 31.5 L18.5 45 L25 42 L19 28.7 L33 27.5 Z',
  );
  arrowPath.setAttribute('fill', COBALT);
  arrowPath.setAttribute('stroke', '#fff');
  arrowPath.setAttribute('stroke-width', '2.5');
  arrowPath.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(arrowPath);
  arrow.appendChild(svg);

  const flash = doc.createElement('div');
  css(flash, {
    position: 'absolute',
    left: '8px',
    bottom: '8px',
    padding: '2px 8px',
    borderRadius: '999px',
    background: COBALT,
    color: '#fff',
    fontSize: '11px',
    fontWeight: '600',
    whiteSpace: 'nowrap',
    opacity: '0',
    transition: 'opacity 0.15s',
    pointerEvents: 'none',
  });

  const main = doc.createElement('div');
  css(main, {
    flex: '1',
    minWidth: '0',
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    padding: '9px 10px 9px 12px',
  });

  // One status row: pulse · clock · pins · mic — then the controls, right-aligned.
  const row = doc.createElement('div');
  css(row, { display: 'flex', alignItems: 'center', gap: '8px', minHeight: '24px' });
  const dot = doc.createElement('span');
  css(dot, {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: COBALT,
    flex: 'none',
    transition: 'opacity 0.5s',
  });
  const clock = doc.createElement('span');
  clock.textContent = '0:00';
  css(clock, {
    fontFamily: '"Cascadia Mono", Consolas, ui-monospace, monospace',
    fontVariantNumeric: 'tabular-nums',
    fontSize: '13px',
    letterSpacing: '0.01em',
  });
  const pinsChip = doc.createElement('span');
  css(pinsChip, {
    display: 'none',
    padding: '1px 7px',
    borderRadius: '999px',
    border: `1px solid ${COBALT}`,
    color: COBALT,
    background: WASH,
    fontSize: '10px',
    fontWeight: '600',
  });
  const mic = doc.createElement('span');
  css(mic, { fontSize: '10px', color: MUTED });
  const spacer = doc.createElement('span');
  css(spacer, { flex: '1' });

  const button = (label: string, title: string) => {
    const b = doc.createElement('button');
    b.textContent = label;
    b.title = title;
    css(b, {
      height: '24px',
      padding: '0 12px',
      borderRadius: '999px',
      fontSize: '11px',
      fontWeight: '600',
      cursor: 'pointer',
      font: 'inherit',
      border: `1px solid ${LINE}`,
      background: '#fff',
      color: MUTED,
      flex: 'none',
    });
    dragRegion(b, false);
    return b;
  };
  const markBtn = button('mark', 'keep this exact moment (m)');
  const stopBtn = button('stop', 'stop the recording (s)');
  css(stopBtn, { background: INK, borderColor: INK, color: '#fff' });
  row.append(dot, clock, pinsChip, mic, spacer, markBtn, stopBtn);

  // The caption well: your words while you talk, and while you don't, the reason
  // this window exists — rotating one-line hints in the margin voice.
  const tick = doc.createElement('div');
  css(tick, {
    flex: '1',
    minHeight: '0',
    fontSize: '12px',
    color: MUTED,
    fontStyle: 'italic',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    borderTop: `1px solid ${LINE}`,
    paddingTop: '5px',
  });
  tick.textContent = HINTS[0] ?? '';

  main.append(row, tick);

  // Shown over everything when the tip stops mapping into the captured frame —
  // dragged to the wrong monitor, or the capture is a lone window.
  const off = doc.createElement('div');
  off.textContent = 'off the recording — drag me onto the shared screen';
  css(off, {
    position: 'absolute',
    inset: '0',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '0 16px',
    background: 'rgba(253, 252, 250, 0.92)',
    fontWeight: '600',
    fontSize: '12px',
    color: MUTED,
    pointerEvents: 'none',
  });

  root.append(rail, main, arrow, flash, off);
  doc.body.appendChild(root);

  // ── behaviour ───────────────────────────────────────────────────────────
  let closed = false;
  let flashTimer: number | null = null;
  let blink = false;
  let blinkTimer: number | null = null;
  let hintAt = 0;
  let hintTimer: number | null = null;
  let onFrameNow = true;
  let pinCount = 0;

  const showFlash = (text: string) => {
    flash.textContent = text;
    flash.style.opacity = '1';
    if (flashTimer !== null) win.clearTimeout(flashTimer);
    flashTimer = win.setTimeout(() => (flash.style.opacity = '0'), 950);
  };

  const pin = () => {
    void handlers.onPin().then((n) => {
      if (closed) return;
      if (n === null) {
        showFlash('not on the recording');
        return;
      }
      pinCount = n;
      pinsChip.textContent = `${n} pin${n === 1 ? '' : 's'}`;
      pinsChip.style.display = '';
      showFlash(`pin ${n} dropped`);
    });
  };
  const mark = () => {
    handlers.onMark();
    showFlash('marked');
  };

  arrow.addEventListener('click', pin);
  markBtn.addEventListener('click', mark);
  stopBtn.addEventListener('click', () => handlers.onStop());
  win.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'p') pin();
    else if (key === 'm') mark();
    else if (key === 's') handlers.onStop();
    else return;
    event.preventDefault();
  });

  // The record dot's pulse, without a stylesheet to declare keyframes in.
  blinkTimer = win.setInterval(() => {
    blink = !blink;
    dot.style.opacity = blink ? '0.25' : '1';
  }, 650);
  // The idle line teaches; the rotation only advances while nobody is talking
  // (update() overwrites it with interim words the moment they exist).
  hintTimer = win.setInterval(() => {
    if (closed || tick.style.fontStyle !== 'italic') return;
    hintAt = (hintAt + 1) % HINTS.length;
    tick.textContent = HINTS[hintAt] ?? '';
  }, HINT_MS);

  // ── geometry: the tip is the inner origin, in the puck's own screen space ──
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  let parkX = Number.NaN;
  let parkY = Number.NaN;
  let stillPolls = 0;
  let movedSincePark = false;

  const poll = () => {
    if (closed) return;
    const origin = screenOrigin(win.screen);
    // Chrome's PiP title bar sits above the content; the tip is the CONTENT's
    // (0,0), so measure the chrome instead of assuming it away — side borders
    // split left/right, everything else is on top.
    const borderX = Math.max(0, (win.outerWidth - win.innerWidth) / 2);
    const borderTop = Math.max(0, win.outerHeight - win.innerHeight - borderX);
    const wx = win.screenX - origin.left;
    const wy = win.screenY - origin.top;
    handlers.onBeat({
      sx: wx + borderX,
      sy: wy + borderTop,
      sw: win.screen.width,
      sh: win.screen.height,
      wx,
      wy,
      ww: win.outerWidth,
      wh: win.outerHeight,
    });

    if (wx !== lastX || wy !== lastY) {
      if (!Number.isNaN(lastX)) movedSincePark = true;
      stillPolls = 0;
    } else if (movedSincePark && ++stillPolls >= PARK_POLLS) {
      movedSincePark = false;
      stillPolls = 0;
      const jump = Number.isNaN(parkX) ? Infinity : Math.hypot(wx - parkX, wy - parkY);
      if (jump >= PARK_MIN_PX) {
        handlers.onParked();
        if (onFrameNow) showFlash('parked — moment kept');
      }
      parkX = wx;
      parkY = wy;
    }
    lastX = wx;
    lastY = wy;
  };
  // This page's timer, not the PiP window's: it must die with the tab either way,
  // and this way a closing puck can't strand a callback in a dead document.
  const timer = window.setInterval(poll, POLL_MS);
  poll();

  const teardown = () => {
    if (closed) return;
    closed = true;
    window.clearInterval(timer);
    if (blinkTimer !== null) win.clearInterval(blinkTimer);
    if (hintTimer !== null) win.clearInterval(hintTimer);
    handlers.onClosed();
  };
  win.addEventListener('pagehide', teardown);

  return {
    update(u: PuckUpdate) {
      if (closed) return;
      onFrameNow = u.onFrame;
      clock.textContent = mmssPuck(u.elapsedMs);
      mic.textContent =
        u.micState === 'listening' ? '' : u.micState === 'off' ? 'mic off' : 'mic blocked';
      if (u.interim) {
        tick.textContent = u.interim;
        tick.style.color = INK;
        tick.style.fontStyle = 'normal';
      } else if (tick.style.fontStyle !== 'italic') {
        // The sentence just ended — back to the margin voice on the next hint.
        tick.style.color = MUTED;
        tick.style.fontStyle = 'italic';
        tick.textContent = HINTS[hintAt] ?? '';
      }
      off.style.display = u.onFrame ? 'none' : 'flex';
      arrowPath.setAttribute('fill', u.onFrame ? COBALT : '#b3aea6');
      if (pinCount === 0) pinsChip.style.display = 'none';
    },
    close() {
      teardown();
      try {
        win.close();
      } catch {
        /* already gone */
      }
    },
  };
}
