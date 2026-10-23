import type { FrameBox } from '@dested/video-to-prompt';
import type { PanelGeometry } from '../lib/types';

/**
 * The recorder's own side panel, cut out of a window share. Record is pressed
 * in the panel, so a share of that Chrome window has the panel down its right
 * edge in every frame — the timer ticking, the caption scrolling — and every
 * keyframe and contact-sheet tile spends a fifth of its width on it.
 *
 * Measured, not guessed: the panel says how wide it is and how big its window
 * is (CSS px, as `capture:start` carries them). The share is only cropped when
 * it is a window AND has that window's shape — a window share of some other app
 * (an editor, a terminal) has no panel in it, and its shape gives it away. A
 * screen share stays whole: the panel isn't at a known edge of a monitor.
 */

/** How far the share's shape may stray from the window's before it is taken for another window. */
export const PANEL_ASPECT_TOLERANCE = 0.03;

/** The part of the share to keep, or undefined to keep all of it. */
export function panelCrop(
  surface: string | undefined,
  videoWidth: number,
  videoHeight: number,
  panel: PanelGeometry | undefined,
): FrameBox | undefined {
  if (surface !== 'window' || !panel) return undefined;
  if (!videoWidth || !videoHeight) return undefined;
  const { width, windowWidth, windowHeight } = panel;
  if (!(width > 0) || !(windowWidth > width) || !(windowHeight > 0)) return undefined;
  const share = videoWidth / videoHeight;
  const win = windowWidth / windowHeight;
  if (Math.abs(share - win) / win > PANEL_ASPECT_TOLERANCE) return undefined;
  const w = Math.round((1 - width / windowWidth) * 1000) / 1000;
  return w > 0 && w < 1 ? { x: 0, y: 0, w, h: 1 } : undefined;
}
