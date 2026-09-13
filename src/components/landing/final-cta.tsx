import { Link } from 'react-router-dom'
import { ReturnMark } from '~/components/logo'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { ReturnDiagram } from './return-diagram'
import { Section } from './section'

export function FinalCta() {
  return (
    <Section>
      <div className="relative overflow-hidden rounded-xl border bg-secondary px-8 py-12 text-center">
        {/* The returning stroke, oversized, as a quiet watermark behind the last word. */}
        <ReturnDiagram className="pointer-events-none absolute top-1/2 left-1/2 hidden w-[34rem] -translate-x-1/2 -translate-y-1/2 opacity-[0.06] md:block" />
        <div className="relative">
          <ReturnMark className="mx-auto h-6" />
          <h2 className="mt-6 text-3xl font-semibold tracking-tight">Nothing ships without you.</h2>
          <Link to="/sign-up" className={cn(buttonVariants({ size: 'lg' }), 'mt-8')}>
            Get started
          </Link>
        </div>
      </div>
    </Section>
  )
}
