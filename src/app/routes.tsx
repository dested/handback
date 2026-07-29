import { redirect, type RouteObject, type LoaderFunctionArgs } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query'
import { authClient } from '~/lib/auth-client'
import type { Session } from '../../server/auth'
import type { AppRouter } from '../../server/router'
import { InboxPage } from './app'
import { RouteErrorBoundary } from './error-boundary'
import { GripePage } from './gripe'
import { HomePage } from './home'
import { JoinPage } from './join'
import { Layout } from './layout'
import { ProjectsPage } from './projects'
import { SignInPage } from './sign-in'
import { SignUpPage } from './sign-up'
import { TeamPage } from './team'

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

// Signed-in surfaces: bounce to sign-in without a session, and warm the org
// list on the server so the shell renders with the switcher populated.
async function appLoader({ context }: LoaderFunctionArgs): Promise<RootLoaderData> {
  if (typeof window === 'undefined') {
    const ctx = context as SsrLoaderContext
    if (!ctx.session) throw redirect('/sign-in')
    await ctx.queryClient.prefetchQuery(ctx.trpc.orgs.mine.queryOptions())
    return { session: ctx.session }
  }
  const session = await fetchClientSession()
  if (!session) throw redirect('/sign-in')
  return { session }
}

async function redirectIfSignedIn({ context }: LoaderFunctionArgs) {
  const session =
    typeof window === 'undefined'
      ? (context as SsrLoaderContext).session
      : await fetchClientSession()
  if (session) throw redirect('/app')
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
      { path: 'app', Component: InboxPage, loader: appLoader },
      { path: 'gripes/:gripeId', Component: GripePage, loader: appLoader },
      { path: 'projects', Component: ProjectsPage, loader: appLoader },
      { path: 'team', Component: TeamPage, loader: appLoader },
      { path: 'dashboard', loader: () => redirect('/app') },
    ],
  },
]
