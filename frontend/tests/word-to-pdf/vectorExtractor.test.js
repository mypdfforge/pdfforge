import { describe, it, expect } from 'vitest';
import { extractVectorGeometry, getVectorTableStyling } from '../../src/utils/pdfVectorExtractor.js';

describe('pdfVectorExtractor', () => {
  it('extracts rectangles and fill colors from OperatorList', async () => {
    const mockPage = {
      getOperatorList: async () => ({
        fnArray: [
          38, // setFillRGBColor
          91, // constructPath
          30, // fill
        ],
        argsArray: [
          [4, 120, 87], // Emerald green: #047857
          [[19], [54, 650, 500, 30]], // Rectangle at x=54, y=650, w=500, h=30
          null,
        ],
      }),
    };

    const { rects, fills } = await extractVectorGeometry(mockPage);
    expect(rects.length).toBe(1);
    expect(rects[0].x).toBe(54);
    expect(rects[0].y).toBe(650);
    expect(rects[0].w).toBe(500);
    expect(rects[0].h).toBe(30);
    expect(rects[0].fill).toBe('047857');
    expect(fills.has('047857')).toBe(true);
  });

  it('extracts horizontal and vertical line segments', async () => {
    const mockPage = {
      getOperatorList: async () => ({
        fnArray: [
          39, // setStrokeRGBColor
          18, // setLineWidth
          91, // constructPath
          32, // stroke
        ],
        argsArray: [
          [200, 200, 200], // #C8C8C8
          [1.5],
          [[13, 14], [50, 100, 250, 100]], // moveTo(50, 100), lineTo(250, 100) -> Horizontal line
          null,
        ],
      }),
    };

    const { lines } = await extractVectorGeometry(mockPage);
    expect(lines.length).toBe(1);
    expect(lines[0].isHorizontal).toBe(true);
    expect(lines[0].isVertical).toBe(false);
    expect(lines[0].x1).toBe(50);
    expect(lines[0].x2).toBe(250);
    expect(lines[0].stroke).toBe('C8C8C8');
  });

  it('identifies table styling from bounding box', () => {
    const rects = [
      { x: 54, y: 650, w: 504, h: 28, fill: '1E293B' }, // Header
      { x: 54, y: 620, w: 504, h: 25, fill: 'F8FAFC' }, // Zebra
    ];
    const lines = [
      { x1: 54, y1: 600, x2: 558, y2: 600, stroke: 'CBD5E1' },
    ];
    const tableBBox = { minX: 54, maxX: 558, minY: 500, maxY: 680 };

    const styling = getVectorTableStyling(rects, lines, tableBBox);
    expect(styling.headerBg).toBe('1E293B');
    expect(styling.zebraBg).toBe('F8FAFC');
    expect(styling.borderColor).toBe('CBD5E1');
  });
});
