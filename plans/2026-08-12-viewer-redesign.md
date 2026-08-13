# Walkthrough viewer + editor + watch page redesign

- **Date:** 2026-08-12
- **Status:** done
- **Type:** plan
- **What:** Mock-first redesign of /walkthroughs/:id (agent + human faces), the human-handback
  editor (scrubber, segment-toggle cuts), and the public /w watch page. Owner verdict: current
  viewer UI is unusable — header dropdown soup, agent/human switch makes no sense, human editor
  must be a video scrubber, not a wall of words.

## Owner decisions (2026-08-12, this session)

- Scope: viewer page, human editor, and /w watch page. Inbox and the rest of the app untouched.
- Editor cut model: **toggle segments on the track** — a real scrubber (filmstrip, ruler,
  playhead, drag-to-scrub) where proposed cuts and transcript-line windows render as segments you
  click to cut/restore. No drag-selection (2026-08-01 "no selection" verdict stands).
  This REVERSES decisions.md 2026-08-12 "transcript-first editor" — flagged and owner-approved.
- Process: mock-first. Aesthetic is NOT in question (ui.md is law); the 2–3 directions are
  layout/IA arguments in the same visual language.
- **Standing note (mid-session):** owner also hates the rest of the app — the inbox concept and
  its layout in particular — and will eventually want an app-wide redesign. Out of scope now, but
  the winning viewer direction should be treated as the seed of that future language; don't make
  choices that only work on the viewer page.

## Shared design constraints (all screens)

- ui.md verbatim: light only, warm paper ground, white cards, near-black ink, ONE cobalt accent,
  violet = in_review only, green = resolved only, red = destructive only. Fraunces display,
  Libre Franklin body, IBM Plex Mono for anything technical. Hairline rules over boxes, boxes
  over shadows. Left-aligned app pages, max-w-6xl.
- Inside any recorded frame the captured app is GREYSCALE; only reviewer cobalt (crosshair, ink)
  has color — the landing-page convention, kept.
- Sample data everywhere = the demo walkthrough (`landing/demo-data.ts`): "Promo code applies to
  nothing at checkout", slug 2026-07-29-1215-promo-code-checkout, shop.northwind.test, 1:34,
  2 takes, 41 keyframes, 3 console errors, project Northwind Storefront, transcript lines and the
  `POST /api/coupons/apply → 500` events as written there.

## Header/controls IA (all directions share this fix)

- The page DECLARES its kind; the kind select leaves the primary row. Status is a first-class
  triage control. Project assignment stays visible but quiet. Move-to-space, kind switch, and
  Delete demote to a `⋯` overflow menu. One primary hand-off action per kind: agent → "Copy agent
  brief" (cobalt), human → Share. No native `<select>` styling anywhere; no `window.confirm`.

## Screen paragraphs (reused verbatim in generation prompts)

### S1 — Agent walkthrough viewer (ANCHOR, three directions)

The signed-in review page for a walkthrough recorded for an agent. Top: a back crumb "← Inbox";
the walkthrough title "Promo code applies to nothing at checkout" as a large Fraunces headline;
a mono metadata line "2026-07-29-1215-promo-code-checkout · shop.northwind.test · Jul 29, 12:15 ·
1:34 · 2 takes · 41 frames · 3 console errors · 36 MB · uploaded by Sal"; a triage row with a
status control showing open/in review/resolved (open active in cobalt), a quiet project label
"Northwind Storefront", a primary cobalt button "Copy agent brief", and a small "⋯" overflow
button. Body: the recording player showing a greyscale checkout page (cart with three items,
promo field with SAVE20, total $128.00) with a cobalt pointer crosshair; below it a filmstrip of
small greyscale keyframe thumbnails with mono timestamps; the spoken transcript with cobalt mono
times ("0:06 Okay, so this is the checkout — I'm on the cart with three items." / "0:11 I paste
in SAVE20, which is the code we emailed out this morning." / "0:14 Hit apply…" / "0:19 and
nothing. No error, no discount, the total is still a hundred and twenty-eight."); a console/
network events list in mono ("0:15 POST /api/coupons/apply → 500 (118 ms)" / "0:15 TypeError:
Cannot read properties of null (reading 'id')"); and a "Report" section showing rendered
markdown the agent will read. No sidebar. No dark surfaces except inside video/thumbnail frames.

Directions:
- **A "Proof sheet"** — editorial single column, take-by-take: masthead header, one take's big
  player with its filmstrip beneath, transcript as a ruled margin column to its right, events
  under the transcript, report as a folded document section at the end. Closest to today's bones,
  fixed hierarchy.
- **B "Bench"** — player-first workbench: compact sticky header bar, ONE continuous player (left,
  ~2/3) over ONE scrubber timeline spanning all takes (ruler, filmstrip lane, take seams, cobalt
  playhead), right rail (~1/3) with tabs Transcript / Console / Report, everything click-to-seek
  against the one player. Same chassis later hosts the editor (cuts on the same timeline).
- **C "Report desk"** — the report is the star: header as a ruled mono spec table (recorded /
  duration / takes / frames / errors / project / status as table rows, controls living in their
  cells), screening area (player + timeline) above, then the report rendered full-width as the
  primary document with transcript citations interleaved.

### S2 — Human handback editor (suite)

Same design system. The edit surface for a walkthrough recorded for a person, mid-edit. Header
matches the anchor (title "Sprint 34 demo — new checkout flow", meta line, Share primary,
overflow). Readout row: "8:12 → 5:47 · 14 cuts" in mono with the struck original duration, and a
"tighten" slider with a mono "0.8s" value. The player shows the current frame (greyscale app,
cobalt crosshair). Below the player, THE SCRUBBER: a white track on paper with a mono time ruler,
a filmstrip lane of tiny greyscale thumbnails, a take lane with "take 1 · 4:03" / "take 2 · 4:09"
labels over dashed seams, a voice lane of ink-grey density bars, and a cobalt playhead. Cut
segments render ON the track: struck spans shown hatched/dimmed with tiny mono "−1.2s" tags;
clicking toggles them (some enabled, one shown hollow/vetoed). Below the scrubber, the synced
transcript with cobalt times; struck lines render greyed with strikethrough. Footer row: a cobalt
"Render & share" button with a quiet "discard edit" link. No drag-selection UI, no marquee.

### S3 — Human viewer, rendered cut (suite)

The same page once final.mp4 exists: header (human kind declared, Share primary showing the
share link state "handback.dev/w/8kQ… · copy · revoke"), the finished player large, a simple
scrubber-style progress with chapter ticks, transcript beside/below with click-to-seek, a
"Download the video" link, and a quiet "re-edit this cut" link. No filmstrip, no report, no
console — none of the agent scaffolding.

### S4 — Public /w watch page (suite)

Signed-out. Minimal marketing chrome: small return-mark + "handback" wordmark top-left, nothing
else in the header. Centered column: title, mono date + duration line, the player, transcript
below with cobalt times, "Download the video" link, and a one-line footer "Recorded with
Handback → handback.dev". No status, no controls, no nav.

## Chosen direction (owner, 2026-08-12): MERGE of all three

Owner: "I like all 3… the audio soundwave from the second one… the squares from the third one
for each image… Put them all together. Make good choices on the header."

Merged layout (the new S1, anchor for the suite):
1. **Masthead header (from A)** — crumb; Fraunces title row with segmented status control,
   quiet project label, cobalt "Copy agent brief", `⋯` overflow; mono meta line; hairline.
   NO spec table (redundant with the meta line).
2. **Working surface (from B)** — player left ~2/3; right rail is the transcript (cobalt mono
   times, always visible — no tabs), console list beneath it under a hairline.
3. **Scrubber timeline (from B)** — full width under the player, spanning all takes: mono
   ruler, filmstrip lane, take lane with dashed seams, VOICE WAVEFORM lane, cobalt playhead.
4. **Frames contact sheet (from C)** — full-width numbered greyscale squares with mono
   timestamps, current frame cobalt-outlined, click seeks.
5. **Report (from A/C)** — rendered full width at the bottom.

## Mock output

Scratchpad `mocks/` (session dir); chosen set re-referenced here when approved.

## After approval

Design deltas land in ui.md (viewer/editor section), implementation per approved mocks,
decisions.md entry superseding "transcript-first editor" (2026-08-12), updates.md entry.
