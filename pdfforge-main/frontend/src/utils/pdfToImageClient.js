/**
 * pdfToImageClient.js — Client-side PDF → Images conversion
 *
 * PHASE 4: PDF to Images (PNG zip) and PDF to JPG (JPG zip)
 * now run 100% in the browser. Zero server calls.
 *
 * Uses:
 *   - pdf.js  (already loaded via CDN in index.html) for rendering
 *   - JSZip   (loaded via CDN) for creating the zip file
 *
 * SETUP — add to index.html <head> (after existing scripts):
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
 *
 * SPEED: A 10-page PDF at 2x scale takes ~3-5 seconds in browser.
 * Each page renders progressively so users see a progress indicator.
 */

function getPdfjs() {
  const lib = window.pdfjsLib
  if (!lib) throw new Error('pdf.js not loaded in index.html')
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }
  return lib
}

function getJSZip() {
  const lib = window.JSZip
  if (!lib) throw new Error(
    'JSZip not loaded. Add to index.html <head>:\n' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>'
  )
  return lib
}

/** Yield to browser between pages so UI stays responsive */
function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** Render one page to a canvas blob */
async function renderPageToBlob(pdfDoc, pageNum, scale, format, quality) {
  const page     = await pdfDoc.getPage(pageNum)
  const viewport = page.getViewport({ scale })
  const canvas   = document.createElement('canvas')
  canvas.width   = Math.floor(viewport.width)
  canvas.height  = Math.floor(viewport.height)

  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport,
  }).promise
  page.cleanup()

  return new Promise(resolve => {
    canvas.toBlob(resolve, format === 'jpeg' ? 'image/jpeg' : 'image/png',
      format === 'jpeg' ? quality : undefined)
  })
}

/**
 * Convert PDF to a ZIP of PNG images.
 * @param {File}     file         - PDF File object
 * @param {Function} onProgress   - called with (current, total) after each page
 * @param {number}   scale        - render scale, 2 = ~144dpi (default)
 */
export async function clientPdfToImages(file, onProgress, scale = 2) {
  const pdfjs   = getPdfjs()
  const JSZip   = getJSZip()

  const buffer  = await file.arrayBuffer()
  const pdfDoc  = await pdfjs.getDocument({ data: buffer }).promise
  const total   = pdfDoc.numPages
  const zip     = new JSZip()

  for (let i = 1; i <= total; i++) {
    const blob = await renderPageToBlob(pdfDoc, i, scale, 'png')
    const arrayBuf = await blob.arrayBuffer()
    zip.file(`page_${i}.png`, arrayBuf)
    onProgress?.(i, total)
    await yieldToBrowser()
  }

  await pdfDoc.destroy()

  // Generate zip and trigger download
  const zipBlob = await zip.generateAsync({
    type:              'blob',
    compression:       'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const url = URL.createObjectURL(zipBlob)
  const a   = document.createElement('a')
  a.href    = url
  a.download = 'pdf_images.zip'
  a.click()
  URL.revokeObjectURL(url)
  return { data: zipBlob }
}

/**
 * Convert PDF to a ZIP of JPG images.
 * @param {File}     file         - PDF File object
 * @param {Function} onProgress   - called with (current, total) after each page
 * @param {number}   scale        - render scale, 2 = ~144dpi (default)
 * @param {number}   quality      - JPEG quality 0-1 (default 0.9)
 */
export async function clientPdfToJpg(file, onProgress, scale = 2, quality = 0.9) {
  const pdfjs   = getPdfjs()
  const JSZip   = getJSZip()

  const buffer  = await file.arrayBuffer()
  const pdfDoc  = await pdfjs.getDocument({ data: buffer }).promise
  const total   = pdfDoc.numPages
  const zip     = new JSZip()

  for (let i = 1; i <= total; i++) {
    const blob = await renderPageToBlob(pdfDoc, i, scale, 'jpeg', quality)
    const arrayBuf = await blob.arrayBuffer()
    zip.file(`page_${i}.jpg`, arrayBuf)
    onProgress?.(i, total)
    await yieldToBrowser()
  }

  await pdfDoc.destroy()

  const zipBlob = await zip.generateAsync({
    type:              'blob',
    compression:       'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const url = URL.createObjectURL(zipBlob)
  const a   = document.createElement('a')
  a.href    = url
  a.download = 'pdf_images_jpg.zip'
  a.click()
  URL.revokeObjectURL(url)
  return { data: zipBlob }
}
