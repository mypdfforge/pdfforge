/**
 * ocrPostProcess.js
 * Pure, client-side helpers: sub/superscripts, script detection, fuzzy compare,
 * native-vs-OCR region routing, field-typed confusable fixes, punctuation cleanup.
 * No DOM, no network. Deterministic: same input -> same output.
 */

const SUP = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ',
  m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
}
const SUB = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ',
  s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
}

/** Map a run to Unicode super/subscript. Unmappable runs fall back to ^(..) / _(..) so nothing is dropped. */
export function toScript(str, kind) {
  const map = kind === 'sup' ? SUP : SUB
  const mark = kind === 'sup' ? '^' : '_'
  let uni = ''
  let mapped = true
  for (const ch of str) {
    const m = map[ch]
    if (!m) { mapped = false; break }
    uni += m
  }
  return {
    uni: mapped ? uni : `${mark}(${str})`,
    latex: `${mark}{${str}}`,
    mapped,
  }
}

const SCRIPT_RES = [
  ['latin', /\p{Script=Latin}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['greek', /\p{Script=Greek}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['thai', /\p{Script=Thai}/u],
  ['cjk', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u],
  ['emoji', /\p{Extended_Pictographic}/u],
]

/** Unicode-range voting. Returns dominant script name, or 'other'. */
export function detectScript(text) {
  const votes = {}
  for (const ch of text || '') {
    for (const [name, re] of SCRIPT_RES) {
      if (re.test(ch)) { votes[name] = (votes[name] || 0) + 1; break }
    }
  }
  let best = 'other'
  let n = 0
  for (const [k, v] of Object.entries(votes)) if (v > n) { best = k; n = v }
  return best
}

export function isRtlText(text) {
  let rtl = 0
  let letters = 0
  for (const ch of text || '') {
    if (/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(ch)) { rtl++; letters++ }
    else if (/\p{L}/u.test(ch)) letters++
  }
  return letters > 0 && rtl / letters > 0.5
}

export function normalizeForCompare(s) {
  return (s || '').normalize('NFKC').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** 0..1 similarity. Levenshtein for short strings, token-set Jaccard for long. */
export function similarity(a, b) {
  const x = normalizeForCompare(a)
  const y = normalizeForCompare(b)
  if (!x && !y) return 1
  if (!x || !y) return 0
  if (x === y) return 1
  const m = Math.max(x.length, y.length)
  if (m > 400) {
    const A = new Set(x.split(' '))
    const B = new Set(y.split(' '))
    let inter = 0
    for (const t of A) if (B.has(t)) inter++
    return inter / (A.size + B.size - inter)
  }
  return 1 - lev(x, y) / m
}

/** Rect overlap. Lines need xMin,yMin,xMax,yMax. */
export function overlap(a, b) {
  const w = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin)
  const h = Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin)
  if (w <= 0 || h <= 0) return { inter: 0, iou: 0, coverA: 0, coverB: 0 }
  const inter = w * h
  const areaA = Math.max(1e-6, (a.xMax - a.xMin) * (a.yMax - a.yMin))
  const areaB = Math.max(1e-6, (b.xMax - b.xMin) * (b.yMax - b.yMin))
  return { inter, iou: inter / (areaA + areaB - inter), coverA: inter / areaA, coverB: inter / areaB }
}

/**
 * Region router. Invariant: for any page region, ONE text source only.
 * Native lines are validated upstream (isNativeGood). An OCR line that sits on native
 * text is dropped (native wins). OCR kept only where no native text exists.
 */
export function routeRegions(nativeLines, ocrLines) {
  const keptOcr = []
  for (const o of ocrLines) {
    let covered = 0
    for (const n of nativeLines) covered += overlap(o, n).coverA
    if (covered < 0.5) keptOcr.push(o)
  }
  return [...nativeLines, ...keptOcr]
}

/** Drop near-duplicate lines (same place, same text). Keeps native, then higher confidence. */
export function dedupeLines(lines) {
  const rank = l => (l.source === 'native' ? 2 : 1) + (l.mean ?? 1) * 0.01
  const drop = new Set()
  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i)) continue
    for (let j = i + 1; j < lines.length; j++) {
      if (drop.has(j)) continue
      const o = overlap(lines[i], lines[j])
      if ((o.iou >= 0.5 || Math.max(o.coverA, o.coverB) >= 0.7) && similarity(lines[i].text, lines[j].text) >= 0.85) {
        drop.add(rank(lines[i]) >= rank(lines[j]) ? j : i)
        if (drop.has(i)) break
      }
    }
  }
  return lines.filter((_, i) => !drop.has(i))
}

/** Approximate per-word boxes by character proportion along the line. */
export function lineWords(line) {
  const text = (line.text || '').trim()
  if (!text) return []
  const total = text.length
  const w = line.xMax - line.xMin
  let from = 0
  return text.split(/\s+/).map(p => {
    const i = text.indexOf(p, from)
    from = i + p.length
    return {
      text: p,
      bbox: [line.xMin + (i / total) * w, line.yMin, line.xMin + ((i + p.length) / total) * w, line.yMax],
      conf: line.mean ?? 1,
      source: line.source || 'ocr',
    }
  })
}

/** Text that must never get prose autocorrect: URLs, emails, hashes, ids, code. */
export function isProtectedText(t) {
  return /https?:\/\/|www\.|\S+@\S+\.\S+|[A-Za-z0-9+/=_-]{24,}|^\s*(def|class|import|return)\b|[{}();=]{2,}/.test(t)
}

/** Context-constrained fixes. Only touches patterns that are unambiguous. */
export function fixFieldConfusables(text) {
  if (!text) return text
  let t = text
  // Euro read as E: "(E3,120,000.00)" and "E3,120"
  t = t.replace(/\(E(?=\d{1,3}(?:,\d{3})*(?:\.\d+)?\))/g, '(€')
  t = t.replace(/(^|[\s(])E(?=\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s|\)|$))/g, '$1€')
  // IDs like EVT-9OOO2 -> EVT-90002 (needs at least one real digit)
  t = t.replace(/\b([A-Z]{2,5})-([0-9OIlSB]{3,})\b/g, (m, p, d) =>
    /\d/.test(d) ? `${p}-${d.replace(/O/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5').replace(/B/g, '8')}` : m)
  // Mostly-digit tokens: O->0, l/I->1
  t = t.replace(/(?<![A-Za-z])[0-9OolI][0-9OolI.,]{2,}%?(?![A-Za-z])/g, tok => {
    const core = tok.replace(/[.,%]/g, '')
    const digits = (core.match(/\d/g) || []).length
    return digits >= 2 && digits / core.length >= 0.6 ? tok.replace(/[Oo]/g, '0').replace(/[lI]/g, '1') : tok
  })
  // Check mark read as square root
  t = t.replace(/(^|[\s(:])√(?=\s|$|\))/g, '$1✓')
  t = t.replace(/\bPh\.D\]/g, 'Ph.D.')
  return t
}

/** Prose-only punctuation cleanup. Skipped for protected text. */
export function normalizePunctuation(text) {
  if (!text || isProtectedText(text)) return text
  return text
    .replace(/&\.(?=\s|$)/g, '&')
    .replace(/(\w)&(?=\s|$)/g, '$1 &')
    .replace(/[—–]{2,}/g, '—')
    .replace(/(\w) '(s)\b/g, "$1'$2")
    .replace(/\s+([,.;:!?])/g, '$1')
}

/** Normalize list bullets: · • ● ▪ all -> • */
export function normalizeBullet(ch) {
  return /[·•●▪◦○‣⁃]/.test(ch) ? '•' : ch
}
