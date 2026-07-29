import { Link } from 'react-router-dom'
import { LoopMark } from '~/components/logo'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { Section } from './section'

export function FinalCta() {
  return (
    <Section className="rule py-24 text-center md:py-32">
      <LoopMark className="mx-auto h-6" />
      <h2 className="font-display mx-auto mt-8 max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">
        Put a human back in the loop.
      </h2>
      <Link to="/sign-up" className={cn(buttonVariants({ size: 'lg' }), 'mt-9 px-6')}>
        Get started
      </Link>
    </Section>
  )
}
