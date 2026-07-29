import { cn } from '~/lib/utils'
import type { TakeEvent } from './types'

// Warnings go violet, never amber — ui.md forbids warm hues outright.
function chipClass(level: string): string {
  if (level === 'error') return 'bg-destructive/10 text-destructive'
  if (level === 'warn' || level === 'warning') return 'bg-review-wash text-review'
  return 'bg-muted text-muted-foreground'
}

/** Console and network noise the recorder captured, folded away by default. */
export function EventsPanel({ events }: { events: TakeEvent[] }) {
  if (events.length === 0) return null

  return (
    <details className="border-border rounded-md border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Console &amp; network ({events.length})
      </summary>
      <ul className="divide-border border-border max-h-64 divide-y overflow-y-auto border-t">
        {events.map((event, i) => (
          <li key={`${event.at}-${i}`} className="flex items-center gap-2 px-3 py-1.5">
            <span
              className={cn(
                'shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase',
                chipClass(event.level)
              )}>
              {event.level}
            </span>
            <span className="text-muted-foreground shrink-0 font-mono text-[10px]">{event.at}</span>
            <span className="truncate font-mono text-xs" title={event.message}>
              {event.message}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
