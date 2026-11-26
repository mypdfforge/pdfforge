/**
 * nativeText.js
 * Read the PDF's own text layer via pdf.js (client-side), rebuild lines from geometry.
 * - Preserves font-family / monospace classification for DEFECT 07 code detection.
 * - Prevents & repairs descender splits ("Pa g e" -> "Page") from DEFECT 08.
 * - Keeps small baseline-shifted runs as sub/superscripts (H₂SO₄, mc²) instead of dropping them.
 * - Deduplicates overlapping duplicate native streams (e.g., if source PDF already contained Tr 3 OCR).
 * - Rotated text items are skipped so those regions fall cleanly to OCR.
 */
import { toScript, dedupeLines, repairDescenderSplits, detectScript, normalizePuaSymbols } from './ocrPostProcess.js'
import { reorderVisualToLogical } from './pdfUnicode.js'

const MONO_RE = /courier|consolas|monaco|menlo|monospace|dejavu\s*sans\s*mono|liberation\s*mono|jetbrains|fira\s*code|source\s*code|ubuntu\s*mono/i

function classify(it, fh, base) {
  if (it.fh >= 0.78 * fh) return null
  const d = it.base - base
  if (d < -0.15 * fh) return 'sup'
  if (d > 0.08 * fh) return 'sub'
  return null
}

function buildSegment(items, fh, base) {
  // Apply UAX#9 visual-to-logical ordering per segment so RTL Arabic/Hebrew order is preserved
  // without scrambling separate LTR table columns.
  const ordered = reorderVisualToLogical(items.map(it => ({ ...it, str: it.str })))
  let text = ''
  let latex = ''
  let prevEnd = null
  let prevStr = ''
  let pending = null
  const flush = () => {
    if (!pending) return
    const s = toScript(pending.str, pending.kind)
    text += s.uni
    latex += s.latex
    pending = null
  }
  for (const it of ordered) {
    const kind = classify(it, fh, base)
    const gap = prevEnd == null ? 0 : Math.abs(it.x - prevEnd)
    // Calibrated intra-word threshold: descender letters (g, y, p, j) and ligature splits
    // create slightly wider kerning gaps in some PDF producers; never split them in mid-word.
    const descenderBoundary = /[gypjql]$/i.test(prevStr) || /^[gypjql]/i.test(it.str)
    const spaceThresh = descenderBoundary ? 0.28 * fh : 0.22 * fh
    const spaced = prevEnd != null && !kind && !(pending) && gap > spaceThresh
    if (kind && !spaced && pending && pending.kind === kind) {
      pending.str += it.str
    } else {
      flush()
      if (spaced) { text += ' '; latex += ' ' }
      if (kind) pending = { kind, str: it.str }
      else { text += it.str; latex += it.str }
    }
    prevEnd = it.x + it.w
    prevStr = it.str
  }
  flush()
  const isMono = items.some(it => it.isMono)
  const repaired = isMono ? text : repairDescenderSplits(text)
  return { text: repaired, latex, isMono }
}

export async function extractNativeLines(page, viewport, pdfjsLib) {
  const tc = await page.getTextContent()
  const styles = tc.styles || {}
  const items = []
  for (const it of tc.items) {
    const mappedStr = normalizePuaSymbols(it.str)
    if (typeof mappedStr !== 'string' || !mappedStr.trim()) continue
    const t = pdfjsLib.Util.transform(viewport.transform, it.transform)
    const fh = Math.hypot(t[2], t[3])
    if (!fh || Math.abs(t[1]) > 0.01 * fh || Math.abs(t[2]) > 0.01 * fh || t[0] <= 0) continue
    const len = mappedStr.length
    const unit = (it.width * viewport.scale) / Math.max(1, len)
    const lead = len - mappedStr.trimStart().length
    const trail = len - mappedStr.trimEnd().length
    const st = styles[it.fontName]
    const fontFamily = st?.fontFamily || it.fontName || ''
    const isMono = MONO_RE.test(fontFamily) || MONO_RE.test(it.fontName || '')
    items.push({
      str: mappedStr.trim(),
      x: t[4] + lead * unit,
      w: Math.max(0, it.width * viewport.scale - (lead + trail) * unit),
      base: t[5],
      fh,
      fontFamily,
      isMono,
    })
  }

  // Big glyphs first so they define lines; small runs attach afterwards.
  items.sort((a, b) => b.fh - a.fh || a.base - b.base || a.x - b.x)
  const lines = []
  for (const it of items) {
    let line = null
    for (const L of lines) {
      const dy = Math.abs(it.base - L.base)
      const small = it.fh < 0.78 * L.fh
      const ok = small
        ? dy <= 0.65 * L.fh && it.x >= L.x0 - L.fh && it.x <= L.x1 + L.fh
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
  const STANDALONE_MARKER_RE = /^(?:[•◦▪▫●○■□·‣⁃*\-–—✓✔☐☑◉]|\(?\d{1,3}(?:\.\d{1,3})*[.)]?|\(?[a-zA-Z][.)]|\([ivxlc]+\))$/i
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x)
    // Split on big gaps (table cells on one row) so tables can be detected later,
    // EXCEPT keep a hanging list marker attached to its immediately following text item!
    const segs = [[]]
    let end = null
    for (const it of L.items) {
      const curSegText = segs[segs.length - 1].map(s => s.str).join('').trim()
      const isHangingListTab = STANDALONE_MARKER_RE.test(curSegText) && (it.x - end) <= 3.8 * L.fh
      if (end != null && it.x - end > 1.5 * L.fh && !isHangingListTab) segs.push([])
      segs[segs.length - 1].push(it)
      end = it.x + it.w
    }
    for (const seg of segs) {
      const { text, latex, isMono } = buildSegment(seg, L.fh, L.base)
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
        origin: 'source-text',
        script: detectScript(text),
        isMono,
        xMin: x0, xMax: x1, yMin: top, yMax: bot,
        box: [[x0, top], [x1, top], [x1, bot], [x0, bot]],
      })
    }
  }

  // DEFECT 01/02/03: If the source PDF already had pre-existing Tr 3 OCR overlays on top of native text,
  // collapse identical/overlapping native segments right here so only one clean copy remains.
  return dedupeLines(out)
}

/** Native layer is trusted only if it is real text, not mojibake or private-use junk. */
export function isNativeGood(lines) {
  const all = lines.map(l => l.text).join('')
  if (all.length < 15) return false
  const bad = (all.match(/[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length
  return bad / all.length < 0.03
}

/** Does the page paint raster images? */
export async function pageHasImages(page, pdfjsLib) {
  const ops = await page.getOperatorList()
  const O = pdfjsLib.OPS
  const wanted = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintJpegXObject].filter(v => v != null))
  return ops.fnArray.some(f => wanted.has(f))
}

/**
 * Extracts canvas-pixel bounding rects of painted raster images on the page.
 * Used in Smart Hybrid mode so OCR only runs/emits over actual graphic regions, never over
 * valid native Unicode text lines.
 */
export async function getPageImageRects(page, viewport, pdfjsLib) {
  const ops = await page.getOperatorList()
  const O = pdfjsLib.OPS
  const wanted = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintJpegXObject].filter(v => v != null))
  const mul = (m1, m2) => [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
  const rects = []
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const a = ops.argsArray[i]
    if (fn === O.save) stack.push(ctm.slice())
    else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (fn === O.transform && a) ctm = mul(ctm, a)
    else if (fn === O.paintFormXObjectBegin) { stack.push(ctm.slice()); if (a?.[0]) ctm = mul(ctm, a[0]) }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (wanted.has(fn)) {
      const m = mul(viewport.transform, ctm)
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]])
      const xs = pts.map(p => p[0])
      const ys = pts.map(p => p[1])
      const xMin = Math.min(...xs), xMax = Math.max(...xs)
      const yMin = Math.min(...ys), yMax = Math.max(...ys)
      if (xMax - xMin >= 8 && yMax - yMin >= 8) {
        rects.push({ xMin, yMin, xMax, yMax })
      }
    }
  }
  return rects
}
