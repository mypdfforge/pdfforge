/**
 * pdfXyCut.js — recursive XY-cut reading order for the robust pipeline.
 * Dependency-free. Lines use the segmenter's bottom-up y; converted internally.
 * makeSubLine(parentLine, items) is injected so span construction stays in the segmenter.
 */
const MAX_DEPTH = 12;

function toBox(line, pageH) {
  const h = line.size || 10;
  const y1 = pageH - (line.y ?? 0);
  return { x0: line.x, x1: line.xEnd ?? line.x + (line.w || 0), y0: y1 - h, y1, line };
}
const width = (b) => b.x1 - b.x0;
function bounds(bs) {
  return { x0: Math.min(...bs.map(b => b.x0)), x1: Math.max(...bs.map(b => b.x1)),
           y0: Math.min(...bs.map(b => b.y0)), y1: Math.max(...bs.map(b => b.y1)) };
}
/** Split a line's items into column segments at wide internal gaps. */
function segmentLine(line) {
  const items = [...(line.items || [])].sort((a, b) => a.x - b.x);
  if (items.length < 2) return [items];
  const thr = Math.max(12, 1.2 * (line.size || 10));
  const groups = [[items[0]]];
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    if (items[i].x - (prev.x + (prev.w || 0)) >= thr) groups.push([items[i]]);
    else groups[groups.length - 1].push(items[i]);
  }
  return groups;
}
function hCut(bs, medH) {
  const s = [...bs].sort((a, b) => a.y0 - b.y0);
  let run = s[0].y1, best = 0, bestGap = 0;
  for (let i = 0; i < s.length - 1; i++) {
    run = Math.max(run, s[i].y1);
    const gap = s[i + 1].y0 - run;
    if (gap >= Math.max(medH, 6) && gap > bestGap) { bestGap = gap; best = i + 1; }
  }
  return best ? [s.slice(0, best), s.slice(best)] : null;
}
function vCut(bs, minGutter = 10, minSide = 3, minRatio = 0.2) {
  const B = bounds(bs);
  if (B.x1 - B.x0 < 100) return null;
  const s = [...bs].sort((a, b) => a.x0 - b.x0);
  let best = 0, bestGap = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const lmax = Math.max(...s.slice(0, i + 1).map(b => b.x1));
    const rmin = Math.min(...s.slice(i + 1).map(b => b.x0));
    const g = rmin - lmax, L = i + 1, R = s.length - L;
    if (g >= minGutter && g > bestGap &&
        (L >= minSide || L / s.length >= minRatio) &&
        (R >= minSide || R / s.length >= minRatio)) { bestGap = g; best = i + 1; }
  }
  if (!best) return null;
  return [s.slice(0, best).sort((a, b) => a.y0 - b.y0), s.slice(best).sort((a, b) => a.y0 - b.y0)];
}
function spanning(bs) {
  const B = bounds(bs), W = B.x1 - B.x0;
  if (W < 200 || bs.length < 5) return null;
  const sp = bs.filter(b => width(b) >= 0.75 * W);
  const ot = bs.filter(b => width(b) < 0.75 * W);
  if (!sp.length || !ot.length || ot.length < 3) return null;
  const sy0 = Math.min(...sp.map(b => b.y0)), sy1 = Math.max(...sp.map(b => b.y1));
  const before = ot.filter(b => b.y1 <= sy0), after = ot.filter(b => b.y0 >= sy1);
  if (before.length + after.length + sp.length !== bs.length) return null;
  return { before, sp, after };
}
/** Safety net: aligned short cells across >=3 rows ⇒ table, never column-cut it. */
export function looksLikeTableBand(segs, rowCount) {
  if (rowCount < 3 || segs.length < 6) return false;
  const starts = segs.map(s => s.x0).sort((a, b) => a - b);
  const cols = [];
  for (const x of starts) {
    if (!cols.length || x - cols[cols.length - 1][cols[cols.length - 1].length - 1] > 8) cols.push([x]);
    else cols[cols.length - 1].push(x);
  }
  const words = segs.reduce((a, s) => a + String(s.text || '').trim().split(/\s+/).filter(Boolean).length, 0) / segs.length;
  return cols.length <= 8 && words <= 3.5;
}
function cut(bs, medH, depth) {
  if (bs.length <= 1 || depth > MAX_DEPTH) return [...bs].sort((a, b) => a.y0 - b.y0);
  const h = hCut(bs, medH);
  if (h) return [...cut(h[0], medH, depth + 1), ...cut(h[1], medH, depth + 1)];
  const sp = spanning(bs);
  if (sp) {
    const out = [];
    if (sp.before.length) out.push(...cut(sp.before, medH, depth + 1));
    out.push(...cut(sp.sp, medH, depth + 1));
    if (sp.after.length) out.push(...cut(sp.after, medH, depth + 1));
    return out;
  }
  const v = vCut(bs);
  if (v) return [...cut(v[0], medH, depth + 1), ...cut(v[1], medH, depth + 1)];
  return [...bs].sort((a, b) => a.y0 - b.y0);
}
/** @returns lines in reading order; unsplit lines are returned by identity. */
export function reorderLinesByColumns(lines, { pageWidth, pageHeight, makeSubLine }) {
  if (!lines || lines.length < 4) return lines || [];
  const groups = [], owner = new Map();
  for (const l of lines) {
    const parts = segmentLine(l);
    for (const items of parts) {
      const g = { items, parent: l, x0: Math.min(...items.map(i => i.x)),
                  x1: Math.max(...items.map(i => i.x + (i.w || 0))),
                  text: items.map(i => i.str).join(' ') };
      groups.push(g); owner.set(g, l);
    }
  }
  if (groups.length === lines.length) return lines;            // nothing split → no columns
  const boxes = groups.map(g => {
    const b = toBox(owner.get(g), pageHeight);
    return { ...b, x0: g.x0, x1: g.x1, g };
  });
  if (looksLikeTableBand(groups, lines.length)) return lines;  // table guard
  const medH = [...lines].map(l => l.size || 10).sort((a, b) => a - b)[Math.floor(lines.length / 2)] || 12;
  const ordered = cut(boxes, medH, 0);
  const out = [];
  for (const b of ordered) {
    const parent = owner.get(b.g);
    out.push(b.g.items.length === (parent.items || []).length ? parent : makeSubLine(parent, b.g.items));
  }
  return out;
}
