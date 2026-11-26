/**
 * opClassifier.js — Classifies operator-list events, text frames, tables, and images
 * into NATIVE_SHAPE, NATIVE_IMAGE, NATIVE_TEXT, NATIVE_TABLE, BG_REPLAY (T1),
 * or BG_RASTER_REGION (T2), with explicit suppression tracking.
 */

import { Kind } from './sceneGraph.js';
import { contains, intersects, unionRect, decompose } from './slideCoords.js';
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

function rgbHex([r, g, b]) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/**
 * Groups dense path/paint events on a spatial grid to detect vector-heavy
 * charts or illustrations that should be rasterized as T2 regions.
 */
export function densityClusters(events, { gridPt = 24 } = {}, opsOverride = null) {
  const OPS = opsOverride || globalThis.pdfjsLib?.OPS || DEFAULT_PATH_OPS;
  const gridIn = gridPt / 72;
  const cells = new Map();

  for (const e of events) {
    if (e.type !== 'path' || !e.bbox) continue;
    const gx = Math.floor(e.bbox.x / gridIn);
    const gy = Math.floor(e.bbox.y / gridIn);
    const key = `${gx},${gy}`;
    let c = cells.get(key);
    if (!c) {
      c = { z: e.z, rect: e.bbox, segments: 0, beziers: 0 };
      cells.set(key, c);
    } else {
      c.rect = unionRect([c.rect, e.bbox]);
    }
    for (const op of e.ops || []) {
      c.segments++;
      if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
        c.beziers++;
      }
    }
  }

  return [...cells.values()];
}

/**
 * Merges overlapping or adjacent raster regions to minimize T2 crop count.
 */
export function mergeRegions(regions) {
  if (!regions.length) return [];
  const sorted = [...regions].sort((a, b) => a.z - b.z);
  const merged = [];

  for (const r of sorted) {
    const hit = merged.find((m) => intersects(m.rect, r.rect, 0.02));
    if (hit) {
      hit.rect = unionRect([hit.rect, r.rect]);
      hit.z = Math.min(hit.z, r.z);
    } else {
      merged.push({ ...r, rect: { ...r.rect } });
    }
  }
  return merged;
}

/**
 * Conservative native-shape admissibility check:
 * Only axis-aligned solid rectangles, 2-point lines, or simple rules with no skew.
 */
export function asSimpleShape(paintEv, pathEv, opsOverride = null) {
  if (!pathEv || !paintEv.bbox) return null;
  const OPS = opsOverride || globalThis.pdfjsLib?.OPS || DEFAULT_PATH_OPS;
  const { w, h, x, y } = paintEv.bbox;
  if (w * h < 0.0008 && Math.max(w, h) < 0.05) return null;

  const d = decompose(paintEv.ctm);
  if (d.skewed) return null;
  const rotMod = d.rotate % 90;
  if (rotMod > 0.25 && rotMod < 89.75) return null;

  const ops = pathEv.ops || [];
  const isRectOp = ops.length === 1 && ops[0] === OPS.rectangle;
  const isFourLineRect =
    ops.length >= 4 &&
    ops.length <= 5 &&
    ops[0] === OPS.moveTo &&
    ops.slice(1, 4).every((o) => o === OPS.lineTo);
  const isLine = ops.length === 2 && ops[0] === OPS.moveTo && ops[1] === OPS.lineTo && (w < 0.02 || h < 0.02);

  if (!isRectOp && !isFourLineRect && !isLine) return null;
  if (paintEv.dash?.length > 2) return null;

  const hasFill = paintEv.how.includes('fill');
  const hasStroke = paintEv.how.includes('stroke');

  return {
    shapeType: isLine ? 'line' : 'rect',
    rect: { x, y, w, h },
    fill: hasFill ? rgbHex(paintEv.fill) : null,
    fillAlpha: hasFill ? paintEv.alphaF : 1,
    stroke: hasStroke ? rgbHex(paintEv.stroke) : null,
    strokeAlpha: hasStroke ? paintEv.alphaS : 1,
    lineWidthPt: paintEv.lineWidth || 1,
  };
}

/**
 * Classifies all page draw events and extracted elements into native vs background layers.
 */
export function classify(
  events,
  { pageRect, textFrames = [], tables = [], nativeImages = [], opsOverride = null }
) {
  const native = [];
  const replay = [];
  const rasterRegions = [];
  const suppressed = new Set();

  // 1. Complex islands first (shadings, blend modes, soft masks, image masks)
  for (const e of events) {
    if (e.type === 'complex' || e.blend !== 'normal' || e.softMask) {
      rasterRegions.push({
        z: e.z,
        rect: e.complexRect ?? e.bbox ?? pageRect,
        reason: 'complex-op',
      });
    }
  }

  // 2. Vector-density cluster escalation (charts, dense illustrations)
  for (const cluster of densityClusters(events, CFG.vectorCluster, opsOverride)) {
    if (
      cluster.segments > CFG.vectorCluster.maxSegments ||
      cluster.beziers > CFG.vectorCluster.maxBeziers
    ) {
      rasterRegions.push({
        z: cluster.z,
        rect: cluster.rect,
        reason: 'vector-density',
      });
    }
  }

  const mergedRegions = mergeRegions(rasterRegions);

  // 3. Conservative native shapes
  let lastPath = null;
  let nativeShapeCount = 0;
  for (const e of events) {
    if (e.type === 'path') {
      lastPath = e;
      continue;
    }
    if (e.type !== 'paint') continue;
    const owner = mergedRegions.find((r) => intersects(r.rect, e.bbox ?? pageRect));
    if (
      owner ||
      e.complex ||
      e.clipDepth > CFG.maxNativeClipDepth ||
      nativeShapeCount >= CFG.maxNativeShapesPerPage
    ) {
      continue;
    }
    const shape = asSimpleShape(e, lastPath, opsOverride);
    if (shape) {
      native.push({ kind: Kind.SHAPE, z: e.z, ...shape });
      suppressed.add(e.z);
      if (lastPath) suppressed.add(lastPath.z);
      nativeShapeCount++;
    }
  }

  // 4. Native images
  for (const img of nativeImages) {
    if (mergedRegions.some((r) => intersects(r.rect, img.rect))) continue;
    native.push({ kind: Kind.IMAGE, z: img.z, ...img });
    suppressed.add(img.z);
  }

  // 5. Text frames & tables
  for (const tf of textFrames) {
    if (tf.consumedBy) continue;
    const covered = mergedRegions.some((r) => contains(r.rect, tf.rect, 0.75));
    if (covered) {
      native.push({ kind: Kind.TEXT, ...tf, ghost: true });
    } else {
      native.push({ kind: Kind.TEXT, ...tf, ghost: false });
    }
  }
  for (const t of tables) {
    native.push({ kind: Kind.TABLE, ...t });
  }

  // 6. Text ops are always suppressed from T1 replay
  for (const e of events) {
    if (e.type === 'text') suppressed.add(e.z);
  }

  for (const e of events) {
    if (!suppressed.has(e.z)) replay.push(e);
  }

  return {
    native,
    replay,
    rasterRegions: mergedRegions,
    suppressed,
  };
}
