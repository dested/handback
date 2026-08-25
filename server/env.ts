import { z } from 'zod'

// An optional secret that treats an empty value (`KEY=` in .env) as unset, so a
// blank line never crashes boot — it just disables the feature.
const optionalSecret = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional())

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 chars'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3995'),
  AWS_REGION: z.string().default('us-west-2'),
  S3_BUCKET: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  // Point the S3 client at a non-AWS S3-compatible endpoint. Unset = plain AWS
  // S3 (the current behavior). R2: set S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
  // and put the R2 keypair in AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
  S3_ENDPOINT: z.string().url().optional(),
  // Optional on purpose: without it /api/ingest/transcribe answers 503 and the
  // recorder falls back to its on-device Whisper pass. A dev without a Groq key
  // gets the slow path, not a boot crash.
  GROQ_API_KEY: z.string().min(1).optional(),
  // Preferred over Groq when set: nova-3 with diarization, so segments carry
  // speaker numbers. Unset = Groq (or on-device) exactly as before.
  DEEPGRAM_API_KEY: z.string().min(1).optional(),
  // Same rule for email: unset means transactional mail is logged instead of
  // sent, so a dev can click a reset link out of their terminal.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).default('Handback <noreply@handback.dev>'),
  // Powers the transcript cleanup pass. Unset = raw transcript, which is what
  // shipped before the pass existed.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Comma-separated emails that are platform admins even without the DB flag —
  // the bootstrap path for prod, where there's no shell to run cli/make-admin.
  ADMIN_EMAILS: z.string().default(''),
  // Stripe billing. All optional: unset means billing is off — /upgrade falls
  // back to the "write us" card, checkout/portal refuse cleanly, and the webhook
  // route 503s. A dev without keys boots exactly as before.
  //  - STRIPE_SECRET_KEY      sk_… — the API credential (test or live)
  //  - STRIPE_WEBHOOK_SECRET  whsec_… — signs the webhook; without it the webhook
  //                           route refuses (billing.sync is the local fallback)
  //  - STRIPE_PRICE_PRO/BIZ   price_… — the recurring prices checkout sells;
  //                           create them with `bun cli/stripe-setup.ts`
  STRIPE_SECRET_KEY: optionalSecret,
  STRIPE_WEBHOOK_SECRET: optionalSecret,
  STRIPE_PRICE_PRO: optionalSecret,
  STRIPE_PRICE_BIZ: optionalSecret,
})

export const env = schema.parse(process.env)
