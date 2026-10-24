// pdfToExcel.js — client-side PDF -> styled XLSX (pdf.js 3.x + ExcelJS)
// Public API (unchanged): pdfToExcel(file, onProgress, options) -> { data: Blob }
// options: { singleSheet=false, dropRedacted=true }

const CFG = {
  SNAP: 3,          // pt: merge ruling lines closer than this
  MIN_LINE: 8,      // pt: ignore shorter segments
  THIN: 2.5,        // pt: filled rect thinner than this is a line
  COVER: 0.8,       // fraction of a cell edge that must be ruled to count as a border
  FILL_MIN: 0.35,   // fraction of a cell a filled rect must cover to colour it
  WORD_GAP: 0.15,   // x font size: gap that inserts a space between fragments
  SEG_GAP: 2.5,     // x font size: gap that splits a free-text line into segments
  SOFT_WRAP: 0.75,  // line filling >= this much of its cell = soft-wrapped paragraph line
  REDACT_COVER: 0.5,// text covered this much by a dark rect is treated as redacted
  REDACT_LUM: 0.2,  // "dark" threshold (0..1)
  MAX_LINES: 4000,  // above this, skip lattice detection (drawings / hatching)
}

let _pdfjs = null
export const setPdfjs = (lib) => { _pdfjs = lib }
const pdfjs = () => _pdfjs || globalThis.pdfjsLib || (typeof window !== 'undefined' && window.pdfjsLib)

// ───────────────────────── 1. EXTRACT ─────────────────────────
function deduplicateOverlappingText(items) {
  // If a later item covers an earlier item at the same spot (whiteout/correction edit), drop earlier
  const kept = []
  for (let i = 0; i < items.length; i++) {
    const a = items[i]
    let covered = false
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j]
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.bot, b.bot) - Math.max(a.top, b.top)
      const aArea = Math.max(a.w, 1) * Math.max(a.bot - a.top, 1)
      if (ox > 0 && oy > 0 && (ox * oy) / aArea >= 0.5) {
        covered = true
        break
      }
    }
    if (!covered) kept.push(a)
  }
  return kept
}

async function extractPage(page, boldFonts) {
  const { OPS, Util } = pdfjs()
  const vp = page.getViewport({ scale: 1 })
  const [tc, ol] = await Promise.all([page.getTextContent(), page.getOperatorList()])

  const fontCache = {}
  const fontOf = (name) => {
    if (fontCache[name]) return fontCache[name]
    let n = ''
    try { n = page.commonObjs.get(name)?.name || '' } catch { /* not resolved */ }
    n = n || tc.styles[name]?.fontFamily || ''
    let loaded = ''
    try { loaded = page.commonObjs.get(name)?.loadedName || '' } catch {}
    const isBold = (boldFonts && (boldFonts.has(n) || boldFonts.has(loaded) || boldFonts.has(name))) ||
                   /bold|black|heavy|semibold|demi/i.test(n) || /bold|black|heavy|semibold|demi/i.test(loaded) ||
                   page.commonObjs.get(name)?.bold === true
    const isItalic = /italic|oblique/i.test(n) || /italic|oblique/i.test(loaded) || page.commonObjs.get(name)?.italic === true
    return (fontCache[name] = {
      bold: isBold,
      italic: isItalic,
      name: n,
    })
  }

  const rawItems = []
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue
    const m = Util.transform(vp.transform, it.transform)
    const size = Math.hypot(m[2], m[3]) || 8
    const f = fontOf(it.fontName)
    rawItems.push({
      str: it.str, x: m[4], w: it.width * vp.scale, base: m[5], size,
      top: m[5] - size * 0.8, bot: m[5] + size * 0.2,
      bold: f.bold, italic: f.italic, font: f.name,
    })
  }

  const items = deduplicateOverlappingText(rawItems)

  const hLines = [], vLines = [], rects = []
  let ctm = [1, 0, 0, 1, 0, 0], fill = [0, 0, 0], stroke = [0, 0, 0], lw = 1
  const stack = []
  let pending = null
  let order = 0

  const commit = (doFill, doStroke) => {
    if (!pending) return
    const M = Util.transform(vp.transform, pending.ctm)
    const sc = Math.hypot(M[0], M[1]) || 1
    const P = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]
    const thick = lw * sc
    const curFill = fill, curStroke = stroke
    const addLine = (a, b, t, col) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < CFG.MIN_LINE) return
      if (Math.abs(a[0] - b[0]) < 1.5) vLines.push({ x: (a[0] + b[0]) / 2, y1: Math.min(a[1], b[1]), y2: Math.max(a[1], b[1]), t, col })
      else if (Math.abs(a[1] - b[1]) < 1.5) hLines.push({ y: (a[1] + b[1]) / 2, x1: Math.min(a[0], b[0]), x2: Math.max(a[0], b[0]), t, col })
    }
    for (const r of pending.rects) {
      const p = P(r[0], r[1]), q = P(r[0] + r[2], r[1] + r[3])
      const x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]), y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1])
      const w = x1 - x0, h = y1 - y0
      if (doFill) {
        if (Math.min(w, h) <= CFG.THIN && Math.max(w, h) >= CFG.MIN_LINE) {
          if (w >= h) addLine([x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2], Math.max(h, 0.5), curFill)
          else addLine([(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], Math.max(w, 0.5), curFill)
        } else if (w > 1 && h > 1) rects.push({ x0, y0, x1, y1, col: curFill, order: order++ })
      }
      if (doStroke) {
        addLine([x0, y0], [x1, y0], thick, curStroke); addLine([x0, y1], [x1, y1], thick, curStroke)
        addLine([x0, y0], [x0, y1], thick, curStroke); addLine([x1, y0], [x1, y1], thick, curStroke)
      }
    }
    if (doStroke) for (const s of pending.segs) addLine(P(s[0], s[1]), P(s[2], s[3]), thick, curStroke)
    pending = null
  }

  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], a = ol.argsArray[i]
    switch (fn) {
      case OPS.save: stack.push({ ctm: [...ctm], fill: [...fill], stroke: [...stroke], lw }); break
      case OPS.restore: if (stack.length) ({ ctm, fill, stroke, lw } = stack.pop()); break
      case OPS.transform: ctm = Util.transform(ctm, a); break
      case OPS.setLineWidth: lw = a[0]; break
      case OPS.setFillRGBColor: fill = [a[0], a[1], a[2]]; break
      case OPS.setStrokeRGBColor: stroke = [a[0], a[1], a[2]]; break
      case OPS.constructPath: {
        const [ops, pts] = a
        const segs = [], rs = []
        let k = 0, cur = [0, 0], start = [0, 0]
        let subpath = []
        for (const op of ops) {
          if (op === OPS.moveTo) {
            cur = start = [pts[k], pts[k + 1]]
            subpath = [[pts[k], pts[k + 1]]]
            k += 2
          } else if (op === OPS.lineTo) {
            const n = [pts[k], pts[k + 1]]
            segs.push([cur[0], cur[1], n[0], n[1]])
            subpath.push(n)
            cur = n
            k += 2
          } else if (op === OPS.curveTo) { cur = [pts[k + 4], pts[k + 5]]; k += 6 }
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cur = [pts[k + 2], pts[k + 3]]; k += 4 }
          else if (op === OPS.closePath) {
            segs.push([cur[0], cur[1], start[0], start[1]])
            cur = start
            if (subpath.length >= 3) {
              const xs = subpath.map(p => p[0]), ys = subpath.map(p => p[1])
              const minX = Math.min(...xs), maxX = Math.max(...xs)
              const minY = Math.min(...ys), maxY = Math.max(...ys)
              rs.push([minX, minY, maxX - minX, maxY - minY])
            }
            subpath = []
          } else if (op === OPS.rectangle) { rs.push([pts[k], pts[k + 1], pts[k + 2], pts[k + 3]]); k += 4 }
        }
        pending = { ctm, segs, rects: rs }
        break
      }
      case OPS.stroke: case OPS.closeStroke: commit(false, true); break
      case OPS.fill: case OPS.eoFill: commit(true, false); break
      case OPS.fillStroke: case OPS.eoFillStroke: case OPS.closeFillStroke: case OPS.closeEOFillStroke: commit(true, true); break
      case OPS.endPath: pending = null; break
    }
  }
  return { items, hLines, vLines, rects, W: vp.width, H: vp.height }
}

// ───────────────────────── 2. HELPERS ─────────────────────────
const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
const argb = (c) => 'FF' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()

function cluster(vals, tol = CFG.SNAP) {
  const s = [...vals].sort((a, b) => a - b), out = []
  for (const v of s) {
    const g = out[out.length - 1]
    if (g && v - g.last <= tol) { g.sum += v; g.n++; g.last = v } else out.push({ sum: v, n: 1, last: v })
  }
  return out.map((g) => g.sum / g.n)
}
const nearest = (arr, v) => arr.reduce((b, x, i) => (Math.abs(x - v) < Math.abs(arr[b] - v) ? i : b), 0)
const findIdx = (edges, v) => { let r = 0; for (let i = 0; i < edges.length - 1; i++) if (edges[i] <= v + 1.5) r = i; return r }

function coverage(ivs, a, b) {
  const s = ivs.map(([x, y]) => [x - 1.5, y + 1.5]).sort((p, q) => p[0] - q[0])
  let cov = 0, end = a
  for (const [x, y] of s) {
    const lo = Math.max(x, end, a), hi = Math.min(y, b)
    if (hi > lo) { cov += hi - lo; end = hi }
  }
  return cov / Math.max(b - a, 0.01)
}

class DSU { constructor(n) { this.p = Array.from({ length: n }, (_, i) => i) } f(x) { return this.p[x] === x ? x : (this.p[x] = this.f(this.p[x])) } u(a, b) { this.p[this.f(a)] = this.f(b) } }

// ───────────────────────── 3. TABLE DETECTION ─────────────────────────
function findTables(hLines, vLines) {
  if (hLines.length + vLines.length > CFG.MAX_LINES) return []
  const lines = [...hLines.map((l) => ({ ...l, h: true })), ...vLines.map((l) => ({ ...l, h: false }))]
  const d = new DSU(lines.length), tol = 3
  hLines.forEach((H, i) => vLines.forEach((V, j) => {
    if (V.x >= H.x1 - tol && V.x <= H.x2 + tol && H.y >= V.y1 - tol && H.y <= V.y2 + tol) d.u(i, hLines.length + j)
  }))
  const comps = {}
  lines.forEach((l, i) => (comps[d.f(i)] ||= []).push(l))
  const tables = []
  for (const comp of Object.values(comps)) {
    const hs = comp.filter((l) => l.h), vs = comp.filter((l) => !l.h)
    if (hs.length < 2 || vs.length < 2) continue
    const t = buildGrid(hs, vs)
    if (t) tables.push(t)
  }
  return tables.sort((a, b) => a.top - b.top)
}

function buildGrid(hs, vs) {
  const ys = cluster(hs.map((l) => l.y)), xs = cluster(vs.map((l) => l.x))
  if (ys.length < 2 || xs.length < 2) return null
  const R = ys.length - 1, C = xs.length - 1
  const hCov = ys.map(() => []), vCov = xs.map(() => []), hT = ys.map(() => 0), vT = xs.map(() => 0)
  hs.forEach((l) => { const i = nearest(ys, l.y); hCov[i].push([l.x1, l.x2]); hT[i] = Math.max(hT[i], l.t) })
  vs.forEach((l) => { const j = nearest(xs, l.x); vCov[j].push([l.y1, l.y2]); vT[j] = Math.max(vT[j], l.t) })
  const hCol = ys.map(() => null), vCol = xs.map(() => null)
  hs.forEach((l) => { hCol[nearest(ys, l.y)] ||= l.col }); vs.forEach((l) => { vCol[nearest(xs, l.x)] ||= l.col })

  const hOK = (i, c) => coverage(hCov[i], xs[c], xs[c + 1]) >= CFG.COVER
  const vOK = (j, r) => coverage(vCov[j], ys[r], ys[r + 1]) >= CFG.COVER

  // merge cells whose separating ruling is absent
  const d = new DSU(R * C), id = (r, c) => r * C + c
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (c < C - 1 && !vOK(c + 1, r)) d.u(id(r, c), id(r, c + 1))
    if (r < R - 1 && !hOK(r + 1, c)) d.u(id(r, c), id(r + 1, c))
  }
  const groups = {}
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) (groups[d.f(id(r, c))] ||= []).push([r, c])
  const cells = []
  for (const g of Object.values(groups)) {
    const r0 = Math.min(...g.map((p) => p[0])), r1 = Math.max(...g.map((p) => p[0]))
    const c0 = Math.min(...g.map((p) => p[1])), c1 = Math.max(...g.map((p) => p[1]))
    if (g.length === (r1 - r0 + 1) * (c1 - c0 + 1)) cells.push({ r0, r1, c0, c1 })
    else g.forEach(([r, c]) => cells.push({ r0: r, r1: r, c0: c, c1: c })) // non-rectangular -> un-merge
  }
  for (const k of cells) {
    k.l = xs[k.c0]; k.r = xs[k.c1 + 1]; k.t = ys[k.r0]; k.b = ys[k.r1 + 1]
    k.borders = {
      top: range(k.c0, k.c1).every((c) => hOK(k.r0, c)) ? { t: hT[k.r0], col: hCol[k.r0] } : null,
      bottom: range(k.c0, k.c1).every((c) => hOK(k.r1 + 1, c)) ? { t: hT[k.r1 + 1], col: hCol[k.r1 + 1] } : null,
      left: range(k.r0, k.r1).every((r) => vOK(k.c0, r)) ? { t: vT[k.c0], col: vCol[k.c0] } : null,
      right: range(k.r0, k.r1).every((r) => vOK(k.c1 + 1, r)) ? { t: vT[k.c1 + 1], col: vCol[k.c1 + 1] } : null,
    }
  }
  return { type: 'table', xs, ys, R, C, cells, top: ys[0], bottom: ys[R], left: xs[0], right: xs[C] }
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

// ───────────────────────── 4. TEXT ─────────────────────────
function dropRedacted(items, rects, W) {
  const dark = rects.filter((r) => lum(r.col) < CFG.REDACT_LUM && r.x1 - r.x0 < W * 0.4)
  if (!dark.length) return items
  return items.filter((it) => {
    const area = Math.max(it.w, 1) * (it.bot - it.top)
    return !dark.some((r) => {
      const ox = Math.min(it.x + it.w, r.x1) - Math.max(it.x, r.x0), oy = Math.min(it.bot, r.y1) - Math.max(it.top, r.y0)
      return ox > 0 && oy > 0 && (ox * oy) / area >= CFG.REDACT_COVER
    })
  })
}

function groupLines(items) {
  const s = [...items].sort((a, b) => a.base - b.base || a.x - b.x), lines = []
  for (const it of s) {
    const l = lines.find((q) => Math.abs(q.base - it.base) <= it.size * 0.5)
    if (l) l.items.push(it); else lines.push({ base: it.base, items: [it] })
  }
  lines.forEach((l) => l.items.sort((a, b) => a.x - b.x))
  return lines.sort((a, b) => a.base - b.base)
}
function joinItems(its) {
  let s = '', prev = null
  for (const it of its) {
    if (prev && it.x - (prev.x + prev.w) > it.size * CFG.WORD_GAP && !/\s$/.test(s) && !/^\s/.test(it.str)) s += ' '
    s += it.str; prev = it
  }
  return s.trim()
}
const lineBox = (its) => ({ l: its[0].x, r: its[its.length - 1].x + its[its.length - 1].w })

// Text of one cell: soft-wrapped paragraph lines are joined, hard breaks kept as \n
function cellText(its, cellW) {
  const lines = groupLines(its).map((l) => ({ txt: joinItems(l.items), ...lineBox(l.items) }))
  let out = ''
  lines.forEach((ln, i) => {
    out += ln.txt
    if (i < lines.length - 1) {
      const full = (ln.r - ln.l) >= cellW * CFG.SOFT_WRAP
      out += /-$/.test(ln.txt) && /^[a-z]/.test(lines[i + 1].txt) ? '' : full ? ' ' : '\n'
    }
  })
  return { text: out, lines: lines.length, l: Math.min(...lines.map((x) => x.l)), r: Math.max(...lines.map((x) => x.r)) }
}

const NUM_RE = /^\d{1,3}(,\d{2,3})*(\.\d+)?$|^\d+(\.\d+)?$/
function parseNum(s) {
  let t = s.trim(), neg = false, cur = ''
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim() }
  if (/^[-−]/.test(t)) { neg = true; t = t.slice(1).trim() }
  if (/[-−]$/.test(t)) { t = t.replace(/[-−]+$/, '').trim() }
  const m = t.match(/^([₹$€£]|Rs\.?)\s*(.*)$/); if (m) { cur = m[1]; t = m[2] }
  if (!NUM_RE.test(t) || t.replace(/\D/g, '').length > 15) return null
  if (/^0\d/.test(t)) return null // codes like 00123 stay text
  const dec = (t.split('.')[1] || '').length
  return { v: (neg ? -1 : 1) * parseFloat(t.replace(/,/g, '')), dec, comma: t.includes(','), cur: cur.startsWith('R') ? '₹' : cur }
}
const numFmt = (n, dec = n.dec) => (n.cur ? `"${n.cur}"` : '') + (dec ? '#,##0.' + '0'.repeat(dec) : n.comma ? '#,##0' : '0')

// ───────────────────────── 5. PAGE -> BLOCKS ─────────────────────────
async function pageToBlocks(page, opts, boldFonts) {
  const ex = await extractPage(page, boldFonts)
  let items = opts.dropRedacted === false ? ex.items : dropRedacted(ex.items, ex.rects, ex.W)
  const tables = findTables(ex.hLines, ex.vLines)

  // assign items to tables
  const free = []
  for (const it of items) {
    const cx = it.x + it.w / 2, cy = (it.top + it.bot) / 2
    const t = tables.find((t) => cx >= t.left - 1 && cx <= t.right + 1 && cy >= t.top - 1 && cy <= t.bottom + 1)
    if (!t) { free.push(it); continue }
    const k = t.cells.find((k) => cx >= k.l - 1.5 && cx <= k.r + 1.5 && cy >= k.t - 1.5 && cy <= k.b + 1.5) ||
      t.cells.find((k) => k.r0 === findIdx(t.ys, cy) && k.r1 >= findIdx(t.ys, cy) && k.c0 <= findIdx(t.xs, cx) && k.c1 >= findIdx(t.xs, cx))
    if (k) (k.items ||= []).push(it)
  }
  for (const t of tables) for (const k of t.cells) {
    k.fill = null
    const area = (k.r - k.l) * (k.b - k.t)
    for (const r of ex.rects) { // later-drawn rects win
      const ox = Math.min(k.r, r.x1) - Math.max(k.l, r.x0), oy = Math.min(k.b, r.y1) - Math.max(k.t, r.y0)
      const tableArea = (t.right - t.left) * (t.bottom - t.top)
      if (ox > 0 && oy > 0 && (ox * oy) / area >= CFG.FILL_MIN && (r.x1 - r.x0) * (r.y1 - r.y0) < tableArea * 0.9 && lum(r.col) >= 0.25 && lum(r.col) < 0.97) k.fill = r.col
    }
  }

  // free text -> one block per line, split into segments
  const blocks = [...tables]
  for (const l of groupLines(free)) {
    const size = Math.max(...l.items.map((i) => i.size)), segs = []
    for (const it of l.items) {
      const s = segs[segs.length - 1], last = s && s.items[s.items.length - 1]
      if (s && it.x - (last.x + last.w) <= size * CFG.SEG_GAP) s.items.push(it); else segs.push({ items: [it] })
    }
    segs.forEach((s) => { s.x = s.items[0].x; s.w = s.items[s.items.length - 1].x + s.items[s.items.length - 1].w - s.x; s.text = joinItems(s.items) })
    blocks.push({ type: 'line', top: l.base - size * 0.8, size, segs })
  }
  blocks.sort((a, b) => a.top - b.top)
  return { blocks, W: ex.W, H: ex.H, tableCount: tables.length }
}

// stream-mode columns (no ruled tables): gaps in the union of segment x-intervals
function streamEdges(lineBlocks, W) {
  const iv = lineBlocks.flatMap((b) => b.segs).filter((s) => s.w < W * 0.45).map((s) => [s.x, s.x + s.w]).sort((a, b) => a[0] - b[0])
  const merged = []
  for (const [a, b] of iv) { const m = merged[merged.length - 1]; if (m && a <= m[1] + 4) m[1] = Math.max(m[1], b); else merged.push([a, b]) }
  const edges = [merged.length ? merged[0][0] - 1 : 0]
  for (let i = 1; i < merged.length; i++) edges.push((merged[i - 1][1] + merged[i][0]) / 2)
  edges.push(merged.length ? merged[merged.length - 1][1] + 1 : W)
  return edges
}

// ───────────────────────── 6. BLOCKS -> WORKSHEET ─────────────────────────
const fontName = (f) => (/times|serif|georgia|garamond|cambria/i.test(f) && !/sans/i.test(f) ? 'Times New Roman' : /courier|mono/i.test(f) ? 'Courier New' : 'Calibri')
const pt2w = (pt) => Math.max(1, (pt * 1.3333 - 5) / 7)
const bStyle = (b) => (b ? { style: b.t >= 1.2 ? 'medium' : 'thin', color: { argb: b.col ? argb(b.col) : 'FF000000' } } : undefined)
const gridBorder = { style: 'thin', color: { argb: 'FFD3D3D3' } }

function layout(ws, pages) {
  const blocks = pages.flatMap((p) => p.blocks), tables = blocks.filter((b) => b.type === 'table')
  const lineBlocks = blocks.filter((b) => b.type === 'line')
  const W = Math.max(...pages.map((p) => p.W))

  // global column edges
  let edges
  if (tables.length) {
    const ex = tables.flatMap((t) => t.xs), lo = Math.min(...ex), hi = Math.max(...ex)
    const extra = lineBlocks.flatMap((b) => b.segs).flatMap((s) => (s.x < lo - 3 ? [s.x] : s.x > hi + 3 ? [s.x, s.x + s.w] : []))
    edges = cluster([...ex, ...extra])
  } else edges = streamEdges(lineBlocks, W)
  if (edges.length < 2) edges = [0, W]
  edges.slice(0, -1).forEach((e, i) => { ws.getColumn(i + 1).width = pt2w(edges[i + 1] - e) })

  let row = 1, prevBottom = null
  let firstTableBase = null
  const numCols = {} // col -> [{cell, n}] for decimal normalisation
  const spacer = (h) => { if (h > 3) ws.getRow(row++).height = Math.min(h, 120) }

  for (const b of blocks) {
    if (prevBottom !== null) spacer(b.top - prevBottom)
    if (b.type === 'line') {
      const fontSize = Math.min(Math.max(Math.round(b.size * 1.6), 10), 22)
      const h = Math.max(b.size * 1.8, fontSize * 1.4, 18)
      ws.getRow(row).height = h
      for (const s of b.segs) {
        const c = ws.getCell(row, findIdx(edges, s.x) + 1), n = parseNum(s.text)
        c.value = n ? n.v : s.text
        if (n) c.numFmt = numFmt(n)
        const nonSpaceItems = s.items.filter(i => i.str.trim())
        const isBold = nonSpaceItems.length > 0 && nonSpaceItems.some(i => i.bold)
        c.font = { name: fontName(s.items[0].font), size: fontSize, bold: isBold, italic: s.items.some((i) => i.italic) }
        c.alignment = { vertical: 'middle', horizontal: n ? 'right' : 'left' }
      }
      row++; prevBottom = b.top + h
      continue
    }
    // table
    const base = row, rowH = Array.from({ length: b.R }, (_, i) => b.ys[i + 1] - b.ys[i])
    if (firstTableBase === null) firstTableBase = row
    const colOf = (x) => nearest(edges, x)
    const need = Array(b.R).fill(0)
    for (const k of b.cells) {
      const c0 = colOf(k.l), c1 = colOf(k.r) - 1, r0 = base + k.r0, r1 = base + k.r1
      const cw = k.r - k.l, size = k.items ? Math.max(...k.items.map((i) => i.size)) : 8
      const fontSize = Math.min(Math.max(Math.round(size * 1.6), 10), 20)
      const tx = k.items ? cellText(k.items, cw - 4) : null
      const single = tx && !tx.text.includes('\n')
      const n = single ? parseNum(tx.text) : null
      if (r1 > r0 || c1 > c0) ws.mergeCellsWithoutStyle(r0, c0 + 1, r1, c1 + 1) // keeps per-cell borders
      const m = ws.getCell(r0, c0 + 1)
      if (tx) {
        m.value = n ? n.v : tx.text
        if (n) { m.numFmt = numFmt(n); if (c1 === c0) (numCols[c0] ||= []).push({ cell: m, n }) }
        const lp = tx.l - k.l, rp = k.r - tx.r
        const h = lp > 3 && Math.abs(lp - rp) < cw * 0.12 ? 'center' : tx.lines > 1 ? 'left' : rp < lp - 3 ? 'right' : lp < rp - 3 ? 'left' : n ? 'right' : 'left'
        m.alignment = { vertical: 'top', horizontal: h, wrapText: true }
        const nonSpaceItems = k.items ? k.items.filter(i => i.str.trim()) : []
        const isBold = nonSpaceItems.length > 0 && nonSpaceItems.some(i => i.bold)
        const f = k.items.find((i) => i.size === size) || k.items[0]
        m.font = { name: fontName(f.font), size: fontSize, bold: isBold, italic: k.items.some((i) => i.italic), ...(k.fill && lum(k.fill) < 0.4 ? { color: { argb: 'FFFFFFFF' } } : {}) }
        if (k.r0 === k.r1) {
          const colChars = Math.max(8, (cw * 1.3333 - 5) / 7)
          const lines = tx.text.split('\n')
          let totalWrappedLines = 0
          for (const line of lines) {
            totalWrappedLines += Math.max(1, Math.ceil(line.length / (colChars * 0.85)))
          }
          const lineHeight = Math.max(fontSize * 1.4, 14)
          need[k.r0] = Math.max(need[k.r0], totalWrappedLines * lineHeight + 8)
        }
      }
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const cell = ws.getCell(r, c + 1)
        cell.border = {
          top: r === r0 ? (bStyle(k.borders.top) || gridBorder) : gridBorder,
          bottom: r === r1 ? (bStyle(k.borders.bottom) || gridBorder) : gridBorder,
          left: c === c0 ? (bStyle(k.borders.left) || gridBorder) : gridBorder,
          right: c === c1 ? (bStyle(k.borders.right) || gridBorder) : gridBorder,
        }
        if (k.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(k.fill) } }
      }
    }
    for (let i = 0; i < b.R; i++) {
      ws.getRow(base + i).height = Math.min(Math.max(rowH[i] * 1.3, need[i], 18), 409)
    }
    row += b.R; prevBottom = b.bottom
  }

  // per-column decimal consistency: 3060 next to 34,000.00 -> 3,060.00
  for (const list of Object.values(numCols)) {
    const maxDec = Math.max(...list.map((x) => x.n.dec))
    if (list.length >= 2 && maxDec >= 1) list.forEach(({ cell, n }) => { if (n.dec < maxDec) cell.numFmt = numFmt(n, maxDec) })
  }

  // Auto-fit column widths to prevent ###### while avoiding overly wide columns
  ws.columns.forEach((col) => {
    let maxLen = 0
    col.eachCell({ includeEmpty: false }, (cell, rowNum) => {
      if (firstTableBase === null || rowNum >= firstTableBase) {
        const span = ws._merges?.[cell.address]?.model
        const spansMultipleCols = span ? span.right > span.left : cell.isMerged
        if (!spansMultipleCols) {
          let str = ''
          if (typeof cell.value === 'number') {
            str = cell.value.toLocaleString('en-US', { minimumFractionDigits: 2 })
          } else if (cell.value != null) {
            str = String(cell.value)
          }
          const lines = str.split('\n')
          for (const l of lines) {
            if (l.length > maxLen) maxLen = l.length
          }
        }
      }
    })
    if (maxLen > 0) {
      col.width = Math.min(Math.max(maxLen + 3, 7), 50)
    } else {
      col.width = Math.max(col.width || 0, 8)
    }
  })
}

// ───────────────────────── 7. PUBLIC API ─────────────────────────
export async function pdfToExcel(file, onProgress, options = {}) {
  const ExcelJS = (await import('exceljs')).default // lazy: keeps main bundle small
  const buf = file.arrayBuffer ? await file.arrayBuffer() : file
  
  // Pre-scan bold fonts from raw PDF buffer
  const boldFonts = new Set()
  try {
    const rawPdfString = Buffer.isBuffer(buf) ? buf.toString('latin1') : new TextDecoder('latin1').decode(buf)
    for (const m of rawPdfString.matchAll(/\/FontName\s*\/([A-Za-z0-9_\+\-]+)[\s\S]*?\/FontFile2\s*(\d+)\s+0\s+R/g)) {
      const fn = m[1], objNum = m[2]
      const objIdx = rawPdfString.indexOf(objNum + ' 0 obj')
      if (objIdx !== -1) {
        const chunk = rawPdfString.slice(objIdx, objIdx + 60000)
        if (/Bold|Black|Heavy|Semibold/i.test(chunk)) {
          boldFonts.add(fn)
          boldFonts.add(fn.replace(/^[A-Z0-9]{6}\+/, ''))
        }
      }
    }
    for (const m of rawPdfString.matchAll(/\/BaseFont\s*\/([A-Za-z0-9_\+\-]+)/g)) {
      if (/Bold|Black|Heavy|Semibold/i.test(m[1])) {
        boldFonts.add(m[1])
        boldFonts.add(m[1].replace(/^[A-Z0-9]{6}\+/, ''))
      }
    }
  } catch (_) {}

  const pdf = await pdfjs().getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise
  const wb = new ExcelJS.Workbook()
  const pages = []

  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.({ done: i, total: pdf.numPages, label: `Extracting table from page ${i} of ${pdf.numPages}…` })
    pages.push(await pageToBlocks(await pdf.getPage(i), options, boldFonts))
  }

  const groups = options.singleSheet ? [pages] : pages.map((p) => [p])
  groups.forEach((g, i) => {
    const ws = wb.addWorksheet(groups.length === 1 ? 'Sheet1' : `Page ${i + 1}`, { views: [{ showGridLines: true }] })
    layout(ws, g)
    ws.pageSetup = { orientation: g[0].W > g[0].H ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
  })

  const out = await wb.xlsx.writeBuffer()
  return { data: new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }
}
