// core/flow.ts
// Live Flow cascade for Design Lock: lane-isolated Delta-h pushdown/pullup, follower anchoring,
// spanner barriers, per-lane pagination with widow/orphan control. Pure + memoizable.
// PDF points, bottom-left origin. No engine/Plan changes required to consume this.
import type { DocState, TextElement, TextStyle, PageModel, Rect } from './types.ts'
import type { Measurer } from './fonts.ts'
import { layoutElement } from './layout.ts'
import { intersects } from './geometry.ts'
import { isChanged } from './plan.ts'

export type FlowShift = { baseline: number; page: number; dy: number } // dy = baseline - origBaseline
export type LaneBox = { page: number; x0: number; x1: number }
export type CascadeResult = {
  shifts: Map<string, FlowShift>
  rects: Map<string, Rect>                       // post-flow boxes -> overlays + collision checks
  pageBox: Array<{ src: number | null; w: number; h: number }>
  pageCount: number
  lanes: LaneBox[]                               // for optional UI lane guides
  warnings: string[]
}

const MARKER = /^\s*([-•–*▪◦·]|\d+[.)])\s+/
const GUTTER_MIN = 12          // pt of empty vertical projection that separates columns
const SPAN_RATIO = 0.6         // box wider than this fraction of content width => spanner
const MIN_LANE_MASS = 6        // chars; below this a "lane" is noise (page numbers…)
const DEFAULT_TOP_MARGIN = 54  // matches reflow.ts default for appended pages
const MAX_EXTRA_PAGES = 5      // safe cap: never runaway to hundreds of phantom pages

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

  // Assign: crossing a gutter (or very wide) => spanner (-1); else max-overlap lane.
  const mass = lanes.map(() => 0)
  for (const e of live) {
    const a = e.origBox.x - pm.x0, b = a + e.origBox.w
    if (cuts.some((c) => a < c - 1 && b > c + 1) || e.origBox.w >= SPAN_RATIO * (max - min)) { laneOf.set(e.id, -1); continue }
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
  anchor: TextElement; followers: TextElement[]
  lane: number                 // global lane key; -1 = spanner
  page: number                 // original source page
  origTop: number; origBottom: number
  deleted: boolean
  keepWithNext: boolean
  group: number; groupLast: boolean
}

function buildRows(doc: DocState, pm: PageModel, laneOf: Map<string, number>, keyOf: (li: number) => number): Row[] {
  const els = doc.order.map((id) => doc.els[id]).filter((e) => e.page === pm.index && (!e.locked || e.created))
  const rows: Row[] = []
  for (const e of [...els].sort((a, b) => b.origBaseline - a.origBaseline || a.origX - b.origX)) {
    const lane = keyOf(laneOf.get(e.id) ?? -1)
    const r = rows.find((q) => q.lane === lane &&
      Math.abs(q.anchor.origBaseline - e.origBaseline) < 0.35 * Math.max(e.style.size, q.anchor.style.size))
    if (r) { if (!e.deleted) r.followers.push(e) }
    else rows.push({
      anchor: e, followers: [], lane, page: pm.index,
      origTop: e.origBox.y + e.origBox.h, origBottom: e.origBox.y,
      deleted: e.deleted, keepWithNext: false, group: -1, groupLast: false,
    })
  }
  rows.forEach((r) => r.followers.sort((a, b) => a.origX - b.origX))
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
      const e = r.anchor
      const bullet = MARKER.test(e.text)
      const heading = (e.style.size > body * 1.12 || (e.style.bold && e.text.length < 60 && !bullet)) && e.style.size >= body
      r.keepWithNext = heading
      const gap = prev ? prev.origBottom - r.origTop : 0
      const join = !prev && prev !== null ? false : !!prev && prev.page === r.page && !heading && !prev.keepWithNext && !bullet &&
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

type PlacedRow = { row: Row; page: number; top: number; bottom: number; baseline: number }
type LaneState = {
  flowPage: number; cursor: number | null; carried: boolean
  prevOrigBottom: number | null; prevOrigPage: number
  medianGap: number; placed: PlacedRow[]   // rows on the current flow page (widow/orphan backoff)
}

export function cascadeVerticalShift(doc: DocState, m: Measurer): CascadeResult {
  const sq = doc.flow?.squeeze ?? null
  const gapK = sq?.gapScale ?? 1
  const styleOf = (s: TextStyle): TextStyle =>
    sq ? { ...s, size: Math.max(6, s.size + sq.sizeDelta), lineHeight: s.lineHeight * sq.lineHeightK } : s

  const shifts = new Map<string, FlowShift>(), rects = new Map<string, Rect>()
  const warnings: string[] = [], lanesOut: LaneBox[] = []
  const srcCount = doc.pages.length
  const body = bodySize(doc)
  const bottomOf = (p: number) => {
    const pm = doc.pages[Math.min(p, srcCount - 1)]
    const extracted = doc.contentBottom[Math.min(p, srcCount - 1)]
    return Math.min(extracted ?? (pm.y0 + 54), pm.y0 + 36)
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
      lanes.forEach((l) => lanesOut.push({ page: pm.index, ...l }))
    }
    for (const id of doc.order) {
      const el = doc.els[id]
      shifts.set(id, { baseline: el.origBaseline, page: el.page, dy: 0 })
      rects.set(id, el.origBox)
    }
    const pageBox = doc.pages.map((p) => ({ src: p.index, w: p.width, h: p.height }))
    return { shifts, rects, pageBox, pageCount: doc.pages.length, lanes: lanesOut, warnings: [] }
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
    const { lanes, laneOf } = findFlowLanes(els, pm)
    lanes.forEach((l) => lanesOut.push({ page: pm.index, ...l }))
    allRows.push(...buildRows(doc, pm, laneOf, keyOfPage(pm, lanes)))
    const regions = findTableRegions(els, pm.index)
    allTableRegions.push(...regions)
    for (const tr of regions) {
      for (const eid of tr.elementIds) tableElMap.set(eid, tr)
    }
  }
  const groupTotals = annotate(allRows, body)
  allRows.sort((a, b) => a.page - b.page || b.origTop - a.origTop)

  const states = new Map<number, LaneState>()
  const stateOf = (lane: number, firstPage: number): LaneState => {
    let st = states.get(lane)
    if (!st) {
      const gaps: number[] = []
      const rs = allRows.filter((r) => r.lane === lane)
      for (let i = 1; i < rs.length; i++) if (rs[i].page === rs[i - 1].page) gaps.push(Math.max(0, rs[i - 1].origBottom - rs[i].origTop))
      st = { flowPage: firstPage, cursor: null, carried: false, prevOrigBottom: null, prevOrigPage: firstPage, medianGap: median(gaps) || 6, placed: [] }
      states.set(lane, st)
    }
    return st
  }
  const laneTop = (lane: number, page: number): number => {
    const pm = pageDims(page)
    const pageRows = allRows.filter((x) => x.page === page && !x.deleted)
    if (pageRows.length) {
      const topRow = pageRows.reduce((a, b) => (b.origTop > a.origTop ? b : a), pageRows[0])
      return topRow.origTop
    }
    return pm.y0 + pm.height - DEFAULT_TOP_MARGIN
  }

  /** Place one row at `top` on `page`; write absolute targets for anchor + followers. */
  const placeRow = (r: Row, top: number, page: number): PlacedRow => {
    const a = r.anchor
    const inTable = tableElMap.has(a.id)

    // Pin unedited table cells to their exact original positions inside vector grid boxes
    // when the text from above fits within the available space before the table
    if (inTable && !isChanged(a) && sq === null && !r.followers.some((f) => isChanged(f))) {
      if (top >= r.origTop - 1.5) {
        shifts.set(a.id, { baseline: a.origBaseline, page: a.page, dy: 0 })
        rects.set(a.id, a.origBox)
        for (const f of r.followers) {
          shifts.set(f.id, { baseline: f.origBaseline, page: f.page, dy: 0 })
          rects.set(f.id, f.origBox)
        }
        maxPage = Math.max(maxPage, a.page)
        return { row: r, page: a.page, top: r.origTop, bottom: r.origBottom, baseline: a.origBaseline }
      }
    }

    const asc = r.origTop - a.origBaseline
    const manual = a.baseline - a.origBaseline               // honor Alt+Arrow nudges
    const baseline = top - asc + manual
    const rowDy = baseline - a.origBaseline
    let bottom = r.origBottom + rowDy

    if (!r.deleted) {
      const changed = isChanged(a) || sq !== null || Math.abs(rowDy) > 0.05
      if (changed) {
        const fLeft = r.followers.length ? Math.min(...r.followers.map((f) => f.origBox.x)) : Infinity
        const effW = Math.max(20, Math.min(a.maxW, fLeft - a.x - 4))
        const placed = layoutElement({ ...a, style: styleOf(a.style), wrap: true, maxW: effW, baseline }, m)
        shifts.set(a.id, { baseline, page, dy: rowDy })
        rects.set(a.id, placed.rect)
        bottom = placed.rect.y
      } else {
        shifts.set(a.id, { baseline: a.origBaseline, page, dy: 0 })
        rects.set(a.id, a.origBox)
        bottom = r.origBottom
      }
    }
    for (const f of r.followers) {                           // satellites ride the anchor's FIRST line
      if (Math.abs(rowDy) > 0.05 || sq !== null || isChanged(f)) {
        const fb = f.baseline + rowDy
        const fp = layoutElement({ ...f, style: styleOf(f.style), baseline: fb }, m)
        shifts.set(f.id, { baseline: fb, page, dy: fb - f.origBaseline })
        rects.set(f.id, fp.rect)
        bottom = Math.min(bottom, fp.rect.y)
      } else {
        shifts.set(f.id, { baseline: f.origBaseline, page, dy: 0 })
        rects.set(f.id, f.origBox)
      }
    }
    maxPage = Math.max(maxPage, page)
    return { row: r, page, top, bottom, baseline }
  }

  const gapBetween = (prevBottom: number | null, prevPage: number, r: Row, st: LaneState) =>
    prevBottom === null ? 0 : (prevPage === r.page ? prevBottom - r.origTop : st.medianGap) * gapK

  for (const r of allRows) {
    // ---- spanner: full-width barrier across all lanes ----
    if (r.lane < 0) {
      const laneStates = [...states.values()]
      const lanesOnPage = laneStates.filter((s) => s.prevOrigPage === r.page)
      const targetPage = Math.max(r.page, ...lanesOnPage.map((s) => s.flowPage))
      let page = targetPage
      let top = Infinity
      for (const st of laneStates) {
        if (st.flowPage !== page || st.cursor === null) continue
        let g = gapBetween(st.prevOrigBottom, st.prevOrigPage, r, st)
        const minSectionGap = Math.max(3.5, body * 0.35)
        if (g > minSectionGap && !sq) {
          const currentPush = (st.prevOrigBottom ?? 0) - st.cursor
          if (currentPush > 0.5) {
            const headroom = Math.max(0, g - minSectionGap)
            g -= Math.min(headroom, currentPush)
          }
        }
        top = Math.min(top, st.cursor - g)
      }
      if (!isFinite(top) || (!sq && top > r.origTop)) top = r.origTop
      let rec = placeRow(r, top, page)
      const isDisplaced = (r.origTop - top) > 1 || page > r.page
      if (!r.deleted && isDisplaced && rec.bottom < bottomOf(page)) {
        page++; top = pageDims(page).y0 + pageDims(page).height - DEFAULT_TOP_MARGIN
        rec = placeRow(r, top, page)
      }
      for (const [, st] of states) {
        if (st.flowPage < page) { st.flowPage = page; st.carried = true; st.cursor = rec.bottom; st.placed = [] }
        else if (st.flowPage === page) st.cursor = Math.min(st.cursor ?? Infinity, rec.bottom)
        st.prevOrigBottom = r.origBottom; st.prevOrigPage = r.page
      }
      if (r.deleted) continue
      continue
    }

    // ---- lane row ----
    const st = stateOf(r.lane, r.page)
    if (st.prevOrigPage !== r.page) {
      if (!st.carried && st.flowPage === r.page) {
        st.cursor = null
        st.placed = []
      }
      st.prevOrigPage = r.page
    }
    let gap = gapBetween(st.prevOrigBottom, st.prevOrigPage, r, st)
    const minSectionGap = Math.max(3.5, body * 0.35)
    if (st.cursor !== null && gap > minSectionGap && !sq) {
      const currentPush = (st.prevOrigBottom ?? 0) - st.cursor
      if (currentPush > 0.5) {
        const headroom = Math.max(0, gap - minSectionGap)
        gap -= Math.min(headroom, currentPush)
      }
    }
    let page = st.flowPage
    let top = st.cursor === null ? r.origTop : st.cursor - gap

    for (;;) {                                               // placement + pagination (terminates: empty-page guard)
      const rec = placeRow(r, top, page)
      const limit = bottomOf(page)
      const isDisplaced = (r.origBottom - rec.bottom) > 1 || page > r.page
      const overflows = !r.deleted && isDisplaced && rec.bottom < limit && st.placed.length > 0
      if (r.deleted || !overflows) {
        if (!r.deleted && rec.bottom < limit && isDisplaced) warnings.push(`A line on page ${page + 1} is taller than the text region; it was kept on the page.`)
        if (!r.deleted) { st.cursor = rec.bottom; st.placed.push(rec) }
        else if (r.followers.length) st.cursor = Math.min(st.cursor ?? rec.bottom, rec.bottom)
        break
      }
      // Widow/orphan backoff: decide how many trailing rows travel to the next page with r.
      let bs = st.placed.length
      const groupOnPage = (g: number) => st.placed.filter((p) => p.row.group === g && p.page === page).length
      while (bs > 0) {
        const pr = st.placed[bs - 1].row
        if (st.placed[bs - 1].page !== page) break
        const sameGroup = pr.group === r.group && (groupTotals.get(pr.group) ?? 1) > 2
        const orphan = sameGroup && groupOnPage(pr.group) === 1
        const widow = sameGroup && r.groupLast && (st.placed.length - bs) === 0
        if ((pr.keepWithNext || orphan || widow) && (bs > 1 || page >= srcCount)) bs--
        else break
      }
      const moved = st.placed.splice(bs)
      page++
      if (page > srcCount + MAX_EXTRA_PAGES) { warnings.push('Stopped adding pages after safe page limit.'); st.placed.push(rec); break }
      st.flowPage = page; st.carried = true; st.placed = []
      st.cursor = laneTop(r.lane, page)
      let prevB: number | null = null
      for (const mv of moved) {                              // re-place pulled-back rows, preserving their gaps
        const g2 = prevB === null ? 0 : (prevB - mv.row.origTop) * gapK
        const t2 = (st.cursor ?? mv.row.origTop) - g2
        const rec2 = placeRow(mv.row, t2, page)
        st.cursor = rec2.bottom; st.placed.push(rec2); prevB = mv.row.origBottom
      }
      top = (st.cursor ?? r.origTop) - (prevB === null ? 0 : (prevB - r.origTop) * gapK)
    }
    st.prevOrigBottom = r.origBottom; st.prevOrigPage = r.page
  }

  // ---- output page boxes + obstacle warnings ----
  const pageBox: CascadeResult['pageBox'] = []
  for (let p = 0; p <= maxPage; p++) { const pm = pageDims(p); pageBox.push({ src: p < srcCount ? p : null, w: pm.width, h: pm.height }) }
  const locked = doc.order.map((id) => doc.els[id]).filter((e) => e.locked && !e.deleted)
  for (const [id, rect] of rects) {
    const sh = shifts.get(id)!
    if (Math.abs(sh.dy) < 0.01 && sh.page === doc.els[id].page) continue
    for (const lk of locked) {
      if (lk.page === sh.page && intersects(rect, lk.origBox, 0.8)) {
        warnings.push(`Moved text on page ${sh.page + 1} overlaps locked text "${lk.text.slice(0, 24)}".`); break
      }
    }
    const pm = doc.pages[Math.min(sh.page, srcCount - 1)]
    if (pm.images || pm.paints > 3) warnings.push(`Page ${sh.page + 1} has images/graphics that Live Flow cannot detect; check moved text visually.`)
  }
  return { shifts, rects, pageBox, pageCount: pageBox.length, lanes: lanesOut, warnings: [...new Set(warnings)] }
}
