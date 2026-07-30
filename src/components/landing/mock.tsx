/**
 * Mock chrome for the landing page's worked example.
 *
 * These are live DOM, not screenshots: real fonts, real tokens, selectable text,
 * crisp at any density, and they can never drift out of date with `ui.md` the way
 * a committed PNG does. The rule inside them is the same as everywhere else —
 * the *recorded app* is grey (see `demo-shot.tsx`), the *product* is paper and
 * cobalt.
 */

import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'
import { CheckoutShot, SHOTS, type Shot } from './demo-shot'

/** A viewer panel: white card, hairline header, mono label. Matches src/components/viewer. */
export function Pane({
  label,
  meta,
  className,
  bodyClassName,
  children,
}: {
  label: string
  meta?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <div className={cn('bg-card overflow-hidden rounded-lg border', className)}>
      <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-2.5">
        {/* Not uppercased: these labels are usually filenames, and FRAMES/01-0022.JPG
            is a path nobody has. */}
        <span className="text-muted-foreground truncate font-mono text-[0.68rem] tracking-[0.06em]">
          {label}
        </span>
        {meta && <span className="text-muted-foreground font-mono text-[0.68rem]">{meta}</span>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  )
}

/**
 * A contact sheet: nine keyframes in one image, each tile stamped with the
 * filename it came from. Black ground and white mono labels because that is
 * literally what the recorder encodes — this is a photograph of a JPEG, so it is
 * the one object on the page allowed to be dark.
 */
export function ContactSheet({
  shots = SHOTS,
  className,
}: {
  shots?: Shot[]
  className?: string
}) {
  return (
    <div className={cn('overflow-hidden rounded-md bg-black shadow-sm', className)}>
      {/* gap-px, not 0: the black shows between tiles so nine white pages read as
          nine frames rather than one wide picture. */}
      <div className="grid grid-cols-3 gap-px">
        {shots.map((shot) => (
          <figure key={shot.file} className="min-w-0">
            <figcaption className="px-1.5 pt-1 pb-0.5 font-mono text-[0.5rem] leading-none text-white/80">
              {shot.file}
            </figcaption>
            <CheckoutShot shot={shot} className="block w-full" />
          </figure>
        ))}
      </div>
    </div>
  )
}

/** The kept frames in a row, each with its timeline position and why it survived. */
export function Filmstrip({
  shots = SHOTS,
  className,
  showReason = true,
}: {
  shots?: Shot[]
  className?: string
  showReason?: boolean
}) {
  return (
    <ol className={cn('flex gap-2 overflow-x-auto pb-1', className)}>
      {shots.map((shot) => (
        <li key={shot.file} className="w-28 shrink-0">
          <CheckoutShot
            shot={shot}
            className="block w-full rounded-sm border border-black/10 bg-white"
          />
          <p className="text-cobalt mt-1.5 font-mono text-[0.6rem]">{shot.at}</p>
          {showReason && (
            <p className="text-muted-foreground font-mono text-[0.6rem]">{shot.reason}</p>
          )}
        </li>
      ))}
    </ol>
  )
}

/**
 * The raw walkthrough as a player bar rather than a big still. It is the least
 * important thing in a gripe — the one artifact aimed at a human — so it gets a
 * strip, not a stage. The ticks on the scrubber are the kept keyframes.
 */
export function PlayerStrip({
  keyframes,
  title,
  className,
}: {
  keyframes: number
  title: string
  className?: string
}) {
  // Spread across the whole bar with a deterministic wobble — keyframes bunch
  // where things happened, but they reach the end. No Math.random: this renders
  // on the server too.
  const ticks = Array.from({ length: keyframes }, (_, i) => {
    const even = (i / (keyframes - 1)) * 97
    return Math.max(0.5, Math.min(99, even + (((i * 7) % 5) - 2) * 0.9))
  })
  return (
    <div className={cn('flex items-center gap-4 px-4 py-3.5', className)}>
      <span className="bg-cobalt flex size-9 shrink-0 items-center justify-center rounded-full text-white">
        <svg viewBox="0 0 12 12" className="ml-0.5 size-3 fill-current" aria-hidden="true">
          <path d="M2 1 L11 6 L2 11 Z" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.8rem] font-medium">{title}</p>
        <div className="relative mt-2 h-3">
          <div className="bg-muted absolute inset-x-0 top-1.5 h-1 rounded-full" />
          <div className="bg-cobalt absolute top-1.5 left-0 h-1 w-[22%] rounded-full" />
          {ticks.map((left, i) => (
            <span
              key={i}
              className="bg-foreground/25 absolute top-0 h-3 w-px"
              style={{ left: `${Math.min(left, 99)}%` }}
            />
          ))}
        </div>
      </div>
      <span className="text-muted-foreground shrink-0 font-mono text-[0.68rem]">
        {keyframes} keyframes
      </span>
    </div>
  )
}

/**
 * The capture moment: the page being recorded, wearing the cobalt inset frame and
 * tag that draw mode puts on the viewport, with the on-page dock and the live
 * caption. The frame is deliberately part of the recording — the reviewer should
 * be able to see, later, that ink owned the pointer here.
 */
export function RecordingViewport({
  shot,
  caption,
  className,
}: {
  shot: Shot
  caption: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <div className="border-border bg-card overflow-hidden rounded-lg border shadow-sm">
        <div className="relative">
          <CheckoutShot shot={shot} className="block w-full" />

          {/* Draw mode says so: inset cobalt frame + one tag. */}
          <div className="ring-cobalt/70 pointer-events-none absolute inset-1.5 rounded-sm ring-2" />
          <span className="bg-cobalt absolute top-1.5 left-1/2 -translate-x-1/2 rounded-b-sm px-2 py-0.5 font-mono text-[0.6rem] tracking-[0.08em] text-white">
            drawing · esc to click
          </span>

          {/* On-page dock. */}
          <div className="border-border bg-card/95 absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full border px-3 py-1.5 shadow-sm backdrop-blur">
            <span className="relative flex size-1.5">
              <span className="bg-destructive absolute inline-flex size-full animate-ping rounded-full opacity-70" />
              <span className="bg-destructive relative inline-flex size-1.5 rounded-full" />
            </span>
            <span className="font-mono text-[0.6rem] tabular-nums">0:22</span>
            <span className="bg-border h-3 w-px" />
            <Mic />
            {(['d', 'c', 'm', 's'] as const).map((key) => (
              <kbd
                key={key}
                className={cn(
                  'border-border rounded-[3px] border px-1 font-mono text-[0.6rem] leading-4',
                  key === 'd' && 'border-cobalt bg-cobalt-wash text-cobalt'
                )}>
                {key}
              </kbd>
            ))}
          </div>
        </div>
      </div>

      {/* The line being said as the frame is captured. */}
      <div className="border-border bg-card mt-3 flex items-start gap-3 rounded-md border px-3.5 py-2.5 shadow-sm">
        <span className="text-cobalt mt-0.5 font-mono text-[0.7rem]">0:19</span>
        <p className="text-sm leading-relaxed">
          {caption}
          <span className="bg-cobalt ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse" />
        </p>
      </div>
    </div>
  )
}

/** Voice-level bars in the dock — ink grey, the same lane the timeline draws. */
function Mic() {
  const bars = [3, 6, 9, 5, 2]
  return (
    <span className="flex items-end gap-[2px]" aria-hidden="true">
      {bars.map((h, i) => (
        <span
          key={i}
          className="bg-foreground/45 w-[2px] rounded-full"
          style={{ height: `${h}px` }}
        />
      ))}
    </span>
  )
}
