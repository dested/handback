import { Link } from 'react-router-dom'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { AppMock } from './mock'
import { Section } from './section'

// The page's only entrance: one staggered fade-and-rise on load. Nothing else
// on the landing page moves on its own.
const rise = 'animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-700 ease-out'

export function Hero() {
  return (
    <Section className="pt-20 pb-16">
      <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h1
            className={cn(rise, 'text-5xl leading-[1.05] font-semibold tracking-tight')}>
            Record a bug. Your coding agent fixes it. You sign off.
          </h1>
          <p className={cn(rise, 'text-muted-foreground mt-5 max-w-xl text-lg delay-100')}>
            Talk through what's wrong in the app where it happens. Handback distills the recording
            into a repro-grade brief — transcript, keyframes, the errors that fired while you spoke —
            and your agent pulls it over MCP. The fix comes back to you for the last word.
          </p>
          <div className={cn(rise, 'mt-8 flex flex-wrap items-center gap-3 delay-200')}>
            <Link to="/sign-up" className={cn(buttonVariants({ size: 'lg' }))}>
              Get started
            </Link>
            <a href="#how" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}>
              See how it works
            </a>
          </div>
          <p className={cn(rise, 'text-muted-foreground mt-5 text-[13px] delay-200')}>
            works with Claude Code · one claude mcp add · invite-only during the alpha
          </p>
        </div>

        <AppMock className={cn(rise, 'delay-300')} />
      </div>
    </Section>
  )
}
