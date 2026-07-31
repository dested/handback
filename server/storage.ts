// S3 storage for gripe payloads. The DB never holds file bytes — every object
// lives under orgs/<orgId>/gripes/<gripeId>/<path>, where <path> mirrors the
// gripe folder the recorder wrote (report.md, rec-01/frames/03-0125.jpg, …).
// The server only ever hands out short-lived presigned URLs; the bucket blocks
// all public access.

import {
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

export function gripePrefix(orgId: string, gripeId: string): string {
  return `orgs/${orgId}/gripes/${gripeId}/`
}

export function gripeKey(orgId: string, gripeId: string, path: string): string {
  return gripePrefix(orgId, gripeId) + path
}

/**
 * Gripe-relative paths come from clients; keep them boring. Rejects anything
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

export async function presignGet(key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
    expiresIn: GET_TTL_SECONDS,
  })
}

/** Read a small object (recording.json, report.md) straight into a string. */
export async function getObjectText(key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
  return (await res.Body?.transformToString()) ?? ''
}

/** Delete everything under a prefix (re-push of a gripe, gripe deletion). */
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
