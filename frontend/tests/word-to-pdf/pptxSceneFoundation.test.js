import { describe, it, expect } from 'vitest';
import {
  PT_PER_IN,
  EMU_PER_IN,
  resolveSlideDims,
  makePageTransform,
  decompose,
  inToEmu,
  intersects,
  contains,
  unionRect,
} from '../../src/utils/pptx/slideCoords.js';
import {
  Kind,
  makeNode,
  createScene,
  finalizeScene,
  compositeBands,
} from '../../src/utils/pptx/sceneGraph.js';
import { probeOperatorIr } from '../../src/utils/pptx/irProbe.js';
import { CFG } from '../../src/utils/pptx/config.js';

/** Minimal mock of pdf.js PageViewport at scale 1 */
function mockPage({ width = 720, height = 405, rotate = 0, viewBox = null } = {}) {
  const [vx0, vy0] = viewBox || [0, 0, width, height];
  // Standard pdf.js scale=1 top-down transform for unrotated or 90-deg rotated page
  let transform;
  if (rotate === 90) {
    transform = [0, 1, 1, 0, -vy0, -vx0];
  } else {
    // y-flip: (x, y) -> (x - vx0, height - (y - vy0))
    transform = [1, 0, 0, -1, -vx0, height + vy0];
  }
  return {
    rotate,
    getViewport: () => ({ width: rotate === 90 ? height : width, height: rotate === 90 ? width : height, rotation: rotate, transform }),
  };
}

describe('PR 1: slideCoords, sceneGraph, config, irProbe', () => {
  it('resolves slide dimensions for auto, 16:9, 4:3 and clamps extreme sizes', () => {
    const widescreen = mockPage({ width: 960, height: 540 });
    const dAuto = resolveSlideDims(widescreen, 'auto');
    expect(dAuto.w).toBeCloseTo(960 / 72, 4);
    expect(dAuto.h).toBeCloseTo(540 / 72, 4);
    expect(dAuto.scale).toBeCloseTo(1, 4);

    const d169 = resolveSlideDims(mockPage({ width: 595.28, height: 841.89 }), '16:9');
    expect(d169.w).toBeCloseTo(13.3333, 4);
    expect(d169.h).toBe(7.5);
    expect(d169.offX).toBeGreaterThan(0);

    const tiny = mockPage({ width: 36, height: 36 });
    const dTiny = resolveSlideDims(tiny, 'auto');
    expect(dTiny.w).toBeGreaterThanOrEqual(1);
    expect(dTiny.h).toBeGreaterThanOrEqual(1);

    const huge = mockPage({ width: 7200, height: 3600 });
    const dHuge = resolveSlideDims(huge, 'auto');
    expect(dHuge.w).toBeLessThanOrEqual(56);
    expect(dHuge.h).toBeLessThanOrEqual(56);
  });

  it('transforms PDF bottom-up + CropBox + rotated coordinates into top-down slide inches', () => {
    // 10in x 5in page with CropBox offset [36, 72]
    const page = mockPage({ width: 720, height: 360, viewBox: [36, 72, 756, 432] });
    const dims = resolveSlideDims(page, 'auto');
    const tf = makePageTransform(page, dims);

    // Top-left of CropBox in PDF bottom-up space is (36, 432) -> (0, 0) inches
    const tl = tf.pt(36, 432);
    expect(tl.x).toBeCloseTo(0, 4);
    expect(tl.y).toBeCloseTo(0, 4);

    // Bottom-right of CropBox (756, 72) -> (10, 5) inches
    const br = tf.pt(756, 72);
    expect(br.x).toBeCloseTo(10, 4);
    expect(br.y).toBeCloseTo(5, 4);

    // Mixed-orientation page centers into shared 16:9 deck dims
    const portrait = mockPage({ width: 360, height: 720 });
    const tfPortrait = makePageTransform(portrait, { w: 13.3333, h: 7.5 });
    expect(tfPortrait.dims.offX).toBeGreaterThan(4);
    expect(tfPortrait.dims.scale).toBeCloseTo(0.75, 4);
  });

  it('decomposes affine matrices and checks geometry helpers', () => {
    const angle = Math.PI / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const d = decompose([2 * cos, 2 * sin, -3 * sin, 3 * cos, 1.5, 2.5]);
    expect(d.x).toBeCloseTo(1.5, 4);
    expect(d.y).toBeCloseTo(2.5, 4);
    expect(d.sx).toBeCloseTo(2, 4);
    expect(d.sy).toBeCloseTo(3, 4);
    expect(d.rotate).toBeCloseTo(45, 3);
    expect(d.skewed).toBe(false);

    const skewed = decompose([1, 0, 0.5, 1, 0, 0]);
    expect(skewed.skewed).toBe(true);

    expect(inToEmu(1)).toBe(EMU_PER_IN);
    expect(PT_PER_IN).toBe(72);

    const a = { x: 1, y: 1, w: 2, h: 2 };
    const b = { x: 1.5, y: 1.5, w: 1, h: 1 };
    expect(intersects(a, b)).toBe(true);
    expect(contains(a, b)).toBe(true);
    expect(unionRect([a, { x: 0, y: 0, w: 1, h: 1 }])).toEqual({ x: 0, y: 0, w: 3, h: 3 });
  });

  it('orders scene nodes deterministically and splits z-safe raster bands', () => {
    const scene = createScene(0, { w: 10, h: 5.625 });
    scene.nodes.push(makeNode(Kind.TEXT, 5, { x: 1, y: 1, w: 3, h: 1 }));
    scene.nodes.push(makeNode(Kind.RASTER, 1, { x: 0, y: 0, w: 10, h: 5.625 }));
    scene.nodes.push(makeNode(Kind.RASTER, 8, { x: 1.5, y: 1.2, w: 2, h: 0.5 })); // watermark over text
    finalizeScene(scene);

    expect(scene.nodes.map((n) => n.z)).toEqual([1, 5, 8]);
    const res = compositeBands(scene, { maxBands: CFG.maxBands });
    expect(res.escalate).toBeNull();
    expect(res.bands).toHaveLength(2);
    expect(res.bands[0].above).toBe(false);
    expect(res.bands[1].above).toBe(true);

    // Exceeding maxBands escalates to page-raster
    const resEsc = compositeBands(scene, { maxBands: 1 });
    expect(resEsc.escalate).toBe('page-raster');
  });

  it('validates pdf.js operator IR shapes with irProbe', () => {
    const mockOps = {
      save: 10, restore: 11, transform: 12, setGState: 42,
      setFillRGBColor: 38, setStrokeRGBColor: 39, constructPath: 91,
      fill: 30, stroke: 32, clip: 28, beginText: 31, setFont: 37,
      setTextMatrix: 44, showText: 46, paintImageXObject: 85,
    };
    const validSample = {
      fnArray: [91, 42],
      argsArray: [
        [[13, 14], [0, 0, 10, 10], 0, 0, 10, 10],
        [[['ca', 0.5]]],
      ],
    };
    expect(probeOperatorIr(mockOps, validSample).ok).toBe(true);

    const badSample = { fnArray: [91], argsArray: [[[13], [0, 0]]] };
    expect(probeOperatorIr(mockOps, badSample).ok).toBe(false);
    expect(probeOperatorIr({ save: 10 }).ok).toBe(false);
  });
});
