// The key-point types shared by the pane's checklist (viewer/pane/key-points-checklist.tsx)
// and the detail body. The table that used to live here was folded into the checklist in the
// 2026-09-13 redesign; only the shapes remain.

import type { Walkthrough } from '../types'

export type KeyPointRow = Walkthrough['points'][number]
export type OutcomeByPoint = Map<string, { status: string; note: string }>
