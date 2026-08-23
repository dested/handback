// Ship uncaught browser errors to the server so a broken build wakes the owner
// instead of sitting silent in someone's console. Production only — dev noise is
// already in front of the developer. Bounded hard: at most 5 reports per page
// load, deduped by message, so a render loop can't hammer the endpoint.

export function installClientErrorReporter(): void {
  if (!import.meta.env.PROD) return

  const seen = new Set<string>()
  const MAX_REPORTS = 5
  let reported = 0

  function report(message: string, stack?: string): void {
    if (!message || reported >= MAX_REPORTS || seen.has(message)) return
    seen.add(message)
    reported += 1
    const body = JSON.stringify({
      message: message.slice(0, 500),
      stack: stack?.slice(0, 4000),
      url: location.href,
    })
    // keepalive so a report fired during an unload still leaves the tab.
    fetch('/api/client-error', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => {})
  }

  window.addEventListener('error', (event) => {
    const stack = event.error instanceof Error ? event.error.stack : undefined
    report(event.message, stack)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    report(message, stack)
  })
}
