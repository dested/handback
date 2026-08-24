// The console and network events the recorder captured, on their own tab.

import { EventsPanel } from '../events-panel'
import { SectionHead } from '../section-head'
import type { WalkthroughMedia } from './use-walkthrough-media'

export function ConsoleTab({ media }: { media: WalkthroughMedia }) {
  return (
    <section className="space-y-3">
      <SectionHead>console</SectionHead>
      {media.events.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No console or network events were captured.
        </p>
      ) : (
        <EventsPanel events={media.events} />
      )}
    </section>
  )
}
