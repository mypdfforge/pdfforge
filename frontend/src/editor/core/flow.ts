// core/flow.ts
// Live Flow cascade for Design Lock: lane-isolated Delta-h pushdown/pullup, follower anchoring,
// spanner barriers, per-lane pagination with widow/orphan control. Pure + memoizable.
// PDF points, bottom-left origin. No engine/Plan changes required to consume this.
import type { DocState, TextElement, TextStyle, PageModel, Rect, FlowObject, TableModel } from './types.ts'
import type { Measurer } from './fonts.ts'
import { layoutElement, placeLines, descenderOf, countFittingLines, wrapForFlow } from './layout.ts'
import type { Line } from './layout.ts'
import { intersects } from './geometry.ts'
import { isChanged } from './plan.ts'
import { layoutTable, tableRuleSet, isTableRule } from './table.ts'

export type FlowShift = { baseline: number; page: number; dy: number } // dy = baseline - origBaseline
export type LaneBox = { page: number; x0: number; x1: number; index?: number }
export type FlowChunk = { id: string; page: number; from: number; count: number; baseline: number; lines: Line[]; rect: Rect }
export type CascadeResult = {
  shifts: Map<string, FlowShift>
  rects: Map<string, Rect>                       // post-flow boxes -> overlays + collision checks
  pageBox: Array<{ src: number | null; w: number; h: number }>
  pageCount: number
  lanes: LaneBox[]                               // for optional UI lane guides
  warnings: string[]
  chunks: Map<string, FlowChunk[]>               // elements split across pages
  repeats: Array<{ id: string; page: number; baseline: number }> // repeated table headers
  objectShifts: Map<string, { page: number; dy: number; dx: number }>
}

const MARKER = /^\s*([-•–*▪◦·]|\d+[.)])\s+/
const GUTTER_MIN = 12          // pt of empty vertical projection that separates columns
const SPAN_RATIO = 0.6         // box wider than this fraction of content width => spanner
const MIN_LANE_MASS = 6        // chars; below this a "lane" is noise (page numbers…)
const DEFAULT_TOP_MARGIN = 54  // matches reflow.ts default for appended pages
const MAX_EXTRA_PAGES = 5      // safe cap: never runaway to hundreds of phantom pages
const FURN_BAND = 36           // pt from the page edge: short text in here is always header/footer furniture
const FOOT_ZONE = 0.12         // bottom share of the page where short text after a clear gap is footer furniture
const FOOT_PAD = 8             // pt kept free between body text and the footer

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const sameLook = (a: TextStyle, b: TextStyle) =>
  a.family === b.family && a.bold === b.bold && a.italic === b.italic &&
  Math.abs(a.size - b.size) < 0.3 && a.color.every((c, i) => Math.abs(c - b.color[i]) < 0.02)

/** Weighted modal font size = "body size" (same heuristic as reconstruct()). */
function bodySize(doc: DocState): number {
  const w: Record<string, number> = {}
  for (const id of doc.order) { const e = doc.els[id]; if (!e.locked && !e.deleted) w[e.style.size] = (w[e.style.size] ?? 0) + e.text.length }
  return Number(Object.entries(w).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11)
}

// ---- 2.1 lanes --------------------------------------------------------------------------------------------

export function findFlowLanes(els: TextElement[], pm: PageModel): { lanes: Array<{ x0: number; x1: number }>; laneOf: Map<string, number> } {
  const live = els.filter((e) => !e.deleted)
  const laneOf = new Map<string, number>()
  if (!live.length) return { lanes: [], laneOf }

  const W = Math.ceil(pm.width)
  const cover = new Uint16Array(W + 1)
  let min = W, max = 0
  for (const e of live) {
    const a = Math.max(0, Math.floor(e.origBox.x - pm.x0))
    const b = Math.min(W, Math.ceil(e.origBox.x + e.origBox.w - pm.x0))
    if (b <= a) continue
    min = Math.min(min, a); max = Math.max(max, b)
    for (let x = a; x < b; x++) cover[x]++
  }
  if (max <= min) return { lanes: [{ x0: pm.x0 + min, x1: pm.x0 + max }], laneOf }

  // Gutters: zero-coverage runs >= GUTTER_MIN, cut at their midpoint.
  const cuts: number[] = []
  let run = 0
  for (let x = min; x <= max; x++) {
    if (cover[x] === 0) run++
    else { if (run >= GUTTER_MIN) cuts.push(x - run / 2); run = 0 }
  }
  const bounds = [min, ...cuts, max]
  let lanes = bounds.slice(0, -1).map((b, i) => ({ x0: pm.x0 + b, x1: pm.x0 + bounds[i + 1] }))

  // Assign: crossing a gutter (or very wide in multi-lane) => spanner (-1); else max-overlap lane.
  const mass = lanes.map(() => 0)
  for (const e of live) {
    const a = e.origBox.x - pm.x0, b = a + e.origBox.w
    if (cuts.length > 0 && (cuts.some((c) => a < c - 1 && b > c + 1) || e.origBox.w >= SPAN_RATIO * (max - min))) { laneOf.set(e.id, -1); continue }
    let best = 0, ov = -1
    lanes.forEach((l, i) => {
      const o = Math.min(b, l.x1 - pm.x0) - Math.max(a, l.x0 - pm.x0)
      if (o > ov) { ov = o; best = i }
    })
    laneOf.set(e.id, best); mass[best] += e.text.length
  }
  // Merge noise lanes into the nearest surviving lane, then reindex.
  const keep = lanes.map((_, i) => i).filter((i) => mass[i] >= MIN_LANE_MASS)
  if (keep.length && keep.length < lanes.length) {
    const center = (i: number) => (lanes[i].x0 + lanes[i].x1) / 2
    for (const [id, li] of laneOf) {
      if (li < 0 || keep.includes(li)) continue
      let near = keep[0], d = Infinity
      for (const k of keep) { const dd = Math.abs(center(k) - center(li)); if (dd < d) { d = dd; near = k } }
      laneOf.set(id, near)
    }
    const remap = new Map(keep.map((k, i) => [k, i]))
    for (const [id, li] of laneOf) if (li >= 0) laneOf.set(id, remap.get(li)!)
    lanes = keep.map((k) => lanes[k])
  } else if (!keep.length) {
    lanes = [{ x0: pm.x0 + min, x1: pm.x0 + max }]
    for (const [id, li] of laneOf) if (li >= 0) laneOf.set(id, 0)
  }
  return { lanes, laneOf }
}

function tableCellIds(doc: DocState, page: number): Set<string> {
  const s = new Set<string>()
  for (const t of doc.tables ?? []) if (t.page === page) for (const c of t.cells) c.elIds.forEach((i) => s.add(i))
  return s
}

/** A ruled table is one flow unit: it lives in the lane it mostly covers (spanner if it crosses a gutter),
 *  so every column of a row moves together and its own column gaps never become lanes. */
function assignTableLanes(doc: DocState, page: number, lanes: Array<{ x0: number; x1: number }>, laneOf: Map<string, number>) {
  for (const t of doc.tables ?? []) {
    if (t.page !== page) continue
    let best = -1, ov = 0
    lanes.forEach((l, i) => { const o = Math.min(l.x1, t.rect.x + t.rect.w) - Math.max(l.x0, t.rect.x); if (o > ov) { ov = o; best = i } })
    const lane = best >= 0 && ov >= 0.6 * t.rect.w ? best : -1
    for (const c of t.cells) for (const id of c.elIds) laneOf.set(id, lane)
  }
}

export type TableRegion = {
  page: number
  top: number
  bottom: number
  elementIds: Set<string>
}

export function findTableRegions(els: TextElement[], page: number): TableRegion[] {
  const live = els.filter((e) => !e.deleted && e.page === page)
  const byY: TextElement[][] = []
  for (const e of live) {
    const r = byY.find((row) => Math.abs(row[0].origBaseline - e.origBaseline) < 0.35 * Math.max(e.style.size, row[0].style.size))
    if (r) r.push(e)
    else byY.push([e])
  }
  byY.sort((a, b) => b[0].origBaseline - a[0].origBaseline)
  const multiCol = byY.filter((r) => r.length >= 3)
  const tableClusters: TextElement[][][] = []
  let cur: TextElement[][] = []
  for (let i = 0; i < multiCol.length; i++) {
    const r = multiCol[i]
    if (!cur.length) cur.push(r)
    else {
      const prev = cur[cur.length - 1]
      const gap = prev[0].origBaseline - r[0].origBaseline
      if (gap < 45) cur.push(r)
      else {
        if (cur.length >= 2) tableClusters.push(cur)
        cur = [r]
      }
    }
  }
  if (cur.length >= 2) tableClusters.push(cur)

  return tableClusters.map((cluster) => {
    const elementIds = new Set<string>()
    let top = -Infinity, bottom = Infinity
    for (const row of cluster) {
      for (const e of row) {
        elementIds.add(e.id)
        top = Math.max(top, e.origBox.y + e.origBox.h)
        bottom = Math.min(bottom, e.origBox.y)
      }
    }
    for (const e of live) {
      if (e.origBaseline >= bottom - 5 && e.origBaseline <= top + 5 && !elementIds.has(e.id) && e.text.length < 50) {
        elementIds.add(e.id)
        top = Math.max(top, e.origBox.y + e.origBox.h)
        bottom = Math.min(bottom, e.origBox.y)
      }
    }
    return { page, top, bottom, elementIds }
  })
}

// ---- 2.2 rows ---------------------------------------------------------------------------------------------

type Row = {
  anchor: TextElement | null; followers: TextElement[]
  lane: number                 // global lane key; -1 = spanner
  page: number                 // original source page
  origTop: number; origBottom: number
  deleted: boolean
  keepWithNext: boolean
  group: number; groupLast: boolean
  tableId?: string | null
  keepTogetherId?: string | null
  pinnedFurniture?: boolean
  object?: FlowObject | null
}

/**
 * Page furniture never flows. Footer: short text in the bottom edge band, or in the bottom FOOT_ZONE after a clear gap
 * (plus anything stacked under it), provided nothing but furniture lies beneath. Header: short text in the top edge band.
 * shortcut: no cross-page repetition check; add one if body text near the bottom gets pinned.
 */
function markFurniture(rows: Row[], pm: PageModel) {
  const top = pm.y0 + pm.height, zone = pm.y0 + FOOT_ZONE * pm.height
  const short = (r: Row) => !!r.anchor && !r.tableId && r.anchor.text.length < 80
  for (const r of rows) if (short(r) && r.origBottom > top - FURN_BAND) r.pinnedFurniture = true
  const seen: Row[] = []
  for (const r of [...rows].sort((a, b) => b.origTop - a.origTop)) {
    const sz = r.anchor?.style.size ?? 10
    const inBand = r.origTop < pm.y0 + FURN_BAND
    if (short(r) && !r.pinnedFurniture && (inBand || r.origTop < zone)) {
      const up = seen.filter((p) => p.origBottom > r.origTop + 0.3 * sz)          // strictly above: not the same line
      const near = up.reduce<Row | null>((a, p) => (!a || p.origBottom < a.origBottom ? p : a), null)
      if (inBand || (near ? near.origBottom - r.origTop >= 1.8 * sz || near.pinnedFurniture : false)) r.pinnedFurniture = true
    }
    if (!r.pinnedFurniture && seen.some((p) => p.pinnedFurniture && p.origTop < zone && p.origBottom > r.origTop + 0.3 * sz))
      for (const p of seen) if (p.pinnedFurniture && p.origTop < zone && p.origTop >= pm.y0 + FURN_BAND) p.pinnedFurniture = false   // body lies below: not a footer
    seen.push(r)
  }
}

function buildRows(doc: DocState, pm: PageModel, laneOf: Map<string, number>, keyOf: (li: number) => number, tableElMap?: Map<string, TableRegion>): Row[] {
  const els = doc.order.map((id) => doc.els[id]).filter((e) => e.page === pm.index && (!e.locked || e.created))
  const rows: Row[] = []
  const isTableCell = (id: string) => doc.tables?.some((t) => t.page === pm.index && t.cells.some((c) => c.elIds.includes(id)))

  for (const e of [...els].sort((a, b) => b.origBaseline - a.origBaseline || a.origX - b.origX)) {
    const lane = keyOf(laneOf.get(e.id) ?? -1)
    const inTable = isTableCell(e.id)

    const r = rows.find((q) => {
      if (!q.anchor) return false
      const sameBaseline = Math.abs(q.anchor.origBaseline - e.origBaseline) < 0.35 * Math.max(e.style.size, q.anchor.style.size)
      if (!sameBaseline) return false
      if (q.lane === lane) return true

      // If lane differs due to global page gutters, allow adjacent inline runs to group into the same row
      if (!inTable && !isTableCell(q.anchor.id) && !tableElMap?.has(e.id) && !tableElMap?.has(q.anchor.id)) {
        const right = Math.max(q.anchor.origBox.x + q.anchor.origBox.w, ...q.followers.map((f) => f.origBox.x + f.origBox.w))
        if (e.origBox.x >= right - 4 && e.origBox.x - right <= 36) {
          laneOf.set(e.id, laneOf.get(q.anchor.id) ?? -1)
          return true
        }
      }
      return false
    })

    if (r) { if (!e.deleted) r.followers.push(e) }
    else {
      const t = doc.tables?.find((tbl) => tbl.page === pm.index && tbl.cells.some((c) => c.elIds.includes(e.id)))
      const tableId = t ? t.id : (tableElMap?.has(e.id) ? `tr_${pm.index}_${Math.round(tableElMap.get(e.id)!.top)}` : null)
      rows.push({
        anchor: e, followers: [], lane, page: pm.index,
        origTop: e.origBox.y + e.origBox.h, origBottom: e.origBox.y,
        deleted: e.deleted, keepWithNext: false, group: -1, groupLast: false,
        tableId,
        keepTogetherId: tableId,
        pinnedFurniture: false,
        object: null,
      })
    }
  }
  rows.forEach((r) => r.followers.sort((a, b) => a.origX - b.origX))
  markFurniture(rows, pm)

  // Part B4: push one Row per inline object
  const tRules = tableRuleSet(doc, pm.index)   // table borders are redrawn by the table, not flowed as loose rows
  for (const o of (doc.objects ?? []).filter((x) => x.page === pm.index && x.flow === 'inline' && !x.locked && !isTableRule(x, tRules))) {
    rows.push({
      anchor: null,
      object: o,
      followers: [],
      lane: keyOf(laneOf.get(o.id) ?? -1),
      page: pm.index,
      origTop: o.rect.y + o.rect.h,
      origBottom: o.rect.y,
      deleted: false,
      keepWithNext: o.keepTogetherId !== null,
      keepTogetherId: o.keepTogetherId,
      tableId: null,
      group: -1,
      groupLast: false,
      pinnedFurniture: false
    })
  }
  return rows
}

/** Heading / paragraph-group annotations (reconstruct() heuristics, per lane). */
function annotate(rows: Row[], body: number): Map<number, number> {
  const byLane = new Map<number, Row[]>()
  for (const r of rows) (byLane.get(r.lane) ?? byLane.set(r.lane, []).get(r.lane)!).push(r)
  const totals = new Map<number, number>()
  let g = 0
  for (const list of byLane.values()) {
    list.sort((a, b) => a.page - b.page || b.origTop - a.origTop)
    let prev: Row | null = null, cur = -1
    for (const r of list) {
      if (!r.anchor || r.pinnedFurniture) { prev = null; continue }
      const e = r.anchor
      const bullet = MARKER.test(e.text)
      const heading = (e.style.size > body * 1.12 || (e.style.bold && e.text.length < 60 && !bullet)) && e.style.size >= body
      r.keepWithNext = heading
      const gap = prev ? prev.origBottom - r.origTop : 0
      const join = !prev && prev !== null ? false : !!prev && !!prev.anchor && prev.page === r.page && !heading && !prev.keepWithNext && !bullet &&
        sameLook(e.style, prev.anchor.style) && gap > 0.9 * e.style.size && gap < 1.7 * e.style.size &&
        Math.abs(e.origX - prev.anchor.origX) < 0.8 * e.style.size
      if (!join) cur = g++
      r.group = cur
      totals.set(cur, (totals.get(cur) ?? 0) + 1)
      prev = r
    }
    for (let i = 0; i < list.length; i++) list[i].groupLast = i === list.length - 1 || list[i + 1].group !== list[i].group
  }
  return totals
}

// ---- 2.3 cascade ------------------------------------------------------------------------------------------

type PlacedRow = {
  row: Row; page: number; top: number; bottom: number; baseline: number
  texts: string[]; lines: Line[]; from: number; rect: Rect
}
type LaneState = {
  flowPage: number; cursor: number | null; carried: boolean
  prevOrigBottom: number | null; prevOrigPage: number
  medianGap: number; placed: PlacedRow[]   // rows on the current flow page (widow/orphan backoff)
}

export function cascadeVerticalShift(doc: DocState, m: Measurer): CascadeResult {
  const sq = doc.flow?.squeeze ?? null
  const gapK = sq?.gapScale ?? 1

  let docLinePitchRatio = 1.33
  const pitches: number[] = []
  for (const pm of doc.pages) {
    const pageEls = doc.order.map((id) => doc.els[id]).filter((e) => e && e.page === pm.index)
    pageEls.sort((a, b) => b.origBaseline - a.origBaseline)
    for (let i = 1; i < pageEls.length; i++) {
      const dy = pageEls[i - 1].origBaseline - pageEls[i].origBaseline
      const sz = pageEls[i].style.size
      if (dy > sz * 0.9 && dy < sz * 1.8) pitches.push(dy / sz)
    }
  }
  if (pitches.length >= 3) {
    pitches.sort((x, y) => x - y)
    docLinePitchRatio = pitches[Math.floor(pitches.length / 2)]
  }
  const styleOf = (s: TextStyle): TextStyle => {
    const baseLh = (s.lineHeight === 1.2 || !s.lineHeight) ? docLinePitchRatio : s.lineHeight
    return sq ? { ...s, size: Math.max(6, s.size + sq.sizeDelta), lineHeight: baseLh * sq.lineHeightK } : { ...s, lineHeight: baseLh }
  }

  const shifts = new Map<string, FlowShift>(), rects = new Map<string, Rect>()
  const warnings: string[] = [], lanesOut: LaneBox[] = []
  const chunks = new Map<string, FlowChunk[]>()
  const repeats: CascadeResult['repeats'] = []
  const groupHeight = new Map<string, number>()
  const tableHeaders = new Map<string, Row[]>()
  const objectShifts = new Map<string, { page: number; dy: number; dx: number }>()
  const flowObjects: FlowObject[] = doc.objects ?? []

  const srcCount = doc.pages.length
  const body = bodySize(doc)
  const bottomOf = (p: number) => {
    const pm = doc.pages[Math.min(p, srcCount - 1)]
    const extracted = doc.contentBottom[Math.min(p, srcCount - 1)]
    const base = Math.min(extracted ?? (pm.y0 + 54), pm.y0 + 36)
    let foot = -Infinity                                  // footer furniture of the matching source page
    for (const r of allRows) if (r.pinnedFurniture && !r.deleted && r.page === Math.min(p, srcCount - 1) && r.origTop < pm.y0 + pm.height / 2) foot = Math.max(foot, r.origTop)
    return foot > -Infinity ? Math.max(base, foot + FOOT_PAD) : base
  }
  const pageDims = (p: number) => doc.pages[Math.min(p, srcCount - 1)]
  let maxPage = srcCount - 1

  // Strict identity fast-path: if no element has been edited and no squeeze applied,
  // return exact original layout immediately. Zero extra pages, zero drift, zero lag.
  const anyChanged = doc.order.some((id) => isChanged(doc.els[id]))
  if (!sq && !anyChanged) {
    for (const pm of doc.pages) {
      const els = doc.order.map((id) => doc.els[id]).filter((e) => e.page === pm.index)
      const { lanes } = findFlowLanes(els, pm)
      lanes.forEach((l, i) => lanesOut.push({ page: pm.index, index: i, ...l }))
    }
    for (const id of doc.order) {
      const el = doc.els[id]
      shifts.set(id, { baseline: el.origBaseline, page: el.page, dy: 0 })
      rects.set(id, el.origBox)
    }
    const pageBox = doc.pages.map((p) => ({ src: p.index, w: p.width, h: p.height }))
    return { shifts, rects, pageBox, pageCount: doc.pages.length, lanes: lanesOut, warnings: [], chunks, repeats, objectShifts }
  }

  // Global lane identity across pages: match per-page lanes by x-overlap against running templates.
  const templates: Array<{ x0: number; x1: number }> = []
  const keyOfPage = (pm: PageModel, boxes: Array<{ x0: number; x1: number }>) => (li: number): number => {
    if (li < 0) return -1
    const b = boxes[li]
    let best = -1, ov = 0
    templates.forEach((t, i) => {
      const o = Math.min(t.x1, b.x1) - Math.max(t.x0, b.x0)
      if (o > ov && o > 0.5 * Math.min(t.x1 - t.x0, b.x1 - b.x0)) { ov = o; best = i }
    })
    if (best < 0) { templates.push({ ...b }); best = templates.length - 1 }
    return best
  }

  // Collect all rows (all pages), annotate, build per-lane streams.
  const allRows: Row[] = []
  const allTableRegions: TableRegion[] = []
  const tableElMap = new Map<string, TableRegion>()
  for (const pm of doc.pages) {
    const els = doc.order.map((id) => doc.els[id]).filter((e) => e.page === pm.index)
    const regions = findTableRegions(els, pm.index)
    allTableRegions.push(...regions)
    for (const tr of regions) {
      for (const eid of tr.elementIds) tableElMap.set(eid, tr)
    }
  }
  for (const pm of doc.pages) {
    const els = doc.order.map((id) => doc.els[id]).filter((e) => e.page === pm.index)
    const tIds = tableCellIds(doc, pm.index)
    const { lanes, laneOf } = findFlowLanes(tIds.size ? els.filter((e) => !tIds.has(e.id)) : els, pm)
    assignTableLanes(doc, pm.index, lanes, laneOf)
    lanes.forEach((l, i) => lanesOut.push({ page: pm.index, index: i, ...l }))
    allRows.push(...buildRows(doc, pm, laneOf, keyOfPage(pm, lanes), tableElMap))
  }
  const groupTotals = annotate(allRows, body)
  for (const r of allRows) {
    if (r.keepTogetherId) {
      const h = r.origTop - r.origBottom
      groupHeight.set(r.keepTogetherId, (groupHeight.get(r.keepTogetherId) ?? 0) + h)
    }
  }
  for (const t of doc.tables ?? []) {
    const pl = layoutTable(t, doc, m, 0)
    groupHeight.set(t.id, pl.height)
    const headerElIds = new Set(t.cells.filter((c) => c.r < t.headerRows).flatMap((c) => c.elIds))
    const hRows = allRows.filter((r) => r.anchor && headerElIds.has(r.anchor.id))
    if (hRows.length) tableHeaders.set(t.id, hRows)
  }
  allRows.sort((a, b) => a.page - b.page || b.origTop - a.origTop)

  const states = new Map<number, LaneState>()
  const stateOf = (lane: number, firstPage: number): LaneState => {
    let st = states.get(lane)
    if (!st) {
      const gaps: number[] = []
      const rs = allRows.filter((r) => r.lane === lane && !r.pinnedFurniture)
      for (let i = 1; i < rs.length; i++) if (rs[i].page === rs[i - 1].page) gaps.push(Math.max(0, rs[i - 1].origBottom - rs[i].origTop))
      st = { flowPage: firstPage, cursor: null, carried: false, prevOrigBottom: null, prevOrigPage: firstPage, medianGap: median(gaps) || 6, placed: [] }
      states.set(lane, st)
    }
    return st
  }
  const gapBetween = (prevBottom: number | null, prevPage: number, r: Row, st: LaneState): number => {
    if (prevBottom === null) return 0
    // Crossing an ORIGINAL page boundary: carried content meets new page content.
    if (prevPage !== r.page) {
      const isHeading = r.keepWithNext || (r.anchor && r.anchor.style.size > body * 1.1)
      return (isHeading ? body * 1.8 : body * 1.25) * gapK
    }
    const g = prevBottom - r.origTop
    return (Number.isFinite(g) ? g : st.medianGap) * gapK   // same page: exact original gap
  }

  /**
   * Top of the writable region on a page.
   * Never above the margin, and never above where the page's own content originally began
   * (letterhead/logos sit above that). Pinned furniture is subtracted, not merged in.
   */
  const pageContentTop = (page: number): number => {
    const pm = pageDims(page)
    const marginTop = pm.y0 + pm.height - DEFAULT_TOP_MARGIN
    if (page >= srcCount) return marginTop
    let top = -Infinity
    for (const r of allRows) if (r.page === page && !r.deleted && !r.pinnedFurniture) top = Math.max(top, r.origTop)
    return Number.isFinite(top) ? Math.min(marginTop, top) : marginTop
  }

  /**
   * FIX 3 — where carried content starts on `page`.
   * ALWAYS the page's content top, never an existing row's origTop: that row is itself
   * about to be pushed down, so anchoring to it would collide (or drop us mid-page).
   */
  const laneTop = (lane: number, page: number): number => {
    let top = pageContentTop(page)
    const box = lanesOut.find((l) => l.page === Math.min(page, srcCount - 1) && l.index === lane)
    for (const o of flowObjects) {
      if (o.page !== page || o.flow !== 'pinned') continue
      if (box && !(o.rect.x < box.x1 && o.rect.x + o.rect.w > box.x0)) continue
      if (o.rect.y + o.rect.h > top - 1) top = Math.min(top, o.rect.y - 6)   // stay below the letterhead
    }
    return top
  }

  const placeRow = (r: Row, top: number, page: number, from = 0, count = Number.POSITIVE_INFINITY): PlacedRow => {
    if (r.object) {
      const o = r.object
      const dy = top - r.origTop
      objectShifts.set(o.id, { page, dy, dx: 0 })
      rects.set(o.id, { ...o.rect, y: o.rect.y + dy })
      maxPage = Math.max(maxPage, page)
      return {
        row: r, page, top, bottom: o.rect.y + dy, baseline: top,
        texts: [], lines: [], from: 0, rect: { ...o.rect, y: o.rect.y + dy }
      }
    }
    const a = r.anchor!
    const s = styleOf(a.style)
    const asc = r.origTop - a.origBaseline
    const manual = a.baseline - a.origBaseline
    const baseline = top - asc + manual
    const rowDy = baseline - a.baseline

    const fLeft = r.followers.length ? Math.min(...r.followers.map((f) => f.origBox.x)) : Infinity
    const effW = Math.max(20, Math.min(a.maxW, fLeft - a.x - 4))
    const alignW = Math.max(effW, a.origBox.w)

    const texts = r.deleted ? [] : wrapForFlow(a, effW, s, m)
    const take = Math.max(0, Math.min(count, texts.length - from))

    // FIX 2 — pin an untouched table cell ONLY on its own page and only if it has not
    // been pushed. `page > a.page` means the table has paginated: it must move, not pin.
    const pinned =
      r.tableId !== null && r.tableId !== undefined && from === 0 && sq === null &&
      !isChanged(a) && !r.followers.some((f) => isChanged(f)) &&
      page === a.page && top >= r.origTop - 1.5

    if (pinned) {
      shifts.set(a.id, { baseline: a.origBaseline, page: a.page, dy: 0 })
      rects.set(a.id, a.origBox)
      for (const f of r.followers) {
        shifts.set(f.id, { baseline: f.origBaseline, page: f.page, dy: 0 })
        rects.set(f.id, f.origBox)
      }
      maxPage = Math.max(maxPage, page)
      return { row: r, page, top: r.origTop, bottom: a.origBox.y, baseline: a.origBaseline, texts, lines: [], from: 0, rect: a.origBox }
    }

    const placed = take > 0 ? placeLines(texts.slice(from, from + take), a.x, baseline, effW, s, m, alignW) : null
    // Row bottom uses the ORIGINAL descent so unedited rows keep their exact pitch (no per-row drift against borders).
    const origDesc = (a.origBaseline - a.origBox.y) * (s.size / (a.originalStyle.size || s.size))
    const descFix = a.created ? 0 : origDesc - 0.22 * s.size
    let bottom = placed ? placed.rect.y - descFix : top - asc - descenderOf(s)
    const rect = placed?.rect ?? { x: a.x, y: bottom, w: effW, h: Math.max(1, top - bottom) }

    if (!r.deleted && take > 0) {
      // A split element anchors its overlay/edit target at the FIRST chunk only.
      if (from === 0 || !shifts.has(a.id)) {
        shifts.set(a.id, { baseline, page, dy: baseline - a.origBaseline })
        rects.set(a.id, rect)
      }
    }
    if (from === 0) {                                   // satellites ride the first line, never a continuation
      for (const f of r.followers) {
        const fb = f.baseline + rowDy
        const fp = layoutElement({ ...f, style: styleOf(f.style), baseline: fb }, m)
        shifts.set(f.id, { baseline: fb, page, dy: fb - f.origBaseline })
        rects.set(f.id, fp.rect)
        bottom = Math.min(bottom, fp.rect.y - (f.created ? 0 : (f.origBaseline - f.origBox.y) * (f.style.size / (f.originalStyle.size || f.style.size)) - 0.22 * f.style.size))
      }
    }
    maxPage = Math.max(maxPage, page)
    return { row: r, page, top, bottom, baseline, texts, lines: placed?.lines ?? [], from, rect }
  }

  const pushChunk = (r: Row, rec: PlacedRow) => {
    const id = r.anchor!.id
    const list = chunks.get(id) ?? []
    list.push({ id, page: rec.page, from: rec.from, count: rec.lines.length, baseline: rec.baseline, lines: rec.lines, rect: rec.rect })
    chunks.set(id, list)
  }

  const regionH = (p: number) => pageContentTop(p) - bottomOf(p)

  /** Place one row, paginating and splitting as needed. Returns the LAST placed chunk. */
  const flowRow = (r: Row, st: LaneState, startTop: number, startPage: number): PlacedRow => {
    let page = startPage, top = startTop
    let rec = placeRow(r, top, page)

    for (;;) {
      const limit = bottomOf(page)
      if (r.deleted) return rec
      if (rec.bottom >= limit) {
        st.placed.push(rec)
        return rec
      }

      // ---- (a) FIX 4: split a multi-line element across the boundary ----
      const total = rec.texts.length, avail = total - rec.from
      if (avail > 1 && (!r.tableId || r.tableId === null)) {
        const s = styleOf(r.anchor!.style)
        const fit = countFittingLines(rec.lines, s, limit)
        const firstOnPage = st.placed.length === 0
        // Widow/orphan: don't strand 1 line on either side unless the page is otherwise empty.
        const canSplit = fit >= 1 && fit < avail && (firstOnPage || (fit >= 2 && avail - fit >= 2))
        if (canSplit) {
          const head = placeRow(r, top, page, rec.from, fit)
          st.cursor = head.bottom; st.placed.push(head); st.flowPage = page
          pushChunk(r, head)
          let rest = rec.from + fit
          while (rest < total) {
            page++
            if (page > srcCount + MAX_EXTRA_PAGES) { warnings.push('Stopped adding pages after 200 extra pages.'); break }
            st.flowPage = page; st.carried = true; st.placed = []
            const cTop = laneTop(r.lane, page)                       // FIX 3: top margin, not a stale cursor
            const probe = placeRow(r, cTop, page, rest, total - rest)
            let take2 = total - rest
            if (probe.bottom < bottomOf(page)) {
              take2 = Math.max(1, countFittingLines(probe.lines, s, bottomOf(page)))
              if (take2 >= 3 && total - rest - take2 === 1) take2--  // no 1-line widow on the following page
            }
            const chunk = placeRow(r, cTop, page, rest, take2)
            st.cursor = chunk.bottom; st.placed.push(chunk)
            pushChunk(r, chunk)
            rest += take2
          }
          return st.placed[st.placed.length - 1] ?? head
        }
      }

      // ---- (b) nothing fits here: move the row (and its group) to the next page ----
      if (st.placed.length === 0) {
        warnings.push(`A line on page ${page + 1} is taller than the text region; it was kept on the page.`)
        return rec
      }

      let bs = st.placed.length
      const kt = r.keepTogetherId
      // Keep a table/figure intact — UNLESS it is taller than a whole page, in which case
      // it must break at row boundaries (with its header repeated) rather than overflow.
      const groupFits = kt ? (groupHeight.get(kt) ?? 0) <= regionH(page + 1) : true
      if (kt && groupFits) {
        while (bs > 0 && st.placed[bs - 1].page === page && st.placed[bs - 1].row.keepTogetherId === kt) bs--
      }
      // Widow/orphan + keep-with-next (unchanged rules, applied after the group pullback).
      const groupOnPage = (g: number) => st.placed.filter((p) => p.row.group === g && p.page === page).length
      while (bs > 0) {
        const prev = st.placed[bs - 1]
        if (prev.page !== page) break
        const pr = prev.row
        const sameGroup = pr.group === r.group && (groupTotals.get(pr.group) ?? 1) > 2
        const orphan = sameGroup && groupOnPage(pr.group) === 1
        const widow = sameGroup && r.groupLast && st.placed.length - bs === 0
        if ((pr.keepWithNext || orphan || widow) && (bs > 1 || page >= srcCount)) bs--
        else break
      }
      if (bs === 0 && page < srcCount && st.placed.length > 0) bs = 1   // never empty a source page

      const moved = st.placed.splice(bs)
      page++
      if (page > srcCount + MAX_EXTRA_PAGES) { warnings.push('Stopped adding pages after safe page limit.'); st.placed.push(rec); return rec }
      st.flowPage = page; st.carried = true; st.placed = []
      st.cursor = laneTop(r.lane, page)                                 // FIX 3: reset on EVERY advance

      // Repeat a split table's header rows at the top of the new page.
      if (kt && !groupFits) {
        for (const hr of tableHeaders.get(kt) ?? []) {
          const hrec = placeRow(hr, st.cursor, page)
          repeats.push({ id: hr.anchor!.id, page, baseline: hrec.baseline })
          st.cursor = hrec.bottom - st.medianGap * gapK
        }
      }

      let prevB: number | null = null
      for (const mv of moved) {
        const g2 = prevB === null ? 0 : (prevB - mv.row.origTop) * gapK
        const t2 = (st.cursor ?? mv.row.origTop) - g2
        const rec2 = flowRow(mv.row, st, t2, page)                      // recursive: a pulled row may itself split
        st.cursor = rec2.bottom; prevB = mv.row.origBottom
        page = st.flowPage
      }
      top = (st.cursor ?? r.origTop) - (prevB === null ? 0 : (prevB - r.origTop) * gapK)
      rec = placeRow(r, top, page)
    }
  }

  for (const r of allRows) {
    // ---- header/footer furniture: stays put, outside every lane ----
    if (r.pinnedFurniture) {
      for (const e of [r.anchor!, ...r.followers]) {
        if (e.deleted) continue
        shifts.set(e.id, { baseline: e.baseline, page: e.page, dy: e.baseline - e.origBaseline })
        rects.set(e.id, isChanged(e) ? layoutElement(e, m).rect : e.origBox)
      }
      maxPage = Math.max(maxPage, r.page)
      continue
    }
    // ---- spanner: full-width barrier across all lanes ----
    if (r.lane < 0) {
      const laneStates = [...states.values()]
      const lanesOnPage = laneStates.filter((s) => s.prevOrigPage === r.page)
      const targetPage = Math.max(r.page, ...lanesOnPage.map((s) => s.flowPage))
      let page = targetPage
      let top = Infinity
      for (const st of laneStates) {
        if (st.flowPage !== page || st.cursor === null) continue
        const g = gapBetween(st.prevOrigBottom, st.prevOrigPage, r, st)
        top = Math.min(top, st.cursor - g)
      }
      if (!isFinite(top) || (!sq && top > r.origTop)) top = r.origTop
      const repState = laneStates[0] ?? stateOf(0, page)
      const last = flowRow(r, repState, top, page)
      const finalPage = repState.flowPage
      for (const l of lanesOut.filter((l) => l.page === r.page)) {
        stateOf(l.index, r.page)
      }
      for (const [, st] of states) {
        if (st.flowPage < finalPage) { st.flowPage = finalPage; st.carried = true; st.cursor = last.bottom; st.placed = [] }
        else if (st.flowPage === finalPage) st.cursor = Math.min(st.cursor ?? Infinity, last.bottom)
        st.prevOrigBottom = r.origBottom; st.prevOrigPage = r.page
      }
      if (r.deleted) continue
      continue
    }

    // ---- lane row ----
    const st = stateOf(r.lane, r.page)

    // FIX 1a: read the previous ORIGINAL page BEFORE any mutation.
    const prevOrigPage = st.prevOrigPage
    if (prevOrigPage !== r.page) {
      if (st.flowPage < r.page) {
        // FIX 1b: the stream reached an original page the flow has not reached yet.
        // Advance (never backwards) and start that page at its original geometry.
        st.flowPage = r.page
        st.carried = false
        st.cursor = null
        st.placed = []
      } else if (!st.carried && st.flowPage === r.page) {
        st.cursor = null
        st.placed = []
      }
      // else: carried content is already on/ahead of this page → keep the cursor,
      // and gapBetween() will return medianGap because prevOrigPage !== r.page.
    }

    // FIX 1c: gap computed with the OLD page. cursor === null ⇒ gap 0 ⇒ exact identity.
    const gap = st.cursor === null ? 0 : gapBetween(st.prevOrigBottom, prevOrigPage, r, st)
    const top = st.cursor === null ? r.origTop : st.cursor - gap

    const last = flowRow(r, st, top, st.flowPage)
    if (!r.deleted) st.cursor = last.bottom
    st.prevOrigBottom = r.origBottom
    st.prevOrigPage = r.page          // updated AFTER gap + placement, never before
  }

  // ---- output page boxes + obstacle warnings ----
  const pageBox: CascadeResult['pageBox'] = []
  for (let p = 0; p <= maxPage; p++) { const pm = pageDims(p); pageBox.push({ src: p < srcCount ? p : null, w: pm.width, h: pm.height }) }
  const locked = doc.order.map((id) => doc.els[id]).filter((e) => e.locked && !e.deleted)
  for (const [id, rect] of rects) {
    const sh = shifts.get(id)
    if (!sh || !doc.els[id]) continue
    if (Math.abs(sh.dy) < 0.01 && sh.page === doc.els[id].page) continue
    for (const lk of locked) {
      if (lk.page === sh.page && intersects(rect, lk.origBox, 0.8)) {
        warnings.push(`Moved text on page ${sh.page + 1} overlaps locked text "${lk.text.slice(0, 24)}".`); break
      }
    }
    const pm = doc.pages[Math.min(sh.page, srcCount - 1)]
    if (pm.images || pm.paints > 3) warnings.push(`Page ${sh.page + 1} has images/graphics that Live Flow cannot detect; check moved text visually.`)
  }

  // Table cells that are not flow rows (locked text) travel with their row, so text and grid stay in lockstep.
  for (const t of doc.tables ?? []) {
    for (let r = 0; r < t.ys.length - 1; r++) {
      const ids = t.cells.filter((c) => c.r === r).flatMap((c) => c.elIds).filter((id) => doc.els[id] && !doc.els[id].deleted)
      const ref = ids.map((id) => shifts.get(id)).find((s) => s && !doc.els[ids.find((i) => shifts.get(i) === s)!].locked)
      if (!ref) continue
      for (const id of ids) {
        const e = doc.els[id]
        if (!e.locked || e.cover || e.created || shifts.has(id)) continue
        shifts.set(id, { baseline: e.origBaseline + ref.dy, page: ref.page, dy: ref.dy })
        rects.set(id, { ...e.origBox, y: e.origBox.y + ref.dy })
      }
    }
  }

  // Anchored objects: copy dy and page from their anchor text element
  for (const o of flowObjects) {
    if (o.flow === 'anchored' && o.anchorId) {
      const sh = shifts.get(o.anchorId)
      if (sh) {
        objectShifts.set(o.id, { page: sh.page, dy: sh.dy, dx: 0 })
      }
    }
  }

  return { shifts, rects, pageBox, pageCount: pageBox.length, lanes: lanesOut, warnings: [...new Set(warnings)], chunks, repeats, objectShifts }
}

