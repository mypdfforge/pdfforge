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
    const isProtected = tType === 'jwt' || tType === 'url' || tType === 'base64' || tType === 'hash' || tType === 'uuid'
    const isCode = tType === 'code' || /[{}()[\];]/.test(l.text || '')
    if (isProtected) return !validateJwtToken(l.text).valid || (l.mean ?? 1) < 0.99
    if (isCode && (l.mean ?? 1) < 0.96) return true
    return (l.mean ?? 1) < threshold
  }).slice(0, max)

  for (const l of candidates) {
    const tType = classifyTokenType(l.text)
    const isCritical = tType === 'jwt' || tType === 'url' || tType === 'base64' || tType === 'hash' || tType === 'uuid' || tType === 'code'
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
        reviewQueue.push({ page: pIdx + 1, text: a.text, confidence: a.confidence, bbox: a.bbox, reason: 'low_confidence' })
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
const FONT_SOURCES = {
  arial: '/wasm/docx2pdf/fonts/Arial-Regular.ttf',
  devanagari: '/wasm/docx2pdf/fonts/Nirmala-Regular.ttf',
  cjk: '/wasm/docx2pdf/fonts/SimSun-Regular.ttf',
  symbol: '/wasm/docx2pdf/fonts/SegoeUISymbol.ttf',
}

function neededScripts(pages) {
  const need = new Set()
  for (const p of pages) {
    for (const l of p?.lines || []) {
      if (l.source === 'native') continue
      const t = l.text || ''
      if (/\p{Script=Devanagari}/u.test(t)) need.add('devanagari')
      if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(t)) need.add('cjk')
      if (/\p{Extended_Pictographic}|[\u00B2\u00B3\u00B9\u2070-\u209F\u2190-\u27BF\u2B00-\u2BFF]/u.test(t)) need.add('symbol')
    }
  }
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
    if (!chosen) { skipped++; continue }
    const last = runs[runs.length - 1]
    if (last && last.f === chosen) last.text += ch
    else runs.push({ f: chosen, text: ch })
  }
  return { runs, skipped }
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

  const stats = { wordsWritten: 0, skippedChars: 0, skippedLines: 0, missingFonts: [] }
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
    const lines = (res?.lines || []).filter(l => l.source !== 'native' && l.text && l.text.trim() && l.box?.length >= 4)
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

export async function buildOcrDocxBlob(pages, title = 'OCR Document') {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
    WidthType, BorderStyle, AlignmentType, ShadingType, TableLayoutType, Header, Footer, LevelFormat,
  } = await import('docx')

  const firstHdr = pages.find(p => p.headerLines?.length)?.headerLines.map(l => l.text).join(' ')
  const firstFtr = pages.find(p => p.footerLines?.length)?.footerLines.map(l => l.text).join(' ')
  const thin = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' }
  const allBorders = { top: thin, bottom: thin, left: thin, right: thin }

  const makeRuns = (str, opts = {}) => {
    const segs = []
    for (const ch of Array.from(str || '')) {
      const isEmoji = /\p{Extended_Pictographic}/u.test(ch)
      const isSymbol = !isEmoji && /[\u2190-\u27BF\u2B00-\u2BFF\u2070-\u209F\u0370-\u03FF±]/.test(ch)
      const kind = isEmoji ? 'emoji' : isSymbol ? 'symbol' : 'text'
      const last = segs[segs.length - 1]
      if (last && last.kind === kind) last.text += ch
      else segs.push({ text: ch, kind })
    }
    return segs.map(s => new TextRun({
      text: s.text,
      font: s.kind === 'emoji' ? 'Segoe UI Emoji' : s.kind === 'symbol' ? 'Segoe UI Symbol' : opts.font,
      bold: opts.bold,
      size: opts.size,
      rightToLeft: opts.rightToLeft,
    }))
  }

  const children = []
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const p = pages[pIdx]
    if (pIdx > 0) children.push(new Paragraph({ pageBreakBefore: true }))

    const chunks = (p.bodyText || '').split(/\n(?=(?:```|(?:\| .+ \|\n\| ---)))/)
    let tblIdx = 0
    for (const chunk of chunks) {
      const trimmed = chunk.trim()
      if (!trimmed) continue
      if (trimmed.startsWith('```')) {
        const codeLines = trimmed.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').split('\n')
        const paras = codeLines.map(cl => new Paragraph({
          spacing: { after: 20, line: 240 },
          children: [new TextRun({ text: cl, font: 'Consolas', size: 18 })],
        }))
        children.push(new Table({
          layout: TableLayoutType.FIXED,
          width: { size: 9360, type: WidthType.DXA },
          rows: [new TableRow({
            children: [new TableCell({
              width: { size: 9360, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: 'F4F5F7', color: 'auto' },
              borders: allBorders,
              margins: { top: 100, bottom: 100, left: 160, right: 160 },
              children: paras,
            })],
          })],
        }))
        continue
      }
      if (trimmed.startsWith('| ') && p.tables?.[tblIdx]) {
        const t = p.tables[tblIdx++]
        const nCols = Math.max(1, t.nCols || 1)
        const colW = Math.floor(9360 / nCols)
        const rows = t.rows.map((r, ri) => new TableRow({
          tableHeader: ri === 0,
          children: r.map(c => new TableCell({
            width: { size: colW * (c.colspan || 1), type: WidthType.DXA },
            columnSpan: c.colspan > 1 ? c.colspan : undefined,
            shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'E7E9EE', color: 'auto' } : undefined,
            borders: allBorders,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph({
              alignment: c.align === 'right' ? AlignmentType.RIGHT : c.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
              children: makeRuns(c.text || '', { bold: ri === 0, size: 20 }),
            })],
          })),
        }))
        children.push(new Table({
          layout: TableLayoutType.FIXED,
          width: { size: 9360, type: WidthType.DXA },
          rows,
        }))
        continue
      }

      for (const rawLine of chunk.split('\n')) {
        const l = rawLine.trimEnd()
        if (!l.trim()) continue
        if (l.startsWith('## ')) {
          children.push(new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 160, after: 80 },
            children: makeRuns(l.slice(3).trim(), { bold: true }),
          }))
        } else {
          const rtl = isRtlText(l)
          const bulletMatch = l.match(/^(\s*)[•\-]\s+(.*)$/)
          const numMatch = !bulletMatch && l.match(/^(\s*)(\d+(?:\.\d+)*)[.)]?\s+(.*)$/)
          if (bulletMatch) {
            const level = Math.min(9, Math.floor(bulletMatch[1].length / 2))
            children.push(new Paragraph({
              numbering: level <= 8 ? { reference: 'ocr-nested-bullet', level } : undefined,
              indent: level > 8 ? { left: (level + 1) * 360, hanging: 240 } : undefined,
              bidirectional: rtl || undefined,
              spacing: { after: 50 },
              children: makeRuns(bulletMatch[2], { rightToLeft: rtl || undefined, size: 22 }),
            }))
          } else if (numMatch) {
            const depth = Math.min(8, numMatch[2].split('.').length - 1)
            children.push(new Paragraph({
              numbering: { reference: 'ocr-nested-number', level: depth },
              bidirectional: rtl || undefined,
              spacing: { after: 60 },
              children: makeRuns(numMatch[3], { rightToLeft: rtl || undefined, size: 22 }),
            }))
          } else {
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
