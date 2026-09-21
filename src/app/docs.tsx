import { Link } from 'react-router-dom'
import { LegalPage, Notice, Section, Terms } from '~/components/legal'

// The MCP surface, rendered as a bordered reference table.
const TOOLS: Array<[string, string]> = [
  ['list_walkthroughs', 'Everything the token can reach, newest first, filterable by status.'],
  [
    'get_walkthrough',
    'The full brief: report, transcript, contact sheets, keyframes, video — presigned links, short-lived. A long walkthrough carries a keyframe sample; get_frames pages the rest.',
  ],
  [
    'get_frames',
    'Page the full keyframe set in the order it was recorded — presigned links, offset/limit — for when the brief only inlined a sample.',
  ],
  ['set_walkthrough_status', 'open → in_review → resolved as the work moves.'],
  [
    'post_result',
    "The agent's answer: summary, optional PR link and files touched. Lands on the review thread and notifies the uploader.",
  ],
  [
    'ask_reviewer',
    'Hit a fork? The agent asks a clarifying question; the walkthrough waits in needs_info until a human answers.',
  ],
  ['attach_evidence', 'Before/after screenshots attached to the result, shown at sign-off.'],
]

export function DocsPage() {
  return (
    <LegalPage
      title="How Handback works"
      updated="August 23, 2026"
      summary="Record what's broken in your own words; your coding agent pulls it over MCP, fixes it, and the fix waits on your sign-off. Here's the whole loop, end to end.">
      <Section heading="The loop" id="loop">
        <p>
          Handback closes the gap between noticing a bug and getting it fixed. You narrate the
          problem where it happens, the recording becomes a brief an agent can act on, and the fix
          comes back to you for a human sign-off. Five stages:
        </p>
        <Terms
          items={[
            {
              term: 'record',
              detail:
                "Narrate what you're seeing, in the app where it happens — browser recorder at /record, the Chrome extension, your phone's screen recorder via /phone, or drop an existing clip on /upload.",
            },
            {
              term: 'distill',
              detail:
                'Handback turns the recording into a repro-grade brief: a report written for agents, a timestamped transcript, deduplicated keyframes tiled into contact sheets, and the console/network errors that fired while you spoke.',
            },
            {
              term: 'pull',
              detail:
                'Your agent lists open walkthroughs over MCP and pulls the full brief — no copy-pasting context.',
            },
            {
              term: 'hand back',
              detail:
                "The agent posts its result — summary, PR link, files touched — onto the walkthrough's review thread and flips it to in review.",
            },
            {
              term: 'sign off',
              detail:
                'You watch the recording against the fix and approve, or send it back with a note. Nothing resolves without a human.',
            },
          ]}
        />
      </Section>

      <Section heading="Connect Claude Code" id="connect">
        <p>
          Setup takes about two minutes. First, sign up for Handback. Second, open{' '}
          <Link to="/connect">/connect</Link> and mint your command — the page creates an API token
          and renders it into the exact line below. Third, paste that line into your terminal:
        </p>
        <pre className="bg-secondary overflow-x-auto rounded-md border p-3 font-mono text-[13px]">
          claude mcp add --transport http handback https://handback.dev/mcp --header
          &quot;Authorization: Bearer hb_…&quot;
        </pre>
        <p>
          The <Link to="/connect">/connect</Link> page mints the token and renders this command with
          the token already in it — nothing to install, the server is hosted.
        </p>
        <p>
          Then just ask: <em>anything waiting on Handback?</em> — the agent takes it from there.
        </p>
        <Notice>
          Any MCP client works — Cursor, Windsurf, or your own agent. Claude Code is simply the path
          we test every day.
        </Notice>
      </Section>

      <Section heading="What the agent gets" id="tools">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {TOOLS.map(([name, detail]) => (
                <tr key={name} className="border-border/60 border-b align-top">
                  <td className="text-foreground py-2.5 pr-6 font-mono font-medium whitespace-nowrap">
                    {name}
                  </td>
                  <td className="text-muted-foreground py-2.5 leading-6">{detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Why the brief works: contact sheets — a model reading consecutive frames side by side
          follows what happened; the same frames one at a time, it doesn't.
        </p>
      </Section>

      <Section heading="Teams and projects" id="teams">
        <p>
          You get a personal space by default. Create a team and invite reviewers from{' '}
          <Link to="/team">/team</Link>. Walkthroughs auto-file to projects by the origin they were
          recorded on. And you can share a polished cut with anyone via a link — watch pages need
          no account.
        </p>
      </Section>

      <Section heading="Privacy, retention, pricing" id="faq">
        <Terms
          items={[
            {
              term: 'what leaves your machine',
              detail: (
                <>
                  The recording, transcript and metadata you upload — nothing else. Full detail on
                  the <Link to="/privacy">privacy page</Link>.
                </>
              ),
            },
            {
              term: 'processors',
              detail:
                'Transcription runs on Groq, transcript cleanup on Anthropic, email on Resend. The extension also offers fully on-device transcription.',
            },
            {
              term: 'retention',
              detail:
                'Resolved walkthroughs auto-expire after 30 days (you can Keep one forever); raw takes from person-to-person edits purge 14 days after the final cut renders.',
            },
            {
              term: 'pricing',
              detail: (
                <>
                  The free tier is live — 2 walkthroughs a month, each with cloud transcription
                  and the refine pass. Billing on the paid plans hasn't opened yet; they're coming
                  soon, priced per reviewer, not per walkthrough.{' '}
                  <Link to="/#pricing">See pricing</Link>.
                </>
              ),
            },
          ]}
        />
      </Section>
    </LegalPage>
  )
}
