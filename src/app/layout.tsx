import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useRevalidator,
  useRouteLoaderData,
} from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Wordmark } from '~/components/logo'
import { authClient } from '~/lib/auth-client'
import { SpaceProvider, useActiveSpace } from '~/lib/space'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import type { RootLoaderData } from './routes'

const APP_PREFIXES = [
  '/app',
  '/walkthroughs',
  '/team',
  '/projects',
  '/recorder',
  '/connect',
  '/admin',
]

export function Layout() {
  const data = useRouteLoaderData('root') as RootLoaderData | undefined
  const session = data?.session ?? null
  const location = useLocation()
  const inApp = session !== null && APP_PREFIXES.some((p) => location.pathname.startsWith(p))

  return (
    <SpaceProvider enabled={session !== null}>
      {inApp ? <AppHeader email={session!.user.email} /> : <MarketingHeader signedIn={!!session} />}
      <main className={inApp ? 'mx-auto w-full max-w-6xl px-6 py-8' : ''}>
        <Outlet />
      </main>
      {!inApp && <MarketingFooter />}
    </SpaceProvider>
  )
}

function MarketingHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="border-border border-b">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
        <Link to="/" aria-label="Handback home">
          <Wordmark />
        </Link>
        <div className="ml-auto flex items-center gap-5 text-sm">
          {signedIn ? (
            <Link
              to="/app"
              className="bg-primary text-primary-foreground rounded-md px-4 py-2 font-medium hover:opacity-90">
              Open the inbox
            </Link>
          ) : (
            <>
              <Link to="/sign-in" className="text-muted-foreground hover:text-foreground">
                Sign in
              </Link>
              <Link
                to="/sign-up"
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 font-medium hover:opacity-90">
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  )
}

function AppHeader({ email }: { email: string }) {
  const navigate = useNavigate()
  const revalidator = useRevalidator()
  const trpc = useTRPC()
  const { space } = useActiveSpace()
  const adminStatus = useQuery(trpc.admin.status.queryOptions())

  async function signOut() {
    await authClient.signOut()
    navigate('/', { replace: true })
    revalidator.revalidate()
  }

  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
      isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
    )

  return (
    <header className="border-border bg-card border-b">
      <nav className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
        <Link to="/app" aria-label="Handback inbox">
          <Wordmark />
        </Link>
        <SpaceSwitcher />
        <div className="ml-2 flex items-center gap-1">
          <NavLink to="/app" className={tab} end>
            Inbox
          </NavLink>
          <NavLink to="/projects" className={tab}>
            Projects
          </NavLink>
          {space.teamId && (
            <NavLink to="/team" className={tab}>
              Team
            </NavLink>
          )}
          <NavLink to="/recorder" className={tab}>
            Recorder
          </NavLink>
          <NavLink to="/connect" className={tab}>
            Connect
          </NavLink>
          {adminStatus.data?.isAdmin && (
            <NavLink to="/admin" className={tab}>
              Admin
            </NavLink>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-muted-foreground hidden sm:inline">{email}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={signOut}>
            Sign out
          </button>
        </div>
      </nav>
    </header>
  )
}

/**
 * The space menu. It renders even for an account with nothing but Personal,
 * because the menu is also where a team gets created — and a lone personal
 * space is exactly the account most likely to want one.
 */
function SpaceSwitcher() {
  const trpc = useTRPC()
  const { spaces, space, setActiveSpace } = useActiveSpace()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const wrap = useRef<HTMLDivElement | null>(null)
  const entitlements = useQuery(trpc.teams.entitlements.queryOptions())

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const item = 'w-full rounded px-2 py-1.5 text-left text-sm'

  return (
    <div className="relative" ref={wrap}>
      <button
        type="button"
        aria-label="Space"
        onClick={() => setOpen((o) => !o)}
        className="border-input bg-background text-foreground flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium">
        {space.name}
        <ChevronDown className="size-3.5" />
      </button>

      {open && (
        <div className="bg-card border-border absolute z-50 mt-1 min-w-52 rounded-md border p-1 shadow-md">
          {spaces.map((s) => (
            <button
              key={s.teamId ?? 'personal'}
              type="button"
              onClick={() => {
                setActiveSpace(s.teamId)
                setOpen(false)
              }}
              className={cn(
                item,
                'flex items-center gap-2',
                s.teamId === space.teamId ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              )}>
              <span className="truncate">{s.name}</span>
            </button>
          ))}
          <div className="border-border my-1 border-t" />
          {/* No affordance until the answer is in — flashing the mailto fallback
              at an entitled user reads as "you can't" for a beat on every open. */}
          {entitlements.isPending ? (
            <div className={cn(item, 'text-muted-foreground')}>…</div>
          ) : entitlements.data?.canCreateTeams ? (
            <button
              type="button"
              onClick={() => {
                setCreating(true)
                setOpen(false)
              }}
              className={cn(item, 'hover:bg-accent/50')}>
              New team…
            </button>
          ) : (
            <a
              href="mailto:sal@dested.com?subject=Handback%20teams"
              className={cn(item, 'text-muted-foreground hover:bg-accent/50 block')}>
              Create a team — write us
            </a>
          )}
        </div>
      )}

      {creating && <NewTeamModal onClose={() => setCreating(false)} />}
    </div>
  )
}

function NewTeamModal({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC()
  const { refreshTeams, setActiveSpace } = useActiveSpace()
  const [name, setName] = useState('')

  const create = useMutation(
    trpc.teams.create.mutationOptions({
      onSuccess: (result) => {
        refreshTeams()
        setActiveSpace(result.id)
        onClose()
      },
    })
  )

  const trimmed = name.trim()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New team"
        className="bg-card border-border w-80 rounded-xl border p-6 shadow-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!trimmed || create.isPending) return
            create.mutate({ name: trimmed })
          }}>
          <div className="space-y-2">
            <Label htmlFor="new-team-name">Team name</Label>
            <Input
              id="new-team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Design"
              maxLength={80}
              autoFocus
              required
            />
          </div>
          {create.isError && <p className="text-destructive text-sm">{create.error.message}</p>}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={create.isPending || !trimmed}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function MarketingFooter() {
  return (
    <footer className="border-border mt-24 border-t">
      <div className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-sm">
        <Wordmark className="text-foreground" />
        <span>Every fix, handed back.</span>
        <Link className="hover:text-foreground" to="/privacy">
          Privacy
        </Link>
        <Link className="hover:text-foreground" to="/terms">
          Terms
        </Link>
        <span className="ml-auto">© 2026 Handback</span>
      </div>
    </footer>
  )
}
