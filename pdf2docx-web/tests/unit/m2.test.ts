import { describe, it, expect } from 'vitest';
import { canRepairHyphen, repairHyphenatedPair } from '../../src/dla/hyphen.js';
import { detectParagraphAlignment } from '../../src/dla/alignment.js';
import { detectListMarker, stripListMarkerFromRuns } from '../../src/dla/lists.js';
import { classifyHeading, computeBodyFontSize } from '../../src/dla/headings.js';
import { extractHeaderFooterFurniture, isPageNumberText } from '../../src/dla/headerFooter.js';
import { TextLine } from '../../src/dla/lines.js';
import { Para, DocAST } from '../../src/core/ast.js';
import { emitDocxBuffer } from '../../src/emit/docxEmitter.js';
import { validateDocxFile } from '../../tools/docx-validate.js';
import { PageIR } from '../../src/core/pageir.js';

describe('Milestone M2: Hyphen Repair (§5 S6)', () => {
  it('correctly repairs split hyphenated words across lines', () => {
    expect(canRepairHyphen('commer-', 'cial')).toBe(true);
    const res = repairHyphenatedPair('commer-', 'cial');
    expect(res.joined).toBe('commercial');
    expect(res.repaired).toBe(true);
  });

  it('preserves intentional compounds and proper nouns', () => {
    expect(canRepairHyphen('well-', 'known')).toBe(true); // normal lower case
    expect(canRepairHyphen('COVID-', '19')).toBe(false); // digit
    expect(canRepairHyphen('Anglo-', 'Saxon')).toBe(false); // uppercase
    const res = repairHyphenatedPair('Anglo-', 'Saxon');
    expect(res.joined).toBe('Anglo- Saxon');
    expect(res.repaired).toBe(false);
  });
});

describe('Milestone M2: Paragraph Alignment (§5 S6)', () => {
  it('detects center alignment for symmetric margins', () => {
    const lines: TextLine[] = [
      {
        baseline: 50,
        dominantSize: 12,
        dominantFont: 'Calibri',
        box: { x0: 200, y0: 40, x1: 400, y1: 52 },
        segments: [{ box: { x0: 200, y0: 40, x1: 400, y1: 52 }, text: 'Centered Title', runs: [] }],
        glyphs: [],
      },
    ];
    const align = detectParagraphAlignment(lines, 0, 600);
    expect(align).toBe('center');
  });

  it('detects justify when left and right edges align', () => {
    const lines: TextLine[] = [
      {
        baseline: 50,
        dominantSize: 11,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 40, x1: 500, y1: 52 },
        segments: [{ box: { x0: 50, y0: 40, x1: 500, y1: 52 }, text: 'Line 1 justified content text.', runs: [] }],
        glyphs: [],
      },
      {
        baseline: 65,
        dominantSize: 11,
        dominantFont: 'Calibri',
        box: { x0: 50.5, y0: 55, x1: 499.5, y1: 67 },
        segments: [{ box: { x0: 50.5, y0: 55, x1: 499.5, y1: 67 }, text: 'Line 2 justified content text.', runs: [] }],
        glyphs: [],
      },
      {
        baseline: 80,
        dominantSize: 11,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 70, x1: 300, y1: 82 },
        segments: [{ box: { x0: 50, y0: 70, x1: 300, y1: 82 }, text: 'Last line short.', runs: [] }],
        glyphs: [],
      },
    ];
    const align = detectParagraphAlignment(lines, 50, 500);
    expect(align).toBe('justify');
  });
});

describe('Milestone M2: Lists & Markers (§5 S7)', () => {
  it('detects bullet list markers and strips them from runs', () => {
    const marker = detectListMarker('• First bullet point', 68, 50);
    expect(marker).not.toBeNull();
    expect(marker?.kind).toBe('bullet');
    expect(marker?.level).toBe(1);

    const stripped = stripListMarkerFromRuns([{ text: '• First bullet point' }], '•');
    expect(stripped[0].text).toBe('First bullet point');
  });

  it('detects numbered list markers and formats', () => {
    const num = detectListMarker('1. Introduction', 50, 50);
    expect(num).not.toBeNull();
    expect(num?.kind).toBe('number');
    expect(num?.format).toBe('decimal');
    expect(num?.level).toBe(0);

    const roman = detectListMarker('(iv) Subclause', 86, 50);
    expect(roman).not.toBeNull();
    expect(roman?.kind).toBe('number');
    expect(roman?.format).toBe('lowerRoman');
    expect(roman?.level).toBe(2);
  });
});

describe('Milestone M2: Headings Classification (§5 S7)', () => {
  it('classifies Title and Headings based on font size and boldness', () => {
    const bodySize = 11;
    const titlePara: Para = {
      type: 'p',
      runs: [{ text: 'Annual Financial Report', bold: true, size: 24 }],
      align: 'center',
    };
    const titleClass = classifyHeading(titlePara, bodySize, 0, true);
    expect(titleClass.isHeading).toBe(true);
    expect(titleClass.isTitle).toBe(true);

    const h2Para: Para = {
      type: 'p',
      runs: [{ text: '1. Executive Summary', bold: true, size: 15 }],
      align: 'left',
    };
    const h2Class = classifyHeading(h2Para, bodySize, 0, false);
    expect(h2Class.isHeading).toBe(true);
    expect(h2Class.level).toBe(2);
  });
});

describe('Milestone M2: Header & Footer Furniture (§5 S4)', () => {
  it('identifies page numbers correctly', () => {
    expect(isPageNumberText('1')).toBe(true);
    expect(isPageNumberText('Page 12')).toBe(true);
    expect(isPageNumberText('Page 3 of 10')).toBe(true);
    expect(isPageNumberText('Regular paragraph content.')).toBe(false);
  });

  it('extracts recurring headers/footers across multi-page document', () => {
    const p1Lines: TextLine[] = [
      {
        baseline: 30,
        dominantSize: 9,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 20, x1: 250, y1: 32 },
        segments: [{ box: { x0: 50, y0: 20, x1: 250, y1: 32 }, text: 'Confidential Report Header', runs: [{ text: 'Confidential Report Header' }] }],
        glyphs: [],
      },
      {
        baseline: 150,
        dominantSize: 11,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 140, x1: 450, y1: 152 },
        segments: [{ box: { x0: 50, y0: 140, x1: 450, y1: 152 }, text: 'Body content page 1.', runs: [{ text: 'Body content page 1.' }] }],
        glyphs: [],
      },
      {
        baseline: 750,
        dominantSize: 9,
        dominantFont: 'Calibri',
        box: { x0: 250, y0: 740, x1: 300, y1: 752 },
        segments: [{ box: { x0: 250, y0: 740, x1: 300, y1: 752 }, text: 'Page 1', runs: [{ text: 'Page 1' }] }],
        glyphs: [],
      },
    ];

    const p2Lines: TextLine[] = [
      {
        baseline: 30,
        dominantSize: 9,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 20, x1: 250, y1: 32 },
        segments: [{ box: { x0: 50, y0: 20, x1: 250, y1: 32 }, text: 'Confidential Report Header', runs: [{ text: 'Confidential Report Header' }] }],
        glyphs: [],
      },
      {
        baseline: 150,
        dominantSize: 11,
        dominantFont: 'Calibri',
        box: { x0: 50, y0: 140, x1: 450, y1: 152 },
        segments: [{ box: { x0: 50, y0: 140, x1: 450, y1: 152 }, text: 'Body content page 2.', runs: [{ text: 'Body content page 2.' }] }],
        glyphs: [],
      },
      {
        baseline: 750,
        dominantSize: 9,
        dominantFont: 'Calibri',
        box: { x0: 250, y0: 740, x1: 300, y1: 752 },
        segments: [{ box: { x0: 250, y0: 740, x1: 300, y1: 752 }, text: 'Page 2', runs: [{ text: 'Page 2' }] }],
        glyphs: [],
      },
    ];

    const dummyPageIr = (idx: number): PageIR => ({
      pageIndex: idx,
      width: 612,
      height: 792,
      rotation: 0,
      glyphs: [],
      fonts: [],
      strokes: [],
      fills: [],
      images: [],
      links: [],
      stats: { glyphCount: 10, puaCount: 0 },
    });

    const res = extractHeaderFooterFurniture([
      { ir: dummyPageIr(0), lines: p1Lines },
      { ir: dummyPageIr(1), lines: p2Lines },
    ]);

    expect(res.headers.length).toBeGreaterThanOrEqual(1);
    expect(res.footers.length).toBeGreaterThanOrEqual(1);
    expect(res.bodyLinesPerPage[0].length).toBe(1); // Only the body line remains
    expect(res.bodyLinesPerPage[1].length).toBe(1);
  });
});

describe('Milestone M2: OpenXML DOCX Emission with Headings and Lists', () => {
  it('emits valid OpenXML with List and Heading outline levels', async () => {
    const ast: DocAST = {
      sections: [
        {
          page: { w: 612, h: 792, orient: 'portrait' },
          margins: { t: 72, r: 72, b: 72, l: 72 },
          header: [{ type: 'p', runs: [{ text: 'Document Header' }], align: 'center' }],
          footer: [{ type: 'p', runs: [{ text: 'PAGE' }], align: 'center' }],
          blocks: [
            {
              type: 'p',
              runs: [{ text: 'Top Heading', bold: true, size: 16 }],
              align: 'left',
              heading: 1,
              keepNext: true,
            },
            {
              type: 'p',
              runs: [{ text: 'First bullet item' }],
              align: 'left',
              list: { id: 'list_bullet_1', level: 0, kind: 'bullet' },
            },
            {
              type: 'p',
              runs: [{ text: 'Nested numbered item' }],
              align: 'left',
              list: { id: 'list_number_1', level: 1, kind: 'number' },
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
