// One inbox row, taken structurally from the wire so the shape can never drift
// from what `walkthroughs.inbox` actually returns.

import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../server/router'

type Outputs = inferRouterOutputs<AppRouter>

export type InboxCard = Outputs['walkthroughs']['inbox'][number]
