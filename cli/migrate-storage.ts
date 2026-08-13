// One-shot bucket copy: move every object from a SOURCE S3/R2 bucket to a DEST
// one. This is the S3 → Cloudflare R2 cutover tool.
//
//   SRC_BUCKET=handback-files SRC_KEY=… SRC_SECRET=… \
//   DEST_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
//   DEST_BUCKET=handback-files DEST_KEY=… DEST_SECRET=… \
//   bun cli/migrate-storage.ts [--dry-run]
//
// Env (each side takes SRC_* / DEST_*):
//   *_BUCKET   (required)  bucket name
//   *_KEY      (required)  access key id
//   *_SECRET   (required)  secret access key
//   *_ENDPOINT (optional)  S3-compatible endpoint; set for R2. Unset = plain AWS
//   *_REGION   (optional)  defaults to `auto` when *_ENDPOINT is set, else us-west-2
//
// Idempotent: a key whose destination object already matches the source size is
// skipped, so a crashed run just re-runs. `--dry-run` lists keys + sizes and
// copies nothing.
//
// ⚠️ MEMORY: every object is buffered fully into RAM before the PutObject — a
// streamed S3 `Body` handed straight to PutObjectCommand hangs forever under Bun
// (documented gotcha), so buffering is not optional. Fine at the current ~3.5 GB
// total because objects go one at a time; peak usage is the single LARGEST
// object, not the whole bucket. Revisit if a single walkthrough ever approaches
// available memory.

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

const dryRun = process.argv.includes('--dry-run')

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`✗ ${name} is required`)
    process.exit(1)
  }
  return v
}

/** Build one client + bucket from a SRC_ / DEST_ env prefix. */
function side(prefix: 'SRC' | 'DEST'): { client: S3Client; bucket: string } {
  const bucket = required(`${prefix}_BUCKET`)
  const endpoint = process.env[`${prefix}_ENDPOINT`]
  const region = process.env[`${prefix}_REGION`] ?? (endpoint ? 'auto' : 'us-west-2')
  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: required(`${prefix}_KEY`),
      secretAccessKey: required(`${prefix}_SECRET`),
    },
  })
  return { client, bucket }
}

const src = side('SRC')
const dest = side('DEST')

const fmtMb = (bytes: number): string => `${(bytes / 1048576).toFixed(2)} MB`

/** The destination already holds this key at the same size — nothing to do. */
async function destMatches(key: string, size: number): Promise<boolean> {
  try {
    const head = await dest.client.send(
      new HeadObjectCommand({ Bucket: dest.bucket, Key: key })
    )
    return Number(head.ContentLength ?? -1) === size
  } catch {
    return false
  }
}

async function copyOne(key: string, size: number): Promise<'copied' | 'skipped'> {
  if (await destMatches(key, size)) return 'skipped'

  const obj = await src.client.send(new GetObjectCommand({ Bucket: src.bucket, Key: key }))
  if (!obj.Body) throw new Error(`empty Body for ${key}`)
  // Buffer fully — a streamed Body into PutObjectCommand hangs under Bun.
  const bytes = await obj.Body.transformToByteArray()

  await dest.client.send(
    new PutObjectCommand({
      Bucket: dest.bucket,
      Key: key,
      Body: bytes,
      ContentLength: bytes.byteLength,
      ...(obj.ContentType ? { ContentType: obj.ContentType } : {}),
    })
  )
  return 'copied'
}

async function main(): Promise<void> {
  console.log(
    `${dryRun ? '[dry-run] ' : ''}${src.bucket} → ${dest.bucket}` +
      `${process.env.DEST_ENDPOINT ? ` (${process.env.DEST_ENDPOINT})` : ''}`
  )

  let copied = 0
  let skipped = 0
  let objects = 0
  let bytesCopied = 0
  let token: string | undefined

  do {
    const page = await src.client.send(
      new ListObjectsV2Command({ Bucket: src.bucket, ContinuationToken: token })
    )
    for (const o of page.Contents ?? []) {
      if (!o.Key) continue
      const size = Number(o.Size ?? 0)
      objects += 1
      if (dryRun) {
        console.log(`  ${o.Key}  ${fmtMb(size)}`)
        continue
      }
      const result = await copyOne(o.Key, size)
      if (result === 'copied') {
        copied += 1
        bytesCopied += size
        console.log(`  copied  ${o.Key}  ${fmtMb(size)}`)
      } else {
        skipped += 1
        console.log(`  skip    ${o.Key}  (already on dest)`)
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  if (dryRun) {
    console.log(`\n[dry-run] ${objects} objects would be considered.`)
  } else {
    console.log(
      `\ndone — ${objects} objects: ${copied} copied (${fmtMb(bytesCopied)}), ${skipped} skipped.`
    )
  }
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
