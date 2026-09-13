/**
 * Mock chrome for the landing page's worked example.
 *
 * These are live DOM, not screenshots: real fonts, real tokens, selectable text,
 * crisp at any density, and they can never drift out of date with the design the
 * way a committed PNG does. The rule inside them is the same as everywhere else —
 * the *recorded app* is grey (see `demo-shot.tsx`), the *product* is white and
 * cobalt.
 */

import type { ReactNode } from 'react'
import { Check, FolderKanban, LayoutList, Plug, Search, Upload, Users } from 'lucide-react'
import { ReturnMark } from '~/components/logo'
import { ProjectTag } from '~/components/ui/project-tag'
import { StatusPill } from '~/components/ui/status-pill'
import { cn } from '~/lib/utils'
import { CheckoutShot, SHOTS, type Shot } from './demo-shot'

/**
 * The hero centrepiece: a still rendering of the real /app — sidebar, topbar, the
 * grouped List, and a walkthrough open in the right-hand detail pane. All static
 * markup and inert; the type is tiny (9–11px) so the whole product reads at a
 * glance the way a screenshot would, but stays crisp at any size.
 */
export function AppMock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none relative aspect-[16/10] w-full select-none overflow-hidden rounded-xl border bg-card text-[10px] shadow-sm',
        className
      )}>
      {/* Topbar */}
      <div className="flex h-10 items-center gap-3 border-b px-3">
        <span className="inline-flex items-center gap-1.5">
          <ReturnMark className="h-3.5" />
          <span className="text-[12px] font-semibold tracking-[-0.01em]">handback</span>
        </span>
        <span className="text-muted-foreground flex h-6 flex-1 items-center gap-1.5 rounded-md bg-muted px-2">
          <Search className="size-3" />
          Search walkthroughs, projects, people
        </span>
        <span className="bg-cobalt inline-flex h-6 items-center gap-1 rounded-md px-2 font-medium text-white">
          <i className="size-1.5 rounded-full bg-white" />
          Record
        </span>
      </div>

      {/* Body: sidebar + main */}
      <div className="flex h-[calc(100%-2.5rem)]">
        <div className="bg-sidebar flex w-[150px] shrink-0 flex-col gap-0.5 border-r p-2">
          <SideItem icon={<LayoutList className="size-3.5" />} label="Walkthroughs" active />
          <SideItem icon={<FolderKanban className="size-3.5" />} label="Projects" />
          <SideItem icon={<Users className="size-3.5" />} label="Teams" />
          <SideItem icon={<Plug className="size-3.5" />} label="Connect" />
          <SideItem icon={<Upload className="size-3.5" />} label="Upload" />
          <p className="text-muted-foreground mt-3 mb-1 px-2 text-[9px] font-semibold tracking-[.06em] uppercase">
            Projects
          </p>
          <SideSwatch color="#2f56d8" label="Storefront" />
          <SideSwatch color="#6b45d6" label="Back office" />
          <SideSwatch color="#128a3c" label="Mobile" />
        </div>

        {/* List, with the pane overlaid on the right 45%. */}
        <div className="relative min-w-0 flex-1">
          <div className="px-3 pt-2.5">
            <p className="flex items-center gap-1.5 font-semibold">
              <span className="text-muted-foreground">▾</span>
              Needs your call
              <span className="text-muted-foreground font-normal">2</span>
            </p>
            <div className="mt-1">
              <ListRow title="Promo code applies to nothing" sub="1 part · 0:34 · 8 key points" />
              <ListRow title="Order email never arrives" sub="1 part · 1:02 · 5 key points" />
              <ListRow title="Checkout spacing looks off" sub="screen recording · 0:48" project="Back office" />
            </div>
          </div>

          <div className="bg-card absolute inset-y-0 right-0 w-[45%] border-l p-3 shadow-[-8px_0_24px_rgb(31_34_41/.06)]">
            <div className="flex items-center gap-1.5">
              <span className="bg-approve inline-flex h-5 items-center gap-1 rounded-md px-1.5 font-medium text-white">
                <Check className="size-2.5" />
                Approve
              </span>
              <span className="inline-flex h-5 items-center rounded-md border px-1.5 font-medium">
                Send back
              </span>
            </div>
            <p className="mt-2 text-[11px] font-semibold">Promo code applies to nothing</p>
            <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[9px]">
              <span className="text-muted-foreground">Status</span>
              <span>
                <StatusPill status="in_review" className="h-4 px-1.5 text-[9px]" />
              </span>
              <span className="text-muted-foreground">Project</span>
              <span>
                <ProjectTag id="storefront" name="Storefront" className="h-4 px-1.5 text-[9px]" />
              </span>
            </div>
            <div className="relative mt-2 aspect-video overflow-hidden rounded-md bg-[#14161c]">
              <div className="absolute right-2 bottom-2 left-2">
                <div className="relative h-0.5 rounded-full bg-white/25">
                  <div className="bg-cobalt absolute inset-y-0 left-0 w-1/3 rounded-full" />
                  {[10, 24, 41, 58, 76, 90].map((left) => (
                    <span
                      key={left}
                      className="absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-white/80"
                      style={{ left: `${left}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <p className="text-foreground mt-2.5 text-[10px] font-semibold">What you said</p>
            <p className="text-muted-foreground mt-0.5 leading-relaxed">
              The promo code says applied, but the total never changes — no error, no discount, still
              a hundred and twenty-eight.
            </p>
            <div className="mt-2.5 space-y-1">
              <KeyPoint text="Coupon accepted but discount not applied" />
              <KeyPoint text="Total unchanged after Apply" />
              <KeyPoint text="No error surfaced to the user" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SideItem({ icon, label, active }: { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-6 items-center gap-2 rounded-md px-2 font-medium',
        active ? 'bg-sidebar-accent text-cobalt' : 'text-foreground/80'
      )}>
      {icon}
      {label}
    </span>
  )
}

function SideSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="text-foreground/80 flex h-6 items-center gap-2 rounded-md px-2 font-medium">
      <i className="size-2 rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  )
}

function ListRow({
  title,
  sub,
  project = 'Storefront',
}: {
  title: string
  sub: string
  project?: string
}) {
  return (
    <div className="flex h-9 items-center gap-2 border-b border-border/60">
      <span className="border-input size-3.5 shrink-0 rounded-full border-[1.5px]" />
      <span className="bg-muted h-5 w-8 shrink-0 rounded" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="text-muted-foreground block truncate text-[9px]">{sub}</span>
      </span>
      <StatusPill status="in_review" className="h-4 px-1.5 text-[9px]" />
      <span className="flex items-center gap-1">
        <span className="bg-border h-1 w-8 overflow-hidden rounded">
          <span className="bg-approve block h-full w-[87%] rounded" />
        </span>
        <span className="font-mono text-[9px]">7/8</span>
      </span>
      <ProjectTag id={project} name={project} className="h-4 px-1.5 text-[9px]" />
    </div>
  )
}

function KeyPoint({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="bg-approve inline-flex size-3 shrink-0 items-center justify-center rounded-full text-white">
        <Check className="size-2" />
      </span>
      <span className="text-foreground/80 truncate">{text}</span>
    </div>
  )
}

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
export function ContactSheet({ shots = SHOTS, className }: { shots?: Shot[]; className?: string }) {
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
 * important thing in a walkthrough — the one artifact aimed at a human — so it
 * gets a strip, not a stage. The ticks on the scrubber are the kept keyframes.
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
