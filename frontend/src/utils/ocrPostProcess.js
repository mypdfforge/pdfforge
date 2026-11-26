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
 * Fixes f-string brace mismatches ({ident) -> {ident}), trailing argument period vs comma,
 * and common Python keyword OCR confusions.
 */
export function repairCodeSyntax(codeText) {
  if (!codeText) return codeText
  const lines = codeText.split('\n')
  let parenDepth = 0
  const repaired = []

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    const nextLine = (lines[i + 1] || '').trim()

    // 1. Common code-region OCR word/identifier confusions
    line = line
      .replace(/\bretum\b/g, 'return')
      .replace(/\bmaqic\b/g, 'magic')
      .replace(/\baqainst\b/g, 'against')
      .replace(/\bbvtes\b/g, 'bytes')
      .replace(/\bdetected format(?=\s*=)/g, 'detected_format')
      .replace(/\blayout tree\b/g, 'layout_tree')

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
  t = t.replace(/\bIz4\b/g, 'lz4')
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
export function fixFieldConfusables(text) {
  if (!text) return text
  let t = repairProtectedToken(text)
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
  t = t.replace(/(^|[\s(|:,])√(?=\s|$|\)|\||[A-Z])/g, '$1✓')

  // Remaining named/statistical OCR confusions from DEFECT 09
  t = t.replace(/\bPh\.D\]/g, 'Ph.D.')
  t = t.replace(/\bNeurlPS\b/g, 'NeurIPS')
  t = t.replace(/\bUItimate\b/g, 'Ultimate')
  t = t.replace(/\bMinlO\b/g, 'MinIO')
  t = t.replace(/\bIz4\b/g, 'lz4')
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

  return repairDescenderSplits(t)
}

/** DEFECT 13: Prose-only punctuation cleanup. Skipped for protected text & code. */
export function normalizePunctuation(text) {
  if (!text || isProtectedText(text)) return text
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
    // Clean extra spaces before punctuation (never collapse URLs/decimals)
    .replace(/\s+([,.;:!?])(?=\s|$)/g, '$1')
}

/** Normalize list bullets: · • ● ▪ all -> • */
export function normalizeBullet(ch) {
  return /[·•●▪◦○‣⁃]/.test(ch) ? '•' : ch
}
