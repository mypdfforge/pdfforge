/**
 * config.js — Centralized thresholds, budgets, and degradation ladder parameters
 * for the PDF → PPTX v2 Slide-First 2D Scene Graph engine.
 */

export const CFG = {
  dpi: {
    start: 3,
    min: 1.5,
    maxLayerPixels: 12e6,
  },
  vectorCluster: {
    maxSegments: 120,
    maxBeziers: 24,
    gridPt: 24,
  },
  maxNativeShapesPerPage: 400,
  maxNativeClipDepth: 1,
  maxBands: 4,
  merge: {
    maxGapLh: 1.45,
    alignTolIn: 0.028,
  },
  fit: {
    maxShrink: 0.08,
    maxGrow: 0.03,
    minPt: 6,
  },
  fidelity: {
    ssimTarget: 0.985,
    diffFailRatio: 0.02,
  },
  memory: {
    maxLivePages: 2,
    cleanupAfterEmit: true,
  },
  ocr: {
    minCharsPerPage: 12,
    maxDpi: 2,
  },
};
