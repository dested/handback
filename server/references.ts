// "You mentioned a file — attach it?"
//
// People narrate against artifacts the recording can't carry: "the pricing
// spreadsheet Randy sent", "our settings.json", "the spec doc". The walkthrough
// ships without them, the agent works without them, and nobody notices the gap
// until the answer comes back wrong. This pass reads the finalized report and
// writes one WalkthroughFileSuggestion row per concrete artifact the speaker
// referenced — the viewer turns those into attach nudges, and the brief tells
// the agent when one was mentioned but never attached.
//
// Same safety posture as the cleanup pass (server/polish.ts): Haiku, one cheap
// call, and every failure — no key, bad JSON, a refusal, a timeout — degrades
// to writing nothing. A walkthrough with no suggestions is a walkthrough, not
// an error. Fired fire-and-forget from ingest FINALIZE on the null→set
// transition, agent kind only.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { spaceId } from './access'
import { env } from './env'
import { log } from './logger'
import { prisma } from './prisma'
import { getObjectText, walkthroughKey } from './storage'

const MODEL = 'claude-haiku-4-5'
const REQUEST_TIMEOUT_MS = 60_000
// A nudge list longer than this is nagging, not helping.
const MAX_SUGGESTIONS = 6
// Reports carry contact-sheet listings and frame tables the model doesn't
// need; the narration lives well inside this window.
const MAX_REPORT_CHARS = 60_000

const suggestionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  quote: z.string().trim().max(300).optional(),
  /** "m:ss" on the report's single timeline, when the model can place it. */
  at: z
    .string()
    .regex(/^\d{1,3}:\d{2}$/)
    .optional(),
})

const suggestionsSchema = z.array(suggestionSchema)

const SYSTEM = `You read the report of a narrated screen recording ("walkthrough") that a person recorded for a coding agent. Your one job: find moments where the speaker refers to a concrete digital artifact that exists OUTSIDE the recording and that the agent would want as a file.

Count as an artifact: a document, spreadsheet, PDF, CSV, log file, config file, design/Figma file, email attachment, exported data, a specific screenshot they said they'd send, or an explicitly named file ("settings.json", "the Q3 numbers sheet", "the spec doc Randy sent me").

Do NOT count: the app being recorded, code "in the repo", pages/screens/buttons on screen, the recording or its own frames/transcript, vague plurals ("the docs", "our files") with no specific artifact, or anything the agent can already see in this report.

Return a JSON array (max ${MAX_SUGGESTIONS} items, deduplicated) of:
{"label": "<what the speaker called it, short>", "quote": "<the sentence that mentioned it, verbatim or lightly trimmed>", "at": "<m:ss timestamp of that line, only if one is printed beside it>"}

Return [] when nothing qualifies — most walkthroughs mention no outside files, and an empty array is the expected answer. Output the JSON array and nothing else.`

const parseAt = (at: string | undefined): number | null => {
  if (!at) return null
  const [m, s] = at.split(':')
  return (Number(m) * 60 + Number(s)) * 1000
}

export function referencesConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY)
}

/**
 * Read the walkthrough's report and write its file suggestions. Never throws;
 * failure means no rows, and the walkthrough reads exactly as it did before
 * this pass existed. Replaces any prior suggestions wholesale (a re-run is a
 * re-read of the same report, not an append).
 */
export async function detectReferencedFiles(walkthroughId: string): Promise<void> {
  try {
    if (!env.ANTHROPIC_API_KEY) return
    const walkthrough = await prisma.walkthrough.findUnique({
      where: { id: walkthroughId },
      select: { id: true, kind: true, teamId: true, userId: true, title: true },
    })
    if (!walkthrough || walkthrough.kind !== 'agent') return
    const space = spaceId({ teamId: walkthrough.teamId, userId: walkthrough.userId })
    const reportMd = await getObjectText(walkthroughKey(space, walkthrough.id, 'report.md')).catch(
      () => null
    )
    if (!reportMd) return

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    const message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Walkthrough title: ${walkthrough.title}\n\n${reportMd.slice(0, MAX_REPORT_CHARS)}`,
          },
          // Prefilled so the reply is a JSON array from its first token.
          { role: 'assistant', content: '[' },
        ],
      },
      { timeout: REQUEST_TIMEOUT_MS }
    )
    const body = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
    const parsed = suggestionsSchema.safeParse(JSON.parse(`[${body.replace(/]\s*$/, '')}]`))
    if (!parsed.success) {
      log.warn(`[references] unparseable suggestions for ${walkthroughId}`)
      return
    }

    // Dedupe by label, case-blind — the model occasionally names one artifact
    // twice across two mentions.
    const seen = new Set<string>()
    const rows = parsed.data
      .filter((s) => {
        const key = s.label.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, MAX_SUGGESTIONS)

    await prisma.walkthroughFileSuggestion.deleteMany({ where: { walkthroughId } })
    if (rows.length > 0) {
      await prisma.walkthroughFileSuggestion.createMany({
        data: rows.map((s) => ({
          walkthroughId,
          label: s.label,
          quote: s.quote ?? null,
          atMs: parseAt(s.at),
        })),
      })
    }
    log.info(`[references] ${rows.length} file suggestion(s) for walkthrough ${walkthroughId}`)
  } catch (err) {
    log.warn(`[references] detection failed for ${walkthroughId}: ${String(err)}`)
  }
}
