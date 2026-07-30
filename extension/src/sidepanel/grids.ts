/**
 * Contact sheets, ported from claude-real-video's make_grids. A model reading
 * consecutive frames side by side in one image follows motion and progression
 * far better than the same frames seen one at a time — the first agent to read a
 * real bundle called these the highest-value artifact in it, at an eighth of the
 * tokens, which is why the report leads with them.
 */

import { GRID_COLS as COLS, GRID_ROWS as ROWS, GRID_PER_SHEET } from '../lib/types';
import { pad2 } from '../lib/format';

const CELL_W = 480;
const LABEL_H = 22;
const GRID_QUALITY = 0.85;

export interface GridFrame {
  blob: Blob;
  label: string;
}

/** Where sheet `n` (1-based) lands inside a take's folder. The report cites the same path. */
export function gridFileName(n: number): string {
  return `grids/grid_${pad2(n)}.jpg`;
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('grid encode failed'))),
      'image/jpeg',
      GRID_QUALITY,
    );
  });
}

/** 3×3 contact sheets of consecutive keyframes — the reference's make_grids. */
export async function makeGrids(frames: GridFrame[]): Promise<Blob[]> {
  if (!frames.length) return [];

  const per = GRID_PER_SHEET;
  const sheets: Blob[] = [];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  for (let start = 0; start < frames.length; start += per) {
    const batch = frames.slice(start, start + per);
    const bitmaps = await Promise.all(batch.map((f) => createImageBitmap(f.blob)));
    // Cell height comes from the batch's first frame, like the reference — one
    // aspect ratio per sheet, so the grid stays a grid.
    const first = bitmaps[0];
    const ch = Math.round((first.height * CELL_W) / first.width) + LABEL_H;

    canvas.width = COLS * CELL_W;
    canvas.height = ROWS * ch;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';

    for (let i = 0; i < bitmaps.length; i++) {
      const x = (i % COLS) * CELL_W;
      const y = Math.floor(i / COLS) * ch;
      ctx.drawImage(bitmaps[i], x, y + LABEL_H, CELL_W, ch - LABEL_H);
      ctx.fillStyle = 'white';
      ctx.fillText(batch[i].label, x + 6, y + 4);
    }
    bitmaps.forEach((b) => b.close());

    sheets.push(await toJpeg(canvas));
  }

  return sheets;
}
