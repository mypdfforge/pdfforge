import { TextLine } from './lines.js';

export type AlignmentType = 'left' | 'center' | 'right' | 'justify';

export function detectParagraphAlignment(
  lines: TextLine[],
  leafLeft: number,
  leafRight: number,
  tolPt: number = 3.0
): AlignmentType {
  if (lines.length === 0) return 'left';

  const leafWidth = leafRight - leafLeft;
  const leafCenter = (leafLeft + leafRight) / 2;

  // For 1-line or 2-line paragraphs, check centering against container
  if (lines.length <= 2) {
    const isSingleCentered = lines.every((l) => {
      const lineCenter = (l.box.x0 + l.box.x1) / 2;
      const leftMargin = l.box.x0 - leafLeft;
      const rightMargin = leafRight - l.box.x1;
      return (
        Math.abs(lineCenter - leafCenter) <= tolPt &&
        Math.abs(leftMargin - rightMargin) <= tolPt * 2 &&
        l.box.x1 - l.box.x0 < leafWidth - 20
      );
    });
    if (isSingleCentered) return 'center';

    const isSingleRight = lines.every((l) => Math.abs(l.box.x1 - leafRight) <= tolPt);
    if (isSingleRight && lines[0].box.x0 - leafLeft > 20) return 'right';

    return 'left';
  }

  // Multi-line paragraphs (>= 3 lines)
  const leftDiffs: number[] = [];
  const rightDiffs: number[] = [];
  const centerDiffs: number[] = [];

  const baseLeft = lines[0].box.x0;
  const baseCenter = (lines[0].box.x0 + lines[0].box.x1) / 2;

  // Non-last lines for right alignment / justification checks
  const nonLastLines = lines.slice(0, lines.length - 1);
  const baseRight = nonLastLines[0].box.x1;

  for (const line of lines) {
    leftDiffs.push(Math.abs(line.box.x0 - baseLeft));
    const center = (line.box.x0 + line.box.x1) / 2;
    centerDiffs.push(Math.abs(center - baseCenter));
  }

  for (const line of nonLastLines) {
    rightDiffs.push(Math.abs(line.box.x1 - baseRight));
  }

  const leftAlignCount = leftDiffs.filter((d) => d <= tolPt).length;
  const rightAlignCount = rightDiffs.filter((d) => d <= tolPt).length;
  const centerAlignCount = centerDiffs.filter((d) => d <= tolPt).length;

  const leftAlignRatio = leftAlignCount / lines.length;
  const rightAlignRatio = nonLastLines.length > 0 ? rightAlignCount / nonLastLines.length : 0;
  const centerAlignRatio = centerAlignCount / lines.length;

  // Justify: left edges align and non-last right edges align
  if (leftAlignRatio >= 0.7 && rightAlignRatio >= 0.6) {
    return 'justify';
  }

  // Center: centers align and left edges vary
  if (centerAlignRatio >= 0.8 && leftAlignRatio < 0.5) {
    return 'center';
  }

  // Right: right edges align and left edges vary
  if (rightAlignRatio >= 0.8 && leftAlignRatio < 0.5) {
    return 'right';
  }

  return 'left';
}
