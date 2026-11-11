import { Rect } from '../core/pageir.js';
import { TextLine } from './lines.js';
import { params } from '../core/params.js';
import { boundingBox, rectWidth, rectHeight } from '../core/geometry.js';

export type CutNode = {
  box: Rect;
  type: 'hcut' | 'vcut' | 'leaf';
  children?: CutNode[];
  lines: TextLine[];
};

export function recursiveXYCut(
  lines: TextLine[],
  medianLineHeight: number = 12,
  depth: number = 0
): CutNode {
  if (lines.length === 0) {
    return {
      box: { x0: 0, y0: 0, x1: 0, y1: 0 },
      type: 'leaf',
      lines: [],
    };
  }

  const allBoxes = lines.map((l) => l.box);
  const nodeBox = boundingBox(allBoxes);

  if (lines.length <= 1 || depth > 10) {
    return {
      box: nodeBox,
      type: 'leaf',
      lines,
    };
  }

  // 1. Try Horizontal Cut: Find empty horizontal gaps
  const hCutSplit = findHorizontalCut(lines, nodeBox, medianLineHeight);
  if (hCutSplit) {
    const topChild = recursiveXYCut(hCutSplit.top, medianLineHeight, depth + 1);
    const bottomChild = recursiveXYCut(hCutSplit.bottom, medianLineHeight, depth + 1);
    return {
      box: nodeBox,
      type: 'hcut',
      children: [topChild, bottomChild],
      lines,
    };
  }

  // 2. Check for Spanning Elements before Vertical Cut
  const spanningResult = extractSpanningLines(lines, nodeBox);
  if (spanningResult) {
    const beforeChild = spanningResult.before.length > 0
      ? recursiveXYCut(spanningResult.before, medianLineHeight, depth + 1)
      : null;
    const spanningChild = recursiveXYCut(spanningResult.spanning, medianLineHeight, depth + 1);
    const afterChild = spanningResult.after.length > 0
      ? recursiveXYCut(spanningResult.after, medianLineHeight, depth + 1)
      : null;

    const children: CutNode[] = [];
    if (beforeChild) children.push(beforeChild);
    children.push(spanningChild);
    if (afterChild) children.push(afterChild);

    return {
      box: nodeBox,
      type: 'hcut',
      children,
      lines,
    };
  }

  // 3. Try Vertical Cut: Find empty vertical gutters
  const vCutSplit = findVerticalCut(lines, nodeBox);
  if (vCutSplit) {
    const leftChild = recursiveXYCut(vCutSplit.left, medianLineHeight, depth + 1);
    const rightChild = recursiveXYCut(vCutSplit.right, medianLineHeight, depth + 1);
    return {
      box: nodeBox,
      type: 'vcut',
      children: [leftChild, rightChild],
      lines,
    };
  }

  // No cuts possible -> Leaf node
  return {
    box: nodeBox,
    type: 'leaf',
    lines: [...lines].sort((a, b) => a.box.y0 - b.box.y0),
  };
}

function findHorizontalCut(
  lines: TextLine[],
  bounds: Rect,
  medianLineHeight: number
): { top: TextLine[]; bottom: TextLine[] } | null {
  const sorted = [...lines].sort((a, b) => a.box.y0 - b.box.y0);
  const minGap = params.xy.hGapLineH * medianLineHeight;

  let maxGap = 0;
  let splitIndex = -1;

  for (let i = 0; i < sorted.length - 1; i++) {
    const bottomOfCurrent = sorted[i].box.y1;
    const topOfNext = sorted[i + 1].box.y0;
    const gap = topOfNext - bottomOfCurrent;

    if (gap >= minGap && gap > maxGap) {
      maxGap = gap;
      splitIndex = i + 1;
    }
  }

  if (splitIndex > 0) {
    return {
      top: sorted.slice(0, splitIndex),
      bottom: sorted.slice(splitIndex),
    };
  }

  return null;
}

function findVerticalCut(
  lines: TextLine[],
  bounds: Rect
): { left: TextLine[]; right: TextLine[] } | null {
  const totalWidth = rectWidth(bounds);
  if (totalWidth < 100) return null; // Too narrow for column split

  const minGutter = params.xy.vGutterPt;
  const sortedByX = [...lines].sort((a, b) => a.box.x0 - b.box.x0);

  // Search candidate gutters
  let bestGutterStart = 0;
  let maxGutter = 0;
  let splitIndex = -1;

  for (let i = 0; i < sortedByX.length - 1; i++) {
    // Check max x1 of all elements up to i
    let leftMaxX = sortedByX[0].box.x1;
    for (let k = 0; k <= i; k++) {
      if (sortedByX[k].box.x1 > leftMaxX) leftMaxX = sortedByX[k].box.x1;
    }

    // Check min x0 of all elements from i + 1
    let rightMinX = sortedByX[i + 1].box.x0;
    for (let k = i + 1; k < sortedByX.length; k++) {
      if (sortedByX[k].box.x0 < rightMinX) rightMinX = sortedByX[k].box.x0;
    }

    const gutter = rightMinX - leftMaxX;
    if (gutter >= minGutter && gutter > maxGutter) {
      const leftCount = i + 1;
      const rightCount = sortedByX.length - leftCount;

      // Ensure both sides meet min lines or ratio requirement (§5 S3 step 2)
      if (
        (leftCount >= params.xy.minSideLines || leftCount / lines.length >= params.xy.minSideTextRatio) &&
        (rightCount >= params.xy.minSideLines || rightCount / lines.length >= params.xy.minSideTextRatio)
      ) {
        maxGutter = gutter;
        bestGutterStart = leftMaxX;
        splitIndex = i + 1;
      }
    }
  }

  if (splitIndex > 0) {
    const leftSide = sortedByX.slice(0, splitIndex);
    const rightSide = sortedByX.slice(splitIndex);
    return {
      left: leftSide.sort((a, b) => a.box.y0 - b.box.y0),
      right: rightSide.sort((a, b) => a.box.y0 - b.box.y0),
    };
  }

  return null;
}

function extractSpanningLines(
  lines: TextLine[],
  bounds: Rect
): { before: TextLine[]; spanning: TextLine[]; after: TextLine[] } | null {
  const nodeWidth = rectWidth(bounds);
  if (nodeWidth < 200 || lines.length < 5) return null;

  // A spanning line covers >= 75% of the node width while other lines are much narrower
  const spanningLines: TextLine[] = [];
  const otherLines: TextLine[] = [];

  for (const l of lines) {
    const w = rectWidth(l.box);
    if (w >= nodeWidth * 0.75) {
      spanningLines.push(l);
    } else {
      otherLines.push(l);
    }
  }

  // Only consider spanning if there are both spanning lines and substantial column lines
  if (spanningLines.length > 0 && spanningLines.length < lines.length && otherLines.length >= 3) {
    const spanningY0 = Math.min(...spanningLines.map((l) => l.box.y0));
    const spanningY1 = Math.max(...spanningLines.map((l) => l.box.y1));

    const before = otherLines.filter((l) => l.box.y1 <= spanningY0);
    const after = otherLines.filter((l) => l.box.y0 >= spanningY1);

    if (before.length + after.length + spanningLines.length === lines.length) {
      return {
        before,
        spanning: spanningLines,
        after,
      };
    }
  }

  return null;
}
