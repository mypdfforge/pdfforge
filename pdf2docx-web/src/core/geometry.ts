import { Rect } from './pageir.js';

export function createRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  };
}

export function rectWidth(r: Rect): number {
  return Math.max(0, r.x1 - r.x0);
}

export function rectHeight(r: Rect): number {
  return Math.max(0, r.y1 - r.y0);
}

export function rectArea(r: Rect): number {
  return rectWidth(r) * rectHeight(r);
}

export function rectCenter(r: Rect): { x: number; y: number } {
  return {
    x: (r.x0 + r.x1) / 2,
    y: (r.y0 + r.y1) / 2,
  };
}

export function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x0 >= outer.x0 &&
    inner.y0 >= outer.y0 &&
    inner.x1 <= outer.x1 &&
    inner.y1 <= outer.y1
  );
}

export function intersectsRect(a: Rect, b: Rect): boolean {
  return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);

  if (x1 < x0 || y1 < y0) return null;
  return { x0, y0, x1, y1 };
}

export function unionRects(a: Rect, b: Rect): Rect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

export function boundingBox(rects: Rect[]): Rect {
  if (rects.length === 0) {
    return { x0: 0, y0: 0, x1: 0, y1: 0 };
  }
  let x0 = rects[0].x0;
  let y0 = rects[0].y0;
  let x1 = rects[0].x1;
  let y1 = rects[0].y1;
  for (let i = 1; i < rects.length; i++) {
    const r = rects[i];
    if (r.x0 < x0) x0 = r.x0;
    if (r.y0 < y0) y0 = r.y0;
    if (r.x1 > x1) x1 = r.x1;
    if (r.y1 > y1) y1 = r.y1;
  }
  return { x0, y0, x1, y1 };
}

export function iou(a: Rect, b: Rect): number {
  const intersection = intersectRects(a, b);
  if (!intersection) return 0;
  const interArea = rectArea(intersection);
  const unionArea = rectArea(a) + rectArea(b) - interArea;
  return unionArea <= 0 ? 0 : interArea / unionArea;
}
