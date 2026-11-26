/**
 * slideCoords.js — Exact 2D geometry, PDF-to-slide coordinate transforms,
 * matrix composition/decomposition, and bounding-box helpers.
 */

export const PT_PER_IN = 72;
export const EMU_PER_IN = 914400;
// PowerPoint hard limits: 1 in .. 56 in per axis.
export const PPT_MIN_IN = 1;
export const PPT_MAX_IN = 56;

/**
 * Multiplies two 6-element 2D affine matrices [a, b, c, d, e, f]
 * using PDF/Canvas column-vector convention.
 */
export function mulMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Resolves PowerPoint slide dimensions (in inches) and uniform scale/centering
 * from a pdf.js page (or viewport-like object).
 * 'auto' preserves the exact PDF aspect ratio, clamped to PowerPoint's 1..56 in limits.
 */
export function resolveSlideDims(page, slideLayout = 'auto') {
  const vp = typeof page?.getViewport === 'function' ? page.getViewport({ scale: 1 }) : page;
  const wIn = Math.max(1e-3, (vp?.width || 720) / PT_PER_IN);
  const hIn = Math.max(1e-3, (vp?.height || 405) / PT_PER_IN);

  let target;
  if (slideLayout === '16:9') {
    target = { w: 13.3333, h: 7.5 };
  } else if (slideLayout === '4:3') {
    target = { w: 10, h: 7.5 };
  } else {
    const k = Math.min(PPT_MAX_IN / Math.max(wIn, hIn), 1);
    const minDim = Math.min(wIn * k, hIn * k);
    const k2 = minDim < PPT_MIN_IN ? Math.min(PPT_MAX_IN / Math.max(wIn, hIn), PPT_MIN_IN / Math.min(wIn, hIn)) : k;
    target = {
      w: Math.min(PPT_MAX_IN, Math.max(PPT_MIN_IN, wIn * k2)),
      h: Math.min(PPT_MAX_IN, Math.max(PPT_MIN_IN, hIn * k2)),
    };
  }

  const s = Math.min(target.w / wIn, target.h / hIn);
  return {
    w: target.w,
    h: target.h,
    scale: s,
    offX: (target.w - wIn * s) / 2,
    offY: (target.h - hIn * s) / 2,
    page: { wIn, hIn, rotate: vp?.rotation ?? page?.rotate ?? 0 },
  };
}

/**
 * Creates a PDF user-space -> slide-inches transformer for a page.
 * `viewport.transform` already folds in CropBox offset, MediaBox origin,
 * and `page.rotate` (0/90/180/270), and flips to top-down.
 * For mixed-orientation decks, pass the shared deck `dims` so every page
 * scales & centers cleanly into the presentation's slide dimensions.
 */
export function makePageTransform(page, sharedDims) {
  const vp = page.getViewport({ scale: 1 });
  const wIn = Math.max(1e-3, vp.width / PT_PER_IN);
  const hIn = Math.max(1e-3, vp.height / PT_PER_IN);
  const dims = sharedDims || resolveSlideDims(page, 'auto');

  const pageScale = Math.min(dims.w / wIn, dims.h / hIn);
  const offX = (dims.w - wIn * pageScale) / 2;
  const offY = (dims.h - hIn * pageScale) / 2;
  const k = pageScale / PT_PER_IN;

  const toIn = [k, 0, 0, k, offX, offY];
  const M = mulMatrix(toIn, vp.transform);

  return {
    dims: { ...dims, scale: pageScale, offX, offY },
    viewport: vp,
    M,
    pt: (x, y) => ({
      x: M[0] * x + M[2] * y + M[4],
      y: M[1] * x + M[3] * y + M[5],
    }),
    /** Composes a PDF-space matrix (e.g. CTM or CTM * Tm) into slide inches. */
    mat: (m) => mulMatrix(M, m),
    /** Transforms an axis-aligned PDF-space rectangle through `m` into a slide-inch bbox. */
    rect: (m, x0, y0, x1, y1) => {
      const t = mulMatrix(M, m);
      const pts = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ].map(([x, y]) => ({
        x: t[0] * x + t[2] * y + t[4],
        y: t[1] * x + t[3] * y + t[5],
      }));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return {
        x: minX,
        y: minY,
        w: Math.max(...xs) - minX,
        h: Math.max(...ys) - minY,
      };
    },
  };
}

/**
 * Decomposes a slide-inch affine matrix into PowerPoint shape transform terms.
 */
export function decompose(m) {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  const det = a * d - b * c;
  const sy = sx ? det / sx : Math.hypot(c, d);
  let rot = (Math.atan2(b, a) * 180) / Math.PI;
  rot = ((rot % 360) + 360) % 360;
  if (Math.abs(rot - 360) < 1e-6) rot = 0;

  return {
    x: e,
    y: f,
    sx,
    sy,
    rotate: rot,
    flipH: sx < 0,
    flipV: sy < 0,
    skewed: Math.abs(a * c + b * d) > 1e-3 * (Math.abs(sx * sy) || 1),
  };
}

export const inToEmu = (v) => Math.round(v * EMU_PER_IN);

export const rectIn = (r) => ({
  x: r.x,
  y: r.y,
  w: Math.max(r.w, 1e-4),
  h: Math.max(r.h, 1e-4),
});

export const intersects = (a, b, pad = 0) =>
  a.x - pad < b.x + b.w &&
  b.x - pad < a.x + a.w &&
  a.y - pad < b.y + b.h &&
  b.y - pad < a.y + a.h;

export const contains = (outer, inner, threshold = 0.9) => {
  const ix = Math.max(0, Math.min(outer.x + outer.w, inner.x + inner.w) - Math.max(outer.x, inner.x));
  const iy = Math.max(0, Math.min(outer.y + outer.h, inner.y + inner.h) - Math.max(outer.y, inner.y));
  return (ix * iy) / Math.max(inner.w * inner.h, 1e-6) >= threshold;
};

export const unionRect = (rs) => {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rs.map((r) => r.x + r.w)) - x,
    h: Math.max(...rs.map((r) => r.y + r.h)) - y,
  };
};
