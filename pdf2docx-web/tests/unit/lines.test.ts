import { describe, it, expect } from 'vitest';
import { clusterGlyphsIntoLines, clusterLinesIntoParagraphs } from '../../src/dla/lines.js';
import { Glyph } from '../../src/core/pageir.js';

describe('DLA: Glyph clustering into Lines & Paragraphs (§5 S2, S6)', () => {
  it('clusters glyphs sharing baseline into a single line with space detection', () => {
    const glyphs: Glyph[] = [
      {
        ch: 'H',
        box: { x0: 50, y0: 100, x1: 60, y1: 112 },
        baseline: 110,
        size: 12,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0,
        flags: 0,
      },
      {
        ch: 'i',
        box: { x0: 60, y0: 100, x1: 65, y1: 112 },
        baseline: 110,
        size: 12,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0,
        flags: 0,
      },
      // Gap > 0.18 * 12 = 2.16 pt
      {
        ch: 't',
        box: { x0: 75, y0: 100, x1: 80, y1: 112 },
        baseline: 110.1,
        size: 12,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0,
        flags: 0,
      },
      {
        ch: 'here',
        box: { x0: 80, y0: 100, x1: 105, y1: 112 },
        baseline: 110,
        size: 12,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0,
        flags: 0,
      },
    ];

    const lines = clusterGlyphsIntoLines(glyphs);
    expect(lines.length).toBe(1);
    expect(lines[0].segments[0].text).toBe('Hi there');
  });

  it('clusters consecutive lines into paragraphs based on vertical leading gap', () => {
    const glyphs1: Glyph[] = [
      {
        ch: 'Line 1',
        box: { x0: 50, y0: 50, x1: 150, y1: 62 },
        baseline: 60,
        size: 12,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0,
        flags: 0,
      },
    ];
    const glyphs2: Glyph[] = [
      {
        ch: 'Line 2',
        box: { x0: 50, y0: 66, x1: 150, y1: 78 },
        baseline: 76,
        size: 12,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0,
        flags: 0,
      },
    ];
    // Big vertical jump (e.g. y0 = 120) => new paragraph
    const glyphs3: Glyph[] = [
      {
        ch: 'Paragraph 2',
        box: { x0: 50, y0: 120, x1: 150, y1: 132 },
        baseline: 130,
        size: 12,
        fontKey: 'Calibri',
        color: '#000000',
        rot: 0,
        flags: 0,
      },
    ];

    const allGlyphs = [...glyphs1, ...glyphs2, ...glyphs3];
    const lines = clusterGlyphsIntoLines(allGlyphs);
    expect(lines.length).toBe(3);

    const paras = clusterLinesIntoParagraphs(lines, 0);
    expect(paras.length).toBe(2);
    expect(paras[0].runs.map((r) => r.text).join('')).toBe('Line 1 Line 2');
    expect(paras[1].runs.map((r) => r.text).join('')).toBe('Paragraph 2');
  });
});
