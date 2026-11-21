// Document Reflow: reconstruct paragraphs from lines, flow them with pagination, compile to a Plan.
import type { DocState, Plan, PlanPage, Block, TextElement, TextStyle, Draw } from './types.ts'
import type { Measurer } from './fonts.ts'
import { wrapText, placeLines, layoutElement } from './layout.ts'
import type { Line } from './layout.ts'
import { drawsForLines, isChanged } from './plan.ts'
import { verticalOverlap } from './geometry.ts'

const MARKER = /^\s*([-•–*▪◦·]|\d+[.)])\s+/
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const sameLook = (a: TextStyle, b: TextStyle) => a.family === b.family && a.bold === b.bold && a.italic === b.italic && Math.abs(a.size - b.size) < 0.3 && a.color.every((c, i) => Math.abs(c - b.color[i]) < 0.02)

/** Group unlocked lines into blocks. Right-hand items on a line's row become followers instead of blocks. */
export function reconstruct(doc: DocState): { blocks: Block[]; notes: string[] } {
  const blocks: Block[] = [], notes: string[] = []
  const sizes: Record<string, number> = {}
  for (const id of doc.order) { const e = doc.els[id]; if (!e.locked) sizes[e.style.size] = (sizes[e.style.size] ?? 0) + e.text.length }
  const body = Number(Object.entries(sizes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11)
  let n = 0
  for (const pm of doc.pages) {
    if (!pm.editable) continue
    const els = doc.order.map((k) => doc.els[k]).filter((e) => e.page === pm.index && !e.locked)
    // rows: elements sharing a baseline; the leftmost is the flow line, others follow it
    const rows: TextElement[][] = []
    for (const e of [...els].sort((a, b) => b.origBaseline - a.origBaseline || a.origX - b.origX)) {
      const r = rows.find((q) => Math.abs(q[0].origBaseline - e.origBaseline) < 0.35 * e.style.size)
      r ? r.push(e) : rows.push([e])
    }
    rows.forEach((r) => r.sort((a, b) => a.origX - b.origX))
    if (rows.some((r) => r.length > 1 && r[1].origBox.w > pm.width * 0.3)) notes.push(`Page ${pm.index + 1} looks multi-column; side-by-side text moves together row by row.`)
    let cur: Block | null = null, prevRow: TextElement[] | null = null
    for (const r of rows) {
      const e = r[0]
      const isBullet = MARKER.test(e.text)
      const heading = (e.style.size > body * 1.12 || (e.style.bold && e.text.length < 60 && !isBullet)) && e.style.size >= body
      const prev: TextElement | null = prevRow ? prevRow[0] : null
      const gap = prev ? prev.origBaseline - e.origBaseline : 0
      const join = !!cur && !!prev && r.length === 1 && prevRow!.length === 1 && cur.role !== 'heading' && !heading && !isBullet &&
        sameLook(e.style, prev.style) && gap > 0.9 * e.style.size && gap < 1.7 * e.style.size && Math.abs(e.origX - prev.origX) < 0.8 * e.style.size
      if (join && cur) {
        cur.lineIds.push(e.id); cur.text += ' ' + e.text; cur.bottom = Math.min(cur.bottom, e.origBox.y); cur.width = Math.min(cur.width, e.maxW)
      } else {
        const spaceBefore = cur && cur.page === pm.index ? Math.max(0, cur.bottom - (e.origBox.y + e.origBox.h)) : 0
        cur = {
          id: `b${n++}`, page: pm.index, lineIds: [e.id], role: heading ? 'heading' : isBullet ? 'bullet' : 'paragraph', included: true,
          text: e.text, edited: false, style: e.style, x: e.origX, width: e.maxW, top: e.origBox.y + e.origBox.h, bottom: e.origBox.y,
          spaceBefore, pitchK: 1.2, followers: [], spacing: 1,
        }
        blocks.push(cur)
      }
      r.slice(1).forEach((f) => cur!.followers.push({ id: f.id, line: cur!.lineIds.length - 1 }))
      prevRow = r
    }
  }
  for (const b of blocks) {
    const ys = b.lineIds.map((id) => doc.els[id].origBaseline)
    if (ys.length > 1) b.pitchK = median(ys.slice(1).map((y, i) => ys[i] - y)) / b.style.size
  }
  return { blocks, notes }
}

export type PlacedBlock = { block: Block; page: number; from: number; lines: Line[]; lineBaselines: number[]; markerDraw: Draw | null; redraw: boolean; rect: { top: number; bottom: number } }
export type Flow = { placed: PlacedBlock[]; pageCount: number; warnings: string[]; pageBox: Array<{ src: number | null; w: number; h: number }> }

const ms = (s: TextStyle) => ({ family: s.family, bold: s.bold, italic: s.italic, size: s.size, charSpacing: s.charSpacing, wordSpacing: s.wordSpacing })

/** Lines + vertical metrics for one block under its current text/style. Unedited blocks keep their original line breaks. */
function blockLines(doc: DocState, b: Block, m: Measurer) {
  const first = doc.els[b.lineIds[0]]
  const asc = first.origBox.y + first.origBox.h - first.origBaseline, desc = first.origBaseline - first.origBox.y
  if (!b.edited) {
    const ys = b.lineIds.map((id) => doc.els[id].origBaseline)
    return { texts: b.lineIds.map((id) => doc.els[id].text), offsets: ys.map((y) => ys[0] - y), asc, desc, indent: 0, marker: null as string | null, exact: true }
  }
  const mk = b.role === 'bullet' ? MARKER.exec(b.text) : null
  const marker = mk ? mk[1] : null
  const body = mk ? b.text.slice(mk[0].length) : b.text
  const indent = marker ? m.width(marker + ' ', ms(b.style)) : 0
  const texts = wrapText(body, Math.max(10, b.width - indent), b.style, m)
  const pitch = b.style.size * b.pitchK * (b.style.lineHeight / 1.2)
  const k = b.style.size / first.style.size
  return { texts, offsets: texts.map((_, i) => i * pitch), asc: asc * k, desc: desc * k, indent, marker, exact: false }
}

type Unit = { b: Block; from: number; cont: boolean }

export function layoutFlow(doc: DocState, m: Measurer): Flow {
  const srcCount = doc.pages.length
  const warnings: string[] = []
  const byPage = new Map<number, Block[]>()
  for (const b of (doc.blocks ?? []).filter((x) => x.included)) (byPage.get(b.page) ?? byPage.set(b.page, []).get(b.page)!).push(b)
  const placed: PlacedBlock[] = [], pageBox: Flow['pageBox'] = []
  let carry: Unit[] = []
  const lastTop = (p: number): number => { for (let q = Math.min(p, srcCount - 1); q >= 0; q--) { const l = byPage.get(q); if (l?.length) return l[0].top } return doc.pages[0].y0 + doc.pages[0].height - 54 }
  for (let p = 0; ; p++) {
    if (p >= srcCount && !carry.length) break
    if (p > srcCount + 200) { warnings.push('Stopped adding pages after 200 extra pages.'); break }
    const sp = doc.pages[Math.min(p, srcCount - 1)]
    pageBox.push({ src: p < srcCount ? p : null, w: sp.width, h: sp.height })
    const queue: Unit[] = [...carry, ...(p < srcCount ? byPage.get(p) ?? [] : []).map((b) => ({ b, from: 0, cont: false }))]
    carry = []
    const limit = doc.contentBottom[Math.min(p, srcCount - 1)]
    let cursor = queue.length && !queue[0].cont && queue[0].b.page === p ? queue[0].b.top : lastTop(p)
    let first = true
    const placedHere: PlacedBlock[] = []
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi], b = u.b
      const L = blockLines(doc, b, m)
      const top = cursor - (u.cont || first ? 0 : b.spaceBefore * b.spacing)
      const n = L.texts.length, remain = n - u.from
      const baseOf = (k: number) => top - L.asc - (L.offsets[u.from + k] - L.offsets[u.from])
      let fit = 0
      while (fit < remain && baseOf(fit) - L.desc >= limit) fit++
      let take = remain
      if (fit < remain) {
        if (fit >= 2 && remain - fit >= 2) take = fit
        else if (!first) { carry = queue.slice(qi); break }
        else if (fit >= 1) take = fit
        else { take = 1; warnings.push(`A line on page ${p + 1} is taller than the available region; it was kept on the page.`) }
      }
      const texts = L.texts.slice(u.from, u.from + take)
      const bases = texts.map((_, k) => baseOf(k))
      const lines: Line[] = L.exact
        ? texts.map((t, k) => { const el = doc.els[b.lineIds[u.from + k]]; return { text: t, x: el.origX, baseline: bases[k], width: m.width(t, ms(el.style)), tw: 0 } })
        : placeLines(texts, b.x + L.indent, bases[0], Math.max(10, b.width - L.indent), b.style, m).lines.map((l, k) => ({ ...l, baseline: bases[k] }))
      const st = b.style
      const markerDraw: Draw | null = !L.exact && L.marker && u.from === 0
        ? { kind: 'text', x: b.x, y: bases[0], text: L.marker, family: st.family, bold: st.bold, italic: st.italic, size: st.size, color: st.color, tc: st.charSpacing, tw: st.wordSpacing, underline: false, strike: false, width: 0 } : null
      const bottom = bases[take - 1] - L.desc
      const pb: PlacedBlock = { block: b, page: p, from: u.from, lines, lineBaselines: bases, markerDraw, redraw: !L.exact || p !== b.page, rect: { top, bottom } }
      placed.push(pb); placedHere.push(pb)
      cursor = bottom; first = false
      if (take < remain) { carry = [{ b, from: u.from + take, cont: true }, ...queue.slice(qi + 1)]; break }
    }
    // never strand a heading at the bottom of a page
    const lp = placedHere[placedHere.length - 1]
    if (carry.length && lp && lp.block.role === 'heading' && lp.from === 0) { placed.splice(placed.indexOf(lp), 1); carry.unshift({ b: lp.block, from: 0, cont: false }) }
  }
  return { placed, pageCount: pageBox.length, warnings, pageBox }
}

/** Row-anchored items (e.g. dates) travel with the line they sit on. */
export function followerMoves(doc: DocState, flow: Flow): Map<string, { dy: number; page: number }> {
  const out = new Map<string, { dy: number; page: number }>()
  for (const b of doc.blocks ?? []) {
    if (!b.included) continue
    const pls = flow.placed.filter((x) => x.block.id === b.id)
    for (const f of b.followers) {
      const el = doc.els[f.id]
      const pl = pls.find((x) => f.line >= x.from && f.line < x.from + x.lines.length) ?? pls[pls.length - 1]
      if (!pl || !el) continue
      const k = Math.min(f.line - pl.from, pl.lineBaselines.length - 1)
      out.set(el.id, { dy: pl.lineBaselines[Math.max(0, k)] - el.origBaseline, page: pl.page })
    }
  }
  return out
}

export function reflowPlan(doc: DocState, m: Measurer): Plan {
  const flow = layoutFlow(doc, m)
  const pages: PlanPage[] = flow.pageBox.map((b) => ({ src: b.src, w: b.w, h: b.h, edits: [], draws: [] }))
  const inBlock = new Set<string>()
  const moved = new Map<string, { dy: number; page: number }>()
  const removeOps = (el: TextElement, page: number) => { if (!el.locked) for (const op of el.ops) pages[page].edits.push({ idx: op, action: 'remove' }) }
  for (const b of doc.blocks ?? []) if (b.included) b.lineIds.forEach((id) => inBlock.add(id))
  for (const pb of flow.placed) {
    const b = pb.block
    if (b.edited) {
      pages[pb.page].draws.push(...drawsForLines(pb.lines, b.style))
      if (pb.markerDraw) pages[pb.page].draws.push(pb.markerDraw)
    } else if (pb.redraw) {
      pb.lines.forEach((l, k) => pages[pb.page].draws.push(...drawsForLines([l], doc.els[b.lineIds[pb.from + k]].style)))
    } else {
      pb.lines.forEach((l, k) => {
        const el = doc.els[b.lineIds[pb.from + k]], dy = l.baseline - el.origBaseline
        if (Math.abs(dy) <= 0.01) return
        if (el.movable && !el.locked) for (const op of el.ops) pages[pb.page].edits.push({ idx: op, action: 'move', dy })
        else { removeOps(el, pb.page); pages[pb.page].draws.push(...drawsForLines([l], el.style)) }
      })
    }
  }
  for (const b of doc.blocks ?? []) {
    if (!b.included) continue
    const pls = flow.placed.filter((x) => x.block.id === b.id)
    if (b.edited || pls.some((x) => x.redraw)) b.lineIds.forEach((id) => removeOps(doc.els[id], b.page))
  }
  for (const [k, v] of followerMoves(doc, flow)) moved.set(k, v)
  // elements outside the flow: Design Lock handling plus follower travel
  for (const id of doc.order) {
    const el = doc.els[id]
    if (inBlock.has(id)) continue
    const mv = moved.get(id)
    const dy = mv?.dy ?? 0, tp = mv?.page ?? el.page
    const changed = isChanged(el)
    if (!changed && Math.abs(dy) < 0.01 && tp === el.page) continue
    if (!changed && tp === el.page && el.movable && !el.locked) { for (const op of el.ops) pages[tp].edits.push({ idx: op, action: 'move', dy }); continue }
    if (!el.created) removeOps(el, el.page)
    if (el.deleted) continue
    pages[tp].draws.push(...drawsForLines(layoutElement({ ...el, baseline: el.baseline + dy }, m).lines, el.style))
  }
  return { pages }
}

/** Overlaps between flowed lines and fixed items, and graphics the flow cannot see. */
export function flowWarnings(doc: DocState, flow: Flow): string[] {
  const out = [...flow.warnings]
  const inFlow = new Set<string>(), follow = new Set<string>()
  for (const b of doc.blocks ?? []) if (b.included) { b.lineIds.forEach((i) => inFlow.add(i)); b.followers.forEach((f) => follow.add(f.id)) }
  for (const pb of flow.placed) {
    const r = { x: pb.block.x, w: pb.block.width, y: pb.rect.bottom, h: pb.rect.top - pb.rect.bottom }
    for (const id of doc.order) {
      const e = doc.els[id]
      if (inFlow.has(id) || follow.has(id) || e.deleted || e.page !== pb.page) continue
      if (e.x < r.x + r.w && e.x + e.origBox.w > r.x && verticalOverlap(r, e.origBox) > 1) { out.push(`Text on page ${pb.page + 1} now overlaps fixed text "${e.text.slice(0, 24)}".`); break }
    }
    const pg = doc.pages[pb.page]
    if (pb.page !== pb.block.page || pb.rect.top !== pb.block.top) { if (pg && (pg.images || pg.paints > 3)) { out.push(`Page ${pb.page + 1} has images/graphics that reflow cannot detect; check that moved text does not overlap them.`); break } }
  }
  return [...new Set(out)]
}
