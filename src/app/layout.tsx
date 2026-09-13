import { useState } from 'react'
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useRevalidator,
  useRouteLoaderData,
} from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CircleDot,
  FolderKanban,
  Gauge,
  LayoutList,
  Plug,
  Puzzle,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Upload as UploadIcon,
  Users,
} from 'lucide-react'
import { Wordmark } from '~/components/logo'
import { Avatar } from '~/components/ui/avatar'
import { buttonVariants } from '~/components/ui/button'
import { projectColor } from '~/components/ui/project-tag'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuLink,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '~/components/ui/sidebar'
import { usePopover } from '~/components/viewer/overflow-menu'
import { authClient } from '~/lib/auth-client'
import { SpaceProvider, clearIdentity } from '~/lib/space'
import { useTRPC } from '~/lib/trpc'
import type { Session } from '../../server/auth'
import type { RootLoaderData } from './routes'

const APP_PREFIXES = [
  '/app',
  '/walkthroughs',
  '/team',
  '/projects',
  '/usage',
  '/upgrade',
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

/** Whether the search string carries `key=value` — how the query-param sidebar
 *  links (project/space) decide their own active state, since their path is
 *  always `/app`. */
function isQueryActive(search: string, key: string, value: string): boolean {
  return new URLSearchParams(search).get(key) === value
}

export function Layout() {
  const data = useRouteLoaderData('root') as RootLoaderData | undefined
  const session = data?.session ?? null
  const location = useLocation()
  const isAdmin = location.pathname.startsWith('/admin')
  const inApp = session !== null && APP_PREFIXES.some((p) => location.pathname.startsWith(p))

  if (session === null || !inApp) {
    return (
      <SpaceProvider enabled={session !== null}>
        <MarketingHeader signedIn={session !== null} />
        <main>
          <Outlet />
        </main>
        <MarketingFooter />
      </SpaceProvider>
    )
  }

  return (
    <SpaceProvider enabled>
      {isAdmin ? (
        // /admin runs its own sidebar shell edge to edge; nesting it inside the
        // app sidebar would stack two shells and double the chrome.
        <main className="flex w-full">
          <Outlet />
        </main>
      ) : (
        <AppShell session={session}>
          <Outlet />
        </AppShell>
      )}
    </SpaceProvider>
  )
}

function AppShell({ session, children }: { session: Session; children: React.ReactNode }) {
  const navigate = useNavigate()
  const revalidator = useRevalidator()
  const location = useLocation()
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const adminStatus = useQuery(trpc.admin.status.queryOptions())
  const ent = useQuery(trpc.teams.entitlements.queryOptions())
  const projects = useQuery(trpc.projects.all.queryOptions())
  const teams = useQuery(trpc.teams.mine.queryOptions())

  const email = session.user.email
  const displayName = session.user.name?.trim() || email

  async function signOut() {
    await authClient.signOut()
    // The cache holds this account's teams and inbox; the next sign-in on this
    // browser must not inherit them.
    clearIdentity(queryClient)
    navigate('/', { replace: true })
    revalidator.revalidate()
  }

  const { pathname, search } = location
  // /app and the walkthrough page own their full width (List + pane, the desk);
  // every other app page sits in the centred column.
  const fullBleed = pathname === '/app' || pathname.startsWith('/walkthroughs/')

  const isAdminUser = adminStatus.data?.isAdmin ?? false
  const showUpgrade = ent.data ? !ent.data.pro : false

  // First ten by name; the rest live on /projects.
  const projectList = [...(projects.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const topProjects = projectList.slice(0, 10)
  const teamList = teams.data ?? []

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        displayName={displayName}
        email={email}
        isAdmin={isAdminUser}
        showUpgrade={showUpgrade}
        onSignOut={signOut}
      />
      <SidebarProvider storageKey="handback.appSidebar">
        {/* The topbar owns the first 52px of the viewport; the sidebar starts
            under it and fills the rest. */}
        <Sidebar className="top-[52px] h-[calc(100dvh-52px)]">
          <SidebarHeader className="h-11 justify-end border-b-0">
            <SidebarTrigger className="group-data-[collapsed]/sidebar:ml-0" />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuLink
                    to="/app"
                    end
                    icon={LayoutList}
                    label="Walkthroughs"
                    active={pathname === '/app' && search === ''}
                  />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuLink to="/projects" icon={FolderKanban} label="Projects" />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuLink to="/team" icon={Users} label="Teams" />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuLink to="/connect" icon={Plug} label="Connect" />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>

            {topProjects.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel>Projects</SidebarGroupLabel>
                <SidebarMenu>
                  {topProjects.map((p) => (
                    <SidebarMenuItem key={p.id}>
                      <SidebarMenuLink
                        to={`/app?project=${p.id}`}
                        label={p.name}
                        swatch={projectColor(p.id)}
                        active={pathname === '/app' && isQueryActive(search, 'project', p.id)}
                      />
                    </SidebarMenuItem>
                  ))}
                  {projectList.length > 10 && (
                    <SidebarMenuItem>
                      <MutedLink to="/projects" label="All projects →" />
                    </SidebarMenuItem>
                  )}
                  <SidebarMenuItem>
                    <MutedLink to="/projects" label="+ New project" />
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
            )}

            {teamList.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel>Spaces</SidebarGroupLabel>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuLink
                      to="/app?space=personal"
                      label="Personal"
                      swatch="#9ca3af"
                      active={pathname === '/app' && isQueryActive(search, 'space', 'personal')}
                    />
                  </SidebarMenuItem>
                  {teamList.map((t) => (
                    <SidebarMenuItem key={t.id}>
                      <SidebarMenuLink
                        to={`/app?space=${t.id}`}
                        label={t.name}
                        swatch="#2f56d8"
                        active={pathname === '/app' && isQueryActive(search, 'space', t.id)}
                      />
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            )}

            <SidebarGroup>
              <SidebarGroupLabel>Capture</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuLink to="/record" icon={CircleDot} label="Record" />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuLink to="/upload" icon={UploadIcon} label="Upload" />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuLink to="/phone" icon={Smartphone} label="Phone" />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuLink to="/recorder" icon={Puzzle} label="Extension" />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuLink to="/usage" icon={Gauge} label="Usage" />
              </SidebarMenuItem>
              {showUpgrade && (
                <SidebarMenuItem>
                  <SidebarMenuLink to="/upgrade" icon={Sparkles} label="Upgrade" />
                </SidebarMenuItem>
              )}
              {isAdminUser && (
                <SidebarMenuItem>
                  <SidebarMenuLink to="/admin" icon={ShieldCheck} label="Admin" />
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <div className="mb-2 flex items-center gap-2 px-6 pt-4 md:hidden">
            <SidebarTrigger />
            <Link to="/app" aria-label="Handback home">
              <Wordmark />
            </Link>
          </div>
          <main className={fullBleed ? 'w-full min-w-0' : 'mx-auto w-full max-w-6xl px-7 py-6'}>
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}

/** A quiet, non-nav sidebar link (the "All projects" / "New project" tails). */
function MutedLink({ to, label }: { to: string; label: string }) {
  const { setMobileOpen } = useSidebar()
  return (
    <Link
      to={to}
      onClick={() => setMobileOpen(false)}
      className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 flex h-8 items-center rounded-md px-2.5 text-[13px] font-medium">
      {label}
    </Link>
  )
}

function TopBar({
  displayName,
  email,
  isAdmin,
  showUpgrade,
  onSignOut,
}: {
  displayName: string
  email: string
  isAdmin: boolean
  showUpgrade: boolean
  onSignOut: () => void
}) {
  const navigate = useNavigate()
  const menu = usePopover()
  const [q, setQ] = useState('')

  function onSearch(event: React.FormEvent) {
    event.preventDefault()
    navigate(`/app?q=${encodeURIComponent(q)}`)
  }

  return (
    <header className="bg-card border-border sticky top-0 z-40 flex h-[52px] items-center gap-3.5 border-b px-4">
      <Link to="/app" aria-label="Handback home">
        <Wordmark />
      </Link>
      <form
        onSubmit={onSearch}
        className="text-muted-foreground hidden h-8 w-[420px] items-center gap-2 rounded-md bg-muted px-3 md:flex">
        <Search className="size-4 shrink-0" />
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search walkthroughs, projects, people"
          aria-label="Search"
          className="text-foreground placeholder:text-muted-foreground h-full w-full bg-transparent text-[13px] outline-none"
        />
      </form>
      <span className="flex-1" />
      <Link to="/record" className={buttonVariants()}>
        <CircleDot />
        Record
      </Link>
      {showUpgrade && (
        <Link to="/upgrade" className={buttonVariants({ variant: 'ghost' })}>
          Upgrade
        </Link>
      )}
      <div ref={menu.ref} className="relative">
        <button
          type="button"
          aria-label="Account menu"
          aria-expanded={menu.open}
          onClick={() => menu.setOpen(!menu.open)}
          className="flex rounded-full">
          <Avatar name={displayName} />
        </button>
        {menu.open && (
          <div className="bg-popover border-border absolute right-0 top-full mt-1 w-56 rounded-lg border p-1 shadow-sm">
            <p title={email} className="text-muted-foreground truncate px-2.5 py-1.5 text-xs">
              {email}
            </p>
            <Link
              to="/usage"
              onClick={() => menu.setOpen(false)}
              className="hover:bg-secondary flex h-8 w-full items-center rounded-md px-2.5 text-[13px]">
              Usage
            </Link>
            {isAdmin && (
              <Link
                to="/admin"
                onClick={() => menu.setOpen(false)}
                className="hover:bg-secondary flex h-8 w-full items-center rounded-md px-2.5 text-[13px]">
                Admin
              </Link>
            )}
            <div className="border-border my-1 border-t" />
            <button
              type="button"
              onClick={() => {
                menu.setOpen(false)
                onSignOut()
              }}
              className="hover:bg-secondary flex h-8 w-full items-center rounded-md px-2.5 text-[13px]">
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

function MarketingHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="border-border bg-card border-b">
      <nav className="mx-auto flex h-[60px] max-w-6xl items-center gap-6 px-6">
        <Link to="/" aria-label="Handback home">
          <Wordmark />
        </Link>
        <div className="hidden items-center gap-6 md:flex">
          <Link
            to="/#how"
            className="text-muted-foreground hover:text-foreground text-[13px] font-medium">
            How it works
          </Link>
          <Link
            to="/#pricing"
            className="text-muted-foreground hover:text-foreground text-[13px] font-medium">
            Pricing
          </Link>
          <Link
            to="/docs"
            className="text-muted-foreground hover:text-foreground text-[13px] font-medium">
            Docs
          </Link>
        </div>
        <div className="ml-auto flex items-center gap-4">
          {signedIn ? (
            <Link to="/app" className={buttonVariants()}>
              Open Handback
            </Link>
          ) : (
            <>
              <Link
                to="/sign-in"
                className="text-muted-foreground hover:text-foreground text-[13px] font-medium">
                Sign in
              </Link>
              <Link to="/sign-up" className={buttonVariants()}>
                Get started
              </Link>
            </>
          )}
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
    <footer className="border-border mt-20 border-t">
      <div className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-[13px]">
        <Wordmark className="text-foreground" />
        <span>Every fix, handed back.</span>
        <Link className="hover:text-foreground" to="/docs">
          Docs
        </Link>
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
