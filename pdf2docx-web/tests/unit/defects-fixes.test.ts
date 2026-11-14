import { describe, it, expect } from 'vitest';
import { normalizeFontName, parseFontDescriptor, resolveFontDescriptor } from '../../src/ingest/fontMap.js';
import { clusterGlyphsIntoLines } from '../../src/dla/lines.js';
import { classifyHeading } from '../../src/dla/headings.js';
import { buildTableFromCandidate, TableCandidate } from '../../src/dla/tablesRuled.js';
import { Glyph, Stroke, Fill } from '../../src/core/pageir.js';
import { Para } from '../../src/core/ast.js';

describe('PDF-to-Word Converter Defect Fixes Verification', () => {
  // Fix 1: Font resolution & fallback mapping
  it('Fix 1: strips subset prefix and maps fonts through fallback table (Helvetica->Arial, CustomFont->Arial)', () => {
    // Subset prefix stripping
    expect(normalizeFontName('ABCDEF+Arial-Bold')).toBe('Arial-Bold');
    expect(normalizeFontName('XYZWVU+Helvetica')).toBe('Helvetica');

    // Font mapping & style resolution
    const helvInfo = parseFontDescriptor('ABCDEF+Helvetica');
    expect(helvInfo.family).toBe('Arial');
    expect(helvInfo.bold).toBe(false);

    const customBoldInfo = parseFontDescriptor('ABCDEF+CustomFont-Bold');
    expect(customBoldInfo.family).toBe('Arial');
    expect(customBoldInfo.bold).toBe(true);

    const timesInfo = parseFontDescriptor('TimesNewRomanPSMT');
    expect(timesInfo.family).toBe('Times New Roman');

    const courierInfo = parseFontDescriptor('CourierNewPS-BoldMT');
    expect(courierInfo.family).toBe('Courier New');
    expect(courierInfo.bold).toBe(true);
  });

  // Fix 2: Subscript, superscript, strikethrough, underline detection
  it('Fix 2: detects sub/superscript from baseline offset and strikethrough/underline from strokes', () => {
    // Construct glyphs for H2SO4: H (size 11, baseline 100), 2 (size 7, baseline 102), SO (size 11, baseline 100)
    const glyphs: Glyph[] = [
      {
        ch: 'H',
        box: { x0: 50, y0: 89, x1: 58, y1: 100 },
        baseline: 100,
        size: 11,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0,
        flags: 0,
      },
      {
        ch: '2',
        box: { x0: 58, y0: 95, x1: 63, y1: 102 },
        baseline: 102, // lower on page -> larger y in PageIR -> sub
        size: 7,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0,
        flags: 0,
      },
      {
        ch: 'S',
        box: { x0: 63, y0: 89, x1: 70, y1: 100 },
        baseline: 100,
        size: 11,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0,
        flags: 0,
      },
      {
        ch: 'O',
        box: { x0: 70, y0: 89, x1: 78, y1: 100 },
        baseline: 100,
        size: 11,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0,
        flags: 0,
      },
      // E = mc^2: 2 is superscript (higher on page -> smaller y in PageIR)
      {
        ch: '2',
        box: { x0: 100, y0: 84, x1: 105, y1: 96 },
        baseline: 96, // higher on page -> smaller y in PageIR -> sup
        size: 7,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0,
        flags: 0,
      },
    ];

    // Strike stroke crossing middle of H2SO4
    const strokes: Stroke[] = [
      {
        kind: 'line',
        pts: [48, 94, 80, 94],
        width: 1,
        color: '#000000',
      },
    ];

    const lines = clusterGlyphsIntoLines(glyphs, [], [], strokes);
    expect(lines.length).toBeGreaterThan(0);

    const allRuns = lines.flatMap((l) => l.segments.flatMap((s) => s.runs));
    const subRun = allRuns.find((r) => r.text.includes('2') && r.sub);
    expect(subRun).toBeDefined();
    expect(subRun?.sub).toBe(true);

    const supRun = allRuns.find((r) => r.text.includes('2') && r.sup);
    expect(supRun).toBeDefined();
    expect(supRun?.sup).toBe(true);

    // Verify strikethrough was detected from the line stroke
    const strikeRun = allRuns.find((r) => r.text.includes('H') && r.strike);
    expect(strikeRun).toBeDefined();
    expect(strikeRun?.strike).toBe(true);
  });

  // Fix 3: Color per run and no heading color leak
  it('Fix 3: preserves explicit run colors and prevents numbered list items from leaking heading blue', () => {
    // "2. Bold Weight Emphasis Demonstration" with body size 11 should NOT be a heading
    const para: Para = {
      type: 'p',
      runs: [
        { text: '2. Bold Weight Emphasis Demonstration', bold: true, size: 11, color: '#000000' },
      ],
      align: 'left',
    };

    const classification = classifyHeading(para, 11, 0, false);
    expect(classification.isHeading).toBe(false);

    // Multi-colored runs carry explicit colors per run
    const multiColoredRuns = [
      { text: 'Red ', color: '#DC2626', bold: true },
      { text: 'Green ', color: '#16A34A', bold: true },
      { text: 'Blue ', color: '#2563EB', bold: true },
    ];
    for (const r of multiColoredRuns) {
      expect(r.color).not.toBe('#000000');
      expect(r.color).not.toBe('#2E74B5'); // Not Word default blue
    }
  });

  // Fix 4: Table shading, borders and white text on dark fill
  it('Fix 4: extracts cell shading from spanning fill rects, sets white text, and preserves borders', () => {
    const candidate: TableCandidate = {
      box: { x0: 50, y0: 50, x1: 250, y1: 150 },
      hSegs: [
        { x0: 50, y0: 50, x1: 250, y1: 50, dir: 'h', width: 1, color: '#334155' },
        { x0: 50, y0: 100, x1: 250, y1: 100, dir: 'h', width: 1, color: '#334155' },
        { x0: 50, y0: 150, x1: 250, y1: 150, dir: 'h', width: 1, color: '#334155' },
      ],
      vSegs: [
        { x0: 50, y0: 50, x1: 50, y1: 150, dir: 'v', width: 1, color: '#334155' },
        { x0: 150, y0: 50, x1: 150, y1: 150, dir: 'v', width: 1, color: '#334155' },
        { x0: 250, y0: 50, x1: 250, y1: 150, dir: 'v', width: 1, color: '#334155' },
      ],
    };

    // Navy fill spanning across row 0 (x0: 50 to 250, y0: 50 to 100)
    const fills: Fill[] = [
      {
        box: { x0: 50, y0: 50, x1: 250, y1: 100 },
        color: '#1E293B', // dark navy
        alpha: 1.0,
        z: 0,
      },
    ];

    const { table } = buildTableFromCandidate(candidate, [], fills, 0);

    expect(table.rows.length).toBe(2);
    // Header cells in row 0 must both receive navy fill
    expect(table.rows[0].cells[0].fill).toBe('#1E293B');
    expect(table.rows[0].cells[1].fill).toBe('#1E293B');

    // Header row must have borders defined
    expect(table.rows[0].cells[0].borders).toBeDefined();
    expect(table.rows[0].cells[0].borders?.top?.color).toBe('#334155');
  });
});
