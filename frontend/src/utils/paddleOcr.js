/**
 * paddleOcr.js
 * 100% client-side OCR (PP-OCR via onnxruntime-web + esearch-ocr) and searchable-PDF writer.
 * Files never leave the browser.
 *
 * Pipeline per page (see OCRToolPage):
 *   native text (pdf.js)  ──┐
 *   OCR lines (+recover)  ──┴─> routeRegions (ONE source per region) -> layout -> page result
 * Writer adds invisible text (Tr 3) only for OCR-sourced lines. Native text is already in the PDF.
 */
import { reconstructPageLayout, enrichLineGeometry } from './ocrLayoutAnalysis.js'
import { routeRegions, dedupeLines, lineWords, isRtlText, detectScript } from './ocrPostProcess.js'

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
  // SPA hosts answer missing files with index.html (200). Treat as missing.
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

// Language -> recognizer pack. Packs live in /models/ocr/<pack>/{rec.onnx,dict.txt}.
// 'default' = /models/ocr/{rec.onnx,dict.txt}. Missing pack -> fall back to default with a warning.
const LANG_PACK = {
  rus: 'cyrillic', ara: 'arabic', heb: 'hebrew', hin: 'devanagari',
  jpn: 'japan', kor: 'korean', ell: 'greek', tha: 'thai',
}
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

export async function ocrRawLines(engine, imageData) {
  const result = await engine.ocr(imageData)
  return (result.src || []).map(it => ({ text: it.text, mean: it.mean, box: it.box, source: 'ocr' }))
}

/**
 * Low confidence is flagged, never deleted. First try a 2x upscaled crop of the line.
 * Keeps the better reading. (Small fonts are the usual cause of 3.2ms -> 3.2s type errors.)
 */
export async function recoverLowConfidence(engine, canvas, lines, { threshold = 0.85, max = 40 } = {}) {
  const weak = lines.filter(l => (l.mean ?? 1) < threshold).slice(0, max)
  for (const l of weak) {
    const xs = l.box.map(p => p[0])
    const ys = l.box.map(p => p[1])
    const pad = 6
    const x = Math.max(0, Math.floor(Math.min(...xs)) - pad)
    const y = Math.max(0, Math.floor(Math.min(...ys)) - pad)
    const w = Math.min(canvas.width - x, Math.ceil(Math.max(...xs)) - x + pad)
    const h = Math.min(canvas.height - y, Math.ceil(Math.max(...ys)) - y + pad)
    if (w < 4 || h < 4) continue
    const c = document.createElement('canvas')
    c.width = w * 2
    c.height = h * 2
    const ctx = c.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height)
    try {
      const r = await ocrRawLines(engine, ctx.getImageData(0, 0, c.width, c.height))
      const text = r.map(t => t.text).join(' ').trim()
      const mean = r.length ? r.reduce((s, t) => s + (t.mean ?? 0), 0) / r.length : 0
      if (text && mean > (l.mean ?? 0) + 0.02) { l.text = text; l.mean = mean; l.recovered = true }
    } catch (e) { /* keep original */ }
    c.width = 0
  }
}

/** Route native + OCR into one set of lines, run layout, return the page result. */
export function buildPageResult({ nativeLines = [], ocrLines = [], width, height, viewportTransform, ocrSkipped = false }) {
  const routed = routeRegions(enrichLineGeometry(nativeLines), enrichLineGeometry(ocrLines))
  const merged = dedupeLines(routed)
  const layout = reconstructPageLayout(merged, width, height)
  return {
    text: layout.fullText,
    lines: layout.allLines,
    canvasWidth: width,
    canvasHeight: height,
    viewportTransform,
    ocrSkipped,
    headerLines: layout.headerLines,
    footerLines: layout.footerLines,
    bodyLines: layout.bodyLines,
    avgConfidence: layout.avgConfidence,
    lowConfidenceCount: layout.lowConfidenceCount,
    tables: layout.tables,
    formFields: layout.formFields,
  }
}

/* ───────────── PDF writer ───────────── */

/**
 * Remove only invisible-text streams left by earlier OCR runs.
 * Safe rule: never remove a stream that also paints images or shadings.
 */
function stripLegacyOcrStreams(pdfDoc, decodePDFRawStream) {
  for (let p = 0; p < pdfDoc.getPageCount(); p++) {
    const contents = pdfDoc.getPage(p).node.Contents()
    if (!contents || typeof contents.size !== 'function') continue
    for (let i = contents.size() - 1; i >= 0; i--) {
      try {
        const stream = pdfDoc.context.lookup(contents.get(i))
        const dec = stream && decodePDFRawStream(stream)
        if (!dec || typeof dec.getBytes !== 'function') continue
        const s = new TextDecoder('latin1').decode(dec.getBytes())
        const invisible = /\b3\s+Tr\b/.test(s) || s.includes('/ActualText') || (s.includes('BT') && /\/ca\s+0(\.0+)?\s/.test(s))
        const paints = /\bDo\b|\bBI\b|\bsh\b/.test(s)
        if (invisible && !paints) contents.remove(i)
      } catch (e) { /* undecodable stream: leave it */ }
    }
  }
}

// Optional fonts are fetched only when the text needs them. Missing file = reported, not fatal.
const FONT_SOURCES = {
  arial: '/wasm/docx2pdf/fonts/Arial-Regular.ttf',
  devanagari: '/wasm/docx2pdf/fonts/Nirmala-Regular.ttf',
  cjk: '/fonts/NotoSansCJK-Regular.ttf',
  thai: '/fonts/NotoSansThai-Regular.ttf',
  emoji: '/fonts/NotoEmoji-Regular.ttf',
}

function neededScripts(pages) {
  const need = new Set()
  for (const p of pages) {
    for (const l of p?.lines || []) {
      if (l.source === 'native') continue
      const t = l.text || ''
      if (/\p{Script=Devanagari}/u.test(t)) need.add('devanagari')
      if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(t)) need.add('cjk')
      if (/\p{Script=Thai}/u.test(t)) need.add('thai')
      if (/\p{Extended_Pictographic}/u.test(t)) need.add('emoji')
    }
  }
  return need
}

const safeWidth = (f, text, size) => {
  try { return f.font.widthOfTextAtSize(text, size) } catch (e) { return text.length * size * 0.5 }
}

function pickFont(fonts, str) {
  const cps = Array.from(str).map(c => c.codePointAt(0)).filter(cp => cp > 32)
  let best = null
  let bestN = -1
  for (const f of fonts) {
    const n = f.set ? cps.filter(cp => f.set.has(cp)).length : cps.length
    if (n === cps.length) return { f, text: str, dropped: 0 }
    if (n > bestN) { best = f; bestN = n }
  }
  if (bestN <= 0) return null
  const text = Array.from(str).filter(c => c.codePointAt(0) <= 32 || best.set.has(c.codePointAt(0))).join('')
  return { f: best, text, dropped: cps.length - bestN }
}

function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c
  return (X, Y) => [(d * (X - e) - c * (Y - f)) / det, (-b * (X - e) + a * (Y - f)) / det]
}

/**
 * Build searchable PDF. Per word: positioned on the baseline (rotation aware), horizontally
 * scaled (Tz) to the OCR box width, render mode 3 (invisible). Embedded subset fonts, so
 * ToUnicode is correct. Idempotent: old invisible OCR streams are stripped first.
 * Returns { bytes, stats }.
 */
export async function buildSearchablePdf(originalPdfBytes, pagesResults, onProgress) {
  const lib = await import('@cantoo/pdf-lib')
  const { PDFDocument, PDFOperator, PDFName, PDFNumber, StandardFonts, decodePDFRawStream } = lib
  const fontkit = await import('fontkit')

  const pdfDoc = await PDFDocument.load(originalPdfBytes, { ignoreEncryption: true })
  pdfDoc.registerFontkit(fontkit.default || fontkit)
  try { stripLegacyOcrStreams(pdfDoc, decodePDFRawStream) } catch (e) { console.warn('strip failed', e) }

  const stats = { wordsWritten: 0, skippedChars: 0, skippedLines: 0, missingFonts: [] }
  const toSet = f => { try { return new Set(f.getCharacterSet()) } catch (e) { return null } }
  const fonts = []
  const embed = async key => {
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
    const lines = (res?.lines || []).filter(l => l.source !== 'native' && l.text && l.text.trim() && l.box?.length >= 4)
    if (!lines.length || !res.viewportTransform) continue
    const page = pdfDoc.getPage(p)
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
      const pick = pickFont(fonts, text)
      if (!pick) { stats.skippedLines++; continue }
      stats.skippedChars += pick.dropped
      const { f } = pick
      const words = pick.text.split(' ').filter(Boolean)
      if (!words.length) continue

      // box = [TL, TR, BR, BL] in canvas px -> PDF user space (handles /Rotate and skew)
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

      const wi = words.map(w => safeWidth(f, w, 10))
      const sp = safeWidth(f, ' ', 10)
      const total = wi.reduce((a, b) => a + b, 0) + sp * (words.length - 1)
      if (total <= 0) continue
      const rtl = isRtlText(pick.text)
      let cum = 0
      words.forEach((w, i) => {
        // RTL: logical first word sits at the right end. Text stays in logical order for search/copy.
        const start = rtl ? 1 - (cum + wi[i]) / total : cum / total
        cum += wi[i] + sp
        const wordW = (wi[i] / total) * W
        const natural = safeWidth(f, w, size)
        if (natural <= 0) return
        const tz = Math.max(40, Math.min(250, (wordW / natural) * 100))
        const x = BL[0] + start * vx
        const y = BL[1] + start * vy
        try {
          ops.push(
            op('BT'),
            op('Tf', PDFName.of(keyOf(f)), num(size)),
            op('Tz', num(tz)),
            op('Tm', num(cos), num(sin), num(-sin), num(cos), num(x), num(y)),
            op('Tj', f.font.encodeText(w)),
            op('ET'),
          )
          stats.wordsWritten++
        } catch (e) { stats.skippedChars += w.length }
      })
    }
    ops.push(op('Q'))
    page.pushOperators(...ops)
  }

  return { bytes: await pdfDoc.save(), stats }
}

/* ───────────── sidecar JSON ───────────── */

export function buildSidecar(pages, meta = {}) {
  return {
    generator: 'PDFFORGE',
    version: 1,
    ...meta,
    pages: pages.map((p, i) => ({
      page: i + 1,
      width: p.canvasWidth,
      height: p.canvasHeight,
      ocrSkipped: !!p.ocrSkipped,
      avgConfidence: p.avgConfidence,
      lines: p.lines.map(l => ({
        text: l.text,
        source: l.source || 'ocr',
        script: detectScript(l.text),
        confidence: l.mean ?? 1,
        flagged: (l.mean ?? 1) < 0.85,
        zone: l.zone,
        latex: l.latex,
        bbox: [l.xMin, l.yMin, l.xMax, l.yMax],
        words: lineWords(l),
      })),
      tables: p.tables,
      formFields: p.formFields,
    })),
  }
}
