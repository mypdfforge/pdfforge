import { describe, it, expect } from 'vitest';
import {
  isNumericToken,
  findBorderlessCandidateBands,
  passesSharedBaselineTest,
  buildBorderlessTable,
  splitLineByWideGaps,
} from '../../src/dla/tablesBorderless.js';
import { TextLine } from '../../src/dla/lines.js';
import { emitDocxBuffer } from '../../src/emit/docxEmitter.js';
import { validateDocxFile } from '../../tools/docx-validate.js';
import { DocAST } from '../../src/core/ast.js';

describe('Milestone M5: Accounting Token Fidelity (§5 S5B)', () => {
  it('correctly identifies accounting numeric tokens', () => {
    expect(isNumericToken('(1,250.00)')).toBe(true);
    expect(isNumericToken('$45,000')).toBe(true);
    expect(isNumericToken('€99.99')).toBe(true);
    expect(isNumericToken('12.5%')).toBe(true);
    expect(isNumericToken('—')).toBe(true);
    expect(isNumericToken('N/A')).toBe(true);
    expect(isNumericToken('Total Operating Expenses')).toBe(false);
  });
});

describe('Milestone M5: Borderless Table Detection & Shared Baseline (§5 S5B)', () => {
  function makeFinancialLine(y0: number, desc: string, val1: string, val2: string): TextLine {
    const glyphs = [
      ...desc.split('').map((ch, i) => ({
        ch,
        box: { x0: 50 + i * 6, y0, x1: 56 + i * 6, y1: y0 + 12 },
        baseline: y0 + 10,
        size: 10,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0 as const,
        flags: 0,
      })),
      // Wide gap to val1 (x = 350)
      ...val1.split('').map((ch, i) => ({
        ch,
        box: { x0: 350 + i * 6, y0, x1: 356 + i * 6, y1: y0 + 12 },
        baseline: y0 + 10,
        size: 10,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0 as const,
        flags: 0,
      })),
      // Wide gap to val2 (x = 450)
      ...val2.split('').map((ch, i) => ({
        ch,
        box: { x0: 450 + i * 6, y0, x1: 456 + i * 6, y1: y0 + 12 },
        baseline: y0 + 10,
        size: 10,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0 as const,
        flags: 0,
      })),
    ];

    return {
      baseline: y0 + 10,
      dominantSize: 10,
      dominantFont: 'Calibri',
      box: { x0: 50, y0, x1: 500, y1: y0 + 12 },
      segments: [{ box: { x0: 50, y0, x1: 500, y1: y0 + 12 }, text: `${desc}   ${val1}   ${val2}`, runs: [] }],
      glyphs,
    };
  }

  it('splits line by wide gaps into accurate column chunks', () => {
    const line = makeFinancialLine(100, 'Revenues', '$120,000', '$105,000');
    const chunks = splitLineByWideGaps(line);
    expect(chunks.length).toBe(3);
    expect(chunks[0].text).toBe('Revenues');
    expect(chunks[1].text).toBe('$120,000');
    expect(chunks[2].text).toBe('$105,000');
  });

  it('identifies financial statement candidate bands and passes shared baseline test', () => {
    const lines = [
      makeFinancialLine(100, 'Operating Revenue', '$500,000', '$450,000'),
      makeFinancialLine(120, 'Cost of Goods Sold', '($320,000)', '($280,000)'),
      makeFinancialLine(140, 'Gross Margin', '$180,000', '$170,000'),
    ];

    const bands = findBorderlessCandidateBands(lines, new Set());
    expect(bands.length).toBe(1);
    expect(passesSharedBaselineTest(bands[0])).toBe(true);

    const { table, consumedIndices } = buildBorderlessTable(bands[0], 0, 612);
    expect(table.rows.length).toBe(3);
    expect(table.colWidths.length).toBeGreaterThanOrEqual(2);
    expect(consumedIndices.size).toBe(3);
  });
});

describe('Milestone M5: Anti-False-Positive Protection (§5 S5D)', () => {
  it('rejects bullet lists with hanging indent from being misclassified as tables', () => {
    const listLines: TextLine[] = [
      {
        baseline: 110,
        dominantSize: 11,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 100, x1: 450, y1: 112 },
        segments: [{ box: { x0: 50, y0: 100, x1: 450, y1: 112 }, text: '•  First long bullet paragraph text', runs: [] }],
        glyphs: [
          { ch: '•', box: { x0: 50, y0: 100, x1: 56, y1: 112 }, baseline: 110, size: 11, fontKey: 'Calibri', color: '#000', rot: 0, flags: 0 },
          { ch: 'F', box: { x0: 80, y0: 100, x1: 86, y1: 112 }, baseline: 110, size: 11, fontKey: 'Calibri', color: '#000', rot: 0, flags: 0 },
          { ch: 'irst', box: { x0: 86, y0: 100, x1: 110, y1: 112 }, baseline: 110, size: 11, fontKey: 'Calibri', color: '#000', rot: 0, flags: 0 },
        ],
      },
      {
        baseline: 130,
        dominantSize: 11,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 120, x1: 450, y1: 132 },
        segments: [{ box: { x0: 50, y0: 120, x1: 450, y1: 132 }, text: '•  Second long bullet paragraph text', runs: [] }],
        glyphs: [
          { ch: '•', box: { x0: 50, y0: 120, x1: 56, y1: 132 }, baseline: 130, size: 11, fontKey: 'Calibri', color: '#000', rot: 0, flags: 0 },
          { ch: 'S', box: { x0: 80, y0: 120, x1: 86, y1: 132 }, baseline: 130, size: 11, fontKey: 'Calibri', color: '#000', rot: 0, flags: 0 },
        ],
      },
      {
        baseline: 150,
        dominantSize: 11,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 140, x1: 450, y1: 152 },
        segments: [{ box: { x0: 50, y0: 140, x1: 450, y1: 152 }, text: '•  Third long bullet paragraph text', runs: [] }],
        glyphs: [
          { ch: '•', box: { x0: 50, y0: 140, x1: 56, y1: 152 }, baseline: 150, size: 11, fontKey: 'Calibri', color: '#000', rot: 0, flags: 0 },
          { ch: 'T', box: { x0: 80, y0: 140, x1: 86, y1: 152 }, baseline: 150, size: 11, fontKey: 'Calibri', color: '#000', rot: 0, flags: 0 },
        ],
      },
    ];

    const bands = findBorderlessCandidateBands(listLines, new Set());
    if (bands.length > 0) {
      expect(passesSharedBaselineTest(bands[0])).toBe(false);
    }
  });
});

describe('Milestone M5: OpenXML Borderless Table Validation', () => {
  it('emits compliant OpenXML for borderless tables with nil borders', async () => {
    const ast: DocAST = {
      sections: [
        {
          page: { w: 612, h: 792, orient: 'portrait' },
          margins: { t: 72, r: 72, b: 72, l: 72 },
          blocks: [
            {
              type: 'tbl',
              colWidths: [200, 100],
              rows: [
                {
                  cells: [
                    { blocks: [{ type: 'p', runs: [{ text: 'Operating Revenue' }], align: 'left' }], colSpan: 1, rowSpan: 1, width: 200 },
                    { blocks: [{ type: 'p', runs: [{ text: '$500,000' }], align: 'right' }], colSpan: 1, rowSpan: 1, width: 100 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      numbering: [],
      styles: [],
      meta: { pages: 1, warnings: [] },
    };

    const docx = await emitDocxBuffer(ast);
    const res = validateDocxFile(docx);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });
});
