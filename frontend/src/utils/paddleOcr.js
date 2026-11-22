/**
 * paddleOcr.js
 * High-performance, 100% client-side PaddleOCR (PP-OCRv6) engine using onnxruntime-web and esearch-ocr.
 * Runs completely in-browser with zero server upload.
 */

import { init } from 'esearch-ocr'
import * as ort from 'onnxruntime-web'

let ocrEnginePromise = null

// Helper to fetch model with caching in CacheStorage
async function fetchWithCache(url, onProgress, stepLabel) {
  const cacheName = 'pdfforge-ocr-models-v1'
  let cache = null
  try {
    if (typeof caches !== 'undefined') {
      cache = await caches.open(cacheName)
      const matched = await cache.match(url)
      if (matched) {
        if (onProgress) onProgress({ loaded: 1, total: 1, label: `${stepLabel} (cached)` })
        return await matched.arrayBuffer()
      }
    }
  } catch (err) {
    console.warn('CacheStorage not available or blocked, falling back to network fetch', err)
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`)
  }

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0
  let loaded = 0

  const reader = response.body ? response.body.getReader() : null

  if (!reader) {
    const buffer = await response.arrayBuffer()
    if (cache) {
      try { await cache.put(url, new Response(buffer.slice(0))) } catch (e) { /* ignore */ }
    }
    return buffer
  }

  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    if (onProgress && total > 0) {
      onProgress({ loaded, total, label: `${stepLabel} (${Math.round((loaded / total) * 100)}%)` })
    }
  }

  const allChunks = new Uint8Array(loaded)
  let position = 0
  for (const chunk of chunks) {
    allChunks.set(chunk, position)
    position += chunk.length
  }

  if (cache) {
    try {
      await cache.put(url, new Response(allChunks.slice(0)))
    } catch (e) {
      /* ignore */
    }
  }

  return allChunks.buffer
}

/**
 * Initializes and caches the singleton PaddleOCR engine.
 */
export async function getPaddleOCREngine(onProgress) {
  if (ocrEnginePromise) return ocrEnginePromise

  ocrEnginePromise = (async () => {
    // Configure ONNX Runtime Web WASM paths
    if (ort?.env?.wasm) {
      ort.env.wasm.wasmPaths = '/wasm/'
      ort.env.wasm.numThreads = Math.min(4, typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 2) : 2)
    }

    if (onProgress) onProgress({ loaded: 0, total: 100, label: 'Downloading text detector model (~1.7 MB)…' })
    const detBuffer = await fetchWithCache('/models/ocr/det.onnx', onProgress, 'Text detector')

    if (onProgress) onProgress({ loaded: 0, total: 100, label: 'Downloading text recognizer model (~4.4 MB)…' })
    const recBuffer = await fetchWithCache('/models/ocr/rec.onnx', onProgress, 'Text recognizer')

    if (onProgress) onProgress({ loaded: 0, total: 100, label: 'Loading character dictionary…' })
    const dictBuffer = await fetchWithCache('/models/ocr/dict.txt', onProgress, 'Dictionary')
    const decoder = new TextDecoder('utf-8')
    const dictText = decoder.decode(dictBuffer)

    if (onProgress) onProgress({ loaded: 100, total: 100, label: 'Initializing neural engine…' })

    const engine = await init({
      det: {
        input: new Uint8Array(detBuffer),
        ratio: 1.0,
      },
      rec: {
        input: new Uint8Array(recBuffer),
        decodeDic: dictText,
        optimize: { space: true },
      },
      ort,
    })

    return engine
  })().catch(err => {
    ocrEnginePromise = null
    throw err
  })

  return ocrEnginePromise
}

/**
 * Runs PaddleOCR on an ImageData object from a rendered PDF page canvas.
 */
export async function processPageOcr(engine, imageData) {
  const result = await engine.ocr(imageData)

  // Paragraph text
  let paragraphText = ''
  if (result.parragraphs && result.parragraphs.length > 0) {
    paragraphText = result.parragraphs.map(p => p.text).join('\n\n')
  } else if (result.src && result.src.length > 0) {
    paragraphText = result.src.map(s => s.text).join('\n')
  }

  // Raw lines with exact quadrilateral bounding boxes
  const lines = (result.src || []).map(item => ({
    text: item.text,
    mean: item.mean,
    box: item.box, // [[x0,y0], [x1,y1], [x2,y2], [x3,y3]]
  }))

  return {
    text: paragraphText,
    lines,
    canvasWidth: imageData.width,
    canvasHeight: imageData.height,
  }
}

/**
 * Builds a Searchable PDF by overlaying invisible transparent text
 * over the original scanned PDF with accurate bounding box positions.
 */
export async function buildSearchablePdf(originalPdfBytes, pagesResults) {
  const { PDFDocument, rgb, StandardFonts } = await import('@cantoo/pdf-lib')
  const pdfDoc = await PDFDocument.load(originalPdfBytes, { ignoreEncryption: true })
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const totalPages = pdfDoc.getPageCount()

  for (let p = 0; p < totalPages; p++) {
    const pageResult = pagesResults[p]
    if (!pageResult || !pageResult.lines || pageResult.lines.length === 0) continue

    const pdfPage = pdfDoc.getPage(p)
    const { width: pdfWidth, height: pdfHeight } = pdfPage.getSize()
    const { canvasWidth, canvasHeight, lines } = pageResult

    const scaleX = pdfWidth / canvasWidth
    const scaleY = pdfHeight / canvasHeight

    for (const line of lines) {
      if (!line.text || !line.text.trim()) continue
      const box = line.box
      if (!box || box.length < 4) continue

      // PaddleOCR box: [0]=TL, [1]=TR, [2]=BR, [3]=BL
      const blX = box[3][0] * scaleX
      const blY = pdfHeight - (box[3][1] * scaleY)
      const boxHeight = Math.abs(box[3][1] - box[0][1]) * scaleY
      const fontSize = Math.max(4, Math.min(boxHeight * 0.85, 36))

      try {
        pdfPage.drawText(line.text, {
          x: Math.max(0, blX),
          y: Math.max(0, blY),
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          opacity: 0, // 100% invisible but completely selectable & searchable!
        })
      } catch (err) {
        // Some glyphs may not exist in WinAnsiEncoding; strip unsupported characters
        try {
          const sanitizedText = line.text.replace(/[^\x20-\x7E]/g, ' ')
          if (sanitizedText.trim()) {
            pdfPage.drawText(sanitizedText, {
              x: Math.max(0, blX),
              y: Math.max(0, blY),
              size: fontSize,
              font,
              color: rgb(0, 0, 0),
              opacity: 0,
            })
          }
        } catch (e) {
          // ignore glyph rendering errors for specific lines
        }
      }
    }
  }

  const modifiedPdfBytes = await pdfDoc.save()
  return modifiedPdfBytes
}
