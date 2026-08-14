// The doorbell: mail the team when a walkthrough lands. Called fire-and-forget
// from ingest's finalize (only on the null→set transition, so a retried
// finalize or a re-push replacement doesn't re-mail).
//
// Team spaces only — a personal-space upload is always the owner's own token
// talking, and nobody needs mail about what they just did. Recipients are the
// team's other members who are verified (an unverified address is as likely a
// typo as a person) and haven't muted uploads (`User.notifyUploads`, flipped
// off by the one-click unsubscribe link in the mail's footer).

import { createHmac, timingSafeEqual } from 'node:crypto'
import { sendEmail, walkthroughUploadedEmail } from './email'
import { env } from './env'
import { log } from './logger'
import { prisma } from './prisma'

/** Which recurring email a mute link speaks for. */
export type NotifyKind = 'uploads' | 'digest'

export const NOTIFY_KINDS: readonly NotifyKind[] = ['uploads', 'digest']

/**
 * The unsubscribe link's whole credential: an HMAC of the user id + the email
 * kind, keyed off BETTER_AUTH_SECRET. Not guessable, not a session, survives
 * sign-out, and a leaked digest link can't mute upload mail — exactly what a
 * link in an email needs.
 */
export function unsubscribeSig(userId: string, kind: NotifyKind): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(`notify:${userId}:${kind}`)
    .digest('hex')
}

export function verifyUnsubscribeSig(userId: string, kind: NotifyKind, sig: string): boolean {
  const expected = Buffer.from(unsubscribeSig(userId, kind))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export function unsubscribeUrl(userId: string, kind: NotifyKind): string {
  return `${env.BETTER_AUTH_URL}/api/notifications/unsubscribe?u=${encodeURIComponent(userId)}&kind=${kind}&sig=${unsubscribeSig(userId, kind)}`
}

/** Never throws — an unsendable email is a support problem, not a 500. */
export async function notifyUpload(walkthroughId: string): Promise<void> {
  try {
    const walkthrough = await prisma.walkthrough.findUnique({
      where: { id: walkthroughId },
      select: {
        id: true,
        title: true,
        kind: true,
        durationMs: true,
        uploadedById: true,
        uploadedBy: { select: { name: true } },
        team: {
          select: {
            name: true,
            memberships: {
              select: {
                user: {
                  select: { id: true, email: true, emailVerified: true, notifyUploads: true },
                },
              },
            },
          },
        },
      },
    })
    if (!walkthrough?.team) return
    const team = walkthrough.team

    const recipients = team.memberships
      .map((m) => m.user)
      .filter((u) => u.id !== walkthrough.uploadedById && u.emailVerified && u.notifyUploads)
    if (recipients.length === 0) return

    const message = (userId: string) =>
      walkthroughUploadedEmail({
        uploader: walkthrough.uploadedBy?.name ?? 'Someone',
        team: team.name,
        title: walkthrough.title,
        kind: walkthrough.kind,
        durationMs: walkthrough.durationMs,
        url: `${env.BETTER_AUTH_URL}/walkthroughs/${walkthrough.id}`,
        unsubscribeUrl: unsubscribeUrl(userId, 'uploads'),
      })

    // Sequential on purpose: seat limits keep teams small, and Resend's rate
    // limit prefers a trickle over a burst.
    for (const user of recipients) {
      await sendEmail({ to: user.email, ...message(user.id) })
    }
  } catch (err) {
    log.warn(`[notify] upload notification failed for ${walkthroughId}: ${String(err)}`)
  }
}
