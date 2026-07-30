import { Link } from 'react-router-dom'
import { ReturnMark } from '~/components/logo'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { ReturnDiagram } from './return-diagram'
import { Section } from './section'

export function FinalCta() {
  return (
    <Section className="rule relative overflow-hidden py-24 text-center md:py-32">
      {/* The returning stroke, oversized, as a watermark behind the last word on the page. */}
      <ReturnDiagram
        className="pointer-events-none absolute top-1/2 left-1/2 hidden w-[34rem] -translate-x-1/2 -translate-y-1/2 text-transparent opacity-[0.35] md:block"
      />
      <div className="relative">
        <ReturnMark className="mx-auto h-6" />
        <h2 className="font-display mx-auto mt-8 max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">
          Nothing ships without you.
        </h2>
        <Link to="/sign-up" className={cn(buttonVariants({ size: 'lg' }), 'mt-9 px-6')}>
          Get started
        </Link>
      </div>
    </Section>
  )
}
