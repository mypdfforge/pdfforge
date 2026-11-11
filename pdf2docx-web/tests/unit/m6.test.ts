import { describe, it, expect } from 'vitest';
import { detectCalloutContainers, convertImagesToBlocks, wrapInCalloutTable } from '../../src/dla/shapes.js';
import { extractFootnotes } from '../../src/dla/footnotes.js';
import { Block, Para, Table, DocAST } from '../../src/core/ast.js';
import { Fill, Stroke, ImageObj } from '../../src/core/pageir.js';
import { TextLine } from '../../src/dla/lines.js';
import { emitDocxBuffer } from '../../src/emit/docxEmitter.js';
import { validateDocxFile } from '../../tools/docx-validate.js';

describe('Milestone M6: Shapes & Shaded Callouts (§5 S8)', () => {
  it('wraps paragraphs inside a shaded fill into a 1x1 table container', () => {
    const para: Para = {
      type: 'p',
      runs: [{ text: 'This is an important callout note.' }],
      align: 'left',
      src: { page: 0, box: { x0: 60, y0: 110, x1: 300, y1: 130 } },
    };

    const calloutFill: Fill = {
      box: { x0: 50, y0: 100, x1: 320, y1: 140 },
      color: '#FFF2D6',
      alpha: 1.0,
      z: 0,
    };

    const blocks = detectCalloutContainers([para], [calloutFill], 612, 792);
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe('tbl');

    const tbl = blocks[0] as Table;
    expect(tbl.rows.length).toBe(1);
    expect(tbl.rows[0].cells.length).toBe(1);
    expect(tbl.rows[0].cells[0].fill).toBe('#FFF2D6');
  });

  it('determines inline vs anchored images based on text overlap', () => {
    const imgObj: ImageObj = {
      id: 'img_1',
      box: { x0: 50, y0: 200, x1: 250, y1: 350 },
      pixelW: 200,
      pixelH: 150,
      mime: 'image/png',
      dataRef: 'ref_1',
      z: 0,
    };

    const nonOverlappingPara: Para = {
      type: 'p',
      runs: [{ text: 'Text completely below the image.' }],
      align: 'left',
      src: { page: 0, box: { x0: 50, y0: 400, x1: 450, y1: 420 } },
    };

    const blocks = convertImagesToBlocks([imgObj], [nonOverlappingPara], 0);
    expect(blocks.length).toBe(1);
    expect(blocks[0].inline).toBe(true);
  });
});

describe('Milestone M6: Footnotes Detection (§5 S3)', () => {
  it('extracts footnote below horizontal divider at page bottom', () => {
    const lines: TextLine[] = [
      {
        baseline: 200,
        dominantSize: 11,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 190, x1: 450, y1: 202 },
        segments: [{ box: { x0: 50, y0: 190, x1: 450, y1: 202 }, text: 'Body paragraph referencing note 1.', runs: [] }],
        glyphs: [],
      },
      {
        baseline: 720,
        dominantSize: 8.5,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 710, x1: 400, y1: 722 },
        segments: [{ box: { x0: 50, y0: 710, x1: 400, y1: 722 }, text: '1 Source: Internal Company Audit 2026.', runs: [] }],
        glyphs: [],
      },
    ];

    const strokes: Stroke[] = [
      { kind: 'line', pts: [50, 700, 200, 700], width: 1, color: '#000000' },
    ];

    const res = extractFootnotes(lines, strokes, 792, 612, 11);
    expect(res.bodyLines.length).toBe(1);
    expect(res.footnotes.length).toBe(1);
    expect(res.footnotes[0].runs[0].sup).toBe(true);
    expect(res.footnotes[0].runs[0].text).toBe('1');
  });
});

describe('Milestone M6: OpenXML Compliance (Zero Floating Textboxes)', () => {
  it('guarantees 0 floating textboxes (w:txbxContent count = 0) in all emitted docx', async () => {
    const ast: DocAST = {
      sections: [
        {
          page: { w: 612, h: 792, orient: 'portrait' },
          margins: { t: 72, r: 72, b: 72, l: 72 },
          blocks: [
            wrapInCalloutTable(
              [{ type: 'p', runs: [{ text: 'Callout content' }], align: 'left' }],
              '#EEEEEE',
              { x0: 50, y0: 100, x1: 300, y1: 150 }
            ),
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

    const docXmlStr = new TextDecoder().decode(docx);
    expect(docXmlStr.includes('w:txbxContent')).toBe(false);
  });
});
