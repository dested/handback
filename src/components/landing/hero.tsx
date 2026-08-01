import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { SHOTS } from './demo-shot'
import { RecorderPanelMock, RecordingViewport } from './mock'
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
            Debug and review your app in <span className="ink-underline">your own words</span>.
          </h1>
          <p
            className={cn(
              rise,
              'text-muted-foreground mt-7 max-w-xl text-lg leading-relaxed delay-200'
            )}>
            Talk through it in the app where it happens — a bug, a rough edge, a change of taste.
            Handback turns the recording into something your coding agent can actually read, with no
            extra work after you stop talking.
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

        {/* The frame has to read as *being recorded*, so the extension's panel sits
            beside it. min-w-0 on both: the panel's mono lines never wrap. */}
        <div className={cn(rise, 'grid items-start gap-3 delay-500 lg:grid-cols-[1fr_11rem]')}>
          <RecordingViewport
            shot={MARKED}
            caption="and nothing. No error, no discount, the total is still a hundred and twenty-eight."
            className="min-w-0"
          />
          <RecorderPanelMock className="hidden min-w-0 lg:flex" />
        </div>
      </div>
    </Section>
  )
}
