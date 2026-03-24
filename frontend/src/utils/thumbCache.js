/**
 * thumbCache.js — Fast progressive PDF thumbnails (no Web Worker)
 *
 * Uses pdf.js loaded via CDN. Renders pages one by one, yielding to
 * the browser between each page so the UI stays responsive.
 *
 * Pattern:
 *   - First 5 pages render immediately → spinner hides after page 1
 *   - Remaining pages render during idle time (requestIdleCallback)
 *   - IndexedDB caches results → instant on revisit
 *   - In-memory cache → instant within same session
 *
 * REQUIRES index.html <head>:
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
 *
 * SAME API — no changes needed in any page file.
 */

// ── In-memory cache ────────────────────────────────────────────────────
const memCache   = new Map()
const inProgress = new Map()

function fileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`
}

// ── IndexedDB cache (survives page refresh) ────────────────────────────
const DB_NAME = 'pdfforge-thumbs-v2'

async function dbGet(key) {
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1)
      r.onupgradeneeded = e => e.target.result.createObjectStore('thumbs')
      r.onsuccess = e => res(e.target.result)
      r.onerror   = e => rej(e.target.error)
    })
    return new Promise((res, rej) => {
      const req = db.transaction('thumbs','readonly').objectStore('thumbs').get(key)
      req.onsuccess = e => res(e.target.result ?? null)
      req.onerror   = e => rej(e.target.error)
    })
  } catch { return null }
}

async function dbSet(key, value) {
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1)
      r.onupgradeneeded = e => e.target.result.createObjectStore('thumbs')
      r.onsuccess = e => res(e.target.result)
      r.onerror   = e => rej(e.target.error)
    })
    return new Promise((res, rej) => {
      const req = db.transaction('thumbs','readwrite').objectStore('thumbs').put(value, key)
      req.onsuccess = () => res()
      req.onerror   = e => rej(e.target.error)
    })
  } catch {}
}

// ── pdf.js setup ───────────────────────────────────────────────────────
function getPdfjs() {
  const lib = window.pdfjsLib
  if (!lib) throw new Error('pdf.js not loaded in index.html')
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }
  return lib
}

// ── Render one page to base64 PNG ──────────────────────────────────────
async function renderPage(pdfDoc, pageNum, scale = 0.3) {
  const page     = await pdfDoc.getPage(pageNum)
  const viewport = page.getViewport({ scale })
  const canvas   = document.createElement('canvas')
  canvas.width   = Math.floor(viewport.width)
  canvas.height  = Math.floor(viewport.height)
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  const img = canvas.toDataURL('image/jpeg', 0.7)  // JPEG is 3-4x smaller than PNG
  page.cleanup()
  return { page: pageNum, img, width: canvas.width, height: canvas.height }
}

// ── Yield to browser ───────────────────────────────────────────────────
function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function idleYield() {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(resolve, { timeout: 1500 })
    } else {
      setTimeout(resolve, 16)
    }
  })
}

// ── Main export ────────────────────────────────────────────────────────
/**
 * Progressive thumbnails — calls onPageReady(thumb, index) as each page renders.
 * First `priority` pages render immediately. Rest render during idle time.
 *
 * @param {File}     file        - PDF File object
 * @param {Function} onPageReady - called with (thumb, index) after each page
 * @param {number}   priority    - pages to render immediately (default 5)
 */
export async function getThumbnailsProgressive(file, onPageReady, priority = 5) {
  const key = fileKey(file)

  // 1. In-memory hit — instant
  if (memCache.has(key)) {
    memCache.get(key).forEach((t, i) => { if (t?.img) onPageReady(t, i) })
    return memCache.get(key)
  }

  // 2. IndexedDB hit — fast, no re-render
  const cached = await dbGet(key)
  if (cached?.length > 0) {
    memCache.set(key, cached)
    cached.forEach((t, i) => { if (t?.img) onPageReady(t, i) })
    return cached
  }

  // 3. Render fresh
  const pdfjs       = getPdfjs()
  const arrayBuffer = await file.arrayBuffer()
  const pdfDoc      = await pdfjs.getDocument({
    data:             arrayBuffer,
    disableAutoFetch: false,
    disableStream:    false,
  }).promise

  const total  = pdfDoc.numPages
  const thumbs = new Array(total).fill(null)
  memCache.set(key, thumbs)

  // Render priority pages immediately (page 1 first — UI unblocks fast)
  const priorityCount = Math.min(priority, total)
  for (let i = 1; i <= priorityCount; i++) {
    const thumb  = await renderPage(pdfDoc, i, 0.3)
    thumbs[i-1]  = thumb
    onPageReady(thumb, i - 1)
    await yieldToBrowser()   // let browser paint between pages
  }

  // Idle-load remaining pages without blocking UI
  if (priorityCount < total) {
    ;(async () => {
      for (let i = priorityCount + 1; i <= total; i++) {
        await idleYield()
        const thumb = await renderPage(pdfDoc, i, 0.3)
        thumbs[i-1] = thumb
        onPageReady(thumb, i - 1)
      }
      await pdfDoc.destroy()
      await dbSet(key, thumbs)   // save to IndexedDB when all done
    })().catch(console.error)
  } else {
    await pdfDoc.destroy()
    await dbSet(key, thumbs)
  }

  return thumbs
}

/**
 * Standard getThumbnails — backwards compatible.
 */
export async function getThumbnails(file, _axios, _endpoint) {
  const key = fileKey(file)
  if (memCache.has(key)) return memCache.get(key)
  if (inProgress.has(key)) return inProgress.get(key)

  const promise = new Promise(resolve => {
    getThumbnailsProgressive(file, () => {}, 5)
      .then(() => resolve(memCache.get(key)))
  })
  inProgress.set(key, promise)
  promise.then(() => inProgress.delete(key))
  return promise
}

/**
 * Full-res render of a single page (for preview/editing).
 */
export async function getFullResPage(file, pageNum, scale = 1.5) {
  const pdfjs       = getPdfjs()
  const arrayBuffer = await file.arrayBuffer()
  const pdfDoc      = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const thumb       = await renderPage(pdfDoc, pageNum, scale)
  await pdfDoc.destroy()
  return thumb
}

export function isCached(file)    { return memCache.has(fileKey(file)) }
export function clearThumbCache() { memCache.clear() }
export function evictFromCache(f) { memCache.delete(fileKey(f)) }
