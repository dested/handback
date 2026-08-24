import { redirect, type RouteObject, type LoaderFunctionArgs } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query'
import { authClient } from '~/lib/auth-client'
import type { Session } from '../../server/auth'
import type { AppRouter } from '../../server/router'
import { AdminLayout } from './admin/layout'
import { AdminOverviewPage } from './admin/overview'
import { AdminUsersPage } from './admin/users'
import { AdminUserPage } from './admin/user'
import { AdminTeamsPage } from './admin/teams'
import { AdminTeamPage } from './admin/team'
import { AdminWalkthroughsPage } from './admin/walkthroughs'
import { AdminWalkthroughDebugPage } from './admin/walkthrough-debug'
import { AdminUsagePage } from './admin/usage'
import { AdminCostsPage } from './admin/costs'
import { AdminPricingPage } from './admin/pricing'
import { InboxPage } from './app'
import { ConnectPage } from './connect'
import { DocsPage } from './docs'
import { RouteErrorBoundary } from './error-boundary'
import { WalkthroughPage } from './walkthrough'
import { HomePage } from './home'
import { JoinPage } from './join'
import { Layout } from './layout'
import { ForgotPasswordPage } from './forgot-password'
import { PrivacyPage } from './privacy'
import { ResetPasswordPage } from './reset-password'
import { PhonePage } from './phone'
import { ProjectsPage } from './projects'
import { RecordPage } from './record'
import { RecorderPage } from './recorder'
import { SignInPage, safeNext } from './sign-in'
import { SignUpPage } from './sign-up'
import { TeamPage } from './team'
import { TermsPage } from './terms'
import { UploadPage } from './upload'
import { UsagePage } from './usage'
import { UpgradePage } from './upgrade'
import { WatchPage } from './watch'

// Per-request context populated by entry-server.tsx and handed to loaders via
// createStaticHandler.query(req, { requestContext }). Only available SSR-side.
// On the client, loaders fall back to authClient HTTP calls.
export type SsrLoaderContext = {
  session: Session | null
  queryClient: QueryClient
  trpc: TRPCOptionsProxy<AppRouter>
}

export type RootLoaderData = { session: Session | null }

async function fetchClientSession(): Promise<Session | null> {
  const { data, error } = await authClient.getSession()
  if (error || !data) return null
  return data as Session
}

async function rootLoader({ context }: LoaderFunctionArgs): Promise<RootLoaderData> {
  if (typeof window === 'undefined') {
    return { session: (context as SsrLoaderContext).session }
  }
  return { session: await fetchClientSession() }
}

// Signed-in surfaces: bounce to sign-in without a session, and warm the team
// list so the shell renders with the switcher populated — Personal needs no
// fetch.
async function appLoader({ context }: LoaderFunctionArgs): Promise<RootLoaderData> {
  if (typeof window === 'undefined') {
    const ctx = context as SsrLoaderContext
    if (!ctx.session) throw redirect('/sign-in')
    await ctx.queryClient.prefetchQuery(ctx.trpc.teams.mine.queryOptions())
    return { session: ctx.session }
  }
  const session = await fetchClientSession()
  if (!session) throw redirect('/sign-in')
  return { session }
}

// appLoader, but the bounce to /sign-in remembers where the person was going.
async function phoneLoader(args: LoaderFunctionArgs): Promise<RootLoaderData> {
  const url = new URL(args.request.url)
  const next = `/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`
  if (typeof window === 'undefined') {
    const ctx = args.context as SsrLoaderContext
    if (!ctx.session) throw redirect(next)
    await ctx.queryClient.prefetchQuery(ctx.trpc.teams.mine.queryOptions())
    return { session: ctx.session }
  }
  const session = await fetchClientSession()
  if (!session) throw redirect(next)
  return { session }
}

async function redirectIfSignedIn({ context, request }: LoaderFunctionArgs) {
  const session =
    typeof window === 'undefined'
      ? (context as SsrLoaderContext).session
      : await fetchClientSession()
  if (session) {
    // An already-signed-in visitor who followed an invite through /sign-up
    // belongs back at the invite, not at their own inbox — and one carrying a
    // ?next (a bounced share landing) belongs wherever they were headed.
    const params = new URL(request.url).searchParams
    const invite = params.get('invite')
    if (invite) throw redirect(`/join/${encodeURIComponent(invite)}?accept=1`)
    throw redirect(safeNext(params.get('next')) ?? '/app')
  }
  return null
}

export const routes: RouteObject[] = [
  {
    id: 'root',
    path: '/',
    Component: Layout,
    loader: rootLoader,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      { index: true, Component: HomePage },
      { path: 'sign-in', Component: SignInPage, loader: redirectIfSignedIn },
      { path: 'sign-up', Component: SignUpPage, loader: redirectIfSignedIn },
      { path: 'join/:inviteId', Component: JoinPage },
      { path: 'forgot-password', Component: ForgotPasswordPage },
      { path: 'reset-password', Component: ResetPasswordPage },
      { path: 'privacy', Component: PrivacyPage },
      { path: 'terms', Component: TermsPage },
      { path: 'docs', Component: DocsPage },
      // Public watch page for a shared walkthrough — the token IS the
      // credential, so no loader guard; walkthroughs.shared resolves or 404s.
      { path: 'w/:shareToken', Component: WatchPage },
      { path: 'app', Component: InboxPage, loader: appLoader },
      { path: 'walkthroughs/:walkthroughId', Component: WalkthroughPage, loader: appLoader },
      { path: 'connect', Component: ConnectPage, loader: appLoader },
      { path: 'recorder', Component: RecorderPage, loader: appLoader },
      // The extension-free path: live getDisplayMedia capture in the page,
      // through the same pipeline. /recorder installs the recorder; this IS one.
      { path: 'record', Component: RecordPage, loader: appLoader },
      // /phone is where the OS share sheet lands. A signed-out share must come
      // back here after auth or the stashed clip is orphaned — so this loader,
      // alone, carries the full URL through sign-in as ?next=.
      { path: 'phone', Component: PhonePage, loader: phoneLoader },
      { path: 'upload', Component: UploadPage, loader: appLoader },
      { path: 'projects', Component: ProjectsPage, loader: appLoader },
      { path: 'team', Component: TeamPage, loader: appLoader },
      { path: 'usage', Component: UsagePage, loader: appLoader },
      { path: 'upgrade', Component: UpgradePage, loader: appLoader },
      {
        path: 'admin',
        Component: AdminLayout,
        loader: appLoader,
        children: [
          { index: true, Component: AdminOverviewPage },
          { path: 'users', Component: AdminUsersPage },
          { path: 'users/:userId', Component: AdminUserPage },
          { path: 'teams', Component: AdminTeamsPage },
          { path: 'teams/:teamId', Component: AdminTeamPage },
          { path: 'walkthroughs', Component: AdminWalkthroughsPage },
          { path: 'walkthroughs/:walkthroughId', Component: AdminWalkthroughDebugPage },
          { path: 'usage', Component: AdminUsagePage },
          { path: 'pricing', Component: AdminPricingPage },
          { path: 'costs', Component: AdminCostsPage },
        ],
      },
      { path: 'dashboard', loader: () => redirect('/app') },
      // Links to a walkthrough were minted as /gripes/:id before the rename —
      // by push.ts, by MCP briefs, and by anyone who bookmarked one.
      {
        path: 'gripes/:gripeId',
        loader: ({ params }: LoaderFunctionArgs) =>
          redirect(`/walkthroughs/${params.gripeId ?? ''}`),
      },
    ],
  },
]
