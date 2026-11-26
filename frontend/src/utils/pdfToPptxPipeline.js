/**
 * pdfToPptxPipeline.js — hardened, per-page-isolated PDF → .pptx converter.
 * 100% client-side. Reuses the PDF-to-Word analysis layer (analyzePage, table stitching,
 * vector extraction, image extraction, abortable/timeout watchdogs, and memory budgets).
 */
import { stitchCrossPageTables } from './pdfTableMerge.js'
import {
  analyzePage,
  renderPageCanvas,
  canvasToImage,
  releaseCanvas,
  ANALYZE_DEFAULTS,
} from './pdfToWordPipeline.js'
import { buildPptxBlob } from './pdfToPptxBuild.js'
import * as U from './pdfToWordUtils.js'

export { ConversionError } from './pdfToWordUtils.js'

const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/**
 * @param {File|Blob} file
 * @param {object} [opts]
 * @param {'editable'|'images'} [opts.mode='editable']
 * @param {'auto'|'16:9'|'4:3'} [opts.slideLayout='auto']
 * @param {(p:object)=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.pageTimeoutMs]
 * @returns {Promise<{blob:Blob, warnings:object[], stats:object}>}
 */
export async function convertPdfToPptx(file, opts = {}) {
  const cfg = { ...ANALYZE_DEFAULTS, mode: 'editable', slideLayout: 'auto', ...opts }
  const { signal, onProgress } = cfg
  const warnings = []
  const warn = (page, code, message, level = 'warn') => warnings.push({ page, code, message, level })
  const vel = U.makeVelocityTracker()
  const slice = U.createSlicer(8)
  const stats = { pages: 0, rich: 0, plain: 0, image: 0, failed: 0, images: 0, packMode: 'rich', elapsedMs: 0 }
  const t0 = U.now()

  const emit = (stage, message, percent, page, total) => {
    const v = total ? vel.snapshot(page ?? 0, total) : {}
    onProgress?.({
      percent: Math.round(percent),
      stage,
      message,
      page,
      totalPages: total,
      pagesPerSec: v.pagesPerSec,
      etaSec: v.etaSec ?? null,
      warnings: warnings.length,
    })
  }

  U.throwIfAborted(signal)
  const pdfjs = globalThis.pdfjsLib
  if (!pdfjs?.getDocument) throw new U.ConversionError('NO_PDFJS', 'PDF engine (pdf.js) is not loaded.')

  emit('loading', 'Reading PDF…', 1)
  let buf = await U.abortable(file.arrayBuffer(), signal)
  let task = null
  let pdf = null
  try {
    task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false })
    pdf = await U.abortable(task.promise, signal)
  } catch (e) {
    try { task?.destroy?.() } catch { /* ignore */ }
    throw U.classifyPdfError(e)
  } finally {
    buf = null
  }

  try {
    const n = pdf.numPages
    stats.pages = n
    if (!n) throw new U.ConversionError('EMPTY', 'This PDF has no pages.')

    const hist = new Map()
    const mem = { imageBytes: 0, lowMem: false, skipImages: false }
    const models = new Array(n)

    for (let p = 1; p <= n; p++) {
      U.throwIfAborted(signal)
      emit('analyze', `Analyzing page ${p} of ${n}…`, 2 + 68 * ((p - 1) / n), p - 1, n)
      try {
        if (cfg.mode === 'images') {
          models[p - 1] = await U.abortable(
            U.withTimeout(renderPageAsSlideModel(pdf, p, mem), cfg.pageTimeoutMs, `Page ${p}`),
            signal
          )
        } else {
          const m = await U.abortable(
            U.withTimeout(analyzePage(pdf, p, { pdfjs, hist, mem, warn, cfg }), cfg.pageTimeoutMs, `Page ${p}`),
            signal
          )
          // If page has neither text blocks nor embedded images (e.g., pure vector illustration), render as slide image
          const hasAnyContent = (m.blocks && m.blocks.length > 0) || (m.images && m.images.length > 0) || m.pageImage
          if (!hasAnyContent && typeof document !== 'undefined' && !mem.skipImages) {
            try {
              const fallbackImg = await renderPageAsSlideModel(pdf, p, mem)
              m.pageImage = fallbackImg.pageImage
              m.mode = 'image'
            } catch { /* keep empty/minimal model */ }
          }
          models[p - 1] = m
        }
      } catch (e) {
        if (e?.code === 'ABORTED') throw e
        warn(p, 'PAGE_FAILED', `Page ${p} could not be analysed (${e?.message || e}).`)
        models[p - 1] = { pageNum: p, mode: 'failed', w: 720, h: 405, lines: [], blocks: [], images: [], vector: null }
      }

      if (mem.imageBytes > cfg.imageBudgetSoft && !mem.lowMem) {
        mem.lowMem = true
        warn(null, 'LOW_MEMORY', 'Large images detected — remaining images are downscaled to keep the browser stable.', 'info')
      }
      if (mem.imageBytes > cfg.imageBudgetHard) mem.skipImages = true
      if (p % 10 === 0) { try { pdf.cleanup() } catch { /* ignore */ } }
      await slice(true)
    }

    const bodySize = U.dominantSize(hist, 11)
    const title = (cfg.title || file.name || 'Converted Presentation').replace(/\.pdf$/i, '')
    emit('build', 'Building PowerPoint slides…', 72, 0, n)
    stats.images = models.reduce((s, m) => s + (m.images?.length || 0) + (m.pageImage ? 1 : 0), 0)

    if (cfg.mode !== 'images') {
      const stitched = stitchCrossPageTables(models)
      if (stitched) warn(null, 'TABLE_STITCHED', `${stitched} table(s) continued across pages were merged.`, 'info')
    }

    const built = await buildPptxBlob(models, {
      bodySize,
      title,
      slideLayout: cfg.slideLayout,
      warn,
      yieldFn: slice,
      isAborted: () => !!signal?.aborted,
      onProgress: (i, total) =>
        emit(
          i >= total ? 'pack' : 'build',
          i >= total ? 'Packaging PowerPoint (.pptx)…' : `Building slide ${i + 1} of ${total}…`,
          i >= total ? 92 : 72 + 19 * (i / Math.max(1, total)),
          i,
          total
        ),
    })

    stats.packMode = built.packMode
    for (const mode of built.modes) {
      if (mode === 'image') stats.image++
      else if (mode === 'failed') stats.failed++
      else if (mode === 'rich') stats.rich++
      else stats.plain++
    }

    for (const m of models) {
      m.images = null
      m.pageImage = null
      m.blocks = null
      m.lines = null
      m.vector = null
    }

    stats.elapsedMs = Math.round(U.now() - t0)
    emit('done', 'Done', 100, n, n)
    return { blob: built.blob, warnings, stats }
  } finally {
    try { await pdf.cleanup?.() } catch { /* ignore */ }
    try { await task?.destroy?.() } catch { /* ignore */ }
  }
}

async function renderPageAsSlideModel(pdf, pageNum, mem) {
  const page = await pdf.getPage(pageNum)
  const vp = page.getViewport({ scale: 1 })
  let rendered = null
  try {
    rendered = await renderPageCanvas(page, vp, mem)
    const img = await canvasToImage(rendered.canvas, 0, 0, rendered.canvas.width, rendered.canvas.height, mem, 'jpeg')
    mem.imageBytes += img.data.byteLength
    return {
      pageNum,
      mode: 'image',
      w: vp.width,
      h: vp.height,
      lines: [],
      blocks: [],
      images: [],
      pageImage: { ...img, w: vp.width, h: vp.height },
      vector: null,
      topDown: true,
    }
  } finally {
    if (rendered) releaseCanvas(rendered.canvas)
    try { page.cleanup() } catch { /* ignore */ }
  }
}

export { MIME_PPTX }
