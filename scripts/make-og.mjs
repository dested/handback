// Generates public/og.png — the 1200×630 social card, rendered at 2× so the
// file is 2400×1260. The og:image:width/height meta in index.html must match
// deviceScaleFactor × viewport (2 × 1200 = 2400, 2 × 630 = 1260).

import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { statSync } from 'node:fs'

const outPath = fileURLToPath(new URL('../public/og.png', import.meta.url))

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=IBM+Plex+Mono:wght@500&display=swap"
      rel="stylesheet" />
    <style>
      :root {
        --cobalt: oklch(0.485 0.195 262);
        --border: oklch(0.9 0.008 95);
        --muted: oklch(0.5 0.012 260);
      }
      body {
        margin: 0;
        width: 1200px;
        height: 630px;
        background: oklch(0.985 0.004 95);
        color: oklch(0.23 0.015 260);
        box-sizing: border-box;
        padding: 88px 96px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        font-family: 'Fraunces', Georgia, serif;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .wordmark {
        display: flex;
        align-items: center;
        gap: 20px;
      }
      .wordmark .word {
        font-family: 'Fraunces', Georgia, serif;
        font-weight: 600;
        font-size: 46px;
        letter-spacing: -0.02em;
      }
      .stamp {
        font-family: 'IBM Plex Mono', monospace;
        font-weight: 500;
        font-size: 19px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--cobalt);
        border: 2px solid var(--cobalt);
        border-radius: 6px;
        padding: 10px 18px;
        transform: rotate(-2deg);
      }
      .headline {
        font-family: 'Fraunces', Georgia, serif;
        font-weight: 600;
        font-size: 78px;
        line-height: 1.08;
        letter-spacing: -0.015em;
      }
      .headline .cobalt {
        color: var(--cobalt);
      }
      .bottom {
        border-top: 1px solid var(--border);
        padding-top: 30px;
        display: flex;
        justify-content: space-between;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 23px;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <div class="top">
      <div class="wordmark">
        <svg viewBox="0 0 28 20" fill="none" height="54" width="auto" aria-hidden="true">
          <path
            d="M4 6.2 H18 A3.8 3.8 0 0 1 21.8 10"
            stroke="oklch(0.23 0.015 260)"
            stroke-width="2.4"
            stroke-linecap="round" />
          <path
            d="M21.8 10 A3.8 3.8 0 0 1 18 13.8 H8"
            stroke="oklch(0.485 0.195 262)"
            stroke-width="2.4"
            stroke-linecap="round" />
          <path
            d="M11.4 9.4 L6.2 13.8 L11.4 18.2"
            stroke="oklch(0.485 0.195 262)"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round" />
        </svg>
        <span class="word">handback</span>
      </div>
      <div class="stamp">Signed off by a human</div>
    </div>
    <div class="headline">
      Record a bug.<br />
      Your coding agent fixes it.<br />
      <span class="cobalt">You sign off.</span>
    </div>
    <div class="bottom">
      <span>handback.dev</span>
      <span>works with Claude Code · MCP</span>
    </div>
  </body>
</html>`

let browser
try {
  browser = await chromium.launch({ channel: 'chrome' })
} catch {
  browser = await chromium.launch()
}

const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
})
await page.setContent(html, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(300)
await page.screenshot({ path: outPath })
await browser.close()

const { size } = statSync(outPath)
console.log(`${outPath} — ${size} bytes`)
