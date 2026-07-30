import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'
import { EVENTS, GRIPE, TRANSCRIPT } from './demo-data'
import { CheckoutShot, SHOTS } from './demo-shot'
import { Pane, PlayerStrip } from './mock'
import { Section, SectionHeading, SectionLabel } from './section'

/**
 * What a gripe contains, in the words a person would use, with the actual thing
 * next to each one. The old version of this section was a table of file paths —
 * accurate, and useless to anyone deciding whether to sign up. The paths are
 * still here, but as the caption on the evidence rather than the pitch.
 */

export function GripeManifest() {
  const marked = SHOTS[7] ?? SHOTS[0]

  return (
    <Section className="rule py-20 md:py-28">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div>
          <SectionLabel>One gripe</SectionLabel>
          <SectionHeading>Everything you’d have had to write down.</SectionHeading>
        </div>
        <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
          You talked for ninety seconds. This is what came out of it — collected while you were
          speaking, so there was nothing to remember to do afterwards.
        </p>
      </div>

      <div className="mt-12 grid items-start gap-x-5 gap-y-10 lg:grid-cols-12">
        <Card
          title="Everything you said"
          file="transcript.txt"
          meta="transcribed on your machine"
          blurb="Timestamped, editable, and tied to the frames it’s about — people narrate what just happened, so each line knows the moment it’s describing."
          className="lg:col-span-7">
          <ol className="divide-border divide-y">
            {TRANSCRIPT.map((line) => (
              <li key={line.at} className="flex gap-3 px-4 py-2.5">
                <span className="text-cobalt shrink-0 pt-0.5 font-mono text-[0.68rem]">
                  {line.at}
                </span>
                <p className="text-[0.83rem] leading-relaxed">
                  {line.text}
                  {line.about && (
                    <span className="text-muted-foreground ml-1.5 font-mono text-[0.6rem]">
                      about {line.about}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </Card>

        <Card
          title="The moment you pointed at"
          file="rec-01/frames/01-0022.jpg"
          meta="0:22 · marked"
          blurb="Draw on the page mid-sentence. The stroke is captured into the recording, so “this number, right here” survives the trip to a model."
          className="lg:col-span-5">
          {marked && <CheckoutShot shot={marked} className="block w-full" />}
        </Card>

        <Card
          title="What broke underneath"
          file="rec-01/recording.json · events"
          meta={`${GRIPE.errors} captured`}
          blurb="The console and network failures that fired while you were talking. You didn’t open devtools; you didn’t know to."
          className="lg:col-span-7">
          <ul className="divide-border divide-y">
            {EVENTS.map((event, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                <span className="text-cobalt shrink-0 font-mono text-[0.68rem]">{event.at}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-sm px-1.5 font-mono text-[0.55rem] tracking-[0.08em] uppercase',
                    event.kind === 'network'
                      ? 'text-review bg-review-wash'
                      : 'text-destructive bg-destructive/8'
                  )}>
                  {event.kind}
                </span>
                <code className="min-w-0 flex-1 font-mono text-[0.7rem] break-words">
                  {event.text}
                </code>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title="The recording itself"
          file="rec-01/walkthrough.webm"
          meta={GRIPE.duration}
          blurb="The one thing in the bundle that’s for you rather than the agent — for when a reviewer wants to watch it happen."
          className="lg:col-span-5">
          <PlayerStrip keyframes={GRIPE.keyframes} title={GRIPE.title} />
        </Card>
      </div>

      <p className="text-muted-foreground mt-12 font-mono text-xs">
        {GRIPE.slug} · pushed as one unit, replaced wholesale if you record it again
      </p>
    </Section>
  )
}

function Card({
  title,
  file,
  meta,
  blurb,
  className,
  children,
}: {
  title: string
  file: string
  meta: string
  blurb: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <h3 className="font-display text-xl font-semibold tracking-tight">{title}</h3>
      <p className="text-muted-foreground mt-1.5 mb-4 text-sm leading-relaxed">{blurb}</p>
      <Pane label={file} meta={meta} className="flex-1 shadow-sm">
        {children}
      </Pane>
    </div>
  )
}
