import { Section, SectionHeading, SectionLabel } from './section'

const commands = [
  {
    caption: 'Push a gripe from anywhere',
    command: 'bun cli/push.ts ./gripes/2026-07-29-1215-walkthrough',
  },
  {
    caption: 'Let your agent pull the queue',
    command: 'claude mcp add inloop --env INLOOP_TOKEN=ilp_… -- bun cli/mcp.ts',
  },
]

export function CliStrip() {
  return (
    <Section className="py-20 md:py-24">
      <SectionLabel>Command line</SectionLabel>
      <SectionHeading>Two commands, and it's wired in.</SectionHeading>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {commands.map(({ caption, command }) => (
          <div key={caption}>
            <p className="text-sm font-medium">{caption}</p>
            <pre className="bg-card mt-3 overflow-x-auto rounded-md border px-4 py-3.5 font-mono text-sm">
              <code>
                <span className="text-cobalt select-none">$ </span>
                {command}
              </code>
            </pre>
          </div>
        ))}
      </div>
    </Section>
  )
}
