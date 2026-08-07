# Handback Recorder — Chrome Web Store listing packet

Everything the dev-console form asks for, ready to paste. Assets are in this folder.
Console can't be automated (Chrome blocks scripting the Web Store), so this is copy-paste by hand.

> **Before you upload:** the manifest is at version **1.6.3**. If 1.6.3 (or higher) is already
> published, bump `extension/public/manifest.json` `"version"` before you upload — the store rejects
> a version that isn't higher than the live one. Then re-run `bun run pack:store` to get a fresh
> `extension/handback-recorder-store.zip` (that's the file to upload; it has the `key` stripped).

---

## Store listing tab

**Item name**
```
Handback Recorder
```

**Summary** (max 132 — this is 128, matches the manifest `description`)
```
Narrate what's broken. Recording, transcript, and console errors land in your Handback inbox for an agent to fix — you sign off.
```

**Category:** Developer Tools
**Language:** English (United States)

**Description** (paste into the Description field)
```
Handback Recorder turns "here's what's broken" into something a coding agent can actually act on — without you writing a word.

See a bug, review notes, or a change you want made? Open the side panel, hit record, and talk through it out loud while you click around. When you stop, Handback has captured the whole story:

• The screen recording, cut into keyframes
• Your narration, transcribed line by line
• The page's console and network errors, caught as they happened
• The URLs and titles of the pages you visited
• Any marks or drawings you made on the page (Alt+Shift+D)

Review the take right in the panel — scrub the timeline, fix a transcript line with a double-click — then send it to your team's Handback inbox with one tap. There a human reviews it, and a coding agent pulls it over MCP and gets to work. You sign off when it's fixed.

That's the loop: see it → say it → an agent fixes it → you sign off.

WHO IT'S FOR
Software teams who ship with coding agents and are tired of turning "the checkout total is wrong on mobile" into a written ticket, a screen recording, and three console screenshots. Narrate it once; Handback assembles the brief.

PRIVACY
Your recordings, transcript, and reports are never used to train AI models. Narration can be transcribed entirely on your own device — audio never leaves your machine — or, if you choose, by a transcription provider. There are no analytics scripts or trackers in the extension. Full detail: https://handback.dev/privacy

REQUIRES A HANDBACK ACCOUNT
The recorder sends to the Handback workspace at handback.dev. Sign in there, click once to link the extension (no tokens to copy), and pick where each recording goes. Learn more at https://handback.dev/recorder
```

**Homepage / support URL:** `https://handback.dev`
**Support / contact email:** `sal@dested.com`

---

## Graphic assets tab (files in this folder)

| Asset | File | Size |
| --- | --- | --- |
| Store icon | `store-icon-128.png` | 128×128 |
| Screenshot 1 — record | `screenshot-1-record.png` | 1280×800 |
| Screenshot 2 — captured together | `screenshot-2-captured.png` | 1280×800 |
| Screenshot 3 — review & send | `screenshot-3-review.png` | 1280×800 |
| Screenshot 4 — agent-ready inbox | `screenshot-4-handback.png` | 1280×800 |
| Small promo tile | `promo-tile-440x280.png` | 440×280 |
| Marquee promo tile | `promo-marquee-1440x560.png` | 1440×560 |

All screenshots are the real product UI (the extension's own side-panel build), framed on-brand.

---

## Privacy tab

**Single purpose** (required — paste verbatim)
```
Record a narrated screen walkthrough of a web problem — the video, a voice transcript, the page's console and network errors, and the URLs visited — and send it to the user's own Handback workspace so a teammate and a coding agent can act on it.
```

**Permission justifications** (one field each in the console)

- **`sidePanel`**
```
The entire recorder UI — start/stop recording, review the take, pick a destination, send — lives in the side panel. This permission opens it.
```

- **`activeTab`**
```
Recording captures the tab the user explicitly chooses to record. activeTab grants access to that tab only, and only in response to the user starting a recording from the panel.
```

- **`scripting`**
```
While recording, we inject a small overlay into the active tab so the user can draw and mark on the page (Alt+Shift+D), and a listener that captures the page's console and network errors as part of the walkthrough. Nothing is injected outside an active recording.
```

- **`tabs`**
```
So the walkthrough carries the context an agent needs, we read the URL and title of the tab being recorded. We also open a help/permission tab for granting microphone access. We do not read the user's browsing history.
```

- **`storage`**
```
Stores the user's recorder settings (on-device vs. provider transcription), the one-click key that links the extension to their Handback account, and in-progress recordings so a run is never lost if the panel closes. All local.
```

- **Host permissions — `<all_urls>` (and the all-URLs content script)**
```
A bug can happen on any website, so the user must be able to record on any URL. The content script that captures console/network errors and renders the drawing overlay therefore needs to be allowed on all sites — but it only does anything while the user is actively recording that tab. It does not read or send page data at any other time.
```

- **Remote code:** No. All code is bundled in the package. (The `wasm-unsafe-eval` CSP entry is for the on-device speech-to-text model that runs locally via onnxruntime-web — not remotely hosted code.)

**Data collection disclosures** (check these in the "What user data do you collect?" section)

- **Website content** — YES. The screen recording, keyframe images, microphone narration, the page URLs/titles recorded, and the console/network errors from those pages. This is the substance of a walkthrough.
- **Authentication information** — YES. A per-user API token that links the extension to the user's Handback account is stored locally and sent only to the user's Handback server.
- Personally identifiable info / financial / health / location / web-history-at-large / personal comms — **No** (the account email is collected by the Handback web app, not the extension).

**Required certifications** (all three are true — check all)
- I do **not** sell or transfer user data to third parties outside the approved use cases.
- I do **not** use or transfer user data for purposes unrelated to the item's single purpose.
- I do **not** use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://handback.dev/privacy`

> Note for the reviewer / your own records: when server-side transcription is enabled, the audio
> track is sent to Groq for transcription only; the transcript text plus the recorded page URL and
> its console errors are sent to Anthropic for a spelling-cleanup pass (no audio/video/images). Both
> are disclosed in the privacy policy. No data is used to train models.

---

## Distribution tab
- **Visibility:** Public (or Unlisted if you're still soft-launching)
- **Regions:** All
- Pricing: Free
