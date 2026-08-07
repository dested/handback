/**
 * Produces the Chrome Web Store upload zip from dist/.
 *
 * The Web Store rejects a manifest that carries a `key` field ("key field is
 * not allowed in manifest"), so we stage dist/, drop only `key` from the staged
 * manifest, and zip that — source and the self-hosted zip keep the key.
 *
 * Consequence: stripping `key` means Chrome assigns the STORE build its own ID
 * (bdhajcllnjcnihcbobhaecldgjlhfdhd), distinct from the `key`-pinned local /
 * self-hosted ID (gmggnebbenlmpakojgocnjfcnpmifdci). The web app's /recorder
 * page pings BOTH IDs — see EXTENSION_IDS in src/app/recorder.tsx.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const stage = resolve(root, '.store-pack');
const outZip = resolve(root, 'handback-recorder-store.zip');

rmSync(stage, { recursive: true, force: true });
rmSync(outZip, { force: true });
mkdirSync(stage, { recursive: true });
cpSync(dist, stage, { recursive: true });

const manifestPath = resolve(stage, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if ('key' in manifest) {
  delete manifest.key;
  console.log('stripped `key` from store manifest');
}
if (manifest.description && manifest.description.length > 132) {
  throw new Error(`description is ${manifest.description.length} chars (Web Store max 132)`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

execFileSync(
  'pwsh',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${stage}/*' -DestinationPath '${outZip}' -Force`,
  ],
  { stdio: 'inherit' },
);
rmSync(stage, { recursive: true, force: true });
console.log(`wrote ${outZip}`);
