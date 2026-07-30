import { Link } from 'react-router-dom'
import { LoopMark } from '~/components/logo'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { LoopDiagram } from './loop-diagram'
import { Section } from './section'

export function FinalCta() {
  return (
    <Section className="rule relative overflow-hidden py-24 text-center md:py-32">
      {/* The two loops, meshed, as a watermark behind the last word on the page. */}
      <LoopDiagram
        className="pointer-events-none absolute top-1/2 left-1/2 hidden w-[34rem] -translate-x-1/2 -translate-y-1/2 text-transparent opacity-[0.35] md:block"
      />
      <div className="relative">
        <LoopMark className="mx-auto h-6" />
        <h2 className="font-display mx-auto mt-8 max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">
          Put a human back in the loop.
        </h2>
        <Link to="/sign-up" className={cn(buttonVariants({ size: 'lg' }), 'mt-9 px-6')}>
          Get started
        </Link>
      </div>
    </Section>
  )
}
