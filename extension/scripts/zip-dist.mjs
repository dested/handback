/**
 * The self-hosted release zip: extension/dist as built, `key` kept, so the
 * install keeps the pinned extension ID. `cli/publish-recorder.ts` uploads it.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDir } from './zip.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outZip = resolve(root, 'handback-recorder.zip');
zipDir(resolve(root, 'dist'), outZip);
console.log(`wrote ${outZip}`);
