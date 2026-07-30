import { AgentView } from '~/components/landing/agent-view'
import { Distill } from '~/components/landing/distill'
import { FinalCta } from '~/components/landing/final-cta'
import { GripeManifest } from '~/components/landing/gripe-manifest'
import { Hero } from '~/components/landing/hero'
import { HowItWorks } from '~/components/landing/how-it-works'
import { Pricing } from '~/components/landing/pricing'

// Renders straight into <main> with no container: each section is full-bleed and
// centres its own copy. Header and footer come from app/layout.tsx.
//
// The order is one argument, told once: here's the loop (how) → here's the part
// that makes it possible (distill) → here's what you end up with (manifest) →
// here's what the agent reads (agent view). Every section carries the same demo
// gripe, so a fast scroller sees one bug, not five examples.
export function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Distill />
      <GripeManifest />
      <AgentView />
      <Pricing />
      <FinalCta />
    </>
  )
}
