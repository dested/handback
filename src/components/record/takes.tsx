import { useState } from 'react'
import { mmss } from '~/lib/capture/format'
import type { LiveTake } from '~/lib/capture/live-store'
import { cn } from '~/lib/utils'

/**
 * The takes this walkthrough is made of. Deleting one renumbers the rest,
 * because `rec-NN` is a position in the walkthrough and not a serial — a hole in
 * it would put a hole in the axis the viewer walks (the rule
 * `extension/src/lib/messages.ts` `take:delete` enforces).
 *
 * Delete arms inline rather than opening a `confirm()`, and the armed question
 * replaces the row's right-hand side instead of growing it — a row that grows
 * mid-decision shoves everything below it (ui.md).
 */

export interface TakeListProps {
  takes: LiveTake[]
  onDelete: (take: LiveTake) => void
  /** Recording or uploading — nothing may be pulled out from under either. */
  busy: boolean
}

export function TakeList({ takes, onDelete, busy }: TakeListProps) {
  const [armed, setArmed] = useState<string | null>(null)
  if (!takes.length) return null

  return (
    <ul className="divide-border border-border divide-y border-y">
      {takes.map((take) => {
        const isArmed = armed === take.id
        return (
          <li key={take.id} className="flex items-center gap-3 py-2.5 font-mono text-sm">
            <span className="text-muted-foreground shrink-0">take {take.index}</span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
              {mmss(take.meta.durationMs)}
              {/* A pristine (human) take sampled none on purpose — "0 keyframes"
                  would read as a failure, so the count only speaks when real. */}
              {take.meta.frames.length > 0 && ` · ${take.meta.frames.length} keyframes`}
              {take.interrupted && ' · interrupted'}
            </span>
            {isArmed ? (
              <span className="flex shrink-0 items-center gap-2 text-xs">
                <span className="text-muted-foreground">delete?</span>
                <button
                  type="button"
                  className="text-destructive underline underline-offset-4"
                  onClick={() => {
                    setArmed(null)
                    onDelete(take)
                  }}>
                  yes
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline underline-offset-4"
                  onClick={() => setArmed(null)}>
                  keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setArmed(take.id)}
                className={cn(
                  'text-muted-foreground hover:text-destructive shrink-0 text-xs',
                  busy && 'invisible'
                )}
                aria-label={`delete take ${take.index}`}>
                ×
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
