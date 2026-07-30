/**
 * Generates the extension icons (the Inloop mark: two interlocked loop outlines,
 * ink + cobalt) with zero dependencies — a tiny hand-rolled PNG encoder plus
 * node's zlib. Beats checking binaries into git, and the mark stays editable as
 * code. Encoder ported from the original Gripe icon script; only the art changed.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SIZES = [16, 32, 48, 128];
const INK = [35, 38, 46]; // near-black
const COBALT = [47, 86, 216]; // the reviewer's pen

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

/**
 * The mark: two circle outlines of equal radius, centres offset horizontally,
 * left ring ink, right ring cobalt. Where they overlap, cobalt wins — the pen
 * sits on top. Returns null (transparent) or an [r,g,b] colour for a point in
 * normalised space (-1..1 both axes).
 */
function sample(nx, ny) {
  const R = 0.52; // ring radius
  const W = 0.16; // stroke width
  const DX = 0.34; // centre offset from the middle
  const inRing = (cx) => Math.abs(Math.hypot(nx - cx, ny) - R) <= W / 2;
  if (inRing(DX)) return COBALT;
  if (inRing(-DX)) return INK;
  return null;
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
