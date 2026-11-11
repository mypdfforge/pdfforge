import { TextLine } from './lines.js';
import { Rect, FontInfo } from '../core/pageir.js';
import { rectWidth, rectHeight } from '../core/geometry.js';

export type LeafClass =
  | 'body'
  | 'heading'
  | 'list'
  | 'code'
  | 'callout'
  | 'footnote';

export function classifyLeafBlock(
  lines: TextLine[],
  pageWidth: number,
  pageHeight: number,
  fonts: FontInfo[] = []
): LeafClass {
  if (lines.length === 0) return 'body';

  const fontMap = new Map<string, FontInfo>();
  for (const f of fonts) fontMap.set(f.key, f);

  // 1. Check for Code Block: >= 80% glyphs from mono font and >= 2 lines
  let totalChars = 0;
  let monoChars = 0;
  for (const l of lines) {
    const fInfo = fontMap.get(l.dominantFont);
    const chars = l.segments[0]?.text.length || 0;
    totalChars += chars;
    if (fInfo?.mono) {
      monoChars += chars;
    }
  }

  if (lines.length >= 2 && totalChars > 0 && monoChars / totalChars >= 0.8) {
    return 'code';
  }

  // 2. Check for Footnote: bottom 15% of page, font size <= 9.5
  const avgY1 = lines[lines.length - 1].box.y1;
  const avgSize = lines[0].dominantSize;
  if (avgY1 >= pageHeight * 0.85 && avgSize <= 9.5 && lines.length <= 4) {
    return 'footnote';
  }

  // 3. Check for Callout: narrow width (< 35% page width)
  const leftX = Math.min(...lines.map((l) => l.box.x0));
  const rightX = Math.max(...lines.map((l) => l.box.x1));
  const leafW = rightX - leftX;
  if (leafW > 0 && leafW < pageWidth * 0.35 && lines.length >= 2) {
    return 'callout';
  }

  return 'body';
}
