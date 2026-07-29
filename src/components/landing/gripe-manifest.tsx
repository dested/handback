import { Section, SectionHeading, SectionLabel } from './section'

const contents = [
  ['rec-NN/walkthrough.webm', 'the narrated screen recording'],
  ['rec-NN/frames/', 'deduped keyframes, pointer marked'],
  ['transcript.txt', 'on-device Whisper, timestamped'],
  ['console + network events', 'captured while you spoke'],
  ['report.md', 'authored for a model, not a human'],
]

export function GripeManifest() {
  return (
    <Section className="bg-card rule border-b py-20 md:py-28">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div>
          <SectionLabel>The artifact</SectionLabel>
          <SectionHeading>What's in a gripe.</SectionHeading>
        </div>
        <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
          One folder, pushed as one unit. Everything a model needs to reproduce what you saw, and
          everything a reviewer needs to check the fix against it.
        </p>
      </div>
      <dl className="border-border mt-12 border-b">
        {contents.map(([path, what]) => (
          <div
            key={path}
            className="rule hover:bg-cobalt-wash/60 -mx-3 grid gap-y-1 px-3 py-4 transition-colors md:grid-cols-[minmax(0,22rem)_1fr] md:gap-x-10">
            <dt className="font-mono text-sm">{path}</dt>
            <dd className="text-muted-foreground text-sm">{what}</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}
