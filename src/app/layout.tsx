import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useRevalidator,
  useRouteLoaderData,
} from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Wordmark } from '~/components/logo'
import { authClient } from '~/lib/auth-client'
import { OrgProvider, useActiveOrg } from '~/lib/org'
import { useTRPC } from '~/lib/trpc'
import { cn } from '~/lib/utils'
import type { RootLoaderData } from './routes'

const APP_PREFIXES = ['/app', '/gripes', '/team', '/projects', '/admin']

export function Layout() {
  const data = useRouteLoaderData('root') as RootLoaderData | undefined
  const session = data?.session ?? null
  const location = useLocation()
  const inApp = session !== null && APP_PREFIXES.some((p) => location.pathname.startsWith(p))

  return (
    <OrgProvider enabled={session !== null}>
      {inApp ? <AppHeader email={session!.user.email} /> : <MarketingHeader signedIn={!!session} />}
      <main className={inApp ? 'mx-auto w-full max-w-6xl px-6 py-8' : ''}>
        <Outlet />
      </main>
      {!inApp && <MarketingFooter />}
    </OrgProvider>
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
  const { orgs, org, setActiveOrgId } = useActiveOrg()
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
        {orgs.length > 1 && org && (
          <select
            aria-label="Organization"
            className="border-input bg-background text-foreground rounded-md border px-2 py-1 text-sm"
            value={org.id}
            onChange={(e) => setActiveOrgId(e.target.value)}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        {orgs.length === 1 && org && (
          <span className="text-muted-foreground text-sm font-medium">{org.name}</span>
        )}
        <div className="ml-2 flex items-center gap-1">
          <NavLink to="/app" className={tab} end>
            Inbox
          </NavLink>
          <NavLink to="/projects" className={tab}>
            Projects
          </NavLink>
          <NavLink to="/team" className={tab}>
            Team
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
