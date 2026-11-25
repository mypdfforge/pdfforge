/**
 * nativeText.js
 * Read the PDF's own text layer via pdf.js (client-side), rebuild lines from geometry.
 * - Merges glyph runs by gap, so descender splits like "Pa g e" become "Page".
 * - Keeps small baseline-shifted runs as sub/superscripts (H₂SO₄, mc²) instead of dropping them.
 * - shortcut: rotated text items are skipped (those regions fall to OCR).
 */
import { toScript } from './ocrPostProcess.js'

function classify(it, fh, base) {
  if (it.fh >= 0.75 * fh) return null
  const d = it.base - base
  if (d < -0.15 * fh) return 'sup'
  if (d > 0.08 * fh) return 'sub'
  return null
}

function buildSegment(items, fh, base) {
  let text = ''
  let latex = ''
  let prevEnd = null
  let pending = null
  const flush = () => {
    if (!pending) return
    const s = toScript(pending.str, pending.kind)
    text += s.uni
    latex += s.latex
    pending = null
  }
  for (const it of items) {
    const kind = classify(it, fh, base)
    const gap = prevEnd == null ? 0 : it.x - prevEnd
    const spaced = prevEnd != null && gap > 0.2 * fh
    if (kind && !spaced && pending && pending.kind === kind) {
      pending.str += it.str
    } else {
      flush()
      if (spaced) { text += ' '; latex += ' ' }
      if (kind) pending = { kind, str: it.str }
      else { text += it.str; latex += it.str }
    }
    prevEnd = it.x + it.w
  }
  flush()
  return { text, latex }
}

export async function extractNativeLines(page, viewport, pdfjsLib) {
  const tc = await page.getTextContent()
  const items = []
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue
    const t = pdfjsLib.Util.transform(viewport.transform, it.transform)
    const fh = Math.hypot(t[2], t[3])
    if (!fh || Math.abs(t[1]) > 0.01 * fh || Math.abs(t[2]) > 0.01 * fh || t[0] <= 0) continue
    const len = it.str.length
    const unit = (it.width * viewport.scale) / len
    const lead = len - it.str.trimStart().length
    const trail = len - it.str.trimEnd().length
    items.push({
      str: it.str.trim(),
      x: t[4] + lead * unit,
      w: Math.max(0, it.width * viewport.scale - (lead + trail) * unit),
      base: t[5],
      fh,
    })
  }

  // Big glyphs first so they define lines; small runs attach afterwards.
  items.sort((a, b) => b.fh - a.fh || a.base - b.base || a.x - b.x)
  const lines = []
  for (const it of items) {
    let line = null
    for (const L of lines) {
      const dy = Math.abs(it.base - L.base)
      const small = it.fh < 0.75 * L.fh
      const ok = small
        ? dy <= 0.6 * L.fh && it.x >= L.x0 - L.fh && it.x <= L.x1 + L.fh
        : dy < 0.5 * L.fh
      if (ok) { line = L; break }
    }
    if (!line) lines.push({ base: it.base, fh: it.fh, items: [it], x0: it.x, x1: it.x + it.w })
    else {
      line.items.push(it)
      line.x0 = Math.min(line.x0, it.x)
      line.x1 = Math.max(line.x1, it.x + it.w)
    }
  }

  const out = []
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x)
    // Split on big gaps (table cells on one row) so tables can be detected later.
    const segs = [[]]
    let end = null
    for (const it of L.items) {
      if (end != null && it.x - end > 1.5 * L.fh) segs.push([])
      segs[segs.length - 1].push(it)
      end = it.x + it.w
    }
    for (const seg of segs) {
      const { text, latex } = buildSegment(seg, L.fh, L.base)
      if (!text.trim()) continue
      const x0 = seg[0].x
      const x1 = Math.max(...seg.map(s => s.x + s.w))
      const top = L.base - 0.8 * L.fh
      const bot = L.base + 0.2 * L.fh
      out.push({
        text,
        latex: latex !== text ? latex : undefined,
        mean: 1,
        source: 'native',
        box: [[x0, top], [x1, top], [x1, bot], [x0, bot]],
      })
    }
  }
  return out
}

/** Native layer is trusted only if it is real text, not mojibake or private-use junk. */
export function isNativeGood(lines) {
  const all = lines.map(l => l.text).join('')
  if (all.length < 15) return false
  const bad = (all.match(/[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length
  return bad / all.length < 0.03
}

/** Does the page paint raster images? (Logos count too; cost is only extra OCR work.) */
export async function pageHasImages(page, pdfjsLib) {
  const ops = await page.getOperatorList()
  const O = pdfjsLib.OPS
  const wanted = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintJpegXObject].filter(v => v != null))
  return ops.fnArray.some(f => wanted.has(f))
}
