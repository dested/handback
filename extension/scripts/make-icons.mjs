/**
 * Generates the extension icons (the Handback mark on a solid cobalt tile: the
 * returning stroke knocked out in warm paper) with zero dependencies — a tiny
 * hand-rolled PNG encoder plus node's zlib. Beats checking binaries into git,
 * and the mark stays editable as code. Encoder ported from the original Gripe
 * icon script; only the art changed.
 *
 * WHY a filled tile: a Chrome MV3 action icon gets no reliable dark/light
 * toolbar signal, so a transparent two-tone stroke can't stay legible — its ink
 * half vanished on dark toolbars. The tile carries its own contrast on any
 * toolbar (light, dark, or a custom theme), so the mark is always visible.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SIZES = [16, 32, 48, 128];
const COBALT = [47, 86, 216]; // the reviewer's pen — the tile ground
const PAPER = [250, 249, 245]; // warm paper — the stroke, knocked out of the tile

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const body = out.subarray(4, 8 + data.length);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// The cobalt tile: a rounded square filling the icon, in normalised -1..1 space.
// Signed distance (<0 inside) so supersampling anti-aliases the corners.
const TILE_E = 0.94; // half-extent — near full-bleed for maximum toolbar contrast
const TILE_R = 0.34; // corner radius
function tileDist(nx, ny) {
  const qx = Math.abs(nx) - (TILE_E - TILE_R);
  const qy = Math.abs(ny) - (TILE_E - TILE_R);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - TILE_R;
}

/**
 * The mark: one returning stroke, drawn in the web mark's 28×20 coordinate
 * space (src/components/logo.tsx is the source of truth) — out along the top, a
 * U-turn on the right, back along the bottom, arrowhead landing on the left. On
 * the tile it is a single knocked-out stroke (no ink/cobalt split — the tile is
 * the only colour). Centred and scaled to sit inside the tile with margin.
 * Returns the distance to the nearest stroke in mark units.
 */
function markDist(nx, ny) {
  const mx = 12.9 + nx * 14.8; // mark centre (12.9, 12.2) at the tile centre
  const my = 12.2 + ny * 14.8;
  // U-turn arc: centre (18,10) r 3.8, right half only.
  const arc = mx >= 18 ? Math.abs(Math.hypot(mx - 18, my - 10) - 3.8) : Infinity;
  return Math.min(
    arc,
    distSeg(mx, my, 4, 6.2, 18, 6.2), // out along the top
    distSeg(mx, my, 8, 13.8, 18, 13.8), // back along the bottom
    distSeg(mx, my, 11.4, 9.4, 6.2, 13.8), // arrowhead, upper barb
    distSeg(mx, my, 6.2, 13.8, 11.4, 18.2), // arrowhead, lower barb
  );
}

const HW = 1.9; // half stroke width in mark units — bold enough to read at 16px

// Returns [r,g,b] for a point in normalised space, or null (transparent).
function sample(nx, ny) {
  if (tileDist(nx, ny) > 0) return null; // outside the tile
  if (markDist(nx, ny) <= HW) return PAPER; // the knocked-out stroke
  return COBALT; // the tile ground
}

function render(size) {
  const ss = 4; // supersample for cheap anti-aliasing
  const rgba = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const nx = (x + (sx + 0.5) / ss - half) / half;
          const ny = (y + (sy + 0.5) / ss - half) / half;
          const colour = sample(nx, ny);
          if (colour) {
            hits++;
            acc[0] += colour[0];
            acc[1] += colour[1];
            acc[2] += colour[2];
          }
        }
      }
      const i = (y * size + x) * 4;
      if (hits > 0) {
        rgba[i] = Math.round(acc[0] / hits);
        rgba[i + 1] = Math.round(acc[1] / hits);
        rgba[i + 2] = Math.round(acc[2] / hits);
        rgba[i + 3] = Math.round((hits / (ss * ss)) * 255);
      }
    }
  }
  return rgba;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  writeFileSync(resolve(OUT_DIR, `${size}.png`), encodePng(size, render(size)));
}
console.log(`icons → ${OUT_DIR} (${SIZES.join(', ')})`);
