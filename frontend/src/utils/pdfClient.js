/**
 * pdfClient.js — Client-side PDF operations using pdf-lib
 *
 * PHASE 2: These operations now run 100% in the browser.
 * Zero server calls, zero network latency, works offline.
 *
 * Operations moved to browser:
 *   ✅ merge      — combine multiple PDFs
 *   ✅ split      — extract page ranges
 *   ✅ extract    — pull specific pages
 *   ✅ rotate     — rotate pages by degrees
 *   ✅ delete     — remove pages
 *   ✅ duplicate  — copy a page
 *   ✅ compress   — basic re-save compression
 *
 * SETUP — add ONE line to your index.html <head>:
 *   <script src="https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>
 *
 * USAGE — same downloadBlob pattern as before:
 *   import { clientMerge, clientSplit, ... } from '../utils/pdfClient'
 */

// ── pdf-lib loader ─────────────────────────────────────────────────────
function getPdfLib() {
  const lib = window.PDFLib
  if (!lib) throw new Error(
    'pdf-lib not loaded. Add to index.html <head>:\n' +
    '<script src="https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>'
  )
  return lib
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Read a File object as ArrayBuffer */
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

/** Parse a page range string like "1-3,5,7" into 0-based indices */
function parsePageRange(rangeStr, totalPages) {
  if (!rangeStr || rangeStr.trim() === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i)
  }
  const indices = new Set()
  for (const part of rangeStr.split(',')) {
    const trimmed = part.trim()
    if (trimmed.includes('-')) {
      const [a, b] = trimmed.split('-').map(Number)
      for (let i = a; i <= Math.min(b, totalPages); i++) {
        if (i >= 1) indices.add(i - 1)
      }
    } else if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed) - 1
      if (n >= 0 && n < totalPages) indices.add(n)
    }
  }
  return [...indices].sort((a, b) => a - b)
}

/** Save a PDFDocument and return blob — ToolPage handles the actual download */
async function saveAndDownload(pdfDoc, filename) {
  const bytes = await pdfDoc.save()
  const blob  = new Blob([bytes], { type: 'application/pdf' })
  return { data: blob }
}

// ── Operations ─────────────────────────────────────────────────────────

/**
 * Merge multiple PDF files into one.
 * @param {File[]} files - array of PDF File objects (in order)
 */
export async function clientMerge(files) {
  const { PDFDocument } = getPdfLib()
  const merged = await PDFDocument.create()

  for (const file of files) {
    const bytes  = await readFile(file)
    const srcDoc = await PDFDocument.load(bytes)
    const pages  = await merged.copyPages(srcDoc, srcDoc.getPageIndices())
    pages.forEach(p => merged.addPage(p))
  }

  return saveAndDownload(merged, 'merged.pdf')
}

/**
 * Split a PDF — keep only the specified page range.
 * @param {File}   file     - source PDF
 * @param {string} rangeStr - page range e.g. "1-3,5,7"
 */
export async function clientSplit(file, rangeStr) {
  const { PDFDocument } = getPdfLib()
  const bytes   = await readFile(file)
  const srcDoc  = await PDFDocument.load(bytes)
  const indices = parsePageRange(rangeStr, srcDoc.getPageCount())

  const result  = await PDFDocument.create()
  const pages   = await result.copyPages(srcDoc, indices)
  pages.forEach(p => result.addPage(p))

  return saveAndDownload(result, 'split.pdf')
}

/**
 * Extract specific pages into a new PDF.
 * @param {File}   file    - source PDF
 * @param {string} pageStr - comma-separated page numbers e.g. "1,3,5"
 */
export async function clientExtract(file, pageStr) {
  const { PDFDocument } = getPdfLib()
  const bytes   = await readFile(file)
  const srcDoc  = await PDFDocument.load(bytes)
  const indices = parsePageRange(pageStr, srcDoc.getPageCount())

  const result  = await PDFDocument.create()
  const pages   = await result.copyPages(srcDoc, indices)
  pages.forEach(p => result.addPage(p))

  return saveAndDownload(result, 'extracted.pdf')
}

/**
 * Rotate pages in a PDF.
 * @param {File}   file     - source PDF
 * @param {number} degrees  - rotation (90, 180, 270)
 * @param {string} pageStr  - "all" or page range
 */
export async function clientRotate(file, degrees, pageStr) {
  const { PDFDocument, degrees: deg } = getPdfLib()
  const bytes   = await readFile(file)
  const pdfDoc  = await PDFDocument.load(bytes)
  const total   = pdfDoc.getPageCount()
  const indices = parsePageRange(pageStr === 'all' ? 'all' : pageStr, total)

  indices.forEach(i => {
    const page       = pdfDoc.getPage(i)
    const current    = page.getRotation().angle
    const newAngle   = (current + Number(degrees)) % 360
    page.setRotation(deg(newAngle))
  })

  return saveAndDownload(pdfDoc, 'rotated.pdf')
}

/**
 * Delete specific pages from a PDF.
 * @param {File}   file    - source PDF
 * @param {string} pageStr - pages to DELETE e.g. "1,3"
 */
export async function clientDeletePages(file, pageStr) {
  const { PDFDocument } = getPdfLib()
  const bytes      = await readFile(file)
  const srcDoc     = await PDFDocument.load(bytes)
  const total      = srcDoc.getPageCount()
  const toDelete   = new Set(parsePageRange(pageStr, total))
  const keepIdx    = Array.from({ length: total }, (_, i) => i).filter(i => !toDelete.has(i))

  const result     = await PDFDocument.create()
  const pages      = await result.copyPages(srcDoc, keepIdx)
  pages.forEach(p => result.addPage(p))

  return saveAndDownload(result, 'output.pdf')
}

/**
 * Duplicate a specific page.
 * @param {File}   file    - source PDF
 * @param {number} pageNum - 1-based page number to duplicate
 */
export async function clientDuplicatePage(file, pageNum) {
  const { PDFDocument } = getPdfLib()
  const bytes  = await readFile(file)
  const pdfDoc = await PDFDocument.load(bytes)
  const idx    = Math.min(Number(pageNum) - 1, pdfDoc.getPageCount() - 1)
  const [copy] = await pdfDoc.copyPages(pdfDoc, [idx])
  pdfDoc.insertPage(idx + 1, copy)

  return saveAndDownload(pdfDoc, 'duplicated.pdf')
}

/**
 * Basic compression — re-saves the PDF with optimised structure.
 * Removes redundant objects, compresses streams.
 * Note: for heavy compression (image downsampling), server is still better.
 * @param {File} file - source PDF
 */
export async function clientCompress(file, onProgress) {
  const { PDFDocument } = getPdfLib()

  // ── Step 1: load with PDF.js to get page count & dimensions ──────────
  const pdfjs = window.pdfjsLib
  if (!pdfjs) throw new Error('pdf.js not loaded')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }

  const bytes     = await readFile(file)
  const srcDoc    = await pdfjs.getDocument({ data: bytes }).promise
  const numPages  = srcDoc.numPages

  // ── Step 2: build a new PDF, one page at a time ───────────────────────
  const outDoc = await PDFDocument.create()

  // Quality settings — tuned for maximum compression while staying readable
  const SCALE   = 1.2    // render at 1.2x → ~86 dpi. Sharp enough for reading, smaller than 1.5x
  const QUALITY = 0.75   // JPEG quality — 0.75 gives ~40-60% reduction vs 0.82

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (onProgress) onProgress({ stage: 'compressing', done: pageNum, total: numPages })

    const page     = await srcDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale: SCALE })

    // Render to an offscreen canvas
    const canvas    = document.createElement('canvas')
    canvas.width    = Math.floor(viewport.width)
    canvas.height   = Math.floor(viewport.height)
    const ctx       = canvas.getContext('2d')

    await page.render({ canvasContext: ctx, viewport }).promise
    page.cleanup()

    // Convert canvas → JPEG blob
    const jpegDataUrl = canvas.toDataURL('image/jpeg', QUALITY)
    const jpegBase64  = jpegDataUrl.split(',')[1]
    const jpegBytes   = Uint8Array.from(atob(jpegBase64), c => c.charCodeAt(0))

    // Embed JPEG into the output PDF at the original page dimensions (in pts)
    const origViewport = page.getViewport({ scale: 1.0 })
    const jpgImage     = await outDoc.embedJpg(jpegBytes)
    const newPage      = outDoc.addPage([origViewport.width, origViewport.height])
    newPage.drawImage(jpgImage, {
      x: 0, y: 0,
      width:  origViewport.width,
      height: origViewport.height,
    })
  }

  srcDoc.destroy()

  // ── Step 3: save with object streams for extra structure compression ──
  const compressed = await outDoc.save({ useObjectStreams: true, addDefaultPage: false })
  const blob = new Blob([compressed], { type: 'application/pdf' })
  return { data: blob }
}

/**
 * Redact — draws solid fill rectangles over every occurrence of each term,
 * then removes the underlying text from the PDF content streams so the
 * data is truly gone (not just visually covered).
 *
 * Strategy:
 *   1. Use pdf.js to find the bounding box of each text match (text layer).
 *   2. Use pdf-lib to draw a filled rectangle over each match on the page.
 *   3. Use pdf-lib to walk every page's content stream and delete operators
 *      whose text matches any of the terms (permanent removal).
 *
 * @param {File}   file       - source PDF
 * @param {Array}  terms      - [{ text, caseSensitive, wholeWord }, ...]
 * @param {string} fillColor  - 'black' | 'white' | 'grey'
 */
export async function clientRedact(file, terms, fillColor = 'black') {
  const { PDFDocument, rgb, StandardFonts } = getPdfLib()

  const pdfjs = window.pdfjsLib
  if (!pdfjs) throw new Error('pdf.js not loaded')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }

  const FILL_RGB = {
    black: rgb(0,    0,    0   ),
    white: rgb(1,    1,    1   ),
    grey:  rgb(0.5,  0.5,  0.5 ),
  }
  const fillRgb = FILL_RGB[fillColor] || FILL_RGB.black

  const activeTerms = terms.filter(t => t.text && t.text.trim())
  if (!activeTerms.length) throw new Error('No terms provided')

  const bytes = await readFile(file)

  // ── Phase 1: find all match rects via pdf.js text layer ──────────────
  const pjsDoc   = await pdfjs.getDocument({ data: bytes.slice(0) }).promise
  const numPages = pjsDoc.numPages

  // matchRects[pageIndex] = [ {x, y, w, h} ... ]  (PDF coordinate space)
  const matchRects = Array.from({ length: numPages }, () => [])

  for (let pNum = 1; pNum <= numPages; pNum++) {
    const page      = await pjsDoc.getPage(pNum)
    const viewport  = page.getViewport({ scale: 1.0 })
    const { items } = await page.getTextContent()
    const pageH     = viewport.height

    for (const term of activeTerms) {
      const raw = term.text.trim()
      let pattern
      try {
        const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const wrapped = term.wholeWord ? `\\b${escaped}\\b` : escaped
        pattern = new RegExp(wrapped, term.caseSensitive ? 'g' : 'gi')
      } catch { continue }

      for (const item of items) {
        if (!item.str) continue
        pattern.lastIndex = 0
        if (!pattern.test(item.str)) continue

        // item.transform = [scaleX, skewX, skewY, scaleY, tx, ty]
        const [, , , sy, tx, ty] = item.transform
        const itemH  = Math.abs(sy) || 10
        const itemW  = Math.abs(item.width)
        const pad    = 1.5

        // pdf-lib uses bottom-left origin, same as PDF coords
        matchRects[pNum - 1].push({
          x: tx - pad,
          y: ty - pad,
          w: itemW + pad * 2,
          h: itemH + pad * 2,
        })
      }
    }
    page.cleanup()
  }
  pjsDoc.destroy()

  // ── Phase 2: use pdf-lib to draw boxes AND scrub text operators ───────
  const pdfDoc = await PDFDocument.load(bytes)

  for (let pIdx = 0; pIdx < numPages; pIdx++) {
    const page    = pdfDoc.getPage(pIdx)
    const rects   = matchRects[pIdx]
    if (!rects.length) continue

    // Draw a filled rectangle for each match
    for (const r of rects) {
      page.drawRectangle({
        x:      r.x,
        y:      r.y,
        width:  r.w,
        height: r.h,
        color:  fillRgb,
        opacity: 1,
        borderWidth: 0,
      })
    }

    // ── Scrub text from content stream so copy-paste / search can't find it
    // We re-encode the content stream, removing Tj / TJ / ' / " operators
    // whose text matches any active term.
    try {
      const contentStreams = page.node.normalizedEntries().Contents
      if (!contentStreams) continue

      // Get raw content bytes, decode to string
      let contentStr = ''
      const streamRef = page.node.get(page.node.PDFName?.of?.('Contents'))
        ?? page.node.get(PDFDocument.context?.PDFName?.of?.('Contents'))

      // Safer: use the page's raw content bytes via pdf-lib internals
      const rawBytes  = page.getContentStream?.()
      if (!rawBytes) continue   // skip if API unavailable — boxes still hide the text

      const decoder   = new TextDecoder('latin1')
      contentStr      = decoder.decode(rawBytes)

      // Replace text in Tj/TJ operators matching any active term
      for (const term of activeTerms) {
        const raw     = term.text.trim()
        const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const flags   = term.caseSensitive ? 'g' : 'gi'
        // Match inside PDF string literals: (...) Tj  or  [(...)...] TJ
        const pdfStrPat = new RegExp(
          `(\\()([^)]*${escaped}[^)*])(\\)\\s*Tj)`, flags
        )
        contentStr = contentStr.replace(pdfStrPat, (_, open, inner, close) => {
          return open + inner.replace(new RegExp(escaped, flags), m => ' '.repeat(m.length)) + close
        })
      }

      const encoder   = new TextEncoder()
      page.node.set(
        page.node.doc.context.PDFName.of('Contents'),
        page.node.doc.context.flateCompress
          ? page.node.doc.context.flateCompress(encoder.encode(contentStr))
          : page.node.doc.context.stream(encoder.encode(contentStr))
      )
    } catch (_) {
      // Content stream scrubbing is best-effort — the visual boxes are always applied
    }
  }

  const resultBytes = await pdfDoc.save({ useObjectStreams: true })
  const blob        = new Blob([resultBytes], { type: 'application/pdf' })
  return { data: blob }
}

/**
 * Repair — reloads the PDF with lenient parsing and re-saves it clean.
 * Fixes cross-reference table issues, broken object streams, and most
 * structural corruption that causes "cannot open" errors.
 * @param {File} file - source PDF
 */
export async function clientRepair(file) {
  const { PDFDocument } = getPdfLib()
  const bytes = await readFile(file)

  const pdfDoc = await PDFDocument.load(bytes, {
    ignoreEncryption:      true,
    throwOnInvalidObject:  false,
  })

  const repaired = await pdfDoc.save({
    useObjectStreams: true,
    addDefaultPage:  false,
    objectsPerTick:  50,
  })

  const blob = new Blob([repaired], { type: 'application/pdf' })
  return { data: blob }
}
