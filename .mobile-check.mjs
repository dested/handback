import { chromium } from '@playwright/test'

const OUT = process.argv[2] ?? '.'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
// Vite keeps an HMR socket open, so networkidle never fires in dev.
await page.goto('http://localhost:3995/', { waitUntil: 'load' })
await page.waitForTimeout(2500)

const overflow = await page.evaluate(() => {
  const bad = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
      bad.push(`${el.tagName}.${String(el.className).slice(0, 60)} → ${Math.round(r.left)}..${Math.round(r.right)}`)
    }
  }
  return {
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    height: document.body.scrollHeight,
    offenders: bad.slice(0, 12),
  }
})
console.log(JSON.stringify(overflow, null, 2))

const sections = await page.$$('main > section')
for (const [i, section] of sections.entries()) {
  await section.screenshot({ path: `${OUT}/m-${i}.png` })
}
console.log('sections:', sections.length)
await browser.close()
