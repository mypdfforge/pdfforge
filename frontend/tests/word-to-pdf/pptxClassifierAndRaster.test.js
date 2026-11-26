import { describe, it, expect } from 'vitest';
import { resolveSlideDims, makePageTransform } from '../../src/utils/pptx/slideCoords.js';
import { walkOperators } from '../../src/utils/pptx/opWalk.js';
import { classify } from '../../src/utils/pptx/opClassifier.js';
import { replayToCanvas, computeSafeDpi } from '../../src/utils/pptx/backgroundRasterizer.js';
import { Kind } from '../../src/utils/pptx/sceneGraph.js';

const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  closePath: 18,
  rectangle: 19,
  clip: 28,
  fill: 30,
  stroke: 32,
  setFillRGBColor: 38,
  setStrokeRGBColor: 39,
  setGState: 42,
  beginText: 60,
  setTextMatrix: 62,
  showText: 67,
  shadingFill: 89,
  constructPath: 91,
};

function mockPage(width = 720, height = 540) {
  return {
    rotate: 0,
    getViewport: () => ({
      width,
      height,
      rotation: 0,
      transform: [1, 0, 0, -1, 0, height],
    }),
  };
}

describe('PR 3: opClassifier & backgroundRasterizer', () => {
  it('classifies simple solid rects as native shapes, suppresses text from T1, and ghosts covered text', () => {
    const page = mockPage(720, 540);
    const tf = makePageTransform(page, resolveSlideDims(page, 'auto'));
    const pageRect = { x: 0, y: 0, w: 10, h: 7.5 };

    const opList = {
      fnArray: [
        OPS.setFillRGBColor,
        OPS.constructPath,
        OPS.fill,
        OPS.beginText,
        OPS.setTextMatrix,
        OPS.showText,
        OPS.constructPath,
        OPS.shadingFill,
      ],
      argsArray: [
        [240, 240, 240],
        [[OPS.rectangle], [72, 72, 216, 144], 72, 72, 288, 216],
        [],
        [],
        [1, 0, 0, 1, 400, 300],
        [['hi']],
        [[OPS.rectangle], [360, 180, 288, 216], 360, 180, 648, 396],
        [],
      ],
    };

    const events = walkOperators(opList, tf, { opsOverride: OPS });
    const textFrames = [
      { z: 4, rect: { x: 1.2, y: 5.0, w: 1.0, h: 0.3 }, runs: [{ text: 'Native' }] },
      { z: 5, rect: { x: 5.5, y: 2.5, w: 2.0, h: 0.5 }, runs: [{ text: 'Inside shading' }] },
    ];

    const res = classify(events, { pageRect, textFrames, opsOverride: OPS });

    const nativeShapes = res.native.filter((n) => n.kind === Kind.SHAPE);
    expect(nativeShapes).toHaveLength(1);
    expect(nativeShapes[0].fill).toBe('F0F0F0');

    const nativeTexts = res.native.filter((n) => n.kind === Kind.TEXT);
    expect(nativeTexts).toHaveLength(2);
    expect(nativeTexts[0].ghost).toBe(false);
    expect(nativeTexts[1].ghost).toBe(true);

    // Neither text ops nor native shape ops remain in T1 replay
    expect(res.replay.some((e) => e.type === 'text')).toBe(false);
    expect(res.rasterRegions).toHaveLength(1);
    expect(res.rasterRegions[0].reason).toBe('complex-op');
  });

  it('replays filtered T1 events to a 2D canvas context and respects maxLayerPixels DPI cap', () => {
    expect(computeSafeDpi(10, 7.5, 3)).toBe(3);
    expect(computeSafeDpi(40, 30, 3)).toBeLessThan(3);

    const page = mockPage(720, 540);
    const tf = makePageTransform(page, resolveSlideDims(page, 'auto'));

    const calls = [];
    const mockCtx = {
      lineJoin: 'miter',
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      setTransform: (...args) => calls.push(['setTransform', args]),
      save: () => calls.push(['save']),
      restore: () => calls.push(['restore']),
      clip: () => calls.push(['clip']),
      fill: () => calls.push(['fill']),
      stroke: () => calls.push(['stroke']),
      setLineDash: () => {},
    };
    const mockPath = {
      moveTo: () => {},
      lineTo: () => {},
      bezierCurveTo: () => {},
      closePath: () => {},
      rect: () => {},
    };

    const events = walkOperators(
      {
        fnArray: [OPS.save, OPS.constructPath, OPS.clip, OPS.constructPath, OPS.fill, OPS.restore],
        argsArray: [
          [],
          [[OPS.rectangle], [0, 0, 720, 540], 0, 0, 720, 540],
          [],
          [[OPS.moveTo, OPS.lineTo], [0, 0, 100, 100], 0, 0, 100, 100],
          [],
          [],
        ],
      },
      tf,
      { opsOverride: OPS }
    );

    replayToCanvas(events, tf, 72, 10, 7.5, {
      opsOverride: OPS,
      canvasFactory: (w, h) => ({ width: w, height: h, getContext: () => mockCtx }),
      pathFactory: () => mockPath,
    });

    expect(calls.some((c) => c[0] === 'clip')).toBe(true);
    expect(calls.some((c) => c[0] === 'fill')).toBe(true);
    expect(calls.some((c) => c[0] === 'restore')).toBe(true);
  });
});
