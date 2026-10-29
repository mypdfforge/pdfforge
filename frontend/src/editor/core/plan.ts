// Compiles the document model into a Plan the engine can apply. Preview and export share this, so they cannot disagree.
import type { DocState, TextElement, TextStyle, Plan, PlanPage, Draw } from './types.ts'
import type { Measurer } from './fonts.ts'
import { layoutElement } from './layout.ts'
import type { Line } from './layout.ts'
import { reflowPlan } from './reflow.ts'

const sameStyle = (a: TextStyle, b: TextStyle) => JSON.stringify(a) === JSON.stringify(b)
export const isChanged = (e: TextElement) =>
  e.created || e.deleted || e.text !== e.originalText || !sameStyle(e.style, e.originalStyle) || e.x !== e.origX || e.baseline !== e.origBaseline || e.wrap

export function drawsForLines(lines: Line[], s: TextStyle): Draw[] {
  const out: Draw[] = []
  for (const l of lines) {
    if (s.highlight && l.text) out.push({ kind: 'rect', x: l.x - 0.5, y: l.baseline - s.size * 0.22, w: l.width + 1, h: s.size * 1.1, color: s.highlight })
    out.push({ kind: 'text', x: l.x, y: l.baseline, text: l.text, family: s.family, bold: s.bold, italic: s.italic, size: s.size, color: s.color, tc: s.charSpacing, tw: s.wordSpacing + l.tw, underline: s.underline, strike: s.strike, width: l.width })
  }
  return out
}

export function buildPlan(doc: DocState, m: Measurer): Plan {
  if (doc.mode === 'reflow' && doc.blocks) return reflowPlan(doc, m)
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
