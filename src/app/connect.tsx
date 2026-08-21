// /connect — the page that turns "someone recorded a walkthrough" into "my agent can
// read it."
//
// The whole page is one button and one paste. Landing here means you need an
// agent connected, and because a raw token is shown exactly once and is never
// recoverable, minting a fresh one is always the right answer — so the page just
// does it. One click mints a token, bakes it into the `claude mcp add` command,
// and puts the Copy button under your cursor. Naming the token is an optional
// correction afterwards, never a gate in front.
//
// Everything else on the page — the tools reference, disconnect instructions,
// the token list — is reference material and sits below that path, unnumbered.

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Terminal } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Step, autoTokenName } from '~/components/setup-step'
import { TokenLimitNotice, TokenManager, isTokenLimitError } from '~/components/token-manager'
import { useCopy } from '~/components/viewer/use-copy'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'

/** Stands in for a real token in the inert preview command. Never copyable. */
const TOKEN_PLACEHOLDER = 'hb_…'

type Agent = 'claude-code' | 'codex'

const AGENTS: Array<{ id: Agent; label: string; soon: boolean }> = [
  { id: 'claude-code', label: 'Claude Code', soon: false },
  { id: 'codex', label: 'OpenAI Codex', soon: true },
]

/** A token this page minted, held in memory only — reload and the raw value is gone. */
type Minted = { token: string; id: string; name: string }

export function ConnectPage() {
  const [agent, setAgent] = useState<Agent>('claude-code')
  // window is absent during SSR; render the production host, then correct it on
  // mount so a local dev session gets a command that points at localhost.
  const [origin, setOrigin] = useState('https://handback.dev')
  // Same story for the OS: assume POSIX for SSR, then correct on mount. A `\`
  // line-continuation is a Unix-shell thing — cmd and PowerShell both treat a
  // trailing backslash as literal and run only the first line — so a Windows
  // visitor gets the command on one line instead.
  const [isWindows, setIsWindows] = useState(false)
  useEffect(() => {
    setOrigin(window.location.origin)
    setIsWindows(/win/i.test(navigator.userAgent))
  }, [])

  const trpc = useTRPC()
  const connection = useQuery({
    ...trpc.tokens.connection.queryOptions(),
    // A live check: once the page is open, someone is actively wiring an agent
    // up and wants to see it land.
    refetchInterval: 5000,
  })

  const [minted, setMinted] = useState<Minted | null>(null)

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
          Every walkthrough here was recorded for you: someone walked through the problem out loud,
          and the recorder wrote it up as a brief. One button below, one paste into your terminal,
          and your agent can pull that brief — narration, keyframes, console errors and all — fix
          the thing, and hand it back for a human to sign off.
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
      ) : (
        <ClaudeCodeSteps
          origin={origin}
          isWindows={isWindows}
          minted={minted}
          onMinted={setMinted}
          tokenCount={connection.data?.tokenCount ?? 0}
          lastUsedAt={connection.data?.lastUsedAt ?? null}
        />
      )}

      <ToolReference />
      {agent === 'claude-code' && <WorkOne />}
      {agent === 'claude-code' && <Disconnect origin={origin} />}
      <TokenManager />
    </div>
  )
}

/**
 * The one-click path. Two numbered steps, and the first is a single button:
 * everything a person has to decide (which token, what to call it, where the
 * secret goes) is decided for them, because there is no answer here that isn't
 * "mint a fresh one and put it in the command".
 */
function ClaudeCodeSteps({
  origin,
  isWindows,
  minted,
  onMinted,
  tokenCount,
  lastUsedAt,
}: {
  origin: string
  isWindows: boolean
  minted: Minted | null
  onMinted: (minted: Minted) => void
  tokenCount: number
  lastUsedAt: string | null
}) {
  const command = mcpCommand(origin, minted?.token ?? TOKEN_PLACEHOLDER, isWindows)

  return (
    <div className="space-y-12">
      <Step
        n="01"
        title="Add Handback to Claude Code"
        blurb="One command, any directory. Nothing is installed and there's no repo to clone — Claude Code talks to Handback over HTTP.">
        <CommandGate command={command} minted={minted} onMinted={onMinted} />
        <ul className="text-muted-foreground mt-5 space-y-2 text-sm">
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
              MCP servers load when a session starts — <strong>restart Claude Code</strong> (or open
              a new session) before the tools show up.
            </span>
          </li>
        </ul>
      </Step>

      <Step
        n="02"
        title="Check it worked"
        blurb="Start a session and ask for the queue. If the tools are wired up, Claude answers from your inbox instead of guessing.">
        <PromptBlock>list my handback walkthroughs</PromptBlock>
        <ConnectionStatus lastUsedAt={lastUsedAt} tokenCount={tokenCount} />
      </Step>
    </div>
  )
}

function mcpCommand(origin: string, token: string, isWindows = false): string {
  // Windows shells (cmd, PowerShell) don't honour a trailing-backslash line
  // continuation, so give them the whole command on one line. POSIX shells get
  // the readable multi-line form.
  if (isWindows) {
    return `claude mcp add --transport http handback ${origin}/mcp --header "Authorization: Bearer ${token}"`
  }
  return [
    'claude mcp add --transport http handback \\',
    `  ${origin}/mcp \\`,
    `  --header "Authorization: Bearer ${token}"`,
  ].join('\n')
}

/**
 * Before the click: the command rendered visibly inert — dimmed, no Copy button
 * — so nobody walks off with a placeholder in their config. After it: the real
 * thing, with the token already in it and Copy under the cursor.
 */
function CommandGate({
  command,
  minted,
  onMinted,
}: {
  command: string
  minted: Minted | null
  onMinted: (minted: Minted) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const create = useMutation(
    trpc.tokens.create.mutationOptions({
      onSuccess: (result) => {
        onMinted({ token: result.token, id: result.id, name: result.name })
        void queryClient.invalidateQueries({ queryKey: trpc.tokens.connection.queryKey() })
        void queryClient.invalidateQueries({ queryKey: trpc.tokens.list.queryKey() })
      },
    })
  )

  if (minted) {
    return (
      <div className="space-y-4">
        <CommandBlock command={command} />
        <p className="text-muted-foreground text-sm">
          Your token is already in that command. It's shown here once and never again — only its
          hash is stored.
        </p>
        <TokenAftercare minted={minted} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Button
        type="button"
        size="lg"
        disabled={create.isPending}
        onClick={() =>
          create.mutate({ name: autoTokenName('Claude Code', navigator.userAgent, new Date()) })
        }>
        {create.isPending ? 'Building your command…' : 'Create my command'}
      </Button>
      <p className="text-muted-foreground text-sm">
        Mints an API token for your account — it reaches your personal space and every team you're
        in.
      </p>
      {create.isError &&
        (isTokenLimitError(create.error) ? (
          <TokenLimitNotice />
        ) : (
          <p className="text-destructive text-sm">{create.error.message}</p>
        ))}
      <CommandBlock command={command} inert />
    </div>
  )
}

/**
 * The two things you might still want after the copy, both folded away: the bare
 * token (for a config file or the CLI) and a better name than the one we guessed.
 * Neither is on the path to a working agent, so neither gets to sit on it.
 */
function TokenAftercare({ minted }: { minted: Minted }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [name, setName] = useState(minted.name)
  const [saved, setSaved] = useState(minted.name)
  const [renaming, setRenaming] = useState(false)

  const rename = useMutation(
    trpc.tokens.rename.mutationOptions({
      onSuccess: (_result, variables) => {
        setSaved(variables.name)
        setRenaming(false)
        void queryClient.invalidateQueries({ queryKey: trpc.tokens.list.queryKey() })
      },
    })
  )

  return (
    <div className="space-y-3">
      <details className="group">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none text-sm underline decoration-dotted underline-offset-4 marker:content-['']">
          Need the token on its own?
        </summary>
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground text-sm">
            For the CLI, the recorder's settings, or a config file you edit by hand.
          </p>
          <CopyRow value={minted.token} />
        </div>
      </details>

      {renaming ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = name.trim()
            if (!trimmed || rename.isPending) return
            rename.mutate({ tokenId: minted.id, name: trimmed })
          }}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoComplete="off"
            aria-label="Token name"
            className="h-8 max-w-64 text-sm"
          />
          <Button type="submit" variant="outline" size="sm" disabled={rename.isPending}>
            {rename.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setName(saved)
              setRenaming(false)
            }}>
            Cancel
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">
          Filed as <span className="text-foreground font-medium">{saved}</span>.{' '}
          <button
            type="button"
            className="text-primary underline underline-offset-4"
            onClick={() => setRenaming(true)}>
            Rename
          </button>
        </p>
      )}
      {rename.isError && <p className="text-destructive text-sm">{rename.error.message}</p>}
    </div>
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
            mistake, hit <span className="font-medium">Create my command</span> again and run the
            new one. Leaving a team removes that team from what your tokens can see — revoke a token
            here to cut it off entirely.
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

/** Not a setup step — the first thing worth saying once setup is done. */
function WorkOne() {
  return (
    <section className="border-border border-t pt-6">
      <h2 className="font-display text-xl font-semibold">Putting it to work</h2>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        A walkthrough carries its own instructions — report.md is written for an agent, not for a
        person. Say something like this and it takes it from there.
      </p>
      <div className="mt-5">
        <PromptBlock>
          Pull the newest open walkthrough from handback, read its report.md, and fix it. Set it to
          in_review when the fix is up.
        </PromptBlock>
      </div>
      <p className="text-muted-foreground mt-3 text-sm">
        Or hand it a specific one — every walkthrough page has a copyable prompt with its id in it.
      </p>
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

/**
 * A shell command, with the copy button that is the actual point of the page.
 * `inert` renders the preview: dimmed, and with no Copy button at all, because a
 * command carrying a placeholder token is one that must not be pasted anywhere.
 */
function CommandBlock({ command, inert = false }: { command: string; inert?: boolean }) {
  const { copied, copy } = useCopy()
  return (
    <div
      className={cn(
        'border-border bg-card relative rounded-md border',
        inert && 'bg-muted/30 opacity-60'
      )}>
      <div className="border-border text-muted-foreground flex items-center gap-2 border-b px-3 py-2">
        <Terminal className="size-3.5" />
        <span className="font-mono text-xs">terminal</span>
        {inert ? (
          <span className="ml-auto font-mono text-xs">preview</span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-7"
            onClick={() => void copy(command)}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </div>
      <pre
        className={cn(
          'overflow-x-auto p-4 font-mono text-xs leading-relaxed',
          // A placeholder command must not be selectable-and-pasteable either;
          // dimming alone still leaves a drag-select waiting to go wrong.
          inert && 'select-none'
        )}>
        {command}
      </pre>
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
          An agent reached Handback {relativeTime(lastUsedAt)}. You're connected.
        </p>
      </div>
    )
  }
  return (
    <div className="border-border bg-muted/40 mt-4 flex items-center gap-3 rounded-md border p-4">
      <span className="bg-muted-foreground/40 size-2 shrink-0 animate-pulse rounded-full" />
      <p className="text-muted-foreground text-sm">
        {tokenCount === 0
          ? 'No token yet — hit the button in step 01. This line turns green the moment an agent calls in.'
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

const TOOLS: Array<{ name: string; does: string }> = [
  {
    name: 'list_walkthroughs',
    does: 'Your walkthroughs across personal and teams, newest first. Filter by status.',
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
        Three tools. They read and write every space your token's owner belongs to — each
        walkthrough carries a <code className="font-mono text-xs">space</code> field.
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
