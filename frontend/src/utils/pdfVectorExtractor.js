/**
 * pdfVectorExtractor.js — vector geometry in the SAME space as extractPageLayout text:
 * unrotated user space, CropBox-relative, bottom-up y, points.
 * Fixes: missing CTM, Form XObject transforms, CropBox offset, gray/CMYK colours,
 * ExtGState alpha, closePath, 4-line rect closure, version-safe OPS codes.
 */
const IDENT = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1],
  m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3],
  m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5],
];
const apply = (m, x, y) => ({ x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] });
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
function rgbHex(r, g, b) {
  const scale = Math.max(r, g, b) <= 1 ? 255 : 1;      // pdf.js emits 0–255; tolerate 0–1
  const h = (v) => clamp255(v * scale).toString(16).padStart(2, '0');
  return `${h(r)}${h(g)}${h(b)}`.toUpperCase();
}
const cmykHex = (c, m, y, k) => rgbHex(255*(1-c)*(1-k), 255*(1-m)*(1-k), 255*(1-y)*(1-k));

const DEFAULT_OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  setLineWidth: 18,
  fill: 30,
  eoFill: 31,
  stroke: 32,
  fillStroke: 33,
  closeStroke: 34,
  closeFillStroke: 35,
  setFillGray: 36,
  setStrokeGray: 37,
  setFillRGBColor: 38,
  setStrokeRGBColor: 39,
  setFillCMYKColor: 40,
  setStrokeCMYKColor: 41,
  setGState: 42,
  paintFormXObjectBegin: 80,
  paintFormXObjectEnd: 81,
  constructPath: 91,
};

export async function extractVectorGeometry(page, opsOverride) {
  const empty = { rects: [], lines: [], fills: new Set(), space: null };
  if (!page?.getOperatorList) return empty;
  const OPS = opsOverride || globalThis.pdfjsLib?.OPS || DEFAULT_OPS;
  const opList = await page.getOperatorList();
  const [vx0, vy0, vx1, vy1] = page.view || [0, 0, 595.28, 841.89];
  const space = { width: vx1 - vx0, height: vy1 - vy0, rotation: page.rotate || 0 };

  const rects = [], lines = [], fills = new Set();
  let ctm = IDENT.slice(), stack = [];
  let fill = null, stroke = null, lineWidth = 1, fillAlpha = 1;
  let pathRects = [], pathLines = [], cur = { x: 0, y: 0 }, start = { x: 0, y: 0 };

  // user space → CropBox-relative bottom-up
  const P = (x, y) => { const p = apply(ctm, x, y); return { x: p.x - vx0, y: p.y - vy0 }; };
  const emitRect = (x, y, w, h, doFill, doStroke) => {
    const a = P(x, y), b = P(x + w, y + h);
    const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
                w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
                fill: doFill ? fill : null, stroke: doStroke ? stroke : null,
                lineWidth, alpha: fillAlpha };
    if (r.w < 0.2 || r.h < 0.2) return;
    rects.push(r);
    if (doFill && fill) fills.add(fill);
    // hairline fills are borders, not backgrounds
    if (Math.min(r.w, r.h) < 1.5 && Math.max(r.w, r.h) >= 3) {
      const horiz = r.w >= r.h;
      lines.push({ x1: r.x, y1: horiz ? r.y + r.h/2 : r.x + r.w/2,
                   x2: horiz ? r.x + r.w : r.x + r.w/2, y2: horiz ? r.y + r.h/2 : r.y + r.h,
                   isHorizontal: horiz, isVertical: !horiz,
                   stroke: r.stroke || r.fill, lineWidth: Math.min(r.w, r.h) });
    }
  };
  const emitLine = (x0, y0, x1, y1) => {
    const a = P(x0, y0), b = P(x1, y1);
    const isH = Math.abs(a.y - b.y) < 0.75, isV = Math.abs(a.x - b.x) < 0.75;
    if (!isH && !isV) return;
    lines.push({ x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y),
                 x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y),
                 isHorizontal: isH, isVertical: isV, stroke, lineWidth });
  };
  const paintLines = () => {
    if (pathLines.length === 4) {                       // closed axis-aligned loop → one rect
      const xs = pathLines.flatMap(l => [l.x0, l.x1]), ys = pathLines.flatMap(l => [l.y0, l.y1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const onEdge = pathLines.every(l =>
        (Math.abs(l.y0 - l.y1) < 0.75 && (Math.abs(l.y0 - minY) < 0.75 || Math.abs(l.y0 - maxY) < 0.75)) ||
        (Math.abs(l.x0 - l.x1) < 0.75 && (Math.abs(l.x0 - minX) < 0.75 || Math.abs(l.x0 - maxX) < 0.75)));
      if (onEdge && maxX - minX > 1 && maxY - minY > 1) {
        const saved = stroke; stroke = stroke || fill;
        emitRect(minX, minY, maxX - minX, maxY - minY, false, true);
        stroke = saved; pathLines = []; return;
      }
    }
    for (const l of pathLines) emitLine(l.x0, l.y0, l.x1, l.y1);
    pathLines = [];
  };
  const clear = () => { pathRects = []; pathLines = []; };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i], a = opList.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || IDENT.slice();
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (Array.isArray(a?.[0])) ctm = mul(ctm, a[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || IDENT.slice();
    else if (fn === OPS.setLineWidth) lineWidth = Math.max(0.1, a[0] || 1);
    else if (fn === OPS.setFillRGBColor) { fill = rgbHex(a[0], a[1], a[2]); fills.add(fill); }
    else if (fn === OPS.setStrokeRGBColor) stroke = rgbHex(a[0], a[1], a[2]);
    else if (fn === OPS.setFillGray) { fill = rgbHex(a[0], a[0], a[0]); fills.add(fill); }
    else if (fn === OPS.setStrokeGray) stroke = rgbHex(a[0], a[0], a[0]);
    else if (fn === OPS.setFillCMYKColor) { fill = cmykHex(a[0], a[1], a[2], a[3]); fills.add(fill); }
    else if (fn === OPS.setStrokeCMYKColor) stroke = cmykHex(a[0], a[1], a[2], a[3]);
    else if (fn === OPS.setGState) {
      const pairs = Array.isArray(a?.[0]) ? a[0] : Object.entries(a?.[0] || {});
      for (const [k, v] of pairs) { if (k === 'ca') fillAlpha = v; else if (k === 'LW') lineWidth = v; }
    }
    else if (fn === OPS.constructPath) {
      clear();
      const ops = a[0] || [], co = a[1] || []; let k = 0;
      for (const op of ops) {
        if (op === 19) { const x = co[k++], y = co[k++], w = co[k++], h = co[k++]; pathRects.push({ x, y, w, h }); cur = { x, y }; start = { ...cur }; }
        else if (op === 13) { cur = { x: co[k++], y: co[k++] }; start = { ...cur }; }
        else if (op === 14) { const nx = co[k++], ny = co[k++]; pathLines.push({ x0: cur.x, y0: cur.y, x1: nx, y1: ny }); cur = { x: nx, y: ny }; }
        else if (op === 18) { pathLines.push({ x0: cur.x, y0: cur.y, x1: start.x, y1: start.y }); cur = { ...start }; }
        else if (op === 15) k += 6;
        else if (op === 16 || op === 17) k += 4;
      }
    }
    else if (fn === OPS.stroke || fn === OPS.closeStroke) { for (const r of pathRects) emitRect(r.x, r.y, r.w, r.h, false, true); paintLines(); clear(); }
    else if (fn === OPS.fill || fn === OPS.eoFill) { for (const r of pathRects) emitRect(r.x, r.y, r.w, r.h, true, false); clear(); }
    else if (fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) {
      for (const r of pathRects) emitRect(r.x, r.y, r.w, r.h, true, true); paintLines(); clear();
    }
  }
  return { rects, lines, fills, space };
}

/** Header/zebra theme. Direction-agnostic: "top" = largest y in bottom-up space. */
export function getVectorTableStyling(rects, lines, tableBBox) {
  if (!rects?.length || !tableBBox) return { headerBg: null, zebraBg: null, borderColor: null };
  const { minX, maxX, minY, maxY } = tableBBox;
  const inside = rects.filter(r => r.fill && r.fill !== 'FFFFFF' &&
    r.x >= minX - 10 && r.x + r.w <= maxX + 10 && r.y >= minY - 10 && r.y + r.h <= maxY + 10);
  inside.sort((a, b) => b.y - a.y);
  const headerRect = inside.find(r => r.y >= maxY - 40 && r.w >= 0.5 * (maxX - minX));
  const zebraRect = inside.find(r => r !== headerRect && r.fill !== headerRect?.fill);
  const bl = (lines || []).filter(l => l.stroke && l.x1 >= minX - 10 && l.x2 <= maxX + 10 && l.y1 >= minY - 10 && l.y2 <= maxY + 10);
  return { headerBg: headerRect?.fill || null, zebraBg: zebraRect?.fill || null, borderColor: bl[0]?.stroke || null };
}
