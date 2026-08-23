// Transactional email, over Resend's REST API. No SDK: the whole surface we need
// is one POST, and a dependency-free wrapper keeps the types ours.
//
// Without RESEND_API_KEY nothing is sent — the message is logged instead, so a
// dev can click the reset link out of their terminal and the whole flow works
// offline. That is the same degrade-don't-fail rule the transcription provider
// follows.

import { env } from './env'
import { log } from './logger'

const RESEND_URL = 'https://api.resend.com/emails'

interface Message {
  to: string
  subject: string
  /** Plain text is not a fallback — plenty of people read mail this way. */
  text: string
  html: string
}

export function emailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY)
}

/**
 * Never throws. A failed send must not take down the sign-up or invite that
 * triggered it — the caller has already committed its database work, and an
 * unsendable email is a support problem, not a 500.
 */
export async function sendEmail(message: Message): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    log.warn(`[email] RESEND_API_KEY unset — not sending "${message.subject}" to ${message.to}`)
    log.info(`[email] would have said:\n${message.text}`)
    return false
  }
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      log.warn(`[email] Resend rejected "${message.subject}": ${res.status} ${await res.text()}`)
      return false
    }
    log.info(`[email] sent "${message.subject}" to ${message.to}`)
    return true
  } catch (err) {
    log.warn(`[email] send failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

// ── templates ────────────────────────────────────────────────────────────────
// Light, ink-on-paper, one cobalt accent — the same rules as the app (ui.md).
// Inline styles only: every mail client strips a stylesheet.

const INK = '#25272e'
const MUTED = '#6b6f7a'
const COBALT = '#2f56d8'
const PAPER = '#fbfaf7'

/** Escapes text bound for an HTML template. Org names are user input. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function shell(body: string, footer?: string): string {
  return `<div style="margin:0;padding:32px 16px;background:${PAPER};font-family:'Helvetica Neue',Arial,sans-serif;color:${INK}">
  <div style="max-width:480px;margin:0 auto">
    <div style="font-size:18px;font-weight:600;letter-spacing:-0.01em">Handback</div>
    <div style="height:1px;background:#e6e3dc;margin:16px 0 24px"></div>
    ${body}
    <div style="height:1px;background:#e6e3dc;margin:28px 0 16px"></div>
    <div style="font-size:12px;color:${MUTED};line-height:1.6">
      Handback — agents fix it, humans sign off.<br>
      ${footer ?? 'Not expecting this? You can ignore it; nothing happens until the link is used.'}
    </div>
  </div>
</div>`
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${COBALT};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:6px">${label}</a>`
}

function fallbackLine(href: string): string {
  return `<p style="font-size:13px;color:${MUTED};line-height:1.6;margin:20px 0 0">
      Or paste this into your browser:<br>
      <span style="word-break:break-all;color:${COBALT}">${href}</span>
    </p>`
}

export function resetPasswordEmail(url: string): Omit<Message, 'to'> {
  return {
    subject: 'Reset your Handback password',
    text: `Someone asked to reset the password on your Handback account.\n\nSet a new one here:\n${url}\n\nThe link is good for one hour. If this wasn't you, ignore this email — your password stays as it is.`,
    html: shell(`<p style="font-size:15px;line-height:1.6;margin:0 0 20px">
      Someone asked to reset the password on your Handback account.
    </p>
    ${button(url, 'Set a new password')}
    <p style="font-size:13px;color:${MUTED};line-height:1.6;margin:20px 0 0">
      The link is good for one hour. If this wasn't you, ignore this email — your password stays as it is.
    </p>
    ${fallbackLine(url)}`),
  }
}

export function verifyEmail(url: string): Omit<Message, 'to'> {
  return {
    subject: 'Confirm your email for Handback',
    text: `Confirm this address so we can reach you about your account — password resets, invites, and nothing else.\n\n${url}`,
    html: shell(`<p style="font-size:15px;line-height:1.6;margin:0 0 20px">
      Confirm this address so we can reach you about your account — password resets,
      invites, and nothing else.
    </p>
    ${button(url, 'Confirm my email')}
    ${fallbackLine(url)}`),
  }
}

export function walkthroughUploadedEmail(opts: {
  uploader: string
  team: string
  title: string
  kind: string
  durationMs: number
  url: string
  unsubscribeUrl: string
}): Omit<Message, 'to'> {
  const { uploader, team, title, kind, durationMs, url, unsubscribeUrl } = opts
  const minutes = Math.max(1, Math.round(durationMs / 60000))
  const what =
    kind === 'human'
      ? `a ${minutes}-minute video for a person`
      : `a ${minutes}-minute walkthrough for an agent`
  return {
    subject: `${uploader} added a walkthrough to ${team}: ${title}`,
    text: `${uploader} added ${what} to the ${team} team on Handback.\n\n"${title}"\n\nWatch and triage it here:\n${url}\n\nToo much mail? Stop these: ${unsubscribeUrl}`,
    html: shell(
      `<p style="font-size:15px;line-height:1.6;margin:0 0 8px">
      <strong>${esc(uploader)}</strong> added ${esc(what)} to the <strong>${esc(team)}</strong> team.
    </p>
    <p style="font-size:16px;line-height:1.6;margin:0 0 20px;font-weight:600">${esc(title)}</p>
    ${button(url, 'Watch & triage it')}
    ${fallbackLine(url)}`,
      `Too much mail? <a href="${unsubscribeUrl}" style="color:${MUTED}">Stop these upload emails</a> — one click, no sign-in.`
    ),
  }
}

export function walkthroughResultEmail(opts: {
  title: string
  summary: string
  url: string
  unsubscribeUrl: string
}): Omit<Message, 'to'> {
  const { title, summary, url, unsubscribeUrl } = opts
  return {
    subject: `Your agent answered: ${title}`,
    text: `Your agent posted a result on "${title}".\n\n${summary}\n\nReview and sign off:\n${url}\n\nToo much mail? Stop these: ${unsubscribeUrl}`,
    html: shell(
      `<p style="font-size:15px;line-height:1.6;margin:0 0 8px">
      Your agent posted a result on <strong>${esc(title)}</strong>.
    </p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px">${esc(summary)}</p>
    ${button(url, 'Review & sign off')}
    ${fallbackLine(url)}`,
      `Too much mail? <a href="${unsubscribeUrl}" style="color:${MUTED}">Stop these result emails</a> — one click, no sign-in.`
    ),
  }
}

export function walkthroughQuestionEmail(opts: {
  title: string
  question: string
  url: string
  unsubscribeUrl: string
}): Omit<Message, 'to'> {
  const { title, question, url, unsubscribeUrl } = opts
  return {
    subject: `Your agent has a question about ${title}`,
    text: `Your agent stopped to ask a question about "${title}".\n\n${question}\n\nAnswer it on the walkthrough page:\n${url}\n\nToo much mail? Stop these: ${unsubscribeUrl}`,
    html: shell(
      `<p style="font-size:15px;line-height:1.6;margin:0 0 8px">
      Your agent stopped to ask a question about <strong>${esc(title)}</strong>.
    </p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px">${esc(question)}</p>
    ${button(url, 'Answer it')}
    ${fallbackLine(url)}`,
      `Too much mail? <a href="${unsubscribeUrl}" style="color:${MUTED}">Stop these result emails</a> — one click, no sign-in.`
    ),
  }
}

export function walkthroughHealthEmail(opts: {
  title: string
  notes: string[]
  url: string
  unsubscribeUrl: string
}): Omit<Message, 'to'> {
  const { title, notes, url, unsubscribeUrl } = opts
  const textList = notes.map((n) => `- ${n}`).join('\n')
  const htmlList = notes
    .map(
      (n) =>
        `<li style="font-size:14px;line-height:1.6;margin:0 0 4px">${esc(n)}</li>`
    )
    .join('')
  return {
    subject: `Parts of "${title}" may not have recorded well`,
    text: `Some parts of "${title}" may not have recorded well:\n\n${textList}\n\nCheck and re-record if needed:\n${url}\n\nToo much mail? Stop these: ${unsubscribeUrl}`,
    html: shell(
      `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">
      Some parts of <strong>${esc(title)}</strong> may not have recorded well:
    </p>
    <ul style="margin:0 0 20px;padding-left:20px;color:${INK}">${htmlList}</ul>
    ${button(url, 'Check the recording')}
    ${fallbackLine(url)}`,
      `Too much mail? <a href="${unsubscribeUrl}" style="color:${MUTED}">Stop these result emails</a> — one click, no sign-in.`
    ),
  }
}

export function digestEmail(opts: {
  stats: {
    open: number
    inReview: number
    resolvedThisWeek: number
    oldestOpenDays: number | null
    topOpen: Array<{ title: string; ageDays: number; url: string }>
  }
  appUrl: string
  unsubscribeUrl: string
}): Omit<Message, 'to'> {
  const { stats, appUrl, unsubscribeUrl } = opts
  const parts = [
    `${stats.open} open`,
    stats.inReview > 0 ? `${stats.inReview} in review` : null,
    stats.resolvedThisWeek > 0 ? `${stats.resolvedThisWeek} resolved this week` : null,
  ].filter((p): p is string => p !== null)
  const headline = parts.join(' · ')
  const aging =
    stats.oldestOpenDays !== null && stats.oldestOpenDays >= 3
      ? `The oldest open walkthrough has been waiting ${stats.oldestOpenDays} days.`
      : null

  const textList = stats.topOpen
    .map((w) => `- ${w.title} (${w.ageDays}d)\n  ${w.url}`)
    .join('\n')
  const htmlList = stats.topOpen
    .map(
      (w) =>
        `<tr><td style="padding:6px 0;font-size:14px;line-height:1.5"><a href="${w.url}" style="color:${INK};text-decoration:none">${esc(w.title)}</a></td><td style="padding:6px 0 6px 12px;font-family:monospace;font-size:12px;color:${MUTED};white-space:nowrap;text-align:right">${w.ageDays}d</td></tr>`
    )
    .join('')

  return {
    subject: `Your Handback week: ${headline}`,
    text: `Across your spaces: ${headline}.${aging ? `\n${aging}` : ''}\n\n${stats.topOpen.length > 0 ? `Still open:\n${textList}\n\n` : ''}Review them: ${appUrl}\n\nToo much mail? Stop the digest: ${unsubscribeUrl}`,
    html: shell(
      `<p style="font-size:15px;line-height:1.6;margin:0 0 6px">Across your spaces: <strong>${esc(headline)}</strong>.</p>
    ${aging ? `<p style="font-size:14px;color:${MUTED};line-height:1.6;margin:0 0 16px">${esc(aging)}</p>` : ''}
    ${stats.topOpen.length > 0 ? `<table style="width:100%;border-collapse:collapse;margin:8px 0 20px">${htmlList}</table>` : ''}
    ${button(appUrl, 'Open Handback')}`,
      `Too much mail? <a href="${unsubscribeUrl}" style="color:${MUTED}">Stop the weekly digest</a> — one click, no sign-in.`
    ),
  }
}

export function alertEmail(opts: {
  source: string
  message: string
  detail?: string
  count: number
}): Omit<Message, 'to'> {
  const { source, message, detail, count } = opts
  const when = new Date().toISOString()
  const lines = [message]
  if (detail) lines.push('', detail)
  lines.push('', `occurrences since last alert: ${count}`, when)
  const text = lines.join('\n')
  return {
    subject: `[handback alert] ${source}: ${message.slice(0, 80)}`,
    text,
    html: `<pre style="margin:0;padding:16px;background:${PAPER};color:${INK};font-family:'SF Mono',Menlo,monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word">${esc(text)}</pre>`,
  }
}

export function inviteEmail(opts: {
  team: string
  inviter: string
  url: string
}): Omit<Message, 'to'> {
  const { team, inviter, url } = opts
  return {
    subject: `${inviter} invited you to the ${team} team on Handback`,
    text: `${inviter} invited you to join the ${team} team on Handback — where recorded walkthroughs of software problems get reviewed and handed to coding agents.\n\nJoin here:\n${url}\n\nThe invitation expires in seven days. Anyone with this link can join, so keep it to yourself.`,
    html: shell(`<p style="font-size:15px;line-height:1.6;margin:0 0 8px">
      <strong>${esc(inviter)}</strong> invited you to join the <strong>${esc(team)}</strong> team on Handback.
    </p>
    <p style="font-size:14px;color:${MUTED};line-height:1.6;margin:0 0 20px">
      It's where recorded walkthroughs of software problems get reviewed
      and handed to coding agents.
    </p>
    ${button(url, `Join ${esc(team)}`)}
    <p style="font-size:13px;color:${MUTED};line-height:1.6;margin:20px 0 0">
      The invitation expires in seven days. Anyone holding this link can join the
      team, so keep it to yourself.
    </p>
    ${fallbackLine(url)}`),
  }
}
