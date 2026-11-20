// core/table.ts
import type { DocState, TextElement, FlowObject, Rect, TableCell, TableModel } from './types.ts'
import type { Measurer } from './fonts.ts'
import { wrapText, placeLines } from './layout.ts'

export type { TableCell, TableModel }

const cluster = (vals: number[], tol: number) => {
  const s = [...vals].sort((a, b) => a - b), out: number[] = []
  for (const v of s) {
    if (!out.length || v - out[out.length - 1] > tol) out.push(v)
    else out[out.length - 1] = (out[out.length - 1] + v) / 2
  }
  return out
}

/** Ruling-line grid detection. Requires real intersections, so stray rules don't become tables. */
export function detectTables(objs: FlowObject[], els: TextElement[], page: number): TableModel[] {
  const H = objs.filter((o) => o.page === page && o.rect.h <= 3 && o.rect.w >= 24)
  const V = objs.filter((o) => o.page === page && o.rect.w <= 3 && o.rect.h >= 12)
  if (H.length < 2 || V.length < 2) return []

  const xs = cluster(V.map((v) => v.rect.x + v.rect.w / 2), 2.5)
  const ys = cluster(H.map((h) => h.rect.y + h.rect.h / 2), 2.5).sort((a, b) => b - a)
  if (xs.length < 2 || ys.length < 2) return []

  const hit = (x: number, y: number) =>
    V.some((v) => Math.abs(v.rect.x + v.rect.w / 2 - x) < 3 && v.rect.y - 2 <= y && v.rect.y + v.rect.h + 2 >= y) &&
    H.some((h) => Math.abs(h.rect.y + h.rect.h / 2 - y) < 3 && h.rect.x - 2 <= x && h.rect.x + h.rect.w + 2 >= x)

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
      const ids = els.filter((e) => e.page === page && !e.deleted && !e.locked &&
        e.origBox.x + e.origBox.w / 2 > cell.x && e.origBox.x + e.origBox.w / 2 < cell.x + cell.w &&
        e.origBox.y + e.origBox.h / 2 > cell.y && e.origBox.y + e.origBox.h / 2 < cell.y + cell.h).map((e) => e.id)
      cells.push({ r, c, elIds: ids, rect: cell })
    }
  }
  return [{
    id: `t${page}_${Math.round(rect.x)}_${Math.round(rect.y)}`,
    page, rect, xs, ys, cells,
    ruleOps: [...H, ...V].flatMap((o) => o.ops),
    ruleColor: H[0].color,
    headerRows: 1, padX: 4, padY: 3, confidence: 'high'
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
