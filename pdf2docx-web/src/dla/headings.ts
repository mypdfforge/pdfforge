import { TextLine } from './lines.js';
import { Para } from '../core/ast.js';

export type HeadingClassification = {
  isHeading: boolean;
  level?: 1 | 2 | 3 | 4;
  isTitle?: boolean;
};

export function computeBodyFontSize(lines: TextLine[]): number {
  const sizeWeights = new Map<number, number>();

  for (const line of lines) {
    const chars = line.segments[0]?.text.length || 0;
    const roundedSize = Math.round(line.dominantSize * 2) / 2;
    sizeWeights.set(roundedSize, (sizeWeights.get(roundedSize) || 0) + chars);
  }

  let maxWeight = 0;
  let bodySize = 11;

  for (const [size, weight] of sizeWeights.entries()) {
    if (weight > maxWeight) {
      maxWeight = weight;
      bodySize = size;
    }
  }

  return bodySize;
}

export function classifyHeading(
  para: Para,
  bodySize: number,
  pageIndex: number,
  isFirstBlock: boolean
): HeadingClassification {
  if (para.runs.length === 0) return { isHeading: false };

  const fullText = para.runs.map((r) => r.text).join('').trim();
  if (fullText.length === 0 || fullText.length > 200) {
    return { isHeading: false };
  }

  const dominantRun = para.runs[0];
  const size = dominantRun.size || bodySize;
  const isBold = Boolean(dominantRun.bold);
  const isAllCaps = fullText.length > 3 && fullText === fullText.toUpperCase() && /[A-Z]/.test(fullText);

  // First page largest candidate -> Title
  if (pageIndex === 0 && isFirstBlock && size >= bodySize * 1.4) {
    return { isHeading: true, isTitle: true, level: 1 };
  }

  // Never classify body-sized numbered lines as headings (e.g. "2. Bold Weight...", "8. Multi-Colored Runs:")
  if ((/^\d+[\.\)]\s/.test(fullText) || para.list) && size < bodySize * 1.25) {
    return { isHeading: false };
  }

  // Large size or bold short phrase with size above body font
  const isLarge = size >= bodySize * 1.2;
  const isBoldHeading =
    isBold && size >= bodySize * 1.15 && fullText.length < 100 && !fullText.endsWith('.');

  if (!isLarge && !isBoldHeading && !isAllCaps) {
    return { isHeading: false };
  }

  // Determine Level (1 to 4)
  let level: 1 | 2 | 3 | 4 = 1;
  if (size >= bodySize * 1.5) {
    level = 1;
  } else if (size >= bodySize * 1.3) {
    level = 2;
  } else if (size >= bodySize * 1.15 || (isBold && isAllCaps)) {
    level = 3;
  } else {
    level = 4;
  }

  return {
    isHeading: true,
    level,
  };
}
