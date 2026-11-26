/**
 * sceneGraph.js — Slide-First 2D Scene Graph node model, deterministic z-ordering,
 * and z-safe raster band compositing.
 */

import { intersects } from './slideCoords.js';

export const Kind = {
  TEXT: 'text',
  TABLE: 'table',
  SHAPE: 'shape',
  IMAGE: 'image',
  RASTER: 'raster',
};

let _seq = 0;

/**
 * Creates a scene node with absolute slide-inch geometry and monotonic z-order.
 */
export function makeNode(kind, z, rect, props = {}) {
  return {
    id: `n${z}_${++_seq}`,
    kind,
    z,
    rect,
    rotate: 0,
    opacity: 1,
    containerId: null,
    ...props,
  };
}

export function createScene(pageIndex, dims) {
  return {
    pageIndex,
    dims: { w: dims.w, h: dims.h },
    nodes: [],
    meta: { decisions: [] },
  };
}

/**
 * Sorts scene nodes in deterministic PDF draw order (z, then intra-op sub-index).
 * PowerPoint spTree order equals insertion order.
 */
export function finalizeScene(scene) {
  scene.nodes.sort((a, b) => a.z - b.z || (a.sub ?? 0) - (b.sub ?? 0));
  return scene;
}

/**
 * Splits raster layers into z-safe bands whenever a raster node overlaps
 * an already-emitted native text or table node (e.g. watermarks, overlay bars).
 * Escalates to 'page-raster' if too many bands are required.
 */
export function compositeBands(scene, { maxBands = 4 } = {}) {
  const bands = [];
  let cur = null;
  const emittedText = [];

  const flush = () => {
    if (cur?.nodes.length) bands.push(cur);
    cur = null;
  };

  for (const n of scene.nodes) {
    if (n.kind === Kind.RASTER) {
      const coversText = emittedText.some((t) => intersects(t.rect, n.rect, 0.01));
      if (!cur || coversText) {
        flush();
        cur = {
          zStart: n.z,
          zEnd: n.z,
          nodes: [],
          above: emittedText.length > 0,
        };
      }
      cur.nodes.push(n);
      cur.zEnd = n.z;
    } else if (n.kind === Kind.TEXT || n.kind === Kind.TABLE) {
      emittedText.push(n);
    }
  }
  flush();

  if (bands.length > maxBands) {
    return { escalate: 'page-raster', bands };
  }
  return { escalate: null, bands };
}
