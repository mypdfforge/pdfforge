// core/table.ts
import type { DocState, TextElement, FlowObject, Rect, TableCell, TableModel, TableFill } from './types.ts'
import type { Measurer } from './fonts.ts'
import { wrapText, placeLines } from './layout.ts'
import type { Tok } from './objects.ts'

export type { TableCell, TableModel, TableFill }

/** Path-construction and paint operators: the only instructions a table may remove when it redraws its borders. */
const SHAPE_OPS = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're', 'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*'])

const cluster = (vals: number[], tol: number) => {
  const s = [...vals].sort((a, b) => a - b), out: number[] = []
  for (const v of s) {
    if (!out.length || v - out[out.length - 1] > tol) out.push(v)
    else out[out.length - 1] = (out[out.length - 1] + v) / 2
  }
  return out
}

/** Ruling-line & bordered box grid detection. */
export function detectTables(objs: FlowObject[], els: TextElement[], page: number, toks?: Tok[]): TableModel[] {
  const H: Array<{ rect: Rect; ops: number[]; color: [number, number, number] }> = objs.filter((o) => o.page === page && o.rect.h <= 3 && o.rect.w >= 24)
  const V: Array<{ rect: Rect; ops: number[]; color: [number, number, number] }> = objs.filter((o) => o.page === page && o.rect.w <= 3 && o.rect.h >= 12)

  // Decompose bordered box rectangles (e.g. 2-column callouts, single-row bordered tables) into candidate border rules
  for (const o of objs) {
    if (o.page === page && (o.kind === 'vector' || o.kind === 'rule') && o.rect.w >= 36 && o.rect.h >= 14) {
      H.push({ rect: { x: o.rect.x, y: o.rect.y + o.rect.h - 1, w: o.rect.w, h: 2 }, ops: o.ops, color: o.color })
      H.push({ rect: { x: o.rect.x, y: o.rect.y, w: o.rect.w, h: 2 }, ops: o.ops, color: o.color })
      V.push({ rect: { x: o.rect.x, y: o.rect.y, w: 2, h: o.rect.h }, ops: o.ops, color: o.color })
      V.push({ rect: { x: o.rect.x + o.rect.w - 1, y: o.rect.y, w: 2, h: o.rect.h }, ops: o.ops, color: o.color })
    }
  }

  if (H.length < 2 || V.length < 2) return []

  const xs = cluster(V.map((v) => v.rect.x + v.rect.w / 2), 3)
  const ys = cluster(H.map((h) => h.rect.y + h.rect.h / 2), 3).sort((a, b) => b - a)
  if (xs.length < 2 || ys.length < 2) return []

  const hit = (x: number, y: number) =>
    V.some((v) => Math.abs(v.rect.x + v.rect.w / 2 - x) < 3.5 && v.rect.y - 2 <= y && v.rect.y + v.rect.h + 2 >= y) &&
    H.some((h) => Math.abs(h.rect.y + h.rect.h / 2 - y) < 3.5 && h.rect.x - 2 <= x && h.rect.x + h.rect.w + 2 >= x)

  let corners = 0
  for (const x of xs) {
    for (const y of ys) {
      if (hit(x, y)) corners++
    }
  }
  if (corners < 4) return []

  const rect: Rect = { x: xs[0], y: ys[ys.length - 1], w: xs[xs.length - 1] - xs[0], h: ys[0] - ys[ys.length - 1] }
  const cells: TableCell[] = []
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      const cell: Rect = { x: xs[c], y: ys[r + 1], w: xs[c + 1] - xs[c], h: ys[r] - ys[r + 1] }
      const ids = els.filter((e) => e.page === page && !e.deleted &&
        e.origBox.x + e.origBox.w / 2 >= cell.x - 2 && e.origBox.x + e.origBox.w / 2 <= cell.x + cell.w + 2 &&
        e.origBox.y + e.origBox.h / 2 >= cell.y - 2 && e.origBox.y + e.origBox.h / 2 <= cell.y + cell.h + 2).map((e) => e.id)
      cells.push({ r, c, elIds: ids, rect: cell })
    }
  }

  const fills: TableFill[] = []
  const fillOps: number[] = []
  for (const o of objs) {
    if (o.page === page && (o.kind === 'vector' || o.kind === 'rule') && o.rect.h >= 6 && o.rect.w >= 20 &&
        o.rect.x >= rect.x - 4 && o.rect.x + o.rect.w <= rect.x + rect.w + 4 &&
        o.rect.y >= rect.y - 4 && o.rect.y + o.rect.h <= rect.y + rect.h + 4) {
      const ymid = o.rect.y + o.rect.h / 2
      let bestR = -1, bestDist = Infinity
      for (let r = 0; r < ys.length - 1; r++) {
        const rowMid = (ys[r] + ys[r + 1]) / 2
        const dist = Math.abs(rowMid - ymid)
        if (dist < bestDist) { bestDist = dist; bestR = r }
      }
      if (bestR >= 0 && bestDist < (ys[bestR] - ys[bestR + 1]) * 0.75) {
        fills.push({
          x0: o.rect.x, x1: o.rect.x + o.rect.w,
          y0: o.rect.y, y1: o.rect.y + o.rect.h,
          color: o.color, rowIdx: bestR,
          ops: o.ops, translatable: o.translatable
        })
        fillOps.push(...o.ops)
      }
    }
  }

  // Detect rows with no interior vertical dividers (merged header / colspan rows)
  const mergedRows: number[] = []
  const interiorVs = V.filter((v) => {
    const vx = v.rect.x + v.rect.w / 2
    return vx > xs[0] + 4 && vx < xs[xs.length - 1] - 4
  })
  for (let r = 0; r < ys.length - 1; r++) {
    const ymid = (ys[r] + ys[r + 1]) / 2
    const hasInteriorDivider = interiorVs.some((v) => v.rect.y - 2 <= ymid && v.rect.y + v.rect.h + 2 >= ymid)
    if (!hasInteriorDivider) mergedRows.push(r)
  }

  return [{
    id: `t${page}_${Math.round(rect.x)}_${Math.round(rect.y)}`,
    page, rect, xs, ys, cells,
    // An object's ops also hold every instruction since the previous paint, including cell text (BT/Tj/ET). Keep shapes only.
    ruleOps: [...new Set([...H, ...V].flatMap((o) => o.ops).concat(fillOps))].filter((i) => !toks || SHAPE_OPS.has(toks[i]?.op ?? '')),
    ruleColor: H[0].color,
    headerRows: 1, padX: 4, padY: 3, confidence: 'high',
    fills,
    mergedRows
  }]
}

export type PlacedTable = {
  top: number
  bottom: number
  height: number
  rowYs: number[]
  cellLines: Map<string, ReturnType<typeof placeLines>>
}

/**
 * Live table layout: row height = tallest cell. Editing one cell grows its row,
 * which grows the table, which the cascade propagates to everything below.
 */
export function layoutTable(t: TableModel, doc: DocState, m: Measurer, top: number): PlacedTable {
  const rowYs = [top]
  const cellLines = new Map<string, ReturnType<typeof placeLines>>()
  for (let r = 0; r < t.ys.length - 1; r++) {
    let h = 0
    for (const cell of t.cells.filter((c) => c.r === r)) {
      const w = Math.max(8, cell.rect.w - 2 * t.padX)
      let ch = 0
      for (const id of cell.elIds) {
        const e = doc.els[id]
        if (!e) continue
        const texts = wrapText(e.text, w, e.style, m)
        const pl = placeLines(texts, cell.rect.x + t.padX, 0, w, e.style, m)
        cellLines.set(id, pl)
        ch = Math.max(ch, texts.length * e.style.size * e.style.lineHeight)
      }
      h = Math.max(h, ch + 2 * t.padY)
    }
    rowYs.push(rowYs[r] - Math.max(h, t.ys[r] - t.ys[r + 1])) // never shrink below the original row height
  }
  return { top, bottom: rowYs[rowYs.length - 1], height: top - rowYs[rowYs.length - 1], rowYs, cellLines }
}


/** Paint-op indices of a table's ruling lines on `page`. The table redraws these itself; the generic object pass must not touch them. */
export function tableRuleSet(doc: DocState, page: number): Set<number> {
  const s = new Set<number>()
  for (const t of doc.tables ?? []) if (t.page === page) for (const i of t.ruleOps) s.add(i)
  return s
}
export const isTableRule = (o: FlowObject, rules: Set<number>) => rules.has(o.ops[o.ops.length - 1])

export type TableFlow = { shifts: Map<string, { dy: number; page: number }>; rects: Map<string, Rect> }
export type GridSeg = { page: number; ys: number[] }

/**
 * Border grid that follows where the cascade really put the cell text: rows that grew push the rows below,
 * rows that paginate start a new segment on the next page. null = the table did not move or change.
 * shortcut: the repeated header row gets no borders on continuation pages, add if tables split often.
 */
export function flowedGrid(t: TableModel, doc: DocState, res: TableFlow): GridSeg[] | null {
  const n = t.ys.length - 1
  type Row = { dyTop: number; dyLow: number; page: number; low: number }
  const rows: Array<Row | null> = []
  for (let r = 0; r < n; r++) {
    const els = t.cells.filter((c) => c.r === r).flatMap((c) => c.elIds).map((id) => doc.els[id]).filter((e) => e && !e.deleted && res.shifts.has(e.id))
    if (!els.length) { rows.push(null); continue }
    const top = els.reduce((a, b) => (b.origBox.y + b.origBox.h > a.origBox.y + a.origBox.h ? b : a))
    const lowEl = els.reduce((a, b) => (b.origBox.y < a.origBox.y ? b : a))
    const padBelow = Math.max(0, Math.min(t.padY, lowEl.origBox.y - t.ys[r + 1])) // never demand more padding than the original had
    const st = res.shifts.get(top.id)!
    rows.push({ dyTop: st.dy, dyLow: res.shifts.get(lowEl.id)!.dy, page: st.page, low: Math.min(...els.map((e) => res.rects.get(e.id)?.y ?? Infinity)) - padBelow })
  }
  if (rows.every((x) => !x)) return null
  const R: Row[] = []
  for (let i = 0; i < n; i++) {
    const x = rows[i]
    if (x) R.push(x)
    else { const q = R[i - 1] ?? rows.find(Boolean)!; R.push({ ...q, dyTop: q.dyLow, low: Infinity }) }   // empty row rides the row above
  }
  const topY = (r: number) => t.ys[r] + R[r].dyTop
  const botY = (r: number) => Math.min(t.ys[r + 1] + (r + 1 < n && R[r + 1].page === R[r].page ? R[r + 1].dyTop : R[r].dyLow), R[r].low)
  const segs: GridSeg[] = []
  let moved = false
  for (let r = 0; r < n; r++) {
    let g = segs[segs.length - 1]
    if (!g || g.page !== R[r].page) { g = { page: R[r].page, ys: [topY(r)] }; segs.push(g) }
    g.ys.push(Math.min(botY(r), g.ys[g.ys.length - 1] - 6))
    if (R[r].page !== t.page || Math.abs(g.ys[g.ys.length - 2] - t.ys[r]) > 0.05 || Math.abs(g.ys[g.ys.length - 1] - t.ys[r + 1]) > 0.05) moved = true
  }
  return moved ? segs : null
}
