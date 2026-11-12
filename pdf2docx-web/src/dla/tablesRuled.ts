import { PageIR, Stroke, Fill, Rect } from '../core/pageir.js';
import { TextLine } from './lines.js';
import { Table, TableRow, Cell, Para, Borders, BorderDef, Run } from '../core/ast.js';
import { params } from '../core/params.js';
import { containsPoint, createRect, intersectsRect, rectWidth, rectHeight } from '../core/geometry.js';
import { reflowParagraphs } from './paragraphs.js';

export type Segment = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dir: 'h' | 'v';
  width: number;
  color: string;
};

export function extractSegments(pageIr: PageIR): Segment[] {
  const segments: Segment[] = [];

  // 1. From Strokes
  for (const s of pageIr.strokes) {
    if (s.kind === 'line' && s.pts.length >= 4) {
      addSnappedSegment(segments, s.pts[0], s.pts[1], s.pts[2], s.pts[3], s.width, s.color);
    } else if (s.kind === 'rect' && s.pts.length >= 4) {
      const [x, y, w, h] = s.pts;
      addSnappedSegment(segments, x, y, x + w, y, s.width, s.color);
      addSnappedSegment(segments, x + w, y, x + w, y + h, s.width, s.color);
      addSnappedSegment(segments, x, y + h, x + w, y + h, s.width, s.color);
      addSnappedSegment(segments, x, y, x, y + h, s.width, s.color);
    }
  }

  // 2. From thin Fills
  for (const f of pageIr.fills) {
    const w = f.box.x1 - f.box.x0;
    const h = f.box.y1 - f.box.y0;
    if (w < 1.5 && h >= 4.0) {
      addSnappedSegment(segments, (f.box.x0 + f.box.x1) / 2, f.box.y0, (f.box.x0 + f.box.x1) / 2, f.box.y1, w, f.color);
    } else if (h < 1.5 && w >= 4.0) {
      addSnappedSegment(segments, f.box.x0, (f.box.y0 + f.box.y1) / 2, f.box.x1, (f.box.y0 + f.box.y1) / 2, h, f.color);
    }
  }

  return mergeCollinearSegments(segments);
}

function addSnappedSegment(
  segments: Segment[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  color: string
) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);

  if (dy <= 1.5 && dx >= 3.0) {
    // Horizontal line
    const y = (y0 + y1) / 2;
    segments.push({
      x0: Math.min(x0, x1),
      y0: y,
      x1: Math.max(x0, x1),
      y1: y,
      dir: 'h',
      width: Math.max(0.5, width),
      color: color || '#000000',
    });
  } else if (dx <= 1.5 && dy >= 3.0) {
    // Vertical line
    const x = (x0 + x1) / 2;
    segments.push({
      x0: x,
      y0: Math.min(y0, y1),
      x1: x,
      y1: Math.max(y0, y1),
      dir: 'v',
      width: Math.max(0.5, width),
      color: color || '#000000',
    });
  }
}

function mergeCollinearSegments(segments: Segment[]): Segment[] {
  const merged: Segment[] = [];
  const hSegs = segments.filter((s) => s.dir === 'h').sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const vSegs = segments.filter((s) => s.dir === 'v').sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);

  // Merge horizontal
  for (const s of hSegs) {
    const last = merged[merged.length - 1];
    if (last && last.dir === 'h' && Math.abs(last.y0 - s.y0) <= 1.5 && s.x0 <= last.x1 + params.tbl.mergeTol) {
      last.x1 = Math.max(last.x1, s.x1);
    } else {
      merged.push({ ...s });
    }
  }

  // Merge vertical
  for (const s of vSegs) {
    const last = merged[merged.length - 1];
    if (last && last.dir === 'v' && Math.abs(last.x0 - s.x0) <= 1.5 && s.y0 <= last.y1 + params.tbl.mergeTol) {
      last.y1 = Math.max(last.y1, s.y1);
    } else {
      merged.push({ ...s });
    }
  }

  return merged;
}

export type TableCandidate = {
  box: Rect;
  hSegs: Segment[];
  vSegs: Segment[];
};

export function findTableConnectedComponents(segments: Segment[]): TableCandidate[] {
  const hSegs = segments.filter((s) => s.dir === 'h');
  const vSegs = segments.filter((s) => s.dir === 'v');

  if (hSegs.length < 2 || vSegs.length < 2) return [];

  // Group intersecting segments
  const parent = new Map<Segment, Segment>();
  function find(s: Segment): Segment {
    if (!parent.has(s)) parent.set(s, s);
    if (parent.get(s) !== s) {
      parent.set(s, find(parent.get(s)!));
    }
    return parent.get(s)!;
  }
  function union(a: Segment, b: Segment) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  for (const h of hSegs) {
    for (const v of vSegs) {
      // Check if horizontal and vertical segments intersect or touch (within 2pt)
      if (
        v.x0 >= h.x0 - 2 &&
        v.x0 <= h.x1 + 2 &&
        h.y0 >= v.y0 - 2 &&
        h.y0 <= v.y1 + 2
      ) {
        union(h, v);
      }
    }
  }

  const groups = new Map<Segment, Segment[]>();
  for (const s of segments) {
    const root = find(s);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(s);
  }

  const candidates: TableCandidate[] = [];
  for (const segList of groups.values()) {
    const groupH = segList.filter((s) => s.dir === 'h');
    const groupV = segList.filter((s) => s.dir === 'v');

    if (groupH.length >= 2 && groupV.length >= 2) {
      const minX = Math.min(...segList.map((s) => s.x0));
      const minY = Math.min(...segList.map((s) => s.y0));
      const maxX = Math.max(...segList.map((s) => s.x1));
      const maxY = Math.max(...segList.map((s) => s.y1));

      // Reject single 1x1 boxes
      if (groupH.length === 2 && groupV.length === 2) {
        continue;
      }

      candidates.push({
        box: { x0: minX, y0: minY, x1: maxX, y1: maxY },
        hSegs: groupH,
        vSegs: groupV,
      });
    }
  }

  return candidates;
}

export function buildTableFromCandidate(
  cand: TableCandidate,
  lines: TextLine[],
  fills: Fill[],
  pageIndex: number
): { table: Table; consumedLineIndices: Set<number> } {
  // Cluster X (vertical segment positions) and Y (horizontal segment positions)
  const xCoords: number[] = [];
  for (const v of cand.vSegs) {
    xCoords.push(v.x0);
  }
  const yCoords: number[] = [];
  for (const h of cand.hSegs) {
    yCoords.push(h.y0);
  }

  const clusteredX = clusterNumbers(xCoords, params.tbl.gridSnapTol).sort((a, b) => a - b);
  const clusteredY = clusterNumbers(yCoords, params.tbl.gridSnapTol).sort((a, b) => a - b);

  const numCols = clusteredX.length - 1;
  const numRows = clusteredY.length - 1;

  if (numCols <= 0 || numRows <= 0) {
    return {
      table: { type: 'tbl', colWidths: [cand.box.x1 - cand.box.x0], rows: [], src: { page: pageIndex, box: cand.box } },
      consumedLineIndices: new Set(),
    };
  }

  const colWidths: number[] = [];
  for (let c = 0; c < numCols; c++) {
    colWidths.push(clusteredX[c + 1] - clusteredX[c]);
  }

  const consumedLineIndices = new Set<number>();
  const rows: TableRow[] = [];

  for (let r = 0; r < numRows; r++) {
    const rY0 = clusteredY[r];
    const rY1 = clusteredY[r + 1];
    const cells: Cell[] = [];

    let c = 0;
    while (c < numCols) {
      const cStart = c;
      const cX0 = clusteredX[cStart];

      // Check if vertical borders exist at column boundaries to detect column spanning
      let cEnd = cStart + 1;
      while (cEnd < numCols) {
        const borderX = clusteredX[cEnd];
        const hasBorder = cand.vSegs.some(
          (v) =>
            Math.abs(v.x0 - borderX) <= 3.0 &&
            v.y0 <= rY0 + 3.0 &&
            v.y1 >= rY1 - 3.0
        );
        if (hasBorder) {
          break; // Stop spanning: vertical border exists
        }
        cEnd++;
      }

      const colSpan = cEnd - cStart;
      const cX1 = clusteredX[cEnd];
      const cellBox: Rect = { x0: cX0, y0: rY0, x1: cX1, y1: rY1 };

      // Find lines inside this merged cell
      const cellLines: TextLine[] = [];
      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        const line = lines[lIdx];
        const lineCenterX = (line.box.x0 + line.box.x1) / 2;
        const lineCenterY = (line.box.y0 + line.box.y1) / 2;
        if (containsPoint(cellBox, lineCenterX, lineCenterY)) {
          cellLines.push(line);
          consumedLineIndices.add(lIdx);
        }
      }

      // Check cell fill
      let cellFill: string | undefined;
      for (const f of fills) {
        if (containsPoint(cellBox, (f.box.x0 + f.box.x1) / 2, (f.box.y0 + f.box.y1) / 2)) {
          cellFill = f.color;
          break;
        }
      }

      // Clean lines of any HTML artifacts (e.g. <td colspan=4/>)
      let explicitColSpan = colSpan;
      for (const line of cellLines) {
        for (const seg of line.segments) {
          const match = seg.text.match(/<td\s+colspan=["']?(\d+)["']?\s*\/?>/i);
          if (match) {
            explicitColSpan = parseInt(match[1], 10);
            seg.text = seg.text.replace(/<td\s+colspan=["']?\d+["']?\s*\/?>/gi, '').trim();
            for (const r of seg.runs) {
              r.text = r.text.replace(/<td\s+colspan=["']?\d+["']?\s*\/?>/gi, '').trim();
            }
          }
        }
      }

      // Reflow text inside cell
      const paras = reflowParagraphs(cellLines, pageIndex, cX1 - cX0);

      // If cell has dark background, ensure runs have white text (#FFFFFF)
      if (cellFill && isDarkColor(cellFill)) {
        for (const p of paras) {
          for (const r of p.runs) {
            r.color = '#FFFFFF';
          }
        }
      }

      const cellWidth = colWidths.slice(cStart, cEnd).reduce((a, b) => a + b, 0);

      cells.push({
        blocks: paras.length > 0 ? paras : [{ type: 'p', runs: [{ text: '' }], align: 'left' }],
        colSpan: explicitColSpan,
        rowSpan: 1,
        width: cellWidth,
        fill: cellFill,
      });

      c = cEnd;
    }

    rows.push({
      cells,
      height: rY1 - rY0,
      header: r === 0,
    });
  }

  return {
    table: {
      type: 'tbl',
      colWidths,
      rows,
      src: { page: pageIndex, box: cand.box },
    },
    consumedLineIndices,
  };
}

function isDarkColor(hex: string): boolean {
  const clean = hex.replace('#', '');
  if (clean.length < 6) return false;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 128;
}

function clusterNumbers(vals: number[], tol: number): number[] {
  if (vals.length === 0) return [];
  const sorted = [...vals].sort((a, b) => a - b);
  const clustered: number[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = clustered[clustered.length - 1];
    if (Math.abs(sorted[i] - last) <= tol) {
      clustered[clustered.length - 1] = (last + sorted[i]) / 2;
    } else {
      clustered.push(sorted[i]);
    }
  }

  return clustered;
}
