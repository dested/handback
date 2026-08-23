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
  Film,
  FolderKanban,
  Gauge,
  LogOut,
  Plug,
  Puzzle,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Upload as UploadIcon,
  Users,
} from 'lucide-react'
import { Wordmark } from '~/components/logo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuLink,
  SidebarProvider,
  SidebarTrigger,
} from '~/components/ui/sidebar'
import { authClient } from '~/lib/auth-client'
import { SpaceProvider, clearIdentity } from '~/lib/space'
import { useTRPC } from '~/lib/trpc'
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

export function Layout() {
  const data = useRouteLoaderData('root') as RootLoaderData | undefined
  const session = data?.session ?? null
  const location = useLocation()
  const inApp = session !== null && APP_PREFIXES.some((p) => location.pathname.startsWith(p))
  // /admin runs its own sidebar shell edge to edge; nesting it inside the app
  // sidebar would stack two shells and double the chrome.
  const isAdmin = location.pathname.startsWith('/admin')

  if (!inApp) {
    return (
      <SpaceProvider enabled={session !== null}>
        <MarketingHeader signedIn={!!session} />
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
        <main className="flex w-full">
          <Outlet />
        </main>
      ) : (
        <AppShell email={session!.user.email}>
          <Outlet />
        </AppShell>
      )}
    </SpaceProvider>
  )
}

function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const navigate = useNavigate()
  const revalidator = useRevalidator()
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const adminStatus = useQuery(trpc.admin.status.queryOptions())
  const ent = useQuery(trpc.teams.entitlements.queryOptions())

  async function signOut() {
    await authClient.signOut()
    // The cache holds this account's teams and inbox; the next sign-in on this
    // browser must not inherit them.
    clearIdentity(queryClient)
    navigate('/', { replace: true })
    revalidator.revalidate()
  }

  return (
    <SidebarProvider storageKey="handback.appSidebar">
      <Sidebar>
        <SidebarHeader>
          <Link
            to="/app"
            aria-label="Handback home"
            className="group-data-[collapsed]/sidebar:hidden">
            <Wordmark />
          </Link>
          <SidebarTrigger className="ml-auto group-data-[collapsed]/sidebar:ml-0" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Review</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuLink to="/app" end icon={Film} label="Walkthroughs" />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuLink to="/projects" icon={FolderKanban} label="Projects" />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuLink to="/usage" icon={Gauge} label="Usage" />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
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
          <SidebarGroup>
            <SidebarGroupLabel>Team</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuLink to="/team" icon={Users} label="Teams" />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuLink to="/connect" icon={Plug} label="Connect" />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            {ent.data && !ent.data.pro && (
              <SidebarMenuItem>
                <SidebarMenuLink to="/upgrade" icon={Sparkles} label="Upgrade" />
              </SidebarMenuItem>
            )}
            {adminStatus.data?.isAdmin && (
              <SidebarMenuItem>
                <SidebarMenuLink to="/admin" icon={ShieldCheck} label="Admin" />
              </SidebarMenuItem>
            )}
          </SidebarMenu>
          <div className="px-2.5 py-1.5">
            <p
              title={email}
              className="text-muted-foreground truncate text-xs group-data-[collapsed]/sidebar:hidden">
              {email}
            </p>
            <SidebarMenuButton icon={LogOut} label="Sign out" onClick={signOut} />
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <div className="mb-2 flex items-center gap-2 px-6 pt-4 md:hidden">
          <SidebarTrigger />
          <Link to="/app" aria-label="Handback home">
            <Wordmark />
          </Link>
        </div>
        <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function MarketingHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="border-border border-b">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
        <Link to="/" aria-label="Handback home">
          <Wordmark />
        </Link>
        <div className="hidden items-center gap-6 text-sm md:flex">
          <Link to="/#how" className="text-muted-foreground hover:text-foreground">
            How it works
          </Link>
          <Link to="/#pricing" className="text-muted-foreground hover:text-foreground">
            Pricing
          </Link>
          <Link to="/docs" className="text-muted-foreground hover:text-foreground">
            Docs
          </Link>
        </div>
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

/* The header's SpaceSwitcher and its NewTeamModal died with the space-as-mode
   model (2026-08-03): the inbox spans every space, and team creation lives on
   the Teams page. */

function MarketingFooter() {
  return (
    <footer className="border-border mt-24 border-t">
      <div className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-sm">
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
