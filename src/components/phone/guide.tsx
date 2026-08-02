// The half of /phone that teaches. A mobile browser cannot record a screen —
// getDisplayMedia never shipped there — so every step here points at the
// recorder the phone already has, and nothing on this page ever says "press
// record". We take the clip afterwards and distil it.
//
// The three platforms want genuinely different instructions, and promising the
// wrong one is worse than saying nothing: Android can install us as a share
// target, iOS cannot, and a desktop visitor is simply in the wrong place.

import { useRef } from 'react'
import { Step } from '~/components/setup-step'
import { Button } from '~/components/ui/button'

export type Platform = 'android' | 'ios' | 'desktop'

export function PhoneGuide({
  platform,
  standalone,
  installable,
  spaceLabel,
  onInstall,
  onFiles,
  onIntake,
}: {
  platform: Platform
  standalone: boolean
  installable: boolean
  spaceLabel: string
  onInstall: () => void
  onFiles: (files: File[]) => void
  onIntake: () => void
}) {
  return (
    <>
      {platform === 'android' && (
        <AndroidSteps
          standalone={standalone}
          installable={installable}
          onInstall={onInstall}
          onFiles={onFiles}
        />
      )}
      {platform === 'ios' && <IosSteps onFiles={onFiles} />}
      {platform === 'desktop' && <DesktopNotice />}
      <WhatHappens spaceLabel={spaceLabel} />
      <JustSayIt onIntake={onIntake} />
    </>
  )
}

/** The file picker every "bring me the clip" control opens. */
function usePicker(onFiles: (files: File[]) => void) {
  const input = useRef<HTMLInputElement | null>(null)
  const element = (
    <input
      ref={input}
      type="file"
      accept="video/*,audio/*"
      multiple
      className="hidden"
      onChange={(event) => {
        const picked = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (picked.length) onFiles(picked)
      }}
    />
  )
  return { element, open: () => input.current?.click() }
}

function AndroidSteps({
  standalone,
  installable,
  onInstall,
  onFiles,
}: {
  standalone: boolean
  installable: boolean
  onInstall: () => void
  onFiles: (files: File[]) => void
}) {
  const picker = usePicker(onFiles)
  return (
    <>
      <Step
        n="01"
        title="Install the app"
        blurb="Installed, Handback shows up in your phone's share sheet — which is the whole trick: you never come looking for this page, the clip comes to it.">
        {standalone ? (
          <div className="border-approve/40 bg-approve-wash flex items-center gap-3 rounded-md border p-4">
            <span className="bg-approve size-2 shrink-0 rounded-full" />
            <p className="text-approve text-sm font-medium">Installed — you're running it now.</p>
          </div>
        ) : installable ? (
          <Button type="button" onClick={onInstall}>
            Install Handback
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">
            Chrome menu → <strong>Add to Home screen</strong>.
          </p>
        )}
      </Step>

      <Step
        n="02"
        title="Record your screen"
        blurb="Your phone's own recorder does the capturing. Nothing has to be open here while you record — walk through the problem in the app where it happens.">
        <ul className="text-muted-foreground space-y-2 text-sm">
          <li className="flex gap-2">
            <span className="text-cobalt">·</span>
            <span>
              Pull down Quick Settings and tap <strong>Screen record</strong>.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-cobalt">·</span>
            <span>
              Choose <strong>Record audio: Microphone</strong> before you start — the narration is
              the half that becomes the brief.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-cobalt">·</span>
            <span>Talk while you use the app. Switch apps freely; the recorder follows.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-cobalt">·</span>
            <span>Stop it from the notification shade when you're done.</span>
          </li>
        </ul>
      </Step>

      <Step
        n="03"
        title="Share it to Handback"
        blurb="Open the clip, hit its Share button, and pick Handback from the share sheet. It lands right back on this page with the clip already loaded.">
        {picker.element}
        <p className="text-muted-foreground text-sm">
          or{' '}
          <button
            type="button"
            onClick={picker.open}
            className="text-primary underline underline-offset-4">
            pick it by hand
          </button>
        </p>
      </Step>
    </>
  )
}

function IosSteps({ onFiles }: { onFiles: (files: File[]) => void }) {
  const picker = usePicker(onFiles)
  return (
    <>
      <Step
        n="01"
        title="Add to Home Screen"
        blurb="Handback then opens like an app instead of a tab, which is what keeps you signed in between recordings.">
        <p className="text-muted-foreground text-sm">
          Safari's Share button → <strong>Add to Home Screen</strong>.
        </p>
      </Step>

      <Step
        n="02"
        title="Record with the mic on"
        blurb="iOS records your screen from Control Center, and it leaves the microphone off unless you ask for it. A silent clip has no brief in it.">
        <ul className="text-muted-foreground space-y-2 text-sm">
          <li className="flex gap-2">
            <span className="text-cobalt">·</span>
            <span>
              Settings → Control Center → add <strong>Screen Recording</strong>.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-cobalt">·</span>
            <span>
              Long-press the record button and turn <strong>Microphone On</strong>.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-cobalt">·</span>
            <span>Narrate as you go, switching apps as much as you like.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-cobalt">·</span>
            <span>Tap the red pill to stop. The clip goes to Photos.</span>
          </li>
        </ul>
      </Step>

      <Step
        n="03"
        title="Bring it here"
        blurb="iOS won't let a web app sit in the share sheet, so this is the one step you do by hand — pick the recording and Handback takes it from there.">
        {picker.element}
        <Button type="button" onClick={picker.open}>
          Choose from Photos
        </Button>
      </Step>
    </>
  )
}

function DesktopNotice() {
  return (
    <div className="border-border bg-card rounded-xl border p-6">
      <p className="text-sm leading-relaxed">
        This page is for your phone. Open{' '}
        <span className="font-mono text-xs font-medium">handback.dev/phone</span> there — record
        your screen anywhere, narrate it, and it lands in this inbox distilled.
      </p>
    </div>
  )
}

/** Reference, not a step — nobody does any of this, so none of it gets a numeral. */
function WhatHappens({ spaceLabel }: { spaceLabel: string }) {
  return (
    <section className="rule pt-6">
      <h2 className="font-display text-xl font-semibold">What happens to a clip</h2>
      <ul className="text-muted-foreground mt-4 space-y-2 text-sm">
        <li className="flex gap-2">
          <span className="text-cobalt">·</span>
          <span>The keyframes are cut out here, in your browser, before anything is sent.</span>
        </li>
        <li className="flex gap-2">
          <span className="text-cobalt">·</span>
          <span>Your voice becomes a transcript, cleaned up so it reads like sentences.</span>
        </li>
        <li className="flex gap-2">
          <span className="text-cobalt">·</span>
          <span>
            A report lands in the queue for your agent, in{' '}
            <span className="text-foreground font-medium">{spaceLabel}</span>.
          </span>
        </li>
      </ul>
    </section>
  )
}

function JustSayIt({ onIntake }: { onIntake: () => void }) {
  return (
    <section className="rule pt-6">
      <h2 className="font-display text-xl font-semibold">Or just say it</h2>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        Nothing to show, only something to explain? Record a voice note instead — it goes through
        the same transcript and the same report, minus the pictures.{' '}
        <button
          type="button"
          onClick={onIntake}
          className="text-primary underline underline-offset-4">
          Start one
        </button>
        .
      </p>
    </section>
  )
}
