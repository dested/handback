// /connect — the page that turns "someone recorded a walkthrough" into "my agent can
// read it." Three numbered steps in the editorial style (ui.md): mint a token,
// paste one command, confirm the agent landed.
//
// The whole design goal is that step 2's command is copy-paste-complete. A
// token minted in step 1 is held in memory and interpolated into the command
// below it, so nobody has to shuttle a secret between two screens. Reload the
// page and it's gone — the raw token exists exactly once, at creation.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Terminal } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Step } from '~/components/setup-step'
import { useCopy } from '~/components/viewer/use-copy'
import { useActiveOrg, type OrgSummary } from '~/lib/org'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

/** The placeholder that stands in for a real token until one is minted. */
const TOKEN_PLACEHOLDER = 'hb_your_token_here'

type Agent = 'claude-code' | 'codex'

const AGENTS: Array<{ id: Agent; label: string; soon: boolean }> = [
  { id: 'claude-code', label: 'Claude Code', soon: false },
  { id: 'codex', label: 'OpenAI Codex', soon: true },
]

export function ConnectPage() {
  const { org, orgsLoaded } = useActiveOrg()

  if (!org) {
    return orgsLoaded ? (
      <Prose>
        <h1 className="font-display text-3xl font-semibold">Connect your coding agent</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Your workspace is still being set up —{' '}
          <Link to="/app" className="text-primary underline underline-offset-4">
            head to the inbox
          </Link>
          . Tokens belong to a workspace, so there has to be one to belong to.
        </p>
      </Prose>
    ) : (
      <p className="text-muted-foreground text-sm">Loading…</p>
    )
  }

  return <Connect key={org.id} org={org} />
}

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="max-w-3xl">{children}</div>
}

function Connect({ org }: { org: OrgSummary }) {
  const [agent, setAgent] = useState<Agent>('claude-code')
  // window is absent during SSR; render the production host, then correct it on
  // mount so a local dev session gets a command that points at localhost.
  const [origin, setOrigin] = useState('https://handback.dev')
  useEffect(() => setOrigin(window.location.origin), [])

  const trpc = useTRPC()
  const connection = useQuery({
    ...trpc.tokens.connection.queryOptions({ orgId: org.id }),
    // Step 3 is a live check: once the page is open, someone is actively
    // wiring an agent up and wants to see it land.
    refetchInterval: 5000,
  })

  const [freshToken, setFreshToken] = useState<string | null>(null)
  const token = freshToken ?? TOKEN_PLACEHOLDER
  const canConnect = connection.data?.canConnect ?? true

  return (
    <div className="max-w-3xl space-y-12">
      <header className="space-y-4">
        <p className="text-cobalt font-mono text-xs tracking-widest uppercase">
          Are you the engineer who fixes these?
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Connect your coding agent
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          Every walkthrough in {org.name} was recorded for you: someone walked through the problem
          out loud, and the recorder wrote it up as a brief. Point your agent at this workspace and
          it can pull that brief — narration, keyframes, console errors and all — fix the thing, and
          hand it back for a human to sign off.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {AGENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAgent(a.id)}
            className={cn(
              'flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
              agent === a.id
                ? 'border-cobalt bg-cobalt-wash text-cobalt'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}>
            {a.label}
            {a.soon && (
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[0.625rem] tracking-wide uppercase">
                soon
              </span>
            )}
          </button>
        ))}
      </div>

      {agent === 'codex' ? (
        <CodexSoon />
      ) : !canConnect ? (
        <GuestNotice />
      ) : (
        <ClaudeCodeSteps
          org={org}
          origin={origin}
          token={token}
          hasFreshToken={freshToken !== null}
          onToken={setFreshToken}
          tokenCount={connection.data?.tokenCount ?? 0}
          lastUsedAt={connection.data?.lastUsedAt ?? null}
        />
      )}

      <ToolReference />
      {agent === 'claude-code' && canConnect && <Disconnect origin={origin} />}
      {canConnect && <TokenManager org={org} />}
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Formatted from UTC parts on purpose: locale formatting differs between the
// SSR runtime and the browser, which would break hydration.
function fmtDate(value: string | null) {
  if (!value) return 'never'
  const d = new Date(value)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/**
 * The management half: every token this workspace holds, and the door to a new
 * one. Step 01 above mints tokens for the flow; this is the list you come back
 * to when you need to revoke one.
 */
function TokenManager({ org }: { org: OrgSummary }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [rawToken, setRawToken] = useState<string | null>(null)

  const tokensQuery = useQuery(trpc.tokens.list.queryOptions({ orgId: org.id }))
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.tokens.list.queryKey({ orgId: org.id }) })
    void queryClient.invalidateQueries({
      queryKey: trpc.tokens.connection.queryKey({ orgId: org.id }),
    })
  }

  const create = useMutation(
    trpc.tokens.create.mutationOptions({
      onSuccess: (result) => {
        setRawToken(result.token)
        setName('')
        invalidate()
      },
    })
  )
  const revoke = useMutation(trpc.tokens.revoke.mutationOptions({ onSuccess: invalidate }))

  return (
    <section className="border-border border-t pt-6">
      <h2 className="font-display text-xl font-semibold">Your API tokens</h2>
      <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
        These authenticate the recorder, the CLI, and the MCP server. They're yours alone and scoped
        to {org.name}; revoking one disconnects whatever holds it.
      </p>

      <div className="mt-5 space-y-3">
        {tokensQuery.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}
        {tokensQuery.isError && (
          <p className="text-destructive text-sm">{tokensQuery.error.message}</p>
        )}
        {tokensQuery.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">No tokens yet.</p>
        )}
        {tokensQuery.data && tokensQuery.data.length > 0 && (
          <>
            <div className="border-border text-muted-foreground flex items-center gap-4 border-b pb-2 text-xs font-medium tracking-wide uppercase">
              <span className="min-w-0 flex-1">Name</span>
              <span className="w-20 shrink-0">Token</span>
              <span className="w-28 shrink-0">Created</span>
              <span className="w-28 shrink-0">Last used</span>
              <span className="w-20 shrink-0" />
            </div>
            <div className="divide-border divide-y">
              {tokensQuery.data.map((t) => (
                <div key={t.id} className="flex items-center gap-4 py-3">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</p>
                  <span className="w-20 shrink-0 font-mono text-xs">…{t.lastFour}</span>
                  <span className="text-muted-foreground w-28 shrink-0 font-mono text-xs">
                    {fmtDate(t.createdAt)}
                  </span>
                  <span className="text-muted-foreground w-28 shrink-0 font-mono text-xs">
                    {fmtDate(t.lastUsedAt)}
                  </span>
                  <div className="w-20 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={revoke.isPending}
                      onClick={() => {
                        if (!window.confirm(`Revoke "${t.name}"? Anything using it stops working.`))
                          return
                        revoke.mutate({ orgId: org.id, tokenId: t.id })
                      }}>
                      Revoke
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {revoke.isError && <p className="text-destructive text-sm">{revoke.error.message}</p>}
      </div>

      <form
        className="mt-6 max-w-xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = name.trim()
          if (!trimmed || create.isPending) return
          create.mutate({ orgId: org.id, name: trimmed })
        }}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1 space-y-2">
            <Label htmlFor="manage-token-name">New token</Label>
            <Input
              id="manage-token-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="laptop"
              maxLength={80}
              autoComplete="off"
              required
            />
          </div>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Creating…' : 'Create token'}
          </Button>
        </div>
        {create.isError && <p className="text-destructive text-sm">{create.error.message}</p>}
        {rawToken && (
          <div className="border-cobalt/40 bg-cobalt-wash space-y-2 rounded-md border p-4">
            <p className="text-cobalt text-sm font-medium">
              Copy it now — it won't be shown again.
            </p>
            <CopyRow value={rawToken} />
          </div>
        )}
      </form>
    </section>
  )
}

/**
 * Removing it is two independent things, and conflating them is how people end
 * up thinking they've revoked access when they've only tidied one laptop.
 * `claude mcp remove` stops *this machine* from calling; revoking the token
 * stops *anything* holding it, everywhere.
 */
function Disconnect({ origin }: { origin: string }) {
  return (
    <section className="border-border border-t pt-6">
      <h2 className="font-display text-xl font-semibold">Disconnecting</h2>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        Two separate steps, and you usually want both.
      </p>

      <div className="mt-5 space-y-6">
        <div>
          <h3 className="text-sm font-semibold">1. Remove the server from Claude Code</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Stops this machine from reaching Handback. The token stays valid.
          </p>
          <div className="mt-3">
            <CommandBlock command={['claude mcp list', 'claude mcp remove handback'].join('\n')} />
          </div>
          <ul className="text-muted-foreground mt-3 space-y-2 text-sm">
            <li className="flex gap-2">
              <span className="text-cobalt">·</span>
              <span>
                <code className="font-mono text-xs">claude mcp list</code> first — it prints every
                configured server and its scope, so you remove the right one.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-cobalt">·</span>
              <span>
                If you added it with <code className="font-mono text-xs">-s user</code>, remove it
                the same way:{' '}
                <code className="font-mono text-xs">claude mcp remove handback -s user</code>. A
                project-scoped copy and a user-scoped copy are different entries.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-cobalt">·</span>
              <span>
                Restart Claude Code afterwards — a running session keeps the tools it started with.
              </span>
            </li>
          </ul>
        </div>

        <div className="border-border border-t pt-5">
          <h3 className="text-sm font-semibold">2. Revoke the token</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            This is the one that actually cuts access. A token works from anywhere until it's
            revoked — another machine, an old shell profile, a CI job. Revoke it under{' '}
            <span className="font-medium">Your API tokens</span> at the bottom of this page, and
            anything still using it starts getting 401s immediately.
          </p>
          <p className="text-muted-foreground mt-3 text-sm">
            Tokens can't be un-revoked and the raw value is never recoverable — if you revoke by
            mistake, create a new one and re-run the add command with it. Removing a member from the
            workspace revokes their tokens automatically.
          </p>
        </div>
      </div>

      <p className="text-muted-foreground mt-6 text-sm">
        Nothing here deletes walkthroughs. Both steps are about access to{' '}
        <span className="font-mono text-xs">{origin}/mcp</span>, not about the recordings
        themselves.
      </p>
    </section>
  )
}

function ClaudeCodeSteps({
  org,
  origin,
  token,
  hasFreshToken,
  onToken,
  tokenCount,
  lastUsedAt,
}: {
  org: OrgSummary
  origin: string
  token: string
  hasFreshToken: boolean
  onToken: (token: string) => void
  tokenCount: number
  lastUsedAt: string | null
}) {
  const command = [
    'claude mcp add --transport http handback \\',
    `  ${origin}/mcp \\`,
    `  --header "Authorization: Bearer ${token}"`,
  ].join('\n')

  return (
    <div className="space-y-12">
      <Step
        n="01"
        title="Create an API token"
        blurb="It authenticates your agent as a member of this workspace. Only the hash is stored — the token itself is shown once, here, and never again.">
        <TokenMinter org={org} onToken={onToken} tokenCount={tokenCount} />
      </Step>

      <Step
        n="02"
        title="Add Handback to Claude Code"
        blurb="One command, any directory. Nothing is installed and there's no repo to clone — Claude Code talks to the workspace over HTTP.">
        <CommandBlock command={command} />
        {!hasFreshToken && (
          <p className="text-muted-foreground mt-3 text-sm">
            Swap <code className="font-mono text-xs">{TOKEN_PLACEHOLDER}</code> for a real token —
            or mint one in step 01 and this command fills itself in.
          </p>
        )}
        <ul className="text-muted-foreground mt-4 space-y-2 text-sm">
          <li className="flex gap-2">
            <span className="text-cobalt">·</span>
            <span>
              Add <code className="font-mono text-xs">-s user</code> to make Handback available in
              every project on this machine instead of just the current one.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-cobalt">·</span>
            <span>
              Already have a <code className="font-mono text-xs">handback</code> server configured?
              Run <code className="font-mono text-xs">claude mcp remove handback</code> first.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-cobalt">·</span>
            <span>
              MCP servers are loaded when a session starts — <strong>restart Claude Code</strong>{' '}
              (or open a new session) before the tools show up.
            </span>
          </li>
        </ul>
      </Step>

      <Step
        n="03"
        title="Check it worked"
        blurb="Start a session and ask for the queue. If the tools are wired up, Claude answers from your inbox instead of guessing.">
        <PromptBlock>list my handback walkthroughs</PromptBlock>
        <ConnectionStatus lastUsedAt={lastUsedAt} tokenCount={tokenCount} />
      </Step>

      <Step
        n="04"
        title="Work one"
        blurb="A walkthrough carries its own instructions — report.md is written for an agent, not for a person. Paste a line like this and the agent takes it from there.">
        <PromptBlock>
          Pull the newest open walkthrough from handback, read its report.md, and fix it. Set it to
          in_review when the fix is up.
        </PromptBlock>
        <p className="text-muted-foreground mt-3 text-sm">
          Or hand it a specific one — every walkthrough page has a copyable prompt with its id in
          it.
        </p>
      </Step>
    </div>
  )
}

function TokenMinter({
  org,
  onToken,
  tokenCount,
}: {
  org: OrgSummary
  onToken: (token: string) => void
  tokenCount: number
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [minted, setMinted] = useState<string | null>(null)

  const create = useMutation(
    trpc.tokens.create.mutationOptions({
      onSuccess: (result) => {
        setMinted(result.token)
        onToken(result.token)
        setName('')
        void queryClient.invalidateQueries({
          queryKey: trpc.tokens.connection.queryKey({ orgId: org.id }),
        })
      },
    })
  )

  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = name.trim()
          if (!trimmed || create.isPending) return
          create.mutate({ orgId: org.id, name: trimmed })
        }}>
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="connect-token-name">Name it after the machine or agent</Label>
          <Input
            id="connect-token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="claude code — laptop"
            maxLength={80}
            autoComplete="off"
            required
          />
        </div>
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          {create.isPending ? 'Creating…' : 'Create token'}
        </Button>
      </form>

      {create.isError && <p className="text-destructive mt-3 text-sm">{create.error.message}</p>}

      {minted && (
        <div className="border-cobalt/40 bg-cobalt-wash mt-4 space-y-2 rounded-md border p-4">
          <p className="text-cobalt text-sm font-medium">
            Copy it now — it won't be shown again. It's already in the command below.
          </p>
          <CopyRow value={minted} />
        </div>
      )}

      {!minted && tokenCount > 0 && (
        <p className="text-muted-foreground mt-4 text-sm">
          This workspace already has {tokenCount} active {tokenCount === 1 ? 'token' : 'tokens'}. If
          you still have one, use it below — otherwise create a fresh one; old tokens keep working
          until you revoke them under <span className="font-medium">Your API tokens</span> at the
          bottom of this page.
        </p>
      )}
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

/** A shell command, with the copy button that is the actual point of the page. */
function CommandBlock({ command }: { command: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className="border-border bg-card relative rounded-md border">
      <div className="border-border text-muted-foreground flex items-center gap-2 border-b px-3 py-2">
        <Terminal className="size-3.5" />
        <span className="font-mono text-xs">terminal</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-7"
          onClick={() => void copy(command)}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">{command}</pre>
    </div>
  )
}

/** Something you say to the agent, not something you run. */
function PromptBlock({ children }: { children: React.ReactNode }) {
  const [node, setNode] = useState<HTMLQuoteElement | null>(null)
  const { copied, copy } = useCopy()
  return (
    <div className="border-cobalt/30 bg-cobalt-wash/40 flex items-start gap-3 rounded-md border border-dashed p-4">
      <span className="text-cobalt font-mono text-sm">›</span>
      <blockquote ref={setNode} className="min-w-0 flex-1 text-sm leading-relaxed">
        {children}
      </blockquote>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0"
        onClick={() => void copy(node?.textContent ?? '')}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}

function ConnectionStatus({
  lastUsedAt,
  tokenCount,
}: {
  lastUsedAt: string | null
  tokenCount: number
}) {
  if (lastUsedAt) {
    return (
      <div className="border-approve/40 bg-approve-wash mt-4 flex items-center gap-3 rounded-md border p-4">
        <span className="bg-approve size-2 shrink-0 rounded-full" />
        <p className="text-approve text-sm font-medium">
          An agent reached this workspace {relativeTime(lastUsedAt)}. You're connected.
        </p>
      </div>
    )
  }
  return (
    <div className="border-border bg-muted/40 mt-4 flex items-center gap-3 rounded-md border p-4">
      <span className="bg-muted-foreground/40 size-2 shrink-0 animate-pulse rounded-full" />
      <p className="text-muted-foreground text-sm">
        {tokenCount === 0
          ? 'No token yet — start at step 01. This line turns green the moment an agent calls in.'
          : 'Waiting for the first call. This line turns green the moment an agent uses a token.'}
      </p>
    </div>
  )
}

/** Coarse and deliberately vague — this is reassurance, not telemetry. */
function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

function CodexSoon() {
  return (
    <div className="border-border bg-card rounded-xl border p-8">
      <h2 className="font-display text-2xl font-semibold">OpenAI Codex — soon</h2>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        Handback speaks MCP over plain HTTP, which is the same protocol Codex is growing support
        for. We're testing the setup end to end before we put instructions here, because a
        half-working connect flow is worse than none. If Codex is what your team runs,{' '}
        <a className="text-primary underline underline-offset-4" href="mailto:sal@dested.com">
          tell us
        </a>{' '}
        — it moves up the list.
      </p>
    </div>
  )
}

function GuestNotice() {
  return (
    <div className="border-border bg-card rounded-xl border p-8">
      <h2 className="font-display text-2xl font-semibold">You're a guest on this workspace</h2>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        API tokens read every walkthrough in a workspace, so only full members can create them. Ask
        an owner for access to the whole workspace, or have them run the agent side themselves.
      </p>
    </div>
  )
}

const TOOLS: Array<{ name: string; does: string }> = [
  {
    name: 'list_walkthroughs',
    does: "The workspace's walkthroughs, newest first. Filter by status.",
  },
  {
    name: 'get_walkthrough',
    does: 'One full brief: report.md, the transcript, and a link to the video and every keyframe.',
  },
  {
    name: 'set_walkthrough_status',
    does: 'open → in_review when the fix is up. A human marks it resolved.',
  },
]

function ToolReference() {
  return (
    <section className="border-border border-t pt-6">
      <h2 className="font-display text-xl font-semibold">What your agent gets</h2>
      <p className="text-muted-foreground mt-2 text-sm">
        Three tools. They read and write only the workspace its token belongs to.
      </p>
      <dl className="mt-5 space-y-3">
        {TOOLS.map((t) => (
          <div key={t.name} className="grid gap-1 sm:grid-cols-[14rem_1fr] sm:gap-4">
            <dt className="text-cobalt font-mono text-xs">{t.name}</dt>
            <dd className="text-muted-foreground text-sm">{t.does}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
