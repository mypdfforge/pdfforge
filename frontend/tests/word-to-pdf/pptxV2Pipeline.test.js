import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { resolveSlideDims } from '../../src/utils/pptx/slideCoords.js';
import { buildSceneForPage } from '../../src/utils/pptx/v2Pipeline.js';
import { emitScenes } from '../../src/utils/pptx/slideEmitter.js';
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
  setFont: 61,
  setTextMatrix: 62,
  showText: 67,
  paintImageXObject: 85,
  constructPath: 91,
};

function createMockPdfPage() {
  const width = 720;
  const height = 540;
  const mockCanvas = {
    width: 10,
    height: 10,
    getContext: () => ({
      lineJoin: 'miter',
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      setTransform: () => {},
      save: () => {},
      restore: () => {},
      clip: () => {},
      fill: () => {},
      stroke: () => {},
      setLineDash: () => {},
    }),
    toBlob: (cb) => cb(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })),
  };

  const mockPath = {
    moveTo: () => {},
    lineTo: () => {},
    bezierCurveTo: () => {},
    closePath: () => {},
    rect: () => {},
  };

  const page = {
    rotate: 0,
    commonObjs: { has: () => false },
    objs: { has: () => false },
    getViewport: () => ({
      width,
      height,
      rotation: 0,
      transform: [1, 0, 0, -1, 0, height],
    }),
    getOperatorList: async () => ({
      fnArray: [
        OPS.setFillRGBColor,
        OPS.constructPath,
        OPS.fill,
        OPS.beginText,
        OPS.setFont,
        OPS.setFillRGBColor,
        OPS.setTextMatrix,
        OPS.showText,
      ],
      argsArray: [
        [241, 245, 249],
        [[OPS.rectangle], [36, 400, 648, 100], 36, 400, 684, 500],
        [],
        [],
        ['F1', 20],
        [15, 23, 42],
        [1, 0, 0, 1, 72, 460],
        [['Title']],
      ],
    }),
    getTextContent: async () => ({
      items: [
        {
          str: 'Executive Summary',
          transform: [20, 0, 0, 20, 72, 460],
          width: 220,
          fontName: 'F1',
          dir: 'ltr',
        },
      ],
      styles: {
        F1: { fontFamily: 'Arial', ascent: 0.8, descent: -0.2 },
      },
    }),
  };

  return { page, mockCanvas, mockPath };
}

describe('v2Pipeline end-to-end scene build & PPTX emission', () => {
  it('builds a z-ordered SceneGraph from a PDF page and emits a valid .pptx', async () => {
    const { page, mockCanvas, mockPath } = createMockPdfPage();
    const sharedDims = resolveSlideDims(page, 'auto');

    const scene = await buildSceneForPage(page, 0, sharedDims, {
      opsOverride: OPS,
      canvasFactory: () => mockCanvas,
      pathFactory: () => mockPath,
    });

    expect(scene.nodes.some((n) => n.kind === Kind.SHAPE)).toBe(true);
    expect(scene.nodes.some((n) => n.kind === Kind.TEXT)).toBe(true);

    const blob = await emitScenes([scene]);
    expect(blob.size).toBeGreaterThan(1000);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slide1 = await zip.file('ppt/slides/slide1.xml')?.async('string');
    expect(slide1).toContain('Executive Summary');
    expect(slide1).toContain('lIns="0"');
    expect(slide1).toContain('<a:noAutofit/>');
  });
});
