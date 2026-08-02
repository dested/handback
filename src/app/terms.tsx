import { Link } from 'react-router-dom'
import { LegalPage, Notice, Section } from '~/components/legal'

export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="July 30, 2026"
      summary="The agreement between you and Handback. Short version: it's early software, you own what you record, and you are responsible for having the right to record it.">
      <Section heading="1. Agreement">
        <p>
          By creating an account, installing the Handback Recorder, or using the Handback API, you
          agree to these terms. If you are agreeing on behalf of a company, you confirm you have the
          authority to bind it. If you don't agree, don't use the service. Handback is operated by
          Sal Aiello ("we", "us").
        </p>
      </Section>

      <Section heading="2. What Handback is">
        <p>
          Handback records narrated walkthroughs of software problems — screen, voice, and the page
          context around them — uploads them to your Handback space, and makes them available to
          your team and to coding agents that hold your API tokens.
        </p>
      </Section>

      <Section heading="3. This is early software">
        <Notice>
          Handback is in alpha. There is no uptime commitment, no support commitment, and no
          guarantee that data you store will survive. Features can change or disappear. Do not make
          Handback the only copy of anything you cannot afford to lose.
        </Notice>
        <p>
          One specific gap you should know about today: deleting your account is not yet a button.
          Email <a href="mailto:sal@dested.com">sal@dested.com</a> and it will be done by hand,
          promptly.
        </p>
      </Section>

      <Section heading="4. Your account">
        <p>
          Give accurate information, keep your password and API tokens to yourself, and take
          responsibility for everything done under your account. Tell us promptly if you think a
          credential has leaked. An organization owner is responsible for who they invite —
          invitation links grant access to everything in that organization.
        </p>
      </Section>

      <Section heading="5. What you record — read this one">
        <Notice>
          You are responsible for having the right to record everything you capture. Handback
          records your screen and your microphone; it cannot tell whose data is on that screen or
          whose voice is in the room.
        </Notice>
        <p>Before you record, make sure that:</p>
        <ul className="text-muted-foreground list-disc space-y-2 pl-5">
          <li>
            you are permitted to capture what is on screen — customer data, patient records,
            credentials, and material under someone else's NDA all deserve a second thought;
          </li>
          <li>
            anyone whose voice will be captured knows they are being recorded and agrees to it.
            Recording-consent laws vary by state and country, and some require every participant to
            consent, not just you;
          </li>
          <li>
            you have permission from your employer or client to send that material to a third-party
            service.
          </li>
        </ul>
        <p>
          This obligation is yours, not ours, and you agree to cover us for claims arising from
          recordings you had no right to make (section 12).
        </p>
      </Section>

      <Section heading="6. Acceptable use">
        <p>Don't:</p>
        <ul className="text-muted-foreground list-disc space-y-2 pl-5">
          <li>upload unlawful material, malware, or anything designed to harm others;</li>
          <li>
            try to reach data belonging to another organization, probe or attack the service, or
            work around its access controls;
          </li>
          <li>
            use the service as general-purpose file storage, or consume storage and bandwidth in a
            way that plainly isn't recording software problems;
          </li>
          <li>resell or white-label the service without a written agreement.</li>
        </ul>
      </Section>

      <Section heading="7. Your content stays yours">
        <p>
          You own your recordings, transcripts, and reports. You grant us a limited licence to
          store, copy, transmit, process, and display them strictly to operate the service for you —
          including sending the audio track to our transcription provider when server-side
          transcription is enabled. That licence exists to run the product and nothing else. We do
          not use your content to train AI models, and it ends when you delete the content. See the{' '}
          <Link to="/privacy">Privacy page</Link> for the specifics.
        </p>
      </Section>

      <Section heading="8. Our content">
        <p>
          The Handback name, mark, interface, and source code remain ours. Using the service doesn't
          transfer any of it to you.
        </p>
      </Section>

      <Section heading="9. Fees">
        <p>
          Handback is free during alpha. The pricing shown on our site describes intended plans and
          is not an offer — no paid plan is live and nothing is being charged. Should that change,
          you will be told before any charge, and you can stop using the service instead.
        </p>
      </Section>

      <Section heading="10. Suspension and termination">
        <p>
          You may stop and delete your account at any time (see the Privacy page for how, while it
          is still a manual process). We may suspend or terminate an account that breaks these
          terms, threatens the service, or exposes us to legal risk — with notice where
          circumstances allow. On termination we delete your content; export anything you want to
          keep first.
        </p>
      </Section>

      <Section heading="11. No warranty">
        <p>
          The service is provided "as is" and "as available", without warranties of any kind,
          express or implied, including merchantability, fitness for a particular purpose, and
          non-infringement. We don't warrant that it will be uninterrupted, secure, or error-free,
          or that transcripts and generated reports will be accurate. Machine transcription gets
          things wrong; read before you rely on it.
        </p>
      </Section>

      <Section heading="12. Liability and indemnity">
        <p>
          To the fullest extent the law allows, we are not liable for indirect, incidental, special,
          consequential, or punitive damages, or for lost profits, revenue, or data. Our total
          liability for any claim relating to the service is limited to the greater of the amount
          you paid us in the twelve months before the claim, or one hundred US dollars. Since the
          service is currently free, that figure is one hundred dollars.
        </p>
        <p>
          You agree to indemnify and hold us harmless against claims, damages, and costs arising
          from your use of the service, your content, or your breach of these terms — including
          claims by someone whose screen, voice, or data you recorded without the right to do so.
        </p>
      </Section>

      <Section heading="13. Changes">
        <p>
          We may change the service or these terms. When the terms change, the date at the top of
          this page changes; material changes will be communicated directly. Continuing to use
          Handback after a change means you accept it.
        </p>
      </Section>

      <Section heading="14. Governing law">
        <p>
          These terms are governed by the laws of the State of Arizona, USA, without regard to its
          conflict-of-law rules. You and we agree that the state and federal courts located in
          Maricopa County, Arizona have exclusive jurisdiction over any dispute arising from them.
        </p>
      </Section>
    </LegalPage>
  )
}
