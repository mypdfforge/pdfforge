import { describe, it, expect } from 'vitest';
import { levenshteinDistance, computeCER, computeGlyphF1 } from '../../tools/compare-text.js';
import { computeTEDS, TableNode } from '../../tools/teds.js';

describe('Metrics: Text CER & Glyph F1 (§11.2)', () => {
  it('computes exact match as 0 CER', () => {
    expect(computeCER('Hello World', 'Hello World')).toBe(0);
  });

  it('computes levenshtein distance accurately', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('computes CER with whitespace normalization', () => {
    expect(computeCER('Hello   World\n', 'Hello World')).toBe(0);
    expect(computeCER('Hello Word', 'Hello World')).toBeCloseTo(1 / 11, 4);
  });

  it('computes glyph precision and recall', () => {
    const res = computeGlyphF1('abc', 'abcd');
    expect(res.precision).toBe(1.0);
    expect(res.recall).toBe(0.75);
    expect(res.f1).toBeCloseTo((2 * 1.0 * 0.75) / (1.0 + 0.75), 4);
  });
});

describe('Metrics: TEDS (§11.2)', () => {
  const tableGold: TableNode = {
    tag: 'table',
    children: [
      {
        tag: 'tr',
        children: [
          { tag: 'th', content: 'Header 1' },
          { tag: 'th', content: 'Header 2' },
        ],
      },
      {
        tag: 'tr',
        children: [
          { tag: 'td', content: 'Val 1' },
          { tag: 'td', content: 'Val 2' },
        ],
      },
    ],
  };

  it('gives 1.0 for identical tables', () => {
    expect(computeTEDS(tableGold, tableGold)).toBe(1.0);
  });

  it('scores structure changes lower', () => {
    const tablePred: TableNode = {
      tag: 'table',
      children: [
        {
          tag: 'tr',
          children: [{ tag: 'td', content: 'Val 1' }],
        },
      ],
    };
    const score = computeTEDS(tablePred, tableGold);
    expect(score).toBeLessThan(1.0);
    expect(score).toBeGreaterThan(0.0);
  });
});
