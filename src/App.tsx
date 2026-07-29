import type { ReactNode } from 'react'
import {
  HydrationBoundary,
  QueryClientProvider,
  type DehydratedState,
  type QueryClient,
} from '@tanstack/react-query'
import type { TRPCClient } from '@trpc/client'
import { TRPCProvider } from '~/lib/trpc'
import type { AppRouter } from '../server/router'
import '~/styles/app.css'

export default function App({
  children,
  queryClient,
  trpcClient,
  dehydratedState,
}: {
  children: ReactNode
  queryClient: QueryClient
  trpcClient: TRPCClient<AppRouter>
  dehydratedState: DehydratedState | null
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          {children}
        </TRPCProvider>
      </HydrationBoundary>
    </QueryClientProvider>
  )
}
