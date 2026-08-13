import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from './prisma'
import { env } from './env'
import { resetPasswordEmail, sendEmail, verifyEmail } from './email'

// Cookies go out Secure only when we're actually served over HTTPS — otherwise a
// plain-http dev session can never set its cookie and sign-in silently fails.
const secureCookies = env.BETTER_AUTH_URL.startsWith('https')

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Pin the one origin we serve from, rather than trusting better-auth's inferred
  // default — a request whose Origin isn't this is rejected before it touches auth.
  trustedOrigins: [env.BETTER_AUTH_URL],
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
  // out of an account they already created — a worse failure than an unverified
  // address while we're this early. Revisit before opening public sign-up.
  //
  // No sign-up provisioning hook: a personal space is the absence of a team, so
  // a fresh account already has somewhere to land.
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
  advanced: {
    // Force Secure over HTTPS (better-auth only defaults it on in production).
    useSecureCookies: secureCookies,
    // Pin the session cookie's attributes rather than leaning on inferred
    // defaults: Lax survives the top-level nav back from an email link while
    // still blocking cross-site sends, Secure tracks the scheme, and HttpOnly
    // keeps the cookie out of any script.
    defaultCookieAttributes: {
      sameSite: 'lax',
      secure: secureCookies,
      httpOnly: true,
    },
  },
})

export type Session = typeof auth.$Infer.Session
