import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { Wordmark } from '~/components/logo'
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
      <header className="bg-card border-b">
        <nav className="mx-auto flex h-[60px] max-w-6xl items-center px-6">
          <Link to="/" aria-label="Handback home">
            <Wordmark />
          </Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl px-6 py-16">
        <div className="bg-card max-w-md rounded-lg border p-6">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-1.5 font-mono text-[13px]">{message}</p>
          {import.meta.env.DEV && error instanceof Error && error.stack && (
            <pre className="bg-muted text-muted-foreground mt-4 max-w-full overflow-auto rounded-md p-4 text-xs">
              {error.stack}
            </pre>
          )}
          <Link to="/" className={buttonVariants({ className: 'mt-5' })}>
            Back home
          </Link>
        </div>
      </main>
    </>
  )
}
