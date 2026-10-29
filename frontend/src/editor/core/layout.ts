// Layout engine: wrapping, line geometry, overflow/collision detection. Uses the same un-kerned metrics as export.
import type { Measurer } from './fonts.ts'
import type { TextElement, TextStyle, Rect, DocState } from './types.ts'
import { intersects } from './geometry.ts'

export type Line = { text: string; x: number; baseline: number; width: number; tw: number }
const ms = (s: TextStyle) => ({ family: s.family, bold: s.bold, italic: s.italic, size: s.size, charSpacing: s.charSpacing, wordSpacing: s.wordSpacing })

/** Greedy word wrap. Honors explicit \n, keeps spaces out of line ends, breaks words longer than the line. */
export function wrapText(text: string, maxW: number, s: TextStyle, m: Measurer): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (para.trim() === '') { out.push(''); continue }
    let cur = ''
    for (const word of para.split(/ +/).filter(Boolean)) {
      const test = cur ? cur + ' ' + word : word
      if (m.width(test, ms(s)) <= maxW) { cur = test; continue }
      if (cur) { out.push(cur); cur = '' }
      if (m.width(word, ms(s)) <= maxW) { cur = word; continue }
      let piece = ''
      for (const ch of word) { if (piece && m.width(piece + ch, ms(s)) > maxW) { out.push(piece); piece = ch } else piece += ch }
      cur = piece
    }
    out.push(cur)
  }
  return out.length ? out : ['']
}

export type Placed = { lines: Line[]; rect: Rect; overflowX: boolean }

/** Place lines of a text box. firstBaseline is the first line's baseline; lines descend by size*lineHeight. */
export function placeLines(textLines: string[], x: number, firstBaseline: number, boxW: number, s: TextStyle, m: Measurer, alignW = boxW): Placed {
  const pitch = s.size * s.lineHeight
  const lines: Line[] = []
  let maxLine = 0, overflowX = false
  textLines.forEach((t, i) => {
    const w = m.width(t, ms(s))
    maxLine = Math.max(maxLine, w)
    if (w > boxW + 0.5) overflowX = true
    let lx = x, tw = 0
    if (s.align === 'center') lx = x + (alignW - w) / 2
    else if (s.align === 'right') lx = x + alignW - w
    else if (s.align === 'justify' && i < textLines.length - 1 && t.includes(' ') && w < boxW) tw = (boxW - w) / (t.split(' ').length - 1)
    lines.push({ text: t, x: lx, baseline: firstBaseline - i * pitch, width: tw ? boxW : w, tw })
  })
  const top = firstBaseline + s.size * 0.8, bottom = firstBaseline - (lines.length - 1) * pitch - s.size * 0.22
  const minX = Math.min(...lines.map((l) => l.x))
  return { lines, rect: { x: minX, y: bottom, w: Math.max(maxLine, 0.1), h: top - bottom }, overflowX }
}

export function layoutElement(el: TextElement, m: Measurer): Placed {
  const boxW = Math.max(el.maxW, 1)
  const lines = el.wrap ? wrapText(el.text, boxW, el.style, m) : el.text.split('\n')
  return placeLines(lines, el.x, el.baseline, boxW, el.style, m, Math.max(boxW, el.origBox.w))
}

export type Issue = { id: string; kind: 'overflow' | 'collision' | 'encoding'; message: string; with?: string[] }

/** Overflow / collision / encoding issues for edited elements on their page (Design Lock). */
export function elementIssues(doc: DocState, el: TextElement, m: Measurer): Issue[] {
  if (el.deleted || el.locked) return []
  const issues: Issue[] = []
  const placed = layoutElement(el, m)
  if (placed.overflowX) issues.push({ id: el.id, kind: 'overflow', message: `Text is wider than its region (${Math.round(el.maxW)} pt). Wrap it, shrink it, or reflow.` })
  const hits: string[] = []
  for (const id of doc.order) {
    const o = doc.els[id]
    if (!o || o.id === el.id || o.page !== el.page || o.deleted) continue
    const r: Rect = o.text === o.originalText && o.x === o.origX && o.baseline === o.origBaseline ? o.origBox : layoutElement(o, m).rect
    if (intersects(placed.rect, r, 0.8)) hits.push(o.id)
  }
  if (hits.length) issues.push({ id: el.id, kind: 'collision', message: `Overlaps ${hits.length} neighbouring text item${hits.length > 1 ? 's' : ''}.`, with: hits })
  const bad = m.canEncode(el.style.family, el.text)
  if (bad.length) issues.push({ id: el.id, kind: 'encoding', message: `Characters not supported by the export font: ${bad.join(' ')} (will print as "?").` })
  return issues
}
