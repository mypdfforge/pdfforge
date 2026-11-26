import { describe, it, expect } from 'vitest';
import { resolveSlideDims, makePageTransform } from '../../src/utils/pptx/slideCoords.js';
import { walkOperators } from '../../src/utils/pptx/opWalk.js';
import { detectTables } from '../../src/utils/pptx/tableDetector.js';
import { extractImages } from '../../src/utils/pptx/imageExtractor.js';

const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  rectangle: 19,
  clip: 28,
  fill: 30,
  stroke: 32,
  setFillRGBColor: 38,
  setStrokeRGBColor: 39,
  paintImageXObject: 85,
  paintInlineImageXObject: 87,
  constructPath: 91,
};

function mockPage(width = 720, height = 540, objsMap = new Map()) {
  return {
    rotate: 0,
    objs: {
      has: (k) => objsMap.has(k),
      get: (k) => objsMap.get(k),
    },
    getViewport: () => ({
      width,
      height,
      rotation: 0,
      transform: [1, 0, 0, -1, 0, height],
    }),
  };
}

function makeSpan(text, x, y, w = 0.8, h = 0.16, z = 10) {
  return {
    z,
    text,
    rect: { x, y, w, h },
    fontSizePt: 11,
    color: '000000',
    fontName: 'F1',
  };
}

describe('PR 4: tableDetector & imageExtractor', () => {
  it('detects lattice tables with colspan, assigns spans, and tags consumedBy', () => {
    // 3x2 grid in slide inches: x in [1, 3, 5, 7], y in [1, 2, 3]
    // Top row has missing interior vertical ruling at x=3 between y=1..2 -> colspan=2 on (0,0)
    const events = [
      // Horizontal lines (with slight 0.3pt jitter to test 0.6pt snapping)
      { type: 'paint', z: 1, how: 'stroke', stroke: [0, 0, 0], lineWidth: 1, bbox: { x: 1, y: 1.0, w: 6, h: 0 } },
      { type: 'paint', z: 2, how: 'stroke', stroke: [0, 0, 0], lineWidth: 1, bbox: { x: 1, y: 2.004, w: 6, h: 0 } },
      { type: 'paint', z: 3, how: 'stroke', stroke: [0, 0, 0], lineWidth: 1, bbox: { x: 1, y: 3.0, w: 6, h: 0 } },
      // Vertical lines
      { type: 'paint', z: 4, how: 'stroke', stroke: [0, 0, 0], lineWidth: 1, bbox: { x: 1.0, y: 1, w: 0, h: 2 } },
      // Interior divider x=3 only spans y=2..3 (row 1), missing in row 0 -> colspan=2
      { type: 'paint', z: 5, how: 'stroke', stroke: [0, 0, 0], lineWidth: 1, bbox: { x: 3.003, y: 2, w: 0, h: 1 } },
      { type: 'paint', z: 6, how: 'stroke', stroke: [0, 0, 0], lineWidth: 1, bbox: { x: 5.0, y: 1, w: 0, h: 2 } },
      { type: 'paint', z: 7, how: 'stroke', stroke: [0, 0, 0], lineWidth: 1, bbox: { x: 7.0, y: 1, w: 0, h: 2 } },
    ];

    const spans = [
      makeSpan('Merged Header', 2.2, 1.4, 1.5),
      makeSpan('Note', 5.4, 1.4, 0.6),
      makeSpan('A1', 1.3, 2.4, 0.4),
      makeSpan('B1', 3.3, 2.4, 0.4),
      makeSpan('C1', 5.3, 2.4, 0.4),
      makeSpan('Outside Title', 1.0, 0.4, 1.5),
    ];

    const tables = detectTables(spans, events, { pageRect: { x: 0, y: 0, w: 10, h: 7.5 } });
    expect(tables).toHaveLength(1);

    const tbl = tables[0];
    expect(tbl.colW).toHaveLength(3);
    expect(tbl.rowH).toHaveLength(2);
    expect(tbl.rows[0].cells).toHaveLength(2);
    expect(tbl.rows[0].cells[0].colspan).toBe(2);
    expect(tbl.rows[0].cells[0].text).toBe('Merged Header');
    expect(tbl.rows[0].cells[1].text).toBe('Note');
    expect(tbl.rows[1].cells).toHaveLength(3);
    expect(tbl.rows[1].cells[1].text).toBe('B1');

    // ConsumedBy tagging
    for (let i = 0; i < 5; i++) {
      expect(spans[i].consumedBy).toBe(tbl.id);
    }
    expect(spans[5].consumedBy).toBeUndefined();
  });

  it('detects borderless stream tables and rejects multi-column prose bands', () => {
    const streamSpans = [
      // Row 0
      makeSpan('Item', 1.0, 1.0, 0.6),
      makeSpan('Qty', 3.0, 1.0, 0.4),
      makeSpan('Price', 5.0, 1.0, 0.6),
      // Row 1
      makeSpan('Apples', 1.0, 1.3, 0.7),
      makeSpan('12', 3.0, 1.3, 0.3),
      makeSpan('$4.50', 5.0, 1.3, 0.6),
      // Row 2
      makeSpan('Oranges', 1.0, 1.6, 0.8),
      makeSpan('8', 3.0, 1.6, 0.2),
      makeSpan('$3.20', 5.0, 1.6, 0.6),
      // Row 3
      makeSpan('Bananas', 1.0, 1.9, 0.8),
      makeSpan('15', 3.0, 1.9, 0.3),
      makeSpan('$2.10', 5.0, 1.9, 0.6),
    ];

    const tables = detectTables(streamSpans, [], { pageRect: { x: 0, y: 0, w: 10, h: 7.5 } });
    expect(tables).toHaveLength(1);
    expect(tables[0].colW).toHaveLength(3);
    expect(tables[0].rows).toHaveLength(4);
    expect(tables[0].rows[1].cells[0].text).toBe('Apples');
    expect(tables[0].rows[2].cells[2].text).toBe('$3.20');
    expect(streamSpans.every((s) => s.consumedBy === tables[0].id)).toBe(true);

    // Multi-column prose band with long sentences should be rejected
    const proseSpans = [
      makeSpan('This is a long sentence in the first newsletter column that wraps naturally.', 0.5, 4.0, 2.5),
      makeSpan('Another long paragraph in the middle column describing various topics.', 3.5, 4.0, 2.5),
      makeSpan('And a third column of continuous prose text that is not tabular data.', 6.5, 4.0, 2.5),
      makeSpan('Continuing the first column with more descriptive narrative sentences here.', 0.5, 4.25, 2.5),
      makeSpan('Continuing the second column with additional commentary and explanations.', 3.5, 4.25, 2.5),
      makeSpan('Continuing the third column with final concluding remarks for readers.', 6.5, 4.25, 2.5),
      makeSpan('Final line of the first column wrapping cleanly to the bottom margin.', 0.5, 4.5, 2.5),
      makeSpan('Final line of the second column wrapping cleanly to the bottom margin.', 3.5, 4.5, 2.5),
      makeSpan('Final line of the third column wrapping cleanly to the bottom margin.', 6.5, 4.5, 2.5),
    ];

    const proseTables = detectTables(proseSpans, [], {
      pageRect: { x: 0, y: 0, w: 10, h: 7.5 },
      columns: [
        { x: 0.5, w: 2.6 },
        { x: 3.5, w: 2.6 },
        { x: 6.5, w: 2.6 },
      ],
    });
    expect(proseTables).toHaveLength(0);
    expect(proseSpans.some((s) => s.consumedBy)).toBe(false);
  });

  it('extracts images, computes clipBox crop, deduplicates hashes, and skips skewed/smask images', () => {
    const rgbData = new Uint8Array([
      255, 0, 0,
      0, 255, 0,
      0, 0, 255,
      255, 255, 0,
    ]);
    const objs = new Map([
      ['img_ok', { width: 2, height: 2, kind: 2, data: rgbData }],
      ['img_smask', { width: 2, height: 2, kind: 2, data: rgbData, smask: { width: 2, height: 2 } }],
    ]);

    const page = mockPage(720, 540, objs);
    const tf = makePageTransform(page, resolveSlideDims(page, 'auto'));

    const opList = {
      fnArray: [
        // 1. Clipped RGB image: placed at (72, 72) size (288, 144) in PDF space -> (1in, 4.5in, 4in, 2in)
        // Clipped to left half (72, 72, 144, 144) -> (1in, 4.5in, 2in, 2in) => crop.r = 0.5
        OPS.save,
        OPS.constructPath,
        OPS.clip,
        OPS.save,
        OPS.transform,
        OPS.paintImageXObject,
        OPS.restore,
        OPS.restore,

        // 2. Skewed inline image -> should be skipped
        OPS.save,
        OPS.transform,
        OPS.paintInlineImageXObject,
        OPS.restore,

        // 3. Image with smask -> should be skipped
        OPS.save,
        OPS.transform,
        OPS.paintImageXObject,
        OPS.restore,

        // 4. Duplicate unclipped inline image with same pixels -> same hash
        OPS.save,
        OPS.transform,
        OPS.paintInlineImageXObject,
        OPS.restore,
      ],
      argsArray: [
        [],
        [[OPS.rectangle], [72, 72, 144, 144], 72, 72, 216, 216],
        [],
        [],
        [288, 0, 0, 144, 72, 72],
        ['img_ok'],
        [],
        [],

        [],
        [144, 30, 0, 144, 400, 100], // skewed (a*c + b*d != 0)
        [{ width: 2, height: 2, kind: 2, data: rgbData }],
        [],

        [],
        [144, 0, 0, 144, 400, 300],
        ['img_smask'],
        [],

        [],
        [144, 0, 0, 144, 400, 100],
        [{ width: 2, height: 2, kind: 2, data: rgbData }],
        [],
      ],
    };

    const events = walkOperators(opList, tf, { opsOverride: OPS });
    const images = extractImages(page, events, tf);

    expect(images).toHaveLength(2);

    // First image: clipped on right by 50%
    expect(images[0].mime).toBe('image/png');
    expect(images[0].width).toBe(2);
    expect(images[0].height).toBe(2);
    expect(images[0].crop).not.toBeNull();
    expect(images[0].crop.r).toBeCloseTo(0.5, 2);
    expect(images[0].crop.l).toBeCloseTo(0, 2);
    expect(images[0].rect.w).toBeCloseTo(2, 2);

    // Second image: unclipped duplicate -> same content hash
    expect(images[1].crop).toBeNull();
    expect(images[1].hash).toBe(images[0].hash);
  });
});
