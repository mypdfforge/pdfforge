/**
 * slideEmitter.js — Emits finalized Slide-First 2D Scene Graphs into PptxGenJS
 * in strict z-order at absolute (x, y, w, h) inches, then runs OOXML patching.
 */

import PptxGenJS from 'pptxgenjs';
import { Kind, compositeBands } from './sceneGraph.js';
import { patchOoxml } from './ooxmlPatcher.js';

function checkAborted(signal) {
  if (signal?.aborted) {
    const err = new Error('Operation aborted');
    err.name = 'AbortError';
    err.code = 'ABORTED';
    throw err;
  }
}

function toTransparency(alpha) {
  if (!Number.isFinite(alpha) || alpha >= 1) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - alpha) * 100)));
}

function emitShape(slide, pptx, node) {
  const { x, y, w, h } = node.rect;
  const shapeType =
    node.shapeType === 'line' ? pptx.ShapeType.line : pptx.ShapeType.rect;
  const opts = {
    x,
    y,
    w: Math.max(0.005, w),
    h: Math.max(0.005, h),
    rotate: node.rotate || 0,
  };
  if (node.fill) {
    opts.fill = {
      color: node.fill.replace('#', ''),
      transparency: toTransparency(node.fillAlpha ?? node.opacity ?? 1),
    };
  }
  if (node.stroke) {
    opts.line = {
      color: node.stroke.replace('#', ''),
      width: node.lineWidthPt || 1,
      transparency: toTransparency(node.strokeAlpha ?? 1),
    };
  } else {
    opts.line = { transparency: 100 };
  }
  slide.addShape(shapeType, opts);
}

function emitImage(slide, node) {
  const { x, y, w, h } = node.rect;
  const opts = {
    x,
    y,
    w: Math.max(0.01, w),
    h: Math.max(0.01, h),
    rotate: node.rotate || 0,
  };
  if (node.data || node.dataUrl) {
    opts.data = node.data || node.dataUrl;
  } else if (node.path) {
    opts.path = node.path;
  } else {
    return;
  }
  slide.addImage(opts);
}

function emitText(slide, node, textPatches) {
  const { x, y, w, h } = node.rect;
  const rawRuns =
    Array.isArray(node.runs) && node.runs.length
      ? node.runs
      : [{ text: node.text ?? '' }];

  const isRtl = node.dir === 'rtl' || Boolean(node.rtl) || rawRuns.some((r) => r.dir === 'rtl');

  const pptxRuns = rawRuns.map((r) => {
    const color = (r.color || node.color || '000000').replace('#', '').toUpperCase();
    const opacity = node.ghost || r.ghost ? 0 : (r.opacity ?? node.opacity ?? 1);
    const runOpts = {
      fontSize: r.fontSizePt || node.fontSizePt || 11,
      fontFace: r.fontFace || r.fontFamily || node.fontFace || 'Arial',
      color,
      bold: Boolean(r.bold),
      italic: Boolean(r.italic),
    };
    if (opacity < 1) {
      runOpts.transparency = toTransparency(opacity);
    }
    return { text: r.text ?? '', options: runOpts };
  });

  slide.addText(pptxRuns, {
    x,
    y,
    w: Math.max(0.02, w),
    h: Math.max(0.02, h),
    margin: 0,
    valign: node.valign || 'top',
    align: node.align || (isRtl ? 'right' : 'left'),
    rotate: node.rotate || 0,
    wrap: node.wrap !== 'none',
  });

  textPatches.push({
    zeroInsets: true,
    noAutofit: true,
    wrap: node.wrap,
    lineSpacingPt: node.lineSpacingPt,
    rtl: isRtl,
    ghost: Boolean(node.ghost),
    color: (node.color || rawRuns[0]?.color || '000000').replace('#', '').toUpperCase(),
    runs: rawRuns.map((r) => ({
      baseline: r.baseline ?? null,
      charSpacingPt: r.charSpacingPt ?? null,
      opacity: node.ghost || r.ghost ? 0 : (r.opacity ?? node.opacity ?? 1),
      ghost: Boolean(node.ghost || r.ghost),
      color: (r.color || node.color || '000000').replace('#', '').toUpperCase(),
    })),
  });
}

function emitTable(slide, node, tablePatches) {
  const { x, y, w, h } = node.rect;
  const rows = (node.rows || []).map((row) =>
    (row.cells || row || []).map((cell) => {
      if (typeof cell === 'string') return { text: cell };
      const opts = {
        margin: 0,
        valign: cell.valign || 'middle',
        align: cell.align || 'left',
      };
      if (cell.fill) opts.fill = { color: cell.fill.replace('#', '') };
      if (cell.bold) opts.bold = true;
      if (cell.fontSizePt) opts.fontSize = cell.fontSizePt;
      if (cell.color) opts.color = cell.color.replace('#', '');
      if (cell.colspan > 1) opts.colspan = cell.colspan;
      if (cell.rowspan > 1) opts.rowspan = cell.rowspan;
      return { text: cell.text ?? '', options: opts };
    })
  );

  if (!rows.length) return;

  const opts = {
    x,
    y,
    w: Math.max(0.1, w),
    h: Math.max(0.1, h),
    margin: 0,
  };
  if (node.colWidths?.length) opts.colW = node.colWidths;
  if (node.rowHeights?.length) opts.rowH = node.rowHeights;

  slide.addTable(rows, opts);

  const cellPatches = [];
  (node.rows || []).forEach((row, rIdx) => {
    const cells = row.cells || row || [];
    cells.forEach((cell, cIdx) => {
      if (!cell || typeof cell === 'string') return;
      if (cell.borders || cell.hMerge || cell.vMerge || cell.gridSpan > 1 || cell.rowSpan > 1) {
        cellPatches.push({
          row: rIdx,
          col: cIdx,
          borders: cell.borders,
          hMerge: cell.hMerge,
          vMerge: cell.vMerge,
          gridSpan: cell.gridSpan,
          rowSpan: cell.rowSpan,
        });
      }
    });
  });

  tablePatches.push({ cells: cellPatches });
}

/**
 * Emits all SceneGraph objects into a .pptx Blob in strict z-order
 * and applies deterministic OOXML patches.
 *
 * @param {Array<object>} scenes
 * @param {object} [opts]
 * @param {function} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Blob>}
 */
export async function emitScenes(scenes, { onProgress, signal } = {}) {
  checkAborted(signal);
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('emitScenes requires at least one scene');
  }

  const pptx = new PptxGenJS();
  const dims = scenes[0].dims || { w: 10, h: 7.5 };
  pptx.defineLayout({ name: 'PDFFORGE_V2', width: dims.w, height: dims.h });
  pptx.layout = 'PDFFORGE_V2';

  const slidePatches = [];

  for (let i = 0; i < scenes.length; i++) {
    checkAborted(signal);
    const scene = scenes[i];
    const slide = pptx.addSlide();
    const textPatches = [];
    const tablePatches = [];

    // Ensure strict z-order and inspect band structure
    compositeBands(scene);
    const ordered = [...(scene.nodes || [])].sort(
      (a, b) => a.z - b.z || (a.sub ?? 0) - (b.sub ?? 0)
    );

    for (const node of ordered) {
      if (!node?.rect) continue;
      switch (node.kind) {
        case Kind.SHAPE:
          emitShape(slide, pptx, node);
          break;
        case Kind.IMAGE:
        case Kind.RASTER:
          emitImage(slide, node);
          break;
        case Kind.TEXT:
          emitText(slide, node, textPatches);
          break;
        case Kind.TABLE:
          emitTable(slide, node, tablePatches);
          break;
        default:
          break;
      }
    }

    slidePatches.push({ textPatches, tablePatches });
    onProgress?.({ phase: 'emit', done: i + 1, total: scenes.length });
  }

  checkAborted(signal);
  const rawBuffer = await pptx.write({ outputType: 'arraybuffer' });
  checkAborted(signal);

  return patchOoxml(rawBuffer, slidePatches, { onProgress });
}
