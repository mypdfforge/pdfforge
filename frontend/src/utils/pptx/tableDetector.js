/**
 * tableDetector.js — Hybrid Lattice (ruling-line) and Stream (borderless)
 * table detector for the PDF -> PPTX v2 engine.
 */

import { intersects, contains } from './slideCoords.js';

const SNAP_IN = 0.6 / 72; // 0.6 pt in inches
const HAIRLINE_MAX_IN = 3.5 / 72;
const MIN_LINE_LEN_IN = 0.08;
const CONNECT_TOL_IN = 0.04;
const MIN_GUTTER_IN = 0.12;

function rgbHex([r, g, b] = [0, 0, 0]) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function clusterCoords(values, tol = SNAP_IN) {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const cur = clusters[clusters.length - 1];
    const mean = cur.reduce((s, v) => s + v, 0) / cur.length;
    if (sorted[i] - mean <= tol) {
      cur.push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }
  return clusters.map((c) => c.reduce((s, v) => s + v, 0) / c.length);
}

function snapTo(val, grid, tol = SNAP_IN * 1.5) {
  let best = val;
  let bestD = Infinity;
  for (const g of grid) {
    const d = Math.abs(val - g);
    if (d < bestD && d <= tol) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

function overlap1D(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function isRectPath(pathEv) {
  if (!pathEv?.ops?.length) return true; // tolerate synthetic paint events without path
  const ops = pathEv.ops;
  if (ops.length === 1 && ops[0] === 19) return true; // OPS.rectangle
  if (ops.length >= 4 && ops.length <= 5 && ops[0] === 13 && ops.slice(1, 4).every((o) => o === 14)) {
    return true;
  }
  return false;
}

function extractRulings(events) {
  const hSegs = [];
  const vSegs = [];
  const fillRects = [];
  let lastPath = null;

  for (const e of events || []) {
    if (e.type === 'path') {
      lastPath = e;
      continue;
    }
    if (e.type !== 'paint' || !e.bbox) continue;

    const { x, y, w, h } = e.bbox;
    const how = e.how || '';
    const hasStroke = how.includes('stroke');
    const hasFill = how.includes('fill');

    if ((hasStroke || hasFill) && h <= HAIRLINE_MAX_IN && w >= MIN_LINE_LEN_IN) {
      hSegs.push({
        x1: x,
        x2: x + w,
        y: y + h / 2,
        z: e.z ?? 0,
        color: rgbHex(hasStroke ? e.stroke : e.fill),
        widthPt: hasStroke ? (e.lineWidth || 1) : Math.max(0.5, h * 72),
      });
    } else if ((hasStroke || hasFill) && w <= HAIRLINE_MAX_IN && h >= MIN_LINE_LEN_IN) {
      vSegs.push({
        y1: y,
        y2: y + h,
        x: x + w / 2,
        z: e.z ?? 0,
        color: rgbHex(hasStroke ? e.stroke : e.fill),
        widthPt: hasStroke ? (e.lineWidth || 1) : Math.max(0.5, w * 72),
      });
    } else if (hasStroke && w >= MIN_LINE_LEN_IN && h >= MIN_LINE_LEN_IN && isRectPath(lastPath)) {
      const color = rgbHex(e.stroke);
      const widthPt = e.lineWidth || 1;
      const z = e.z ?? 0;
      hSegs.push({ x1: x, x2: x + w, y, z, color, widthPt });
      hSegs.push({ x1: x, x2: x + w, y: y + h, z, color, widthPt });
      vSegs.push({ y1: y, y2: y + h, x, z, color, widthPt });
      vSegs.push({ y1: y, y2: y + h, x: x + w, z, color, widthPt });
    }

    if (hasFill && w > HAIRLINE_MAX_IN && h > HAIRLINE_MAX_IN) {
      fillRects.push({
        rect: e.bbox,
        color: rgbHex(e.fill),
        alpha: e.alphaF ?? 1,
        z: e.z ?? 0,
      });
    }
  }

  return { hSegs, vSegs, fillRects };
}

function groupConnectedRulings(hSegs, vSegs) {
  const total = hSegs.length + vSegs.length;
  if (!total) return [];

  const parent = Array.from({ length: total }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < hSegs.length; i++) {
    const h = hSegs[i];
    for (let j = 0; j < vSegs.length; j++) {
      const v = vSegs[j];
      if (
        v.x >= h.x1 - CONNECT_TOL_IN &&
        v.x <= h.x2 + CONNECT_TOL_IN &&
        h.y >= v.y1 - CONNECT_TOL_IN &&
        h.y <= v.y2 + CONNECT_TOL_IN
      ) {
        unite(i, hSegs.length + j);
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < hSegs.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, { h: [], v: [] });
    groups.get(r).h.push(hSegs[i]);
  }
  for (let j = 0; j < vSegs.length; j++) {
    const r = find(hSegs.length + j);
    if (!groups.has(r)) groups.set(r, { h: [], v: [] });
    groups.get(r).v.push(vSegs[j]);
  }
  return [...groups.values()];
}

function mergeCollinear(segs, axis) {
  const byCoord = new Map();
  for (const s of segs) {
    const key = axis === 'h' ? s.y.toFixed(4) : s.x.toFixed(4);
    if (!byCoord.has(key)) byCoord.set(key, []);
    byCoord.get(key).push({ ...s });
  }

  const out = [];
  for (const list of byCoord.values()) {
    const k1 = axis === 'h' ? 'x1' : 'y1';
    const k2 = axis === 'h' ? 'x2' : 'y2';
    list.sort((a, b) => a[k1] - b[k1]);
    let cur = list[0];
    for (let i = 1; i < list.length; i++) {
      if (list[i][k1] <= cur[k2] + SNAP_IN) {
        cur[k2] = Math.max(cur[k2], list[i][k2]);
        cur.z = Math.min(cur.z, list[i].z);
      } else {
        out.push(cur);
        cur = list[i];
      }
    }
    out.push(cur);
  }
  return out;
}

function buildCellTextAndRuns(cellSpans, cellRect) {
  if (!cellSpans.length) {
    return { text: '', runs: [], align: 'left', valign: 'middle' };
  }

  const sorted = [...cellSpans].sort((a, b) => a.rect.y - b.rect.y);
  const lines = [];
  for (const sp of sorted) {
    const lastLine = lines[lines.length - 1];
    const tolY = Math.max(0.05, (sp.fontSizePt || 10) / 72 * 0.45);
    if (lastLine && Math.abs(sp.rect.y - lastLine[0].rect.y) <= tolY) {
      lastLine.push(sp);
    } else {
      lines.push([sp]);
    }
  }

  const lineStrings = [];
  const runs = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].sort((a, b) => a.rect.x - b.rect.x);
    let lineText = '';
    for (let si = 0; si < line.length; si++) {
      const sp = line[si];
      const prev = line[si - 1];
      const gap = prev ? sp.rect.x - (prev.rect.x + prev.rect.w) : 0;
      const spaceThresh = ((sp.fontSizePt || 10) / 72) * 0.15;
      const sep = prev && gap > spaceThresh && !lineText.endsWith(' ') && !sp.text.startsWith(' ') ? ' ' : '';
      lineText += sep + sp.text;
      runs.push({
        text: (si === 0 && li > 0 ? '\n' : '') + sep + sp.text,
        fontSizePt: sp.fontSizePt || 10,
        color: sp.color || '000000',
        fontName: sp.fontName || '',
        fontFamilyRaw: sp.fontFamilyRaw || '',
        opacity: sp.opacity ?? 1,
        dir: sp.dir || 'ltr',
      });
    }
    lineStrings.push(lineText);
  }

  // Infer horizontal alignment from span positions inside cellRect
  const minX = Math.min(...cellSpans.map((s) => s.rect.x));
  const maxX = Math.max(...cellSpans.map((s) => s.rect.x + s.rect.w));
  const leftPad = minX - cellRect.x;
  const rightPad = cellRect.x + cellRect.w - maxX;
  let align = 'left';
  if (cellRect.w > 0.1 && Math.abs(leftPad - rightPad) < 0.08 && leftPad > 0.06) {
    align = 'center';
  } else if (cellRect.w > 0.1 && rightPad < 0.08 && leftPad > rightPad * 2 + 0.08) {
    align = 'right';
  }

  return {
    text: lineStrings.join('\n'),
    runs,
    align,
    valign: 'middle',
  };
}

function detectLatticeTables(spans, events, fillRects, nextId) {
  const { hSegs, vSegs } = extractRulings(events);
  const groups = groupConnectedRulings(hSegs, vSegs);
  const tables = [];

  for (const g of groups) {
    if (g.h.length < 2 || g.v.length < 2) continue;

    const rawXs = [
      ...g.v.map((s) => s.x),
      ...g.h.flatMap((s) => [s.x1, s.x2]),
    ];
    const rawYs = [
      ...g.h.map((s) => s.y),
      ...g.v.flatMap((s) => [s.y1, s.y2]),
    ];

    const xs = clusterCoords(rawXs, SNAP_IN);
    const ys = clusterCoords(rawYs, SNAP_IN);
    if (xs.length < 3 || ys.length < 3) continue; // need >= 2 cols and >= 2 rows

    const snappedH = mergeCollinear(
      g.h.map((s) => ({
        ...s,
        y: snapTo(s.y, ys),
        x1: snapTo(s.x1, xs),
        x2: snapTo(s.x2, xs),
      })),
      'h'
    );
    const snappedV = mergeCollinear(
      g.v.map((s) => ({
        ...s,
        x: snapTo(s.x, xs),
        y1: snapTo(s.y1, ys),
        y2: snapTo(s.y2, ys),
      })),
      'v'
    );

    const colW = [];
    for (let c = 0; c < xs.length - 1; c++) colW.push(xs[c + 1] - xs[c]);
    const rowH = [];
    for (let r = 0; r < ys.length - 1; r++) rowH.push(ys[r + 1] - ys[r]);

    const R = rowH.length;
    const C = colW.length;
    if (R < 2 || C < 2) continue;

    const findH = (y, x0, x1) => {
      const len = x1 - x0;
      return snappedH.find(
        (s) => Math.abs(s.y - y) <= SNAP_IN && overlap1D(s.x1, s.x2, x0, x1) >= len * 0.5
      );
    };
    const findV = (x, y0, y1) => {
      const len = y1 - y0;
      return snappedV.find(
        (s) => Math.abs(s.x - x) <= SNAP_IN && overlap1D(s.y1, s.y2, y0, y1) >= len * 0.5
      );
    };

    const hasRightBorder = (r, c) => Boolean(findV(xs[c + 1], ys[r], ys[r + 1]));
    const hasBottomBorder = (r, c) => Boolean(findH(ys[r + 1], xs[c], xs[c + 1]));

    const visited = Array.from({ length: R }, () => Array(C).fill(false));
    const tableId = nextId();
    const tableRect = {
      x: xs[0],
      y: ys[0],
      w: xs[C] - xs[0],
      h: ys[R] - ys[0],
    };

    const candidateSpans = spans.filter(
      (sp) => !sp.consumedBy && intersects(tableRect, sp.rect, 0.03)
    );
    const matchedSpans = [];
    const rows = [];

    for (let r = 0; r < R; r++) {
      const rowCells = [];
      for (let c = 0; c < C; c++) {
        if (visited[r][c]) continue;

        let colspan = 1;
        while (c + colspan < C && !visited[r][c + colspan] && !hasRightBorder(r, c + colspan - 1)) {
          colspan++;
        }

        let rowspan = 1;
        while (r + rowspan < R) {
          let canExpand = true;
          for (let dc = 0; dc < colspan; dc++) {
            if (visited[r + rowspan][c + dc] || hasBottomBorder(r + rowspan - 1, c + dc)) {
              canExpand = false;
              break;
            }
            if (dc < colspan - 1 && hasRightBorder(r + rowspan, c + dc)) {
              canExpand = false;
              break;
            }
          }
          if (!canExpand) break;
          rowspan++;
        }

        for (let dr = 0; dr < rowspan; dr++) {
          for (let dc = 0; dc < colspan; dc++) {
            visited[r + dr][c + dc] = true;
          }
        }

        const cellRect = {
          x: xs[c],
          y: ys[r],
          w: xs[c + colspan] - xs[c],
          h: ys[r + rowspan] - ys[r],
        };

        const cellSpans = candidateSpans.filter((sp) => {
          if (sp.consumedBy) return false;
          const cx = sp.rect.x + sp.rect.w / 2;
          const cy = sp.rect.y + sp.rect.h / 2;
          const centerInside =
            cx >= cellRect.x - 0.02 &&
            cx <= cellRect.x + cellRect.w + 0.02 &&
            cy >= cellRect.y - 0.02 &&
            cy <= cellRect.y + cellRect.h + 0.02;
          return centerInside || contains(cellRect, sp.rect, 0.5);
        });

        for (const sp of cellSpans) {
          sp.consumedBy = tableId;
          matchedSpans.push(sp);
        }

        const topB = findH(ys[r], xs[c], xs[c + colspan]);
        const botB = findH(ys[r + rowspan], xs[c], xs[c + colspan]);
        const leftB = findV(xs[c], ys[r], ys[r + rowspan]);
        const rightB = findV(xs[c + colspan], ys[r], ys[r + rowspan]);

        const bg = fillRects.find((f) => contains(f.rect, cellRect, 0.7));
        const { text, runs, align, valign } = buildCellTextAndRuns(cellSpans, cellRect);

        rowCells.push({
          text,
          runs,
          colspan,
          rowspan,
          fill: bg ? bg.color : null,
          align,
          valign,
          borders: {
            top: topB ? { color: topB.color, pt: topB.widthPt } : null,
            bottom: botB ? { color: botB.color, pt: botB.widthPt } : null,
            left: leftB ? { color: leftB.color, pt: leftB.widthPt } : null,
            right: rightB ? { color: rightB.color, pt: rightB.widthPt } : null,
          },
        });
      }
      rows.push({ cells: rowCells });
    }

    if (matchedSpans.length === 0) {
      continue;
    }

    const minZ = Math.min(
      ...g.h.map((s) => s.z),
      ...g.v.map((s) => s.z),
      ...matchedSpans.map((s) => s.z ?? 0)
    );

    tables.push({
      id: tableId,
      z: minZ,
      rect: tableRect,
      colW,
      rowH,
      rows,
    });
  }

  return tables;
}

function groupBaselineRows(spans) {
  const remaining = spans.filter((s) => !s.consumedBy && s.text?.trim());
  if (!remaining.length) return [];

  const sorted = [...remaining].sort((a, b) => {
    const ba = a.rect.y + a.rect.h * 0.82;
    const bb = b.rect.y + b.rect.h * 0.82;
    return ba - bb || a.rect.x - b.rect.x;
  });

  const rows = [];
  for (const sp of sorted) {
    const baseY = sp.rect.y + sp.rect.h * 0.82;
    const tolY = Math.max(0.06, sp.rect.h * 0.45);
    const last = rows[rows.length - 1];
    if (last && Math.abs(baseY - last.baseY) <= tolY) {
      last.spans.push(sp);
    } else {
      rows.push({ baseY, spans: [sp] });
    }
  }

  for (const r of rows) {
    r.spans.sort((a, b) => a.rect.x - b.rect.x);
    r.yMin = Math.min(...r.spans.map((s) => s.rect.y));
    r.yMax = Math.max(...r.spans.map((s) => s.rect.y + s.rect.h));
    // Merge horizontally adjacent spans within the same cell
    const segs = [];
    for (const sp of r.spans) {
      const lastSeg = segs[segs.length - 1];
      const fontSizeIn = (sp.fontSizePt || 10) / 72;
      const maxGap = Math.max(0.08, fontSizeIn * 1.1);
      if (lastSeg && sp.rect.x - lastSeg.x1 <= maxGap) {
        lastSeg.x1 = Math.max(lastSeg.x1, sp.rect.x + sp.rect.w);
        lastSeg.spans.push(sp);
      } else {
        segs.push({
          x0: sp.rect.x,
          x1: sp.rect.x + sp.rect.w,
          spans: [sp],
        });
      }
    }
    r.segs = segs;
  }

  return rows;
}

function projectColumns(bandRows) {
  const intervals = [];
  for (const r of bandRows) {
    for (const seg of r.segs) {
      intervals.push([seg.x0, seg.x1]);
    }
  }
  if (!intervals.length) return null;

  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [intervals[0].slice()];
  for (let i = 1; i < intervals.length; i++) {
    const cur = merged[merged.length - 1];
    if (intervals[i][0] <= cur[1] + MIN_GUTTER_IN) {
      cur[1] = Math.max(cur[1], intervals[i][1]);
    } else {
      merged.push(intervals[i].slice());
    }
  }

  // Gutters are gaps between merged intervals
  const gutters = [];
  for (let i = 0; i < merged.length - 1; i++) {
    gutters.push([merged[i][1], merged[i + 1][0]]);
  }
  return { colIntervals: merged, gutters };
}

function isProseBand(bandRows, colIntervals, pageColumns) {
  let totalChars = 0;
  let totalWords = 0;
  let cellCount = 0;

  for (const r of bandRows) {
    for (const seg of r.segs) {
      const txt = seg.spans.map((s) => s.text).join(' ').trim();
      if (!txt) continue;
      totalChars += txt.length;
      totalWords += txt.split(/\s+/).length;
      cellCount++;
    }
  }

  if (cellCount === 0) return true;
  const avgChars = totalChars / cellCount;
  const avgWords = totalWords / cellCount;

  if (avgChars > 45 || avgWords > 7) return true;

  // If page-level multi-column prose layout matches these column intervals
  if (pageColumns?.length >= 2 && avgChars > 28) {
    const matchesPageCols = colIntervals.every(([x0, x1]) =>
      pageColumns.some((pc) => {
        const px0 = pc.x ?? pc[0] ?? 0;
        const px1 = pc.w != null ? px0 + pc.w : (pc[1] ?? px0);
        return overlap1D(x0, x1, px0, px1) > (x1 - x0) * 0.6;
      })
    );
    if (matchesPageCols) return true;
  }

  return false;
}

function detectStreamTables(spans, pageColumns, nextId) {
  const rows = groupBaselineRows(spans);
  if (rows.length < 3) return [];

  // Compute median vertical step between consecutive rows
  const steps = [];
  for (let i = 1; i < rows.length; i++) {
    steps.push(Math.max(0.05, rows[i].baseY - rows[i - 1].baseY));
  }
  const sortedSteps = [...steps].sort((a, b) => a - b);
  const medianStep = sortedSteps[Math.floor(sortedSteps.length / 2)] || 0.22;
  const splitGap = Math.max(0.45, medianStep * 2.8);

  // Partition into contiguous vertical bands
  const bands = [[rows[0]]];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].baseY - rows[i - 1].baseY > splitGap) {
      bands.push([rows[i]]);
    } else {
      bands[bands.length - 1].push(rows[i]);
    }
  }

  const tables = [];

  for (const band of bands) {
    if (band.length < 3) continue;

    const proj = projectColumns(band);
    if (!proj || proj.gutters.length < 2) continue; // require >= 2 whitespace gutters (>= 3 cols)

    const { colIntervals } = proj;
    const K = colIntervals.length;

    let stableCount = 0;
    for (const r of band) {
      let hitCols = 0;
      for (const [cx0, cx1] of colIntervals) {
        if (r.segs.some((seg) => overlap1D(seg.x0, seg.x1, cx0, cx1) > 0)) {
          hitCols++;
        }
      }
      if (hitCols === K) stableCount++;
    }

    if (stableCount / band.length < 0.8) continue;
    if (isProseBand(band, colIntervals, pageColumns)) continue;

    const tableId = nextId();
    const xMin = colIntervals[0][0];
    const xMax = colIntervals[K - 1][1];
    const yMin = band[0].yMin;
    const yMax = band[band.length - 1].yMax;

    // Column boundaries placed at gutter midpoints
    const xs = [xMin];
    for (const [g0, g1] of proj.gutters) {
      xs.push((g0 + g1) / 2);
    }
    xs.push(xMax);

    const ys = [yMin];
    for (let i = 0; i < band.length - 1; i++) {
      ys.push((band[i].yMax + band[i + 1].yMin) / 2);
    }
    ys.push(yMax);

    const colW = [];
    for (let c = 0; c < K; c++) colW.push(xs[c + 1] - xs[c]);
    const rowH = [];
    for (let r = 0; r < band.length; r++) rowH.push(ys[r + 1] - ys[r]);

    const tableRows = [];
    const allSpans = [];

    for (let r = 0; r < band.length; r++) {
      const rowCells = [];
      for (let c = 0; c < K; c++) {
        const cellRect = { x: xs[c], y: ys[r], w: colW[c], h: rowH[r] };
        const cellSpans = [];
        for (const seg of band[r].segs) {
          if (overlap1D(seg.x0, seg.x1, xs[c], xs[c + 1]) > 0) {
            for (const sp of seg.spans) {
              if (!sp.consumedBy) {
                sp.consumedBy = tableId;
                cellSpans.push(sp);
                allSpans.push(sp);
              }
            }
          }
        }
        const { text, runs, align, valign } = buildCellTextAndRuns(cellSpans, cellRect);
        rowCells.push({
          text,
          runs,
          colspan: 1,
          rowspan: 1,
          fill: null,
          align,
          valign,
          borders: { top: null, bottom: null, left: null, right: null },
        });
      }
      tableRows.push({ cells: rowCells });
    }

    tables.push({
      id: tableId,
      z: Math.min(...allSpans.map((s) => s.z ?? 0)),
      rect: { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin },
      colW,
      rowH,
      rows: tableRows,
    });
  }

  return tables;
}

/**
 * Detects lattice (ruled) and stream (borderless) tables on a page,
 * tagging all spans inside detected tables with `span.consumedBy = tableId`.
 *
 * @param {Array<object>} spans - StyledTextSpan[] from extractStyledSpans()
 * @param {Array<object>} events - RawDrawEvent[] from walkOperators()
 * @param {object} [opts]
 * @param {object} [opts.pageRect]
 * @param {Array<object>} [opts.columns] - Optional detected multi-column prose regions
 * @returns {Array<object>} TableNode[]
 */
export function detectTables(spans = [], events = [], { pageRect = null, columns = [] } = {}) {
  let seq = 0;
  const nextId = () => `tbl_${++seq}`;

  const { fillRects } = extractRulings(events);
  const lattice = detectLatticeTables(spans, events, fillRects, nextId);
  const stream = detectStreamTables(spans, columns, nextId);

  return [...lattice, ...stream].sort((a, b) => a.z - b.z);
}
