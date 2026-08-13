import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useRevalidator,
  useRouteLoaderData,
} from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Wordmark } from '~/components/logo'
import { authClient } from '~/lib/auth-client'
import { SpaceProvider, clearIdentity } from '~/lib/space'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import type { RootLoaderData } from './routes'

const APP_PREFIXES = [
  '/app',
  '/walkthroughs',
  '/team',
  '/projects',
  // '/record' before '/recorder' is not just tidiness: the guard is a
  // `startsWith`, and without its own entry '/record' matches nothing here
  // ('/record' does not start with '/recorder') and falls through to the
  // marketing shell — no app header, no max-w-6xl container, no padding.
  '/record',
  '/recorder',
  '/phone',
  '/upload',
  '/connect',
  '/admin',
]

export function Layout() {
  const data = useRouteLoaderData('root') as RootLoaderData | undefined
  const session = data?.session ?? null
  const location = useLocation()
  const inApp = session !== null && APP_PREFIXES.some((p) => location.pathname.startsWith(p))
  // /admin runs its own sidebar shell edge to edge; the shared container would
  // box it in and double the padding.
  const fullBleed = inApp && location.pathname.startsWith('/admin')

  return (
    <SpaceProvider enabled={session !== null}>
      {inApp ? <AppHeader email={session!.user.email} /> : <MarketingHeader signedIn={!!session} />}
      <main
        className={inApp ? (fullBleed ? 'flex w-full' : 'mx-auto w-full max-w-6xl px-6 py-8') : ''}>
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
              Open Handback
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
  const queryClient = useQueryClient()
  const adminStatus = useQuery(trpc.admin.status.queryOptions())

  async function signOut() {
    await authClient.signOut()
    // The cache holds this account's teams and inbox; the next sign-in on this
    // browser must not inherit them.
    clearIdentity(queryClient)
    navigate('/', { replace: true })
    revalidator.revalidate()
  }

  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
      isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
    )

  return (
    <header className="border-border bg-card border-b">
      {/* One row on md+; on a phone the tab list takes `order-last w-full` and
          wraps into its own swipeable second row. The tabs render ONCE — a
          hidden duplicate would double every nav locator (e2e finds "Team"
          twice) and ship two DOMs to keep in sync. */}
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link to="/app" aria-label="Handback walkthroughs" className="shrink-0">
          <Wordmark />
        </Link>
        <div className="order-last flex w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] md:order-none md:ml-2 md:w-auto md:overflow-visible [&::-webkit-scrollbar]:hidden">
          <NavLink to="/app" className={tab} end>
            Walkthroughs
          </NavLink>
          <NavLink to="/projects" className={tab}>
            Projects
          </NavLink>
          {/* Always, and plural. The inbox spans every space now, so the header
              no longer knows which one you are "in" — and a Teams tab that
              appears and disappears was the switcher's tell. */}
          <NavLink to="/team" className={tab}>
            Teams
          </NavLink>
          {/* Record is the verb, Extension is the install. They used to be one
              tab called "Recorder", which stopped being true the moment the
              website could record on its own — and "Record"/"Recorder" side by
              side reads as a typo. */}
          <NavLink to="/record" className={tab}>
            Record
          </NavLink>
          <NavLink to="/recorder" className={tab}>
            Extension
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
        <div className="ml-auto flex shrink-0 items-center gap-3 text-sm">
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

/* The header's SpaceSwitcher and its NewTeamModal died with the space-as-mode
   model (2026-08-03): the inbox spans every space, and team creation lives on
   the Teams page. */

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
