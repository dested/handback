/**
 * Drops the duplicate ort wasm Vite emits into dist/assets/. The runtime always
 * loads the copy in dist/ort/ (wasmPaths is set before any ort init); the hashed
 * asset is only emscripten's never-taken fallback, and it doubles the zip.
 */
import { readdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets');
let dropped = 0;
for (const file of readdirSync(ASSETS)) {
  if (file.startsWith('ort-wasm') && file.endsWith('.wasm')) {
    unlinkSync(resolve(ASSETS, file));
    dropped++;
  }
}
console.log(`pruned ${dropped} duplicate ort wasm from dist/assets`);
