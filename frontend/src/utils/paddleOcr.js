/**
 * paddleOcr.js
 * 100% client-side OCR (PP-OCR via onnxruntime-web + esearch-ocr), searchable-PDF writer,
 * structured Word (.docx) exporter, coverage auditor, and quality gates.
 * Files never leave the browser.
 *
 * Pipeline per page (see OCRToolPage):
 *   native text (pdf.js)  ──┐
 *   OCR lines (+recover)  ──┴─> routeRegions (ONE source per region) -> dedupeLines -> layout -> audit
 * Writer adds invisible text (Tr 3) only for OCR-sourced lines. Native text is already in the PDF.
 */
import { reconstructPageLayout, enrichLineGeometry } from './ocrLayoutAnalysis.js'
import {
  routeRegions, dedupeLines, lineWords, isRtlText, detectScript, overlap,
  isFragmentOverlap, similarity, classifyTokenType, validateJwtToken, decodeWithCtcMultiChar,
  scriptsInText, visualToLogicalRtl,
} from './ocrPostProcess.js'

/* ───────────── ONNX runtime from CDN (keeps Cloudflare asset < 25 MiB) ───────────── */
let ortPromise = null
async function getOrt() {
  if (typeof window !== 'undefined' && window.ort) return window.ort
  if (ortPromise) return ortPromise
  ortPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-ort="cdn"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.ort))
      existing.addEventListener('error', () => reject(new Error('Failed to load onnxruntime-web')))
      return
    }
    const s = document.createElement('script')
    s.setAttribute('data-ort', 'cdn')
    s.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.js'
    s.async = true
    s.onload = () => (window.ort ? resolve(window.ort) : reject(new Error('window.ort not found')))
    s.onerror = () => reject(new Error('Failed to load ONNX Runtime Web from CDN'))
    document.head.appendChild(s)
  }).catch(e => { ortPromise = null; throw e })
  return ortPromise
}

/* ───────────── cached model fetch ───────────── */
async function fetchWithCache(url, onProgress, label) {
  const cacheName = 'pdfforge-ocr-models-v1'
  let cache = null
  try {
    if (typeof caches !== 'undefined') {
      cache = await caches.open(cacheName)
      const hit = await cache.match(url)
      if (hit) {
        onProgress?.({ loaded: 1, total: 1, label: `${label} (cached)` })
        return await hit.arrayBuffer()
      }
    }
  } catch (e) { console.warn('CacheStorage unavailable', e) }

  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`)
  if ((resp.headers.get('content-type') || '').includes('text/html')) throw new Error(`Not found: ${url}`)

  const total = parseInt(resp.headers.get('content-length') || '0', 10)
  let loaded = 0
  const chunks = []
  const reader = resp.body?.getReader()
  if (!reader) {
    const buf = await resp.arrayBuffer()
    if (cache) try { await cache.put(url, new Response(buf.slice(0))) } catch (e) { /* ignore */ }
    return buf
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    if (total > 0) onProgress?.({ loaded, total, label: `${label} (${Math.round((loaded / total) * 100)}%)` })
  }
  const all = new Uint8Array(loaded)
  let pos = 0
  for (const c of chunks) { all.set(c, pos); pos += c.length }
  if (cache) try { await cache.put(url, new Response(all.slice(0))) } catch (e) { /* ignore */ }
  return all.buffer
}

/* ───────────── engine (one per script pack) ───────────── */

const LANG_PACK = {
  rus: 'cyrillic', ukr: 'cyrillic', bul: 'cyrillic', srp: 'cyrillic',
  ara: 'arabic', fas: 'arabic', urd: 'arabic', heb: 'hebrew',
  hin: 'devanagari', mar: 'devanagari', nep: 'devanagari',
  jpn: 'japan', kor: 'korean', ell: 'greek', tha: 'thai',
  tam: 'tamil', tel: 'telugu', kan: 'kannada', mal: 'malayalam',
}

/** Scripts each recognizer pack can actually decode (fine-grained names from scriptsInText). */
export const PACK_SCRIPTS = {
  cyrillic: ['cyrillic'], arabic: ['arabic'], hebrew: ['hebrew'], devanagari: ['devanagari'],
  japan: ['kana', 'han'], korean: ['hangul'], greek: ['greek'], thai: ['thai'],
  tamil: ['tamil'], telugu: ['telugu'], kannada: ['kannada'], malayalam: ['malayalam'],
}
/** Packs whose recognizer prints RTL glyphs left-to-right as drawn (PaddleOCR Arabic/Hebrew heads). */
const VISUAL_RTL_PACKS = new Set(['arabic', 'hebrew'])
const ROUTABLE_PACKS = Object.keys(PACK_SCRIPTS)
export const packForLanguage = code => LANG_PACK[code] || 'default'

const engines = new Map()
let detPromise = null

async function buildEngine(onProgress, pack) {
  onProgress?.({ loaded: 0, total: 100, label: 'Loading ONNX Runtime engine…' })
  const ort = await getOrt()
  if (ort?.env?.wasm) {
    ort.env.wasm.numThreads = Math.min(4, typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2)
  }
  if (!detPromise) detPromise = fetchWithCache('/models/ocr/det.onnx', onProgress, 'Text detector').catch(e => { detPromise = null; throw e })
  const det = await detPromise
  const base = pack === 'default' ? '/models/ocr' : `/models/ocr/${pack}`
  const rec = await fetchWithCache(`${base}/rec.onnx`, onProgress, `Recognizer (${pack})`)
  const dict = new TextDecoder('utf-8').decode(await fetchWithCache(`${base}/dict.txt`, onProgress, 'Dictionary'))
  onProgress?.({ loaded: 100, total: 100, label: 'Initializing neural engine…' })
  const { init } = await import('esearch-ocr')
  return init({
    det: { input: new Uint8Array(det), ratio: 1.0 },
    rec: { input: new Uint8Array(rec), decodeDic: dict, optimize: { space: true } },
    ort,
  })
}

/** Returns { engine, pack, fallback }. Never silently decodes a script with the wrong pack. */
export async function getPaddleOCREngine(onProgress, pack = 'default') {
  const load = async p => {
    if (!engines.has(p)) {
      engines.set(p, buildEngine(onProgress, p).catch(e => { engines.delete(p); throw e }))
    }
    return engines.get(p)
  }
  try {
    return { engine: await load(pack), pack, fallback: false }
  } catch (e) {
    if (pack === 'default') throw e
    console.warn(`OCR pack "${pack}" unavailable, using default`, e)
    return { engine: await load('default'), pack: 'default', fallback: true, requested: pack }
  }
}

/* ───────────── OCR of one page ───────────── */

export async function ocrRawLines(engine, imageData, { pack = 'default' } = {}) {
  const result = await engine.ocr(imageData)
  return (result.src || []).map(it => {
    let text = it.text
    const line = { text, mean: it.mean, box: it.box, source: 'ocr', pack }
    // Recognizer emitted visual order for an RTL pack: store LOGICAL order once, here.
    if (VISUAL_RTL_PACKS.has(pack) && isRtlText(text)) {
      line.text = visualToLogicalRtl(text)
      line.rtlReordered = true
    }
    return line
  })
}

const packProbe = new Map()
/** True only when <pack>/rec.onnx really exists (SPA hosts answer 200 text/html for missing files). */
export function probePack(pack) {
  if (pack === 'default') return Promise.resolve(true)
  if (!packProbe.has(pack)) {
    packProbe.set(pack, (async () => {
      try {
        const r = await fetch(`/models/ocr/${pack}/rec.onnx`, { method: 'HEAD' })
        return r.ok && !(r.headers.get('content-type') || '').includes('text/html')
      } catch { return false }
    })())
  }
  return packProbe.get(pack)
}

/** Share of a line's letters that belong to the given fine-grained scripts (non-letters ignored). */
export function scriptFit(text, scripts) {
  let letters = 0, hit = 0
  for (const ch of text || '') {
    if (!/\p{L}|\p{M}/u.test(ch)) continue
    letters++
    const sc = scriptsInText(ch)
    for (const x of sc) if (scripts.includes(x)) { hit++; break }
  }
  return letters ? hit / letters : 1
}

const cropToImageData = (canvas, box, pad, scale) => {
  const xs = box.map(p => p[0]); const ys = box.map(p => p[1])
  const x = Math.max(0, Math.floor(Math.min(...xs)) - pad)
  const y = Math.max(0, Math.floor(Math.min(...ys)) - pad)
  const w = Math.min(canvas.width - x, Math.ceil(Math.max(...xs)) - x + pad)
  const h = Math.min(canvas.height - y, Math.ceil(Math.max(...ys)) - y + pad)
  if (w < 4 || h < 4) return null
  const c = document.createElement('canvas')
  c.width = w * scale; c.height = h * scale
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height)
  const img = ctx.getImageData(0, 0, c.width, c.height)
  c.width = 0
  return img
}

/**
 * Per-region script routing. det.onnx is script-agnostic, so boxes are shared; only the
 * recognizer differs. Suspect lines (low confidence or mixed-script junk) are re-read with every
 * script pack that is really installed; the winner must beat the base reading AND its output must
 * be in that pack's own script. A line nobody reads confidently is never left as Latin gibberish:
 * it is flagged `suspectScript` and (below hardFloor) kept OUT of the searchable text layer.
 *   getEngine(pack) -> engine | null   (null when the pack is not installed)
 */
export async function routeScriptPacks(canvas, lines, {
  getEngine, basePack = 'default', hintPacks = [], suspectBelow = 0.8, hardFloor = 0.4, max = 80,
} = {}) {
  const report = { rerouted: 0, suspect: 0, suppressed: 0, packsTried: [], packsMissing: [] }
  if (!canvas || !lines?.length || typeof getEngine !== 'function') return report
  const suspects = lines.filter(l => l.source === 'ocr' && l.text && !l.recovered &&
    ((l.mean ?? 1) < suspectBelow || scriptsInText(l.text).size >= 3)).slice(0, max)
  if (!suspects.length) return report

  const cands = []
  for (const pk of [...new Set([...hintPacks, ...ROUTABLE_PACKS])]) {
    if (pk === basePack) continue
    if (await probePack(pk)) cands.push(pk); else report.packsMissing.push(pk)
  }
  for (const l of suspects) {
    const img = cropToImageData(canvas, l.box, 6, 2)
    if (!img) continue
    let best = null
    for (const pk of cands) {
      let eng = null
      try { eng = await getEngine(pk) } catch { eng = null }
      if (!eng) continue
      if (!report.packsTried.includes(pk)) report.packsTried.push(pk)
      try {
        const r = await ocrRawLines(eng, img, { pack: pk })
        if (!r.length) continue
        const text = r.map(t => t.text).join(' ').trim()
        const mean = r.reduce((a, t) => a + (t.mean ?? 0), 0) / r.length
        const fit = scriptFit(text, PACK_SCRIPTS[pk])
        const score = mean * (0.5 + 0.5 * fit)
        if (fit >= 0.6 && (!best || score > best.score)) best = { pk, text, mean, score, rtl: r.some(t => t.rtlReordered) }
      } catch { /* pack failed on this crop */ }
    }
    if (best && best.mean >= (l.mean ?? 0) + 0.08 && best.mean >= 0.6) {
      l.text = best.text; l.mean = best.mean; l.pack = best.pk; l.rerouted = true
      if (best.rtl) l.rtlReordered = true
      report.rerouted++
    } else if ((l.mean ?? 1) < suspectBelow) {
      l.suspectScript = true; l.flagged = true; report.suspect++
      if ((l.mean ?? 1) < hardFloor) { l.suppressLayer = true; report.suppressed++ }
    }
  }
  return report
}

/**
 * TASK #5: Scans canvas grayscale pixels immediately to the left of body lines to recover tiny
 * hanging bullet dots ("•") missed by det.onnx (e.g., Page 16 7-level bullet hierarchy).
 */
export function recoverMissingBullets(canvas, lines) {
  if (!canvas || !lines?.length) return
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  const ys = lines.map(l => (l.box?.[3]?.[1] ?? 0) - (l.box?.[0]?.[1] ?? 0)).filter(h => h > 4)
  const medH = ys.length ? ys.sort((a, b) => a - b)[Math.floor(ys.length / 2)] : 16
  const markerRe = /^(?:[•◦▪▫●○■□·‣⁃*\-–—]|\(?\d{1,3}(?:\.\d+)*[.)]?|\(?[a-z][.)])/i

  // Only probe lines aligned like a list block or indented relative to nearby headings
  for (const l of lines) {
    if (!l.text || markerRe.test(l.text.trim()) || !l.box?.length) continue
    const x0 = Math.floor(Math.min(...l.box.map(p => p[0])))
    const y0 = Math.floor(Math.min(...l.box.map(p => p[1])))
    const y1 = Math.ceil(Math.max(...l.box.map(p => p[1])))
    const h = y1 - y0
    if (h < 6 || h > medH * 1.6 || x0 < medH * 0.8) continue

    const scanW = Math.min(x0, Math.round(h * 1.9))
    const scanX = Math.max(0, x0 - scanW)
    const scanY = Math.max(0, Math.floor(y0 + h * 0.15))
    const scanH = Math.max(4, Math.min(canvas.height - scanY, Math.ceil(h * 0.7)))
    if (scanW < 6 || scanH < 4) continue

    const img = ctx.getImageData(scanX, scanY, scanW, scanH).data
    let minInkX = scanW, maxInkX = -1, minInkY = scanH, maxInkY = -1, darkCount = 0
    for (let py = 0; py < scanH; py++) {
      for (let px = 0; px < scanW - 2; px++) {
        const idx = (py * scanW + px) * 4
        const lum = 0.299 * img[idx] + 0.587 * img[idx + 1] + 0.114 * img[idx + 2]
        if (lum < 150) {
          darkCount++
          if (px < minInkX) minInkX = px
          if (px > maxInkX) maxInkX = px
          if (py < minInkY) minInkY = py
          if (py > maxInkY) maxInkY = py
        }
      }
    }
    const bw = maxInkX - minInkX + 1
    const bh = maxInkY - minInkY + 1
    // Bullet dot signature: compact dark dot (2..12px square-ish) separated from text by whitespace gap
    if (darkCount >= 4 && bw >= 2 && bw <= h * 0.65 && bh >= 2 && bh <= h * 0.65 && (scanW - maxInkX) >= 3) {
      const bulletX = scanX + minInkX
      l.text = '• ' + l.text.trimStart()
      l.box = [[bulletX, y0], [Math.max(...l.box.map(p => p[0])), y0], [Math.max(...l.box.map(p => p[0])), y1], [bulletX, y1]]
      l.bulletRecovered = true
    }
  }
}

/**
 * TASK #1 & #2 & DEFECT 06:
 * Recovers weak lines (< threshold), ALL protected unbroken tokens (jwt/url/base64/hash/uuid),
 * and code lines with unbalanced delimiters using high-res (3x) crop re-OCR + character-level
 * CTC multiChar beam decoding (`engine.recRaw`).
 */
export async function recoverLowConfidence(engine, canvas, lines, { threshold = 0.85, max = 50 } = {}) {
  recoverMissingBullets(canvas, lines)

  const candidates = lines.filter(l => {
    const tType = classifyTokenType(l.text)
    const isProtected = tType === 'jwt' || tType === 'url' || tType === 'base64' || tType === 'hash' || tType === 'uuid' || tType === 'apikey'
    const isCode = tType === 'code' || /[{}()[\];]/.test(l.text || '')
    if (l.rerouted) return false
    if (isProtected) return !validateJwtToken(l.text).valid || (l.mean ?? 1) < 0.99
    if (isCode && (l.mean ?? 1) < 0.96) return true
    return (l.mean ?? 1) < threshold
  }).slice(0, max)

  for (const l of candidates) {
    const tType = classifyTokenType(l.text)
    const isCritical = tType === 'jwt' || tType === 'url' || tType === 'base64' || tType === 'hash' || tType === 'uuid' || tType === 'apikey' || tType === 'code'
    const scale = isCritical ? 3 : 2
    const xs = l.box.map(p => p[0])
    const ys = l.box.map(p => p[1])
    const pad = isCritical ? 8 : 6
    const x = Math.max(0, Math.floor(Math.min(...xs)) - pad)
    const y = Math.max(0, Math.floor(Math.min(...ys)) - pad)
    const w = Math.min(canvas.width - x, Math.ceil(Math.max(...xs)) - x + pad)
    const h = Math.min(canvas.height - y, Math.ceil(Math.max(...ys)) - y + pad)
    if (w < 4 || h < 4) continue
    const c = document.createElement('canvas')
    c.width = w * scale
    c.height = h * scale
    const ctx = c.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height)
    try {
      const cropImg = ctx.getImageData(0, 0, c.width, c.height)
      let text = ''
      let mean = 0
      if (isCritical && typeof engine.det === 'function' && typeof engine.recRaw === 'function') {
        const detBoxes = await engine.det(cropImg)
        if (detBoxes?.length) {
          const rawRes = await engine.recRaw(detBoxes, { topK: 4, threshold: 0.03 })
          const decodedParts = rawRes.map(item => decodeWithCtcMultiChar(item.text, tType)).filter(Boolean)
          text = decodedParts.join(tType === 'code' ? ' ' : '').trim()
          const flatChars = rawRes.flatMap(item => item.text || [])
          mean = flatChars.length ? flatChars.reduce((s, ch) => s + (ch?.[0]?.mean ?? 0), 0) / flatChars.length : 0
        }
      }
      if (!text) {
        const r = await ocrRawLines(engine, cropImg)
        text = r.map(t => t.text).join(isCritical && tType !== 'code' ? '' : ' ').trim()
        mean = r.length ? r.reduce((s, t) => s + (t.mean ?? 0), 0) / r.length : 0
      }
      const newJwtValid = tType === 'jwt' && validateJwtToken(text).valid
      const oldJwtValid = tType === 'jwt' && validateJwtToken(l.text).valid
      if (text && ((newJwtValid && !oldJwtValid) || mean > (l.mean ?? 0) + 0.015)) {
        l.text = text
        l.mean = Math.max(mean, newJwtValid ? 0.98 : mean)
        l.recovered = true
      }
    } catch (e) { /* keep original */ }
    c.width = 0
  }
}

const CLOSER_OF = { '(': ')', '[': ']', '{': '}' }
const CLOSER_RE = /^[)\]}]$/

const codeIssueCount = (lines, w, h) =>
  reconstructPageLayout(lines.map(l => ({ ...l })), w, h).codeBlocks
    .reduce((n, b) => n + (b.issues?.length || 0), 0)

/** Re-read one line at high resolution with character-level CTC (code alphabet = top-1 per slot). */
async function reocrLineRaw(engine, canvas, l, scale, mode) {
  const img = cropToImageData(canvas, l.box, 8, scale)
  if (!img || typeof engine.det !== 'function' || typeof engine.recRaw !== 'function') return null
  const boxes = await engine.det(img)
  if (!boxes?.length) return null
  const raw = await engine.recRaw(boxes, { topK: 4, threshold: 0.03 })
  const text = raw.map(it => decodeWithCtcMultiChar(it.text, mode)).filter(Boolean).join(mode === 'code' ? ' ' : '')
  const flat = raw.flatMap(it => it.text || [])
  const mean = flat.length ? flat.reduce((a, ch) => a + (ch?.[0]?.mean ?? 0), 0) / flat.length : 0
  return text ? { text: text.trim(), mean } : null
}

/**
 * CODE REGIONS (runs after OCR, before any prose normalisation touches the lines):
 *  1. det.onnx drops tiny stand-alone ")" "]" "}" lines. For every code block whose brackets do not
 *     balance, probe the ink-only gaps (below the block and between lines) for a small glyph, read it
 *     at 4x restricted to closers, and insert it as its own line. If the recognizer cannot read the
 *     glyph but exactly one closer kind is missing, insert that closer flagged `inferredCloser`
 *     (reviewQueue) instead of guessing silently.
 *  2. Blocks that are still unbalanced get each bracket/quote-bearing line re-read at 4x; a new
 *     reading is kept only if it lowers the block's issue count.
 */
export async function recoverCodeClosers(engine, canvas, lines, { maxProbe = 12 } = {}) {
  const out = { added: 0, inferred: 0, reevaluated: 0 }
  if (!engine || !canvas || !lines?.length) return out
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return out
  const W = canvas.width, H = canvas.height
  const layoutOf = () => reconstructPageLayout(lines.map(l => ({ ...l })), W, H)

  let probes = 0
  for (const blk of layoutOf().codeBlocks) {
    if (blk.balanced || !blk.unclosed?.length) continue
    const inBlk = lines.filter(l => {
      const xs = l.box.map(p => p[0]), ys = l.box.map(p => p[1])
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
      return cx >= blk.bbox[0] - 2 && cx <= blk.bbox[2] + 2 && cy >= blk.bbox[1] - 2 && cy <= blk.bbox[3] + 2
    }).sort((a, b) => a.box[0][1] - b.box[0][1])
    if (!inBlk.length) continue
    const lh = Math.max(8, inBlk.reduce((a, l) => a + (l.box[3][1] - l.box[0][1]), 0) / inBlk.length)
    const need = [...blk.unclosed].reverse().map(o => CLOSER_OF[o]).filter(Boolean)
    const x0 = Math.max(0, Math.floor(blk.bbox[0] - lh * 0.5))
    const x1 = Math.min(W, Math.ceil(blk.bbox[2] + lh * 6))

    // gap bands: between consecutive lines, then below the block
    const bands = []
    for (let i = 0; i + 1 < inBlk.length; i++) {
      const a = inBlk[i].box[3][1], b = inBlk[i + 1].box[0][1]
      if (b - a > lh * 0.55) bands.push([Math.ceil(a), Math.floor(b)])
    }
    const last = inBlk[inBlk.length - 1].box[3][1]
    bands.push([Math.ceil(last), Math.min(H, Math.ceil(last + lh * 1.6))])

    for (const [ya, yb] of bands) {
      if (!need.length || probes >= maxProbe || yb - ya < 4) continue
      const bw = x1 - x0, bh = yb - ya
      const data = ctx.getImageData(x0, ya, bw, bh).data
      // column clusters of dark pixels
      const cols = new Array(bw).fill(0)
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const i = (y * bw + x) * 4
        if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 150) cols[x]++
      }
      let cx = 0
      while (cx < bw && need.length && probes < maxProbe) {
        if (!cols[cx]) { cx++; continue }
        let ce = cx
        while (ce < bw && (cols[ce] || (ce + 1 < bw && cols[ce + 1]))) ce++
        const gw = ce - cx
        let ink = 0, ymin = bh, ymax = -1
        for (let y = 0; y < bh; y++) for (let x = cx; x < ce; x++) {
          const i = (y * bw + x) * 4
          if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 150) { ink++; if (y < ymin) ymin = y; if (y > ymax) ymax = y }
        }
        const gh = ymax - ymin + 1
        const box = [[x0 + cx, ya + ymin], [x0 + ce, ya + ymin], [x0 + ce, ya + ymax + 1], [x0 + cx, ya + ymax + 1]]
        cx = ce + 1
        // compact glyph only; skip speckle and anything wider than ~2 chars
        if (ink < 6 || gh < lh * 0.45 || gw > lh * 1.6 || gh > lh * 1.7) continue
        // must not sit on an already-detected line
        const hit = lines.some(l => {
          const lx = l.box.map(p => p[0]), ly = l.box.map(p => p[1])
          return Math.min(box[1][0], Math.max(...lx)) - Math.max(box[0][0], Math.min(...lx)) > 0 &&
                 Math.min(box[2][1], Math.max(...ly)) - Math.max(box[0][1], Math.min(...ly)) > 0
        })
        if (hit) continue
        probes++
        let ch = null, mean = 0, inferred = false
        try {
          const img = cropToImageData(canvas, box, 10, 4)
          if (img && typeof engine.det === 'function' && typeof engine.recRaw === 'function') {
            const boxes = await engine.det(img)
            if (boxes?.length) {
              const raw = await engine.recRaw(boxes, { topK: 4, threshold: 0.02 })
              const cands = (raw.flatMap(it => it.text || [])[0]) || []
              const pick = cands.find(c => CLOSER_RE.test(c.t || ''))
              if (pick) { ch = pick.t; mean = pick.mean ?? 0.5 }
            }
          }
        } catch { /* fall through to inference */ }
        if (!ch && new Set(need).size === 1) { ch = need[0]; mean = 0.5; inferred = true }
        if (!ch) continue
        const idx = need.indexOf(ch)
        if (idx >= 0) need.splice(idx, 1)
        lines.push({
          text: ch, mean, box, source: 'ocr', isMono: true, recovered: true, recoveredCloser: true,
          inferredCloser: inferred || undefined, flagged: inferred || undefined,
        })
        out.added++; if (inferred) out.inferred++
      }
    }
  }

  // Step 2: higher-resolution re-evaluation of still-unbalanced regions.
  for (const blk of layoutOf().codeBlocks) {
    if (blk.balanced) continue
    const cand = lines.filter(l => {
      if (l.recoveredCloser || !/[()[\]{}<>"'`]/.test(l.text || '')) return false
      const xs = l.box.map(p => p[0]), ys = l.box.map(p => p[1])
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2, cxm = (Math.min(...xs) + Math.max(...xs)) / 2
      return cy >= blk.bbox[1] - 2 && cy <= blk.bbox[3] + 2 && cxm >= blk.bbox[0] - 2 && cxm <= blk.bbox[2] + 2
    }).slice(0, 40)
    for (const l of cand) {
      let r = null
      try { r = await reocrLineRaw(engine, canvas, l, 4, 'code') } catch { r = null }
      if (!r || r.text === l.text) continue
      const before = codeIssueCount(lines, W, H)
      const old = { text: l.text, mean: l.mean }
      l.text = r.text; l.mean = Math.max(l.mean ?? 0, r.mean)
      if (codeIssueCount(lines, W, H) < before) { l.recovered = true; out.reevaluated++ }
      else { l.text = old.text; l.mean = old.mean }
    }
  }
  return out
}

/**
 * Leading glyph recovery for markers det/rec cannot read (emoji, ✓ ✗ ☑ ☒ ☐ ○ ◉). The dictionary has no
 * pictographs, so a crop of an emoji decodes as junk (√ ? □ a AO XNO). Silhouette-match the blob left
 * of a line against locally rendered candidates; accept only above a high IoU and always flag for review.
 */
export const SYMBOL_CANDIDATES = ['🚀', '📊', '⚡', '🛡', '🔍', '⚙', '💡', '📈', '🏆', '✓', '✔', '✗', '☑', '☒', '☐', '○', '◉']
const GRID = 24
function silhouette(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data
  const bgR = d[0], bgG = d[1], bgB = d[2]
  const s = new Uint8Array(GRID * GRID)
  const tmp = document.createElement('canvas'); tmp.width = GRID; tmp.height = GRID
  const t = tmp.getContext('2d', { willReadFrequently: true })
  const src = document.createElement('canvas'); src.width = w; src.height = h
  src.getContext('2d').putImageData(ctx.getImageData(0, 0, w, h), 0, 0)
  t.fillStyle = `rgb(${bgR},${bgG},${bgB})`; t.fillRect(0, 0, GRID, GRID)
  t.drawImage(src, 0, 0, w, h, 0, 0, GRID, GRID)
  const g = t.getImageData(0, 0, GRID, GRID).data
  for (let i = 0; i < GRID * GRID; i++) {
    s[i] = Math.abs(g[i * 4] - bgR) + Math.abs(g[i * 4 + 1] - bgG) + Math.abs(g[i * 4 + 2] - bgB) > 90 ? 1 : 0
  }
  return s
}
export const silhouetteIoU = (a, b) => {
  let i = 0, u = 0
  for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++ }
  return u ? i / u : 0
}
let templateCache = null
function getTemplates() {
  if (templateCache) return templateCache
  templateCache = SYMBOL_CANDIDATES.map(ch => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64
    const x = c.getContext('2d', { willReadFrequently: true })
    x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64)
    x.fillStyle = '#000'; x.textAlign = 'center'; x.textBaseline = 'middle'
    x.font = '44px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif'
    x.fillText(ch, 32, 34)
    return { ch, sil: silhouette(x, 64, 64) }
  })
  return templateCache
}
export function recoverLeadingSymbols(canvas, lines, { minIoU = 0.72 } = {}) {
  if (!canvas || !lines?.length) return 0
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0
  let n = 0
  const tpls = getTemplates()
  const heights = lines.map(l => l.box[3][1] - l.box[0][1]).filter(h => h > 4).sort((a, b) => a - b)
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 16
  for (const l of lines) {
    if (!l.text || l.source !== 'ocr' || /^[\p{Extended_Pictographic}✓✔✗☑☒☐○◉]/u.test(l.text.trim())) continue
    const x0 = Math.floor(Math.min(...l.box.map(p => p[0])))
    const y0 = Math.floor(Math.min(...l.box.map(p => p[1])))
    const y1 = Math.ceil(Math.max(...l.box.map(p => p[1])))
    const h = y1 - y0
    if (h < 6 || h > medH * 1.8 || x0 < h * 1.2) continue
    const sw = Math.min(x0, Math.round(h * 2.4)), sx = x0 - sw
    const data = ctx.getImageData(sx, y0, sw, h).data
    let minX = sw, maxX = -1, minY = h, maxY = -1
    for (let y = 0; y < h; y++) for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      const sat = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])
      if (lum < 150 || sat > 60) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1
    // glyph-sized (bigger than a bullet dot), clear gap to the text
    if (maxX < 0 || bw < h * 0.55 || bh < h * 0.55 || bw > h * 1.7 || sw - maxX < 3) continue
    const c = document.createElement('canvas'); c.width = bw; c.height = bh
    const cx = c.getContext('2d', { willReadFrequently: true })
    const sub = ctx.getImageData(sx + minX, y0 + minY, bw, bh)
    cx.putImageData(sub, 0, 0)
    const sil = silhouette(cx, bw, bh)
    let best = null
    for (const t of tpls) { const v = silhouetteIoU(sil, t.sil); if (!best || v > best.v) best = { ch: t.ch, v } }
    if (best && best.v >= minIoU) {
      l.text = best.ch + ' ' + l.text.trimStart()
      l.symbolRecovered = best.ch; l.flagged = true
      l.box = [[sx + minX, l.box[0][1]], l.box[1], l.box[2], [sx + minX, l.box[3][1]]]
      n++
    }
  }
  return n
}

/**
 * DEFECT 06 Coverage Audit: ensures every detected raw line is represented in the final page output
 * (or legitimately absorbed by native text / deduplication), returning uncovered boxes if any.
 */
export function auditPageCoverage(rawLines, emittedLines) {
  const uncovered = []
  for (const r of rawLines) {
    if (!r.text || !r.text.trim()) continue
    const covered = emittedLines.some(e => {
      const ov = overlap(r, e)
      return ov.coverA >= 0.4 || ov.iou >= 0.35 || similarity(r.text, e.text) >= 0.8
    })
    if (!covered) uncovered.push(r)
  }
  return { totalDetected: rawLines.length, uncoveredCount: uncovered.length, uncovered }
}

/** Route native + OCR into one set of lines, run layout, enforce coverage, return the page result. */
export function buildPageResult({ nativeLines = [], ocrLines = [], width, height, viewportTransform, ocrSkipped = false, pageNumber = 1, redoneImageBytes = null }) {
  const eNative = enrichLineGeometry(nativeLines, pageNumber)
  const eOcr = enrichLineGeometry(ocrLines, pageNumber)
  const routed = routeRegions(eNative, eOcr)
  const merged = dedupeLines(routed)

  // DEFECT 06: Verify 100% coverage of non-native lines not absorbed by native regions
  const layout = reconstructPageLayout(merged, width, height, pageNumber)
  const coverage = auditPageCoverage(merged, layout.allLines)

  return {
    page: pageNumber,
    text: layout.fullText,
    bodyText: layout.bodyText,
    lines: layout.allLines,
    canvasWidth: width,
    canvasHeight: height,
    viewportTransform,
    ocrSkipped,
    redoneImageBytes,
    headerLines: layout.headerLines,
    footerLines: layout.footerLines,
    bodyLines: layout.bodyLines,
    avgConfidence: layout.avgConfidence,
    lowConfidenceCount: layout.lowConfidenceCount,
    tables: layout.tables,
    codeBlocks: layout.codeBlocks,
    listTree: layout.listTree,
    formFields: layout.formFields,
    coverage,
  }
}

/* ───────────── DEFECT 16 Quality Gates ───────────── */

export function evaluateQualityGates(pages) {
  let fragmentCount = 0
  let duplicateCount = 0
  let uncoveredCount = 0
  let unbalancedCodeCount = 0
  const reviewQueue = []

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const p = pages[pIdx]
    const ls = p.lines || []
    for (let i = 0; i < ls.length; i++) {
      const a = ls[i]
      if (a.flagged) {
        const reason = a.inferredCloser ? 'inferred_code_closer'
          : a.suppressLayer ? 'unreadable_or_unsupported_script_not_in_text_layer'
          : a.suspectScript ? 'possible_unsupported_script'
          : a.symbolRecovered ? 'symbol_template_match' : 'low_confidence'
        reviewQueue.push({ page: pIdx + 1, text: a.text, confidence: a.confidence, bbox: a.bbox, reason })
      }
      for (let j = i + 1; j < ls.length; j++) {
        const b = ls[j]
        const o = overlap(a, b)
        if (o.inter <= 0) continue
        if (isFragmentOverlap(a, b, o) || isFragmentOverlap(b, a, o)) fragmentCount++
        else if ((o.iou >= 0.5 || Math.max(o.coverA, o.coverB) >= 0.7) && similarity(a.text, b.text) >= 0.85) duplicateCount++
      }
    }
    if (p.coverage?.uncoveredCount) uncoveredCount += p.coverage.uncoveredCount
    for (const cb of p.codeBlocks || []) {
      if (!cb.balanced) {
        unbalancedCodeCount++
        reviewQueue.push({ page: pIdx + 1, text: cb.codeText.slice(0, 60), confidence: 0.7, bbox: cb.bbox, reason: 'code_brackets', issues: cb.issues })
      }
    }
  }

  return {
    passed: fragmentCount === 0 && duplicateCount === 0 && uncoveredCount === 0,
    fragmentCount,
    duplicateCount,
    uncoveredCount,
    unbalancedCodeCount,
    reviewQueue,
  }
}

/* ───────────── PDF writer (DEFECT 04 & 15) ───────────── */

/**
 * Remove only invisible-text streams left by earlier OCR runs.
 * Safe rule: never remove a stream that also paints images or shadings.
 */
function stripLegacyOcrStreams(pdfDoc, PDFName, decodePDFRawStream) {
  const isOcrStream = stream => {
    try {
      const dec = stream && decodePDFRawStream(stream)
      if (!dec || typeof dec.getBytes !== 'function') return false
      const s = new TextDecoder('latin1').decode(dec.getBytes())
      const invisible = /\b3\s+Tr\b/.test(s) || s.includes('/ActualText') || (s.includes('BT') && /\/ca\s+0(\.0+)?\s/.test(s))
      const paints = /\bDo\b|\bBI\b|\bsh\b/.test(s)
      return invisible && !paints
    } catch { return false }
  }

  for (let p = 0; p < pdfDoc.getPageCount(); p++) {
    const page = pdfDoc.getPage(p)
    const contents = page.node.Contents()
    if (!contents) continue
    if (typeof contents.size === 'function') {
      for (let i = contents.size() - 1; i >= 0; i--) {
        const stream = pdfDoc.context.lookup(contents.get(i))
        if (isOcrStream(stream)) contents.remove(i)
      }
    } else if (isOcrStream(contents)) {
      page.node.delete(PDFName.of('Contents'))
    }
  }
}

// Wired directly to the bundled Unicode TrueType fonts in frontend/public/wasm/docx2pdf/fonts/
// Bundled files are required; the OPTIONAL ones (Thai, Hangul, wide-coverage fallback) are used when
// present and reported in stats.missingFonts when not. Drop Noto TTFs there to cover those scripts.
const FONT_SOURCES = {
  arial: '/wasm/docx2pdf/fonts/Arial-Regular.ttf',          // Latin, Cyrillic, Greek (+tonos), Hebrew, Arabic
  indic: '/wasm/docx2pdf/fonts/Nirmala-Regular.ttf',        // Devanagari, Bengali, Gujarati, Gurmukhi, Odia, Tamil, Telugu, Kannada, Malayalam, Sinhala
  cjk: '/wasm/docx2pdf/fonts/SimSun-Regular.ttf',           // Han, Kana
  symbol: '/wasm/docx2pdf/fonts/SegoeUISymbol.ttf',         // emoji, dingbats, math, sub/superscripts
  thai: '/wasm/docx2pdf/fonts/NotoSansThai-Regular.ttf',    // optional
  hangul: '/wasm/docx2pdf/fonts/NotoSansKR-Regular.ttf',    // optional (SimSun has no full Hangul)
  other: '/wasm/docx2pdf/fonts/NotoSans-Regular.ttf',       // optional: Georgian, Armenian, Ethiopic, Khmer, Lao, Myanmar, Tibetan
}
const SCRIPT_FONT = {
  devanagari: 'indic', bengali: 'indic', gujarati: 'indic', gurmukhi: 'indic', odia: 'indic', tamil: 'indic',
  telugu: 'indic', kannada: 'indic', malayalam: 'indic', sinhala: 'indic',
  han: 'cjk', kana: 'cjk', hangul: 'hangul', thai: 'thai',
  georgian: 'other', armenian: 'other', ethiopic: 'other', khmer: 'other', lao: 'other', myanmar: 'other', tibetan: 'other',
}
export function neededScripts(pages) {
  const need = new Set()
  for (const p of pages) {
    for (const l of p?.lines || []) {
      if (l.source === 'native' || l.suppressLayer) continue
      const t = l.text || ''
      for (const sc of scriptsInText(t)) if (SCRIPT_FONT[sc]) need.add(SCRIPT_FONT[sc])
      if (/\p{Extended_Pictographic}|[\u00B2\u00B3\u00B9\u2070-\u209F\u2190-\u27BF\u2B00-\u2BFF\u2200-\u22FF\u25A0-\u25FF]/u.test(t)) need.add('symbol')
    }
  }
  // Hangul syllables missing from SimSun: fall back to the optional file; Han stays on cjk.
  return need
}

const safeWidth = (f, text, size) => {
  try { return f.font.widthOfTextAtSize(text, size) } catch (e) { return text.length * size * 0.5 }
}

/**
 * TASK #3: Segments a string into font-capable runs per character codepoint so mixed lines
 * (e.g. Latin + Emoji + Checkmarks + CJK) never drop glyphs in PDF text layer injection.
 */
export function segmentTextByFont(fonts, str) {
  const runs = []
  const unmapped = []
  let skipped = 0
  for (const ch of Array.from(str)) {
    const cp = ch.codePointAt(0)
    // Ignore invisible emoji variation selector-16 (U+FE0F) when base glyph is matched
    if (cp === 0xFE0F || cp === 0xFE0E) continue
    let chosen = null
    if (cp <= 32) {
      chosen = runs.length ? runs[runs.length - 1].f : fonts[0]
    } else {
      for (const f of fonts) {
        if (!f.set || f.set.has(cp)) { chosen = f; break }
      }
    }
    if (!chosen) { skipped++; unmapped.push(ch); continue }
    const last = runs[runs.length - 1]
    if (last && last.f === chosen) last.text += ch
    else runs.push({ f: chosen, text: ch })
  }
  return { runs, skipped, unmapped }
}

function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c
  return (X, Y) => [(d * (X - e) - c * (Y - f)) / det, (-b * (X - e) + a * (Y - f)) / det]
}

/**
 * Build searchable PDF. Per word: positioned on the baseline (rotation aware), horizontally
 * scaled (Tz) to the OCR box width, render mode 3 (invisible). Embedded subset fonts, so
 * ToUnicode is correct. Idempotent: old invisible OCR streams are stripped first.
 */
export async function buildSearchablePdf(originalPdfBytes, pagesResults, onProgress) {
  const lib = await import('@cantoo/pdf-lib')
  const { PDFDocument, PDFOperator, PDFName, PDFNumber, StandardFonts, decodePDFRawStream } = lib
  const fontkit = await import('fontkit')

  const pdfDoc = await PDFDocument.load(originalPdfBytes, { ignoreEncryption: true })
  pdfDoc.registerFontkit(fontkit.default || fontkit)
  try { stripLegacyOcrStreams(pdfDoc, PDFName, decodePDFRawStream) } catch (e) { console.warn('strip failed', e) }

  const stats = { wordsWritten: 0, skippedChars: 0, skippedLines: 0, missingFonts: [], unmappedSamples: [], suppressedLines: 0 }
  const toSet = f => { try { return new Set(f.getCharacterSet()) } catch (e) { return null } }
  const fonts = []
  const embed = async key => {
    if (!FONT_SOURCES[key]) { stats.missingFonts.push(key); return }
    try {
      const bytes = await fetchWithCache(FONT_SOURCES[key], onProgress, `${key} font`)
      const font = await pdfDoc.embedFont(bytes, { subset: true })
      fonts.push({ key, font, set: toSet(font) })
    } catch (e) {
      stats.missingFonts.push(key)
    }
  }
  await embed('arial')
  for (const k of neededScripts(pagesResults)) await embed(k)
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica)
  fonts.push({ key: 'helv', font: helv, set: toSet(helv) })

  const op = (name, ...args) => PDFOperator.of(name, args)
  const num = n => PDFNumber.of(Number.isFinite(n) ? n : 0)

  for (let p = 0; p < pdfDoc.getPageCount(); p++) {
    const res = pagesResults[p]
    const allOcr = (res?.lines || []).filter(l => l.source !== 'native' && l.text && l.text.trim() && l.box?.length >= 4)
    stats.suppressedLines += allOcr.filter(l => l.suppressLayer).length
    const lines = allOcr.filter(l => !l.suppressLayer)
    const written = []
    if (!lines.length || !res.viewportTransform) continue
    const page = pdfDoc.getPage(p)

    // In 'redo' mode, replace original Tr 0 native content streams (whether PDFStream or PDFArray)
    // with crisp full-page raster image so only ONE clean Tr 3 searchable text stream exists.
    if (res.redoneImageBytes) {
      page.node.delete(PDFName.of('Contents'))
      const img = await pdfDoc.embedJpg(res.redoneImageBytes)
      const { width: pw, height: ph } = page.getSize()
      page.drawImage(img, { x: 0, y: 0, width: pw, height: ph })
    }

    const toPdf = invert(res.viewportTransform)
    const used = new Map()
    const keyOf = f => {
      if (!used.has(f)) {
        const k = `OCRF${used.size}`
        page.node.setFontDictionary(PDFName.of(k), f.font.ref)
        used.set(f, k)
      }
      return used.get(f)
    }
    const ops = [op('q'), op('Tr', num(3))]

    for (const line of lines) {
      const text = line.text.replace(/\s+/g, ' ').trim()
      const seg = segmentTextByFont(fonts, text)
      stats.skippedChars += seg.skipped
      for (const u of seg.unmapped || []) {
        const tag = 'U+' + u.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
        if (stats.unmappedSamples.length < 24 && !stats.unmappedSamples.includes(tag)) stats.unmappedSamples.push(tag)
      }
      // 0% duplication: same text over the same box twice never reaches the layer
      if (written.some(w => w.text === text && overlap(w, line).iou > 0.7)) continue
      written.push({ text, xMin: line.xMin, xMax: line.xMax, yMin: line.yMin, yMax: line.yMax })
      if (!seg.runs.length) { stats.skippedLines++; continue }

      const BL = toPdf(...line.box[3])
      const BR = toPdf(...line.box[2])
      const TL = toPdf(...line.box[0])
      const vx = BR[0] - BL[0]
      const vy = BR[1] - BL[1]
      const W = Math.hypot(vx, vy)
      const H = Math.hypot(TL[0] - BL[0], TL[1] - BL[1])
      if (W < 1 || H < 1) continue
      const cos = vx / W
      const sin = vy / W
      const size = Math.max(3, Math.min(H * 0.8, 48))

      // Break segmented runs into word-or-script chunks so horizontal alignment tracks widths cleanly
      const runWidths = seg.runs.map(r => safeWidth(r.f, r.text, 10))
      const total10 = runWidths.reduce((a, b) => a + b, 0)
      if (total10 <= 0) continue

      const rtl = isRtlText(text)
      let cum = 0
      seg.runs.forEach((r, idx) => {
        const w10 = runWidths[idx]
        const start = rtl ? 1 - (cum + w10) / total10 : cum / total10
        cum += w10
        const runW = (w10 / total10) * W
        const natural = safeWidth(r.f, r.text, size)
        if (natural <= 0) return
        const tz = Math.max(40, Math.min(250, (runW / natural) * 100))
        const x = BL[0] + start * vx
        const y = BL[1] + start * vy
        try {
          ops.push(
            op('BT'),
            op('Tf', PDFName.of(keyOf(r.f)), num(size)),
            op('Tz', num(tz)),
            op('Tm', num(cos), num(sin), num(-sin), num(cos), num(x), num(y)),
            op('Tj', r.f.font.encodeText(r.text)),
            op('ET'),
          )
          stats.wordsWritten++
        } catch (e) { stats.skippedChars += r.text.length }
      })
    }
    ops.push(op('Q'))
    page.pushOperators(...ops)
  }

  return { bytes: await pdfDoc.save(), stats }
}

/* ───────────── Structured Word (.docx) Export for OCR (DEFECT 16) ───────────── */

/**
 * Splits page markdown into blocks with a real fence/table state machine.
 * (The old regex split cut at the CLOSING ``` too, so prose after a code block became a code box,
 * and prose after a table was swallowed by the table chunk.)
 */
export function parseBodyBlocks(bodyText) {
  const lines = String(bodyText || '').split('\n')
  const blocks = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      const code = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i++ }
      i++ // closing fence
      blocks.push({ type: 'code', lines: code })
      continue
    }
    if (/^\| /.test(line) && /^\|(?:\s*---\s*\|)+\s*$/.test(lines[i + 1] || '')) {
      const tl = []
      while (i < lines.length && /^\|/.test(lines[i])) { tl.push(lines[i]); i++ }
      blocks.push({ type: 'table', lines: tl })
      continue
    }
    blocks.push({ type: 'para', line })
    i++
  }
  return blocks
}

export async function buildOcrDocxBlob(pages, title = 'OCR Document') {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
    WidthType, BorderStyle, AlignmentType, ShadingType, TableLayoutType, Header, Footer, LevelFormat,
  } = await import('docx')

  const firstHdr = pages.find(p => p.headerLines?.length)?.headerLines.map(l => l.text).join(' ')
  const firstFtr = pages.find(p => p.footerLines?.length)?.footerLines.map(l => l.text).join(' ')
  const thin = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' }
  const allBorders = { top: thin, bottom: thin, left: thin, right: thin }

  // ── per-grapheme font routing: emoji / symbols / each complex script get a face that has the glyphs
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  const graphemes = str => (seg ? Array.from(seg.segment(str), x => x.segment) : Array.from(str))
  const faceOf = g => {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(g)) return 'Segoe UI Emoji'
    if (/[\u00B1\u2070-\u209F\u2190-\u2BFF\u25A0-\u25FF]/.test(g)) return 'Segoe UI Symbol'
    const sc = scriptsInText(g)
    if (sc.has('han') || sc.has('kana')) return 'SimSun'
    if (sc.has('hangul')) return 'Malgun Gothic'
    if (sc.has('thai')) return 'Leelawadee UI'
    if (['devanagari', 'bengali', 'gujarati', 'gurmukhi', 'odia', 'tamil', 'telugu', 'kannada', 'malayalam', 'sinhala'].some(x => sc.has(x))) return 'Nirmala UI'
    if (sc.has('arabic') || sc.has('hebrew')) return 'Arial'
    return null
  }
  const makeRuns = (str, opts = {}) => {
    const segs = []
    for (const g of graphemes(str || '')) {
      const face = faceOf(g)
      const last = segs[segs.length - 1]
      if (last && last.face === face) last.text += g
      else segs.push({ text: g, face })
    }
    return segs.map(s => new TextRun({
      text: s.text,
      font: s.face ? { ascii: s.face, hAnsi: s.face, cs: s.face, eastAsia: s.face } : opts.font,
      bold: opts.bold,
      size: opts.size,
      rightToLeft: opts.rightToLeft,
    }))
  }

  const mkCodeTable = codeLines => new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 9360, type: WidthType.DXA },
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: 9360, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: 'F4F5F7', color: 'auto' },
        borders: allBorders,
        margins: { top: 100, bottom: 100, left: 160, right: 160 },
        // whitespace is preserved verbatim: leading spaces/tabs are kept in the run text
        children: (codeLines.length ? codeLines : ['']).map(cl => new Paragraph({
          spacing: { after: 20, line: 240 },
          children: [new TextRun({ text: cl, font: 'Consolas', size: 18 })],
        })),
      })],
    })],
  })

  const mkTable = t => {
    const nCols = Math.max(1, t.nCols || 1)
    const colW = Math.floor(9360 / nCols)
    let pending = Array(nCols).fill(0) // rows still covered by an earlier rowspan, per column
    const rows = t.rows.map((r, ri) => {
      const active = pending.map(v => v > 0)
      const next = Array(nCols).fill(0)
      const cells = []
      const empty = () => new TableCell({
        width: { size: colW, type: WidthType.DXA }, borders: allBorders,
        children: [new Paragraph({})],
      })
      let col = 0
      const fillTo = upTo => { while (col < upTo && col < nCols) { if (!active[col]) cells.push(empty()); col++ } }
      for (const c of [...r].sort((x, y) => (x.col || 0) - (y.col || 0))) {
        const c0 = c.col || 0
        fillTo(c0)
        const span = c.colspan > 1 ? c.colspan : 1
        cells.push(new TableCell({
          width: { size: colW * span, type: WidthType.DXA },
          columnSpan: span > 1 ? span : undefined,
          rowSpan: c.rowspan > 1 ? c.rowspan : undefined,
          shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'E7E9EE', color: 'auto' } : undefined,
          borders: allBorders,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({
            alignment: c.align === 'right' ? AlignmentType.RIGHT : c.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
            children: makeRuns(c.text || '', { bold: ri === 0, size: 20 }),
          })],
        }))
        if (c.rowspan > 1) for (let k = c0; k < c0 + span && k < nCols; k++) next[k] = c.rowspan - 1
        col = c0 + span
      }
      fillTo(nCols)
      pending = pending.map((v, k) => Math.max(0, v - 1) + (next[k] || 0))
      return new TableRow({ tableHeader: ri === 0, children: cells })
    })
    return new Table({ layout: TableLayoutType.FIXED, width: { size: 9360, type: WidthType.DXA }, rows })
  }

  const children = []
  let numInstance = 0 // new Word list instance per separate numbered list so counting restarts at 1
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const p = pages[pIdx]
    if (pIdx > 0) children.push(new Paragraph({ pageBreakBefore: true }))

    let tblIdx = 0
    let lastKind = null
    for (const blk of parseBodyBlocks(p.bodyText || '')) {
      if (blk.type === 'code') { lastKind = null; children.push(mkCodeTable(blk.lines)); continue }
      if (blk.type === 'table' && p.tables?.[tblIdx]) { lastKind = null; children.push(mkTable(p.tables[tblIdx++])); continue }
      const lns = blk.type === 'table' ? blk.lines : [blk.line]
      for (const rawLine of lns) {
        const l = rawLine.trimEnd()
        if (!l.trim()) { lastKind = null; continue }
        if (l.startsWith('## ')) {
          lastKind = null
          children.push(new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 160, after: 80 },
            children: makeRuns(l.slice(3).trim(), { bold: true }),
          }))
          continue
        }
        const rtl = isRtlText(l)
        const bulletMatch = l.match(/^(\s*)[•\-]\s+(.*)$/)
        const numMatch = !bulletMatch && l.match(/^(\s*)(\d+(?:\.\d+)*)[.)]?\s+(.*)$/)
        const altMatch = !bulletMatch && !numMatch && l.match(/^(\s*)(\(?(?:[a-z]|[ivxlc]+)[.)])\s+(.*)$/i)
        if (bulletMatch) {
          lastKind = 'bullet'
          const level = Math.min(9, Math.floor(bulletMatch[1].length / 2))
          children.push(new Paragraph({
            numbering: level <= 8 ? { reference: 'ocr-nested-bullet', level } : undefined,
            indent: level > 8 ? { left: (level + 1) * 360, hanging: 240 } : undefined,
            bidirectional: rtl || undefined,
            spacing: { after: 50 },
            children: makeRuns(bulletMatch[2], { rightToLeft: rtl || undefined, size: 22 }),
          }))
        } else if (numMatch) {
          if (lastKind !== 'number') numInstance++
          lastKind = 'number'
          const depth = Math.min(8, Math.max(Math.floor(numMatch[1].length / 2), numMatch[2].split('.').length - 1))
          children.push(new Paragraph({
            numbering: { reference: 'ocr-nested-number', level: depth, instance: numInstance },
            bidirectional: rtl || undefined,
            spacing: { after: 60 },
            children: makeRuns(numMatch[3], { rightToLeft: rtl || undefined, size: 22 }),
          }))
        } else if (altMatch) {
          // a) / (i) markers: keep the marker text verbatim, keep the nesting as indentation
          lastKind = 'alt'
          const level = Math.min(9, Math.floor(altMatch[1].length / 2))
          children.push(new Paragraph({
            indent: { left: (level + 1) * 360, hanging: 360 },
            bidirectional: rtl || undefined,
            spacing: { after: 50 },
            children: makeRuns(`${altMatch[2]} ${altMatch[3]}`, { rightToLeft: rtl || undefined, size: 22 }),
          }))
        } else {
          lastKind = null
          children.push(new Paragraph({
            bidirectional: rtl || undefined,
            alignment: rtl ? AlignmentType.START : AlignmentType.LEFT,
            spacing: { after: 70 },
            children: makeRuns(l.trim(), { rightToLeft: rtl || undefined, size: 22 }),
          }))
        }
      }
    }
  }

  const doc = new Document({
    creator: 'PDFFORGE OCR',
    title,
    numbering: {
      config: [
        {
          reference: 'ocr-nested-bullet',
          levels: Array.from({ length: 9 }, (_, i) => ({
            level: i,
            format: LevelFormat.BULLET,
            text: ['•', '◦', '▪'][i % 3],
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: (i + 1) * 360, hanging: 260 } } },
          })),
        },
        {
          reference: 'ocr-nested-number',
          levels: Array.from({ length: 9 }, (_, i) => ({
            level: i,
            format: LevelFormat.DECIMAL,
            text: Array.from({ length: i + 1 }, (_, k) => `%${k + 1}`).join('.') + '.',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: (i + 1) * 360, hanging: 320 } } },
          })),
        },
      ],
    },
    sections: [{
      headers: firstHdr ? { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: firstHdr, size: 18, color: '666666' })] })] }) } : undefined,
      footers: firstFtr ? { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: firstFtr, size: 18, color: '666666' })] })] }) } : undefined,
      children: children.length ? children : [new Paragraph({})],
    }],
  })
  return Packer.toBlob(doc)
}

/* ───────────── sidecar JSON ───────────── */

export function buildSidecar(pages, meta = {}) {
  const gates = evaluateQualityGates(pages)
  return {
    generator: 'PDFFORGE',
    version: 2,
    ...meta,
    qualityGates: gates,
    pages: pages.map((p, i) => ({
      page: i + 1,
      width: p.canvasWidth,
      height: p.canvasHeight,
      ocrSkipped: !!p.ocrSkipped,
      avgConfidence: p.avgConfidence,
      coverage: p.coverage,
      lines: p.lines.map(l => ({
        page: l.page || i + 1,
        text: l.text,
        origin: l.origin || (l.source === 'native' ? 'source-text' : 'recognized'),
        source: l.source || 'ocr',
        script: detectScript(l.text),
        regionType: l.regionType || 'PARAGRAPH',
        confidence: l.mean ?? 1,
        flagged: (l.mean ?? 1) < 0.85,
        zone: l.zone,
        latex: l.latex,
        bbox: [l.xMin, l.yMin, l.xMax, l.yMax],
        words: lineWords(l),
      })),
      tables: p.tables,
      codeBlocks: p.codeBlocks,
      listTree: p.listTree,
      formFields: p.formFields,
    })),
  }
}
