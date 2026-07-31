# Chrome Web Store listing — copy, justifications, and submission notes

> **Status: active** · written 2026-07-30. Everything the store form asks for, written out so
> submission is copy-paste rather than composition. The *how hard is this* analysis lives in
> [`2026-07-30-go-live.md`](2026-07-30-go-live.md); this doc is the answers.
>
> Paste each block into the matching field in the Developer Dashboard. Where a field has a
> character limit, the limit is noted and the copy is already inside it.

## Store listing

**Item name** (45 max)

```
Handback Recorder
```

**Summary** (132 max — this is the one line people read)

```
Narrate what's broken. Handback records the screen, your voice, and the console, then hands it to your coding agent.
```

**Category:** Developer Tools
**Language:** English (United States)

**Detailed description**

```
Handback Recorder turns "this is broken" into something a coding agent can act on.

Press record, walk through the bug, and say what's wrong out loud. Handback captures the screen, your narration, and — separately — what the page itself was complaining about: console errors, failed requests, the URL you were on, where you clicked.

When you stop, you get a walkthrough: keyframes cut at the moments the screen actually changed, a timed transcript of what you said, and a written report that ties the two together. Nothing to type up.

Send it to your team's Handback workspace and your coding agent pulls it over MCP — recording, transcript, frames, and errors, all in one brief. A human signs off before anything is called fixed.

WHAT IT DOES
• Records a tab, a window, or a screen, with your microphone
• Keeps the frames that matter — the screen changing, your clicks, page navigations, and any moment you mark with Alt+Shift+M
• Transcribes your narration, with timestamps that line up with the frames
• Draw on the page while you talk (Alt+Shift+D) to point at what you mean
• Collects console errors and failed requests from the tab you're recording
• Writes a report an agent can read, and uploads the whole thing to your workspace

TRANSCRIPTION IS YOUR CHOICE
By default your audio is transcribed by our server and comes back in seconds. Prefer that nothing leaves your machine? Turn on "Transcribe on this device" and a speech model runs inside your own browser instead — slower, and entirely local.

YOU NEED A HANDBACK ACCOUNT
Uploading requires a workspace at https://handback.dev and an API token you paste into the extension. Recording, transcribing, and reviewing all work without one — the upload step is what needs the account.

PRIVACY
Recordings are yours. They are never used to train AI models and never sold. Full policy: https://handback.dev/privacy
```

## Single purpose statement

The store asks for one sentence, and the whole permission story rests on it. Keep it narrow:

```
Handback Recorder records a narrated walkthrough of a web page — screen, microphone, and the page's own console errors — and uploads it to the user's Handback workspace as a bug report.
```

## Permission justifications

One field per permission. Each answer names what breaks without it — reviewers reject vague ones.

**`activeTab`**

```
Used when the user starts a recording to identify and attach to the tab they are recording, so the on-page drawing layer and the "mark this moment" hotkey act on that tab and no other.
```

**`scripting`**

```
Injects the recording overlay into the tab being recorded: the on-page dock (stop, mark, draw), the ink layer the narrator draws with, and the listener that reports the page's own console errors and failed requests. It is also used to re-inject that overlay after the recorded page navigates, which discards the previous injection.
```

**`storage`**

```
Stores the user's own settings — their workspace URL, their API token, narration language, and whether to transcribe on-device — and the recordings themselves while they are being worked on. Recordings are held locally until the user chooses to upload them.
```

**`tabs`**

```
Reads the active tab's id and URL so a recording can be scoped to one page: console errors from other tabs are discarded rather than mixed into the report. Also used to notice when the recorded tab navigates, so the overlay is restored and the navigation is marked on the timeline.
```

**`sidePanel`**

```
The extension's entire interface is a side panel: start and stop recording, review the transcript, correct lines, arrange the timeline, and upload. There is no popup and no separate window.
```

**Host permission `<all_urls>`**

This is the answer that decides the review. Two sentences of what, one of why it can't be narrower:

```
A bug can happen on any page, and the user chooses which page to record at record time — the extension has no way to know in advance which sites its users will need to report bugs on, so it cannot enumerate them. On every page the content script does nothing at all until the user presses record; from then on, and only in the tab being recorded, it draws the on-page controls, provides the drawing layer, and forwards that page's console errors and failed requests into the report. No page content is read, collected, or transmitted outside a recording the user started.
```

> If Google pushes back here, the fallback is already specified: drop `host_permissions` and the
> always-on content script and inject via `activeTab` + `scripting` at record-start. Files and
> consequences are written out in
> [`2026-07-30-go-live.md` → what makes this submission slower](2026-07-30-go-live.md#what-makes-this-submission-slower-than-average).
> Sal's call, 2026-07-30: **do not do this pre-emptively.**

**Remote code** — answer "No, I am not using remote code."

```
All executable code ships inside the package. The ONNX runtime used for on-device transcription is bundled into the extension (see extension/scripts/copy-ort.mjs), and the CSP is script-src 'self' 'wasm-unsafe-eval'. If a user enables on-device transcription, the speech model's weights are downloaded from huggingface.co on first use. Those are model weights — data consumed by the bundled runtime — not code, and no script or WASM module is fetched or executed from a remote source.
```

## Data-use disclosures

Tick these, and no others. Every box below has a real line in the code behind it.

| Category | Collected | Why |
|---|---|---|
| Personally identifiable information | **Yes** | Email address, for the account the recording uploads to |
| Authentication information | **Yes** | The workspace API token, stored locally in `chrome.storage` |
| Website content | **Yes** | The screen recording, keyframes, and the recorded page's console errors and URL |
| Web history | **No** | Only the URL of a page actively being recorded, as part of that recording |
| Personal communications, financial info, health info, location, user activity | **No** | — |

The three certifications, all of which we can honestly tick:

- Not being sold to third parties.
- Used only for the item's single purpose (delivering a bug report to the user's own workspace).
- Not used to determine creditworthiness or for lending.

**Privacy policy URL:** `https://handback.dev/privacy`

Keep that page in step with this form. It already names every processor — AWS, Groq, Anthropic,
Resend — and the two transcription modes; if the list changes, the listing's disclosures change in
the same release.

## Notes for the reviewer

Without this the review fails on "we could not test the functionality" — the extension needs an
account before it can upload.

```
The extension records without an account, but uploading needs a Handback workspace. A test account is provided:

  Sign in:  https://handback.dev/sign-in
  Email:    <REVIEWER EMAIL — create before submitting>
  Password: <REVIEWER PASSWORD>
  API token: already saved in the account under Team → API tokens

To exercise it end to end:
  1. Open any web page, click the Handback icon to open the side panel.
  2. Paste the API token into Settings in the panel (workspace URL is already https://handback.dev).
  3. Press Record, choose the tab to share, allow the microphone, and talk for ten seconds.
  4. Press Stop. The transcript appears in the panel within a few seconds.
  5. Press Hand back. The recording uploads and the panel links to it at handback.dev.

Microphone: requested through the extension's own permission page (micperm.html) the first time.
Screen capture: standard getDisplayMedia picker; the extension never captures without it.
```

## Screenshots — the shot list

Five 1280×800 PNGs, light UI (the product has no dark mode). Record a real gripe on a real page and
shoot from that, not from mockups:

1. **Recording in progress** — the on-page dock over a real site, live transcript line visible.
2. **The side panel after a take** — transcript with timestamps, frames beside it.
3. **Drawing on the page** — the ink layer mid-sentence, pointing at the broken thing.
4. **The workspace inbox** — gripes listed at handback.dev, one open.
5. **The report** — `report.md` as an agent receives it.

Store icon is already in the package (`extension/public/icons/128.png`). No promo tiles needed for
an unlisted listing.

## Submission checklist

- [ ] $5 developer registration paid (one-time, Sal)
- [ ] Reviewer test account created on prod, credentials pasted into the notes block above
- [ ] `bun run build:extension`, zip `extension/dist`
- [ ] Version in `extension/public/manifest.json` bumped if resubmitting
- [ ] Listing fields pasted from this doc
- [ ] Five screenshots shot and uploaded
- [ ] Privacy policy URL set, disclosures ticked per the table above
- [ ] **Visibility: Unlisted** for the alpha (same review, link-only distribution)
- [ ] Submit — then keep working; the queue runs in parallel

## When it comes back

- A rejection cites one thing. Fix that one thing; don't rewrite the listing.
- If it cites host permissions, do the `activeTab` migration in the go-live doc — it's fully
  specified there, and it is a real change to when the dock appears, so read the consequence note
  before starting.
- Once approved, updates re-review but usually fast. Flip to public when the go-live blockers are
  done.
