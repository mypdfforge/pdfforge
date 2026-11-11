import { Glyph, Rect, PageIR, FontInfo, LinkObj } from '../core/pageir.js';
import { Run, Para } from '../core/ast.js';
import { params } from '../core/params.js';
import { containsPoint, createRect } from '../core/geometry.js';

export type LineSegment = {
  box: Rect;
  text: string;
  runs: Run[];
};

export type TextLine = {
  baseline: number;
  box: Rect;
  dominantSize: number;
  dominantFont: string;
  segments: LineSegment[];
  glyphs: Glyph[];
};

export function clusterGlyphsIntoLines(
  glyphs: Glyph[],
  fonts: FontInfo[] = [],
  links: LinkObj[] = []
): TextLine[] {
  if (glyphs.length === 0) return [];

  // Map font key to font info
  const fontMap = new Map<string, FontInfo>();
  for (const f of fonts) {
    fontMap.set(f.key, f);
  }

  // Sort glyphs by baseline (top to bottom) then x (left to right)
  const sorted = [...glyphs].sort((a, b) => {
    const diffY = a.baseline - b.baseline;
    if (Math.abs(diffY) > 2.0) {
      return diffY;
    }
    return a.box.x0 - b.box.x0;
  });

  const lines: TextLine[] = [];
  let currentGlyphs: Glyph[] = [];
  let currentBaseline = sorted[0].baseline;
  let currentSize = sorted[0].size;

  for (const g of sorted) {
    const tol = params.line.baselineTol * Math.max(g.size, currentSize);
    if (Math.abs(g.baseline - currentBaseline) <= tol) {
      currentGlyphs.push(g);
      // Update baseline running average
      currentBaseline =
        currentBaseline * 0.8 + g.baseline * 0.2;
    } else {
      if (currentGlyphs.length > 0) {
        lines.push(buildLineFromGlyphs(currentGlyphs, fontMap, links));
      }
      currentGlyphs = [g];
      currentBaseline = g.baseline;
      currentSize = g.size;
    }
  }

  if (currentGlyphs.length > 0) {
    lines.push(buildLineFromGlyphs(currentGlyphs, fontMap, links));
  }

  return lines;
}

function buildLineFromGlyphs(
  glyphs: Glyph[],
  fontMap: Map<string, FontInfo>,
  links: LinkObj[]
): TextLine {
  // Sort line glyphs strictly by x0
  glyphs.sort((a, b) => a.box.x0 - b.box.x0);

  let minX0 = glyphs[0].box.x0;
  let minY0 = glyphs[0].box.y0;
  let maxX1 = glyphs[0].box.x1;
  let maxY1 = glyphs[0].box.y1;
  const baseline = glyphs[0].baseline;

  // Calculate dominant font and size
  const sizeCounts = new Map<number, number>();
  const fontCounts = new Map<string, number>();

  for (const g of glyphs) {
    if (g.box.x0 < minX0) minX0 = g.box.x0;
    if (g.box.y0 < minY0) minY0 = g.box.y0;
    if (g.box.x1 > maxX1) maxX1 = g.box.x1;
    if (g.box.y1 > maxY1) maxY1 = g.box.y1;

    const roundedSize = Math.round(g.size * 2) / 2;
    sizeCounts.set(roundedSize, (sizeCounts.get(roundedSize) || 0) + 1);
    fontCounts.set(g.fontKey, (fontCounts.get(g.fontKey) || 0) + 1);
  }

  let dominantSize = glyphs[0].size;
  let maxCount = 0;
  for (const [size, count] of sizeCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      dominantSize = size;
    }
  }

  let dominantFont = glyphs[0].fontKey;
  maxCount = 0;
  for (const [font, count] of fontCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      dominantFont = font;
    }
  }

  // Segment line into words & runs
  const runs: Run[] = [];
  let currentRun: Run | null = null;

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const prev = i > 0 ? glyphs[i - 1] : null;

    // Check for synthetic space
    let prependSpace = false;
    if (prev) {
      const gap = g.box.x0 - prev.box.x1;
      const spaceThreshold = params.word.gapEm * dominantSize;
      if (gap > spaceThreshold && !prev.ch.endsWith(' ') && g.ch !== ' ') {
        prependSpace = true;
      }
    }

    const fontInfo = fontMap.get(g.fontKey);
    const isBold = fontInfo?.bold || false;
    const isItalic = fontInfo?.italic || false;
    const fontFamily = fontInfo?.family || 'Calibri';

    // Subscript / superscript check
    const yOffset = baseline - g.baseline;
    const isSup = yOffset > 0.2 * dominantSize && g.size <= 0.85 * dominantSize;
    const isSub = yOffset < -0.2 * dominantSize && g.size <= 0.85 * dominantSize;

    // Check link containment
    let linkUrl: string | undefined;
    for (const link of links) {
      if (containsPoint(link.box, (g.box.x0 + g.box.x1) / 2, (g.box.y0 + g.box.y1) / 2)) {
        linkUrl = link.url;
        break;
      }
    }

    const charText = (prependSpace ? ' ' : '') + g.ch;

    if (
      currentRun &&
      currentRun.bold === isBold &&
      currentRun.italic === isItalic &&
      currentRun.font === fontFamily &&
      Math.abs((currentRun.size || dominantSize) - g.size) < 0.5 &&
      currentRun.color === g.color &&
      currentRun.sup === isSup &&
      currentRun.sub === isSub &&
      currentRun.link?.url === linkUrl
    ) {
      currentRun.text += charText;
    } else {
      currentRun = {
        text: charText,
        bold: isBold,
        italic: isItalic,
        font: fontFamily,
        size: g.size,
        color: g.color,
        sup: isSup ? true : undefined,
        sub: isSub ? true : undefined,
        link: linkUrl ? { url: linkUrl } : undefined,
      };
      runs.push(currentRun);
    }
  }

  const lineBox: Rect = { x0: minX0, y0: minY0, x1: maxX1, y1: maxY1 };
  const fullText = runs.map((r) => r.text).join('');

  return {
    baseline,
    box: lineBox,
    dominantSize,
    dominantFont,
    segments: [
      {
        box: lineBox,
        text: fullText,
        runs,
      },
    ],
    glyphs,
  };
}

/**
 * Naive S6 Paragraph Clustering for M1 (single-column MVP):
 * Groups consecutive lines where vertical gap <= medianLeading * 1.5 into a single paragraph.
 */
export function clusterLinesIntoParagraphs(lines: TextLine[], pageIndex: number): Para[] {
  if (lines.length === 0) return [];

  // Sort lines by y0
  lines.sort((a, b) => a.box.y0 - b.box.y0);

  // Compute median leading
  const leadings: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lead = lines[i].baseline - lines[i - 1].baseline;
    if (lead > 0 && lead < 50) {
      leadings.push(lead);
    }
  }
  leadings.sort((a, b) => a - b);
  const medianLeading = leadings.length > 0 ? leadings[Math.floor(leadings.length / 2)] : 14;

  const paras: Para[] = [];
  let currentRuns: Run[] = [];
  let currentBox: Rect = { ...lines[0].box };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : null;

    let isNewPara = false;
    if (prev) {
      const vGap = line.box.y0 - prev.box.y1;
      if (vGap > medianLeading * params.para.gapRatio) {
        isNewPara = true;
      }
    }

    if (isNewPara && currentRuns.length > 0) {
      paras.push({
        type: 'p',
        runs: currentRuns,
        align: 'left',
        src: { page: pageIndex, box: currentBox },
      });
      currentRuns = [];
      currentBox = { ...line.box };
    }

    // Append runs with a space separator between lines
    for (let rIdx = 0; rIdx < line.segments[0].runs.length; rIdx++) {
      const run = line.segments[0].runs[rIdx];
      if (rIdx === 0 && currentRuns.length > 0 && !currentRuns[currentRuns.length - 1].text.endsWith(' ')) {
        currentRuns.push({ ...run, text: ' ' + run.text });
      } else {
        currentRuns.push({ ...run });
      }
    }

    currentBox.x0 = Math.min(currentBox.x0, line.box.x0);
    currentBox.y0 = Math.min(currentBox.y0, line.box.y0);
    currentBox.x1 = Math.max(currentBox.x1, line.box.x1);
    currentBox.y1 = Math.max(currentBox.y1, line.box.y1);
  }

  if (currentRuns.length > 0) {
    paras.push({
      type: 'p',
      runs: currentRuns,
      align: 'left',
      src: { page: pageIndex, box: currentBox },
    });
  }

  return paras;
}
