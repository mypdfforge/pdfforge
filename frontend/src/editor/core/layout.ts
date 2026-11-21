// Layout engine: wrapping, line geometry, overflow/collision detection. Uses the same un-kerned metrics as export.
import type { Measurer } from './fonts.ts'
import type { TextElement, TextStyle, Rect, DocState } from './types.ts'
import { intersects } from './geometry.ts'
import { parseMarker, exportMarker } from './lists.ts'

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

/** Effective baseline pitch. Uses the document's measured leading unless the user overrode lineHeight. */
export function pitchOf(el: TextElement, doc?: DocState): number {
  const touched = el.style.lineHeight !== el.originalStyle.lineHeight
  const ratio = touched ? el.style.lineHeight : (doc?.flow?.pitchRatio ?? el.style.lineHeight)
  return el.style.size * Math.max(0.8, ratio)
}

/** Place lines of a text box. firstBaseline is the first line's baseline; lines descend by size*lineHeight or pitch. */
export function placeLines(
  textLines: string[], x: number, firstBaseline: number, boxW: number,
  s: TextStyle, m: Measurer, alignW = boxW, pitch = s.size * s.lineHeight
): Placed {
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

/**
 * Hanging-indent placement.
 *  line 0 : marker at el.x, body at el.x + indent
 *  line n : body at el.x + indent  (never under the glyph)
 * When list.externalId is set the ORIGINAL glyph element draws the marker, so the
 * marker is stripped from the drawn text — this is what prevents both the double
 * bullet and the "?" that WinAnsi would produce for ●.
 */
export function placeListElement(el: TextElement, m: Measurer, pitch: number): Placed {
  const L = el.list!, s = el.style
  const boxW = Math.max(el.maxW, 1)
  const indent = Math.max(0, Math.min(L.indent, boxW - 24))
  const bodyW = Math.max(12, boxW - indent)
  const external = !!L.externalId
  const lines: Line[] = []
  let overflowX = false, baseline = el.baseline, ord = L.start || 1

  for (const para of el.text.split('\n')) {
    const p = parseMarker(para)
    const isItem = !!p
    const body = isItem ? p!.body : para
    let marker: string | null = null
    if (isItem) {
      if (L.kind === 'number') {
        const suffix = /\d+([.)])/.exec(p!.marker)?.[1] ?? '.'
        marker = `${ord++}${suffix}`
      } else marker = exportMarker(p!.marker, s.family, m).glyph
    }
    const wrapped = wrapText(body, bodyW, s, m)
    wrapped.forEach((t, i) => {
      const drawMarker = isItem && i === 0 && !external
      const text = drawMarker ? `${marker} ${t}` : t
      const w = m.width(text, ms(s))
      const avail = drawMarker ? boxW : bodyW
      let lx = drawMarker ? el.x : el.x + indent, tw = 0
      if (!drawMarker) {                                   // marker lines stay pinned to el.x
        if (s.align === 'center') lx = el.x + indent + (bodyW - w) / 2
        else if (s.align === 'right') lx = el.x + indent + bodyW - w
        else if (s.align === 'justify' && i < wrapped.length - 1 && t.includes(' ') && w < bodyW)
          tw = (bodyW - w) / (t.split(' ').length - 1)
      }
      if (w > avail + 0.5) overflowX = true
      lines.push({ text, x: lx, baseline, width: tw ? avail : w, tw })
      baseline -= pitch
    })
  }
  if (!lines.length) lines.push({ text: '', x: el.x + indent, baseline: el.baseline, width: 0, tw: 0 })
  const top = el.baseline + s.size * 0.8
  const bottom = lines[lines.length - 1].baseline - s.size * 0.22
  return {
    lines,
    rect: { x: Math.min(...lines.map((l) => l.x)), y: bottom,
            w: Math.max(Math.max(...lines.map((l) => l.width)), 0.1), h: top - bottom },
    overflowX,
  }
}

export function layoutElement(el: TextElement, m: Measurer, doc?: DocState): Placed {
  const pitch = pitchOf(el, doc)
  if (el.list) return placeListElement(el, m, pitch)
  const boxW = Math.max(el.maxW, 1)
  const lines = el.wrap ? wrapText(el.text, boxW, el.style, m) : el.text.split('\n')
  return placeLines(lines, el.x, el.baseline, boxW, el.style, m, Math.max(boxW, el.origBox.w), pitch)
}

/** Slice already-placed lines onto another page. Keeps per-line x (indent) intact. */
export function sliceLines(lines: Line[], from: number, count: number, firstBaseline: number): Line[] {
  const out = lines.slice(from, from + count)
  if (!out.length) return out
  const dy = firstBaseline - out[0].baseline
  return out.map((l) => ({ ...l, baseline: l.baseline + dy }))
}

export function rectOfLines(lines: Line[], s: TextStyle): Rect {
  if (!lines.length) return { x: 0, y: 0, w: 0.1, h: 0.1 }
  const top = lines[0].baseline + s.size * 0.8
  const bottom = lines[lines.length - 1].baseline - s.size * 0.22
  return { x: Math.min(...lines.map((l) => l.x)), y: bottom,
           w: Math.max(Math.max(...lines.map((l) => l.width)), 0.1), h: top - bottom }
}

export type Issue = { id: string; kind: 'overflow' | 'collision' | 'encoding'; message: string; with?: string[] }

/** Overflow / collision / encoding issues for edited elements on their page (Design Lock). */
export function elementIssues(doc: DocState, el: TextElement, m: Measurer): Issue[] {
  if (el.deleted || el.locked) return []
  const issues: Issue[] = []
  const placed = layoutElement(el, m, doc)
  if (placed.overflowX) issues.push({ id: el.id, kind: 'overflow', message: `Text is wider than its region (${Math.round(el.maxW)} pt). Wrap it, shrink it, or reflow.` })
  const hits: string[] = []
  for (const id of doc.order) {
    const o = doc.els[id]
    if (!o || o.id === el.id || o.page !== el.page || o.deleted) continue
    if (o.id === el.list?.externalId) continue          // our own glyph is not a collision
    const r: Rect = o.text === o.originalText && o.x === o.origX && o.baseline === o.origBaseline ? o.origBox : layoutElement(o, m, doc).rect
    if (intersects(placed.rect, r, 0.8)) hits.push(o.id)
  }
  if (hits.length) issues.push({ id: el.id, kind: 'collision', message: `Overlaps ${hits.length} neighbouring text item${hits.length > 1 ? 's' : ''}.`, with: hits })
  const bad = m.canEncode(el.style.family, el.text)
  if (bad.length) issues.push({ id: el.id, kind: 'encoding', message: `Characters not supported by the export font: ${bad.join(' ')} (will print as "?").` })
  if (el.list?.kind === 'bullet' && !el.list.externalId) {
    const g = parseMarker(el.text.split('\n')[0])?.marker
    if (g && exportMarker(g, el.style.family, m).substituted)
      issues.push({ id: el.id, kind: 'encoding', message: `Bullet "${g}" is not in the export font; it will print as "${exportMarker(g, el.style.family, m).glyph}".` })
  }
  return issues
}

/** Descender clearance used by placeLines (kept in one place so pagination agrees with layout). */
export const descenderOf = (s: TextStyle) => s.size * 0.22

/**
 * How many LEADING lines keep their descender at or above `limit`.
 * Returns 0 when even the first line does not fit — the caller must then move the row.
 */
export function countFittingLines(lines: Line[], s: TextStyle, limit: number): number {
  const d = descenderOf(s)
  let n = 0
  for (const l of lines) { if (l.baseline - d >= limit) n++; else break }
  return n
}

/** Wrap once. Pagination slices this array; re-wrapping per page would change the breaks. */
export function wrapForFlow(el: TextElement, boxW: number, s: TextStyle, m: Measurer): string[] {
  return wrapText(el.text, Math.max(boxW, 1), s, m)   // Live Flow always wraps
}
