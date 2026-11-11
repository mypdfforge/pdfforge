import { describe, it, expect } from 'vitest';
import { extractSegments, findTableConnectedComponents, buildTableFromCandidate } from '../../src/dla/tablesRuled.js';
import { mergeCrossPageTables } from '../../src/dla/tableMerge.js';
import { computeTEDS, TableNode } from '../../tools/teds.js';
import { PageIR, Stroke, Fill } from '../../src/core/pageir.js';
import { TextLine } from '../../src/dla/lines.js';
import { emitDocxBuffer } from '../../src/emit/docxEmitter.js';
import { validateDocxFile } from '../../tools/docx-validate.js';
import { DocAST } from '../../src/core/ast.js';

describe('Milestone M4: Bordered Tables Vector Mesh (§5 S5A)', () => {
  function makeDummyPageIr(strokes: Stroke[] = [], fills: Fill[] = []): PageIR {
    return {
      pageIndex: 0,
      width: 612,
      height: 792,
      rotation: 0,
      glyphs: [],
      fonts: [],
      strokes,
      fills,
      images: [],
      links: [],
      stats: { glyphCount: 0, puaCount: 0 },
    };
  }

  it('snaps and merges collinear line segments into grid rules', () => {
    // Two abutting horizontal line segments
    const strokes: Stroke[] = [
      { kind: 'line', pts: [50, 100, 150, 100], width: 1, color: '#000000' },
      { kind: 'line', pts: [150.5, 100, 250, 100], width: 1, color: '#000000' },
    ];
    const segs = extractSegments(makeDummyPageIr(strokes));
    expect(segs.length).toBe(1);
    expect(segs[0].x0).toBe(50);
    expect(segs[0].x1).toBe(250);
  });

  it('detects connected component table candidates and rejects isolated 1x1 boxes', () => {
    // 2x2 grid: 3 horizontal lines and 3 vertical lines
    const strokes: Stroke[] = [
      // H lines at y = 100, 150, 200
      { kind: 'line', pts: [50, 100, 250, 100], width: 1, color: '#000000' },
      { kind: 'line', pts: [50, 150, 250, 150], width: 1, color: '#000000' },
      { kind: 'line', pts: [50, 200, 250, 200], width: 1, color: '#000000' },
      // V lines at x = 50, 150, 250
      { kind: 'line', pts: [50, 100, 50, 200], width: 1, color: '#000000' },
      { kind: 'line', pts: [150, 100, 150, 200], width: 1, color: '#000000' },
      { kind: 'line', pts: [250, 100, 250, 200], width: 1, color: '#000000' },
    ];

    const segs = extractSegments(makeDummyPageIr(strokes));
    const candidates = findTableConnectedComponents(segs);
    expect(candidates.length).toBe(1);
    expect(candidates[0].hSegs.length).toBe(3);
    expect(candidates[0].vSegs.length).toBe(3);
  });

  it('builds table with cell text and cell dimensions', () => {
    const strokes: Stroke[] = [
      { kind: 'line', pts: [50, 100, 250, 100], width: 1, color: '#000000' },
      { kind: 'line', pts: [50, 150, 250, 150], width: 1, color: '#000000' },
      { kind: 'line', pts: [50, 200, 250, 200], width: 1, color: '#000000' },
      { kind: 'line', pts: [50, 100, 50, 200], width: 1, color: '#000000' },
      { kind: 'line', pts: [150, 100, 150, 200], width: 1, color: '#000000' },
      { kind: 'line', pts: [250, 100, 250, 200], width: 1, color: '#000000' },
    ];

    const lines: TextLine[] = [
      {
        baseline: 130,
        dominantSize: 11,
        dominantFont: 'Calibri',
        box: { x0: 60, y0: 120, x1: 120, y1: 135 },
        segments: [{ box: { x0: 60, y0: 120, x1: 120, y1: 135 }, text: 'Cell (0,0)', runs: [{ text: 'Cell (0,0)' }] }],
        glyphs: [],
      },
      {
        baseline: 130,
        dominantSize: 11,
        dominantFont: 'Calibri',
        box: { x0: 160, y0: 120, x1: 220, y1: 135 },
        segments: [{ box: { x0: 160, y0: 120, x1: 220, y1: 135 }, text: 'Cell (0,1)', runs: [{ text: 'Cell (0,1)' }] }],
        glyphs: [],
      },
    ];

    const pageIr = makeDummyPageIr(strokes);
    const segs = extractSegments(pageIr);
    const candidates = findTableConnectedComponents(segs);
    const { table, consumedLineIndices } = buildTableFromCandidate(candidates[0], lines, [], 0);

    expect(table.colWidths.length).toBe(2);
    expect(table.rows.length).toBe(2);
    expect(consumedLineIndices.size).toBe(2);

    const cell00Text = (table.rows[0].cells[0].blocks[0] as any).runs[0].text;
    expect(cell00Text).toBe('Cell (0,0)');
  });
});

describe('Milestone M4: Cross-Page Table Continuation (§5 S5C)', () => {
  it('merges matching tables across pages and drops repeated headers', () => {
    const tablePage1: any = {
      type: 'tbl',
      colWidths: [100, 100],
      rows: [
        { header: true, cells: [{ blocks: [{ runs: [{ text: 'Col 1' }] }] }, { blocks: [{ runs: [{ text: 'Col 2' }] }] }] },
        { cells: [{ blocks: [{ runs: [{ text: 'Data 1' }] }] }, { blocks: [{ runs: [{ text: 'Data 2' }] }] }] },
      ],
    };

    const tablePage2: any = {
      type: 'tbl',
      colWidths: [100, 100],
      rows: [
        // Duplicate header
        { header: true, cells: [{ blocks: [{ runs: [{ text: 'Col 1' }] }] }, { blocks: [{ runs: [{ text: 'Col 2' }] }] }] },
        { cells: [{ blocks: [{ runs: [{ text: 'Data 3' }] }] }, { blocks: [{ runs: [{ text: 'Data 4' }] }] }] },
      ],
    };

    const merged = mergeCrossPageTables([[tablePage1], [tablePage2]]);
    expect(merged.length).toBe(1);
    expect(merged[0].rows.length).toBe(3); // Header + 2 data rows
  });
});

describe('Milestone M4: OpenXML DOCX Table Compliance (§12)', () => {
  it('emits fully compliant OpenXML for tables with cell widths and valid XML', async () => {
    const ast: DocAST = {
      sections: [
        {
          page: { w: 612, h: 792, orient: 'portrait' },
          margins: { t: 72, r: 72, b: 72, l: 72 },
          blocks: [
            {
              type: 'tbl',
              colWidths: [150, 150],
              rows: [
                {
                  header: true,
                  cells: [
                    { blocks: [{ type: 'p', runs: [{ text: 'Item', bold: true }], align: 'left' }], colSpan: 1, rowSpan: 1, width: 150, fill: '#f0f0f0' },
                    { blocks: [{ type: 'p', runs: [{ text: 'Price', bold: true }], align: 'right' }], colSpan: 1, rowSpan: 1, width: 150, fill: '#f0f0f0' },
                  ],
                },
                {
                  cells: [
                    { blocks: [{ type: 'p', runs: [{ text: 'Widget A' }], align: 'left' }], colSpan: 1, rowSpan: 1, width: 150 },
                    { blocks: [{ type: 'p', runs: [{ text: '$19.99' }], align: 'right' }], colSpan: 1, rowSpan: 1, width: 150 },
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
    const validation = validateDocxFile(docx);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });
});
