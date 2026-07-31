// A cleanup pass over a machine transcript.
//
// Whisper hears audio, not software. It writes "cores" for CORS, "reax" for
// React, "goober" for Gubernator, and it punctuates everything as one breathless
// sentence. The words are usually there; the shape isn't. This pass hands the
// lines to Claude Haiku together with what the page itself was saying at the
// time — its URL, its console errors — and asks for the same lines back, spelled
// and punctuated the way the speaker meant them.
//
// Three rules make this safe to run unattended:
//
//   1. Timings are never sent for editing and never come back. The model edits
//      text keyed by line index; `t` and `d` are the recorder's, untouched.
//   2. A line the model doesn't return is kept verbatim. Silence means "fine".
//   3. Every failure — no key, bad JSON, a refusal, a timeout — returns null,
//      and the caller keeps the original transcript. A cleanup pass must never
//      be able to lose someone's narration.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { env } from './env'
import { log } from './logger'

// Haiku, not Opus, and deliberately: this is spelling and punctuation against a
// glossary the prompt already contains. It runs on every take, so latency and
// cost per minute of narration matter more here than reasoning depth.
const MODEL = 'claude-haiku-4-5'

/** Lines per request. Keeps one bad chunk from spoiling a long walkthrough. */
const CHUNK_LINES = 250
const MAX_LINES = 4000
const MAX_ERRORS = 20
const MAX_ERROR_CHARS = 200
const REQUEST_TIMEOUT_MS = 60_000

export interface PolishLine {
  text: string
}

export interface PolishContext {
  /** Where the recording happened — the strongest hint about product nouns. */
  origin?: string
  /** Page title, when the recorder captured one. */
  title?: string
  /** Console/network complaints from the recorded tab, newest first. */
  errors?: string[]
}

const editSchema = z.object({
  i: z.number().int(),
  text: z.string(),
})

const editsSchema = z.array(editSchema)

export function polishConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY)
}

const SYSTEM = `You clean up automatic speech-to-text of a developer narrating a screen recording of their own product.

You are given numbered transcript lines and, when available, the page the recording was made on and the errors its console logged. Use that context to recover technical nouns the speech engine could not have known: product names, component names, identifiers, error strings, library names.

Fix, per line:
- misheard technical terms, product names, and identifiers
- capitalisation of proper nouns and acronyms (CORS, API, S3, useEffect)
- sentence punctuation and casing
- obvious speech-to-text mangling of ordinary words
- filler and stumbles: "um", "uh", "you know", and immediate self-repetition

Never:
- add information, opinions, or words the speaker did not say
- merge, split, reorder, or delete lines
- translate; keep the speaker's language
- rewrite phrasing that is merely informal — this is a transcript of a person talking, not prose. Leave "so yeah, that's broken" alone apart from punctuation.

Return a JSON array of {"i": <line number>, "text": "<corrected line>"} containing ONLY the lines you changed. A line you would return unchanged must be omitted. Return [] when nothing needs correcting. Output the JSON array and nothing else.`

function contextBlock(context: PolishContext): string {
  const parts: string[] = []
  if (context.origin) parts.push(`Recorded on: ${context.origin}`)
  if (context.title) parts.push(`Page title: ${context.title}`)
  const errors = (context.errors ?? [])
    .map((e) => e.trim().slice(0, MAX_ERROR_CHARS))
    .filter((e) => e.length > 0)
    .slice(0, MAX_ERRORS)
  if (errors.length > 0) {
    parts.push(`The page logged these while recording:\n${errors.map((e) => `- ${e}`).join('\n')}`)
  }
  return parts.length > 0 ? `${parts.join('\n')}\n\n` : ''
}

/**
 * A corrected line is still recognisably the same line. This catches the two
 * ways a language model can go wrong here — answering the transcript instead of
 * cleaning it, or padding a line into a paragraph — without needing to judge
 * the wording.
 */
function plausible(original: string, corrected: string): boolean {
  const trimmed = corrected.trim()
  if (trimmed.length === 0) return false
  return trimmed.length <= original.length * 2 + 40
}

async function polishChunk(
  client: Anthropic,
  lines: PolishLine[],
  offset: number,
  context: PolishContext
): Promise<Map<number, string>> {
  const numbered = lines.map((l, i) => `${offset + i + 1}\t${l.text}`).join('\n')
  const message = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [
        { role: 'user', content: `${contextBlock(context)}Transcript lines:\n${numbered}` },
        // Prefilled so the reply is a JSON array from its first token — no
        // preamble to strip, no "Here are the corrections:" to parse around.
        { role: 'assistant', content: '[' },
      ],
    },
    { timeout: REQUEST_TIMEOUT_MS }
  )

  const body = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
  const parsed = editsSchema.safeParse(JSON.parse(`[${body.replace(/]\s*$/, '')}]`))
  if (!parsed.success) throw new Error('model returned unparseable edits')

  const edits = new Map<number, string>()
  for (const edit of parsed.data) {
    const index = edit.i - 1
    const original = lines[index - offset]
    if (!original) continue
    if (!plausible(original.text, edit.text)) continue
    edits.set(index, edit.text.trim())
  }
  return edits
}

/**
 * Returns the cleaned text for every line, in order, or null if the pass
 * couldn't run. Same length as the input, always.
 */
export async function polishTranscript(
  lines: PolishLine[],
  context: PolishContext
): Promise<string[] | null> {
  if (!env.ANTHROPIC_API_KEY) return null
  if (lines.length === 0 || lines.length > MAX_LINES) return null

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const out = lines.map((l) => l.text)
  let changed = 0
  let failedChunks = 0

  for (let start = 0; start < lines.length; start += CHUNK_LINES) {
    const chunk = lines.slice(start, start + CHUNK_LINES)
    try {
      const edits = await polishChunk(client, chunk, start, context)
      for (const [index, text] of edits) {
        out[index] = text
        changed++
      }
    } catch (err) {
      // One bad chunk leaves its own lines as they were; the rest still clean up.
      failedChunks++
      log.warn(`[polish] chunk at line ${start} failed: ${String(err)}`)
    }
  }

  if (failedChunks > 0 && changed === 0) return null
  log.info(`[polish] cleaned ${changed}/${lines.length} lines`)
  return out
}
