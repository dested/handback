import { COBALT } from '../lib/types';
import type { MicState, PuckTelemetry } from './recorder';

/**
 * The puck: a Document Picture-in-Picture window that is the walkthrough's
 * pointer everywhere Chrome isn't — Excel, a terminal, another browser. Nothing
 * extension-side can paint a pixel outside a tab, but a PiP window is
 * always-on-top and sits *in front of the camera*: `getDisplayMedia` records it
 * for free, so what the user sees is exactly what the take keeps.
 *
 * Chrome's realities shape all of it. The window is an opaque rectangle with a
 * real minimum size, so it is drawn as a cursor, not a reticle — a big cobalt
 * arrow whose tip is the window's top-left inner pixel, with the body hanging
 * below-and-right of the target instead of on top of it. It cannot be moved from
 * script, only dragged. And since the on-page dock can't follow the user out of
 * Chrome, the body carries the vitals instead: clock, mic, the live caption
 * line (proof the recorder still hears you, floating over the spreadsheet, and
 * captured into the recording), mark and stop.
 *
 * The panel opens it and scripts its DOM directly — `requestWindow` hands back a
 * Window — so there is no messaging layer at all. Geometry is polled from here:
 * the tip feeds the recorder's puck pointer slot, the outer bounds feed the
 * dedup mask, and a drag that comes to rest is reported as a park (the
 * out-of-Chrome twin of finishing an ink stroke).
 */

const POLL_MS = 150;
/** Polls the window must hold still after moving before it counts as parked. */
const PARK_POLLS = 3;
/** A park closer than this to the last one is jitter, not a decision. */
const PARK_MIN_PX = 12;
const PUCK_W = 300;
const PUCK_H = 170;

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
  /** Fresh geometry, every poll. */
  onTelemetry(t: PuckTelemetry): void;
  /** A drag came to rest — the human parked the arrow on something. */
  onParked(): void;
  /** The arrow was clicked (or `p`): pin this spot. Returns the pin number for the flash. */
  onPin(): number | null;
  onMark(): void;
  onStop(): void;
  /** The window is gone — user closed it, or the panel did. Always fires exactly once. */
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
  // lib.dom omits these Chrome-only fields; widen the shape, then still verify.
  const o: Screen & { availLeft?: unknown; availTop?: unknown } = s;
  return {
    left: typeof o.availLeft === 'number' ? o.availLeft : 0,
    top: typeof o.availTop === 'number' ? o.availTop : 0,
  };
}

const STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    font: 13px/1.4 system-ui, sans-serif;
    background: #fdfcfa;
    color: #1f1d1a;
    user-select: none;
    cursor: grab;
  }
  #root { position: relative; width: 100%; height: 100%; padding: 10px 12px 10px 58px; display: flex; flex-direction: column; gap: 6px; }
  #arrow {
    position: absolute; left: 0; top: 0; width: 52px; height: 60px;
    border: 0; background: none; cursor: pointer; padding: 0;
  }
  #arrow svg { display: block; }
  #arrow:hover svg path { filter: brightness(1.15); }
  .off #arrow svg path { fill: #b3aea6; }
  #row { display: flex; align-items: center; gap: 7px; margin-top: 2px; }
  #dot { width: 8px; height: 8px; border-radius: 50%; background: ${COBALT}; flex: none; }
  .rec #dot { animation: pulse 1.3s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
  #clock { font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; font-size: 14px; }
  #mic { font-size: 11px; color: #8a857d; }
  #tick {
    flex: 1; font-size: 12px; color: #1f1d1a; overflow: hidden;
    display: flex; flex-direction: column; justify-content: flex-end;
  }
  #tick.idle { color: #8a857d; font-style: italic; }
  #btns { display: flex; gap: 6px; }
  #btns button {
    flex: 1; height: 26px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;
    border: 1px solid #dcd8d1; background: #fff; color: #1f1d1a;
  }
  #btns button:hover { border-color: ${COBALT}; color: ${COBALT}; }
  #btns #stop { background: ${COBALT}; border-color: ${COBALT}; color: #fff; }
  #btns #stop:hover { filter: brightness(1.06); color: #fff; }
  #off {
    position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
    background: rgba(253, 252, 250, 0.88); font-weight: 600; color: #8a857d; text-align: center;
    pointer-events: none;
  }
  .off #off { display: flex; }
  #flash {
    position: absolute; left: 44px; top: 4px; padding: 1px 7px; border-radius: 9px;
    background: ${COBALT}; color: #fff; font-size: 11px; font-weight: 600;
    opacity: 0; transition: opacity 0.15s;
  }
  #flash.on { opacity: 1; }
`;

/** A cursor with its hot pixel at (0,0) — the whole window aims with this. */
const ARROW_SVG = `
  <svg width="52" height="60" viewBox="0 0 52 60" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 2 L2 50 L15 38 L23 57 L32 53 L24 35 L41 33 Z"
      fill="${COBALT}" stroke="#fff" stroke-width="3" stroke-linejoin="round" />
  </svg>`;

function mmssPuck(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** Needs transient activation — call it from the click, nowhere else. */
export async function openPuck(handlers: PuckHandlers): Promise<PuckHandle> {
  const api = window.documentPictureInPicture;
  if (!api) throw new Error('document PiP unavailable');
  const win = await api.requestWindow({ width: PUCK_W, height: PUCK_H });
  const doc = win.document;

  const style = doc.createElement('style');
  style.textContent = STYLE;
  doc.head.appendChild(style);
  doc.body.innerHTML = `
    <div id="root" class="rec">
      <button id="arrow" title="pin this spot (p)">${ARROW_SVG}</button>
      <div id="flash"></div>
      <div id="row"><span id="dot"></span><span id="clock">0:00</span><span id="mic"></span></div>
      <div id="tick" class="idle"></div>
      <div id="btns">
        <button id="mark" title="keep this exact moment (m)">mark</button>
        <button id="stop" title="stop the recording (s)">stop</button>
      </div>
      <div id="off">off the recording —<br/>drag me onto the shared screen</div>
    </div>`;

  const el = (id: string) => doc.getElementById(id);
  const root = el('root');
  const clock = el('clock');
  const mic = el('mic');
  const tick = el('tick');
  const flash = el('flash');

  let closed = false;
  let flashTimer: number | null = null;

  const showFlash = (text: string) => {
    if (!flash) return;
    flash.textContent = text;
    flash.classList.add('on');
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => flash.classList.remove('on'), 900);
  };

  const pin = () => {
    const n = handlers.onPin();
    showFlash(n === null ? 'not on the recording' : `pin ${n}`);
  };
  const mark = () => {
    handlers.onMark();
    showFlash('marked');
  };

  el('arrow')?.addEventListener('click', pin);
  el('mark')?.addEventListener('click', mark);
  el('stop')?.addEventListener('click', () => handlers.onStop());
  win.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'p') pin();
    else if (key === 'm') mark();
    else if (key === 's') handlers.onStop();
    else return;
    event.preventDefault();
  });

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
    // PiP windows are effectively frameless, but measure instead of assuming:
    // whatever chrome exists is split left/right, with the rest on top.
    const borderX = Math.max(0, (win.outerWidth - win.innerWidth) / 2);
    const borderTop = Math.max(0, win.outerHeight - win.innerHeight - borderX);
    const wx = win.screenX - origin.left;
    const wy = win.screenY - origin.top;
    handlers.onTelemetry({
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
      if (jump >= PARK_MIN_PX) handlers.onParked();
      parkX = wx;
      parkY = wy;
    }
    lastX = wx;
    lastY = wy;
  };
  // The opener's timer, not the PiP window's — it must die with the panel either way,
  // and this way a closing puck can't strand a callback in a dead document.
  const timer = window.setInterval(poll, POLL_MS);
  poll();

  const teardown = () => {
    if (closed) return;
    closed = true;
    window.clearInterval(timer);
    handlers.onClosed();
  };
  win.addEventListener('pagehide', teardown);

  return {
    update(u: PuckUpdate) {
      if (closed) return;
      if (clock) clock.textContent = mmssPuck(u.elapsedMs);
      if (mic) {
        mic.textContent =
          u.micState === 'listening' ? '' : u.micState === 'off' ? 'mic off' : 'mic blocked';
      }
      if (tick) {
        tick.textContent = u.interim || (u.micState === 'listening' ? 'listening…' : '');
        tick.classList.toggle('idle', !u.interim);
      }
      root?.classList.toggle('off', !u.onFrame);
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
