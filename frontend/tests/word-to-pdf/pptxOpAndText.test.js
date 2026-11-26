import { describe, it, expect } from 'vitest';
import { resolveSlideDims, makePageTransform } from '../../src/utils/pptx/slideCoords.js';
import { walkOperators } from '../../src/utils/pptx/opWalk.js';
import { extractStyledSpans, normalizeUnicode } from '../../src/utils/pptx/textStateExtractor.js';

const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  setLineWidth: 18,
  setLineCap: 19,
  setLineJoin: 20,
  setDash: 21,
  clip: 28,
  eoClip: 29,
  fill: 30,
  eoFill: 31,
  stroke: 32,
  setFillRGBColor: 38,
  setStrokeRGBColor: 39,
  setFillCMYKColor: 40,
  setGState: 42,
  beginText: 60,
  setFont: 61,
  setTextMatrix: 62,
  setCharSpacing: 63,
  setHScale: 64,
  setTextRise: 65,
  setTextRenderingMode: 66,
  showText: 67,
  paintFormXObjectBegin: 80,
  paintFormXObjectEnd: 81,
  paintImageXObject: 85,
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

describe('PR 2: opWalk & textStateExtractor', () => {
  it('tracks graphics state, CMYK/RGB colors, alpha, clips, and complex ops in opWalk', () => {
    const page = mockPage(720, 540);
    const tf = makePageTransform(page, resolveSlideDims(page, 'auto'));

    const opList = {
      fnArray: [
        OPS.save,
        OPS.setFillRGBColor,
        OPS.setGState,
        OPS.constructPath,
        OPS.fill,
        OPS.restore,
        OPS.setFillCMYKColor,
        OPS.shadingFill,
      ],
      argsArray: [
        [],
        [255, 128, 0],
        [[['ca', 0.5], ['BM', 'Multiply']]],
        [[91], [72, 72, 144, 72], 72, 72, 216, 144],
        [],
        [],
        [0, 1, 1, 0], // CMYK pure red -> [255, 0, 0]
        [],
      ],
    };

    const events = walkOperators(opList, tf, { opsOverride: OPS });
    const paintEv = events.find((e) => e.type === 'paint');
    expect(paintEv).toBeDefined();
    expect(paintEv.fill).toEqual([255, 128, 0]);
    expect(paintEv.alphaF).toBe(0.5);
    expect(paintEv.blend).toBe('Multiply');
    expect(paintEv.complex).toBe(true);

    // After restore, alphaF and blend reset back to defaults; CMYK red applies
    const complexEv = events.find((e) => e.type === 'complex');
    expect(complexEv.fill).toEqual([255, 0, 0]);
    expect(complexEv.alphaF).toBe(1);
    expect(complexEv.blend).toBe('normal');
  });

  it('correlates getTextContent items with operator-list text state (color, rise, Tc, alpha)', async () => {
    const page = mockPage(720, 540);
    const tf = makePageTransform(page, resolveSlideDims(page, 'auto'));

    const opList = {
      fnArray: [
        OPS.beginText,
        OPS.setFont,
        OPS.setFillRGBColor,
        OPS.setGState,
        OPS.setCharSpacing,
        OPS.setTextRise,
        OPS.setTextMatrix,
        OPS.showText,
      ],
      argsArray: [
        [],
        ['F1', 12],
        [30, 64, 175],
        [[['ca', 0.8]]],
        [0.05],
        [4],
        [1, 0, 0, 1, 72, 468],
        [['A']],
      ],
    };

    const events = walkOperators(opList, tf, { opsOverride: OPS });
    const spans = await extractStyledSpans(null, tf, events, {
      textContentOverride: {
        items: [
          {
            str: '\uFB01nance\u00AD2',
            transform: [12, 0, 0, 12, 72, 468],
            width: 48,
            fontName: 'F1',
            dir: 'ltr',
          },
        ],
        styles: {
          F1: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2 },
        },
      },
    });

    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe('finance2');
    expect(spans[0].color).toBe('1E40AF');
    expect(spans[0].opacity).toBe(0.8);
    expect(spans[0].baseline).toBe('super');
    expect(spans[0].fontSizePt).toBeCloseTo(12, 2);
    expect(spans[0].rect.x).toBeCloseTo(1, 3); // 72pt = 1in
  });

  it('normalizes Unicode ligatures and PUA bullets without reversing RTL strings', () => {
    expect(normalizeUnicode('\uF0B7 \uFB02ow\u00ADchart')).toBe('\u2022 flowchart');
    const arabic = 'مرحبا بالعالم';
    expect(normalizeUnicode(arabic)).toBe(arabic);
  });
});
