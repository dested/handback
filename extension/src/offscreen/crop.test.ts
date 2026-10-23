import { describe, expect, test } from 'bun:test';
import { panelCrop } from './crop';

const panel = { width: 400, windowWidth: 1920, windowHeight: 1040 };

describe('panelCrop', () => {
  test('a share of the panel window loses the panel', () => {
    // Captured at 1.5× — the fraction is the same at any scale.
    expect(panelCrop('window', 2880, 1560, panel)).toEqual({ x: 0, y: 0, w: 0.792, h: 1 });
  });

  test('small differences in shape (window borders) still match', () => {
    expect(panelCrop('window', 1906, 1033, panel)).toEqual({ x: 0, y: 0, w: 0.792, h: 1 });
  });

  test('a window of some other shape is another app: left whole', () => {
    expect(panelCrop('window', 1600, 1200, panel)).toBeUndefined();
  });

  test('screens and tabs are never cropped', () => {
    expect(panelCrop('monitor', 1920, 1040, panel)).toBeUndefined();
    expect(panelCrop('browser', 1920, 1040, panel)).toBeUndefined();
    expect(panelCrop(undefined, 1920, 1040, panel)).toBeUndefined();
  });

  test('no geometry, no video size, or a nonsense panel: left whole', () => {
    expect(panelCrop('window', 1920, 1040, undefined)).toBeUndefined();
    expect(panelCrop('window', 0, 0, panel)).toBeUndefined();
    expect(panelCrop('window', 1920, 1040, { ...panel, width: 0 })).toBeUndefined();
    expect(panelCrop('window', 1920, 1040, { ...panel, width: 1920 })).toBeUndefined();
  });
});
