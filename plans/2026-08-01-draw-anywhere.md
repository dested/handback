# Drawing outside the Chrome window — the puck

- **Date:** 2026-08-01
- **Status:** done — built same day (extension 1.4.0): `sidepanel/puck.ts`, recorder puck
  slot + pins + dedup masking, panel button. Sal confirmed `documentPictureInPicture` is
  exposed in the side panel, captions always-on, `p` pins. Not yet driven end-to-end in a
  live take.
- **Type:** design
- **What:** how the recorder points at things outside Chrome — Excel, a terminal, another
  browser — asked for in gripe `3f491ef7` at 2:21–2:39 ("actually really, really important")
- **Supersedes:** the three-path analysis this file used to hold. Path 1 (composite-only,
  drawing blind) and path 2 (native helper) are both dead — see "Roads not taken" at the end.

## The ask, verbatim

> We talked about at one point being able to draw all over the screen, not just on the Chrome
> window. Like you had some idea on opening up a transparent window or something like that. I'd
> like to revisit that and see if we can get that working. It's actually really, really important
> to this.

## The reframe

Every previous answer tried to *paint* pixels outside Chrome, which MV3 flatly cannot do. The
puck stops trying. `getDisplayMedia` is a camera pointed at the screen — so instead of painting
on the screen, we put a **physical object** on it and let the camera photograph it. A Document
Picture-in-Picture window is always-on-top, floats over every app, is dragged with the mouse,
and — the whole trick — **is captured by the recording for free**. No compositing, no coordinate
math for the live view, no drawing blind, no native helper. The user sees exactly what the
recording sees, because they are the same pixels.

The target user is someone narrating over **Excel** or another native app. They don't need
freehand calligraphy out there; they need "THIS cell," "these three numbers," and proof the
recorder is still listening while Chrome is nowhere on screen. The puck does all three.

## What the puck is

A small (~300×170) Document PiP window opened from the side panel while a take is running,
whose document we render ourselves. Layout is dictated by two hard Chrome realities — the
window is an **opaque rectangle** (no transparency, no frameless) and it has a **minimum
size** far bigger than a dot — so:

- **It is a cursor, not a reticle.** A large cobalt arrow is drawn with its **tip exactly at
  the window's top-left inner pixel**. The body of the window hangs below-and-right of
  whatever the tip touches, so the puck never occludes the thing it's indicating. You drag
  the body; you aim the tip. Think: a giant cobalt mouse cursor you can park.
- **The body is the out-of-Chrome dock.** The on-page dock can't follow you into Excel, so
  its vitals move into the puck: the elapsed clock, the mic state, and the **live interim
  caption line** — proof, floating right there over the spreadsheet, that the recorder heard
  "this number here is wrong." Plus two buttons: **mark** and **stop**. All of it is captured
  into the recording, which means the raw video shows live captions of the narration inches
  from the thing being pointed at. That's the demo moment.
- **It doubles as the recording indicator.** While the puck is up, there is no way to forget
  a take is running — the classic "narrated four minutes into a dead mic / left the recorder
  running through lunch" failure dies here.

Cobalt on paper-white, per ui.md. Nothing orange, nothing dark.

## Why it slots into the pipeline almost for free

This is the part that makes it a feature and not a project. The side panel owns the
`Recorder`, and `requestWindow()` hands the opener a **direct `Window` handle** — the panel
renders the puck's DOM itself and reads its geometry itself. **No new message types, no new
worker state, no content-script involvement.**

1. **Telemetry rides the existing pointer pipe.** The panel polls the puck's
   `screenX/screenY` (~150 ms) and feeds the tip position to the recorder as a
   `PointerSample` (`sx/sy/sw/sh` from the puck's own `window.screen`). `mapPointer()`
   already knows how to map screen coordinates into a screen-shaped frame and already
   refuses to lie when it can't (window capture, wrong monitor). So every keyframe taken
   while the puck is parked on the captured screen gets the **cobalt crosshair drawn at the
   tip** — the same annotation, the same code path, as in-tab pointing.
2. **Two pointer slots, page first.** The recorder keeps `pagePointer` and `puckPointer`
   separately. `pointerNow()` prefers a *fresh* page sample (you're mousing in Chrome — your
   mouse is your attention) and falls back to the puck, which **never goes stale while
   visible**: a parked puck is not an idle mouse, it's a deliberate act of pointing, and a
   30-second ramble over one cell keeps its crosshair on every heartbeat frame.
3. **Parking is marking.** In-page, finishing an ink stroke forces a keyframe. The
   out-of-Chrome twin: when a drag ends (coords change, then hold still), the recorder
   forces a `mark`. Park the arrow on the bad cell and the moment is guaranteed captured,
   crosshair and all, mid-sentence.
4. **Pins recover "these three things."** One puck can't circle three cells — but it can
   visit them. Clicking the puck's arrow drops a **pin**: the tip's position and timestamp.
   Pins aren't painted on the screen live (nothing can be); they're painted **onto the
   keyframes** at sample time — numbered cobalt dots at each pinned spot, with the same
   hold-then-fade lifetime as page ink (~8 s hold, 4 s fade). The user isn't drawing blind:
   the tip was physically at each spot when they pinned it. "This cell, this cell, and this
   total don't add up" — three pins, one frame, fully resolved. Each pin also forces a mark.

## The details that make it real (each one bites if skipped)

- **Dedup masking.** The puck's clock ticks and its caption line rewrites every second —
  under the 64×64 signature that's ~80 changed cells against a bar of 8, so an un-masked puck
  turns every second into a "new" keyframe and torches the frame budget. Fix: the panel knows
  the puck's exact bounds, so each stored signature remembers the puck rect at its capture,
  and `cellDiff` masks the **union** of the two rects being compared. A parked puck over a
  still spreadsheet scores 0, exactly as it should.
- **Multi-monitor / wrong-surface honesty.** Drag the puck to a monitor that isn't being
  captured and it silently exits the recording. The panel already knows the captured frame's
  shape; when `mapPointer` rejects the puck's coordinates, the **puck itself** says so — arrow
  greys out, banner reads "off the recording" — because the user is looking at Excel, not at
  the side panel. Same treatment when the capture is a single window rather than a screen.
- **Coordinate units.** `screenX/Y` and `window.screen.*` are DIPs on the puck's *current*
  display, which is also what the in-page samples use — consistent, and per-monitor DPI on
  Windows is handled because the puck reports the screen it's actually on. The tip renders at
  inner (0,0); PiP windows are effectively frameless, but the outer/inner delta gets measured
  once at open rather than assumed zero.
- **Lifetime.** One puck per take (the API allows one PiP window anyway). Opened by a click
  in the panel (`requestWindow` needs transient activation — this is why it can't auto-open
  on Record; the gesture is spent on the share picker). Closed by the panel on stop; if the
  user closes it (`pagehide`), the panel just clears its handle — the take carries on. It
  dies with the panel, which is fine: the whole recording dies with the panel, and recovery
  already exists.
- **No programmatic movement.** `moveTo` is blocked on PiP windows; drag is user-only. Fine —
  drag *is* the interaction — but it rules out "snap to last click," so nothing in the design
  depends on moving it.
- **The opener-context unknown.** Whether `documentPictureInPicture` is exposed to side panel
  documents in current Chrome is genuinely undocumented — Chrome's docs are silent and the
  extension groups have no verdict. The build is feature-detected (`'documentPictureInPicture'
  in window`): present → the button appears; absent → it doesn't, nothing else changes.
  **30-second check before building:** open the side panel's DevTools and evaluate that
  expression. If absent, the fallback is opening the puck from the recorded tab's content
  script (same API, page origin) — worse, because it dies if that tab navigates, so it's the
  fallback and not the design.

## The Excel walkthrough, end to end

Record → picker → **Entire screen**. The panel sees a screen-shaped capture and pulses the
puck button — "take the pointer with you." One click, the arrow appears, the user alt-tabs to
Excel. They drag the body until the tip rests on H14, and as they say "this number is what's
wrong," the caption line under the arrow types it back at them. The drag-end already forced a
keyframe: crosshair at H14, puck in frame, captions legible. They click the arrow on H14, C3,
and the total row — three numbered pins on the next keyframes — then hit the puck's mark, then
stop, without touching Chrome once. The report frames resolve every "this" in the transcript.

## What it deliberately does not do

- **No freehand ink outside Chrome.** The page ink stays exactly as it is; the puck is the
  outside-Chrome affordance. Pointer + pins + narration resolves the reference without it.
- **No native helper.** Path 2 stays dead unless the puck proves insufficient in practice —
  revisit only after the Web Store listing lands (`plans/2026-07-30-go-live.md`).
- **No fiducial detection, no synthetic restyling of the puck region in keyframes, no custom
  text labels in the body.** All real, all v2 — logged tip coordinates per frame make them
  possible later without re-recording anything.

## Implementation map

- `extension/src/sidepanel/puck.ts` (new, ~200 lines): `openPuck(recorder, onClosed)` —
  requests the window, writes DOM + inline styles, polls geometry, feeds
  `recorder.setPuckPointer()`, detects drag-end → `recorder.mark()`, wires arrow-click →
  `recorder.pin()` and the mark/stop buttons, renders clock/caption/off-screen state from the
  panel's existing per-second update.
- `recorder.ts`: second pointer slot + preference order in `pointerNow()`; `pin()` +
  pin-drawing in `sample()` (reuses the crosshair's mapping); signatures become
  `{data, puckRect}` and `cellDiff` masks the rect union; expose frame shape for the
  off-screen check.
- `App.tsx`: feature-detected puck button while recording (pulsing when the capture is
  screen-shaped), closed on stop.
- No changes to `messages.ts`, the worker, the content script, the upload shape, or the
  server. `FramePointer` is unchanged — a puck-pointed frame is just a frame with `nx/ny`
  and no selector, which the report already renders honestly.
- `bun run typecheck` green before done, as always.

## Open questions for Sal

1. The 30-second side-panel check above — run it, or should I just build behind the
   feature-detect and we find out?
2. Pins: click-the-arrow feels right, but `p` on the keyboard while the puck has focus is
   free to add — want both?
3. Caption line in the puck: always-on, or a toggle? (It's the demo moment, but it's also
   the user's own words typing back at them all take long.)
