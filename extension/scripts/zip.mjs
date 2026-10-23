/**
 * Zip a directory's contents (not the directory itself) into `outZip`.
 * PowerShell's Compress-Archive on Windows; Info-ZIP where there is no
 * PowerShell (Linux, WSL). Either way the archive's root is the folder's root,
 * which is what Chrome and the Web Store expect of an extension zip.
 */
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export function zipDir(dir, outZip) {
  rmSync(outZip, { force: true });
  try {
    execFileSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${dir}/*' -DestinationPath '${outZip}' -Force`,
      ],
      { stdio: 'inherit' },
    );
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
    execFileSync('zip', ['-qr', outZip, '.'], { cwd: dir, stdio: 'inherit' });
  }
}
