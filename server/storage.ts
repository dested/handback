// S3 storage for walkthrough payloads. The DB never holds file bytes — every object
// lives under orgs/<spaceId>/gripes/<walkthroughId>/<path>, where <path> mirrors the
// walkthrough folder the recorder wrote (report.md, rec-01/frames/03-0125.jpg, …).
// `spaceId` is the team id or, for a personal walkthrough, the owner's user id.
// The server only ever hands out short-lived presigned URLs; the bucket blocks
// all public access.

import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from './env'

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})

const PUT_TTL_SECONDS = 60 * 60 // uploads of a long webm on slow links need room
const GET_TTL_SECONDS = 60 * 60

// The `orgs/` and `gripes/` segments are frozen at the old product nouns: every
// object already uploaded lives under them, and changing the path would orphan
// every one of them. `spaceId` is the team id, or the owner's user id for a
// personal walkthrough.
/** Everything a space has ever stored — the unit admin deletes wipe. */
export function spacePrefix(spaceId: string): string {
  return `orgs/${spaceId}/`
}

export function walkthroughPrefix(spaceId: string, walkthroughId: string): string {
  return `${spacePrefix(spaceId)}gripes/${walkthroughId}/`
}

export function walkthroughKey(spaceId: string, walkthroughId: string, path: string): string {
  return walkthroughPrefix(spaceId, walkthroughId) + path
}

/**
 * Walkthrough-relative paths come from clients; keep them boring. Rejects anything
 * that could escape the prefix or smuggle a second key.
 */
export function isSafePath(path: string): boolean {
  if (path.length === 0 || path.length > 512) return false
  if (path.includes('\\') || path.includes('//') || path.startsWith('/')) return false
  if (path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false
  return /^[\w][\w.\- /()]*$/.test(path)
}

/**
 * A presigned PUT for exactly one object of exactly `contentLength` bytes.
 *
 * Signing the length is what makes the declared size binding: it lands in
 * SignedHeaders, so S3 itself rejects an upload whose `Content-Length` differs.
 * Without it a caller could declare a 1 KB frame and push a 5 GB file — the
 * quota accounting would say one thing and the bucket another.
 */
export async function presignPut(
  key: string,
  contentType: string,
  contentLength: number
): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn: PUT_TTL_SECONDS }
  )
}

export async function presignGet(key: string, opts?: { downloadAs?: string }): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      // Signed into the URL, so following the link saves a named file instead
      // of playing in a tab — the Download button on a shared video needs it
      // (the `download` attribute is ignored cross-origin).
      ...(opts?.downloadAs
        ? { ResponseContentDisposition: `attachment; filename="${opts.downloadAs}"` }
        : {}),
    }),
    { expiresIn: GET_TTL_SECONDS }
  )
}

/**
 * Server-side copy of one object — the move of a walkthrough between spaces
 * never pulls the bytes through the container. CopySource is a URL path, so
 * each segment is encoded; the slashes have to survive.
 */
export async function copyObject(srcKey: string, dstKey: string): Promise<void> {
  await s3.send(
    new CopyObjectCommand({
      Bucket: env.S3_BUCKET,
      CopySource: `${env.S3_BUCKET}/${srcKey.split('/').map(encodeURIComponent).join('/')}`,
      Key: dstKey,
    })
  )
}

/** Read a small object (recording.json, report.md) straight into a string. */
export async function getObjectText(key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
  return (await res.Body?.transformToString()) ?? ''
}

/** Every object under a prefix, paged through. Keys only — never the bodies. */
export async function listPrefix(prefix: string): Promise<Array<{ key: string; size: number }>> {
  const out: Array<{ key: string; size: number }> = []
  let token: string | undefined
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix, ContinuationToken: token })
    )
    for (const o of page.Contents ?? []) {
      if (o.Key) out.push({ key: o.Key, size: Number(o.Size ?? 0) })
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return out
}

/** Delete everything under a prefix (re-push of a walkthrough, walkthrough deletion). */
export async function deletePrefix(prefix: string): Promise<void> {
  let token: string | undefined
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix, ContinuationToken: token })
    )
    const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []))
    if (keys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: keys, Quiet: true } })
      )
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
}
