import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { LoopDiagram } from './loop-diagram'
import { Section } from './section'

// The page's only entrance: one staggered fade-and-rise on load. Nothing else
// on the landing page moves on its own.
const rise = 'animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-700 ease-out'

export function Hero() {
  return (
    <Section className="py-20 md:py-28">
      <div className="grid items-center gap-16 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          {/* The stamp carries its own rotate, so the rise animates a wrapper. */}
          <div className={rise}>
            <span className="stamp text-cobalt text-[0.7rem]">HUMANS IN THE LOOP</span>
          </div>
          <h1
            className={cn(
              rise,
              'font-display mt-7 text-5xl leading-[1.04] font-semibold tracking-tight delay-100 md:text-6xl'
            )}>
            Your agents ship. You stay in the <span className="ink-underline">loop</span>.
          </h1>
          <p
            className={cn(
              rise,
              'text-muted-foreground mt-7 max-w-2xl text-lg leading-relaxed delay-200'
            )}>
            Record what's broken, talk through it for ninety seconds, and hand your coding agent a
            repro-grade brief — video, keyframes, transcript, and the console errors that fired
            while you spoke. Nothing merges without your sign-off.
          </p>
          <div className={cn(rise, 'mt-10 flex flex-wrap items-center gap-x-7 gap-y-4 delay-300')}>
            <Link to="/sign-up" className={cn(buttonVariants({ size: 'lg' }), 'px-6')}>
              Get started
            </Link>
            <a
              href="#how"
              className="text-muted-foreground hover:text-foreground group inline-flex items-center gap-1.5 text-sm font-medium transition-colors">
              See how it works
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>
        <LoopDiagram
          className={cn(
            rise,
            'text-muted-foreground hidden w-full max-w-md justify-self-end delay-500 lg:block'
          )}
        />
      </div>
    </Section>
  )
}
