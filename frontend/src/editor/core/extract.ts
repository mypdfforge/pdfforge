// Builds the document model from pdf.js text items + the content-stream analysis. The canvas is never the source of truth.
import type { PageAnalysis } from './engine.ts'
import type { DocState, PageModel, TextElement, TextStyle, Rect } from './types.ts'
import { mapFont } from './fonts.ts'
import { verticalOverlap } from './geometry.ts'

type Item = { str: string; x: number; y: number; w: number; size: number; font: string; skew: boolean; asc: number; desc: number }
export type ExtractResult = { doc: DocState; notes: string[] }
export const DEFAULT_LINE_HEIGHT = 1.2

export async function extractDocument(pdf: any, analyses: (i: number) => Promise<PageAnalysis>, name: string, onProgress?: (d: number, t: number) => void): Promise<ExtractResult> {
  const pages: PageModel[] = [], els: Record<string, TextElement> = {}, order: string[] = []
  const notes: string[] = []
  let textRuns = 0
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1)
    const [vx0, vy0, vx1, vy1] = page.view
    const rotated = (page.rotate ?? 0) % 360 !== 0
    const an = await analyses(i)
    const pm: PageModel = { index: i, x0: vx0, y0: vy0, width: vx1 - vx0, height: vy1 - vy0, editable: !rotated && an.readable, reason: rotated ? 'Rotated pages are shown read-only.' : !an.readable ? 'This page uses a content encoding that cannot be edited safely.' : null, images: an.images, paints: an.paints }
    pages.push(pm)
    const tc = await page.getTextContent()
    const items: Item[] = []
    for (const it of tc.items) {
      if (typeof it.str !== 'string' || it.str.trim() === '') continue
      const [a, b, c, d, e, f] = it.transform
      const st = tc.styles?.[it.fontName] ?? {}
      items.push({ str: it.str, x: e, y: f, w: it.width, size: Math.hypot(c, d) || Math.abs(d) || 10, font: it.fontName, skew: Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a < 0, asc: st.ascent ?? 0.8, desc: st.descent ?? -0.2 })
    }
    // match item -> drawing instruction (by baseline + horizontal containment)
    const opOf = (it: Item) => {
      let best = -1, bx = -1e9
      an.ops.forEach((o, k) => {
        if (Math.abs(o.y - it.y) > 1.2) return
        const lo = Math.min(o.x, o.x2) - 1.5, hi = Math.max(o.x, o.x2) + 1.5
        if (it.x >= lo && it.x <= hi && o.x <= it.x + 1.5 && o.x > bx) { best = k; bx = o.x }
      })
      return best
    }
    const rows: Array<{ it: Item; op: number }[]> = []
    const sorted = items.map((it) => ({ it, op: opOf(it) })).sort((p, q) => q.it.y - p.it.y || p.it.x - q.it.x)
    for (const p of sorted) {
      const row = rows.find((r) => Math.abs(r[0].it.y - p.it.y) < 0.35 * p.it.size)
      row ? row.push(p) : rows.push([p])
    }
    type Run = { parts: typeof sorted; key: string }
    const runs: Run[] = []
    for (const row of rows) {
      row.sort((p, q) => p.it.x - q.it.x)
      let cur: Run | null = null
      for (const p of row) {
        const op = p.op >= 0 ? an.ops[p.op] : null
        const key = op ? `${op.fontRes}|${p.it.size.toFixed(1)}|${op.color?.map((c) => c.toFixed(2)).join(',') ?? 'x'}|${op.tc}|${op.tw}` : `unmatched|${runs.length}`
        const last: typeof sorted[number] | undefined = cur?.parts[cur.parts.length - 1]
        const gap = last ? p.it.x - (last.it.x + last.it.w) : 0
        if (cur && cur.key === key && !key.startsWith('unmatched') && gap <= 1.2 * p.it.size) cur.parts.push(p)
        else { cur = { parts: [p], key }; runs.push(cur) }
      }
    }
    // an instruction that feeds more than one run cannot be removed for just one of them
    const opRuns = new Map<number, Set<Run>>()
    runs.forEach((r) => r.parts.forEach((p) => { if (p.op >= 0) (opRuns.get(p.op) ?? opRuns.set(p.op, new Set()).get(p.op)!).add(r) }))
    let n = 0
    for (const r of runs) {
      const first = r.parts[0], lastP = r.parts[r.parts.length - 1]
      let text = ''
      r.parts.forEach((p, k) => {
        if (k) { const prev = r.parts[k - 1]; const gap = p.it.x - (prev.it.x + prev.it.w); if (gap > 0.12 * p.it.size && !/\s$/.test(text) && !/^\s/.test(p.it.str)) text += ' ' }
        text += p.it.str
      })
      const opK = [...new Set(r.parts.map((p) => p.op).filter((k) => k >= 0))]
      const op0 = first.op >= 0 ? an.ops[first.op] : null
      const info = op0 ? an.fonts[op0.fontRes] ?? null : null
      const mapped = mapFont(info)
      let locked: string | null = null
      if (!pm.editable) locked = pm.reason
      else if (first.it.skew) locked = 'Rotated or mirrored text cannot be edited.'
      else if (r.parts.some((p) => p.op < 0)) locked = 'This text is drawn inside a form, pattern or unsupported structure.'
      else if (opK.some((k) => (opRuns.get(k)?.size ?? 0) > 1)) locked = 'This text shares a drawing instruction with neighbouring text.'
      else if (opK.some((k) => an.ops[k].tr === 3)) locked = 'Invisible text layer (scanned/OCR) — edit the image-based page instead.'
      const size = Math.round(first.it.size * 100) / 100
      const style: TextStyle = {
        family: mapped.family, bold: mapped.bold, italic: mapped.italic, underline: false, strike: false, size,
        color: (op0?.color ?? [0, 0, 0]) as [number, number, number], highlight: null,
        charSpacing: op0?.tc ?? 0, wordSpacing: op0?.tw ?? 0, align: 'left', lineHeight: DEFAULT_LINE_HEIGHT,
      }
      const x = first.it.x, w = lastP.it.x + lastP.it.w - x
      const box: Rect = { x, y: first.it.y + first.it.desc * size, w, h: (first.it.asc - first.it.desc) * size }
      const id = `p${i}-${n++}`
      els[id] = {
        id, page: i, text, originalText: text, style, originalStyle: style, origBox: box, x, baseline: first.it.y, origX: x, origBaseline: first.it.y,
        maxW: w, wrap: false, movable: opK.every((k) => an.ops[k].positioned && an.ops[k + 1]?.positioned !== false), ops: opK.map((k) => an.ops[k].idx), locked, cover: null,
        mappedFont: info?.baseFont ?? 'unknown', fidelity: mapped.fidelity, fontNote: mapped.note, deleted: false, created: false,
      }
      order.push(id); textRuns++
    }
    onProgress?.(i + 1, pdf.numPages)
  }
  // allowed width = original text-region boundary: up to the next item on the row, else the document's content extent
  const docRight = Math.max(0, ...order.map((k) => els[k].origBox.x + els[k].origBox.w))
  for (const pm of pages) {
    const ids = order.filter((k) => els[k].page === pm.index)
    const contentRight = Math.min(docRight, pm.x0 + pm.width - 18)
    for (const k of ids) {
      const e = els[k]
      let limit = Math.max(contentRight, e.origBox.x + e.origBox.w)
      for (const o of ids) {
        const q = els[o]
        if (o === k || q.origBox.x < e.origBox.x + e.origBox.w - 0.5) continue
        if (verticalOverlap(e.origBox, q.origBox) > 0.4 * Math.min(e.origBox.h, q.origBox.h)) limit = Math.min(limit, q.origBox.x - 4)
      }
      e.maxW = Math.max(limit - e.origBox.x, e.origBox.w)
    }
  }
  if (!textRuns) notes.push('No selectable text found. This looks like a scan or image-only PDF; use the OCR tool first.')
  const lowest = pages.map((p) => Math.min(Infinity, ...order.filter((k) => els[k].page === p.index).map((k) => els[k].origBox.y)))
  const limit = Math.max(36, Math.min(...lowest.filter(Number.isFinite), 1e9))
  const contentBottom = pages.map((p) => Math.max(p.y0 + 36, Number.isFinite(limit) && limit < 1e8 ? limit : p.y0 + 36))
  return { doc: { name, pages, els, order, mode: 'design', blocks: null, contentBottom }, notes }
}
