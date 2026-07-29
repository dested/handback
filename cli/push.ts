// inloop push — upload a recorded gripe folder to the Inloop workspace.
//
//   bun cli/push.ts <gripe-folder> [--server http://localhost:3000] [--token ilp_...]
//
// The folder is what the recorder wrote: report.md + MANIFEST.txt at the root,
// one rec-NN/ per take (recording.json, transcript.txt, frames/, grids/,
// walkthrough.webm). Metadata comes from each rec-NN/recording.json; files
// stream to S3 through presigned PUTs handed out by the declare call.
//
// Token comes from --token or the INLOOP_TOKEN env var.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

type FileEntry = { path: string; size: number; contentType: string; abs: string }

const CONTENT_TYPES: Record<string, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webm: 'video/webm',
}

const UPLOAD_CONCURRENCY = 6

function fail(message: string): never {
  console.error(`inloop push: ${message}`)
  process.exit(1)
}

function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

function walk(dir: string, rel = ''): FileEntry[] {
  const out: FileEntry[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const relPath = rel ? `${rel}/${name}` : name
    const st = statSync(abs)
    if (st.isDirectory()) out.push(...walk(abs, relPath))
    else out.push({ path: relPath, size: st.size, contentType: contentTypeFor(name), abs })
  }
  return out
}

const args = process.argv.slice(2)
const folder = args.find((a) => !a.startsWith('--'))
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

if (!folder) fail('usage: bun cli/push.ts <gripe-folder> [--server url] [--token ilp_...]')
const server = (flag('server') ?? process.env.INLOOP_SERVER ?? 'http://localhost:3000').replace(
  /\/+$/,
  ''
)
const token = flag('token') ?? process.env.INLOOP_TOKEN
if (!token) fail('no API token — pass --token or set INLOOP_TOKEN')

const files = walk(folder)
if (files.length === 0) fail(`${folder} is empty`)
if (!files.some((f) => f.path === 'report.md')) {
  fail(`${folder} has no report.md — is this a gripe folder?`)
}

// Every rec-NN/recording.json describes one take plus (redundantly) the session.
const recJsons = files
  .filter((f) => /^rec-\d{2,3}\/recording\.json$/.test(f.path))
  .sort((a, b) => a.path.localeCompare(b.path))
if (recJsons.length === 0) fail('no rec-NN/recording.json found')

type RecJson = {
  session: { name: string; slug: string; createdAt: string; origin?: string }
  recording: {
    part: number
    dir: string
    interrupted: boolean
    startedAt: string
    durationMs: number
    transcriber?: string
    video?: string
    frames: unknown[]
    events: unknown[]
  }
}

const parsed: RecJson[] = recJsons.map((f) => JSON.parse(readFileSync(f.abs, 'utf8')))
const session = parsed[0].session

const takes = parsed.map(({ recording: r }) => ({
  index: r.part,
  dir: r.dir,
  interrupted: Boolean(r.interrupted),
  startedAt: r.startedAt,
  durationMs: r.durationMs,
  frameCount: r.frames.length,
  transcriber: r.transcriber,
  videoPath: r.video ? `${r.dir}/${r.video}` : undefined,
}))

const declare = {
  slug: session.slug || basename(folder),
  title: session.name || basename(folder),
  origin: session.origin || undefined,
  recordedAt: session.createdAt,
  durationMs: takes.reduce((sum, t) => sum + t.durationMs, 0),
  frameCount: takes.reduce((sum, t) => sum + t.frameCount, 0),
  eventCount: parsed.reduce((sum, p) => sum + p.recording.events.length, 0),
  takes,
  files: files.map(({ path, size, contentType }) => ({ path, size, contentType })),
}

const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
console.log(
  `pushing ${declare.slug} — ${takes.length} take(s), ${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB → ${server}`
)

const declareRes = await fetch(`${server}/api/ingest/gripes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(declare),
})
if (!declareRes.ok) fail(`declare failed (${declareRes.status}): ${await declareRes.text()}`)
const { gripeId, uploads } = (await declareRes.json()) as {
  gripeId: string
  uploads: { path: string; url: string; contentType: string }[]
}

const byPath = new Map(files.map((f) => [f.path, f]))
let done = 0
const queue = [...uploads]
async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const file = byPath.get(job.path)
    if (!file) fail(`server asked for unknown file ${job.path}`)
    const res = await fetch(job.url, {
      method: 'PUT',
      headers: { 'content-type': job.contentType },
      body: new Uint8Array(readFileSync(file.abs)),
    })
    if (!res.ok) fail(`upload of ${job.path} failed (${res.status}): ${await res.text()}`)
    done++
    if (done % 25 === 0 || done === uploads.length) {
      console.log(`  uploaded ${done}/${uploads.length}`)
    }
  }
}
await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker))

const finalizeRes = await fetch(`${server}/api/ingest/gripes/${gripeId}/finalize`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
})
if (!finalizeRes.ok) fail(`finalize failed (${finalizeRes.status}): ${await finalizeRes.text()}`)

console.log(`done — ${server}/gripes/${gripeId}`)
