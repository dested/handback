// /recorder — the page that gets the Handback Recorder installed and pointed at
// this workspace. The whole design goal is that nobody copies a token: the page
// mints one and hands it to the extension over Chrome's external messaging
// channel, so "linked" is one click rather than a trip through a settings pane.
//
// Everything here that touches `window.chrome` happens in effects and handlers.
// The page renders on the server, where there is no window and no extension.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { Step } from '~/components/setup-step'
import { Button } from '~/components/ui/button'
import { useCopy } from '~/components/viewer/use-copy'
import { useActiveOrg, type OrgSummary } from '~/lib/org'
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
 * `orgs` is the set of workspaces the extension holds a key for *on this
 * origin* — 1.2.0 keeps one link per workspace, so linking adds a destination
 * rather than replacing one. Extensions at 1.1.x and older omit the field
 * entirely; they get `[]` and fall back to the single-link `linked`/`serverUrl`
 * pair below.
 */
type Presence = {
  version: string
  linked: boolean
  serverUrl: string
  orgs: { id: string; name: string }[]
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
function linkExtension(apiToken: string, org: { id: string; name: string }): Promise<LinkResult> {
  return new Promise((resolve) => {
    const runtime = window.chrome?.runtime
    if (!runtime) {
      resolve({ ok: false, error: NO_ANSWER })
      return
    }
    try {
      runtime.sendMessage(
        EXTENSION_ID,
        { type: 'handback:link', apiToken, orgId: org.id, orgName: org.name },
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
    orgs: readLinkedOrgs(response),
  }
}

/**
 * A missing `orgs` means an extension too old to know about multi-workspace
 * links — not a malformed reply — so it reads as an empty list. When the field
 * is there it has to be an array, and anything in it that isn't a plain
 * `{ id, name }` pair is dropped rather than sinking the whole ping.
 */
function readLinkedOrgs(response: object): { id: string; name: string }[] {
  if (!('orgs' in response)) return []
  const { orgs } = response
  if (!Array.isArray(orgs)) return []
  // Array.isArray widens to any[]; hold it as unknown[] so each element still
  // has to be narrowed before it is read.
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

export function RecorderPage() {
  const { org, orgsLoaded } = useActiveOrg()

  if (!org) {
    return orgsLoaded ? (
      <div className="max-w-3xl">
        <h1 className="font-display text-3xl font-semibold">Set up the recorder</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Name a workspace first —{' '}
          <Link to="/app" className="text-primary underline underline-offset-4">
            head to the inbox
          </Link>
          . Recordings belong to a workspace, so there has to be one to belong to.
        </p>
      </div>
    ) : (
      <p className="text-muted-foreground text-sm">Loading…</p>
    )
  }

  return <Recorder key={org.id} org={org} />
}

type Phase = 'idle' | 'linking' | 'linked' | 'failed'

function Recorder({ org }: { org: OrgSummary }) {
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
  const connection = useQuery(trpc.tokens.connection.queryOptions({ orgId: org.id }))
  const canConnect = connection.data?.canConnect ?? true
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
          loud, and the recording, transcript, and console errors land in {org.name}'s inbox as a
          brief an agent can act on.
        </p>
      </header>

      {!canConnect ? (
        <GuestNotice />
      ) : (
        <>
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
            title="Link this workspace"
            blurb={
              isLinkedTo(presence, org.id, origin)
                ? `The recorder holds a key to ${org.name}. Pick it as the destination in the panel when you send.`
                : `One click hands the recorder a key to ${org.name} — no tokens to copy. Recordings upload straight to this inbox.`
            }>
            <LinkStep org={org} origin={origin} presence={presence} />
          </Step>

          <Step n="03" title="Record" blurb="That's the whole setup.">
            <ul className="text-muted-foreground space-y-2 text-sm">
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
                  Hit <strong>Record</strong>, pick the tab or screen, and talk — say what you
                  expected and what happened instead.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-cobalt">·</span>
                <span>
                  <code className="font-mono text-xs">Alt+Shift+M</code> marks a moment;{' '}
                  <code className="font-mono text-xs">Alt+Shift+D</code> draws on the page in ink.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-cobalt">·</span>
                <span>
                  Hit <strong>Send to Handback</strong> when you're done — the gripe lands in the
                  inbox here, ready for an agent.
                </span>
              </li>
            </ul>
          </Step>
        </>
      )}

      <CliAside origin={origin} />
    </div>
  )
}

/**
 * "Does the extension already hold a key to *this* workspace?" — the answer a
 * 1.2.0 extension gives by listing the org, and the one an older extension can
 * only approximate: it reports a single link, so a match on this origin is the
 * best it can say.
 */
function isLinkedTo(presence: Presence | null, orgId: string, origin: string): boolean {
  if (presence === null) return false
  if (presence.orgs.length > 0) return presence.orgs.some((o) => o.id === orgId)
  return presence.linked && presence.serverUrl === origin
}

/** The workspace this link will point at. Hidden for anyone with a single one. */
function WorkspacePicker() {
  const { orgs, org, setActiveOrgId } = useActiveOrg()
  if (orgs.length < 2 || !org) return null
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">Workspace</span>
      <select
        value={org.id}
        onChange={(e) => setActiveOrgId(e.target.value)}
        className="border-input bg-background h-9 rounded-md border px-2 text-sm">
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function LinkStep({
  org,
  origin,
  presence,
}: {
  org: OrgSummary
  origin: string
  presence: Presence | null
}) {
  const trpc = useTRPC()
  const [phase, setPhase] = useState<Phase>('idle')
  const [minted, setMinted] = useState<string | null>(null)

  const create = useMutation(
    trpc.tokens.create.mutationOptions({
      onSuccess: async (result) => {
        setMinted(result.token)
        const outcome = await linkExtension(result.token, { id: org.id, name: org.name })
        setPhase(outcome.ok ? 'linked' : 'failed')
      },
      onError: () => setPhase('idle'),
    })
  )

  const link = useCallback(() => {
    setPhase('linking')
    create.mutate({ orgId: org.id, name: 'recorder — chrome' })
  }, [create, org.id])

  const linkedThisOrg = isLinkedTo(presence, org.id, origin)
  // Other workspaces on this same Handback that the recorder can already reach.
  // Linking adds to this list; it never replaces it.
  const otherLinked = presence === null ? [] : presence.orgs.filter((o) => o.id !== org.id)
  // Linked, but at a different Handback entirely — only an old single-link
  // extension can say this, since a 1.2.0 one lists per-origin workspaces.
  // Violet, not amber — ui.md forbids the warm hues, and this is a "heads up",
  // not a failure.
  const linkedElsewhere =
    presence !== null &&
    presence.linked &&
    presence.orgs.length === 0 &&
    presence.serverUrl !== origin
  const detectedHere = linkedThisOrg
  // The banner distinguishes "was already linked when you arrived" from "you
  // just linked it", so it stays keyed to phase. The *button* must not: the
  // moment linking succeeds the action is done, and offering a primary
  // "Link <org>" under a green "Linked." banner reads as a failed click.
  // presence lags a poll tick behind, so phase carries it until it catches up.
  const linkedHere = detectedHere || phase === 'linked'
  const alreadyHere = detectedHere && phase === 'idle'
  const busy = phase === 'linking' || create.isPending

  return (
    <div className="space-y-4">
      <WorkspacePicker />

      {linkedElsewhere && (
        <div className="border-review/40 bg-review-wash text-review rounded-md border p-4 text-sm">
          The recorder is linked to <span className="font-mono text-xs">{presence.serverUrl}</span>.
          Linking here points it at this workspace instead.
        </div>
      )}

      {otherLinked.length > 0 && !linkedThisOrg && phase === 'idle' && (
        <div className="border-review/40 bg-review-wash text-review rounded-md border p-4 text-sm">
          The recorder is already linked to {otherLinked.map((o) => o.name).join(', ')}. Linking
          adds {org.name} as a destination — you pick where each recording goes from the recorder
          panel.
        </div>
      )}

      {alreadyHere && (
        <div className="border-approve/40 bg-approve-wash flex items-center gap-3 rounded-md border p-4">
          <span className="bg-approve size-2 shrink-0 rounded-full" />
          <p className="text-approve text-sm font-medium">Already linked to {org.name}.</p>
        </div>
      )}

      {phase === 'linked' && (
        <div className="border-approve/40 bg-approve-wash flex items-center gap-3 rounded-md border p-4">
          <span className="bg-approve size-2 shrink-0 rounded-full" />
          <p className="text-approve text-sm font-medium">
            Linked. {org.name} is now a destination in the recorder — pick it in the panel when you
            send. You can close this page.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant={linkedHere ? 'outline' : 'default'}
          disabled={presence === null || busy}
          onClick={link}>
          {busy ? 'Linking…' : linkedHere ? 'Re-link' : `Link ${org.name}`}
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
          <Link to="/team" className="text-primary underline underline-offset-4">
            Team → API tokens
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
            <Link to="/team" className="text-primary underline underline-offset-4">
              Team → API tokens
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
              <code className="font-mono text-xs">chrome://extensions</code> — your workspace link
              survives the update.
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

function GuestNotice() {
  return (
    <div className="border-border bg-card rounded-xl border p-8">
      <h2 className="font-display text-2xl font-semibold">You're a guest on this workspace</h2>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        The recorder uploads with a workspace token, and only full members can hold one. Ask an
        owner for full access, then come back — recording itself takes about a minute to set up.
      </p>
    </div>
  )
}

function CliAside({ origin }: { origin: string }) {
  return (
    <section className="border-border border-t pt-6">
      <h2 className="font-display text-xl font-semibold">Prefer the command line?</h2>
      <p className="text-muted-foreground mt-2 text-sm">
        A gripe folder pushes straight up with the CLI:
      </p>
      <pre className="border-border bg-muted/60 mt-3 overflow-x-auto rounded-md border p-3 font-mono text-xs">
        HANDBACK_TOKEN=hb_… bun cli/push.ts &lt;gripe-folder&gt; --server {origin}
      </pre>
    </section>
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
