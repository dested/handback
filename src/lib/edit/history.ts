// Undo/redo for an EditState, shared by /record's editor and the cloud editor so
// the two can't drift. A past/future pair of full snapshots — the state is small
// (take order + a cut list), so snapshotting beats diffing.
//
// `commit` is one undoable step. A continuous gesture — dragging the Tighten
// slider fires a change per pixel — passes a `tag`; consecutive commits with the
// same tag coalesce into one history frame, so undo rolls back the whole drag,
// not one notch of it.

import { useCallback, useRef, useState } from 'react'
import type { EditState } from './edl'

export interface EditHistory {
  state: EditState | null
  /** An undoable change. Same `tag` on consecutive calls collapses into one step. */
  commit(next: EditState, tag?: string): void
  /** Load (or clear) the base state, wiping the history — a fresh edit, not a step. */
  setBase(next: EditState | null): void
  undo(): void
  redo(): void
  canUndo: boolean
  canRedo: boolean
}

export function useEditHistory(): EditHistory {
  const [state, setState] = useState<EditState | null>(null)
  const [past, setPast] = useState<EditState[]>([])
  const [future, setFuture] = useState<EditState[]>([])
  const lastTag = useRef<string | null>(null)

  const commit = useCallback(
    (next: EditState, tag?: string) => {
      if (state !== null && !(tag && tag === lastTag.current)) {
        setPast((p) => [...p, state])
      }
      setFuture([])
      lastTag.current = tag ?? null
      setState(next)
    },
    [state]
  )

  const setBase = useCallback((next: EditState | null) => {
    setPast([])
    setFuture([])
    lastTag.current = null
    setState(next)
  }, [])

  const undo = useCallback(() => {
    if (past.length === 0) return
    const prev = past[past.length - 1]
    if (!prev) return
    setPast(past.slice(0, -1))
    if (state) setFuture((f) => [state, ...f])
    lastTag.current = null
    setState(prev)
  }, [past, state])

  const redo = useCallback(() => {
    if (future.length === 0) return
    const next = future[0]
    if (!next) return
    setFuture(future.slice(1))
    if (state) setPast((p) => [...p, state])
    lastTag.current = null
    setState(next)
  }, [future, state])

  return {
    state,
    commit,
    setBase,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  }
}
