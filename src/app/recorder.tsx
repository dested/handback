// /recorder — the page that gets the Handback Recorder installed and pointed at
// this server. The whole design goal is that nobody copies a token: the page
// mints one and hands it to the extension over Chrome's external messaging
// channel, so "linked" is one click rather than a trip through a settings pane.
// A token is the whole account, so linking has nothing to choose — where a
// recording lands is picked in the panel, at send time.
//
// Everything here that touches `window.chrome` happens in effects and handlers.
// The page renders on the server, where there is no window and no extension.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { Step, autoTokenName } from '~/components/setup-step'
import { Button } from '~/components/ui/button'
import { useCopy } from '~/components/viewer/use-copy'
import { useTRPC } from '~/lib/trpc'

/** Fixed by the `key` in extension/public/manifest.json — same ID unpacked and in the Web Store. */
const EXTENSION_ID = 'gmggnebbenlmpakojgocnjfcnpmifdci'
/** Set when the Chrome Web Store listing goes live; null renders the zip path instead. */
const STORE_URL: string | null = null
/**
 * Served by this app, not by GitHub: the repo is private, so its release links
 * 404 for exactly the people we hand them to. Signed-in only, and it redirects
 * to a short-lived presigned URL — see `GET /download/recorder`.
 */
const DOWNLOAD_URL = '/download/recorder'

/**
 * The only part of the `chrome` API a web page can reach: `sendMessage` to an
 * extension that lists this origin in `externally_connectable`. Typed here
 * rather than pulling in @types/chrome, which describes an API surface this
 * page can't touch anyway.
 */
interface ChromeRuntimeLite {
  sendMessage: (
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void
  ) => void
  lastError?: { message?: string }
}

declare global {
  interface Window {
    chrome?: { runtime?: ChromeRuntimeLite }
  }
}

/**
 * A link is now per *server*, not per space: `linkedOrigins` is every Handback
 * the extension holds a key for. Shipped 1.2.x recorders answer with `orgs`
 * instead — the orgs they held keys for on this origin — and 1.1.x and
 * older send neither, leaving only the single-link `linked`/`serverUrl` pair.
 * Both legacy shapes are read as null so `isLinked` can tell "old recorder"
 * from "linked nowhere".
 */
type Presence = {
  version: string
  linked: boolean
  serverUrl: string
  linkedOrigins: string[] | null
  orgs: { id: string; name: string }[] | null
}
type LinkResult = { ok: boolean; error?: string }

const NO_ANSWER = 'no answer from the extension'

/**
 * "Is it installed, and where is it pointed?" — sent every couple of seconds so
 * the page turns green the moment someone finishes installing, without a
 * reload. Silence is the normal answer (nothing installed), so every failure
 * mode resolves null rather than throwing.
 */
function pingExtension(): Promise<Presence | null> {
  return new Promise((resolve) => {
    const runtime = window.chrome?.runtime
    if (!runtime) {
      resolve(null)
      return
    }
    try {
      runtime.sendMessage(EXTENSION_ID, { type: 'handback:ping' }, (response) => {
        // Reading lastError is what stops Chrome logging "unchecked
        // runtime.lastError" every two seconds while nothing is installed.
        if (window.chrome?.runtime?.lastError) {
          resolve(null)
          return
        }
        resolve(readPresence(response))
      })
    } catch {
      resolve(null)
    }
  })
}

/** Hands the extension a freshly minted token. It answers, or it didn't hear us. */
function linkExtension(apiToken: string): Promise<LinkResult> {
  return new Promise((resolve) => {
    const runtime = window.chrome?.runtime
    if (!runtime) {
      resolve({ ok: false, error: NO_ANSWER })
      return
    }
    try {
      runtime.sendMessage(
        EXTENSION_ID,
        { type: 'handback:link', apiToken },
        (response) => {
          if (window.chrome?.runtime?.lastError) {
            resolve({ ok: false, error: NO_ANSWER })
            return
          }
          resolve(readLinkResult(response))
        }
      )
    } catch {
      resolve({ ok: false, error: NO_ANSWER })
    }
  })
}

function readPresence(response: unknown): Presence | null {
  if (typeof response !== 'object' || response === null) return null
  if (!('ok' in response) || response.ok !== true) return null
  if (!('version' in response) || typeof response.version !== 'string') return null
  if (!('linked' in response) || typeof response.linked !== 'boolean') return null
  if (!('serverUrl' in response) || typeof response.serverUrl !== 'string') return null
  return {
    version: response.version,
    linked: response.linked,
    serverUrl: response.serverUrl,
    linkedOrigins: readLinkedOrigins(response),
    orgs: readLinkedOrgs(response),
  }
}

/**
 * Every Handback origin the recorder holds a key for. A missing field means an
 * extension too old to answer it — null, not `[]`, so the legacy branch in
 * `isLinked` can still run.
 */
function readLinkedOrigins(response: object): string[] | null {
  if (!('linkedOrigins' in response)) return null
  const { linkedOrigins } = response
  if (!Array.isArray(linkedOrigins)) return null
  // Array.isArray widens to any[]; hold it as unknown[] so each element still
  // has to be narrowed before it is read.
  const entries: unknown[] = linkedOrigins
  return entries.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * What a shipped 1.2.x recorder answers instead: the orgs it held keys for on
 * this origin. Null when absent (1.1.x and older). Anything in the list
 * that isn't a plain `{ id, name }` pair is dropped rather than sinking the
 * whole ping.
 */
function readLinkedOrgs(response: object): { id: string; name: string }[] | null {
  if (!('orgs' in response)) return null
  const { orgs } = response
  if (!Array.isArray(orgs)) return null
  const entries: unknown[] = orgs
  const linked: { id: string; name: string }[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    if (!('id' in entry) || typeof entry.id !== 'string') continue
    if (!('name' in entry) || typeof entry.name !== 'string') continue
    linked.push({ id: entry.id, name: entry.name })
  }
  return linked
}

function readLinkResult(response: unknown): LinkResult {
  if (typeof response !== 'object' || response === null) return { ok: false, error: NO_ANSWER }
  if (!('ok' in response) || typeof response.ok !== 'boolean') {
    return { ok: false, error: NO_ANSWER }
  }
  if (response.ok) return { ok: true }
  const error =
    'error' in response && typeof response.error === 'string' ? response.error : NO_ANSWER
  return { ok: false, error }
}

type Phase = 'idle' | 'linking' | 'linked' | 'failed'

export function RecorderPage() {
  // window is absent during SSR; render the production host, then correct it on
  // mount so a local dev session shows its own origin.
  const [origin, setOrigin] = useState('https://handback.dev')
  useEffect(() => setOrigin(window.location.origin), [])

  // null until mount decides — the server has no window to ask.
  const [inChrome, setInChrome] = useState<boolean | null>(null)
  const [presence, setPresence] = useState<Presence | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    // `chrome.runtime` only appears on this page once a matching extension is
    // installed — its absence means "not installed yet", never "not Chrome".
    // Chrome itself is read off the UA (every Chromium can load the extension),
    // and pingExtension re-checks runtime on every tick.
    const chromium = /Chrome\//.test(navigator.userAgent)
    setInChrome(chromium)
    if (!chromium) return
    let live = true
    const poll = async () => {
      const found = await pingExtension()
      if (!live) return
      setPresence(found)
      setChecked(true)
    }
    void poll()
    const timer = setInterval(() => void poll(), 2000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  const trpc = useTRPC()
  const release = useQuery(trpc.recorder.release.queryOptions())
  const latest = release.data?.version ?? null

  return (
    <div className="max-w-3xl space-y-12">
      <header className="space-y-4">
        <p className="text-cobalt font-mono text-xs tracking-widest uppercase">
          Are you the one who saw it break?
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">Set up the recorder</h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          The Handback Recorder is a Chrome extension: hit record, walk through the problem out
          loud, and the recording, transcript, and console errors land in your Handback inbox as a
          brief an agent can act on.
        </p>
      </header>

      {inChrome === false && <NotChromeNotice />}
      <Step
        n="01"
        title="Install the extension"
        blurb="Chrome only. It records the tab, your narration, and the console together, and only while you're recording.">
        {/* Once the extension answers a ping, the how-to-install steps have
            served their purpose — they collapse rather than sitting under a
            green "it's installed" banner telling you to install it. Still
            reachable, because updating means walking them again. */}
        <div className="space-y-4">
          {presence ? (
            <>
              <PresenceIndicator presence={presence} checked={checked} latest={latest} />
              <details className="group">
                <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none text-sm underline decoration-dotted underline-offset-4 marker:content-['']">
                  Reinstall or update it
                </summary>
                <div className="mt-4">
                  <InstallInstructions />
                </div>
              </details>
            </>
          ) : (
            <>
              <InstallInstructions />
              {inChrome !== false && (
                <PresenceIndicator presence={presence} checked={checked} latest={latest} />
              )}
            </>
          )}
        </div>
      </Step>

      <Step
        n="02"
        title="Link the recorder"
        blurb={
          isLinked(presence, origin)
            ? 'Linked. Pick your destination in the recorder panel when you send.'
            : 'One click hands the recorder a key to your account — no tokens to copy. Pick where each recording goes (Personal or a team) in the panel when you send.'
        }>
        <LinkStep origin={origin} presence={presence} />
      </Step>

      <Recording />

    </div>
  )
}

/**
 * "Does the extension already hold a key to this server?" — what a current
 * recorder answers by listing its origins. The fallback branch is for SHIPPED
 * 1.2.x recorders, which answer with `orgs` (the orgs on this origin) or, at
 * 1.1.x, only a single `linked`/`serverUrl` pair. Don't drop it until no 1.2.x
 * installs remain.
 */
function isLinked(presence: Presence | null, origin: string): boolean {
  if (presence === null) return false
  return Array.isArray(presence.linkedOrigins)
    ? presence.linkedOrigins.includes(origin)
    : (presence.orgs?.length ?? 0) > 0 || (presence.linked && presence.serverUrl === origin)
}

function LinkStep({ origin, presence }: { origin: string; presence: Presence | null }) {
  const trpc = useTRPC()
  const [phase, setPhase] = useState<Phase>('idle')
  const [minted, setMinted] = useState<string | null>(null)

  const create = useMutation(
    trpc.tokens.create.mutationOptions({
      onSuccess: async (result) => {
        setMinted(result.token)
        const outcome = await linkExtension(result.token)
        setPhase(outcome.ok ? 'linked' : 'failed')
      },
      onError: () => setPhase('idle'),
    })
  )

  const link = useCallback(() => {
    setPhase('linking')
    create.mutate({ name: autoTokenName('Recorder', navigator.userAgent, new Date()) })
  }, [create])

  const detectedHere = isLinked(presence, origin)
  // Linked, but at a different Handback entirely. Violet, not amber — ui.md
  // forbids the warm hues, and this is a "heads up", not a failure.
  const linkedElsewhere =
    presence !== null && presence.linked && !detectedHere && presence.serverUrl !== origin
  // The banner distinguishes "was already linked when you arrived" from "you
  // just linked it", so it stays keyed to phase. The *button* must not: the
  // moment linking succeeds the action is done, and offering a primary
  // "Link the recorder" under a green "Linked." banner reads as a failed click.
  // presence lags a poll tick behind, so phase carries it until it catches up.
  const linkedHere = detectedHere || phase === 'linked'
  const alreadyHere = detectedHere && phase === 'idle'
  const busy = phase === 'linking' || create.isPending

  return (
    <div className="space-y-4">
      {linkedElsewhere && (
        <div className="border-review/40 bg-review-wash text-review rounded-md border p-4 text-sm">
          The recorder is linked to <span className="font-mono text-xs">{presence.serverUrl}</span>.
          Linking here points it at this server instead.
        </div>
      )}

      {alreadyHere && (
        <div className="border-approve/40 bg-approve-wash flex items-center gap-3 rounded-md border p-4">
          <span className="bg-approve size-2 shrink-0 rounded-full" />
          <p className="text-approve text-sm font-medium">
            Linked. Pick your destination in the recorder panel when you send.
          </p>
        </div>
      )}

      {phase === 'linked' && (
        <div className="border-approve/40 bg-approve-wash flex items-center gap-3 rounded-md border p-4">
          <span className="bg-approve size-2 shrink-0 rounded-full" />
          <p className="text-approve text-sm font-medium">
            Linked. Pick your destination in the recorder panel when you send. You can close this
            page.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant={linkedHere ? 'outline' : 'default'}
          disabled={presence === null || busy}
          onClick={link}>
          {busy ? 'Linking…' : linkedHere ? 'Re-link' : 'Link the recorder'}
        </Button>
        {presence === null && (
          <span className="text-muted-foreground text-sm">
            Install the extension in step 01 first.
          </span>
        )}
      </div>

      {alreadyHere && (
        <p className="text-muted-foreground text-sm">
          Re-linking mints a fresh token; the old one keeps working until you revoke it under{' '}
          <Link to="/connect" className="text-primary underline underline-offset-4">
            Your API tokens
          </Link>
          .
        </p>
      )}

      {phase === 'failed' && minted && (
        <div className="border-border bg-card space-y-3 rounded-md border p-4">
          <p className="text-sm">
            The extension didn't answer, but your token was created — paste it into the extension's
            settings (server <span className="font-mono text-xs">{origin}</span>), or revoke it
            under{' '}
            <Link to="/connect" className="text-primary underline underline-offset-4">
              Your API tokens
            </Link>
            .
          </p>
          <CopyRow value={minted} />
        </div>
      )}

      {create.isError && <p className="text-destructive text-sm">{create.error.message}</p>}
    </div>
  )
}

/** How to get the extension in — the Web Store button once there is a listing,
 *  the three-step zip walk until then. Rendered plainly before it's installed
 *  and behind a disclosure after. */
function InstallInstructions() {
  if (STORE_URL) {
    return (
      <div>
        <a
          href={STORE_URL}
          target="_blank"
          rel="noreferrer"
          className="bg-primary text-primary-foreground inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium hover:opacity-90">
          Add to Chrome
        </a>
        <p className="text-muted-foreground mt-3 text-sm">
          Chrome will ask to confirm — the recorder only runs when you hit Record.
        </p>
      </div>
    )
  }
  return (
    <div>
      <p className="text-muted-foreground text-sm">
        It's not on the Chrome Web Store yet, so for now it installs from a zip — three steps, no
        build tools:
      </p>
      <ol className="text-muted-foreground mt-4 space-y-2 text-sm">
        <li className="flex gap-3">
          <span className="text-cobalt font-mono text-xs leading-5">1</span>
          <span>
            <a href={DOWNLOAD_URL} className="text-primary underline underline-offset-4">
              Download <code className="font-mono text-xs">handback-recorder.zip</code>
            </a>{' '}
            and unzip it.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="text-cobalt font-mono text-xs leading-5">2</span>
          <span>
            Open <code className="font-mono text-xs">chrome://extensions</code> (copy-paste it —
            Chrome won't let a page link there), and flip on <strong>Developer mode</strong>, top
            right.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="text-cobalt font-mono text-xs leading-5">3</span>
          <span>
            Hit <strong>Load unpacked</strong> and pick the unzipped folder.
          </span>
        </li>
      </ol>
    </div>
  )
}

/** The page's heartbeat: green the instant the extension answers a ping. */
/**
 * Nothing installed from a zip ever updates itself — that's the one thing the
 * Web Store would do for us. So the page does it: the extension reports its
 * version over the ping, the server reports what it's handing out, and a stale
 * install gets told. Both are `x.y.z` from the same manifest, so a plain
 * numeric compare is the whole comparison.
 */
function isOutdated(installed: string, latest: string): boolean {
  const a = installed.split('.').map(Number)
  const b = latest.split('.').map(Number)
  if ([...a, ...b].some((n) => !Number.isFinite(n))) return false
  for (let i = 0; i < 3; i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

function PresenceIndicator({
  presence,
  checked,
  latest,
}: {
  presence: Presence | null
  checked: boolean
  latest?: string | null
}) {
  if (presence) {
    const stale = latest ? isOutdated(presence.version, latest) : false
    return (
      <div className="space-y-3">
        <div className="border-approve/40 bg-approve-wash flex items-center gap-3 rounded-md border p-4">
          <span className="bg-approve size-2 shrink-0 rounded-full" />
          <p className="text-approve text-sm font-medium">
            Handback Recorder {presence.version} is installed.
          </p>
        </div>
        {stale && (
          <div className="border-review/40 bg-review-wash rounded-md border p-4 text-sm">
            <p className="text-review font-medium">Version {latest} is available.</p>
            <p className="text-muted-foreground mt-1">
              A zip install doesn't update itself.{' '}
              <a href={DOWNLOAD_URL} className="text-primary underline underline-offset-4">
                Download {latest}
              </a>
              , then hit reload on the extension at{' '}
              <code className="font-mono text-xs">chrome://extensions</code> — your link survives
              the update.
            </p>
          </div>
        )}
      </div>
    )
  }
  return (
    <div
      aria-busy={!checked}
      className="border-border bg-muted/40 flex items-center gap-3 rounded-md border p-4">
      <span className="bg-muted-foreground/40 size-2 shrink-0 animate-pulse rounded-full" />
      <p className="text-muted-foreground text-sm">
        Waiting to spot the extension… it shows up here the moment it's installed. Installed it
        already? Reload this page.
      </p>
    </div>
  )
}

/**
 * Not a step — setup ends at the link. This is what happens next, in the
 * extension, and numbering it made a two-step page look like a three-step one.
 */
function Recording() {
  return (
    <section className="border-border border-t pt-6">
      <h2 className="font-display text-xl font-semibold">Then just record</h2>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        Setup is done — the rest happens in the panel.
      </p>
      <ul className="text-muted-foreground mt-5 space-y-2 text-sm">
        <li className="flex gap-2">
          <span className="text-cobalt">·</span>
          <span>
            Pin it: puzzle-piece icon in Chrome's toolbar → pin{' '}
            <strong>Handback Recorder</strong>, then click it to open the side panel.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-cobalt">·</span>
          <span>
            Hit <strong>Record</strong>, pick the tab or screen, and talk — say what you expected
            and what happened instead. <code className="font-mono text-xs">Alt+Shift+D</code> draws
            on the page in ink.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-cobalt">·</span>
          <span>
            Hit <strong>Send to Handback</strong> when you're done — the walkthrough lands in the
            inbox here, ready for an agent.
          </span>
        </li>
      </ul>
    </section>
  )
}

function NotChromeNotice() {
  return (
    <div className="border-border bg-muted/40 rounded-md border p-4">
      <p className="text-muted-foreground text-sm">
        This page can only talk to the extension from Chrome. Open{' '}
        <span className="font-mono text-xs">handback.dev/recorder</span> in Chrome to finish setup.
      </p>
    </div>
  )
}


function CopyRow({ value }: { value: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-2 font-mono text-xs"
      />
      <Button type="button" variant="outline" size="sm" onClick={() => void copy(value)}>
        {copied ? <Check /> : <Copy />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}
