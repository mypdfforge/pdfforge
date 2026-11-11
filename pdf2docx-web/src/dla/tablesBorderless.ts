import { TextLine } from './lines.js';
import { Table, TableRow, Cell, Para } from '../core/ast.js';
import { params } from '../core/params.js';
import { Rect } from '../core/pageir.js';
import { containsPoint, rectWidth, rectHeight } from '../core/geometry.js';
import { reflowParagraphs } from './paragraphs.js';
import { detectListMarker } from './lists.js';

const NUMERIC_TOKEN_REGEX = /^[\(\-−–$€£¥₹]?\s*[\d,]+(\.\d+)?\s*[\)%]?$/;

export function isNumericToken(str: string): boolean {
  const trimmed = str.trim();
  if (trimmed === '—' || trimmed === '-' || trimmed === '–' || trimmed === 'N/A') return true;
  return NUMERIC_TOKEN_REGEX.test(trimmed);
}

export type BorderlessCandidateBand = {
  lines: TextLine[];
  lineIndices: number[];
};

export function findBorderlessCandidateBands(
  lines: TextLine[],
  excludedIndices: Set<number>
): BorderlessCandidateBand[] {
  const bands: BorderlessCandidateBand[] = [];
  let currentBand: { lines: TextLine[]; lineIndices: number[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (excludedIndices.has(i)) {
      if (currentBand && currentBand.lines.length >= 3) {
        bands.push(currentBand);
      }
      currentBand = null;
      continue;
    }

    const line = lines[i];
    // Check if line has multiple segments or wide internal gap >= 20pt
    const hasMultipleSegments = line.segments.length >= 2 || hasWideInternalGaps(line);

    if (hasMultipleSegments) {
      if (!currentBand) {
        currentBand = { lines: [line], lineIndices: [i] };
      } else {
        // Check vertical gap
        const prev = currentBand.lines[currentBand.lines.length - 1];
        const vGap = line.box.y0 - prev.box.y1;
        if (vGap <= prev.dominantSize * 2.5) {
          currentBand.lines.push(line);
          currentBand.lineIndices.push(i);
        } else {
          if (currentBand.lines.length >= 3) {
            bands.push(currentBand);
          }
          currentBand = { lines: [line], lineIndices: [i] };
        }
      }
    } else {
      if (currentBand && currentBand.lines.length >= 3) {
        bands.push(currentBand);
      }
      currentBand = null;
    }
  }

  if (currentBand && currentBand.lines.length >= 3) {
    bands.push(currentBand);
  }

  return bands;
}

function hasWideInternalGaps(line: TextLine): boolean {
  if (line.glyphs.length < 2) return false;
  for (let i = 1; i < line.glyphs.length; i++) {
    const gap = line.glyphs[i].box.x0 - line.glyphs[i - 1].box.x1;
    if (gap >= 20) return true;
  }
  return false;
}

/**
 * Shared Baseline Discriminator (§5 S5B step 2)
 * In a true table, items across columns share the exact same baseline in >= 80% of rows.
 * In multi-column prose, baselines drift independently and lines average > 8 words.
 */
export function passesSharedBaselineTest(band: BorderlessCandidateBand): boolean {
  let multiSegmentRows = 0;
  let sharedBaselineRows = 0;
  let totalWordCount = 0;

  for (const line of band.lines) {
    const words = (line.segments[0]?.text || '').trim().split(/\s+/).filter(Boolean);
    totalWordCount += words.length;

    // Check if line has a list marker (hanging indent anti-confusion §5 S5D)
    if (detectListMarker(words[0] || '')) {
      return false; // Lists with hanging indent are NOT tables!
    }

    // Split line by wide gap into column chunks
    const chunks = splitLineByWideGaps(line);
    if (chunks.length >= 2) {
      multiSegmentRows++;
      // Check baseline variance across chunks
      const baselines = chunks.map((c) => c.baseline);
      const minB = Math.min(...baselines);
      const maxB = Math.max(...baselines);
      if (maxB - minB <= 1.5) {
        sharedBaselineRows++;
      }
    }
  }

  const avgWordsPerLine = totalWordCount / Math.max(1, band.lines.length);
  if (avgWordsPerLine > 8 && sharedBaselineRows / Math.max(1, multiSegmentRows) < 0.7) {
    return false; // Prose column false positive!
  }

  return multiSegmentRows >= 3 && sharedBaselineRows / multiSegmentRows >= 0.7;
}

export type LineChunk = {
  text: string;
  box: Rect;
  baseline: number;
};

export function splitLineByWideGaps(line: TextLine): LineChunk[] {
  if (line.glyphs.length === 0) return [];
  const sortedGlyphs = [...line.glyphs].sort((a, b) => a.box.x0 - b.box.x0);

  const chunks: LineChunk[] = [];
  let currentGlyphs = [sortedGlyphs[0]];

  for (let i = 1; i < sortedGlyphs.length; i++) {
    const g = sortedGlyphs[i];
    const prev = sortedGlyphs[i - 1];
    const gap = g.box.x0 - prev.box.x1;

    // Wide gap splitting threshold
    if (gap >= params.line.segmentGapEm * line.dominantSize || gap >= 18) {
      chunks.push(makeChunkFromGlyphs(currentGlyphs));
      currentGlyphs = [g];
    } else {
      currentGlyphs.push(g);
    }
  }

  if (currentGlyphs.length > 0) {
    chunks.push(makeChunkFromGlyphs(currentGlyphs));
  }

  return chunks;
}

function makeChunkFromGlyphs(glyphs: typeof TextLine.prototype.glyphs): LineChunk {
  const minX = glyphs[0].box.x0;
  const minY = Math.min(...glyphs.map((g) => g.box.y0));
  const maxX = glyphs[glyphs.length - 1].box.x1;
  const maxY = Math.max(...glyphs.map((g) => g.box.y1));
  const text = glyphs.map((g) => g.ch).join('').trim();

  return {
    text,
    box: { x0: minX, y0: minY, x1: maxX, y1: maxY },
    baseline: glyphs[0].baseline,
  };
}

export function buildBorderlessTable(
  band: BorderlessCandidateBand,
  pageIndex: number,
  pageWidth: number
): { table: Table; consumedIndices: Set<number> } {
  // Collect all chunks across all lines
  const rowChunks: LineChunk[][] = [];
  const allXIntervals: { x0: number; x1: number }[] = [];

  for (const line of band.lines) {
    const chunks = splitLineByWideGaps(line);
    rowChunks.push(chunks);
    for (const c of chunks) {
      allXIntervals.push({ x0: c.box.x0, x1: c.box.x1 });
    }
  }

  // Find column gutters
  const gutters = findColumnGutters(allXIntervals, pageWidth);
  const colBounds = computeColumnBounds(gutters, pageWidth);
  const numCols = colBounds.length;

  const colWidths = colBounds.map((b) => b.x1 - b.x0);
  const rows: TableRow[] = [];

  for (let rIdx = 0; rIdx < rowChunks.length; rIdx++) {
    const chunks = rowChunks[rIdx];
    const line = band.lines[rIdx];
    const cells: Cell[] = [];

    // Assign each column its corresponding chunk
    for (let cIdx = 0; cIdx < numCols; cIdx++) {
      const colB = colBounds[cIdx];
      const matchingChunk = chunks.find((c) => {
        const cCenter = (c.box.x0 + c.box.x1) / 2;
        return cCenter >= colB.x0 - 5 && cCenter <= colB.x1 + 5;
      });

      const text = matchingChunk ? matchingChunk.text : '';
      const isNum = isNumericToken(text);

      cells.push({
        blocks: [
          {
            type: 'p',
            runs: [{ text, font: 'Calibri', size: line.dominantSize }],
            align: isNum ? 'right' : 'left', // Numeric columns right-aligned (§5 S5B step 4)
          },
        ],
        colSpan: 1,
        rowSpan: 1,
        width: colBounds[cIdx].x1 - colBounds[cIdx].x0,
      });
    }

    rows.push({
      cells,
      header: rIdx === 0, // First row assumed header
    });
  }

  const tableBox = {
    x0: colBounds[0].x0,
    y0: band.lines[0].box.y0,
    x1: colBounds[numCols - 1].x1,
    y1: band.lines[band.lines.length - 1].box.y1,
  };

  return {
    table: {
      type: 'tbl',
      colWidths,
      rows,
      borders: {
        top: { style: 'nil', size: 0, color: 'auto' },
        bottom: { style: 'nil', size: 0, color: 'auto' },
        left: { style: 'nil', size: 0, color: 'auto' },
        right: { style: 'nil', size: 0, color: 'auto' },
      },
      src: { page: pageIndex, box: tableBox },
    },
    consumedIndices: new Set(band.lineIndices),
  };
}

function findColumnGutters(
  intervals: { x0: number; x1: number }[],
  pageWidth: number
): number[] {
  // Cluster interval starts and ends
  const minX = Math.min(...intervals.map((i) => i.x0));
  const maxX = Math.max(...intervals.map((i) => i.x1));

  const histogram = new Array(Math.ceil(pageWidth)).fill(0);
  for (const inv of intervals) {
    const start = Math.max(0, Math.floor(inv.x0));
    const end = Math.min(pageWidth - 1, Math.ceil(inv.x1));
    for (let x = start; x <= end; x++) {
      histogram[x]++;
    }
  }

  // Find zero or near-zero gaps spanning at least 15pt
  const gutters: number[] = [];
  let inGap = false;
  let gapStart = 0;

  for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
    if (histogram[x] <= 1) {
      if (!inGap) {
        inGap = true;
        gapStart = x;
      }
    } else {
      if (inGap) {
        inGap = false;
        if (x - gapStart >= 12) {
          gutters.push((gapStart + x) / 2);
        }
      }
    }
  }

  return gutters;
}

function computeColumnBounds(
  gutters: number[],
  pageWidth: number
): { x0: number; x1: number }[] {
  if (gutters.length === 0) {
    return [{ x0: 50, x1: pageWidth - 50 }];
  }

  const bounds: { x0: number; x1: number }[] = [];
  let prevX = 50;

  for (const g of gutters) {
    bounds.push({ x0: prevX, x1: g });
    prevX = g;
  }
  bounds.push({ x0: prevX, x1: pageWidth - 50 });

  return bounds;
}
