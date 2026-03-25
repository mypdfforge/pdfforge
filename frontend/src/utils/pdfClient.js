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

/** Save a PDFDocument and trigger browser download */
async function saveAndDownload(pdfDoc, filename) {
  const bytes  = await pdfDoc.save()
  const blob   = new Blob([bytes], { type: 'application/pdf' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href       = url
  a.download   = filename
  a.click()
  URL.revokeObjectURL(url)
  // Return blob-like object matching existing downloadBlob API shape
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
export async function clientCompress(file) {
  const { PDFDocument } = getPdfLib()
  const bytes  = await readFile(file)
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })

  // Save with compression flags
  const compressed = await pdfDoc.save({
    useObjectStreams:    true,   // pack objects into compressed streams
    addDefaultPage:     false,
    objectsPerTick:     50,
  })

  const blob = new Blob([compressed], { type: 'application/pdf' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'compressed.pdf'
  a.click()
  URL.revokeObjectURL(url)
  return { data: blob }
}
