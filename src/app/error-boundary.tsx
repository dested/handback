import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { buttonVariants } from '~/components/ui/button'

// Root route ErrorBoundary. React Router renders this in place of the layout
// when a loader/render throws OR when no route matches (a 404). It carries its
// own slim header so the page still looks intentional. The matching HTTP status
// is set server-side from `routerContext.statusCode` (see entry-server.tsx).
export function RouteErrorBoundary() {
  const error = useRouteError()
  const isNotFound = isRouteErrorResponse(error) && error.status === 404

  const title = isNotFound ? '404' : 'Something went wrong'
  const message = isNotFound
    ? "This page doesn't exist."
    : isRouteErrorResponse(error)
      ? `${error.status} ${error.statusText}`
      : error instanceof Error
        ? error.message
        : 'An unexpected error occurred.'

  return (
    <>
      <header className="border-b">
        <nav className="mx-auto flex max-w-5xl items-center px-6 py-4">
          <Link to="/" className="font-semibold">
            inloop
          </Link>
        </nav>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col items-start gap-4 px-6 py-16">
        <h1 className="text-5xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{message}</p>
        {import.meta.env.DEV && error instanceof Error && error.stack && (
          <pre className="bg-muted text-muted-foreground max-w-full overflow-auto rounded-md p-4 text-xs">
            {error.stack}
          </pre>
        )}
        <Link to="/" className={buttonVariants()}>
          Back home
        </Link>
      </main>
    </>
  )
}
