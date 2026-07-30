import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { SHOTS } from './demo-shot'
import { RecordingViewport } from './mock'
import { Section } from './section'

// The page's only entrance: one staggered fade-and-rise on load. Nothing else
// on the landing page moves on its own.
const rise = 'animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-700 ease-out'

// 0:22 — the human has circled the total that never changed. The one frame that
// explains the whole product without a caption.
const MARKED = SHOTS[7] ?? SHOTS[0]

export function Hero() {
  return (
    <Section className="py-16 md:py-24">
      <div className="grid items-center gap-14 lg:grid-cols-[0.92fr_1.08fr]">
        <div>
          {/* The stamp carries its own rotate, so the rise animates a wrapper. */}
          <div className={rise}>
            <span className="stamp text-cobalt text-[0.7rem]">SIGNED OFF BY A HUMAN</span>
          </div>
          <h1
            className={cn(
              rise,
              'font-display mt-7 text-5xl leading-[1.04] font-semibold tracking-tight delay-100 md:text-6xl'
            )}>
            Your agents ship. The last word is <span className="ink-underline">yours</span>.
          </h1>
          <p
            className={cn(
              rise,
              'text-muted-foreground mt-7 max-w-xl text-lg leading-relaxed delay-200'
            )}>
            Talk through the bug in the app where it happens. Handback turns the recording into
            something a coding agent can actually read — and nothing merges without your sign-off.
          </p>
          <div className={cn(rise, 'mt-9 flex flex-wrap items-center gap-x-7 gap-y-4 delay-300')}>
            <Link to="/sign-up" className={cn(buttonVariants({ size: 'lg' }), 'px-6')}>
              Get started
            </Link>
            <a
              href="#distill"
              className="text-muted-foreground hover:text-foreground group inline-flex items-center gap-1.5 text-sm font-medium transition-colors">
              See what the agent gets
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>

        <RecordingViewport
          shot={MARKED}
          caption="and nothing. No error, no discount, the total is still a hundred and twenty-eight."
          className={cn(rise, 'delay-500')}
        />
      </div>
    </Section>
  )
}
