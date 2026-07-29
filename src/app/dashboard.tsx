import { useLoaderData } from 'react-router-dom'
import type { RootLoaderData } from './routes'

// Placeholder while the real Inloop workspace UI is built — the gripe inbox,
// viewer, and team pages land here. Kept minimal on purpose; nothing from the
// old Gripe extension UI is welcome.
export function DashboardPage() {
  const { session } = useLoaderData() as RootLoaderData

  if (!session) return null

  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-bold tracking-tight">Inloop</h1>
      <p className="text-muted-foreground">
        Signed in as <strong>{session.user.name || session.user.email}</strong>. The workspace is
        under construction.
      </p>
    </div>
  )
}
