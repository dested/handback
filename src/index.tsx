import ReactDOM from 'react-dom/client'
import { QueryClient, type DehydratedState } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import App from './App'
import { routes } from './app/routes'
import type { AppRouter } from '../server/router'

declare global {
  interface Window {
    __SSR_STATE__?: { dehydratedState: DehydratedState | null }
  }
}

const dehydratedState = window.__SSR_STATE__?.dehydratedState ?? null

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000 } },
})

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/api/trpc',
      fetch(url, options) {
        return fetch(url, { ...options, credentials: 'include' })
      },
    }),
  ],
})

const router = createBrowserRouter(routes)

ReactDOM.hydrateRoot(
  document.getElementById('app') as HTMLElement,
  <App queryClient={queryClient} trpcClient={trpcClient} dehydratedState={dehydratedState}>
    <RouterProvider router={router} />
  </App>
)
