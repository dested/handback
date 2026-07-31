// Publish the recorder build the site hands out.
//
//   cd extension && npm run build
//   pwsh -Command "Compress-Archive -Path extension/dist/* -DestinationPath extension/handback-recorder.zip -Force"
//   bun cli/publish-recorder.ts
//
// Uploads extension/handback-recorder.zip to releases/recorder/, which is the
// prefix `/recorder` serves from. There is no "current version" constant
// anywhere: the newest zip under that prefix IS the release, so publishing is
// this one upload.
//
// Zipping stays a separate step on purpose — Bun has no zip writer, Git Bash's
// GNU tar can't make one, and spawning Compress-Archive from bun hangs. What
// this script does instead is refuse to upload a zip that doesn't match the
// build sitting in dist/, which is the mistake actually worth catching.

import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { env } from '../server/env'

const root = resolve(import.meta.dir, '..')
const manifestPath = resolve(root, 'extension/dist/manifest.json')
const zipPath = resolve(root, 'extension/handback-recorder.zip')

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

async function readVersion(path: string, label: string): Promise<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch (err: unknown) {
    fail(`could not read ${label} at ${path}: ${String(err)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
    fail(`${label} has no version field`)
  }
  const version = parsed.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`${label} version ${JSON.stringify(version)} isn't x.y.z`)
  }
  return version
}

// package.json is what a human bumps; dist/manifest.json is what Chrome installs.
// They drift exactly when someone forgets to rebuild, so check both.
const declared = await readVersion(resolve(root, 'extension/package.json'), 'extension/package.json')
const built = await readVersion(manifestPath, 'extension/dist/manifest.json')
if (declared !== built) {
  fail(`dist is ${built} but package.json says ${declared} — run \`cd extension && npm run build\``)
}

const zipStat = await stat(zipPath).catch(() => null)
if (!zipStat) fail(`${zipPath} missing — zip extension/dist first (see the header of this file)`)
const manifestStat = await stat(manifestPath)
if (zipStat.mtimeMs < manifestStat.mtimeMs) {
  fail(`${zipPath} is older than the build in dist/ — re-zip before publishing ${built}`)
}

const key = `releases/recorder/handback-recorder-${built}.zip`
console.log(`uploading ${(zipStat.size / 1048576).toFixed(1)} MB → ${key}`)

// Buffered, not a read stream: a streamed Body hangs indefinitely under Bun,
// and a release zip is single-digit megabytes.
const body = await readFile(zipPath)

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})
await s3.send(
  new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    Body: body,
    ContentLength: zipStat.size,
    ContentType: 'application/zip',
  })
)

console.log(`✓ published ${key} (${(zipStat.size / 1048576).toFixed(1)} MB)`)
console.log('  /recorder serves it within a minute — the release lookup caches for 60s.')
