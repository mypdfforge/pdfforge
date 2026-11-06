/**
 * docx2pdfClient.js - Ultra-lightweight on-device Word-to-PDF WASM converter.
 * Runs in-browser via pure Rust WASM (356 KB) with zero external C/C++ dependencies.
 */

import init, { Converter } from '../vendor/docx2pdf/docx2pdf.js'
import wasmUrl from '../vendor/docx2pdf/docx2pdf_bg.wasm?url'

let wasmInitPromise = null
let fontsPromise = null
let cachedFonts = null

const FONT_BASE = '/wasm/docx2pdf/fonts/'

const INDIC_RE = /[\u0900-\u0D7F]/
const CJK_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/
const SYMBOLS_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u

const fallbackFontsCache = new Map()

async function loadFallbackFont(fileName) {
  if (fallbackFontsCache.has(fileName)) {
    return fallbackFontsCache.get(fileName)
  }
  const fetchPromise = (async () => {
    if (typeof window === 'undefined') {
      try {
        const fs = await import('fs')
        const path = await import('path')
        const fontPath = path.resolve('frontend/public/wasm/docx2pdf/fonts', fileName)
        if (fs.existsSync(fontPath)) {
          return new Uint8Array(fs.readFileSync(fontPath))
        }
      } catch {}
    }
    const res = await fetch(`${FONT_BASE}${fileName}`)
    if (!res || !res.ok) {
      console.warn(`Fallback font not found: ${fileName} (${res?.status})`)
      return null
    }
    const buf = await res.arrayBuffer()
    return new Uint8Array(buf)
  })()
  fallbackFontsCache.set(fileName, fetchPromise)
  return fetchPromise
}

/**
 * Initializes the docx2pdf WebAssembly module.
 */
export async function initDocx2Pdf() {
  if (wasmInitPromise) return wasmInitPromise
  wasmInitPromise = init(typeof wasmUrl === 'string' ? wasmUrl : { module_or_path: wasmUrl })
  return wasmInitPromise
}

/**
 * Loads and caches the standard Liberation Sans font variants.
 */
export async function loadStandardFonts() {
  if (fontsPromise) return fontsPromise

  fontsPromise = (async () => {
    const fetchFont = async (fileName) => {
      if (typeof window === 'undefined') {
        // Node / test environment: read from disk if available
        try {
          const fs = await import('fs')
          const path = await import('path')
          const fontPath = path.resolve('node_modules/pdfjs-dist/standard_fonts', fileName)
          if (fs.existsSync(fontPath)) {
            return new Uint8Array(fs.readFileSync(fontPath))
          }
        } catch {
          // fallback to fetch
        }
      }
      const res = await fetch(`${FONT_BASE}${fileName}`)
      if (!res || !res.ok) {
        throw new Error(`Failed to load font: ${fileName} (${res?.status})`)
      }
      const buf = await res.arrayBuffer()
      return new Uint8Array(buf)
    }

    const fetchFontWithFallback = async (primaryName, fallbackName) => {
      try {
        return await fetchFont(primaryName)
      } catch {
        return await fetchFont(fallbackName)
      }
    }

    const [regular, bold, italic, boldItalic] = await Promise.all([
      fetchFontWithFallback('Arial-Regular.ttf', 'LiberationSans-Regular.ttf'),
      fetchFontWithFallback('Arial-Bold.ttf', 'LiberationSans-Bold.ttf'),
      fetchFontWithFallback('Arial-Italic.ttf', 'LiberationSans-Italic.ttf'),
      fetchFontWithFallback('Arial-BoldItalic.ttf', 'LiberationSans-BoldItalic.ttf'),
    ])

    cachedFonts = { regular, bold, italic, boldItalic }
    return cachedFonts
  })()

  return fontsPromise
}

/**
 * Converts a Word document (File, Blob, or ArrayBuffer) into a PDF Blob.
 *
 * @param {File | Blob | ArrayBuffer | Uint8Array} input
 * @param {object} [options]
 * @param {(p: { percent: number, message: string }) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Blob>}
 */
export async function convertDocxToPdf(input, { onProgress, signal } = {}) {
  if (signal?.aborted) throw new Error('Conversion aborted.')

  onProgress?.({ percent: 15, message: 'Initializing converter...' })
  await Promise.all([initDocx2Pdf(), loadStandardFonts()])

  if (signal?.aborted) throw new Error('Conversion aborted.')

  onProgress?.({ percent: 45, message: 'Reading document...' })
  let docxBytes
  if (input instanceof Uint8Array) {
    docxBytes = input
  } else if (input instanceof ArrayBuffer) {
    docxBytes = new Uint8Array(input)
  } else if (input instanceof Blob) {
    const ab = await input.arrayBuffer()
    docxBytes = new Uint8Array(ab)
  } else {
    throw new Error('Unsupported input type for convertDocxToPdf.')
  }

  if (signal?.aborted) throw new Error('Conversion aborted.')

  const converter = new Converter()
  converter.registerFont('regular', cachedFonts.regular)
  converter.registerFont('bold', cachedFonts.bold)
  converter.registerFont('italic', cachedFonts.italic)
  converter.registerFont('bold-italic', cachedFonts.boldItalic)

  // Smart on-demand fallback font loading for Indian scripts and CJK
  let textSample = ''
  try {
    const decoder = new TextDecoder('utf-8', { fatal: false })
    textSample = decoder.decode(docxBytes)
  } catch {}

  const hasIndic = INDIC_RE.test(textSample)
  const hasCjk = CJK_RE.test(textSample)
  const hasSymbols = SYMBOLS_RE.test(textSample)

  if (hasIndic) {
    onProgress?.({ percent: 55, message: 'Loading Indian script font...' })
    try {
      const nirmala = await loadFallbackFont('Nirmala-Regular.ttf')
      if (nirmala) converter.registerFallbackFont(nirmala)
    } catch (e) {
      console.warn('Failed loading Nirmala font:', e)
    }
  }

  if (hasCjk) {
    onProgress?.({ percent: 65, message: 'Loading CJK script font...' })
    try {
      const simsun = await loadFallbackFont('SimSun-Regular.ttf')
      if (simsun) converter.registerFallbackFont(simsun)
    } catch (e) {
      console.warn('Failed loading SimSun font:', e)
    }
  }

  if (hasSymbols) {
    onProgress?.({ percent: 72, message: 'Loading symbols font...' })
    try {
      const segui = await loadFallbackFont('SegoeUISymbol.ttf')
      if (segui) converter.registerFallbackFont(segui)
    } catch (e) {
      console.warn('Failed loading SegoeUISymbol font:', e)
    }
  }

  if (signal?.aborted) throw new Error('Conversion aborted.')

  onProgress?.({ percent: 80, message: 'Converting to PDF...' })
  const pdfBytes = converter.convert(docxBytes)

  onProgress?.({ percent: 100, message: 'Done' })
  return new Blob([pdfBytes], { type: 'application/pdf' })
}
