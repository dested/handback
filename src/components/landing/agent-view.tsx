import { REPORT, WALKTHROUGH, type ReportBlock } from './demo-data'
import { SHOTS } from './demo-shot'
import { CheckoutShot } from './demo-shot'
import { ContactSheet, Pane } from './mock'
import { Section, SectionHeading, SectionLabel } from './section'

/**
 * The handoff, shown from the agent's side. This used to carry install commands,
 * which sold the plumbing instead of the payoff — setup lives on /connect now and
 * the section is the brief itself.
 *
 * The report is rendered from structured blocks (`demo-data.ts`) rather than
 * parsed from markdown, so the landing page ships no markdown parser. The block
 * order mirrors what `buildReport` really emits: evidence first, prose second.
 */

const TOOLS = [
  ['list_walkthroughs', 'what’s open, and for which project'],
  ['get_walkthrough', 'the brief, plus a signed link to every file in it'],
  ['set_walkthrough_status', 'hand it back for review when the fix is up'],
]

export function AgentView() {
  return (
    <Section id="agent" className="bg-card rule border-b py-20 md:py-28">
      <SectionLabel>The handoff</SectionLabel>
      <SectionHeading>What your agent actually gets.</SectionHeading>
      <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-relaxed">
        Not a link to a video. Not a ticket with a screenshot stapled to it. One tool call, and the
        whole ninety seconds arrives as something it can read.
      </p>

      <div className="mt-12 grid items-start gap-8 lg:grid-cols-[0.78fr_1.22fr]">
        {/* min-w-0: grid items default to min-content, and the <pre> below never
            wraps — without this it drags the whole page wider than the phone. */}
        <div className="min-w-0 space-y-8">
          <Pane label="claude code" meta="handback mcp">
            <div className="space-y-2.5 p-4 font-mono text-[0.72rem] leading-relaxed">
              <p>
                <span className="text-cobalt select-none">▸ </span>
                get_walkthrough(<span className="text-muted-foreground">"promo-code-checkout"</span>
                )
              </p>
              <ul className="text-muted-foreground space-y-1 pl-4">
                <li>← report.md</li>
                <li>← {WALKTHROUGH.sheets} contact sheets</li>
                <li>← {WALKTHROUGH.keyframes} keyframes, pointer drawn in</li>
                <li>← transcript.txt · {WALKTHROUGH.spoken} lines</li>
                <li>← recording.json · frames, events, windows</li>
                <li>← walkthrough.webm · {WALKTHROUGH.duration}</li>
              </ul>
              <p className="pt-1.5">
                <span className="text-cobalt select-none">▸ </span>
                reading sheets 1–{WALKTHROUGH.sheets}…
              </p>
            </div>
          </Pane>

          <div>
            <h3 className="text-base font-semibold tracking-tight">Three tools</h3>
            <dl className="mt-4 space-y-3">
              {TOOLS.map(([name, what]) => (
                <div key={name}>
                  <dt className="text-cobalt font-mono text-[0.78rem]">{name}</dt>
                  <dd className="text-muted-foreground text-sm leading-relaxed">{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <Pane
          label="report.md"
          meta={`${WALKTHROUGH.slug.slice(0, 10)} · ${WALKTHROUGH.origin}`}
          className="min-w-0 shadow-sm">
          <div className="max-h-[38rem] overflow-y-auto px-6 py-6 sm:px-8">
            {REPORT.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </div>
        </Pane>
      </div>
    </Section>
  )
}

/** The markdown viewer. One case per block kind the report emits. */
function Block({ block }: { block: ReportBlock }) {
  switch (block.kind) {
    case 'h1':
      return <h3 className="mt-0 text-xl font-semibold tracking-tight">{block.text}</h3>

    case 'meta':
      return (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {block.chips.map((chip) => (
            <code
              key={chip}
              className="bg-muted text-foreground/80 rounded-sm px-1.5 py-0.5 font-mono text-[0.65rem]">
              {chip}
            </code>
          ))}
          <span className="text-muted-foreground font-mono text-[0.65rem]">{block.tail}</span>
        </p>
      )

    case 'quote':
      return (
        <blockquote className="border-cobalt bg-cobalt-wash/50 text-foreground/80 mt-5 border-l-2 py-3 pr-3 pl-4 text-[0.82rem] leading-relaxed">
          {block.text}
        </blockquote>
      )

    case 'h2':
      return <h4 className="mt-6 text-base font-semibold tracking-tight">{block.text}</h4>

    case 'h3':
      return <h4 className="mt-7 text-sm font-semibold tracking-tight">{block.text}</h4>

    case 'p':
      return (
        <p className="text-muted-foreground mt-3 text-[0.82rem] leading-relaxed">{block.text}</p>
      )

    case 'sheet':
      return (
        <figure className="mt-4">
          <ContactSheet />
          <figcaption className="text-muted-foreground mt-2 font-mono text-[0.6rem]">
            {block.alt}
          </figcaption>
        </figure>
      )

    case 'still': {
      const shot = SHOTS[block.shot]
      return (
        <figure className="mt-4 max-w-[26rem]">
          {shot && <CheckoutShot shot={shot} className="block w-full rounded-md border bg-white" />}
          <figcaption className="text-muted-foreground mt-2 font-mono text-[0.6rem]">
            {block.caption}
          </figcaption>
        </figure>
      )
    }

    case 'frames':
      return (
        <p className="text-muted-foreground mt-3 font-mono text-[0.68rem] leading-relaxed">
          {block.files.join(' · ')}
        </p>
      )

    case 'event':
      return (
        <p className="border-destructive/40 bg-destructive/5 mt-2 border-l-2 py-1.5 pr-2 pl-3 font-mono text-[0.68rem] leading-relaxed">
          {block.text}
        </p>
      )

    case 'rule':
      return <hr className="border-border mt-6" />
  }
}
