// The keyframes as a shot-by-shot slideshow: one big current shot with the
// transcript in a rail beside it, a filmstrip to jump around, and a playhead
// tick showing where the video actually is. The old contact sheet and its lightbox are gone —
// this IS the big view. Edit mode has no confirm: deletes are staged (the shot
// just vanishes), Cmd/Ctrl+Z or "undo" walks them back, and they commit on done.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { cn } from '~/lib/utils'
import { mmss } from './format'

export interface ViewerFrame {
  atMs: number // walkthrough-wide clock
  url: string // presigned GET — non-null by construction (agent-view filters)
  label: string // mmss(atMs)
  path: string // walkthrough-relative, e.g. "rec-01/frames/03-0125.jpg"
}

/** The last frame the playhead has reached — distinct from the shot being viewed. */
function activeIndex(frames: ViewerFrame[], ms: number): number {
  let index = 0
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (f && f.atMs <= ms) index = i
  }
  return index
}

export function Slideshow({
  frames,
  lines,
  activeMs,
  onSeek,
  canEdit,
  stagedCount,
  commitState,
  onDelete,
  onUndo,
  onCommit,
}: {
  frames: ViewerFrame[]
  lines: { tMs: number; endMs: number; text: string }[]
  activeMs: number
  onSeek: (ms: number) => void
  canEdit: boolean
  stagedCount: number
  commitState: 'idle' | 'saving' | 'error'
  onDelete: (path: string) => void
  onUndo: () => void
  onCommit: () => void
}): React.ReactElement {
  const [index, setIndex] = useState(0)
  const [editing, setEditing] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)
  const scriptRef = useRef<HTMLUListElement>(null)

  // Clamp every render: when a delete shrinks the list the same position now
  // shows the next shot, which is the intended triage flow.
  const i = Math.min(index, frames.length - 1)
  const frame = frames[i]

  // Where the player's playhead sits — "where the video is", not "where I'm looking".
  const playheadIndex = activeIndex(frames, activeMs)

  // The narration line being spoken at this shot.
  const activeLine = useMemo(() => {
    let k = -1
    const at = frame?.atMs
    if (at === undefined) return k
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n]
      if (line && line.tMs <= at) k = n
    }
    return k
  }, [lines, frame?.atMs])

  // Keep the selected thumbnail centred without scrolling the page.
  useEffect(() => {
    const strip = stripRef.current
    const child = strip?.children[i] as HTMLElement | undefined
    if (!strip || !child) return
    strip.scrollTo({
      left: child.offsetLeft - strip.clientWidth / 2 + child.clientWidth / 2,
      behavior: 'smooth',
    })
  }, [i])

  // Keep the spoken line in view as the shot advances.
  useEffect(() => {
    const list = scriptRef.current
    if (!list || activeLine < 0) return
    const child = list.children[activeLine] as HTMLElement | undefined
    if (!child) return
    list.scrollTo({
      top: child.offsetTop - list.clientHeight / 2 + child.clientHeight / 2,
      behavior: 'smooth',
    })
  }, [activeLine])

  // Delete stages the current shot, Cmd/Ctrl+Z walks the stack back — only while
  // editing, and never while a text field owns the key.
  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent) => {
      const t = event.target
      if (
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      )
        return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        onUndo()
      } else if (event.key === 'Delete') {
        event.preventDefault()
        if (frame) onDelete(frame.path)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editing, frame, onUndo, onDelete])

  if (frames.length === 0 || !frame) {
    return <p className="text-muted-foreground text-sm">No keyframes were captured.</p>
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setIndex(Math.max(0, i - 1))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setIndex(Math.min(frames.length - 1, i + 1))
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs">
          <span className="text-foreground">frame {i + 1}</span>
          <span className="text-muted-foreground px-1.5">/ {frames.length}</span>
          <span className="text-cobalt">{frame.label}</span>
        </p>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => onSeek(frame.atMs)}
            className="text-muted-foreground hover:text-foreground font-mono text-xs underline underline-offset-4">
            play from here
          </button>
          {canEdit &&
            (editing ? (
              <>
                {stagedCount > 0 && (
                  <button
                    type="button"
                    onClick={onUndo}
                    className="text-muted-foreground hover:text-foreground font-mono text-xs underline underline-offset-4">
                    undo ({stagedCount})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (stagedCount > 0) onCommit()
                    setEditing(false)
                  }}
                  className="text-muted-foreground hover:text-foreground font-mono text-xs underline underline-offset-4">
                  {stagedCount > 0 ? `done — delete ${stagedCount}` : 'done editing'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-muted-foreground hover:text-foreground font-mono text-xs underline underline-offset-4">
                edit frames
              </button>
            ))}
        </div>
      </div>

      {commitState === 'saving' && (
        <p className="text-muted-foreground font-mono text-xs">saving…</p>
      )}
      {commitState === 'error' && (
        <p className="text-destructive font-mono text-xs">
          couldn't save the deletions —{' '}
          <button type="button" onClick={onCommit} className="underline underline-offset-4">
            retry
          </button>
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className={cn('space-y-3', lines.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3')}>
          <div
            className="group focus-visible:ring-cobalt relative rounded-sm outline-none focus-visible:ring-2"
            tabIndex={0}
            onKeyDown={onKeyDown}>
            <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-sm border bg-black/95">
              <img
                src={frame.url}
                alt=""
                draggable={false}
                className="max-h-full max-w-full object-contain"
              />
            </div>

            {i > 0 && (
              <button
                type="button"
                onClick={() => setIndex(i - 1)}
                aria-label="Previous frame"
                className="absolute top-1/2 left-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/20 backdrop-blur-sm transition hover:bg-black/70">
                <ArrowLeft className="size-4" />
              </button>
            )}
            {i < frames.length - 1 && (
              <button
                type="button"
                onClick={() => setIndex(i + 1)}
                aria-label="Next frame"
                className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/20 backdrop-blur-sm transition hover:bg-black/70">
                <ArrowRight className="size-4" />
              </button>
            )}

            {editing && (
              <div className="absolute top-2 right-2 rounded-md bg-white/95 px-2.5 py-1.5 shadow-sm ring-1 ring-black/10">
                <button
                  type="button"
                  onClick={() => onDelete(frame.path)}
                  className="text-destructive font-mono text-xs underline underline-offset-4">
                  delete this frame
                </button>
              </div>
            )}
          </div>

          {/* The strip is sized to be judged, not just navigated: before/after have
          to be legible enough to spot a near-duplicate without clicking into it. */}
          <div ref={stripRef} className="relative flex gap-1.5 overflow-x-auto pb-1">
            {frames.map((f, n) => (
              <div
                key={`${f.atMs}-${n}`}
                className={cn(
                  'group relative aspect-video h-24 shrink-0 overflow-hidden rounded-[3px] border transition-colors sm:h-28',
                  n === i ? 'border-cobalt ring-cobalt ring-1' : 'border-border hover:border-cobalt'
                )}>
                <button
                  type="button"
                  onClick={() => setIndex(n)}
                  aria-label={`Frame ${n + 1} at ${f.label}`}
                  className="block h-full w-full">
                  <img
                    src={f.url}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                </button>
                <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded-sm bg-black/50 px-1 font-mono text-[10px] text-white">
                  {n + 1}
                </span>
                {n === playheadIndex && (
                  <span className="bg-cobalt pointer-events-none absolute inset-x-0 bottom-0 h-0.5" />
                )}
                {editing && (
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(f.path)
                      // Deleting a neighbour before the current shot shifts the
                      // list left — follow it so the big view keeps showing the
                      // same image.
                      if (n < i) setIndex(i - 1)
                    }}
                    aria-label={`Delete frame ${n + 1}`}
                    className={cn(
                      'hover:bg-destructive absolute top-1 right-1 grid size-5 place-items-center rounded-sm bg-black/55 text-white transition-opacity focus-visible:opacity-100',
                      n === i ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    )}>
                    <X className="size-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {lines.length > 0 && (
          // The rail borrows its height from the left column: absolute on lg so
          // a long transcript scrolls inside the stage+filmstrip's height
          // instead of stretching the row.
          <div className="relative lg:col-span-1">
            <ul
              ref={scriptRef}
              className="border-border relative max-h-52 space-y-1 overflow-y-auto rounded-sm border p-2 lg:absolute lg:inset-0 lg:max-h-none">
              {lines.map((line, n) => (
                <li key={`${line.tMs}-${n}`}>
                  <button
                    type="button"
                    onClick={() => setIndex(activeIndex(frames, line.tMs))}
                    className={cn(
                      'hover:bg-accent/40 flex w-full gap-3 rounded-sm px-1.5 py-1 text-left transition-colors',
                      n === activeLine && 'bg-cobalt-wash'
                    )}>
                    <span className="text-cobalt shrink-0 pt-px font-mono text-xs">
                      {mmss(line.tMs)}
                    </span>
                    <span className="text-sm leading-relaxed">{line.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
