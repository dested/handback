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
    plural(gripe.eventCount, 'console event'),
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
