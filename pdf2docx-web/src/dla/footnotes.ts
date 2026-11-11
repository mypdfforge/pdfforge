import { TextLine } from './lines.js';
import { Stroke, Rect } from '../core/pageir.js';
import { Para } from '../core/ast.js';
import { rectWidth } from '../core/geometry.js';

export type FootnoteMatch = {
  marker: string;
  para: Para;
};

const FOOTNOTE_MARKER_REGEX = /^([*†‡\d]{1,3})\s*(.*)$/;

export function extractFootnotes(
  lines: TextLine[],
  strokes: Stroke[],
  pageHeight: number,
  pageWidth: number,
  bodyFontSize: number
): { bodyLines: TextLine[]; footnotes: Para[] } {
  // Find short horizontal rule near bottom of page (y >= 75% page height, length < 40% page width)
  const footnoteDividers = strokes.filter((s) => {
    if (s.kind === 'line' && s.pts.length >= 4) {
      const x0 = Math.min(s.pts[0], s.pts[2]);
      const x1 = Math.max(s.pts[0], s.pts[2]);
      const y = (s.pts[1] + s.pts[3]) / 2;
      const len = x1 - x0;
      return y >= pageHeight * 0.75 && len <= pageWidth * 0.45 && len >= 20;
    }
    return false;
  });

  if (footnoteDividers.length === 0) {
    return { bodyLines: lines, footnotes: [] };
  }

  const dividerY = Math.min(...footnoteDividers.map((d) => (d.pts[1] + d.pts[3]) / 2));

  const bodyLines: TextLine[] = [];
  const footnoteLines: TextLine[] = [];

  for (const l of lines) {
    if (l.box.y0 >= dividerY && l.dominantSize <= bodyFontSize * 0.9) {
      footnoteLines.push(l);
    } else {
      bodyLines.push(l);
    }
  }

  const footnotes: Para[] = footnoteLines.map((fl) => {
    const text = fl.segments[0]?.text || '';
    const match = text.match(FOOTNOTE_MARKER_REGEX);
    return {
      type: 'p',
      runs: [
        {
          text: match ? match[1] : '*',
          sup: true,
          size: 8,
          font: 'Calibri',
        },
        {
          text: ' ' + (match ? match[2] : text),
          size: 9,
          font: 'Calibri',
        },
      ],
      align: 'left',
      spaceBefore: 3,
      spaceAfter: 3,
      src: { page: 0, box: fl.box },
    };
  });

  return {
    bodyLines,
    footnotes,
  };
}
