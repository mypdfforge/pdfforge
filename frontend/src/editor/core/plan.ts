// Compiles the document model into a Plan the engine can apply. Preview and export share this, so they cannot disagree.
import type { DocState, TextElement, TextStyle, Plan, PlanPage, Draw } from './types.ts'
import type { Measurer } from './fonts.ts'
import { layoutElement } from './layout.ts'
import type { Line } from './layout.ts'
import { reflowPlan } from './reflow.ts'
import { cascadeVerticalShift } from './flow.ts'
import { layoutTable } from './table.ts'

const sameStyle = (a: TextStyle, b: TextStyle) => JSON.stringify(a) === JSON.stringify(b)
export const isChanged = (e: TextElement) =>
  e.created || e.deleted || e.text !== e.originalText || !sameStyle(e.style, e.originalStyle) || e.x !== e.origX || e.baseline !== e.origBaseline || e.wrap

export function drawsForLines(lines: Line[], s: TextStyle): Draw[] {
  const out: Draw[] = []
  for (const l of lines) {
    if (s.highlight && l.text) out.push({ kind: 'rect', x: l.x - 0.5, y: l.baseline - s.size * 0.22, w: l.width + 1, h: s.size * 1.1, color: s.highlight })
    const text = l.text.replace(/[\u25cf\u25aa\u25b6\u25a0]/g, '\u2022')
    out.push({ kind: 'text', x: l.x, y: l.baseline, text, family: s.family, bold: s.bold, italic: s.italic, size: s.size, color: s.color, tc: s.charSpacing, tw: s.wordSpacing + l.tw, underline: s.underline, strike: s.strike, width: l.width })
  }
  return out
}

/** Design Lock + Live Flow. Same fidelity policy as reflowPlan: move what we can, redraw what we must. */
export function cascadePlan(doc: DocState, m: Measurer): Plan {
  const res = cascadeVerticalShift(doc, m)
  const pages: PlanPage[] = res.pageBox.map((b) => ({ src: b.src, w: b.w, h: b.h, edits: [], draws: [] }))
  const sq = doc.flow?.squeeze ?? null
  const removeOps = (el: TextElement, p: number) => { if (!el.locked && !el.created) for (const op of el.ops) pages[p].edits.push({ idx: op, action: 'remove' }) }
  const styled = (s: TextStyle): TextStyle => sq ? { ...s, size: Math.max(6, s.size + sq.sizeDelta), lineHeight: s.lineHeight * sq.lineHeightK } : s

  for (const id of doc.order) {
    const el = doc.els[id]
    const sh = res.shifts.get(id) ?? { baseline: el.baseline, page: el.page, dy: 0 }
    const changed = isChanged(el)
    // Squeeze that alters glyph metrics forces redraw (move ops cannot resize original glyphs).
    const metricsTouched = !!sq && (sq.sizeDelta !== 0 || (sq.lineHeightK !== 1 && el.text.includes('\n')))
    if (el.deleted) { removeOps(el, el.page); continue }
    const parts = res.chunks.get(id)
    if (parts) {
      removeOps(el, el.page)
      const s = styled(el.style)
      for (const c of parts) pages[c.page].draws.push(...drawsForLines(c.lines, s))
      continue
    }
    if (el.locked && !el.cover) continue
    if (!changed && !metricsTouched && Math.abs(sh.dy) < 0.01 && sh.page === el.page) continue
    if (!changed && !metricsTouched && sh.page === el.page && el.movable) {
      for (const op of el.ops) pages[el.page].edits.push({ idx: op, action: 'move', dy: sh.dy }) // original font, byte-identical
      continue
    }
    if (el.cover) pages[el.page].draws.push({ kind: 'rect', x: el.origBox.x - 0.5, y: el.origBox.y, w: el.origBox.w + 1, h: el.origBox.h, color: el.cover })
    else removeOps(el, el.page)
    const s = styled(el.style)
    const wrap = el.wrap || !!doc.flow?.enabled
    pages[sh.page].draws.push(...drawsForLines(layoutElement({ ...el, style: s, wrap, maxW: Math.max(20, el.maxW), baseline: sh.baseline }, m).lines, s))
  }

  for (const rp of res.repeats) {
    const el = doc.els[rp.id]
    if (!el) continue
    const s = styled(el.style)
    pages[rp.page].draws.push(...drawsForLines(layoutElement({ ...el, style: s, baseline: rp.baseline }, m).lines, s))
  }

  // Horizontal rules travel with their anchor: remove the original vector op, redraw a crisp rect.
  for (const rule of doc.rules ?? []) {
    const sh = rule.anchorId ? res.shifts.get(rule.anchorId) : undefined
    if (!sh || (Math.abs(sh.dy) < 0.01 && sh.page === rule.page)) continue
    for (const op of rule.ops) pages[rule.page].edits.push({ idx: op, action: 'remove' })
    pages[sh.page].draws.push({ kind: 'rect', x: rule.rect.x, y: rule.rect.y + sh.dy, w: rule.rect.w, h: rule.rect.h, color: rule.color })
  }

  // Part B4: Objects (images, rules, vectors)
  for (const o of doc.objects ?? []) {
    const sh = res.objectShifts?.get(o.id) ?? (o.anchorId ? res.shifts.get(o.anchorId) : undefined)
    if (!sh || (Math.abs(sh.dy) < 0.01 && sh.page === o.page)) continue
    if (o.locked) { res.warnings.push(`"${o.kind}" on page ${o.page + 1} could not move: ${o.locked}`); continue }
    if (o.translatable && sh.page === o.page) {
      pages[o.page].edits.push({ idx: o.ops[0], action: 'translate', dx: 0, dy: sh.dy, span: o.ops.length })
    } else if (o.kind === 'rule') {                       // cross-page or non-neutral: vector redraw
      for (const op of o.ops) pages[o.page].edits.push({ idx: op, action: 'remove' })
      pages[sh.page].draws.push({ kind: 'rect', x: o.rect.x, y: o.rect.y + sh.dy, w: o.rect.w, h: o.rect.h, color: o.color })
    } else {
      res.warnings.push(`An image on page ${o.page + 1} cannot cross a page boundary; it stayed put.`)
    }
  }

  // Part C: Tables in cascade plan (remove old ruleOps, redraw crisp grid at new rowYs)
  for (const t of doc.tables ?? []) {
    const firstCellId = t.cells[0]?.elIds[0]
    const sh = firstCellId ? res.shifts.get(firstCellId) : undefined
    if (!sh || (Math.abs(sh.dy) < 0.01 && sh.page === t.page)) continue

    for (const op of t.ruleOps) {
      if (pages[t.page]) pages[t.page].edits.push({ idx: op, action: 'remove' })
    }

    const targetPage = sh.page
    const top = t.rect.y + t.rect.h + sh.dy
    const placed = layoutTable(t, doc, m, top)
    const dest = pages[targetPage]
    if (dest) {
      const x0 = t.xs[0], x1 = t.xs[t.xs.length - 1], w = x1 - x0
      for (const y of placed.rowYs) {
        dest.draws.push({ kind: 'rect', x: x0, y: y - 0.5, w, h: 1, color: t.ruleColor })
      }
      for (const x of t.xs) {
        dest.draws.push({ kind: 'rect', x: x - 0.5, y: placed.bottom, w: 1, h: placed.height, color: t.ruleColor })
      }
    }
  }
  return { pages }
}

export function buildPlan(doc: DocState, m: Measurer): Plan {
  if (doc.mode === 'reflow' && doc.blocks) return reflowPlan(doc, m)
  if (doc.mode === 'design' && doc.flow?.enabled) return cascadePlan(doc, m)
  const pages: PlanPage[] = doc.pages.map((p) => ({ src: p.index, w: p.width, h: p.height, edits: [], draws: [] }))
  for (const id of doc.order) {
    const e = doc.els[id]
    if (!isChanged(e)) continue
    const pg = pages[e.page]
    if (!e.created) {
      if (e.locked && !e.cover) continue
      if (e.cover) pg.draws.push({ kind: 'rect', x: e.origBox.x - 0.5, y: e.origBox.y, w: e.origBox.w + 1, h: e.origBox.h, color: e.cover })
      else for (const op of e.ops) pg.edits.push({ idx: op, action: 'remove' })
    }
    if (e.deleted) continue
    pg.draws.push(...drawsForLines(layoutElement(e, m).lines, e.style))
  }
  return { pages }
}
