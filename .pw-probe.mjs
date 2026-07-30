import { chromium } from '@playwright/test'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 390, height: 844 } })
await p.goto('http://localhost:3995/', { waitUntil: 'load' })
await p.waitForTimeout(2000)
const res = await p.evaluate(() => {
  const inScroller = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true
    }
    return false
  }
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue
    if (inScroller(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right > 367 && r.width > 0) {
      out.push({ right: Math.round(r.right), tag: el.tagName, cls: String(el.className).slice(0, 50), txt: (el.textContent || '').trim().slice(0, 45) })
    }
  }
  out.sort((a, c) => c.right - a.right)
  return out.slice(0, 14)
})
console.log(JSON.stringify(res, null, 2))
await b.close()
