import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

/**
 * Serves the built side panel with the chrome APIs stubbed, so its layout can be
 * looked at without loading the extension into Chrome. This is the only way to see
 * the panel at a width other than whatever Chrome hands it, and the only way to see
 * the popped editor strip at its real shape.
 *
 *   npm run build && npm run preview
 *   http://localhost:8777/gallery.html?w=380,560,900&mode=long
 *
 * `mode` is rec | long | empty. `w` is a comma-separated list of CSS widths, each
 * rendered in its own iframe so the panel's media queries see it. A `WxH` token
 * (1500x400) gives the frame its own height and runs it popped — that shape is the
 * dock strip.
 *
 * `mode=long` (10:18 across two takes, 150 frames, 120 transcript lines) is the
 * acceptance seed: anything timeline-shaped gets judged there.
 *
 * Zero dependencies, like everything else in scripts/.
 */

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PAGES = join(ROOT, 'scripts', 'preview');
const PORT = Number(process.env.PORT) || 8777;

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

if (!existsSync(join(DIST, 'sidepanel.js'))) {
  console.error('dist/sidepanel.js is missing — run `npm run build` first.');
  process.exit(1);
}

/**
 * Harness pages win over dist/, then the build answers for everything else
 * (/sidepanel.js, /assets/sidepanel.css, /ort/*). The original copied the pages
 * into dist/ because a build wipes it; serving both roots instead means editing
 * gallery.html takes effect on reload with no stale copy to chase.
 */
function locate(path) {
  for (const base of [PAGES, DIST]) {
    const file = join(base, path);
    if (file.startsWith(base) && existsSync(file) && extname(file)) return file;
  }
  return null;
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = locate(path === '/' ? 'gallery.html' : path);
  if (!file) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    // dist/ is rebuilt constantly under fixed filenames; a cached panel bundle
    // means debugging the previous build.
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`panel preview → http://localhost:${PORT}/gallery.html?w=380,560,900&mode=long`);
});
