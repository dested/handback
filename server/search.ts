// Full-text search over what was said and reported. `Walkthrough.searchText`
// is filled once at finalize — report.md for agent kind (it already contains
// the transcript, the events and the title), transcript.json for human kind —
// and queried with a query-time to_tsvector. No GIN index on purpose: at
// hundreds of rows a scan is nothing, and the expression index is a raw-SQL
// migration to write the day the row counts earn it.

import { Prisma } from '@prisma/client'
import { log } from './logger'
import { prisma } from './prisma'
import { spaceId } from './access'
import { getObjectText, walkthroughKey } from './storage'

// Postgres tsvectors cap at ~1 MB and nobody searches hour-three of a
// transcript; 50 KB of text is a long recording's worth of words.
const MAX_CORPUS_CHARS = 50_000

/** transcript.json is `[{ tMs, endMs, text }]` (lib/edit/transcript.ts). */
function transcriptToText(json: string): string {
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed)) return ''
  return parsed
    .map((line: unknown) =>
      line !== null && typeof line === 'object' && 'text' in line && typeof line.text === 'string'
        ? line.text
        : ''
    )
    .filter(Boolean)
    .join(' ')
}

/** Presigned URLs inside report.md are noise that would match every query. */
function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, ' ')
}

/**
 * Fill `searchText` for one walkthrough. Fire-and-forget from finalize and
 * finalizeEdit — indexing must never fail or slow an upload; a walkthrough
 * that misses its pass simply matches on title only.
 */
export async function indexWalkthrough(walkthroughId: string): Promise<void> {
  try {
    const walkthrough = await prisma.walkthrough.findUnique({
      where: { id: walkthroughId },
      select: { id: true, kind: true, teamId: true, userId: true },
    })
    if (!walkthrough) return
    const space = spaceId({ teamId: walkthrough.teamId, userId: walkthrough.userId })
    const path = walkthrough.kind === 'human' ? 'transcript.json' : 'report.md'
    const raw = await getObjectText(walkthroughKey(space, walkthrough.id, path)).catch(() => null)
    if (raw === null) return
    const corpus = (walkthrough.kind === 'human' ? transcriptToText(raw) : stripUrls(raw))
      .replace(/\s+/g, ' ')
      .slice(0, MAX_CORPUS_CHARS)
      .trim()
    if (!corpus) return
    await prisma.walkthrough.update({
      where: { id: walkthrough.id },
      data: { searchText: corpus },
    })
  } catch (err) {
    log.warn(`[search] indexing failed for ${walkthroughId}: ${String(err)}`)
  }
}

/**
 * Ids of finalized walkthroughs in the caller's reach whose title or corpus
 * matches the query. `websearch_to_tsquery` takes plain human input ("promo
 * code checkout", quoted phrases, -exclusions) and never throws on syntax.
 */
export async function searchWalkthroughIds(
  userId: string,
  teamIds: string[],
  query: string
): Promise<string[]> {
  const reach =
    teamIds.length > 0
      ? Prisma.sql`(("team_id" IS NULL AND "user_id" = ${userId}) OR "team_id" IN (${Prisma.join(teamIds)}))`
      : Prisma.sql`("team_id" IS NULL AND "user_id" = ${userId})`
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "walkthrough"
    WHERE ${reach}
      AND "finalized_at" IS NOT NULL
      AND to_tsvector('english', coalesce("title", '') || ' ' || coalesce("search_text", ''))
          @@ websearch_to_tsquery('english', ${query})
    LIMIT 100`
  return rows.map((r) => r.id)
}
