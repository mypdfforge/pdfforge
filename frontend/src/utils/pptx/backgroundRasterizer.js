/**
 * backgroundRasterizer.js — Two-tier background synthesis:
 * T1: Filtered Canvas2D operator-list replay (transparent canvas, text/native-shapes suppressed).
 * T2: Lossless PNG region crops from a cached full-page render for complex islands.
 */

import { mulMatrix } from './slideCoords.js';
import { CFG } from './config.js';

const DEFAULT_PATH_OPS = {
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
};

/**
 * Steps DPI down from target (3x -> 2x -> 1.5x) so layer pixel count stays
 * within `CFG.dpi.maxLayerPixels` (default 12 MP).
 */
export function computeSafeDpi(wIn, hIn, targetDpi = CFG.dpi.start) {
  const ptsPerIn = 72;
  const basePx = Math.max(1, wIn * ptsPerIn) * Math.max(1, hIn * ptsPerIn);
  let dpi = targetDpi;
  while (dpi > CFG.dpi.min && basePx * dpi * dpi > CFG.dpi.maxLayerPixels) {
    dpi = Math.max(CFG.dpi.min, Math.round((dpi - 0.5) * 10) / 10);
  }
  return dpi;
}

function defaultCreateCanvas(pxW, pxH) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(pxW, pxH);
  }
  const cv = document.createElement('canvas');
  cv.width = pxW;
  cv.height = pxH;
  return cv;
}

/**
 * T1: Replays the filtered op stream on a transparent canvas.
 * @param {Array<object>} replayEvents
 * @param {ReturnType<import('./slideCoords.js').makePageTransform>} pageTf
 * @param {number} dpiScale - Pixels per inch (e.g. 72 * 2 = 144)
 * @param {number} wIn - Slide width in inches
 * @param {number} hIn - Slide height in inches
 * @param {object} [opts]
 */
export function replayToCanvas(
  replayEvents,
  pageTf,
  dpiScale,
  wIn,
  hIn,
  { opsOverride, canvasFactory, pathFactory } = {}
) {
  const OPS = opsOverride || globalThis.pdfjsLib?.OPS || DEFAULT_PATH_OPS;
  const pxW = Math.max(1, Math.ceil(wIn * dpiScale));
  const pxH = Math.max(1, Math.ceil(hIn * dpiScale));
  const cv = (canvasFactory || defaultCreateCanvas)(pxW, pxH);
  const ctx = cv.getContext('2d', { alpha: true });
  ctx.lineJoin = 'miter';

  let path = null;
  let clips = 0;
  const M = pageTf.M;

  const setXform = (ctm) => {
    const m = mulMatrix(M, ctm);
    ctx.setTransform(
      m[0] * dpiScale,
      m[1] * dpiScale,
      m[2] * dpiScale,
      m[3] * dpiScale,
      m[4] * dpiScale,
      m[5] * dpiScale
    );
  };
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const newPath = () => (pathFactory ? pathFactory() : new Path2D());

  for (const e of replayEvents) {
    if (e.type === 'path') {
      setXform(e.ctm);
      path = newPath();
      let k = 0;
      const c = e.coords || [];
      for (const op of e.ops || []) {
        if (op === OPS.moveTo) path.moveTo(c[k++], c[k++]);
        else if (op === OPS.lineTo) path.lineTo(c[k++], c[k++]);
        else if (op === OPS.curveTo) path.bezierCurveTo(c[k++], c[k++], c[k++], c[k++], c[k++], c[k++]);
        else if (op === OPS.curveTo2) path.bezierCurveTo(c[k++], c[k++], c[k++], c[k++], c[k++], c[k++]);
        else if (op === OPS.curveTo3) path.bezierCurveTo(c[k++], c[k++], c[k++], c[k++], c[k++], c[k++]);
        else if (op === OPS.closePath) path.closePath();
        else if (op === OPS.rectangle) path.rect(c[k++], c[k++], c[k++], c[k++]);
      }
    } else if (e.type === 'clip') {
      if (path) {
        ctx.save();
        clips++;
        ctx.clip(path, e.eo ? 'evenodd' : 'nonzero');
      }
    } else if (e.type === 'paint') {
      if (!path) continue;
      setXform(e.ctm);
      const how = e.how || '';
      if (how.includes('fill')) {
        ctx.globalAlpha = e.alphaF ?? 1;
        ctx.fillStyle = rgba(e.fill || [0, 0, 0], 1);
        ctx.fill(path, how.startsWith('eo') ? 'evenodd' : 'nonzero');
      }
      if (how.includes('stroke')) {
        ctx.globalAlpha = e.alphaS ?? 1;
        ctx.strokeStyle = rgba(e.stroke || [0, 0, 0], 1);
        ctx.lineWidth = e.lineWidth || 1e-3;
        ctx.lineCap = ['butt', 'round', 'square'][e.cap] ?? 'butt';
        ctx.lineJoin = ['miter', 'round', 'bevel'][e.join] ?? 'miter';
        ctx.setLineDash?.(e.dash || []);
        ctx.stroke(path);
      }
    } else if (e.type === 'restore') {
      const count = e.restoredClips || 1;
      for (let i = 0; i < count && clips > 0; i++) {
        ctx.restore();
        clips--;
      }
    }
  }

  while (clips > 0) {
    ctx.restore();
    clips--;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return cv;
}

/**
 * T2: Crops lossless PNG regions from a single cached full-page render canvas.
 */
export async function cropRegions(groundTruthCanvas, regions, dpiScale, { canvasFactory } = {}) {
  const out = [];
  for (const r of regions || []) {
    const sx = Math.max(0, Math.floor(r.rect.x * dpiScale));
    const sy = Math.max(0, Math.floor(r.rect.y * dpiScale));
    const sw = Math.min(groundTruthCanvas.width - sx, Math.ceil(r.rect.w * dpiScale) + 1);
    const sh = Math.min(groundTruthCanvas.height - sy, Math.ceil(r.rect.h * dpiScale) + 1);
    if (sw <= 0 || sh <= 0) continue;

    const cv = (canvasFactory || defaultCreateCanvas)(sw, sh);
    cv.getContext('2d').drawImage(groundTruthCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    let data;
    if (typeof cv.convertToBlob === 'function') {
      const blob = await cv.convertToBlob({ type: 'image/png' });
      data = await blob.arrayBuffer();
    } else {
      const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
      data = await blob.arrayBuffer();
    }

    out.push({
      rect: {
        x: sx / dpiScale,
        y: sy / dpiScale,
        w: sw / dpiScale,
        h: sh / dpiScale,
      },
      z: r.z,
      data,
      mime: 'image/png',
      reason: r.reason,
    });
  }
  return out;
}
