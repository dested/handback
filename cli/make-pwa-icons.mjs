/**
 * Generates the PWA icons (the Handback mark: one returning stroke — out in
 * ink, back in cobalt with an arrowhead) with zero dependencies — the same
 * hand-rolled PNG encoder and mark geometry as extension/scripts/make-icons.mjs,
 * plus the two things installable icons need that extension icons don't: a
 * full-bleed paper background and a mark fitted inside the maskable safe zone.
 *
 *   node cli/make-pwa-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const INK = [35, 38, 46] // near-black
const COBALT = [47, 86, 216] // the reviewer's pen
const PAPER = [251, 250, 247] // #fbfaf7, the app's background

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  const body = out.subarray(4, 8 + data.length)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return out
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * The mark: one returning stroke, drawn in the web mark's 28×20 coordinate
 * space (src/components/logo.tsx is the source of truth). Out along the top in
 * ink, a U-turn on the right, back along the bottom in cobalt, arrowhead
 * landing on the left. Cobalt wins overlaps — the pen sits on top. Returns
 * null (transparent) or an [r,g,b] colour for a point in normalised space
 * (-1..1 both axes).
 */
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function sample(nx, ny) {
  // Normalised -1..1 → mark units (viewBox 0 0 28 20, centred, slight padding).
  const mx = nx * 15.5 + 14
  const my = ny * 15.5 + 10
  const HW = 1.6 // half stroke width, thicker than the web 1.2 for icon punch
  // U-turn arc: centre (18,10) r 3.8; right half only, split at the midline.
  const arcDist = Math.abs(Math.hypot(mx - 18, my - 10) - 3.8)
  const onArc = arcDist <= HW && mx >= 18
  const cobalt =
    (onArc && my >= 10) ||
    distSeg(mx, my, 8, 13.8, 18, 13.8) <= HW ||
    distSeg(mx, my, 11.4, 9.4, 6.2, 13.8) <= HW ||
    distSeg(mx, my, 6.2, 13.8, 11.4, 18.2) <= HW
  if (cobalt) return COBALT
  if ((onArc && my < 10) || distSeg(mx, my, 4, 6.2, 18, 6.2) <= HW) return INK
  return null
}

/**
 * Measures the mark's bounding box in normalised space by scanning it, so the
 * safe-zone fit below can never drift out of sync with the geometry above.
 */
function measureMark() {
  const steps = 1024
  let minX = 1
  let maxX = -1
  let minY = 1
  let maxY = -1
  for (let i = 0; i < steps; i++) {
    const nx = ((i + 0.5) / steps) * 2 - 1
    for (let j = 0; j < steps; j++) {
      const ny = ((j + 0.5) / steps) * 2 - 1
      if (!sample(nx, ny)) continue
      if (nx < minX) minX = nx
      if (nx > maxX) maxX = nx
      if (ny < minY) minY = ny
      if (ny > maxY) maxY = ny
    }
  }
  return { minX, maxX, minY, maxY }
}

const BOUNDS = measureMark()

/**
 * Maps device space (-1..1) onto the mark so the mark's bounding box is centred
 * and fills `safe` of the square — 0.8 for maskable icons, whose outer 20% any
 * launcher may crop away. `safe: null` leaves the extension's framing alone.
 */
function fitter(safe) {
  if (safe === null) return (nx, ny) => [nx, ny]
  const cx = (BOUNDS.minX + BOUNDS.maxX) / 2
  const cy = (BOUNDS.minY + BOUNDS.maxY) / 2
  const scale = (safe * 2) / Math.max(BOUNDS.maxX - BOUNDS.minX, BOUNDS.maxY - BOUNDS.minY)
  return (nx, ny) => [nx / scale + cx, ny / scale + cy]
}

function render(size, { safe = null, background = null } = {}) {
  const ss = 4 // supersample for cheap anti-aliasing
  const fit = fitter(safe)
  const rgba = new Uint8Array(size * size * 4)
  const half = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      const acc = [0, 0, 0]
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [nx, ny] = fit(
            (x + (sx + 0.5) / ss - half) / half,
            (y + (sy + 0.5) / ss - half) / half
          )
          const colour = sample(nx, ny)
          if (colour) {
            hits++
            acc[0] += colour[0]
            acc[1] += colour[1]
            acc[2] += colour[2]
          }
        }
      }
      const i = (y * size + x) * 4
      const alpha = hits / (ss * ss)
      if (background) {
        for (let c = 0; c < 3; c++) {
          const ink = hits > 0 ? acc[c] / hits : background[c]
          rgba[i + c] = Math.round(background[c] * (1 - alpha) + ink * alpha)
        }
        rgba[i + 3] = 255
      } else if (hits > 0) {
        for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(acc[c] / hits)
        rgba[i + 3] = Math.round(alpha * 255)
      }
    }
  }
  return rgba
}

const ICONS = [
  ['pwa-192.png', 192, {}],
  ['pwa-512.png', 512, {}],
  ['pwa-maskable-192.png', 192, { safe: 0.8, background: PAPER }],
  ['pwa-maskable-512.png', 512, { safe: 0.8, background: PAPER }],
  ['apple-touch-icon.png', 180, { safe: 0.86, background: PAPER }],
]

mkdirSync(OUT_DIR, { recursive: true })
for (const [name, size, options] of ICONS) {
  writeFileSync(resolve(OUT_DIR, name), encodePng(size, render(size, options)))
}
console.log(`pwa icons → ${OUT_DIR} (${ICONS.map(([name]) => name).join(', ')})`)
