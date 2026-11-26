import { describe, it, expect } from 'vitest';
import { resolveFont } from '../../src/utils/pptx/fontResolver.js';
import { clusterTextFrames } from '../../src/utils/pptx/textFrameClusterer.js';

function makeSpan(text, x, y, w, { fontSizePt = 12, fontName = 'F1', fontFamilyRaw = 'Helvetica', rotate = 0, color = '000000', z = 1 } = {}) {
  const h = fontSizePt / 72;
  return {
    z,
    text,
    rect: { x, y, w, h },
    fontSizePt,
    rotate,
    color,
    opacity: 1,
    charSpacingPt: 0,
    baseline: null,
    dir: 'ltr',
    fontName,
    fontFamilyRaw,
    ascent: 0.82,
    descent: 0.18,
  };
}

describe('PR 4: fontResolver & textFrameClusterer', () => {
  it('resolves PDF font names to cross-platform PowerPoint fonts via heuristics', () => {
    const helv = resolveFont(null, 'ABCDEF+Helvetica-BoldOblique');
    expect(helv.face).toBe('Arial');
    expect(helv.bold).toBe(true);
    expect(helv.italic).toBe(true);
    expect(helv.mono).toBe(false);

    const times = resolveFont(null, 'TimesNewRomanPS-ItalicMT');
    expect(times.face).toBe('Times New Roman');
    expect(times.italic).toBe(true);
    expect(times.bold).toBe(false);

    const consolas = resolveFont(null, 'Consolas-Bold');
    expect(consolas.face).toBe('Consolas');
    expect(consolas.bold).toBe(true);
    expect(consolas.mono).toBe(true);

    const calibri = resolveFont(null, 'Calibri');
    expect(calibri.face).toBe('Calibri');

    const segoe = resolveFont(null, 'SegoeUI-Semibold');
    expect(segoe.face).toBe('Segoe UI');
    expect(segoe.bold).toBe(true);

    const jp = resolveFont(null, 'YuGothic-Bold');
    expect(jp.face).toBe('Yu Gothic');
    expect(jp.bold).toBe(true);

    const cn = resolveFont(null, 'SimSun');
    expect(cn.face).toBe('SimSun');
    expect(cn.metrics.ascent).toBeGreaterThan(0);
  });

  it('merges multi-line paragraphs, detects paragraph breaks, and sets wrap: false on single-line labels', () => {
    const spans = [
      // Single-line heading label
      makeSpan('Executive Summary', 1.0, 0.8, 3.0, { fontSizePt: 24 }),
      // Paragraph 1 (2 soft-wrapped lines)
      makeSpan('First', 1.0, 1.5, 0.4, { fontSizePt: 12 }),
      makeSpan('sentence of the', 1.46, 1.5, 1.2, { fontSizePt: 12 }),
      makeSpan('paragraph.', 2.72, 1.5, 0.8, { fontSizePt: 12 }),
      makeSpan('Second line continues', 1.0, 1.72, 2.0, { fontSizePt: 12 }),
      // Paragraph 2 (larger vertical gap -> para break within same frame if <= maxGapLh)
      makeSpan('Next paragraph starts here.', 1.0, 2.02, 2.5, { fontSizePt: 12 }),
    ];

    const frames = clusterTextFrames(spans, { pageRect: { x: 0, y: 0, w: 10, h: 7.5 } });
    expect(frames).toHaveLength(2);

    const heading = frames[0];
    expect(heading.wrap).toBe(false);
    expect(heading.runs[0].text).toBe('Executive Summary');

    const body = frames[1];
    expect(body.wrap).toBe(true);
    expect(body.lineSpacingPt).toBeGreaterThan(10);
    expect(body.paraSpaceAfter).toBeGreaterThan(0);
    expect(body.runs.some((r) => r.breakLine)).toBe(true);
    const fullText = body.runs.map((r) => r.text).join('');
    expect(fullText).toContain('First sentence of the paragraph.');
    expect(fullText).toContain('Second line continues');
    expect(fullText).toContain('Next paragraph starts here.');
  });

  it('separates columns into distinct TextFrames', () => {
    const columns = [
      { id: 'left', rect: { x: 0.5, y: 0.5, w: 4.0, h: 6.0 } },
      { id: 'right', rect: { x: 5.0, y: 0.5, w: 4.0, h: 6.0 } },
    ];
    const spans = [
      makeSpan('Left column line 1', 0.6, 1.0, 2.0),
      makeSpan('Right column line 1', 5.1, 1.0, 2.0),
      makeSpan('Left column line 2', 0.6, 1.22, 2.0),
      makeSpan('Right column line 2', 5.1, 1.22, 2.0),
    ];

    const frames = clusterTextFrames(spans, { columns });
    expect(frames).toHaveLength(2);
    expect(frames.map((f) => f.columnId).sort()).toEqual(['left', 'right']);
    expect(frames.find((f) => f.columnId === 'left').runs[0].text).toContain('Left column');
    expect(frames.find((f) => f.columnId === 'right').runs[0].text).toContain('Right column');
  });

  it('detects bullet and numbered lists with stripped markers', () => {
    const spans = [
      makeSpan('• First bullet item', 1.0, 1.0, 2.5),
      makeSpan('• Second bullet item', 1.0, 1.25, 2.5),
      makeSpan('1. Numbered item', 1.0, 1.5, 2.5),
    ];

    const frames = clusterTextFrames(spans);
    expect(frames).toHaveLength(1);
    const runs = frames[0].runs;
    expect(runs).toHaveLength(3);
    expect(runs[0].bullet).toEqual({ type: 'bullet' });
    expect(runs[0].text).toBe('First bullet item');
    expect(runs[1].bullet).toEqual({ type: 'bullet' });
    expect(runs[1].text).toBe('Second bullet item');
    expect(runs[2].bullet).toEqual({ type: 'number' });
    expect(runs[2].text).toBe('Numbered item');
  });

  it('infers left, center, right, and justify alignments', () => {
    const pageRect = { x: 0, y: 0, w: 10, h: 7.5 };

    // Centered single-line title on 10in page (center = 5.0)
    const centered = clusterTextFrames([makeSpan('Centered Title', 3.5, 0.5, 3.0)], { pageRect });
    expect(centered[0].align).toBe('center');

    // Right-aligned multi-line block (right edge = 9.0)
    const rightAligned = clusterTextFrames([
      makeSpan('Short', 8.0, 1.0, 1.0),
      makeSpan('Longer right line', 7.0, 1.22, 2.0),
    ]);
    expect(rightAligned[0].align).toBe('right');

    // Justified multi-line block (both left=1.0 and right=5.0 match on first two lines, last shorter)
    const justified = clusterTextFrames([
      makeSpan('Line one fills full width', 1.0, 2.0, 4.0),
      makeSpan('Line two fills full width', 1.0, 2.22, 4.0),
      makeSpan('Short last line.', 1.0, 2.44, 1.8),
    ]);
    expect(justified[0].align).toBe('justify');
  });
});
