/**
 * The content script: what a walkthrough looks like from inside the page it's
 * walking through. Console and error telemetry forwarded live, the pointer
 * trail, click ripples, the ink you can draw on the page, and the dock that
 * drives all of it. Nothing here exists outside a recording.
 */
import type { Broadcast, ContentCommand, Request } from '../lib/messages';
import type { PageEvent } from '../lib/types';
import { COBALT } from '../lib/types';
import { createOverlay, type Overlay } from './ui';

/** One freehand line, in CSS px so it survives a resize. */
interface Stroke {
  points: { x: number; y: number }[];
}

declare global {
  interface Window {
    __inloopContent?: boolean;
  }
}

if (!window.__inloopContent) {
  window.__inloopContent = true;
  boot();
}

function boot() {
  const PAGE_EVENT = 'inloop:page-event';
  const PAGE_NAV = 'inloop:page-nav';
  const POINTER_MS = 120; // pointer reports while recording — the frame sampler runs at 500ms

  let overlay: Overlay | null = null;
  let recordingActive = false;

  // The ink layer — drawing on the page while a walkthrough records. `liveOn`
  // means the ink owns the pointer; the strokes stay on screen either way.
  let liveOn = false;
  let liveStrokes: Stroke[] = [];
  let liveDrawing = false;
  let liveMoved = false;

  // Ink expires on its own — holding still for a moment and then watching it go
  // is cheaper than reaching for `clear` after every point. One opacity for the
  // whole canvas, so drawing again brings the older strokes back with it.
  const INK_HOLD_MS = 3000;
  const INK_FADE_MS = 4000;
  let lastInkAt = 0;
  let inkRaf: number | null = null;

  // The on-page recording dock. `dockOn` is "this tab is the one being recorded
  // and it still is".
  let dockOn = false;
  let dockStart = 0;
  let dockTimer: number | null = null;
  let dockBox: DOMRect | null = null;

  /** Nobody may be listening — the panel closes, the worker sleeps. Never throw. */
  function tell(message: Request | Broadcast) {
    try {
      void chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      /* extension context gone; the page carries on */
    }
  }

  // ── page telemetry ──────────────────────────────────────────────────────
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  } catch {
    /* strict CSP — we simply lose console capture on this page */
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as (PageEvent & { source?: string }) | null;
    // A route change isn't an event, just a keyframe the dedup would otherwise
    // miss on a page that repaints into the same cream.
    if (data?.source === PAGE_NAV) {
      if (recordingActive) {
        void chrome.runtime
          .sendMessage({ type: 'recording:force', why: 'nav', origin: location.origin })
          .catch(() => {});
      }
      return;
    }
    if (!data || data.source !== PAGE_EVENT) return;
    // Nothing is buffered: an event outside a recording has no timeline to land
    // on, so it's dropped where it happens.
    if (!recordingActive) return;
    void chrome.runtime
      .sendMessage({
        type: 'recording:event',
        event: { level: data.level, message: data.message, detail: data.detail, ts: data.ts },
        origin: location.origin,
      })
      .catch(() => {});
  });

  // ── pointer trail (recording only) ──────────────────────────────────────
  /**
   * "These over here" is unresolvable in a screen recording without a pointer, so
   * while a walkthrough runs every tab reports where the mouse is and what it's
   * over. The selector walk is the expensive part, so it only reruns when the
   * element under the cursor actually changes.
   */
  let pointerAt = 0;
  let pointerEl: Element | null = null;
  let pointerSelector: string | undefined;
  let pointerText: string | undefined;

  window.addEventListener(
    'mousemove',
    (event: MouseEvent) => {
      if (!recordingActive) return;
      const now = Date.now();
      if (now - pointerAt < POINTER_MS) return;
      pointerAt = now;

      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (el !== pointerEl) {
        pointerEl = el;
        pointerSelector = el ? selectorFor(el) : undefined;
        const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
        pointerText = text || undefined;
      }

      void chrome.runtime
        .sendMessage({
          type: 'recording:pointer',
          origin: location.origin,
          sample: {
            ts: now,
            x: event.clientX,
            y: event.clientY,
            sx: event.screenX,
            sy: event.screenY,
            vw: window.innerWidth,
            vh: window.innerHeight,
            sw: window.screen.width,
            sh: window.screen.height,
            selector: pointerSelector,
            text: pointerText,
          },
        })
        .catch(() => {});
    },
    { capture: true, passive: true },
  );

  // ── naming what the pointer is over ─────────────────────────────────────
  const isUnique = (selector: string) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };

  function selectorFor(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    let depth = 0;

    while (node && node.nodeType === 1 && depth < 5) {
      const current: Element = node;
      if (current.id) {
        const byId = `#${CSS.escape(current.id)}`;
        if (isUnique(byId)) {
          parts.unshift(byId);
          break;
        }
      }
      const testid =
        current.getAttribute('data-testid') ??
        current.getAttribute('data-test-id') ??
        current.getAttribute('data-cy');
      if (testid) {
        parts.unshift(`[data-testid="${testid}"]`);
        break;
      }

      let part = current.tagName.toLowerCase();
      const classes = Array.from(current.classList)
        .filter(
          (c) => c.length < 28 && !/^(ng-|css-|jsx-|sc-|emotion-)/.test(c) && !/\d{4,}/.test(c),
        )
        .slice(0, 2);
      if (classes.length) part += `.${classes.map((c) => CSS.escape(c)).join('.')}`;

      const parent = current.parentElement;
      if (parent) {
        const twins = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
        if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      if (parts.length && isUnique(parts.join(' > '))) break;
      node = current.parentElement;
      depth++;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  // ── overlay lifecycle ───────────────────────────────────────────────────
  function ui(): Overlay {
    if (overlay) return overlay;
    overlay = createOverlay();
    document.documentElement.appendChild(overlay.host);
    wireLive(overlay);
    wireDock(overlay);
    return overlay;
  }

  function inOverlay(event: Event): boolean {
    return Boolean(overlay && event.composedPath().includes(overlay.host));
  }

  // ── live ink layer ──────────────────────────────────────────────────────
  /**
   * "This bit here" is as unresolvable as "these over here" was, so a walkthrough
   * can be drawn on. The strokes never leave the tab — they're on screen, so the
   * recording picks them up, and that's the whole mechanism. Points are stored in
   * CSS px and repainted on resize.
   */
  function sizeLive(o: Overlay) {
    const dpr = window.devicePixelRatio || 1;
    o.live.width = Math.round(window.innerWidth * dpr);
    o.live.height = Math.round(window.innerHeight * dpr);
    const ctx = o.live.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintLive(o);
  }

  function inkAlpha(): number {
    // Mid-stroke never fades under your own hand — but only a stroke that MOVED
    // counts, or a mere click flashes half-faded ink back to full for one frame.
    if (liveDrawing && liveMoved) return 1;
    const age = Date.now() - lastInkAt;
    if (age <= INK_HOLD_MS) return 1;
    return Math.max(0, 1 - (age - INK_HOLD_MS) / INK_FADE_MS);
  }

  function paintLive(o: Overlay) {
    const ctx = o.live.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, o.live.width, o.live.height);
    ctx.globalAlpha = inkAlpha();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COBALT;
    ctx.lineWidth = 3;
    // Cobalt on a dark app screen is unreadable; a paper-white halo is what keeps
    // the ink legible over whatever the page happens to be.
    ctx.shadowColor = 'rgba(255,255,255,.85)';
    ctx.shadowBlur = 3;
    for (const stroke of liveStrokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      stroke.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.globalAlpha = 1; // the same ctx paints the next frame
  }

  /** Runs only while there are strokes left to fade; drops them at zero. */
  function inkFrame() {
    inkRaf = null;
    if (!overlay || !liveStrokes.length) return;
    // Nothing changes during the hold — don't repaint the whole viewport while
    // the machine is busy encoding a screen recording. pointermove paints live.
    if (Date.now() - lastInkAt <= INK_HOLD_MS) {
      inkRaf = requestAnimationFrame(inkFrame);
      return;
    }
    if (inkAlpha() <= 0) {
      liveStrokes = [];
      paintLive(overlay);
      return;
    }
    paintLive(overlay);
    inkRaf = requestAnimationFrame(inkFrame);
  }

  /** Stroke activity: everything on screen goes back to full opacity. */
  function touchInk() {
    lastInkAt = Date.now();
    if (inkRaf === null) inkRaf = requestAnimationFrame(inkFrame);
  }

  function stopInk() {
    if (inkRaf !== null) cancelAnimationFrame(inkRaf);
    inkRaf = null;
  }

  function wireLive(o: Overlay) {
    o.live.addEventListener('pointerdown', (event) => {
      if (!liveOn) return;
      event.preventDefault();
      o.live.setPointerCapture(event.pointerId);
      liveDrawing = true;
      liveMoved = false;
      liveStrokes.push({ points: [{ x: event.clientX, y: event.clientY }] });
    });

    o.live.addEventListener('pointermove', (event) => {
      if (!liveOn || !liveDrawing) return;
      liveMoved = true;
      liveStrokes[liveStrokes.length - 1]?.points.push({ x: event.clientX, y: event.clientY });
      touchInk();
      paintLive(o);
    });

    // pointercancel ends a stroke the same way up does — a cancelled real stroke
    // is still on screen, so it still needs its keyframe and its fade clock.
    const endStroke = () => {
      if (!liveDrawing) return;
      liveDrawing = false;
      // A click that never moved leaves nothing behind, so it isn't a stroke.
      if (!liveMoved) {
        liveStrokes.pop();
        return;
      }
      touchInk();
      // Dedup would drop the drawn state as "the same screen"; force the keyframe.
      tell({ type: 'recording:mark' });
    };
    o.live.addEventListener('pointerup', endStroke);
    o.live.addEventListener('pointercancel', endStroke);
  }

  function toggleLive() {
    // Getting out is always allowed; getting in needs the dock, because the ink
    // and the dock are one unit.
    if (liveOn) exitLive();
    else if (dockOn) enterLive();
  }

  /** Hand the pointer to the ink. */
  function enterLive() {
    const o = ui();
    liveOn = true;
    liveDrawing = false;
    o.live.classList.add('on', 'capture');
    sizeLive(o);
    paintDock();

    // The toggle may have been hit with focus in the side panel, and esc has to
    // reach the page.
    try {
      window.focus();
    } catch {
      /* not permitted in some embeds */
    }
  }

  /** Hand the pointer back to the page. What's drawn stays drawn. */
  function exitLive() {
    if (!liveOn) return;
    liveOn = false;
    liveDrawing = false;
    overlay?.live.classList.remove('capture');
    paintDock();
  }

  function clearLive() {
    liveStrokes = [];
    liveDrawing = false; // clearing mid-stroke abandons it rather than marking it
    stopInk();
    if (overlay) paintLive(overlay);
  }

  // ── the recording dock (recorded tab only) ──────────────────────────────
  /**
   * Everything you can do to a walkthrough while it runs, on the page you're
   * walking through: watch the clock, draw or click, wipe the ink, mark this
   * moment, stop. It arrives with the recording and leaves with it. The clock is
   * local — it starts when the dock does, so a tab that loaded mid-walkthrough
   * reads low, which nobody can see.
   */
  const DOCK_NEAR = 120;

  function openDock(drawStart: boolean) {
    const o = ui();
    dockOn = true;
    dockStart = Date.now();
    tickClock();
    dockTimer = window.setInterval(tickClock, 1000);
    window.addEventListener('mousemove', onDockMove, { capture: true, passive: true });
    window.addEventListener('keydown', onDockKey, true);
    window.addEventListener('resize', onDockResize);
    paintDock();
    sizeLive(o);
    if (drawStart) enterLive();
  }

  function closeDock() {
    dockOn = false;
    exitLive();
    clearLive();
    if (dockTimer) window.clearInterval(dockTimer);
    dockTimer = null;
    dockBox = null;
    window.removeEventListener('mousemove', onDockMove, true);
    window.removeEventListener('keydown', onDockKey, true);
    window.removeEventListener('resize', onDockResize);
    paintDock();
    overlay?.dock.classList.remove('near');
  }

  function paintDock() {
    if (!overlay) return;
    overlay.dock.classList.toggle('on', dockOn);
    overlay.live.classList.toggle('on', dockOn);
    // The whole viewport says draw mode — a frame in the recording is the point.
    overlay.layer.classList.toggle('draw', dockOn && liveOn);
    // Only the word swaps — the `d` keycap beside it is part of the button.
    overlay.dockDrawLabel.textContent = liveOn ? 'click' : 'draw';
    overlay.dockDraw.classList.toggle('arm', liveOn);
    dockBox = null; // the label swap changes the pill's width
  }

  function tickClock() {
    if (!overlay) return;
    const secs = Math.max(0, Math.round((Date.now() - dockStart) / 1000));
    overlay.clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  }

  /** Fade out of the way when the cursor comes near, back on hover. */
  function onDockMove(event: MouseEvent) {
    if (!overlay || !dockOn) return;
    // While drawing, the dock is the way out — it never fades.
    if (liveOn) {
      overlay.dock.classList.remove('near');
      return;
    }
    const box = (dockBox ??= overlay.dock.getBoundingClientRect());
    const dx = Math.max(box.left - event.clientX, 0, event.clientX - box.right);
    const dy = Math.max(box.top - event.clientY, 0, event.clientY - box.bottom);
    overlay.dock.classList.toggle('near', (dx > 0 || dy > 0) && Math.hypot(dx, dy) < DOCK_NEAR);
  }

  function onDockResize() {
    dockBox = null;
    if (dockOn && overlay) sizeLive(overlay);
  }

  function mark() {
    tell({ type: 'recording:mark' });
    // A mark leaves nothing on screen, so the button says it landed.
    const button = overlay?.dockMark;
    if (!button) return;
    button.classList.add('arm');
    window.setTimeout(() => button.classList.remove('arm'), 260);
  }

  /**
   * The keys the dock's own labels advertise. Manifest commands can't do this —
   * chrome refuses to bind bare letters — so the page holds them, and only while
   * the pill is up.
   */
  const DOCK_KEYS: Record<string, () => void> = {
    d: toggleLive,
    c: clearLive,
    m: mark,
    s: () => tell({ type: 'recording:stop' }),
  };

  // Keycap first so remapped layouts (dvorak) match what's printed on the key;
  // physical position as the fallback so cyrillic/greek layouts still work.
  const DOCK_CODE_KEYS: Record<string, string> = { KeyD: 'd', KeyC: 'c', KeyM: 'm', KeyS: 's' };

  function editableTarget(event: KeyboardEvent): boolean {
    const node = (event.composedPath()[0] ?? event.target) as HTMLElement | null;
    if (!node) return false;
    const tag = node.tagName;
    return (
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true
    );
  }

  function onDockKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (!liveOn) return;
      // Leaving the ink is all this does — the host page never sees it.
      event.preventDefault();
      event.stopPropagation();
      exitLive();
      return;
    }
    if (!dockOn) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.repeat) return; // a held key must not machine-gun stop or draw
    if (editableTarget(event)) return; // typing on the page is not a shortcut
    const act = DOCK_KEYS[event.key.toLowerCase()] ?? DOCK_KEYS[DOCK_CODE_KEYS[event.code] ?? ''];
    if (!act) return;
    event.preventDefault();
    event.stopPropagation();
    act();
  }

  function wireDock(o: Overlay) {
    // Don't take focus off whatever the user was doing on the page.
    o.dock.addEventListener('mousedown', (event) => event.preventDefault());
    o.dock.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement | null)?.closest('button') as HTMLElement | null;
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const act = button.dataset.act;
      if (act === 'draw') toggleLive();
      else if (act === 'clear') clearLive();
      else if (act === 'stop') tell({ type: 'recording:stop' });
      else if (act === 'mark') mark();
    });
  }

  // ── click ripples (recording only) ──────────────────────────────────────
  /**
   * A click is invisible in a screen recording — the cursor doesn't even render
   * in some capture paths. A ring at the click point is the whole feature: no
   * message, gone in 350ms.
   */
  function ripple(x: number, y: number) {
    const o = ui();
    const ring = document.createElement('div');
    ring.className = 'ripple';
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    o.layer.append(ring);
    window.setTimeout(() => ring.remove(), 420);
  }

  function onRipplePointer(event: PointerEvent) {
    if (!recordingActive || liveOn || inOverlay(event)) return;
    ripple(event.clientX, event.clientY);
    // The same condition that earns a ring earns a keyframe: whatever the click
    // did to the screen, dedup may score it below the bar.
    tell({ type: 'recording:force', why: 'click', origin: location.origin });
  }

  function addRipples() {
    removeRipples();
    window.addEventListener('pointerdown', onRipplePointer as EventListener, {
      capture: true,
      passive: true,
    });
  }

  function removeRipples() {
    window.removeEventListener('pointerdown', onRipplePointer as EventListener, true);
  }

  // ── background wiring ───────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message: ContentCommand, _sender, respond) => {
    if (message.type === 'ping') {
      respond({ ok: true });
      return;
    }
    if (message.type === 'recording') {
      recordingActive = message.active;
      if (message.active) {
        addRipples();
        // Every tab gets the command; only the recorded one gets the dock.
        // An empty origin means "wherever you are" — and a tab that loaded
        // mid-walkthrough is told again, so this is also the late-arrival path.
        const origin = message.origin ?? '';
        if (!dockOn && (!origin || origin === location.origin)) {
          openDock(message.drawStart === true);
          // The dock was off, so this tab just loaded (or reloaded) inside a live
          // walkthrough — a full navigation the SPA tap never sees.
          tell({ type: 'recording:force', why: 'nav', origin: location.origin });
        }
      } else {
        removeRipples();
        closeDock();
      }
      respond({ ok: true });
      return;
    }
    if (message.type === 'draw:toggle') {
      toggleLive();
      respond({ ok: true });
    }
  });
}
