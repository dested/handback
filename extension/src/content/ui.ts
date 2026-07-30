/**
 * The in-page overlay for a walkthrough in progress: the recording dock, the ink
 * canvas it draws on, and the click ripples. Built into a shadow root so no page
 * stylesheet can reach it and none of our styles leak out. One host element, one
 * style sheet, hand-built DOM — no framework in the content script, because it
 * has to boot on every page the user visits and must never be the slow thing.
 *
 * Light editorial, same language as the panel (repo ui.md): white glass, a
 * hairline border, near-black ink, one cobalt accent, mono for the clock and the
 * keycaps. Never dark, never orange.
 */

const CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  color-scheme: light;
}
* { box-sizing: border-box; margin: 0; padding: 0; }

.layer {
  position: fixed;
  inset: 0;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  --cobalt: #2f56d8;
  --cobalt-wash: #eef1fc;
  --glass: rgba(255, 255, 255, 0.9);
  --line: #e6e4dd;
  --ink: #23262e;
  --muted: #6b7078;
  --mono: 'Cascadia Mono', 'Consolas', ui-monospace, monospace;
}

/* Depth comes from the hairline and the paper, not a shadow pile — but the pill
   floats over someone else's app, so it gets the smallest lift that reads. */
.glass {
  background: var(--glass);
  border: 1px solid var(--line);
  box-shadow: 0 2px 10px rgba(35, 38, 46, 0.10);
  backdrop-filter: blur(20px) saturate(130%);
  -webkit-backdrop-filter: blur(20px) saturate(130%);
  color: var(--ink);
}

/* ── live ink + click ripples ──────────────────────────── */
/* .on is "the strokes are on screen"; .capture is "the pointer is mine" — the
   dock's draw toggle flips the second one, so turning drawing off hands the
   page back its clicks without erasing what you already drew. */
canvas.live { position: absolute; inset: 0; width: 100%; height: 100%; display: none; }
canvas.live.on { display: block; }
canvas.live.on.capture { pointer-events: auto; touch-action: none; cursor: crosshair; }

/* ── recording dock ────────────────────────────────────── */
/* Everything you can do to a walkthrough in progress, on the page you're
   walking through. Each button carries its key, so nothing is hidden. */
.dock {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%) translateY(8px);
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 5px 5px 5px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity .16s ease, transform .16s cubic-bezier(.2,.8,.3,1);
}
.dock.on { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }
/* Gets out of the way of whatever it's sitting on, without ever being gone. */
.dock.on.near { opacity: .38; }
.dock.on:hover { opacity: 1; }

.dock-live { display: flex; align-items: center; gap: 8px; }
.dock .dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--cobalt);
  box-shadow: 0 0 0 0 rgba(47,86,216,.5);
  animation: pulse 1.9s ease-out infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(47,86,216,.45); }
  70% { box-shadow: 0 0 0 8px rgba(47,86,216,0); }
  100% { box-shadow: 0 0 0 0 rgba(47,86,216,0); }
}
.dock .clock {
  font-family: var(--mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: .01em;
  color: var(--ink);
}
.dock .sep { width: 1px; height: 18px; background: var(--line); margin: 0 5px; }

.dock button {
  font: inherit;
  font-size: 12.5px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 10px;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  transition: background .12s ease, color .12s ease, border-color .12s ease;
}
.dock button:hover { background: var(--cobalt-wash); color: var(--ink); }

/* The key each label advertises, set as a keycap so it reads as a key and not
   as part of the word. */
.dock .cap {
  font-family: var(--mono);
  font-style: normal;
  font-size: 10px;
  line-height: 1;
  padding: 2px 4px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--muted);
  background: rgba(35,38,46,.03);
}

/* Armed: the ink owns the pointer. The label says how to get back. */
.dock button.arm {
  background: var(--cobalt-wash);
  border-color: rgba(47,86,216,.28);
  color: var(--cobalt);
}
.dock button.arm .cap { border-color: rgba(47,86,216,.28); color: var(--cobalt); background: transparent; }
/* The one label that swaps — hold the width so the row never shuffles. */
.dock button.draw { min-width: 78px; }
/* Stop is the emphasized one, in ink rather than the accent — cobalt is already
   spoken for by the record dot and the armed key. */
.dock button.stop { background: var(--ink); color: #fff; font-weight: 600; }
.dock button.stop .cap { border-color: rgba(255,255,255,.28); color: rgba(255,255,255,.72); background: transparent; }
.dock button.stop:hover { background: #14161b; color: #fff; }

/* A click leaves no trace in a screen recording. This is the trace. */
.ripple {
  position: fixed;
  width: 64px;
  height: 64px;
  margin: -32px 0 0 -32px;
  border: 2px solid var(--cobalt);
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
  animation: ripple .35s cubic-bezier(.2,.8,.3,1) forwards;
}
@keyframes ripple {
  0% { transform: scale(.44); opacity: .9; }
  100% { transform: scale(1); opacity: 0; }
}
`;

export interface Overlay {
  host: HTMLElement;
  layer: HTMLElement;
  dock: HTMLElement;
  /** The draw button — takes `.arm` when the ink owns the pointer. */
  dockDraw: HTMLElement;
  /** Just the word inside it: `draw` ⇄ `click`. The keycap must survive the swap. */
  dockDrawLabel: HTMLElement;
  dockMark: HTMLElement;
  clock: HTMLElement;
  live: HTMLCanvasElement;
}

const html = (markup: string): HTMLElement => {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild as HTMLElement;
};

export function createOverlay(): Overlay {
  const host = document.createElement('div');
  host.id = 'inloop-root';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.append(style);

  const layer = html(`
    <div class="layer">
      <canvas class="live"></canvas>
      <div class="dock glass">
        <span class="dock-live"><span class="dot"></span><span class="clock">0:00</span></span>
        <span class="sep"></span>
        <button class="draw" data-act="draw"><span class="lbl">draw</span><i class="cap">d</i></button>
        <button data-act="clear"><span class="lbl">clear</span><i class="cap">c</i></button>
        <button class="mark" data-act="mark"><span class="lbl">mark</span><i class="cap">m</i></button>
        <button class="stop" data-act="stop"><span class="lbl">stop</span><i class="cap">s</i></button>
      </div>
    </div>
  `);
  shadow.append(layer);

  const q = <T extends Element>(sel: string) => layer.querySelector(sel) as T;

  return {
    host,
    layer,
    dock: q('.dock'),
    dockDraw: q('.dock button.draw'),
    dockDrawLabel: q('.dock button.draw .lbl'),
    dockMark: q('.dock button.mark'),
    clock: q('.clock'),
    live: q<HTMLCanvasElement>('canvas.live'),
  };
}
