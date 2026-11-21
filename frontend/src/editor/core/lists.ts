// core/lists.ts — single source of truth for list parsing, detection and marker math.
import type { DocState, TextElement, TextStyle, ListKind } from './types.ts'
import type { Measurer } from './fonts.ts'

export const BULLET_GLYPH_REGEX = /^\s*[-•–*▪◦·●]\s*$/
export const BULLET_LINE_REGEX  = /^\s*[-•–*▪◦·●]\s+/
export const NUMBER_LINE_REGEX  = /^\s*\d+[.)]\s+/
export const MARKER_REGEX       = /^\s*([-•–*▪◦·●]|\d+[.)])(?:\s+|$)/

const ms = (s: TextStyle) => ({ family: s.family, bold: s.bold, italic: s.italic, size: s.size, charSpacing: s.charSpacing, wordSpacing: s.wordSpacing })
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }

export type ParsedMarker = { marker: string; body: string; kind: ListKind; raw: string }

/**
 * Tolerant marker parser. PDF producers emit "●Text" with no space, so glyph bullets
 * allow zero whitespace; ASCII '-' / '*' and en-dash REQUIRE whitespace (otherwise
 * "-5 °C" or "*emphasis" would be misread as list items).
 */
export function parseMarker(line: string): ParsedMarker | null {
  const num = /^\s*(\d+[.)])(\s*)(.*)$/.exec(line)
  if (num && (num[2].length > 0 || num[3] === '')) return { marker: num[1], body: num[3], kind: 'number', raw: num[0] }
  const gly = /^\s*([•▪◦·●])(\s*)(.*)$/.exec(line)
  if (gly) return { marker: gly[1], body: gly[3], kind: 'bullet', raw: gly[0] }
  const asc = /^\s*([-*–])(\s+)(.*)$/.exec(line)
  if (asc) return { marker: asc[1], body: asc[3], kind: 'bullet', raw: asc[0] }
  return null
}

/** A standalone marker element: "●", "•", "1." — the split-bullet anchor. */
export const isMarkerOnly = (t: string) => BULLET_GLYPH_REGEX.test(t) || /^\s*\d+[.)]\s*$/.test(t)

/**
 * The companion glyph immediately left of `el` on the same baseline.
 * Gap is measured origin-to-origin (108 − 90 = 18 pt) and the glyph must end before the body starts.
 */
export function companionOf(doc: DocState, el: TextElement): TextElement | null {
  let best: TextElement | null = null
  for (const id of doc.order) {
    const a = doc.els[id]
    if (!a || a.id === el.id || a.deleted || a.locked || a.page !== el.page) continue
    if (!isMarkerOnly(a.text)) continue
    if (Math.abs(a.origBaseline - el.origBaseline) > 0.35 * el.style.size) continue
    if (a.origX >= el.origX - 1) continue
    if (a.origX + a.origBox.w > el.origX + 1) continue
    if (el.origX - a.origX > 35) continue
    if (a.origBox.w > 30) continue
    if (!best || a.origX > best.origX) best = a
  }
  return best
}

/** Prevailing glyph: nearest above in the same column → page mode → document mode → '•'. */
export function detectMatchingBullet(doc: DocState, page?: number, nearId?: string): string {
  const near = nearId ? doc.els[nearId] : null
  const counts = new Map<string, number>()
  const bump = (g: string, w = 1) => counts.set(g, (counts.get(g) ?? 0) + w)
  let nearest: { g: string; d: number } | null = null

  for (const id of doc.order) {
    const e = doc.els[id]
    if (!e || e.deleted) continue
    const glyph = isMarkerOnly(e.text) ? e.text.trim() : parseMarker(e.text)?.marker
    if (!glyph || /^\d/.test(glyph)) continue
    if (BULLET_GLYPH_REGEX.test(glyph) === false && !isMarkerOnly(glyph)) continue
    bump(glyph, page == null || e.page === page ? 2 : 1)
    if (near && e.page === near.page && Math.abs(e.origX - near.origX) < 40 && e.origBaseline > near.origBaseline) {
      const d = e.origBaseline - near.origBaseline
      if (!nearest || d < nearest.d) nearest = { g: glyph, d }
    }
  }
  if (nearest) return nearest.g
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return top?.[0] ?? '•'
}

export const markerWidth = (marker: string, s: TextStyle, m: Measurer) => m.width(marker + ' ', ms(s))

/** WinAnsi has • – - * but NOT ● ▪ ◦. Without an external glyph we must substitute. */
const FALLBACK: Record<string, string> = { '●': '•', '▪': '•', '◦': '•', '·': '•' }
export function exportMarker(marker: string, family: string, m: Measurer): { glyph: string; substituted: boolean } {
  if (m.canEncode(family as never, marker).length === 0) return { glyph: marker, substituted: false }
  const f = FALLBACK[marker] ?? '•'
  return { glyph: f, substituted: f !== marker }
}

/** Rewrite every logical line with the requested marker. Idempotent (strips first). */
export function applyList(text: string, kind: ListKind, marker: string, start = 1, suffix = '.'): string {
  let n = start
  return text.split('\n').map((line) => {
    const p = parseMarker(line)
    const body = p ? p.body : line
    return kind === 'number' ? `${n++}${suffix} ${body}` : `${marker} ${body}`
  }).join('\n')
}

export const stripList = (text: string) =>
  text.split('\n').map((l) => { const p = parseMarker(l); return p ? p.body : l }).join('\n')

export const hasAnyMarker = (text: string) => text.split('\n').some((l) => parseMarker(l) !== null)

/** Sequential numbering across contiguous numbered items in the same column. */
export function renumberLists(doc: DocState): Record<string, TextElement> | null {
  const patch: Record<string, TextElement> = {}
  let run: string[] = [], lastX = 0, lastPage = -1
  const flush = () => {
    let n = 1
    for (const id of run) {
      const cur = patch[id] ?? doc.els[id]
      const L = cur.list!
      const suffix = /\d+([.)])/.exec(L.marker)?.[1] ?? '.'
      const text = applyList(cur.text, 'number', L.marker, n, suffix)
      if (text !== cur.text || L.start !== n) patch[id] = { ...cur, text, list: { ...L, start: n } }
      n += cur.text.split('\n').length
    }
    run = []; lastPage = -1
  }
  for (const id of doc.order) {
    const e = patch[id] ?? doc.els[id]
    if (!e || e.deleted) continue
    if (isMarkerOnly(e.text)) continue                       // unabsorbed glyphs don't break a run
    if (e.list?.kind === 'number') {
      const contiguous = run.length > 0 && e.page === lastPage && Math.abs(e.origX - lastX) < 3
      if (!contiguous) flush()
      run.push(id); lastX = e.origX; lastPage = e.page
    } else if (e.text.trim()) flush()
  }
  flush()
  return Object.keys(patch).length ? patch : null
}

/** Median baseline pitch / font size across same-column neighbours = the document's real leading. */
export function derivePitchRatio(doc: DocState): number {
  const ratios: number[] = []
  for (const pm of doc.pages) {
    const els = doc.order.map((id) => doc.els[id])
      .filter((e) => e && e.page === pm.index && !e.deleted && !e.locked && e.text.trim())
      .sort((a, b) => b.origBaseline - a.origBaseline)
    for (let i = 1; i < els.length; i++) {
      const a = els[i - 1], b = els[i]
      if (Math.abs(a.origX - b.origX) > 2) continue
      if (Math.abs(a.style.size - b.style.size) > 0.3) continue
      const d = (a.origBaseline - b.origBaseline) / b.style.size
      if (d > 0.95 && d <= 2.2) ratios.push(d)
    }
  }
  const r = median(ratios)
  return r ? Math.round(r * 1000) / 1000 : 1.2
}
