/**
 * pdfToWordPipeline.js — hardened, per-page-isolated PDF → .docx converter.
 * 100% client-side. No fetch/XHR/beacon calls anywhere in this module.
 *
 * Page lifecycle:   pdf.js page → layout/tables/images → compact "page model"
 *                   (page object, canvas and items released immediately)
 *                → after all pages: docx objects built page-by-page → packed.
 *
 * Failure ladder per page (a page NEVER kills the document):
 *   rich → plain text (own line grouping) → raw pdf.js text → page image → placeholder
 * Failure ladder for packaging: rich docx → plain-text docx → minimal docx.
 *
 * Requires: window.pdfjsLib (already loaded by the app), docx, and the existing
 * pdfLayoutSegmenter / pdfTableDetector / pdfVectorExtractor modules.
 */
import { extractPageLayout, segmentIntoColumns, mergeParagraphBlocks } from './pdfLayoutSegmenter.js'
import { detectTableRegions } from './pdfTableDetector.js'
import { extractVectorGeometry } from './pdfVectorExtractor.js'
import * as U from './pdfToWordUtils.js'
import { buildDocxBlob } from './docxBuild.js'

export { ConversionError } from './pdfToWordUtils.js'

const DEFAULTS = {
  pageTimeoutMs: 30_000,       // one page may not take longer than this (analysis stage)
  maxImagesPerPage: 12,
  imageBudgetSoft: 150 * 1024 * 1024, // after this, images are downscaled
  imageBudgetHard: 260 * 1024 * 1024, // after this, images are skipped (text still converted)
  minImagePt: 18,              // ignore images smaller than this (rules, bullets, icons)
}

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═════════════════════════════════════════════════════════════════════════════
/**
 * @param {File|Blob} file
 * @param {object} [opts]
 * @param {(p:{percent:number,stage:string,message:string,page?:number,totalPages?:number,
 *           pagesPerSec?:number,etaSec?:number|null,warnings?:number})=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.pageTimeoutMs]
 * @returns {Promise<{blob:Blob, warnings:object[], stats:object}>}
 */
export async function convertPdfToDocx(file, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts }
  const { signal, onProgress } = cfg
  const warnings = []
  const warn = (page, code, message, level = 'warn') => warnings.push({ page, code, message, level })
  const vel = U.makeVelocityTracker()
  const slice = U.createSlicer(8)
  const stats = { pages: 0, rich: 0, plain: 0, image: 0, failed: 0, images: 0, packMode: 'rich', elapsedMs: 0 }
  const t0 = U.now()

  const emit = (stage, message, percent, page, total) => {
    const v = total ? vel.snapshot(page ?? 0, total) : {}
    onProgress?.({ percent: Math.round(percent), stage, message, page, totalPages: total,
      pagesPerSec: v.pagesPerSec, etaSec: v.etaSec ?? null, warnings: warnings.length })
  }

  U.throwIfAborted(signal)
  const pdfjs = globalThis.pdfjsLib
  if (!pdfjs?.getDocument) throw new U.ConversionError('NO_PDFJS', 'PDF engine (pdf.js) is not loaded.')

  emit('loading', 'Reading PDF…', 1)
  let buf = await U.abortable(file.arrayBuffer(), signal)
  let task = null, pdf = null
  try {
    task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false })
    pdf = await U.abortable(task.promise, signal)
  } catch (e) {
    try { task?.destroy?.() } catch { /* ignore */ }
    throw U.classifyPdfError(e)
  } finally {
    buf = null // let the GC reclaim our copy
  }

  try {
    const n = pdf.numPages
    stats.pages = n
    if (!n) throw new U.ConversionError('EMPTY', 'This PDF has no pages.')

    // ── Pass 1: analyse every page in isolation ───────────────────────────
    const hist = new Map()
    const mem = { imageBytes: 0, lowMem: false, skipImages: false }
    const models = new Array(n)
    for (let p = 1; p <= n; p++) {
      U.throwIfAborted(signal)
      emit('analyze', `Analyzing page ${p} of ${n}…`, 2 + 68 * ((p - 1) / n), p - 1, n)
      try {
        models[p - 1] = await U.abortable(
          U.withTimeout(analyzePage(pdf, p, { pdfjs, hist, mem, warn, cfg }), cfg.pageTimeoutMs, `Page ${p}`),
          signal
        )
      } catch (e) {
        if (e?.code === 'ABORTED') throw e
        warn(p, 'PAGE_FAILED', `Page ${p} could not be analysed (${e?.message || e}).`)
        models[p - 1] = { pageNum: p, mode: 'failed', w: 595.28, h: 841.89, lines: [], blocks: [], images: [], vector: null }
      }
      if (mem.imageBytes > cfg.imageBudgetSoft && !mem.lowMem) {
        mem.lowMem = true
        warn(null, 'LOW_MEMORY', 'Large images detected — remaining images are downscaled to keep the browser stable.', 'info')
      }
      if (mem.imageBytes > cfg.imageBudgetHard) mem.skipImages = true
      if (p % 10 === 0) { try { pdf.cleanup() } catch { /* ignore */ } }
      await slice(true)
    }

    // ── Pass 2 + pack: build docx structures and zip them (in a Worker when possible) ──
    const bodySize = U.dominantSize(hist, 11)
    const title = (cfg.title || file.name || 'Converted PDF').replace(/\.pdf$/i, '')
    emit('build', 'Detecting tables & columns…', 70, 0, n)
    stats.images = models.reduce((s, m) => s + (m.images?.length || 0) + (m.pageImage ? 1 : 0), 0)
    const built = await buildAndPack(models, { bodySize, title, warn, signal, cfg,
      onProgress: (i, total) => emit(i >= total ? 'pack' : 'build',
        i >= total ? 'Packaging Word document…' : `Detecting tables & columns — page ${i + 1} of ${total}…`,
        i >= total ? 93 : 70 + 22 * (i / total), i, total) })
    const blob = built.blob
    stats.packMode = built.packMode
    for (const mode of built.modes) {
      if (mode === 'image') stats.image++
      else if (mode === 'failed') stats.failed++
      else if (mode === 'rich') stats.rich++
      else stats.plain++
    }

    // release everything heavy before returning
    for (const m of models) { m.images = null; m.pageImage = null; m.blocks = null; m.lines = null; m.vector = null }

    stats.elapsedMs = Math.round(U.now() - t0)
    emit('done', 'Done', 100, n, n)
    return { blob, warnings, stats }
  } finally {
    try { await pdf.cleanup?.() } catch { /* ignore */ }
    try { await task?.destroy?.() } catch { /* ignore */ }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  PASS 1 — ANALYSE ONE PAGE (everything heavy is released before returning)
// ═════════════════════════════════════════════════════════════════════════════
async function analyzePage(pdf, pageNum, ctx) {
  const { pdfjs, hist, mem, warn, cfg } = ctx
  const page = await pdf.getPage(pageNum)
  const model = { pageNum, mode: 'rich', w: 595.28, h: 841.89, lines: [], blocks: [], images: [], pageImage: null, vector: null, topDown: true }
  try {
    const vp = page.getViewport({ scale: 1 })
    model.w = vp.width
    model.h = vp.height

    // 1. text layout (ladder: segmenter layout → raw pdf.js text)
    let layout = null, items = null
    try { layout = await extractPageLayout(page); items = layout?.items } catch (e) {
      warn(pageNum, 'LAYOUT_FAILED', `Page ${pageNum}: layout extraction failed; using raw text.`)
    }
    if (!Array.isArray(items)) {
      model.mode = 'plain'
      try { items = await rawTextItems(page, vp) } catch { items = [] }
    }
    U.addToHistogram(hist, items)
    const pageW = layout?.pageWidth ?? vp.width

    // 2. reading order
    let lines = null
    if (layout) {
      try { lines = segmentIntoColumns(items, pageW) } catch (e) {
        warn(pageNum, 'COLUMNS_FAILED', `Page ${pageNum}: column detection failed; used line grouping.`)
      }
    }
    if (!lines) { lines = U.groupItemsIntoLines(items); model.mode = 'plain' }
    model.lines = lines.map(sanitizeLine)
    model.topDown = detectTopDown(model.lines)

    // 3. vector geometry (table borders / box fills) — optional
    try { model.vector = await extractVectorGeometry(page) } catch { model.vector = null }

    // 4. tables / callouts / code / columns
    if (model.mode === 'rich') {
      try { model.blocks = mergeParagraphBlocks(detectTableRegions(model.lines, pageW, model.vector)) }
      catch (e) {
        warn(pageNum, 'TABLES_FAILED', `Page ${pageNum}: table detection failed; text kept as paragraphs.`)
        model.mode = 'plain'
      }
    }
    if (model.mode !== 'rich') model.blocks = U.mergePlainLines(model.lines).map((line) => ({ type: 'paragraph', line }))

    // 5. images (best-effort; never blocks text)
    const chars = model.lines.reduce((s, l) => s + (l.text?.length || 0), 0)
    let rects = []
    try { rects = await detectImageRects(page, vp, pdfjs.OPS, cfg.minImagePt) } catch { rects = [] }
    const cov = U.coverage(rects, vp.width, vp.height)
    const isScan = (cov >= 0.6 && chars < 40) || (cov >= 0.85 && chars < 400)
    const wantImages = isScan || rects.length > 0
    if (wantImages && !mem.skipImages && typeof document !== 'undefined') {
      let rendered = null
      try {
        rendered = await renderPageCanvas(page, vp, mem)
        if (isScan) {
          const img = await canvasToImage(rendered.canvas, 0, 0, rendered.canvas.width, rendered.canvas.height, mem, 'jpeg')
          model.pageImage = { ...img, w: vp.width, h: vp.height }
          model.mode = 'image'
          model.blocks = []; model.lines = []
          mem.imageBytes += img.data.byteLength
          warn(pageNum, 'SCANNED_PAGE', `Page ${pageNum}: scanned/graphic page kept as an image.`, 'info')
        } else {
          let merged = U.mergeRects(rects, 4).sort((a, b) => U.rectArea(b) - U.rectArea(a)).slice(0, cfg.maxImagesPerPage)
          merged = merged.sort((a, b) => a.y - b.y)
          for (const r of merged) {
            const s = rendered.scale
            const img = await canvasToImage(rendered.canvas, r.x * s, r.y * s, r.w * s, r.h * s, mem, 'auto')
            model.images.push({ ...img, x: r.x, y: r.y, w: r.w, h: r.h })
            mem.imageBytes += img.data.byteLength
          }
        }
      } catch (e) {
        warn(pageNum, 'IMAGE_FAILED', `Page ${pageNum}: images could not be extracted (${e?.message || e}).`, 'info')
        if (isScan && chars === 0) model.mode = 'failed'
      } finally {
        if (rendered) releaseCanvas(rendered.canvas)
      }
    } else if (isScan && chars === 0) {
      model.mode = 'failed'
    }
    return model
  } finally {
    try { page.cleanup() } catch { /* ignore */ }
  }
}

/** pdf.js getTextContent → items shaped like the layout engine's (top-down y). */
async function rawTextItems(page, vp) {
  const tc = await page.getTextContent()
  const out = []
  for (const it of tc.items) {
    if (!it.str || !it.transform) continue
    const [a, b, , , e, f] = it.transform
    const size = Math.hypot(a, b) || it.height || 10
    const fam = tc.styles?.[it.fontName]?.fontFamily || it.fontName || ''
    out.push({
      str: it.str, x: e, y: vp.height - f, w: it.width || 0, size,
      isBold: /bold|black|heavy/i.test(it.fontName + ' ' + fam),
      isItalic: /italic|oblique/i.test(it.fontName + ' ' + fam),
    })
  }
  return out
}

function sanitizeLine(l) {
  if (!l) return l
  const text = U.cleanText(l.text)
  if (Array.isArray(l.spans)) l.spans = l.spans.map((s) => ({ ...s, text: U.cleanText(s.text) }))
  l.text = text
  return l
}

/** reading order is top→bottom, so if the first line's y is larger than the last's, y is bottom-up. */
function detectTopDown(lines) {
  const ys = lines.map((l) => l.y).filter(Number.isFinite)
  if (ys.length < 2) return true
  return ys[0] <= ys[ys.length - 1]
}

// ─── Image detection from the operator list (no pixel decoding needed) ──────
async function detectImageRects(page, vp, OPS, minPt) {
  if (!OPS) return []
  const ops = await page.getOperatorList()
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintJpegXObject].filter((v) => v !== undefined))
  const rects = []
  let ctm = U.IDENTITY.slice()
  const stack = []
  const { fnArray, argsArray } = ops
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    if (fn === OPS.save) stack.push(ctm.slice())
    else if (fn === OPS.restore) ctm = stack.pop() || U.IDENTITY.slice()
    else if (fn === OPS.transform) ctm = U.mulMatrix(ctm, argsArray[i])
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (argsArray[i]?.[0]) ctm = U.mulMatrix(ctm, argsArray[i][0]) }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || U.IDENTITY.slice()
    else if (imageOps.has(fn)) {
      const b = U.unitSquareBBox(U.mulMatrix(vp.transform, ctm))
      const x = clamp(b.x, 0, vp.width), y = clamp(b.y, 0, vp.height)
      const r = { x, y, w: Math.min(b.x + b.w, vp.width) - x, h: Math.min(b.y + b.h, vp.height) - y }
      if (r.w >= minPt && r.h >= minPt && U.rectArea(r) >= 0.002 * vp.width * vp.height) rects.push(r)
    }
  }
  return rects
}

async function renderPageCanvas(page, vp1, mem) {
  const maxDim = mem.lowMem ? 1200 : 2400
  const scale = Math.min(mem.lowMem ? 1 : 2, maxDim / Math.max(vp1.width, vp1.height))
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(vp.width))
  canvas.height = Math.max(1, Math.ceil(vp.height))
  const g = canvas.getContext('2d', { alpha: false })
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: g, canvas, viewport: vp, background: '#ffffff' }).promise
  return { canvas, scale }
}

function releaseCanvas(c) { try { c.width = 0; c.height = 0 } catch { /* ignore */ } }

async function canvasToImage(src, sx, sy, sw, sh, mem, kind) {
  sx = Math.max(0, Math.floor(sx)); sy = Math.max(0, Math.floor(sy))
  sw = Math.max(1, Math.min(Math.ceil(sw), src.width - sx)); sh = Math.max(1, Math.min(Math.ceil(sh), src.height - sy))
  const c = document.createElement('canvas')
  c.width = sw; c.height = sh
  try {
    c.getContext('2d', { alpha: false }).drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
    const png = kind === 'png' || (kind === 'auto' && sw * sh < 250_000)
    const mime = png ? 'image/png' : 'image/jpeg'
    const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), mime, mem.lowMem ? 0.6 : 0.85))
    return { data: new Uint8Array(await blob.arrayBuffer()), type: png ? 'png' : 'jpg', pxW: sw, pxH: sh }
  } finally { releaseCanvas(c) }
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUILD + PACK BRIDGE (Worker first, main thread as a safe fallback)
// ═════════════════════════════════════════════════════════════════════════════
async function buildAndPack(models, o) {
  const { signal, warn, cfg } = o
  const useWorker = cfg.useWorker !== false && typeof Worker !== 'undefined'
  if (useWorker) {
    let worker = null
    try {
      worker = await startBuildWorker(signal)
      return await runBuildInWorker(worker, models, o)
    } catch (e) {
      if (e?.code === 'ABORTED') throw e
      if (e?.afterTransfer) warn(null, 'WORKER_FAILED', 'Background build failed after images were handed over; images were dropped.')
      else warn(null, 'WORKER_UNAVAILABLE', 'Background worker unavailable; built on the main thread.', 'info')
      if (e?.afterTransfer) for (const m of models) { m.images = []; m.pageImage = null }
    } finally {
      try { worker?.terminate() } catch { /* ignore */ }
    }
  }
  const slice = U.createSlicer(8)
  return buildDocxBlob(models, {
    bodySize: o.bodySize, title: o.title, warn, onProgress: o.onProgress, yieldFn: slice,
    isAborted: () => !!signal?.aborted,
  })
}

/** Resolves once the worker says "ready" (or rejects fast, e.g. blocked by CSP). */
function startBuildWorker(signal) {
  return new Promise((resolve, reject) => {
    let w
    try { w = new Worker(new URL('./pdfToWordBuildWorker.js', import.meta.url), { type: 'module' }) }
    catch (e) { return reject(e) }
    const timer = setTimeout(() => { try { w.terminate() } catch { /* ignore */ } reject(new Error('worker start timeout')) }, 4000)
    w.onmessage = (ev) => { if (ev.data?.type === 'ready') { clearTimeout(timer); w.onmessage = null; w.onerror = null; resolve(w) } }
    w.onerror = (ev) => { clearTimeout(timer); reject(new Error(ev?.message || 'worker error')) }
    signal?.addEventListener('abort', () => { clearTimeout(timer); try { w.terminate() } catch { /* ignore */ } reject(U.abortError()) }, { once: true })
  })
}

function runBuildInWorker(worker, models, o) {
  const { signal, warn } = o
  return new Promise((resolve, reject) => {
    let transferred = false
    const fail = (e) => { if (transferred) e.afterTransfer = true; reject(e) }
    const onAbort = () => { try { worker.terminate() } catch { /* ignore */ } reject(U.abortError()) }
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.onmessage = (ev) => {
      const d = ev.data || {}
      if (d.type === 'progress') o.onProgress?.(d.i, d.n)
      else if (d.type === 'warn') warn(d.page, d.code, d.message, d.level)
      else if (d.type === 'done') { signal?.removeEventListener('abort', onAbort); resolve({ blob: d.blob, packMode: d.packMode, modes: d.modes }) }
      else if (d.type === 'error') fail(new Error(d.message || 'worker build failed'))
    }
    worker.onerror = (ev) => fail(new Error(ev?.message || 'worker crashed'))
    const slim = models.map(slimModel)
    const transfer = []
    for (const m of slim) {
      for (const im of m.images || []) transfer.push(im.data.buffer)
      if (m.pageImage) transfer.push(m.pageImage.data.buffer)
    }
    try {
      worker.postMessage({ models: slim, bodySize: o.bodySize, title: o.title }, transfer)
      transferred = true
    } catch (e) { reject(e) } // DataCloneError etc: nothing was transferred, main-thread fallback keeps images
  })
}

/** drop raw item arrays (big, not needed for building) so the clone to the worker stays small */
function slimModel(m) {
  const strip = (l) => { if (l && l.items) { const { items, ...rest } = l; return rest } return l }
  const blocks = (m.blocks || []).map((b) => {
    const nb = { ...b }
    if (nb.line) nb.line = strip(nb.line)
    for (const k of ['lines', 'col1Lines', 'col2Lines']) if (Array.isArray(nb[k])) nb[k] = nb[k].map(strip)
    return nb
  })
  return { ...m, lines: (m.lines || []).map(strip), blocks }
}

export { MIME_DOCX }
