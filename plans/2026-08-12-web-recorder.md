# Recording from the website, without the extension

- **Date:** 2026-08-12
- **Status:** done
- **Type:** plan
- **What:** an extension-free recording path at `/record` — live `getDisplayMedia`
  capture in the page, distilled and uploaded through the unchanged pipeline.

## The ask

Owner: "make it so users can run a Handback recording straight from the website,
where they don't have to open up the Chrome extension — it does the recording the
same exact way as the extension does, maybe even with the same exact window/UI and
everything, but they can do it without the extension if they so choose."

The extension path stays. This is an additional door into the same room.

## Why this is possible at all

`decisions.md` 2026-08-02 settled that **no mobile browser can capture the
screen**, and that verdict is why `/phone` rides the OS recorder. It is a
statement about *mobile*, not about `getDisplayMedia` — a desktop Chrome/Edge tab
has had screen capture for years, and the extension's own recorder is plain web
platform on top of it. The survey confirmed it: everything in
`extension/src/sidepanel/recorder.ts` — the picker call, the 64×64 dedup, the
Web Audio mixer, the mic shadow, the frame budget, IndexedDB persistence — runs
in a page unchanged. Only the *content-script* half doesn't.

## What ships

| Piece | File |
| --- | --- |
| Live capture engine (port of the extension's `Recorder`) | `src/lib/capture/live.ts` |
| Its crash-survivable store (IDB `handback-web-recorder`) | `src/lib/capture/live-store.ts` |
| Take set → file set → declare/PUT/finalize | `src/lib/capture/live-upload.ts` |
| The panel UI (mirrors the side panel) | `src/components/record/panel.tsx` |
| Always-on-top pop-out (Document PiP) | `src/components/record/pip.tsx` |
| The page | `src/app/record.tsx` |
| Shared token mint/re-mint (was copied 2×) | `src/lib/capture-token.ts` |

## The two divergences, on purpose

1. **No content script, so no page telemetry.** Console/network errors, click and
   nav forced keyframes, pointer crosshairs, ink and click ripples all come from
   `extension/src/content/*` injected into the recorded page. A page cannot
   inject into another origin, so a web recording carries `events: []`,
   `errorCount: 0`, no `pointer` on any frame, and only the `start` / `change` /
   `beat` frame reasons — exactly the set `/phone` already produces
   (`src/lib/capture/frames.ts` says the same thing about clips). Everything
   downstream already tolerates it.
2. **No live dictation.** The extension's interim caption line is Web Speech
   running in the content script. Dropped rather than reimplemented: it never
   wrote the shipped transcript (Whisper does), and a mic level tap answers the
   only question it really answered — "is it hearing me". The HUD gets a 3-state
   mic line to match the app-audio one.

Everything else is the same code path: same dedup constants (imported from
`frames.ts` now, rather than copied a third time), same `frameBudget`, same
audio graph and mic-only shadow for transcription, same `report.md` /
`MANIFEST.txt` / `recording.json`, same two-phase upload.

## The pop-out, and why it needs its own click

`decisions.md` 2026-08-01 (the puck) recorded that `requestWindow()` needs its
own user gesture because "the Record click is spent on the share picker". Same
constraint here, same answer: the Document PiP HUD is opened by a separate
`pop out` button, never automatically on Record.

## Verified

- `bun run typecheck` clean (`tsgo --noEmit`).
- `bun run build` clean — client and SSR bundles both.
- `prettier --check` clean on every touched file.

## NOT verified — and why

**No live browser run.** `.env`'s `DATABASE_URL` is pointed at the **production**
database (`inloop` on the AWS box) while `BETTER_AUTH_URL` is `localhost:3995`.
That is the standing hazard cliffnotes records as having "bitten twice". Booting
`bun run dev` in that state would have run this page against prod: minting a real
`hb_` token on a real account and, if the send path were exercised, writing a real
walkthrough into prod S3.

So the following are unproven and want a human at a keyboard:

- the picker → capture → keyframe loop against a real screen share;
- the Document PiP pop-out (styles crossing into the second document);
- a full send: transcript, contact sheets, declare/PUT/finalize, and the
  resulting walkthrough opening in the viewer.

To run it safely, point `DATABASE_URL` at the local dev database first, then
`bun run dev` → http://localhost:3995/record.
