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
            Record a bug. Your coding agent fixes it.{' '}
            {/* nowrap: the underlined phrase must not break mid-line; it fits ≥360px. */}
            <span className="ink-underline whitespace-nowrap">You sign off.</span>
          </h1>
          <p
            className={cn(
              rise,
              'text-muted-foreground mt-7 max-w-xl text-lg leading-relaxed delay-200'
            )}>
            Talk through what's wrong in the app where it happens. Handback distills the recording
            into a repro-grade brief — transcript, keyframes, the errors that fired while you spoke —
            and your agent pulls it over MCP. The fix comes back to you for the last word.
          </p>
          <div className={cn(rise, 'mt-9 flex flex-wrap items-center gap-x-7 gap-y-4 delay-300')}>
            <Link to="/sign-up" className={cn(buttonVariants({ size: 'lg' }), 'px-6')}>
              Start recording
            </Link>
            <Link
              to="/connect"
              className="text-muted-foreground hover:text-foreground group inline-flex items-center gap-1.5 text-sm font-medium transition-colors">
              Connect Claude Code
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
          <div className={cn(rise, 'delay-300')}>
            <p className="text-muted-foreground mt-5 font-mono text-xs">
              works with Claude Code · one claude mcp add · invite-only during the alpha
            </p>
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

      <div className={cn(rise, 'rule mt-14 pt-7 delay-700')}>
        <ol className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:items-center sm:gap-x-9">
          <li>
            <a href="#how" className="group inline-flex items-baseline gap-2.5">
              <span className="text-cobalt font-mono text-xs tracking-[0.14em]">01</span>
              <span className="group-hover:text-cobalt text-sm font-medium transition-colors">
                Record
              </span>
            </a>
          </li>
          <li>
            <a href="#distill" className="group inline-flex items-baseline gap-2.5">
              <span className="text-cobalt font-mono text-xs tracking-[0.14em]">02</span>
              <span className="group-hover:text-cobalt text-sm font-medium transition-colors">
                Distill
              </span>
            </a>
          </li>
          <li>
            <a href="#agent" className="group inline-flex items-baseline gap-2.5">
              <span className="text-cobalt font-mono text-xs tracking-[0.14em]">03</span>
              <span className="group-hover:text-cobalt text-sm font-medium transition-colors">
                Agent fixes
              </span>
            </a>
          </li>
          <li>
            <a href="#how" className="group inline-flex items-baseline gap-2.5">
              <span className="text-cobalt font-mono text-xs tracking-[0.14em]">04</span>
              <span className="group-hover:text-cobalt text-sm font-medium transition-colors">
                You sign off
              </span>
            </a>
          </li>
        </ol>
        <p className="border-cobalt text-muted-foreground mt-8 max-w-2xl border-l-2 pl-4 text-sm italic leading-relaxed">
          The first coding agent to read a real Handback bundle called the contact sheets the
          highest-value thing in it.
        </p>
      </div>
    </Section>
  )
}
