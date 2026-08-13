import { LegalPage, Notice, Section, Terms } from '~/components/legal'

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="August 12, 2026"
      summary="Handback stores recordings of your screen and your voice. This page says exactly what we keep, where it lives, who can reach it, and how to get rid of it.">
      <Section heading="Who this covers">
        <p>
          Handback is operated by Sal Aiello. This policy covers the Handback web app at
          handback.dev, the Handback Recorder Chrome extension, and the command-line and MCP tools
          that talk to the same API. In a Handback team, almost everything you put in is visible to
          the other members of that team, by design. Your personal space is only you.
        </p>
      </Section>

      <Section heading="What we collect">
        <Terms
          items={[
            {
              term: 'Account',
              detail:
                'Your email address, your name if you give one, and a hash of your password — never the password itself. Sessions are cookies issued by our own server.',
            },
            {
              term: 'Teams',
              detail:
                'The teams you create or join, your role in each, and invitations you send or accept. Your personal space needs none of this — it is simply the content that is yours alone.',
            },
            {
              term: 'Walkthroughs',
              detail:
                'The substance of the product. A walkthrough holds the screen recording video, the keyframe images cut from it, your microphone audio, the machine transcript, and the report generated from them.',
            },
            {
              term: 'Recording context',
              detail:
                'While you record, the extension also captures the URLs and page titles you visit, console and network errors the page produces, and the marks and drawings you make. This is the evidence that makes a walkthrough useful to an agent — and it can include anything visible in those pages.',
            },
            {
              term: 'API tokens',
              detail:
                'Only a SHA-256 hash of each token, plus when it was last used. The token itself is shown once at creation and never stored.',
            },
            {
              term: 'Server logs',
              detail:
                'Ordinary web request logs — method, path, status, timing. Our hosting provider records connection metadata such as IP addresses as part of running the service.',
            },
          ]}
        />
      </Section>

      <Section heading="What we don't do">
        <p>
          There are no analytics scripts, advertising tags, or third-party trackers on this site —
          you can check the page source. We do not sell your data, we do not share it with anyone
          outside the processors named below, and{' '}
          <strong>
            we do not use your recordings, transcripts, or reports to train AI models.
          </strong>
        </p>
      </Section>

      <Section heading="Where it lives">
        <p>
          Files are stored in a private Amazon S3 bucket in the US West (Oregon) region. The bucket
          blocks all public access; nothing in it is reachable by URL. When you or an authorized
          agent needs a file, our server issues a presigned link that expires in an hour. Everything
          else — accounts, teams, walkthrough metadata — lives in a PostgreSQL database on our own
          server in the same region. All traffic runs over HTTPS.
        </p>
      </Section>

      <Section heading="Who can see it">
        <p>
          A walkthrough in a team is visible to that team's members; a walkthrough in your personal
          space is visible only to you. On top of that, anyone holding a valid API token that
          reaches the space can read it — that is how your coding agent pulls the queue. Nobody else:
          the boundary is enforced on every request, not just in the interface.
        </p>
        <Notice>
          Invitation links are the credential themselves: anyone who has one can join your team and
          read its walkthroughs until it expires after seven days. Send them the way you would send a
          password.
        </Notice>
        <p>
          <strong>Share links work the same way.</strong> When you share a walkthrough, we mint a
          link that plays it with no sign-in required — the link <em>is</em> the credential, so
          anyone you send it to (and anyone they forward it to) can watch it. Sharing again replaces
          the old link, which is also how you kill one that leaked; un-sharing revokes access
          immediately. A walkthrough is never shared unless you share it.
        </p>
        <p>
          Sal Aiello, as the operator, can technically reach stored data in the course of running
          and debugging the service. It is not read routinely and it is never shared.
        </p>
      </Section>

      <Section heading="Transcription and cleanup">
        <p>
          Your narration is transcribed one of two ways, and you choose which in the extension's
          settings:
        </p>
        <Terms
          items={[
            {
              term: 'On your device',
              detail:
                'A speech model runs inside your own browser. Your audio is never sent anywhere for transcription — it stays on your machine.',
            },
            {
              term: 'By our provider',
              detail:
                'The audio track is sent to Groq, which returns a timed transcript. Groq processes it to produce that transcript and for no other purpose.',
            },
          ]}
        />
        <p>
          Either way, the recording itself — video, keyframes, audio — is stored in our S3 bucket as
          described above.
        </p>
        <p>
          The transcript then goes through a cleanup pass so the words match what you actually said:
          the text of the lines, the page's address, and the errors its console logged are sent to
          Anthropic's Claude API, which returns the same lines with product names and technical
          terms spelled correctly. No audio, video, or image is sent. Timestamps are never changed,
          and the report states plainly when a transcript has been through this pass. Anthropic does
          not train on API inputs or outputs.
        </p>
      </Section>

      <Section heading="Processors" id="processors">
        <Terms
          items={[
            {
              term: 'Amazon Web Services',
              detail: 'Hosting, file storage, and the database. US West (Oregon).',
            },
            {
              term: 'Groq',
              detail:
                'Speech-to-text with the whisper-large-v3-turbo model, only when server-side transcription is enabled. Receives the audio track; receives nothing else.',
            },
            {
              term: 'Anthropic',
              detail:
                'Transcript cleanup with the claude-haiku-4-5 model. Receives the transcript text, the recorded page address, and its console errors. Never receives audio, video, or images.',
            },
            {
              term: 'Resend',
              detail:
                'Sends our account email — verification, password resets, and invitations. Receives the recipient address and the message itself; never receives walkthrough content.',
            },
          ]}
        />
        <p>
          That is the whole list. If it changes, this page changes with it, in the same release as
          the change itself.
        </p>
      </Section>

      <Section heading="How long we keep it">
        <p>
          We keep recordings no longer than we need to. A few clocks run automatically:
        </p>
        <Terms
          items={[
            {
              term: 'Resolved walkthroughs',
              detail:
                'Once a walkthrough is marked resolved, it auto-deletes 30 days later — records and files both. A Keep control on the walkthrough cancels that, and reopening it (moving it off resolved) cancels it too.',
            },
            {
              term: 'Raw recordings of a shared cut',
              detail:
                'For a walkthrough recorded for a person, the raw source recordings are deleted 14 days after the final video is rendered. The finished video stays reachable until the walkthrough itself is gone.',
            },
            {
              term: 'Unfinished uploads',
              detail:
                'An upload that never finished — interrupted, abandoned — is removed after 7 days.',
            },
          ]}
        />
        <p>
          Deleting a walkthrough yourself is immediate and total: it removes the database records and
          the entire folder of files from S3, right away. Re-recording under the same name replaces
          the old walkthrough wholesale — the previous files are deleted, not versioned. Account
          records persist until the account is deleted.
        </p>
        <Notice>
          Deleting your <em>account</em> is not yet a button in the product. Email{' '}
          <a href="mailto:sal@dested.com">sal@dested.com</a> and it will be done by hand, along with
          everything belonging to it.
        </Notice>
      </Section>

      <Section heading="Your rights">
        <p>
          Ask and you will get: a copy of what we hold about you, correction of anything wrong, or
          deletion of all of it. Depending on where you live you may have these rights by law; we
          apply them to everyone regardless. One email to{' '}
          <a href="mailto:sal@dested.com">sal@dested.com</a> is the whole process.
        </p>
      </Section>

      <Section heading="Children">
        <p>
          Handback is a tool for software teams and is not directed at children. Do not create an
          account if you are under 16.
        </p>
      </Section>

      <Section heading="Changes">
        <p>
          When this policy changes, the date at the top of this page changes. If a change materially
          affects what happens to data you have already stored — a new processor, a new category of
          collection — you will be told directly, not just quietly re-dated.
        </p>
      </Section>
    </LegalPage>
  )
}
