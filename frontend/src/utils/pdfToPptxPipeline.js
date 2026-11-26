/**
 * pdfToPptxPipeline.js — client-side PDF → .pptx converter.
 * Uses the previous Universal Document AST layout engine:
 *   extractPageLayout + extractVectorGeometry → buildDocumentAst → exportAstToPptx (PptxGenJS),
 * with automatic raster slide fallback for scanned PDFs and explicit 'images' mode.
 */
import PptxGenJS from 'pptxgenjs'
import { extractPageLayout } from './pdfLayoutSegmenter.js'
import { extractVectorGeometry } from './pdfVectorExtractor.js'
import { buildDocumentAst } from './documentLayoutAnalysis.js'
import { exportAstToPptx } from './pptxEmitter.js'
import {
  renderPageCanvas,
  canvasToImage,
  releaseCanvas,
  ANALYZE_DEFAULTS,
} from './pdfToWordPipeline.js'
import * as U from './pdfToWordUtils.js'

export { ConversionError } from './pdfToWordUtils.js'

const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

function uint8ToDataUri(bytes, type = 'jpeg') {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  const mime = type === 'png' ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${btoa(bin)}`
}

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
  const stats = { pages: 0, rich: 0, plain: 0, image: 0, failed: 0, images: 0, packMode: 'ast', elapsedMs: 0 }
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

    const title = (cfg.title || file.name || 'PDFForge Presentation').replace(/\.pdf$/i, '')

    if (cfg.mode !== 'images') {
      const pagesData = []
      for (let p = 1; p <= n; p++) {
        U.throwIfAborted(signal)
        emit('analyze', `Analyzing page ${p} of ${n}…`, 2 + 70 * ((p - 1) / n), p - 1, n)
        const page = await pdf.getPage(p)
        try {
          const layout = await U.abortable(
            U.withTimeout(extractPageLayout(page), cfg.pageTimeoutMs, `Page ${p}`),
            signal
          )
          let vectorGeometry = null
          try {
            vectorGeometry = await extractVectorGeometry(page)
          } catch {
            vectorGeometry = null
          }
          pagesData.push({ ...layout, vectorGeometry })
        } catch (e) {
          if (e?.code === 'ABORTED') throw e
          warn(p, 'PAGE_FAILED', `Page ${p} layout extraction failed (${e?.message || e}).`)
          pagesData.push({ items: [], pageWidth: 595.28, pageHeight: 841.89, vectorGeometry: null })
        } finally {
          try { page.cleanup() } catch { /* ignore */ }
        }
        if (p % 10 === 0) { try { pdf.cleanup() } catch { /* ignore */ } }
        await slice(true)
      }

      const hasContent = pagesData.some((p) => p.items && p.items.length > 0)
      if (hasContent) {
        emit('build', 'Building PowerPoint slides…', 80, n, n)
        const ast = buildDocumentAst(pagesData, { title })
        emit('pack', 'Packaging PowerPoint (.pptx)…', 92, n, n)
        const blob = await exportAstToPptx(ast, PptxGenJS)
        stats.rich = n
        stats.elapsedMs = Math.round(U.now() - t0)
        emit('done', 'Done', 100, n, n)
        return { blob, warnings, stats }
      }
      warn(null, 'SCANNED_FALLBACK', 'No extractable text found; rendered pages as slide images.', 'info')
    }

    // Raster slide-image mode (or fallback for purely scanned bitmap PDFs)
    const mem = { imageBytes: 0, lowMem: false, skipImages: false }
    const pptx = new PptxGenJS()
    pptx.author = 'PDFForge'
    pptx.title = U.cleanText(title)

    for (let p = 1; p <= n; p++) {
      U.throwIfAborted(signal)
      emit('analyze', `Rendering slide ${p} of ${n}…`, 2 + 85 * ((p - 1) / n), p - 1, n)
      const page = await pdf.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      let rendered = null
      try {
        if (p === 1) {
          if (cfg.slideLayout === '16:9') pptx.layout = 'LAYOUT_16x9'
          else if (cfg.slideLayout === '4:3') pptx.layout = 'LAYOUT_4x3'
          else {
            pptx.defineLayout({ name: 'PDF', width: vp.width / 72, height: vp.height / 72 })
            pptx.layout = 'PDF'
          }
        }
        rendered = await renderPageCanvas(page, vp, mem)
        const img = await canvasToImage(rendered.canvas, 0, 0, rendered.canvas.width, rendered.canvas.height, mem, 'jpeg')
        mem.imageBytes += img.data.byteLength
        if (mem.imageBytes > cfg.imageBudgetSoft) mem.lowMem = true
        pptx.addSlide().addImage({
          data: uint8ToDataUri(img.data, 'jpeg'),
          x: 0,
          y: 0,
          w: '100%',
          h: '100%',
        })
        stats.image++
        stats.images++
      } finally {
        if (rendered) releaseCanvas(rendered.canvas)
        try { page.cleanup() } catch { /* ignore */ }
      }
      await slice(true)
    }

    emit('pack', 'Packaging PowerPoint (.pptx)…', 94, n, n)
    const blob = await pptx.write({ outputType: 'blob' })
    stats.packMode = 'images'
    stats.elapsedMs = Math.round(U.now() - t0)
    emit('done', 'Done', 100, n, n)
    return { blob, warnings, stats }
  } finally {
    try { await pdf.cleanup?.() } catch { /* ignore */ }
    try { await task?.destroy?.() } catch { /* ignore */ }
  }
}

export { MIME_PPTX }
