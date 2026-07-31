import { Link } from 'react-router-dom'
import { dateTime, megabytes, mmss, plural } from './format'
import type { Gripe } from './types'

/** Title block: where it came from, and the shape of what was recorded. */
export function GripeHeader({ gripe }: { gripe: Gripe }) {
  const meta = [
    dateTime(gripe.recordedAt),
    mmss(gripe.durationMs),
    plural(gripe.takes.length, 'take'),
    plural(gripe.frameCount, 'frame'),
    plural(gripe.errorCount, 'console error'),
    // Only worth saying when it happened: it's the difference between "the page
    // was clean" and "the errors were on a tab we weren't recording".
    gripe.droppedCount > 0 ? `${gripe.droppedCount} dropped from other tabs` : null,
    megabytes(gripe.bytes),
    gripe.uploadedByName ? `uploaded by ${gripe.uploadedByName}` : null,
  ].filter((part): part is string => part !== null)

  return (
    <div className="space-y-2">
      <Link to="/app" className="text-muted-foreground hover:text-foreground text-sm">
        ← Inbox
      </Link>
      <h1 className="text-3xl font-semibold">{gripe.title}</h1>
      <p className="text-muted-foreground font-mono text-xs">
        {gripe.slug}
        {gripe.origin && ` · ${gripe.origin}`}
      </p>
      <p className="text-muted-foreground text-sm">{meta.join(' · ')}</p>
    </div>
  )
}
