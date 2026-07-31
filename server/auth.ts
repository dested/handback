import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from './prisma'
import { env } from './env'
import { resetPasswordEmail, sendEmail, verifyEmail } from './email'

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    // Without this a forgotten password is unrecoverable short of editing the
    // database by hand — the single thing that made handing the product to
    // anyone outside arm's reach untenable.
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({ to: user.email, ...resetPasswordEmail(url) })
    },
    resetPasswordTokenExpiresIn: 60 * 60, // one hour, matching what the email says
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({ to: user.email, ...verifyEmail(url) })
    },
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  // Deliberately NOT `requireEmailVerification`. Verification proves the address
  // is real, but gating sign-in on it means a bounced or slow email locks someone
  // out of a workspace they already created — a worse failure than an unverified
  // address while we're this early. Revisit before opening public sign-up.
  rateLimit: {
    // better-auth's own limiter, on by default in production but stated here so
    // the numbers are visible and reviewable. Applies per IP across auth routes;
    // Caddy replaces X-Forwarded-For, so the address it sees can't be spoofed.
    enabled: true,
    window: 60,
    max: 20,
    customRules: {
      // Credential stuffing and sign-up spam are the two that actually cost us.
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60 * 60, max: 5 },
      '/forget-password': { window: 60 * 60, max: 5 },
      '/reset-password': { window: 60 * 60, max: 10 },
    },
  },
})

export type Session = typeof auth.$Infer.Session
