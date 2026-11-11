import { describe, it, expect } from 'vitest';
import {
  createRect,
  rectWidth,
  rectHeight,
  rectArea,
  containsPoint,
  containsRect,
  intersectsRect,
  intersectRects,
  unionRects,
  iou,
} from '../../src/core/geometry.js';

describe('Geometry functions (§4.2)', () => {
  const r1 = createRect(10, 20, 110, 120); // w=100, h=100
  const r2 = createRect(60, 70, 160, 170); // w=100, h=100, overlap: [60,70] to [110,120], w=50, h=50

  it('calculates width, height, and area', () => {
    expect(rectWidth(r1)).toBe(100);
    expect(rectHeight(r1)).toBe(100);
    expect(rectArea(r1)).toBe(10000);
  });

  it('checks point containment', () => {
    expect(containsPoint(r1, 50, 50)).toBe(true);
    expect(containsPoint(r1, 5, 5)).toBe(false);
  });

  it('checks rectangle containment', () => {
    const inner = createRect(20, 30, 40, 50);
    expect(containsRect(r1, inner)).toBe(true);
    expect(containsRect(inner, r1)).toBe(false);
  });

  it('computes intersection and union', () => {
    expect(intersectsRect(r1, r2)).toBe(true);
    const inter = intersectRects(r1, r2);
    expect(inter).toEqual({ x0: 60, y0: 70, x1: 110, y1: 120 });
    const union = unionRects(r1, r2);
    expect(union).toEqual({ x0: 10, y0: 20, x1: 160, y1: 170 });
  });

  it('computes IoU correctly', () => {
    // interArea = 50 * 50 = 2500
    // unionArea = 10000 + 10000 - 2500 = 17500
    // iou = 2500 / 17500 = 1/7
    expect(iou(r1, r2)).toBeCloseTo(1 / 7, 5);
  });
});
