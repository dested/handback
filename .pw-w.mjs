import { chromium } from '@playwright/test'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 390, height: 844 } })
await p.goto('http://localhost:3995/', { waitUntil: 'load' })
await p.waitForTimeout(2000)
console.log(JSON.stringify(await p.evaluate(() => ({
  doc: document.documentElement.scrollWidth,
  per: [...document.querySelectorAll('main > section')].map((s,i)=>`${i}:${s.scrollWidth}`),
}))))
await b.close()
