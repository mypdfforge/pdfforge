import { describe, it, expect } from 'vitest';
import { recursiveXYCut } from '../../src/dla/xycut.js';
import { traverseReadingOrder, computeKendallTau, verifyFlowOrder } from '../../src/dla/readingOrder.js';
import { classifyLeafBlock } from '../../src/dla/classify.js';
import { TextLine } from '../../src/dla/lines.js';

describe('Milestone M3: Multi-Column XY-Cut & Reading Order (§5 S3)', () => {
  function makeLine(x0: number, y0: number, x1: number, y1: number, text: string, font = 'Calibri'): TextLine {
    return {
      baseline: y1 - 2,
      dominantSize: 11,
      dominantFont: font,
      box: { x0, y0, x1, y1 },
      segments: [{ box: { x0, y0, x1, y1 }, text, runs: [{ text, font }] }],
      glyphs: [],
    };
  }

  it('preserves top-to-bottom reading order in a single-column layout', () => {
    const lines = [
      makeLine(50, 50, 450, 62, 'Line 1'),
      makeLine(50, 70, 450, 82, 'Line 2'),
      makeLine(50, 90, 450, 102, 'Line 3'),
    ];

    const cutTree = recursiveXYCut(lines);
    const leaves = traverseReadingOrder(cutTree);
    expect(leaves.length).toBeGreaterThanOrEqual(1);

    const orderedTexts = leaves.flat().map((l) => l.segments[0].text);
    expect(orderedTexts).toEqual(['Line 1', 'Line 2', 'Line 3']);
  });

  it('correctly orders a 2-column layout: left column before right column', () => {
    // Left column: x = [50..250], y = 100, 120, 140
    // Right column: x = [300..500], y = 100, 120, 140
    const colLeft = [
      makeLine(50, 100, 250, 112, 'Left 1'),
      makeLine(50, 120, 250, 132, 'Left 2'),
      makeLine(50, 140, 250, 152, 'Left 3'),
    ];
    const colRight = [
      makeLine(300, 100, 500, 112, 'Right 1'),
      makeLine(300, 120, 500, 132, 'Right 2'),
      makeLine(300, 140, 500, 152, 'Right 3'),
    ];

    // Mixed input simulating PDF extraction order
    const mixed = [colLeft[0], colRight[0], colLeft[1], colRight[1], colLeft[2], colRight[2]];

    const cutTree = recursiveXYCut(mixed);
    const leaves = traverseReadingOrder(cutTree);
    const orderedTexts = leaves.flat().map((l) => l.segments[0].text);

    // Left column must be read completely before Right column!
    expect(orderedTexts).toEqual(['Left 1', 'Left 2', 'Left 3', 'Right 1', 'Right 2', 'Right 3']);
  });

  it('correctly handles spanning title above two columns', () => {
    const title = makeLine(50, 40, 500, 56, 'Spanning Document Title');
    const colLeft = [
      makeLine(50, 100, 250, 112, 'Left 1'),
      makeLine(50, 120, 250, 132, 'Left 2'),
      makeLine(50, 140, 250, 152, 'Left 3'),
    ];
    const colRight = [
      makeLine(300, 100, 500, 112, 'Right 1'),
      makeLine(300, 120, 500, 132, 'Right 2'),
      makeLine(300, 140, 500, 152, 'Right 3'),
    ];

    const lines = [title, colRight[0], colLeft[0], colRight[1], colLeft[1], colRight[2], colLeft[2]];

    const cutTree = recursiveXYCut(lines);
    const leaves = traverseReadingOrder(cutTree);
    const orderedTexts = leaves.flat().map((l) => l.segments[0].text);

    expect(orderedTexts[0]).toBe('Spanning Document Title');
    expect(orderedTexts.slice(1, 4)).toEqual(['Left 1', 'Left 2', 'Left 3']);
    expect(orderedTexts.slice(4)).toEqual(['Right 1', 'Right 2', 'Right 3']);
  });

  it('computes Kendall-tau reading order metric accurately', () => {
    const gold = ['1', '2', '3', '4'];
    expect(computeKendallTau(['1', '2', '3', '4'], gold)).toBe(1.0);
    expect(computeKendallTau(['2', '1', '3', '4'], gold)).toBeCloseTo(5 / 6, 4);
    expect(computeKendallTau(['4', '3', '2', '1'], gold)).toBe(0.0);
  });
});

describe('Milestone M3: Leaf Region Classification (§5 S3)', () => {
  it('classifies code blocks with monospace font', () => {
    const monoLines: TextLine[] = [
      {
        baseline: 50,
        dominantSize: 10,
        dominantFont: 'CourierNew',
        box: { x0: 50, y0: 40, x1: 300, y1: 52 },
        segments: [{ box: { x0: 50, y0: 40, x1: 300, y1: 52 }, text: 'const x = 42;', runs: [] }],
        glyphs: [],
      },
      {
        baseline: 65,
        dominantSize: 10,
        dominantFont: 'CourierNew',
        box: { x0: 50, y0: 55, x1: 300, y1: 67 },
        segments: [{ box: { x0: 50, y0: 55, x1: 300, y1: 67 }, text: 'console.log(x);', runs: [] }],
        glyphs: [],
      },
    ];

    const fontInfo = {
      key: 'CourierNew',
      pdfName: 'CourierNew',
      family: 'Courier New',
      bold: false,
      italic: false,
      mono: true,
      serif: false,
      symbolic: false,
    };

    const cls = classifyLeafBlock(monoLines, 612, 792, [fontInfo]);
    expect(cls).toBe('code');
  });

  it('classifies callouts with narrow widths', () => {
    const calloutLines: TextLine[] = [
      {
        baseline: 150,
        dominantSize: 10,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 140, x1: 180, y1: 152 },
        segments: [{ box: { x0: 50, y0: 140, x1: 180, y1: 152 }, text: 'Quick tip sidebar', runs: [] }],
        glyphs: [],
      },
      {
        baseline: 165,
        dominantSize: 10,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 155, x1: 180, y1: 167 },
        segments: [{ box: { x0: 50, y0: 155, x1: 180, y1: 167 }, text: 'More details here.', runs: [] }],
        glyphs: [],
      },
    ];

    const cls = classifyLeafBlock(calloutLines, 612, 792);
    expect(cls).toBe('callout');
  });
});
