/** Ruled table reconstruction: segment mesh → connected components → grid → gridSpan/vMerge. */
const TOL = 1.5, SNAP = 2.0, EDGE = 3.0;

function pushSeg(out, x0, y0, x1, y1, w, color) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  if (dy <= TOL && dx >= 3) out.push({ dir: 'h', a: Math.min(x0, x1), b: Math.max(x0, x1), p: (y0 + y1) / 2, w: w || 0.6, color });
  else if (dx <= TOL && dy >= 3) out.push({ dir: 'v', a: Math.min(y0, y1), b: Math.max(y0, y1), p: (x0 + x1) / 2, w: w || 0.6, color });
}
export function extractSegments(vector) {
  const out = [];
  for (const l of vector?.lines || []) pushSeg(out, l.x1, l.y1, l.x2, l.y2, l.lineWidth, l.stroke);
  for (const r of vector?.rects || []) {
    if (Math.min(r.w, r.h) < TOL && Math.max(r.w, r.h) >= 3) {
      pushSeg(out, r.x, r.y, r.x + r.w, r.y + r.h, Math.min(r.w, r.h), r.stroke || r.fill); continue;
    }
    if (!r.stroke) continue;                       // pure fills are backgrounds, not borders
    pushSeg(out, r.x, r.y, r.x + r.w, r.y, r.lineWidth, r.stroke);
    pushSeg(out, r.x, r.y + r.h, r.x + r.w, r.y + r.h, r.lineWidth, r.stroke);
    pushSeg(out, r.x, r.y, r.x, r.y + r.h, r.lineWidth, r.stroke);
    pushSeg(out, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.lineWidth, r.stroke);
  }
  const merged = [];
  for (const dir of ['h', 'v']) {
    const list = out.filter(s => s.dir === dir).sort((a, b) => a.p - b.p || a.a - b.a);
    for (const s of list) {
      const last = merged[merged.length - 1];
      if (last && last.dir === dir && Math.abs(last.p - s.p) <= TOL && s.a <= last.b + TOL) {
        last.b = Math.max(last.b, s.b); last.p = (last.p + s.p) / 2;
      } else merged.push({ ...s });
    }
  }
  return merged;
}
function components(segs) {
  const parent = new Map(segs.map(s => [s, s]));
  const find = s => { let r = s; while (parent.get(r) !== r) r = parent.get(r); let c = s; while (parent.get(c) !== c) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
  const H = segs.filter(s => s.dir === 'h'), V = segs.filter(s => s.dir === 'v');
  for (const h of H) for (const v of V)
    if (v.p >= h.a - SNAP && v.p <= h.b + SNAP && h.p >= v.a - SNAP && h.p <= v.b + SNAP)
      parent.set(find(h), find(v));
  const groups = new Map();
  for (const s of segs) { const r = find(s); (groups.get(r) || groups.set(r, []).get(r)).push(s); }
  return [...groups.values()].filter(g => {
    const nh = g.filter(s => s.dir === 'h').length, nv = g.filter(s => s.dir === 'v').length;
    return nh >= 2 && nv >= 2 && !(nh === 2 && nv === 2);   // reject 1×1 callout boxes
  });
}
function cluster(vals, tol) {
  const s = [...vals].sort((a, b) => a - b), out = [];
  for (const v of s) {
    if (out.length && Math.abs(v - out[out.length - 1].v) <= tol) {
      const c = out[out.length - 1]; c.v = (c.v * c.n + v) / (c.n + 1); c.n++;
    } else out.push({ v, n: 1 });
  }
  return out.map(c => c.v);
}
const hasV = (segs, x, yTop, yBot) => segs.some(s => s.dir === 'v' && Math.abs(s.p - x) <= EDGE && s.a <= yBot + EDGE && s.b >= yTop - EDGE);
const hasH = (segs, y, x0, x1) => segs.some(s => s.dir === 'h' && Math.abs(s.p - y) <= EDGE && s.a <= x0 + EDGE && s.b >= x1 - EDGE);

/** @returns {{block:object, indices:Set<number>, firstIndex:number}[]} */
export function detectRuledTables(lines, vector) {
  const segs = extractSegments(vector);
  if (segs.length < 4) return [];
  const results = [];
  for (const group of components(segs)) {
    const X = cluster(group.filter(s => s.dir === 'v').map(s => s.p), SNAP).sort((a, b) => a - b);
    const Y = cluster(group.filter(s => s.dir === 'h').map(s => s.p), SNAP).sort((a, b) => b - a); // top→bottom
    const nC = X.length - 1, nR = Y.length - 1;
    if (nC < 1 || nR < 1) continue;

    const occ = new Map();       // "r:c" → {span, start}
    const rows = [];
    const indices = new Set();
    for (let r = 0; r < nR; r++) {
      const yTop = Y[r], yBot = Y[r + 1];
      const cells = [];
      let c = 0;
      while (c < nC) {
        const o = occ.get(`${r}:${c}`);
        if (o) {                                     // vertical continuation of a rowSpan
          cells.push({ text: '', columnSpan: o.span, vMerge: 'continue', fontSize: 10 });
          c += o.span; continue;
        }
        let c2 = c + 1;
        while (c2 < nC && !hasV(group, X[c2], yTop, yBot)) c2++;      // missing internal border → colSpan
        let r2 = r + 1;
        while (r2 < nR && !hasH(group, Y[r2], X[c], X[c2])) r2++;     // missing bottom border → rowSpan
        const span = c2 - c;
        if (r2 - r > 1) for (let rr = r + 1; rr < r2; rr++) for (let cc = c; cc < c2; cc++) occ.set(`${rr}:${cc}`, { span, start: c });

        const box = { x0: X[c], x1: X[c2], yTop, yBot: Y[r2] };
        const inside = [];
        lines.forEach((l, i) => {
          const cx = (l.x + (l.xEnd ?? l.x + (l.w || 0))) / 2, cy = l.y;
          if (cx >= box.x0 - 1 && cx <= box.x1 + 1 && cy <= box.yTop + 2 && cy >= box.yBot - 2) { inside.push({ l, i }); }
        });
        inside.sort((a, b) => b.l.y - a.l.y);
        inside.forEach(o2 => indices.add(o2.i));
        const text = inside.map(o2 => o2.l.text).join(' ').trim();
        const fill = (vector?.rects || []).find(fr => fr.fill && fr.fill !== 'FFFFFF' &&
          fr.x <= box.x0 + 4 && fr.x + fr.w >= box.x1 - 4 &&
          fr.y <= box.yBot + 4 && fr.y + fr.h >= box.yTop - 4);
        cells.push({
          text, columnSpan: span,
          vMerge: r2 - r > 1 ? 'restart' : undefined,
          isHeader: r === 0, bold: r === 0,
          align: /^[(+\-€$£¥]?[\d,.]+[)%]?$/.test(text) ? 'right' : 'left',
          fontSize: inside[0]?.l.size || 10,
          fill: fill?.fill || undefined,
        });
        c = c2;
      }
      rows.push({ isHeader: r === 0, cells });
    }
    if (!indices.size) continue;
    const total = X[X.length - 1] - X[0];
    results.push({
      block: {
        type: 'table', numCols: nC, rows, ruled: true,
        colWidths: Array.from({ length: nC }, (_, i) => Math.max(3, Math.round(((X[i + 1] - X[i]) / total) * 100))),
        y: Y[0], yMin: Y[Y.length - 1], yMax: Y[0],
        theme: { fromVector: true, bg: rows[0]?.cells.find(c => c.fill)?.fill || 'E7E9EE', border: group[0]?.color || 'A6A6A6' },
      },
      indices, firstIndex: Math.min(...indices),
    });
  }
  return results.sort((a, b) => a.firstIndex - b.firstIndex);
}

/** Ruled-first wrapper: legacy gap detector only sees lines the mesh didn't claim. */
export function detectTableRegionsHybrid(lines, pageWidth, vector, legacyDetect) {
  const ruled = detectRuledTables(lines, vector);
  if (!ruled.length) return legacyDetect(lines, pageWidth, vector);
  const byFirst = new Map(ruled.map(r => [r.firstIndex, r]));
  const consumed = new Set(); ruled.forEach(r => r.indices.forEach(i => consumed.add(i)));
  const out = []; let i = 0;
  while (i < lines.length) {
    const r = byFirst.get(i);
    if (r) { out.push(r.block); i = Math.max(...r.indices) + 1; continue; }
    if (consumed.has(i)) { i++; continue; }
    let j = i; while (j < lines.length && !consumed.has(j) && !byFirst.has(j)) j++;
    out.push(...legacyDetect(lines.slice(i, j), pageWidth, vector));
    i = j;
  }
  return out;
}
