/**
 * pdfUnicode.js — shared Unicode/BiDi layer (T1.4/T1.5, P0-9).
 * Pure JS, no deps. Mirrors the sandbox-verified reference implementation.
 */
const RTL_RANGE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
const LTR_RANGE = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0900-\u097F]/
const LETTER = /\p{L}/u
const DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9]/

/** NFKC: Arabic/Hebrew presentation forms → canonical letters; ligatures ﬁ→fi. */
export function normalizeText(str) {
  return String(str ?? '').normalize('NFKC')
}

export const containsRtl = (s) => RTL_RANGE.test(String(s ?? ''))

/** Strong direction: LETTERS ONLY (UAX#9 — ، ؛ ؟ are CS/ON, digits are AN/EN, harakat are NSM). */
export function strongDir(s) {
  let r = 0, l = 0, digit = false
  for (const ch of String(s ?? '')) {
    if (LETTER.test(ch)) {
      if (RTL_RANGE.test(ch)) r++
      else if (LTR_RANGE.test(ch)) l++
    } else if (DIGIT.test(ch)) digit = true
  }
  if (r === 0 && l === 0) return digit ? 'en' : 'neutral'
  return r > l ? 'rtl' : 'ltr'
}

export function isMostlyRtl(s) {
  let r = 0, l = 0
  for (const ch of String(s ?? '')) {
    if (!LETTER.test(ch)) continue
    if (RTL_RANGE.test(ch)) r++; else l++
  }
  return r + l > 0 && r / (r + l) > 0.5
}

/**
 * Simplified UAX#9 L2: items arrive x-ascending (visual left→right);
 * returns them in LOGICAL order. Never reverses characters inside an item.
 */
export function reorderVisualToLogical(items) {
  if (!items || items.length < 2) return items ? items.slice() : []
  const dirs = items.map((it) => strongDir(it.str))
  const base = dirs.filter((d) => d === 'rtl').length > dirs.filter((d) => d === 'ltr').length ? 1 : 0
  const resolved = []
  let prev = null
  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i]
    if (d === 'rtl' || d === 'ltr') { resolved.push(d); prev = d }
    else if (d === 'en') resolved.push('en') // N1: EN influences neighbors as R; own level stays even
    else {
      const nxt = dirs.slice(i + 1).find((x) => x === 'rtl' || x === 'ltr') || null
      const p = prev === 'en' ? 'rtl' : prev
      resolved.push(p && nxt && p === nxt ? p : base ? 'rtl' : 'ltr')
    }
  }
  const levels = resolved.map((d) =>
    base ? (d === 'rtl' ? 1 : 2) : d === 'rtl' ? 1 : 0)
  let idx = items.map((_, i) => i)
  for (let lvl = Math.max(...levels); lvl >= 1; lvl--) {
    let i = 0
    while (i < idx.length) {
      if (levels[idx[i]] >= lvl) {
        let j = i
        while (j < idx.length && levels[idx[j]] >= lvl) j++
        const seg = idx.slice(i, j).reverse()
        idx = [...idx.slice(0, i), ...seg, ...idx.slice(j)]
        i = j
      } else i++
    }
  }
  return idx.map((k) => items[k])
}

/** Calibrated synthetic space (fixes "Pa g e"); never around sub/superscripts (fixes "H 2 SO 4"). */
export function shouldInsertSpace({ gapPt, sizePt, spaceEm = null, prevSubSup = false, curSubSup = false }) {
  if (prevSubSup || curSubSup) return false
  return gapPt > (spaceEm ?? 0.2) * sizePt
}

/** Generic sub/superscript from size drop + baseline offset (bottom-up y, segmenter convention). */
export function subSupFlags(size, lineSize, y, baselineY) {
  if (size <= 0.88 * lineSize) {
    if (baselineY - y >= 0.08 * lineSize) return 'sub'
    if (y - baselineY >= 0.10 * lineSize) return 'sup'
  }
  return null
}

/** OPT-IN only: producers that emit pre-shaped VISUAL-order RTL (verified on your §08 Hebrew). */
export function reverseRtlVisual(str) {
  return [...String(str ?? '')].reverse().join('')
}
