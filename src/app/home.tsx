import { CliStrip } from '~/components/landing/cli-strip'
import { FinalCta } from '~/components/landing/final-cta'
import { GripeManifest } from '~/components/landing/gripe-manifest'
import { Hero } from '~/components/landing/hero'
import { HowItWorks } from '~/components/landing/how-it-works'
import { Pricing } from '~/components/landing/pricing'

// Renders straight into <main> with no container: each section is full-bleed and
// centres its own copy. Header and footer come from app/layout.tsx.
export function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <GripeManifest />
      <CliStrip />
      <Pricing />
      <FinalCta />
    </>
  )
}
