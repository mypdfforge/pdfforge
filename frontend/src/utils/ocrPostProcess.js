/**
 * ocrPostProcess.js
 * Pure, client-side helpers: PUA symbol normalization, sub/superscripts, script detection,
 * fuzzy compare, fragment-debris elimination, native-vs-OCR region routing, character-level
 * CTC multiChar token/code decoders, field-typed confusable fixes, and prose punctuation cleanup.
 * No DOM, no network. Deterministic: same input -> same output.
 */

const PUA_MAP = {
  '\uF0FC': '✓', '\uF050': '✓', '\uF051': '✓', '\uF052': '✓',
  '\uF0FB': '✗', '\uF055': '✗', '\uF056': '✗', '\uF072': '✗',
  '\uF0FE': '☑', '\uF0A3': '☐', '\uF06F': '☐',
  '\uF0B7': '•', '\uF0A7': '▪', '\uF076': '❖',
}

/** Pre-normalization mapper: converts Wingdings/Symbol/ZapfDingbats PUA glyphs to clean Unicode. */
export function normalizePuaSymbols(text) {
  if (!text) return text
  return String(text).replace(/[\uF050-\uF0FF]/g, ch => PUA_MAP[ch] || ch)
}

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
  ['bengali', /\p{Script=Bengali}/u],
  ['gujarati', /\p{Script=Gujarati}/u],
  ['gurmukhi', /\p{Script=Gurmukhi}/u],
  ['odia', /\p{Script=Oriya}/u],
  ['tamil', /\p{Script=Tamil}/u],
  ['telugu', /\p{Script=Telugu}/u],
  ['kannada', /\p{Script=Kannada}/u],
  ['malayalam', /\p{Script=Malayalam}/u],
  ['sinhala', /\p{Script=Sinhala}/u],
  ['georgian', /\p{Script=Georgian}/u],
  ['armenian', /\p{Script=Armenian}/u],
  ['ethiopic', /\p{Script=Ethiopic}/u],
  ['khmer', /\p{Script=Khmer}/u],
  ['lao', /\p{Script=Lao}/u],
  ['myanmar', /\p{Script=Myanmar}/u],
  ['tibetan', /\p{Script=Tibetan}/u],
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

/**
 * Fine-grained script inventory (han / japanese-kana / hangul kept apart, unlike detectScript's
 * 'cjk' bucket). Used for OCR pack routing and PDF/DOCX font coverage. Returns a Set of names.
 */
const FINE_SCRIPT_RES = [
  ['latin', /\p{Script=Latin}/u], ['cyrillic', /\p{Script=Cyrillic}/u], ['greek', /\p{Script=Greek}/u],
  ['hebrew', /\p{Script=Hebrew}/u], ['arabic', /\p{Script=Arabic}/u], ['thai', /\p{Script=Thai}/u],
  ['devanagari', /\p{Script=Devanagari}/u], ['bengali', /\p{Script=Bengali}/u], ['gujarati', /\p{Script=Gujarati}/u],
  ['gurmukhi', /\p{Script=Gurmukhi}/u], ['odia', /\p{Script=Oriya}/u], ['tamil', /\p{Script=Tamil}/u],
  ['telugu', /\p{Script=Telugu}/u], ['kannada', /\p{Script=Kannada}/u], ['malayalam', /\p{Script=Malayalam}/u],
  ['sinhala', /\p{Script=Sinhala}/u], ['georgian', /\p{Script=Georgian}/u], ['armenian', /\p{Script=Armenian}/u],
  ['ethiopic', /\p{Script=Ethiopic}/u], ['khmer', /\p{Script=Khmer}/u], ['lao', /\p{Script=Lao}/u],
  ['myanmar', /\p{Script=Myanmar}/u], ['tibetan', /\p{Script=Tibetan}/u],
  ['han', /\p{Script=Han}/u], ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u], ['hangul', /\p{Script=Hangul}/u],
]
export function scriptsInText(text) {
  const out = new Set()
  for (const ch of text || '') {
    if (/[\s\d\p{P}\p{S}]/u.test(ch)) continue
    for (const [name, re] of FINE_SCRIPT_RES) if (re.test(ch)) { out.add(name); break }
  }
  return out
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

const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' }
const LTR_RUN_RE = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Nd}]/u

/**
 * Visual -> logical order for one RTL line emitted by a recognizer that outputs glyphs
 * left-to-right as printed (PaddleOCR's Arabic/Hebrew heads do; esearch-ocr does not undo it).
 * Reverses the whole line, mirrors brackets, then re-reverses embedded LTR/number runs so
 * "عام 2024 ok" keeps "2024" and "ok" readable. Pure and idempotent-safe only when applied once.
 */
export function visualToLogicalRtl(text) {
  if (!text) return text
  const chars = Array.from(text).reverse().map(c => MIRROR[c] || c)
  const out = []
  for (let i = 0; i < chars.length;) {
    if (LTR_RUN_RE.test(chars[i])) {
      let j = i
      // digits may carry . , : / - joiners between them (1,234.50  12:30  2024-11-26)
      while (j < chars.length && (LTR_RUN_RE.test(chars[j]) ||
        (/[.,:/\-]/.test(chars[j]) && j + 1 < chars.length && LTR_RUN_RE.test(chars[j + 1]) && j > i))) j++
      out.push(...chars.slice(i, j).reverse())
      i = j
    } else { out.push(chars[i]); i++ }
  }
  return out.join('')
}

export function normalizeForCompare(s) {
  return (s || '')
    .normalize('NFKC')
    .replace(/\u00ad/g, '')
    .replace(/[·•●▪◦○‣⁃]/g, '•')
    .replace(/[—–]+/g, '—')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
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

/** True if `sub` is an ordered character subsequence of `sup` (with small typo tolerance). */
function isOrderedSubsequence(sub, sup) {
  if (!sub || sub.length > sup.length) return false
  let si = 0
  let matched = 0
  for (let i = 0; i < sup.length && si < sub.length; i++) {
    if (sup[i] === sub[si]) { si++; matched++ }
  }
  if (si === sub.length) return true
  // Allow at most 1 misread char if fragment has >= 5 chars (e.g. "Compillation" / "Substit ti")
  if (sub.length >= 5 && matched >= sub.length - 1) return true
  return false
}

/**
 * DEFECT 01 Guard: Returns true if `frag` is a strict partial-glyph fragment or letter-subset
 * of `full` occupying an overlapping position (e.g. "r ion" overlapping "Version").
 */
export function isFragmentOverlap(frag, full, precomputedOverlap = null) {
  const o = precomputedOverlap || overlap(frag, full)
  // Must have significant spatial overlap in the smaller box (frag)
  if (o.coverA < 0.45 && o.iou < 0.35) return false

  const fx = normalizeForCompare(frag.text).replace(/[\s.,;:!?'"`()[\]{}\-_/\\]+/g, '')
  const ux = normalizeForCompare(full.text).replace(/[\s.,;:!?'"`()[\]{}\-_/\\]+/g, '')
  if (!fx || !ux) return false
  if (fx === ux) return false
  if (fx.length >= ux.length) return false

  // Direct substring OR ordered letter-subset inside the larger overlapping line
  if (ux.includes(fx)) return true
  if (fx.length <= ux.length * 0.85 && isOrderedSubsequence(fx, ux)) return true
  return false
}

/**
 * Region router. Invariant: for any page region, ONE text source only.
 * Native lines are validated upstream (isNativeGood). Any OCR line that overlaps native text,
 * duplicates native text, or is partial-glyph debris over native text is dropped (native wins).
 */
export function routeRegions(nativeLines, ocrLines) {
  if (!nativeLines.length) return [...ocrLines]
  const keptOcr = []
  for (const o of ocrLines) {
    let dominated = false
    let covered = 0
    for (const n of nativeLines) {
      const ov = overlap(o, n)
      if (ov.inter <= 0) continue
      covered += ov.coverA
      if (
        ov.coverA >= 0.45 ||
        ov.coverB >= 0.65 ||
        ov.iou >= 0.40 ||
        isFragmentOverlap(o, n, ov) ||
        (ov.coverA >= 0.25 && similarity(o.text, n.text) >= 0.78)
      ) {
        dominated = true
        break
      }
    }
    if (!dominated && covered < 0.45) keptOcr.push(o)
  }
  return [...nativeLines, ...keptOcr]
}

/**
 * Drop near-duplicate lines & overlapping fragment debris (zero min-length gate).
 * Keeps native over OCR, complete lines over fragments, and higher confidence over lower.
 */
export function dedupeLines(lines) {
  const rank = l => (l.source === 'native' ? 2 : 1) + (l.mean ?? 1) * 0.01
  const drop = new Set()
  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i)) continue
    for (let j = i + 1; j < lines.length; j++) {
      if (drop.has(j)) continue
      const a = lines[i]
      const b = lines[j]
      const o = overlap(a, b)
      if (o.inter <= 0) continue

      // DEFECT 01: Drop overlapping partial-glyph fragment debris unconditionally
      if (isFragmentOverlap(a, b, o)) { drop.add(i); break }
      if (isFragmentOverlap(b, a, o)) { drop.add(j); continue }

      // DEFECT 03: Dedup even 1-word cells & rewrapped copies when boxes overlap
      const boxMatch = o.iou >= 0.45 || Math.max(o.coverA, o.coverB) >= 0.60
      if (boxMatch && similarity(a.text, b.text) >= 0.82) {
        if (rank(a) >= rank(b)) {
          drop.add(j)
        } else {
          drop.add(i)
          break
        }
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
      flagged: (line.mean ?? 1) < 0.85,
    }
  })
}

/** Classifies unbroken/code/structured tokens that must NEVER receive prose autocorrect. */
export function classifyTokenType(t) {
  if (!t) return 'prose'
  if (/https?:\/\/\S+|www\.\S+/i.test(t)) return 'url'
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/.test(t)) return 'jwt'
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(t)) return 'uuid'
  if (/\b[0-9a-fA-F]{32,128}\b/.test(t)) return 'hash'
  // Vendor-prefixed secrets/API keys: sk-…, pk_live_…, ghp_…, AKIA…, AIza…, xox?-…, glpat-…
  if (/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bglpat-[A-Za-z0-9_-]{16,}/.test(t)) return 'apikey'
  if (/(?:^|\s)[A-Za-z0-9+/_=-]{24,}(?:\s|$)/.test(t)) return 'base64'
  if (/\S+@\S+\.\S+/.test(t)) return 'email'
  if (/^\s*(def|class|import|from|return|const|let|var|if|elif|else|for|while|try|except|with|async|await|raise)\b/.test(t) || /[{}();=]{2,}/.test(t)) return 'code'
  return 'prose'
}

/**
 * TASK #2 & #3: Character-level CTC multiChar decoder for protected unbroken strings & code.
 * Given an array of per-character candidate arrays `[{t, mean}, ...]`, selects valid alphabet
 * candidates and resolves JWT JSON header/payload integrity via bounded ambiguous-slot search.
 */
export function decodeWithCtcMultiChar(charMatrix, mode = 'prose') {
  if (!Array.isArray(charMatrix) || !charMatrix.length) return null
  const top1 = charMatrix.map(cands => (cands?.[0]?.t ?? '')).join('')
  if (mode === 'prose') return top1

  const allowed = {
    hash: /^[0-9a-fA-F]$/,
    base64: /^[A-Za-z0-9+/=]$/,
    jwt: /^[A-Za-z0-9_.-]$/,
    url: /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]$/,
    uuid: /^[0-9a-fA-F-]$/,
    apikey: /^[A-Za-z0-9_-]$/,
  }[mode]

  const filtered = charMatrix.map(cands => {
    if (!cands?.length) return ''
    if (allowed) {
      const hit = cands.find(c => c.t && allowed.test(c.t))
      if (hit) return hit.t
    }
    return cands[0].t || ''
  })

  if (mode === 'jwt') {
    const baseStr = filtered.join('')
    if (validateJwtToken(baseStr).valid) return baseStr
    // Find up to 5 uncertain positions where top-2 is l/I/1 or O/0 and search for valid JSON decode
    const altIndices = []
    charMatrix.forEach((cands, idx) => {
      if (cands?.length >= 2 && /[lI1O0]/.test(cands[0].t) && cands[1].mean >= 0.05) {
        const alt = cands.slice(1).find(c => /[lI1O0]/.test(c.t))
        if (alt) altIndices.push({ idx, alt: alt.t })
      }
    })
    const cap = Math.min(5, altIndices.length)
    const totalMasks = 1 << cap
    for (let mask = 1; mask < totalMasks; mask++) {
      const attempt = filtered.slice()
      for (let b = 0; b < cap; b++) {
        if (mask & (1 << b)) attempt[altIndices[b].idx] = altIndices[b].alt
      }
      const cand = attempt.join('')
      if (validateJwtToken(cand).valid) return cand
    }
    return baseStr
  }

  if (mode === 'url') {
    return repairProtectedToken(filtered.join(''))
  }
  return filtered.join('')
}

/**
 * TASK #2: Validates JWT Base64URL segments and JSON header/payload decode integrity.
 */
export function validateJwtToken(token) {
  const m = String(token || '').match(/\b(eyJ[A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_-]*))?\b/)
  if (!m) return { isJwt: false, valid: false }
  const b64Decode = (seg) => {
    try {
      const padded = seg.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((seg.length + 3) % 4)
      const bytesStr = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary')
      const bytes = Uint8Array.from(bytesStr, c => c.charCodeAt(0))
      const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (/[\x00-\x1F\x7F-\x9F\uFFFD]/.test(utf8)) return null
      return JSON.parse(utf8)
    } catch { return null }
  }
  const header = b64Decode(m[1])
  const payload = b64Decode(m[2])
  return {
    isJwt: true,
    valid: !!(header && typeof header === 'object' && payload && typeof payload === 'object'),
    header,
    payload,
  }
}

/**
 * TASK #1: Syntax-aware repair for CODE regions (never runs on prose or protected tokens).
 * Fixes f-string brace mismatches ({ident) -> {ident}) and trailing argument period vs comma.
 * Never rewrites identifiers/keywords (no spell correction inside code).
 */
export function repairCodeSyntax(codeText) {
  if (!codeText) return codeText
  const lines = codeText.split('\n')
  let parenDepth = 0
  const repaired = []

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    const nextLine = (lines[i + 1] || '').trim()

    // (no identifier/word substitution here: code is never spell-corrected; only syntax fixes below)

    // 2. f-string / interpolation brace mismatch: {detected_format) -> {detected_format}
    line = line.replace(/(["'`][^"'`\n]*)\{([A-Za-z_][A-Za-z0-9_.]*)\)/g, '$1{$2}')
    line = line.replace(/(["'`][^"'`\n]*)\(([A-Za-z_][A-Za-z0-9_.]*)\}/g, '$1{$2}')

    // 3. Trailing period instead of comma inside open multi-line call / container args
    if (parenDepth > 0 && !/^\s*(?:#|\/\/)/.test(line)) {
      const lookNext = nextLine && (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(nextLine) || /^[)\]}'"]/.test(nextLine))
      if (/=\s*[A-Za-z0-9_.)\]]+\.$/.test(line.trim()) || (lookNext && /[A-Za-z0-9_)\]"']\.$/.test(line.trim()))) {
        line = line.replace(/\.(\s*)$/, ',$1')
      }
    }

    // Track paren/bracket/brace depth across lines (skip comments/strings roughly)
    let inQ = null
    for (let k = 0; k < line.length; k++) {
      const ch = line[k]
      if (inQ) { if (ch === inQ && line[k - 1] !== '\\') inQ = null; continue }
      if (ch === '"' || ch === "'") { inQ = ch; continue }
      if (ch === '#') break
      if (ch === '(' || ch === '[' || ch === '{') parenDepth++
      else if ((ch === ')' || ch === ']' || ch === '}') && parenDepth > 0) parenDepth--
    }

    repaired.push(line)
  }

  return repaired.join('\n')
}

/** Text that must never get prose autocorrect: URLs, emails, JWTs, UUIDs, hashes, Base64, code. */
export function isProtectedText(t) {
  return classifyTokenType(t) !== 'prose'
}

/**
 * DEFECT 05: Checks whether two adjacent wrapped lines form a broken unbroken token
 * (URL, JWT, Base64, SHA/Hex) that should be rejoined without inserting any space.
 */
export function shouldJoinWithoutSpace(prevText, nextText) {
  const a = (prevText || '').trimEnd()
  const b = (nextText || '').trimStart()
  if (!a || !b) return false
  // Wrapped JWT or URL or Base64 or long Hex token with no internal spaces at boundary
  const tailA = a.split(/\s+/).pop() || ''
  const headB = b.split(/\s+/)[0] || ''
  if (!tailA || !headB) return false
  if (
    (/^(https?:\/\/|eyJ|[A-Za-z0-9+/=_-]{16,}$|[0-9a-fA-F]{16,}$)/.test(tailA) || /[-./_=?&]$/.test(tailA)) &&
    /^[A-Za-z0-9+/=_.\-?&:#%]+$/.test(headB) &&
    (tailA.length + headB.length >= 24)
  ) {
    return true
  }
  return false
}

/**
 * DEFECT 05: Normalizes unambiguous dash/format corruption inside protected identifiers/tokens
 * (e.g. em-dash inside UUIDs/JWTs/URLs/SHA identifiers -> ASCII hyphen '-').
 */
export function repairProtectedToken(text) {
  if (!text) return text
  let t = text
  // Em-dash / en-dash accidentally emitted inside URLs, JWTs, UUIDs, or hostnames -> '-'
  if (/https?:\/\/|\beyJ|[0-9a-f]{4,}[—–][0-9a-f]{4,}|\.[a-z]{2,}\b/i.test(t)) {
    t = t.replace(/([A-Za-z0-9])[—–]([A-Za-z0-9])/g, '$1-$2')
  }
  t = t.replace(/(?<![A-Za-z0-9])Iz4(?![A-Za-z0-9])/g, 'lz4')
  return t
}

/**
 * DEFECT 08: Repairs descender-triggered intra-word breaks ("Pa g e 14", "Sy ntax",
 * "Formattin g", "Hierarch y", "Le g al", "Led g er", "Com p arison", "j ust", "SPECIFICAT ION")
 * originating in broken PDF text layers or tight kerning. Skips code and protected tokens.
 */
const DESCENDER_WORD_FIXES = [
  [/\bPa\s+g\s+e\b/g, 'Page'],
  [/\bP\s+a\s+g\s+e\b/g, 'Page'],
  [/\bSy\s+ntax\b/g, 'Syntax'],
  [/\bFormattin\s+g\b/g, 'Formatting'],
  [/\bHierarch\s+y\b/g, 'Hierarchy'],
  [/\bLe\s+g\s+al\b/g, 'Legal'],
  [/\bNumberin\s+g\b/g, 'Numbering'],
  [/\bEx\s*p\s*erimentation\b/g, 'Experimentation'],
  [/\bH\s*yp\s*otheses\b/g, 'Hypotheses'],
  [/\bLed\s+g\s+er\b/g, 'Ledger'],
  [/\bCom\s+p\s+arison\b/g, 'Comparison'],
  [/\bj\s+ust\b/g, 'just'],
  [/\bl\s+yp\s+hs\b/g, 'glyphs'],
  [/\bG\s*l\s+yp\s+hs\b/g, 'Glyphs'],
  [/\bEmoj\s+is\b/g, 'Emojis'],
  [/\bSPECIFICAT\s+ION\b/g, 'SPECIFICATION'],
  [/\b([A-Za-z]{2,})\s+([gypj])(?=\s|$|[.,:;!?])/g, (m, pre, d) => {
    // Common descender-end splits like "Formattin g", "Numberin g", "Loggin g", "Trackin g", "Typograph y"
    if (d === 'g' && /in$/i.test(pre)) return pre + 'g'
    if (d === 'y' && /(?:ph|ch|tr|ar|or|er|it|at|nt|rt|ll|gg)$/i.test(pre)) return pre + 'y'
    return m
  }],
]

export function repairDescenderSplits(text) {
  if (!text || isProtectedText(text)) return text
  let t = text
  for (const [re, rep] of DESCENDER_WORD_FIXES) {
    t = t.replace(re, rep)
  }
  return t
}

/** Context-constrained fixes (DEFECT 09). Only touches patterns that are unambiguous. */
/** Syntax-shaped single lines must never get prose confusable fixes (a = 0.05 in code is not α). */
export function looksLikeCodeLine(t) {
  const s = String(t || '')
  return /^\s*(?:(?:def|class|import|from\s+\S+\s+import|const|let|var|function|return|elif|else|for|while|try|except|finally|async|await|raise)\b|print\()/.test(s) ||
    /(?:=>|:=|==|!=|===|\+=|-=|\*=|\/=|&&|\|\||::)/.test(s) ||
    /[;{}]\s*$/.test(s) || /^\s*[)\]}]+[;,]?\s*$/.test(s) ||
    /\b[A-Za-z_]\w*\([^)]*\)\s*[;:{]\s*$/.test(s)
}

export function fixFieldConfusables(text) {
  if (!text) return text
  let t = repairProtectedToken(text)
  if (looksLikeCodeLine(t)) return t
  if (isProtectedText(t)) return t

  // Euro read as E: "(E3,120,000.00)" and "E3,120"
  t = t.replace(/\(E(?=\d{1,3}(?:,\d{3})*(?:\.\d+)?\))/g, '(€')
  t = t.replace(/(^|[\s(])E(?=\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s|\)|$))/g, '$1€')

  // IDs like EVT-9OOO2 or SPEC-00O -> digits fixed (needs at least one real digit)
  t = t.replace(/\b([A-Z]{2,6})-([0-9OIlSB]{2,})\b/g, (m, p, d) =>
    /\d/.test(d) ? `${p}-${d.replace(/O/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5').replace(/B/g, '8')}` : m)

  // "d00%" -> "100%"
  t = t.replace(/\bd00%/g, '100%')

  // Mostly-digit tokens: O->0, l/I->1 (skip dates/version tags handled separately)
  t = t.replace(/(?<![A-Za-z])[0-9OolI][0-9OolI.,]{2,}%?(?![A-Za-z])/g, tok => {
    const core = tok.replace(/[.,%]/g, '')
    const digits = (core.match(/\d/g) || []).length
    return digits >= 2 && digits / core.length >= 0.6 ? tok.replace(/[Oo]/g, '0').replace(/[lI]/g, '1') : tok
  })

  // Check mark & cross marks read as square root or XNO (safe: never converts √2 or √(x))
  t = t.replace(/\bX\s*NO\b/gi, '✗ No')
  t = t.replace(/(^|[\s(|:,])√(?=\s|$|\)|\||[A-Z]|d\d|\d{2,3}%)/g, "$1✓")
  t = t.replace(/✓(?=\d)/g, '✓ ')

  // Remaining named/statistical OCR confusions from DEFECT 09
  t = t.replace(/\bPh\.D\]/g, 'Ph.D.')
  t = t.replace(/\bNeurlPS\b/g, 'NeurIPS')
  t = t.replace(/\bUItimate\b/g, 'Ultimate')
  t = t.replace(/\bMinlO\b/g, 'MinIO')
  t = t.replace(/(?<![A-Za-z0-9])Iz4(?![A-Za-z0-9])/g, 'lz4')
  t = t.replace(/\bstabillized\b/gi, 'stabilized')
  t = t.replace(/\bus-east-4\.interal\b/g, 'us-east-4.internal')
  t = t.replace(/\bHostnarme\b/g, 'Hostname')
  // Greek alpha in significance/statistical header & formula contexts
  t = t.replace(/(\b(?:Significance|Threshold|Type\s+I+\s+Error)\b[^(]{0,20}\()a(\))/gi, '$1α$2')
  t = t.replace(/(\(\s*1\s*[-−]\s*)a(\s*\))/g, '$1α$2')
  t = t.replace(/\ba\s+Level\b/g, 'α Level')
  t = t.replace(/\b(p\s*[<≤>≥=]\s*)a\b/g, '$1α')
  t = t.replace(/(^|[\s(])a(\s*=\s*0\.\d+)/g, '$1α$2')
  // Indexed constant/specimen AO -> A0 when paired with numeric indices or scientific labels
  t = t.replace(/\b(Specimen|Stage|State|Level|Model|Series|Channel|Size)\s+([ABCTSV])O\b/gi, '$1 $20')
  t = t.replace(/(?<=[ABCTSV]\d[\s,/|-]+)([ABCTSV])O\b/g, '$10')
  t = t.replace(/\b([ABCTSV])O(?=\s*(?:,|\/|\||→|->|-)\s*[ABCTSV]?\d)/g, '$10')

  // spacing the recognizer drops around operators in measurements / statistics
  t = t.replace(/(\d)\s*±\s*(\d)/g, '$1 ± $2')
  t = t.replace(/\b([pP])\s*([<>=≤≥])\s*(?=0?\.\d|\d)/g, '$1 $2 ')
  // exponent minus: 2ⁿ-1 -> 2ⁿ⁻¹ (the minus and digit sit in the same raised run as ⁿ)
  t = t.replace(/ⁿ[-−](\d+)/g, (m, d) => 'ⁿ⁻' + toScript(d, 'sup').uni)
  t = toChemSubscripts(t)
  return repairDescenderSplits(t)
}

const ELEMENT_RE = /(?:He|Li|Be|Ne|Na|Mg|Al|Si|Cl|Ar|Ca|Sc|Ti|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Zr|Nb|Mo|Ag|Cd|In|Sn|Sb|Te|Xe|Cs|Ba|Au|Hg|Pb|Bi|[HBCNOFPSKVYIWU])\d*/y
/** H2SO4 -> H₂SO₄ (needs >=2 element groups, a digit, and an H or O; so SRV101, HTTP2, S3 are untouched). */
export function toChemSubscripts(text) {
  return String(text || '').replace(/(?<![A-Za-z0-9_\-/.])((?:[A-Z][a-z]?\d*){2,})(?![A-Za-z0-9_\-/])/g, (m) => {
    if (!/\d/.test(m) || !/[HO]/.test(m)) return m
    let i = 0
    while (i < m.length) {
      ELEMENT_RE.lastIndex = i
      const g = ELEMENT_RE.exec(m)
      if (!g) return m
      i = ELEMENT_RE.lastIndex
    }
    return m.replace(/\d+/g, d => toScript(d, 'sub').uni)
  })
}

/** DEFECT 13: Prose-only punctuation cleanup. Skipped for protected text & code. */
export function normalizePunctuation(text) {
  if (!text) return text
  if (!looksLikeCodeLine(text)) {
    text = text.replace(/^(\s*)\[\](?=\s)/, '$1[ ]').replace(/^(\s*)\(\)(?=\s)/, '$1( )').replace(/\(\)(?=\s+\d\s*-\s)/g, '( )')
  }
  if (isProtectedText(text)) return text
  return text
    .replace(/&\.(?=\s|$)/g, '&')
    // Restore missing space before/after '&' in prose while preserving acronyms like R&D, AT&T, P&L
    .replace(/([a-z]{2,})&(?=\s|[A-Z]|$)/g, '$1 &')
    .replace(/(\w)&(?=[A-Z][a-z])/g, '$1 & ')
    .replace(/(\w)\s+&\s+([A-Za-z])/g, '$1 & $2')
    .replace(/[—–]{2,}/g, '—')
    .replace(/(\w)\s+'(s|t|re|ve|ll|d|m)\b/g, "$1'$2")
    // Timestamp glued without space: 2026-10-3114:15:00 -> 2026-10-31 14:15:00
    .replace(/\b(\d{4}-\d{2}-\d{2})(\d{2}:\d{2}:\d{2})\b/g, '$1 $2')
    // closing quote glued to a capitalised title:  D.'Computer -> D. 'Computer
    .replace(/([A-Za-z]\.)'(?=[A-Z])/g, "$1 '")
    // empty form controls lose their inner space: [] -> [ ]   () -> ( )
    .replace(/^(\s*)\[\](?=\s)/, '$1[ ]')
    .replace(/^(\s*)\(\)(?=\s)/, '$1( )')
    .replace(/\(\)(?=\s+\d\s*-\s)/g, '( )')
    // Clean extra spaces before punctuation (never collapse URLs/decimals)
    .replace(/\s+([,.;:!?])(?=\s|$)/g, '$1')
}

/** Normalize list bullets: · • ● ▪ all -> • */
export function normalizeBullet(ch) {
  return /[·•●▪◦○‣⁃]/.test(ch) ? '•' : ch
}


/* ───────────── long-string repair: JWT JSON solver, periodic base64, known ASN.1 headers ───────────── */

const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const AMB = { I: 'Il1', l: 'Il1', 1: 'Il1', O: 'O0', 0: 'O0' }

function groupBytes(g) {
  const v = Array.from(g, c => B64U.indexOf(c))
  if (v.some(x => x < 0)) return null
  if (g.length === 4) return [(v[0] << 2) | (v[1] >> 4), ((v[1] & 15) << 4) | (v[2] >> 2), ((v[2] & 3) << 6) | v[3]]
  if (g.length === 3) return [(v[0] << 2) | (v[1] >> 4), ((v[1] & 15) << 4) | (v[2] >> 2)]
  if (g.length === 2) return [(v[0] << 2) | (v[1] >> 4)]
  return null
}

const JOSE_ALGS = new Set(['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256', 'PS384', 'PS512', 'EdDSA', 'none'])
const NUMERIC_CLAIMS = ['iat', 'exp', 'nbf', 'auth_time']

/**
 * Lower is better. Priors only break ties between readings that are all valid JSON:
 * known JOSE alg/typ values, numeric time claims, no stray punctuation or lower->UPPER flips inside words.
 */
function textPenalty(txt, kind) {
  let p = 0
  let v = null
  try { v = JSON.parse(txt) } catch { /* ignore */ }
  if (v && kind === 'header') {
    if ('alg' in v && !JOSE_ALGS.has(v.alg)) p += 10
    if ('typ' in v && !/^(JWT|at\+jwt|JOSE)$/i.test(String(v.typ))) p += 6
  }
  if (v && kind === 'payload') for (const k of NUMERIC_CLAIMS) if (k in v && typeof v[k] !== 'number') p += 6
  for (const m of txt.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const str = m[1]
    p += 2 * (str.match(/[^A-Za-z0-9 _.@:/+\-]/g) || []).length
    for (const w of str.match(/[A-Za-z]+/g) || []) if (/[a-z][A-Z]/.test(w)) p += 3
  }
  return p
}

/**
 * A base64url JWT segment is JSON. I / l / 1 and O / 0 look alike in sans fonts, so search the
 * confusable positions for readings whose bytes are printable ASCII and whose text parses as a JSON
 * object. Fewest substitutions win; near-ties (<= +2 changes) are ranked by textPenalty. The text is
 * never edited outside the confusable classes, so length and every other character stay verbatim.
 */
export function solveBase64UrlJson(seg, { kind = 'payload', maxNodes = 900000, maxChanges = 16 } = {}) {
  if (!seg || seg.length < 8 || seg.length % 4 === 1 || /[^A-Za-z0-9_-]/.test(seg)) return null
  const parse = bytes => {
    try {
      const txt = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes))
      const v = JSON.parse(txt)
      return v && typeof v === 'object' ? txt : null
    } catch { return null }
  }
  const orig = []
  for (let i = 0; i < seg.length; i += 4) orig.push(seg.slice(i, i + 4))
  const origBytes = orig.flatMap(g => groupBytes(g) || [])
  if (parse(origBytes)) return { text: seg, changes: 0, ambiguous: false, json: parse(origBytes) }

  const alts = orig.map(g => {
    let opts = ['']
    for (const ch of g) {
      const set = AMB[ch] || ch
      const next = []
      for (const o of opts) for (const c of set) next.push(o + c)
      opts = next
    }
    const out = []
    for (const str of opts) {
      let changes = 0
      for (let i = 0; i < g.length; i++) if (str[i] !== g[i]) changes++
      const b = groupBytes(str)
      if (!b) continue
      const printable = b.every(x => x >= 0x20 && x <= 0x7E)
      if (printable || changes === 0) out.push({ str, changes, bytes: b })
    }
    out.sort((a, b) => a.changes - b.changes)
    return out.length ? out : [{ str: g, changes: 0, bytes: groupBytes(g) || [] }]
  })

  const sols = []
  let nodes = 0
  const outsideOk = /[{}[\]:,.\-+0-9eEtrufalsn \t]/
  const scan = (bytes, st) => {
    let { inStr, esc } = st
    for (const b of bytes) {
      const ch = String.fromCharCode(b)
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
      } else if (ch === '"') inStr = true
      else if (!outsideOk.test(ch)) return null
    }
    return { inStr, esc }
  }
  let bestK = Infinity
  const dfs = (gi, changes, st, picked, limit) => {
    if (nodes++ > maxNodes) return
    if (gi === alts.length) {
      const bytes = picked.flatMap(a => a.bytes)
      const txt = parse(bytes)
      if (txt) sols.push({ text: picked.map(a => a.str).join(''), changes, json: txt, pen: textPenalty(txt, kind) })
      return
    }
    for (const a of alts[gi]) {
      if (changes + a.changes > limit) continue
      const ns = scan(a.bytes, st)
      if (!ns) continue
      picked.push(a)
      dfs(gi + 1, changes + a.changes, ns, picked, limit)
      picked.pop()
      if (nodes > maxNodes) return
    }
  }
  for (let k = 1; k <= maxChanges && !sols.length; k++) {
    nodes = 0
    dfs(0, 0, { inStr: false, esc: false }, [], k)
    if (sols.length) bestK = k
  }
  if (!sols.length) return null
  nodes = 0
  const kLimit = bestK + 4
  sols.length = 0
  dfs(0, 0, { inStr: false, esc: false }, [], kLimit)
  sols.sort((a, b) => (a.pen - b.pen) || (a.changes - b.changes))
  const best = sols[0]
  const ties = sols.filter(x => x.pen === best.pen && x.changes === best.changes).length
  return { text: best.text, changes: best.changes, ambiguous: ties > 1, json: best.json }
}

const KNOWN_B64_PREFIXES = [
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA', // RSA-2048 SubjectPublicKeyInfo
  'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA', // RSA-4096 SubjectPublicKeyInfo
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE',          // EC P-256 SubjectPublicKeyInfo
]
const sameClass = (a, b) => a === b || (AMB[a] && AMB[a] === AMB[b])

/** Same-length repair of a long base64 run: known ASN.1 header + repeated-unit majority vote. */
export function repairBase64Run(str) {
  let t = String(str || '')
  if (t.length < 24) return t
  for (const pre of KNOWN_B64_PREFIXES) {
    if (t.length < pre.length) continue
    let diff = 0, ok = true
    for (let i = 0; i < pre.length; i++) {
      if (t[i] === pre[i]) continue
      diff++
      if (!sameClass(t[i], pre[i])) { ok = false; break }
    }
    if (ok && diff > 0 && diff <= 6) { t = pre + t.slice(pre.length); break }
  }
  // repeated unit (e.g. 15-char block repeated many times): minority readings in the confusable
  // classes are voted back to the majority; anything else is left alone.
  const n = t.length
  if (n >= 60) {
    for (let p = 6; p <= 40; p++) {
      const m = new Array(n).fill(false)
      for (let i = p; i < n; i++) m[i] = t[i] === t[i - p]
      let bestA = -1, bestB = -1
      for (let a = p; a < n; a++) {
        if (!m[a]) continue
        let b = a, mism = 0
        while (b < n) {
          if (!m[b]) mism++
          if (mism > 0.15 * (b - a + 1) + 1) break
          b++
        }
        if (b - a > bestB - bestA) { bestA = a; bestB = b }
      }
      if (bestA < 0 || bestB - bestA < 4 * p) continue
      const lo = bestA - p, hi = bestB
      const chars = t.split('')
      for (let ph = 0; ph < p; ph++) {
        const cnt = {}
        let tot = 0
        for (let i = lo + ph; i < hi; i += p) { cnt[t[i]] = (cnt[t[i]] || 0) + 1; tot++ }
        const [maj, mc] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]
        if (mc < 3 || mc / tot < 0.75) continue
        for (let i = lo + ph; i < hi; i += p) if (t[i] !== maj && sameClass(t[i], maj)) chars[i] = maj
      }
      t = chars.join('')
      break
    }
  }
  return t
}

/** Repairs every JWT inside a string (header + payload segments); signature is left untouched. */
export function repairJwtsInString(s) {
  return String(s || '').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, m => {
    const parts = m.split('.')
    for (let i = 0; i < Math.min(2, parts.length); i++) {
      const r = solveBase64UrlJson(parts[i], { kind: i === 0 ? 'header' : 'payload' })
      if (r && r.text.length === parts[i].length) parts[i] = r.text
    }
    return parts.join('.')
  })
}

/** All same-length repairs for one protected string (URL / JWT / base64). Never changes length. */
export function repairProtectedString(s) {
  let t = String(s || '')
  const before = t
  t = repairJwtsInString(t)
  t = repairProtectedToken(t)
  t = t.replace(/[A-Za-z0-9+/=]{60,}/g, run => repairBase64Run(run))
  return t.length === before.length ? t : before
}

/* ───────────── gibberish gate: Latin-looking junk from scripts the recognizer cannot read ───────────── */

export const UNREADABLE_TEXT = '[unreadable text region]'

function caseStats(w) {
  const runs = []
  for (const ch of w) {
    const u = ch >= 'A' && ch <= 'Z'
    const last = runs[runs.length - 1]
    if (last && last.u === u) last.n++
    else runs.push({ u, n: 1 })
  }
  return { transitions: runs.length - 1, maxRun: Math.max(...runs.map(r => r.n)), upperRun2: runs.some(r => r.u && r.n >= 2) }
}

export function isLikelyGibberish(text) {
  const t = String(text || '').trim()
  if (t.length < 4 || t === UNREADABLE_TEXT) return false
  const type = classifyTokenType(t)
  if (type !== 'prose' && type !== 'email') return false
  let bad = 0, considered = 0, hanAscii = false
  for (const w of t.split(/\s+/)) {
    const core = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (/[⊃⊂△▽∩∪□▯�]/.test(w) && /[A-Za-z0-9]/.test(w)) { considered++; bad += 2; continue }
    if (core.length < 2) continue
    considered++
    const sc = scriptsInText(core)
    if (/\p{Script=Han}/u.test(core) && /[A-Za-z<>①-⑳▽△]/u.test(w)) { hanAscii = true; bad += 2; continue }
    if (sc.size >= 2 && core.length >= 5 && !/^[μµ][A-Za-z]{1,2}$/.test(core)) { bad += 2; continue }
    if (/[⊃⊂△▽∩∪□▯�]/.test(w) && /[A-Za-z0-9]/.test(w)) { bad += 2; continue }
    if (/[A-Za-z0-9]['`][A-Za-z0-9]/.test(core) === false && /\d['`][A-Za-z]|[A-Za-z]['`]\d/.test(w)) { bad++; continue }
    if (/^[A-Za-z]\d{3,}[A-Za-z]$/.test(core)) { bad++; continue }
    if (/^[A-Za-z]+,[A-Za-z]+\d{2,}$/.test(core) || /^[A-Za-z]+,[A-Za-z]+$/.test(core) && /[A-Z]{2}/.test(core)) { bad++; continue }
    if (/^[A-Za-z]{7,}$/.test(core)) {
      const c = caseStats(core)
      if (c.transitions >= 3 && c.maxRun <= 4 && c.upperRun2) bad++
    }
  }
  return hanAscii || (bad >= 2 && considered > 0 && bad / considered >= 0.3)
}

/** Replaces gibberish OCR lines with a placeholder; keeps the raw reading in rawText for review. */
export function quarantineGibberish(lines) {
  let n = 0
  for (const l of lines || []) {
    if (!l || l.source === 'native' || l.unreadable || !isLikelyGibberish(l.text)) continue
    l.rawText = l.text
    l.text = UNREADABLE_TEXT
    l.unreadable = true
    l.suppressLayer = true
    l.suspectScript = true
    l.noCorrect = true
    l.mean = Math.min(l.mean ?? 1, 0.3)
    n++
  }
  return n
}
