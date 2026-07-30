import { ArrowDown } from 'lucide-react'
import { GRIPE } from './demo-data'
import { SHOTS } from './demo-shot'
import { ContactSheet, Filmstrip } from './mock'
import { Section, SectionHeading, SectionLabel } from './section'

/**
 * The section the product actually rests on. Everything else here — the inbox,
 * the roles, the sign-off — is workflow; this is the part that decides whether an
 * agent can use a recording at all. It gets the most room on the page.
 *
 * It describes what the distillation does and never how it is tuned. Named
 * mechanisms, real counts, no parameters.
 */

const MECHANISM = [
  {
    title: 'Compared against every frame it already kept',
    body: 'Not just the one before it. A page that drifts a little at a time can’t slip through as “nothing changed” — the oldest thing still on screen is still being watched.',
  },
  {
    title: 'Your clicks and keystrokes force a frame',
    body: 'The instant you act is never an instant it threw away, even when the screen barely moved. A tooltip, a focus ring, a field that silently rejects you — all kept.',
  },
  {
    title: 'Survivors are spread across the whole take',
    body: 'A busy first minute doesn’t get to eat the budget. What’s kept stays even across the recording, so the end is covered as well as the opening.',
  },
]

export function Distill() {
  return (
    <Section id="distill" className="bg-card rule border-b py-20 md:py-28">
      <SectionLabel>The hard part</SectionLabel>
      <SectionHeading>Video is the worst thing you can hand a model.</SectionHeading>
      <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-relaxed">
        Ninety seconds of screen capture is thousands of pictures of almost the same thing. Handback
        throws away the frames that say nothing, keeps the ones that do — and it decides while
        you’re still recording.
      </p>

      {/* 01 — the raw take */}
      <div className="mt-14">
        <Stage n="01" title="What you recorded" />
        <div className="border-border relative mt-4 overflow-hidden rounded-md border">
          <Sprockets />
          <div
            className="h-24"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, #e8e8eb 0 2px, #f6f6f7 2px 4px, #efeff1 4px 7px)',
            }}
          />
          <Sprockets />
          {/* Boxed, so the caption reads as a label laid on the footage rather than
              text tangled in the perforations when it wraps on a phone. */}
          <div className="absolute inset-0 flex items-center justify-center px-4">
            <p className="bg-card text-muted-foreground rounded-sm px-3 py-1.5 text-center font-mono text-xs leading-relaxed">
              {GRIPE.duration} of screen capture · ~2,800 frames · almost all of them identical
            </p>
          </div>
        </div>
      </div>

      <Arrow />

      {/* 02 — what survived */}
      <div>
        <Stage n="02" title={`The ${GRIPE.keyframes} frames that say something`} />
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
          Each one carries the position it was taken at, why it survived, and the pointer drawn into
          the picture — so a still is never a still with the subject missing.
        </p>
        <Filmstrip className="mt-5" />
      </div>

      <dl className="mt-12 grid gap-x-10 gap-y-8 md:grid-cols-3">
        {MECHANISM.map((item) => (
          <div key={item.title}>
            <dt className="border-cobalt border-l-2 pl-3 text-sm leading-snug font-semibold">
              {item.title}
            </dt>
            <dd className="text-muted-foreground mt-2.5 pl-3 text-sm leading-relaxed">
              {item.body}
            </dd>
          </div>
        ))}
      </dl>

      <Arrow />

      {/* 03 — the payoff */}
      <div>
        <Stage n="03" title="Nine to an image, in order" />
        <div className="mt-5 grid items-start gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <figure>
            <ContactSheet />
            <figcaption className="text-muted-foreground mt-3 font-mono text-xs">
              sheet 1 of {GRIPE.sheets} — 0:04–0:31 · every tile stamped with the file it came from
            </figcaption>
          </figure>
          <div>
            <p className="font-display text-2xl leading-snug font-semibold tracking-tight">
              A model reading consecutive frames side by side follows what happened. The same frames
              handed over one at a time, it doesn’t.
            </p>
            <p className="text-muted-foreground mt-5 leading-relaxed">
              So the report leads with the sheets and the flow comes after. The first coding agent to
              read a real bundle called these the highest-value thing in it — and they cost a
              fraction of the tokens the same frames would have burned separately.
            </p>
            <p className="text-muted-foreground mt-5 leading-relaxed">
              The full-size stills are still there. The report inlines one only where the narration is
              pointing at something, and names the rest by filename so an agent can open exactly the
              one it wants.
            </p>
            <p className="text-cobalt mt-6 font-mono text-xs">
              {GRIPE.keyframes} keyframes → {GRIPE.sheets} sheets → {SHOTS.length} tiles per image
            </p>
          </div>
        </div>
      </div>
    </Section>
  )
}

function Stage({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="text-cobalt font-mono text-sm tracking-[0.14em]">{n}</span>
      <h3 className="font-display text-2xl font-semibold tracking-tight">{title}</h3>
    </div>
  )
}

function Arrow() {
  return (
    <div className="text-cobalt flex justify-center py-8" aria-hidden="true">
      <ArrowDown className="size-5" />
    </div>
  )
}

/** Film perforations — the raw take reads as footage before you read the caption. */
function Sprockets() {
  return (
    <div
      className="h-2.5 bg-[#e4e4e7]"
      style={{
        backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 6px, #fff 6px 12px)',
      }}
    />
  )
}
