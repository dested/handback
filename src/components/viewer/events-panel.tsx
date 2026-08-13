import { cn } from '~/lib/utils'
import type { TakeEvent } from './types'

// Warnings go violet, never amber — ui.md forbids warm hues outright.
function tickClass(level: string): string {
  if (level === 'error') return 'bg-destructive'
  if (level === 'warn' || level === 'warning') return 'bg-review'
  return 'bg-border'
}

/** Console and network noise the recorder captured, beside the transcript. */
export function EventsPanel({ events }: { events: TakeEvent[] }) {
  if (events.length === 0) return null

  return (
    <ul className="max-h-56 space-y-1.5 overflow-y-auto">
      {events.map((event, i) => (
        <li key={`${event.at}-${i}`} className="flex items-start gap-2 font-mono text-xs">
          <span className={cn('mt-0.5 h-3.5 w-0.5 shrink-0', tickClass(event.level))} />
          <span className="text-muted-foreground shrink-0">{event.at}</span>
          <span className="text-foreground/80 min-w-0 break-words" title={event.message}>
            {event.message}
          </span>
        </li>
      ))}
    </ul>
  )
}
