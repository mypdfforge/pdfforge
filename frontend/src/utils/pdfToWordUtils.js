/**
 * pdfToWordUtils.js — pure helpers for the PDF → Word pipeline.
 * No DOM, no docx, no pdf.js imports: unit-testable in plain Node.
 */

// ─── Errors ────────────────────────────────────────────────────────────────
export class ConversionError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'ConversionError'
    this.code = code // ABORTED | TIMEOUT | STALLED | ENCRYPTED | INVALID_PDF | NO_PDFJS | EMPTY | INTERNAL
    if (cause) this.cause = cause
  }
}

export const abortError = () => new ConversionError('ABORTED', 'Conversion cancelled')

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError()
}

/** Reject as soon as `signal` aborts (the underlying work may keep running; we just stop waiting). */
export function abortable(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) {
    promise.catch(() => {}) // already-started work must not surface as an unhandled rejection
    return Promise.reject(abortError())
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) }
    )
  })
}

/** Reject with TIMEOUT if `promise` takes longer than `ms`. */
export function withTimeout(promise, ms, label = 'operation') {
  if (!ms || ms === Infinity) return promise
  let timer
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ConversionError('TIMEOUT', `${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
  })
  return Promise.race([promise, t]).finally(() => clearTimeout(timer))
}

// ─── Main-thread yielding (never uses rAF: rAF is frozen in background tabs) ─
export function yieldToMain() {
  if (typeof globalThis.scheduler?.yield === 'function') return globalThis.scheduler.yield()
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((res) => {
      const mc = new MessageChannel()
      mc.port1.onmessage = () => { mc.port1.close(); res() }
      mc.port2.postMessage(0)
    })
  }
  return new Promise((res) => setTimeout(res, 0))
}

/** Yield only when the current slice has used up its time budget (keeps frames flowing). */
export function createSlicer(budgetMs = 8) {
  let last = now()
  return async function maybeYield(force = false) {
    if (force || now() - last >= budgetMs) {
      await yieldToMain()
      last = now()
    }
  }
}

export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// ─── XML-safe text ─────────────────────────────────────────────────────────
/** Strip chars illegal in XML 1.0 (control chars, lone surrogates, U+FFFE/FFFF). */
export function cleanText(input) {
  if (input == null) return ''
  const s = String(input)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1)
      if (n >= 0xdc00 && n <= 0xdfff) { out += s[i] + s[i + 1]; i++ }
      continue // lone high surrogate → drop
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue // lone low surrogate → drop
    if (c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c !== 0xfffe && c !== 0xffff)) out += s[i]
  }
  return out
}

// ─── Script segmentation (so each run gets the right font / RTL flag) ──────
const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
const CJK_RE = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3040-\u30FF]/
const DEVA_RE = /[\u0900-\u097F]/
const EMOJI_RE = /[\u2600-\u27BF\u2B00-\u2BFF]|\p{Extended_Pictographic}/u

export function classifyChar(ch) {
  if (RTL_RE.test(ch)) return 'rtl'
  if (CJK_RE.test(ch)) return 'cjk'
  if (DEVA_RE.test(ch)) return 'deva'
  if (EMOJI_RE.test(ch)) return 'emoji'
  if (/[\p{L}\p{N}]/u.test(ch)) return 'latin'
  return 'neutral'
}

/** Split a string into [{text, script}] — neutral chars (space, punctuation) stick to the current run. */
export function segmentByScript(text) {
  const segs = []
  for (const ch of String(text)) {
    const k = classifyChar(ch)
    const last = segs[segs.length - 1]
    if (!last) { segs.push({ text: ch, script: k === 'neutral' ? 'latin' : k }); continue }
    if (k === 'neutral' || k === last.script) last.text += ch
    else segs.push({ text: ch, script: k })
  }
  return segs
}

/** True when most letters are right-to-left (Arabic/Hebrew/…). */
export function isMostlyRtl(text) {
  let rtl = 0, letters = 0
  for (const ch of String(text)) {
    if (RTL_RE.test(ch)) { rtl++; letters++ }
    else if (/\p{L}/u.test(ch)) letters++
  }
  return letters > 0 && rtl / letters > 0.5
}

// ─── Colour helpers ────────────────────────────────────────────────────────
export function normHex(c) {
  if (typeof c !== 'string') return null
  const h = c.trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(h)) return h.toUpperCase()
  if (/^[0-9a-f]{3}$/i.test(h)) return h.split('').map((x) => x + x).join('').toUpperCase()
  return null
}
export function luminance(hex) {
  const h = normHex(hex)
  if (!h) return 1
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrastText = (bgHex) => (luminance(bgHex) < 0.5 ? 'FFFFFF' : '000000')
/** Return a colour only if it is meaningfully non-black (black = "auto", so dark-mode Word stays readable). */
export function visibleColor(c) {
  const h = normHex(c)
  if (!h || h === '000000') return undefined
  return h
}

// ─── 2D affine matrices [a b c d e f] ──────────────────────────────────────
export const IDENTITY = [1, 0, 0, 1, 0, 0]
export function mulMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}
/** Bounding box of the unit square under matrix m → {x,y,w,h}. */
export function unitSquareBBox(m) {
  const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]])
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

// ─── Rect helpers ──────────────────────────────────────────────────────────
export const rectArea = (r) => Math.max(0, r.w) * Math.max(0, r.h)
export function rectsOverlap(a, b, pad = 0) {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y
}
export function unionRect(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
/** Merge rects that overlap/touch (within pad) until stable. */
export function mergeRects(rects, pad = 4) {
  let list = rects.map((r) => ({ ...r }))
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (rectsOverlap(list[i], list[j], pad)) {
          list[i] = unionRect(list[i], list[j])
          list.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }
  return list
}
/** Fraction of `page` covered by the union of rects (approximate: sums merged areas, clamped to 1). */
export function coverage(rects, pageW, pageH) {
  const merged = mergeRects(rects, 0)
  const a = merged.reduce((s, r) => s + rectArea(r), 0)
  return Math.min(1, a / Math.max(1, pageW * pageH))
}

// ─── Text grouping fallback (when the layout segmenter fails) ──────────────
/**
 * Group raw text items (in content-stream order) into lines without assuming y direction.
 * item: {str, x, y, w, size, isBold?, isItalic?}
 */
export function groupItemsIntoLines(items) {
  const lines = []
  let cur = null
  for (const it of items) {
    const str = cleanText(it.str)
    if (!str) continue
    const size = it.size > 0 ? it.size : 10
    if (cur && Math.abs(it.y - cur.y) <= size * 0.5) {
      const gap = it.x - cur.xEnd
      const sep = gap > size * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(str) ? ' ' : ''
      cur.text += sep + str
      cur.spans.push({ text: sep + str, size, bold: !!it.isBold, italic: !!it.isItalic }) // keep spans in sync with text
      cur.xEnd = Math.max(cur.xEnd, it.x + (it.w || 0))
      cur.size = Math.max(cur.size, size)
      cur.isBold = cur.isBold && !!it.isBold
    } else {
      cur = {
        text: str, x: it.x, y: it.y, xEnd: it.x + (it.w || 0), w: it.w || 0, h: size, size,
        isBold: !!it.isBold, isItalic: !!it.isItalic,
        spans: [{ text: str, size, bold: !!it.isBold, italic: !!it.isItalic }],
      }
      lines.push(cur)
    }
  }
  for (const l of lines) l.w = Math.max(0, l.xEnd - l.x)
  return lines
}

/** join wrapped lines into paragraphs (plain-text fallback) */
export function mergePlainLines(lines) {
  const out = []
  for (const l of lines) {
    const prev = out[out.length - 1]
    if (prev && Math.abs((prev.y ?? 0) - (l.y ?? 0)) <= 1.6 * Math.max(prev.size || 10, l.size || 10) &&
        Math.abs((prev.x ?? 0) - (l.x ?? 0)) < 6 && Math.abs((prev.size || 10) - (l.size || 10)) < 1) {
      const sep = /-$/.test(prev.text) ? '' : ' '
      prev.text += sep + l.text
      prev.spans = [...(prev.spans || []), { text: sep, size: prev.size }, ...(l.spans || [{ text: l.text, size: l.size, bold: l.isBold, italic: l.isItalic }])]
      prev.y = l.y
      prev.xEnd = Math.max(prev.xEnd ?? 0, l.xEnd ?? 0)
    } else out.push({ ...l, spans: l.spans ? [...l.spans] : [{ text: l.text, size: l.size, bold: l.isBold, italic: l.isItalic }] })
  }
  return out
}

// ─── Typography stats ──────────────────────────────────────────────────────
/** Body font size = size carrying the most characters (robust vs. many tiny/large items). */
export function dominantSize(hist, fallback = 11) {
  let best = fallback, bestN = -1
  for (const [size, n] of hist) if (n > bestN) { best = size; bestN = n }
  return best
}
export function addToHistogram(hist, items) {
  for (const it of items || []) {
    if (!(it.size > 0) || !it.str) continue
    const k = Math.round(it.size * 2) / 2
    hist.set(k, (hist.get(k) || 0) + String(it.str).length)
  }
}

/**
 * Per-page alignment helper. Returns fn(line) → 'left'|'center'|'right'|'justify'.
 * Justified only when most full-width body lines end flush on the right edge.
 */
export function makeAlignmentDetector(lines, bodySize) {
  const usable = lines.filter((l) => Number.isFinite(l.x) && Number.isFinite(l.xEnd ?? (l.x + (l.w || 0))))
  if (usable.length === 0) return () => 'left'
  const xe = (l) => l.xEnd ?? l.x + (l.w || 0)
  const minX = Math.min(...usable.map((l) => l.x))
  const maxX = Math.max(...usable.map(xe))
  const tw = Math.max(1, maxX - minX)
  const body = usable.filter((l) => Math.abs((l.size || bodySize) - bodySize) < 1 && xe(l) - l.x > 0.5 * tw)
  const flush = body.filter((l) => maxX - xe(l) < 0.012 * tw).length
  const justified = body.length >= 4 && flush / body.length >= 0.6
  return (l) => {
    if (l.align === 'center' || l.align === 'right' || l.align === 'justify') return l.align
    const w = xe(l) - l.x
    const center = (l.x + xe(l)) / 2
    if (w < 0.8 * tw && Math.abs(center - (minX + maxX) / 2) < 0.03 * tw && l.x - minX > 0.05 * tw) return 'center'
    if (w < 0.6 * tw && maxX - xe(l) < 0.02 * tw && l.x - minX > 0.3 * tw) return 'right'
    return justified && w > 0.9 * tw ? 'justify' : 'left'
  }
}

// ─── Table grid normalisation ──────────────────────────────────────────────
/** Percent widths (any sum) → integer twips summing exactly to totalTwips. */
export function percentToTwips(pcts, totalTwips) {
  const n = pcts.length || 1
  const safe = pcts.map((p) => (Number.isFinite(p) && p > 0 ? p : 100 / n))
  const sum = safe.reduce((a, b) => a + b, 0)
  const out = safe.map((p) => Math.max(240, Math.floor((p / sum) * totalTwips)))
  const diff = totalTwips - out.reduce((a, b) => a + b, 0)
  out[out.length - 1] += diff
  return out
}

/**
 * Grow columns that are narrower than their longest unbreakable word (needs, in twips),
 * taking the space from columns that have slack. Total stays exactly the same.
 */
export function fitColumnWidths(widths, needs) {
  const total = widths.reduce((a, b) => a + b, 0)
  const out = widths.slice()
  const need = needs.map((n, i) => Math.min(n || 0, Math.floor(total * 0.6)))
  let deficit = 0
  for (let i = 0; i < out.length; i++) if (out[i] < need[i]) { deficit += need[i] - out[i]; out[i] = need[i] }
  if (deficit <= 0) return out
  const slack = out.map((w, i) => Math.max(0, w - Math.max(need[i], 240)))
  const slackSum = slack.reduce((a, b) => a + b, 0)
  if (slackSum <= 0) return widths.slice()
  const take = Math.min(deficit, slackSum)
  let taken = 0
  for (let i = 0; i < out.length; i++) {
    const cut = Math.floor((slack[i] / slackSum) * take)
    out[i] -= cut; taken += cut
  }
  // rounding remainder goes to the widest column so the sum is exact
  const diff = (total - out.reduce((a, b) => a + b, 0))
  const widest = out.indexOf(Math.max(...out))
  out[widest] += diff
  return out
}

/** Rough twips needed for the longest word of a cell (avoids mid-number wraps like "$1,200.5 / 0"). */
export function cellMinTwips(text, fontPt = 10) {
  const str = String(text || '').trim()
  // Short phrases like "Page 1", "35%", "OPERATIONAL" should never wrap across lines
  if (str.length <= 15) {
    return Math.ceil(str.length * fontPt * 0.65 * 20) + 300
  }
  const longest = str.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0)
  return Math.ceil(longest * fontPt * 0.56 * 20) + 230 // 0.56em avg glyph + cell margins
}

/**
 * Make every row's logical width equal numCols (pads with empty cells / trims overflow).
 * rows: [{cells:[{columnSpan?, rowSpan?, ...}]}]; mutates and returns rows.
 */
export function normalizeTableRows(rows, numCols, makeEmptyCell) {
  const occ = new Array(numCols).fill(0) // rows still covered by an earlier rowSpan, per column
  for (const row of rows) {
    const kept = []
    const starts = [] // column index where each kept cell starts
    let col = 0
    for (const cell of row.cells) {
      while (col < numCols && occ[col] > 0) col++
      if (col >= numCols) break
      const span = Math.min(Math.max(1, cell.columnSpan || 1), numCols - col)
      cell.columnSpan = span
      kept.push(cell); starts.push(col)
      col += span
    }
    // pad free columns on the right with empty cells
    for (; col < numCols; col++) {
      if (occ[col] > 0) continue
      kept.push(makeEmptyCell()); starts.push(col)
    }
    row.cells = kept
    for (let c = 0; c < numCols; c++) if (occ[c] > 0) occ[c]--
    kept.forEach((cell, i) => {
      const rs = cell.rowSpan || 1
      if (rs > 1) for (let k = 0; k < (cell.columnSpan || 1); k++) occ[starts[i] + k] = rs - 1
    })
  }
  return rows
}

// ─── Progress / velocity ───────────────────────────────────────────────────
export function makeVelocityTracker() {
  const t0 = now()
  return {
    snapshot(done, total) {
      const elapsed = (now() - t0) / 1000
      const pps = elapsed > 0.5 && done > 0 ? done / elapsed : 0
      const etaSec = pps > 0 && done >= 3 ? Math.max(0, Math.round((total - done) / pps)) : null
      return { elapsedSec: Math.round(elapsed), pagesPerSec: pps ? Math.round(pps * 10) / 10 : 0, etaSec }
    },
  }
}

export function formatEta(sec) {
  if (sec == null) return ''
  if (sec < 60) return `~${Math.max(1, sec)}s left`
  return `~${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s left`
}

/** Is this blob/array a ZIP (every valid .docx starts with "PK\x03\x04")? */
export async function looksLikeZip(blob) {
  try {
    const buf = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
    return blob.size > 100 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
  } catch { return false }
}

export function classifyPdfError(err) {
  if (err instanceof ConversionError) return err
  const name = err?.name || ''
  const msg = err?.message || String(err)
  if (name === 'PasswordException') return new ConversionError('ENCRYPTED', 'This PDF is password-protected. Remove the password and try again.', err)
  if (name === 'InvalidPDFException' || /invalid pdf|missing pdf|unexpected server response/i.test(msg)) return new ConversionError('INVALID_PDF', 'This file is not a valid or readable PDF.', err)
  if (name === 'AbortError') return abortError()
  if (/out of memory|allocation failed|array buffer allocation/i.test(msg)) return new ConversionError('OOM', 'The browser ran out of memory. Close other tabs or split the PDF into smaller parts.', err)
  return new ConversionError('INTERNAL', msg || 'Conversion failed.', err)
}
