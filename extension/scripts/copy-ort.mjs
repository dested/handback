/**
 * Stages the onnxruntime-web wasm runtime into public/ort/ so transformers.js can
 * load it from the extension instead of a CDN — MV3 forbids remote code, and the
 * side panel's CSP only allows 'self' + 'wasm-unsafe-eval'. Copied at build time
 * rather than checked in: the binaries are large and belong to the dependency.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = resolve(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
const OUT_DIR = resolve(ROOT, 'public', 'ort');
// transformers.js imports `onnxruntime-web/webgpu`, whose loader asks for the
// asyncify build by name (`wasmPaths` prefix + this filename) for both the webgpu
// and the wasm device. The other ort variants in dist/ are never fetched.
const FILES = ['ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs'];

mkdirSync(OUT_DIR, { recursive: true });
for (const file of FILES) {
  copyFileSync(resolve(SRC_DIR, file), resolve(OUT_DIR, file));
}
console.log(`ort → ${OUT_DIR} (${FILES.length} files)`);
