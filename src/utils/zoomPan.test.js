import { describe, it, expect } from 'vitest';
import { transformOrigin, panForZoomAtPoint, clampPan } from './zoomPan';

describe('transformOrigin', () => {
  it('recovers the fixed pivot from a transformed rect and current pan', () => {
    // A 100x100 box centered at (200,200) on screen, currently panned by (20,10).
    const rect = { left: 150 + 20, top: 150 + 10, width: 100, height: 100 };
    const origin = transformOrigin(rect, { x: 20, y: 10 });
    expect(origin).toEqual({ x: 200, y: 200 });
  });

  it('is unaffected by scale (only pan moves the pivot)', () => {
    // Same pivot (200,200), pan (0,0), but box now scaled 2x (200x200).
    const rect = { left: 100, top: 100, width: 200, height: 200 };
    const origin = transformOrigin(rect, { x: 0, y: 0 });
    expect(origin).toEqual({ x: 200, y: 200 });
  });
});

describe('panForZoomAtPoint', () => {
  it('keeps the cursor point fixed when zooming in around the origin', () => {
    const origin = { x: 200, y: 200 };
    // Cursor 50px right/down of origin, zooming from 1x to 2x, starting unpanned.
    // The local point under the cursor is 50px from origin; doubling scale
    // doubles its distance from origin, so content must shift back by 50px
    // (pan = -50) to keep that same point under the cursor.
    const pan = panForZoomAtPoint(250, 250, origin, 1, 2, { x: 0, y: 0 });
    expect(pan).toEqual({ x: -50, y: -50 });
  });

  it('returns the same pan when scale is unchanged', () => {
    const origin = { x: 0, y: 0 };
    const pan = panForZoomAtPoint(100, 100, origin, 2, 2, { x: 5, y: -5 });
    expect(pan).toEqual({ x: 5, y: -5 });
  });

  it('zooming out moves content back toward the cursor point', () => {
    const origin = { x: 0, y: 0 };
    const pan = panForZoomAtPoint(100, 0, origin, 2, 1, { x: 100, y: 0 });
    // dx = 100; ratio = 0.5; x = 100 + (100-100)*0.5 = 100
    expect(pan.x).toBeCloseTo(100);
  });
});

describe('clampPan', () => {
  it('forces pan to zero when content fits within the container', () => {
    const p = clampPan({ x: 50, y: 50 }, 1, 100, 100, 400, 400);
    expect(p).toEqual({ x: 0, y: 0 });
  });

  it('allows panning up to half the overflow on each axis', () => {
    // content 400x400 at scale 2 = 800x800, container 400x400 -> max pan = 200
    const p = clampPan({ x: 1000, y: -1000 }, 2, 400, 400, 400, 400);
    expect(p).toEqual({ x: 200, y: -200 });
  });

  it('leaves an in-bounds pan untouched', () => {
    const p = clampPan({ x: 10, y: -20 }, 2, 400, 400, 400, 400);
    expect(p).toEqual({ x: 10, y: -20 });
  });
});
