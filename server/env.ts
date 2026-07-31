import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 chars'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3995'),
  AWS_REGION: z.string().default('us-west-2'),
  S3_BUCKET: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  // Optional on purpose: without it /api/ingest/transcribe answers 503 and the
  // recorder falls back to its on-device Whisper pass. A dev without a Groq key
  // gets the slow path, not a boot crash.
  GROQ_API_KEY: z.string().min(1).optional(),
  // Same rule for email: unset means transactional mail is logged instead of
  // sent, so a dev can click a reset link out of their terminal.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).default('Handback <noreply@handback.dev>'),
  // Powers the transcript cleanup pass. Unset = raw transcript, which is what
  // shipped before the pass existed.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
})

export const env = schema.parse(process.env)
