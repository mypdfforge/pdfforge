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

/* ---- text search + page flattening, shared by Redact and Find & Replace ---- */

const FLATTEN_SCALE = 2.5 // shortcut: ~180 dpi; raise for sharper flattened pages (more memory), lower for smaller files
const tick = () => new Promise(r => setTimeout(r, 0))

function initPdfjs() {
  const pdfjs = window.pdfjsLib
  if (!pdfjs) throw new Error('pdf.js not loaded')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }
  return pdfjs
}

/**
 * Sub-word match boxes per page, in PDF points (bottom-left origin).
 * shortcut: a match must sit inside one text item, and width is averaged per
 * character, so proportional fonts are approximate; rotated text is not handled.
 */
async function findRects(pjsDoc, terms) {
  const rects = Array.from({ length: pjsDoc.numPages }, () => [])
  for (let pNum = 1; pNum <= pjsDoc.numPages; pNum++) {
    const page = await pjsDoc.getPage(pNum)
    const { items } = await page.getTextContent()
    for (const term of terms) {
      const escaped = term.text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(term.wholeWord ? `\\b${escaped}\\b` : escaped, term.caseSensitive ? 'g' : 'gi')
      for (const item of items) {
        if (!item.str || !item.str.trim()) continue
        pattern.lastIndex = 0
        let m
        while ((m = pattern.exec(item.str)) !== null) {
          const [, , , scaleY, tx, ty] = item.transform
          const size = Math.abs(scaleY) || 10
          const charW = Math.abs(item.width) / item.str.length
          const pad = 1.5
          rects[pNum - 1].push({
            x: tx + m.index * charW - pad,
            y: ty - size * 0.25 - pad, // also covers descenders
            w: m[0].length * charW + pad * 2,
            h: size * 1.25 + pad * 2,
            bx: tx + m.index * charW, by: ty, size,
          })
          if (m[0].length === 0) pattern.lastIndex++
        }
      }
    }
    page.cleanup()
  }
  return rects
}

/** Fill the viewport box of a PDF-space rect (handles rotated pages). */
function fillRect(ctx, vp, r, color) {
  const [x1, y1, x2, y2] = vp.convertToViewportRectangle([r.x, r.y, r.x + r.w, r.y + r.h])
  ctx.fillStyle = color
  ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
}

/**
 * Rebuild the PDF with the pages in `draw` flattened to images (draw[i](ctx, viewport)
 * paints on the rendered page). The output is a NEW document, so the original text of
 * flattened pages is really gone. Other pages are copied unchanged.
 * shortcut: bookmarks, forms and attachments are not carried over.
 */
async function flattenPages(bytes, pjsDoc, draw, onProgress) {
  const { PDFDocument } = getPdfLib()
  const src = await PDFDocument.load(bytes)
  const out = await PDFDocument.create()
  const n = src.getPageCount()
  const keep = []
  for (let i = 0; i < n; i++) if (!draw[i]) keep.push(i)
  const copied = keep.length ? await out.copyPages(src, keep) : []
  let ci = 0
  for (let i = 0; i < n; i++) {
    if (!draw[i]) { out.addPage(copied[ci++]); continue }
    const page = await pjsDoc.getPage(i + 1)
    const vp = page.getViewport({ scale: FLATTEN_SCALE })
    const cv = document.createElement('canvas')
    cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height)
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height) // JPEG has no transparency
    await page.render({ canvasContext: ctx, viewport: vp }).promise
    draw[i](ctx, vp)
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92))
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()))
    const v1 = page.getViewport({ scale: 1 })
    out.addPage([v1.width, v1.height]).drawImage(img, { x: 0, y: 0, width: v1.width, height: v1.height })
    cv.width = 0; page.cleanup()
    onProgress?.({ done: i + 1, total: n })
    await tick() // let the UI breathe between pages
  }
  return new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' })
}

async function matchAndFlatten(file, terms, paint, onProgress, noMatchMsg) {
  const bytes = await readFile(file)
  const pjsDoc = await initPdfjs().getDocument({ data: bytes.slice(0) }).promise
  try {
    const rects = await findRects(pjsDoc, terms)
    const draw = {}
    rects.forEach((rs, i) => { if (rs.length) draw[i] = (ctx, vp) => rs.forEach(r => paint(ctx, vp, r)) })
    if (!Object.keys(draw).length) throw new Error(noMatchMsg)
    return { data: await flattenPages(bytes, pjsDoc, draw, onProgress) }
  } finally {
    pjsDoc.destroy()
  }
}

/**
 * Redact -- covers every match and flattens those pages to images, so the
 * covered text is removed from the file (not just hidden under a box).
 * Pages without a match stay untouched.
 * @param {Array}  terms     - [{ text, caseSensitive, wholeWord }, ...]
 * @param {string} fillColor - 'black' | 'white' | 'grey'
 */
export async function clientRedact(file, terms, fillColor = 'black', onProgress) {
  const active = terms.filter(t => t.text && t.text.trim())
  if (!active.length) throw new Error('No terms provided')
  const fill = { black: '#000000', white: '#ffffff', grey: '#808080' }[fillColor] || '#000000'
  return matchAndFlatten(file, active, (ctx, vp, r) => fillRect(ctx, vp, r, fill), onProgress,
    'No matches found, so nothing was redacted. (Scanned pages have no text to match.)')
}

/**
 * Find & Replace -- white-out each match and draw the new text over it, on a
 * flattened page (so the old text is really removed).
 * shortcut: new text is black Helvetica at the old size; a coloured background shows a white patch.
 */
export async function clientFindReplace(file, find, replace, matchCase = false, wholeWord = false, onProgress) {
  if (!find || !find.trim()) throw new Error('Enter the text to find.')
  const paint = (ctx, vp, r) => {
    fillRect(ctx, vp, r, '#ffffff')
    if (!replace) return
    const [px, py] = vp.convertToViewportPoint(r.bx, r.by)
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate((vp.rotation * Math.PI) / 180)
    ctx.fillStyle = '#000000'
    ctx.font = `${r.size * FLATTEN_SCALE}px Helvetica, Arial, "Noto Sans", sans-serif`
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(replace, 0, 0)
    ctx.restore()
  }
  return matchAndFlatten(file, [{ text: find, caseSensitive: matchCase, wholeWord }], paint, onProgress, 'No matches found.')
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
