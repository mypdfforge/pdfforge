/**
 * editClient.js -- M5a. PDF editing that runs 100% in the browser.
 * No network, no server: the file never leaves the device.
 *
 * Needs window.PDFLib (pdf-lib, loaded in index.html).
 * Previews also need window.pdfjsLib (pdf.js, already used by thumbCache).
 *
 * Big files: pages are processed in chunks of CHUNK with a yield to the
 * browser between chunks (UI stays responsive) and progress is reported via
 * onProgress({ done, total }). Every function returns { data: Blob }.
 */

const CHUNK = 25
// shortcut: pdf-lib keeps the whole document in memory; upgrade to a streaming engine if bigger files are needed
const MAX_BYTES = 250 * 1024 * 1024
const A4 = [595.28, 841.89]
const MAX_IMG_SIDE = 6000

const lib = () => {
  if (!window.PDFLib) throw new Error('pdf-lib is not loaded')
  return window.PDFLib
}
const tick = () => new Promise((r) => setTimeout(r, 0))

/* ---------- loading / saving ---------- */

async function loadDoc(file) {
  if (file.size > MAX_BYTES) {
    throw new Error(`File is too large to edit in the browser (max ${MAX_BYTES / 1048576} MB).`)
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    return await lib().PDFDocument.load(bytes, { updateMetadata: false })
  } catch (e) {
    if (/encrypt/i.test(e.message)) throw new Error('This PDF is password-protected. Unlock it first.')
    throw new Error('Could not read this PDF. It may be damaged - try Repair PDF first.')
  }
}

async function finish(doc) {
  const out = await doc.save({ useObjectStreams: true })
  return { data: new Blob([out], { type: 'application/pdf' }) }
}

/** Run fn(i) for i in [0,n) - yields to the browser every CHUNK items. */
async function eachChunk(n, fn, onProgress) {
  for (let i = 0; i < n; i++) {
    await fn(i)
    if ((i + 1) % CHUNK === 0) {
      onProgress?.({ done: i + 1, total: n })
      await tick()
    }
  }
  onProgress?.({ done: n, total: n })
}

/* ---------- small helpers ---------- */

export function pageSelected(n, total, range) {
  const r = String(range ?? '').trim().toLowerCase()
  if (!r || r === 'all') return true
  if (r === 'odd') return n % 2 === 1
  if (r === 'even') return n % 2 === 0
  if (r === 'first') return n === 1
  if (r === 'last') return n === total
  return r.split(',').some((p) => {
    const t = p.trim()
    if (t.includes('-')) {
      const [a, b] = t.split('-').map(Number)
      return n >= a && n <= b
    }
    return Number(t) === n
  })
}

function hexRgb(hex = '#000000') {
  let h = String(hex).replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = parseInt(h, 16)
  const { rgb } = lib()
  if (Number.isNaN(n)) return rgb(0, 0, 0)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

const rotOf = (page) => ((page.getRotation().angle % 360) + 360) % 360

/**
 * Page geometry in VISUAL space (what the user sees: x right, y down, origin
 * top-left), mapped back to raw PDF space so pages with /Rotate still work.
 */
function geom(page) {
  const box = page.getCropBox()
  const r = rotOf(page)
  const W = box.width, H = box.height
  const sideways = r === 90 || r === 270
  const toRaw = (a, b) => {
    if (r === 90) return { X: box.x + b, Y: box.y + a }
    if (r === 180) return { X: box.x + W - a, Y: box.y + b }
    if (r === 270) return { X: box.x + W - b, Y: box.y + H - a }
    return { X: box.x + a, Y: box.y + H - b }
  }
  return { r, box, vw: sideways ? H : W, vh: sideways ? W : H, toRaw }
}

const caches = new WeakMap()
const cacheOf = (doc) => {
  let c = caches.get(doc)
  if (!c) caches.set(doc, (c = { fonts: new Map(), sprites: new Map() }))
  return c
}

/* ---------- text (vector via standard fonts, raster fallback for any script) ---------- */

async function stdFont(doc, o) {
  const S = lib().StandardFonts
  const f = o.font || 'Helvetica'
  const fam = /courier|mono/i.test(f)
    ? ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique']
    : /times|georgia|serif/i.test(f)
      ? ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic']
      : ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique']
  const name = S[fam[o.bold && o.italic ? 3 : o.bold ? 1 : o.italic ? 2 : 0]]
  const c = cacheOf(doc)
  if (!c.fonts.has(name)) c.fonts.set(name, await doc.embedFont(name))
  return c.fonts.get(name)
}

// Text the standard fonts cannot encode (Hindi, Arabic, CJK...) is drawn through
// the browser's own fonts onto a canvas and embedded as an image: works offline.
async function rasterSprite(doc, text, o) {
  const key = [text, o.font, o.bold, o.italic, o.size, o.colorHex].join('|')
  const c = cacheOf(doc)
  if (c.sprites.has(key)) return c.sprites.get(key)
  const S = 3
  const px = o.size * S
  const cv = document.createElement('canvas')
  const ctx = cv.getContext('2d')
  const family = /courier|mono/i.test(o.font || '')
    ? 'monospace'
    : /times|georgia|serif/i.test(o.font || '')
      ? 'serif'
      : '"Segoe UI","Noto Sans","Nirmala UI",system-ui,sans-serif'
  const font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${px}px ${family}`
  ctx.font = font
  const tw = Math.ceil(ctx.measureText(text).width) + 4
  const th = Math.ceil(px * 1.4)
  cv.width = tw
  cv.height = th
  ctx.font = font
  ctx.fillStyle = o.colorHex || '#000000'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 2, th / 2)
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'))
  const img = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()))
  cv.width = 0
  const sp = { kind: 'r', img, w: tw / S, h: th / S }
  c.sprites.set(key, sp)
  return sp
}

async function makeSprite(doc, text, o) {
  const font = await stdFont(doc, o)
  try {
    const w = font.widthOfTextAtSize(text, o.size) // throws on characters the font cannot encode
    return { kind: 'v', text, font, size: o.size, w, h: o.size * 0.72, colorHex: o.colorHex }
  } catch {
    return rasterSprite(doc, text, o)
  }
}

/**
 * Put a sprite so that its anchor (halign, vertical middle) lands at visual
 * point (a, b), rotated rotCw degrees clockwise as seen on screen.
 */
function placeSprite(page, g, sp, a, b, { halign = 'left', rotCw = 0, opacity = 1 } = {}) {
  const { degrees } = lib()
  const th = g.r - rotCw
  const t = (th * Math.PI) / 180
  const ox = halign === 'center' ? sp.w / 2 : halign === 'right' ? sp.w : 0
  const oy = sp.h / 2
  const A = g.toRaw(a, b)
  const x = A.X - (ox * Math.cos(t) - oy * Math.sin(t))
  const y = A.Y - (ox * Math.sin(t) + oy * Math.cos(t))
  if (sp.kind === 'v') {
    page.drawText(sp.text, { x, y, size: sp.size, font: sp.font, color: hexRgb(sp.colorHex), rotate: degrees(th), opacity })
  } else {
    page.drawImage(sp.img, { x, y, width: sp.w, height: sp.h, rotate: degrees(th), opacity })
  }
}

/** Draw an image whose top-left is at visual (a, b), size w x h. */
function placeImage(page, g, img, a, b, w, h, opacity = 1) {
  const P = g.toRaw(a, b + h)
  page.drawImage(img, { x: P.X, y: P.Y, width: w, height: h, rotate: lib().degrees(g.r), opacity })
}

// Move what was just drawn on this page behind the existing content.
function sendToBack(page) {
  try {
    const ref = page.contentStreamRef
    const arr = page.node.Contents()
    if (!ref || !arr || typeof arr.indexOf !== 'function') return
    const i = arr.indexOf(ref)
    if (i > 0) {
      arr.remove(i)
      arr.insert(0, ref)
    }
  } catch { /* stays on top */ }
}

/* ---------- images ---------- */

function jpegOrientation(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1
  let p = 2
  while (p + 4 < b.length && b[p] === 0xff) {
    const m = b[p + 1]
    const len = (b[p + 2] << 8) | b[p + 3]
    if (m === 0xe1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
      const t = p + 10
      const le = b[t] === 0x49
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1])
      const u32 = (o) => (le
        ? b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16) | (b[t + o + 3] << 24)
        : (b[t + o] << 24) | (b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3])
      const ifd = u32(4)
      const n = u16(ifd)
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12
        if (u16(e) === 0x0112) return u16(e + 8)
      }
      return 1
    }
    p += 2 + len
  }
  return 1
}

/** Embed any browser-readable image. Returns { img, w, h } (pixels). */
async function embedAnyImage(doc, file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  if (isJpg && jpegOrientation(bytes) === 1) {
    const img = await doc.embedJpg(bytes)
    return { img, w: img.width, h: img.height }
  }
  // shortcut: PNGs over 6 MB are re-encoded as JPEG (alpha lost) because decoding them in JS is slow
  if (isPng && bytes.length <= 6 * 1048576) {
    const img = await doc.embedPng(bytes)
    return { img, w: img.width, h: img.height }
  }
  // webp / gif / bmp / phone photos with EXIF rotation / huge PNG: let the browser decode
  const bmp = await createImageBitmap(new Blob([bytes], { type: file.type || 'image/png' }))
  const k = Math.min(1, MAX_IMG_SIDE / Math.max(bmp.width, bmp.height))
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(bmp.width * k))
  cv.height = Math.max(1, Math.round(bmp.height * k))
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, cv.width, cv.height)
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height)
  bmp.close?.()
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92))
  const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()))
  const out = { img, w: img.width, h: img.height }
  cv.width = 0
  return out
}

async function dataUrlImage(doc, dataUrl) {
  const m = /^data:image\/([a-z+]+);base64,(.+)$/is.exec(dataUrl || '')
  if (!m) throw new Error('Invalid image data')
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const img = /jpe?g/i.test(m[1]) ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)
  return { img, w: img.width, h: img.height }
}

/* ======================================================================
 * 1. ROTATE  -- rotations: { pageNumber(1-based): degreesToAdd }
 * ==================================================================== */
export async function clientRotateVisual(file, rotations, onProgress) {
  const { degrees } = lib()
  const doc = await loadDoc(file)
  const pages = doc.getPages()
  await eachChunk(pages.length, (i) => {
    const d = Number(rotations[i + 1] ?? rotations[String(i + 1)] ?? 0)
    if (d) pages[i].setRotation(degrees((((rotOf(pages[i]) + d) % 360) + 360) % 360))
  }, onProgress)
  return finish(doc)
}

/* ======================================================================
 * 2. CROP -- crops: { pageNumber: { left, top, right, bottom } }
 *    values are FRACTIONS (0..1) of the page as displayed.
 * ==================================================================== */
export async function clientCropVisual(file, crops, onProgress) {
  const doc = await loadDoc(file)
  const pages = doc.getPages()
  await eachChunk(pages.length, (i) => {
    const c = crops[i + 1] ?? crops[String(i + 1)]
    if (!c) return
    const g = geom(pages[i])
    const clamp = (v) => Math.min(Math.max(Number(v) || 0, 0), 0.95)
    const L = clamp(c.left) * g.vw, T = clamp(c.top) * g.vh
    const R = clamp(c.right) * g.vw, B = clamp(c.bottom) * g.vh
    // visual margins -> margins in the page's own (unrotated) space
    const [uL, uT, uR, uB] = {
      0: [L, T, R, B], 90: [T, R, B, L], 180: [R, B, L, T], 270: [B, L, T, R],
    }[g.r]
    const w = g.box.width - uL - uR
    const h = g.box.height - uT - uB
    if (w > 10 && h > 10) pages[i].setCropBox(g.box.x + uL, g.box.y + uB, w, h)
  }, onProgress)
  return finish(doc)
}

/* ======================================================================
 * 3. ORGANIZE -- steps: [{ origIdx(0-based), rotation, blank }]
 *
 * Every step is an independent page instance with its own rotation (see the
 * repeated-page copy note inside the function).
 * ==================================================================== */
export async function clientOrganize(file, steps, onProgress) {
  const { PDFDocument, degrees } = lib()
  const src = await loadDoc(file)
  const total = src.getPageCount()
  const out = await PDFDocument.create()
  const base = total ? src.getPage(0).getSize() : { width: A4[0], height: A4[1] }
  const valid = steps.filter((s) => s.blank || (s.origIdx >= 0 && s.origIdx < total))
  // One batched copy for the first use of each source page (keeps shared fonts/resources deduplicated).
  const firstIdx = [...new Set(valid.filter((s) => !s.blank).map((s) => s.origIdx))]
  const firstCopy = new Map()
  if (firstIdx.length) (await out.copyPages(src, firstIdx)).forEach((pg, k) => firstCopy.set(firstIdx[k], pg))
  await eachChunk(valid.length, async (i) => {
    const s = valid[i]
    if (s.blank) { out.addPage([base.width, base.height]); return }
    // A repeated page needs its own copyPages call: within one call pdf-lib returns the SAME page
    // dict for repeated indices, so rotating one copy would rotate all of them.
    let p = firstCopy.get(s.origIdx)
    if (p) firstCopy.delete(s.origIdx)
    else [p] = await out.copyPages(src, [s.origIdx])
    if (s.rotation) p.setRotation(degrees((rotOf(p) + s.rotation) % 360))
    out.addPage(p)
  }, onProgress)
  return finish(out)
}

/* ======================================================================
 * 3b. APPLY PAGE MODIFICATIONS -- pre-processing helper for ToolPage.
 *
 * Compiles soft-deleted pages, per-instance rotations and duplicates into a
 * new PDF using clientOrganize. Returns { data: Blob, map, srcTotal }.
 *
 * Page instances are keyed by instance key: '3' = original page 3,
 * '3-dupe-0' = its first copy. Rotation and deletion are per instance key.
 *
 * @param {File}   file
 * @param {Object} opts
 * @param {Object} opts.pageRotations   - { instanceKey: degreesAdded }
 * @param {Set}    opts.deletedPages    - Set of instanceKeys to leave out
 * @param {Object} opts.duplicatedAfter - { pageNum(1-based): copyCount }
 * @param {number} opts.totalPages      - Total pages in source PDF (optional)
 * @param {Function} [opts.onProgress]
 * ==================================================================== */
export async function applyPageModifications(file, { pageRotations = {}, deletedPages = new Set(), duplicatedAfter = {}, totalPages = 0, onProgress } = {}) {
  if (!totalPages) totalPages = (await loadDoc(file)).getPageCount()
  const steps = []
  const map = {}                         // original page no. -> its page no. in the output
  const add = (key, origIdx) => {
    if (deletedPages.has(key)) return false
    steps.push({ origIdx, rotation: pageRotations[key] || 0, blank: false })
    return true
  }
  for (let pg = 1; pg <= totalPages; pg++) {
    if (add(String(pg), pg - 1)) map[pg] = steps.length
    for (let c = 0; c < (duplicatedAfter[pg] || 0); c++) add(`${pg}-dupe-${c}`, pg - 1)
  }
  const out = await clientOrganize(file, steps, onProgress)
  return { ...out, map, srcTotal: totalPages }
}

/* ======================================================================
 * 4. PAGE NUMBERS
 * ==================================================================== */
async function drawNumbers(doc, o, onProgress, only) {
  const pages = doc.getPages()
  const total = only ? only.total : pages.length
  const from = Math.max(1, Number(o.rangeFrom) || 1)
  const to = o.rangeTo === '' || o.rangeTo == null ? total : Math.min(total, Number(o.rangeTo) || total)
  const first = Number.isFinite(Number(o.firstNum)) ? Number(o.firstNum) : 1
  const margin = 28
  await eachChunk(pages.length, async (i) => {
    const n = only ? only.pageNum : i + 1
    if (n < from || n > to || !pageSelected(n, total, o.pageRange)) return
    const label = String(o.template || '{n}')
      .replaceAll('{n}', String(first + (n - from)))
      .replaceAll('{total}', String(total))
    const g = geom(pages[i])
    const sp = await makeSprite(doc, label, {
      font: o.font, bold: o.bold, italic: o.italic, size: Number(o.fontSize) || 11, colorHex: o.color || '#555555',
    })
    let [row, col] = String(o.position || 'bottom-center').split('-')
    if (o.facingPages && n % 2 === 0) col = col === 'left' ? 'right' : col === 'right' ? 'left' : col
    const a = col === 'left' ? margin : col === 'right' ? g.vw - margin : g.vw / 2
    const b = row === 'top' ? margin + sp.h / 2 : row === 'middle' ? g.vh / 2 : g.vh - margin - sp.h / 2
    placeSprite(pages[i], g, sp, a, b, { halign: col, opacity: o.opacity ?? 1 })
  }, onProgress)
}

export async function clientPageNumbers(file, o, onProgress) {
  const doc = await loadDoc(file)
  await drawNumbers(doc, o, onProgress)
  return finish(doc)
}

// ---- live preview: the real output for one page, rendered with pdf.js ----
const docCache = new WeakMap()

async function renderBytes(bytes, scale = 1.3) {
  const pdfjs = window.pdfjsLib
  if (!pdfjs) throw new Error('pdf.js is not loaded')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }
  const pdf = await pdfjs.getDocument({ data: bytes }).promise
  const page = await pdf.getPage(1)
  const vp = page.getViewport({ scale })
  const cv = document.createElement('canvas')
  cv.width = Math.floor(vp.width)
  cv.height = Math.floor(vp.height)
  await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise
  const url = cv.toDataURL('image/jpeg', 0.88)
  cv.width = 0
  await pdf.destroy()
  return url
}

/** Preview of the first numbered page. Loads the file once and reuses it. */
export async function previewPageNumbers(file, o) {
  let p = docCache.get(file)
  if (!p) { p = loadDoc(file); docCache.set(file, p) }
  const src = await p
  const total = src.getPageCount()
  let idx = 0
  for (let i = 0; i < total; i++) {
    const from = Math.max(1, Number(o.rangeFrom) || 1)
    if (i + 1 >= from && pageSelected(i + 1, total, o.pageRange)) { idx = i; break }
  }
  const one = await lib().PDFDocument.create()
  const [pg] = await one.copyPages(src, [idx])
  one.addPage(pg)
  await drawNumbers(one, o, null, { pageNum: idx + 1, total })
  return renderBytes(await one.save())
}

/* ======================================================================
 * 5. IMAGES -> PDF   (one page per image, fitted to A4, aspect kept)
 * ==================================================================== */
export async function clientImagesToPdf(files, onProgress) {
  if (!files?.length) throw new Error('Add at least one image.')
  const doc = await lib().PDFDocument.create()
  const m = 18
  for (let i = 0; i < files.length; i++) {
    const { img, w, h } = await embedAnyImage(doc, files[i])
    const [pw, ph] = w > h ? [A4[1], A4[0]] : A4
    const s = Math.min((pw - 2 * m) / w, (ph - 2 * m) / h)
    const dw = w * s, dh = h * s
    doc.addPage([pw, ph]).drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh })
    onProgress?.({ done: i + 1, total: files.length })
    await tick()
  }
  return finish(doc)
}

/* ======================================================================
 * 6. WATERMARK
 *    o: { mode, text, font, bold, italic, color, fontSize, position, tiled,
 *         opacity, rotation(deg clockwise), layer('over'|'under'), pageRange }
 * ==================================================================== */
export async function clientWatermark(file, o, imageFile, onProgress) {
  const doc = await loadDoc(file)
  const pages = doc.getPages()
  const total = pages.length
  const isImage = o.mode === 'image'
  if (isImage && !imageFile) throw new Error('Choose a watermark image first.')
  if (!isImage && !String(o.text || '').trim()) throw new Error('Enter the watermark text.')
  const wm = isImage ? await embedAnyImage(doc, imageFile) : null
  const opacity = o.opacity ?? 0.25
  const date = new Date().toISOString().slice(0, 10)

  await eachChunk(total, async (i) => {
    if (!pageSelected(i + 1, total, o.pageRange)) return
    const page = pages[i]
    const g = geom(page)
    if (isImage) {
      const bw = 200, bh = 100, mg = 40
      const k = Math.min(bw / wm.w, bh / wm.h)
      const w = wm.w * k, h = wm.h * k
      const [row, col] = o.tiled ? ['middle', 'center'] : String(o.position || 'middle-center').split('-')
      const bx = col === 'left' ? mg : col === 'right' ? g.vw - mg - bw : (g.vw - bw) / 2
      const by = row === 'top' ? mg : row === 'bottom' ? g.vh - mg - bh : (g.vh - bh) / 2
      placeImage(page, g, wm.img, bx + (bw - w) / 2, by + (bh - h) / 2, w, h, opacity)
    } else {
      const text = String(o.text).replaceAll('{{date}}', date).replaceAll('{{page_number}}', String(i + 1))
      const size = Number(o.fontSize) || 52
      const sp = await makeSprite(doc, text, { font: o.font, bold: o.bold, italic: o.italic, size, colorHex: o.color || '#a0a0a0' })
      if (o.tiled) {
        const sx = g.vw / 3, sy = g.vh / 4
        for (let r = -1; r < 5; r++) {
          for (let c = -1; c < 4; c++) {
            placeSprite(page, g, sp, c * sx + sx / 2, r * sy + sy / 2, { halign: 'center', rotCw: 45, opacity })
          }
        }
      } else {
        const mg = 60
        const [row, col] = String(o.position || 'middle-center').split('-')
        const a = col === 'left' ? mg : col === 'right' ? g.vw - mg : g.vw / 2
        const b = row === 'top' ? mg + size / 2 : row === 'bottom' ? g.vh - mg : g.vh / 2
        placeSprite(page, g, sp, a, b, { halign: col, rotCw: Number(o.rotation) || 0, opacity })
      }
    }
    if (o.layer === 'under') sendToBack(page)
  }, onProgress)
  return finish(doc)
}

/* ======================================================================
 * 7. STAMP -- o: { text, color, position, fontSize, pagesRange, imageDataUrl }
 * ==================================================================== */
export async function clientStamp(file, o, onProgress) {
  const doc = await loadDoc(file)
  const pages = doc.getPages()
  const total = pages.length
  const stampImg = o.imageDataUrl ? await dataUrlImage(doc, o.imageDataUrl) : null
  if (!stampImg && !String(o.text || '').trim()) throw new Error('Enter the stamp text or add a stamp image.')
  const size = Number(o.fontSize) || 18
  const color = o.color || '#555555'
  const mg = 20

  await eachChunk(total, async (i) => {
    if (!pageSelected(i + 1, total, o.pagesRange)) return
    const page = pages[i]
    const g = geom(page)
    const [row, col] = String(o.position || 'top-right').split('-')
    if (stampImg) {
      const bw = 200, bh = 100
      const k = Math.min(bw / stampImg.w, bh / stampImg.h)
      const w = stampImg.w * k, h = stampImg.h * k
      const bx = col === 'left' ? mg : col === 'right' ? g.vw - bw - mg : (g.vw - bw) / 2
      const by = row === 'top' ? mg : row === 'bottom' ? g.vh - bh - mg : (g.vh - bh) / 2
      placeImage(page, g, stampImg.img, bx + (bw - w) / 2, by + (bh - h) / 2, w, h, 1)
      return
    }
    const sp = await makeSprite(doc, String(o.text).trim(), { font: 'Helvetica', bold: true, size, colorHex: color })
    const sw = sp.w + 28, sh = size + 20
    const x = col === 'left' ? mg : col === 'right' ? g.vw - sw - mg : (g.vw - sw) / 2
    const y = row === 'top' ? mg : row === 'bottom' ? g.vh - sh - mg : (g.vh - sh) / 2
    const P = g.toRaw(x, y + sh)
    const c = hexRgb(color)
    page.drawRectangle({
      x: P.X, y: P.Y, width: sw, height: sh, rotate: lib().degrees(g.r),
      color: c, opacity: 0.13, borderColor: c, borderWidth: 2.5, borderOpacity: 1,
    })
    placeSprite(page, g, sp, x + sw / 2, y + sh / 2, { halign: 'center' })
  }, onProgress)
  return finish(doc)
}

/* ======================================================================
 * 8. SIGN -- sigs: [{ page(1-based), x, y, w, h (visual points, top-left origin), dataUrl }]
 * ==================================================================== */
export async function clientSign(file, sigs, onProgress) {
  if (!sigs?.length) throw new Error('Add at least one signature.')
  const doc = await loadDoc(file)
  const pages = doc.getPages()
  const embedded = new Map()
  for (let i = 0; i < sigs.length; i++) {
    const s = sigs[i]
    const page = pages[Math.min(Math.max(1, s.page), pages.length) - 1]
    if (!embedded.has(s.dataUrl)) embedded.set(s.dataUrl, await dataUrlImage(doc, s.dataUrl))
    placeImage(page, geom(page), embedded.get(s.dataUrl).img, s.x, s.y, s.w, s.h, 1)
    onProgress?.({ done: i + 1, total: sigs.length })
  }
  return finish(doc)
}
