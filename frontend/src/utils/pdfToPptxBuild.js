/**
 * pdfToPptxBuild.js — turns per-page "models" (from the PDF-to-Word analysis layer)
 * into an editable PowerPoint (.pptx) Blob via PptxGenJS.
 * Pure data in → Blob out. No pdf.js, no DOM.
 */
import PptxGenJS from 'pptxgenjs'
import * as U from './pdfToWordUtils.js'
import { buildDocumentNumbering, stripMarker } from './pdfNumbering.js'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const BULLET_RE = /^[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\-*\u2013\u2014]\s+/
const NUMBERED_RE = /^(\d+(\.\d+)*[.)]|[a-z][.)]|[ivx]+[.)])\s+/i
const CJK_FONT = (t) => (/[\u3040-\u30FF]/.test(t) ? 'Yu Gothic' : /[\uAC00-\uD7AF]/.test(t) ? 'Malgun Gothic' : 'Microsoft YaHei')

function uint8ToBase64(bytes) {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function imageDataUri(img) {
  const mime = img.type === 'jpg' || img.type === 'jpeg' ? 'image/jpeg' : 'image/png'
  return `data:${mime};base64,${uint8ToBase64(img.data)}`
}

function isEmptyPageModel(m) {
  if (!m || m.mode === 'failed' || m.pageImage || m.images?.length) return false
  return !(m.blocks || []).some((b) => b.type !== 'paragraph' || (b.line?.text && b.line.text.trim()))
}

/**
 * Determine presentation slide dimensions (in inches) from slideLayout option and first page.
 */
function resolveSlideDims(models, slideLayout = 'auto') {
  if (slideLayout === '16:9') return { layoutName: 'LAYOUT_16x9', width: 10, height: 5.625, custom: false }
  if (slideLayout === '4:3') return { layoutName: 'LAYOUT_4x3', width: 10, height: 7.5, custom: false }

  const first = models.find((m) => m && Number.isFinite(m.w) && Number.isFinite(m.h)) || { w: 720, h: 405 }
  const rawW = first.w / 72
  const rawH = first.h / 72
  // PowerPoint supports 1"..56" per side; scale down/up only if outside sane bounds while keeping aspect ratio.
  let width = clamp(rawW, 4, 20)
  let height = clamp(rawH, 4, 20)
  if (rawW > 20 || rawH > 20) {
    const k = Math.min(20 / rawW, 20 / rawH)
    width = rawW * k
    height = rawH * k
  }
  return { layoutName: 'PDFFORGE_AUTO', width, height, custom: true }
}

/** Compute uniform transform mapping PDF page (0..m.w, 0..m.h) onto slide (slideW, slideH). */
function makeTransform(m, slide) {
  const pageW = Math.max(72, m.w || 595.28)
  const pageH = Math.max(72, m.h || 841.89)
  const scale = Math.min(slide.width / pageW, slide.height / pageH)
  const offsetX = (slide.width - pageW * scale) / 2
  const offsetY = (slide.height - pageH * scale) / 2
  const fontScale = clamp(scale * 72, 0.45, 1.35) // 1 PDF pt = 1/72 in
  return {
    pageW,
    pageH,
    scale,
    offsetX,
    offsetY,
    fontScale,
    x: (xPt) => clamp(offsetX + (xPt || 0) * scale, 0.05, slide.width - 0.15),
    y: (yPtTopDown) => clamp(offsetY + (yPtTopDown || 0) * scale, 0.05, slide.height - 0.15),
    w: (wPt) => Math.max(0.25, (wPt || 0) * scale),
    h: (hPt) => Math.max(0.16, (hPt || 0) * scale),
  }
}

function toTopDownY(rawY, m) {
  if (!Number.isFinite(rawY)) return 0
  return m.topDown ? rawY : Math.max(0, (m.h || 841.89) - rawY)
}

function blockTopPt(block, m) {
  if (Number.isFinite(block.yMax)) return toTopDownY(block.yMax, m)
  const l = block.line ?? block.lines?.[0] ?? block.col1Lines?.[0]
  const raw = block.y ?? l?.yTop ?? l?.y
  if (!Number.isFinite(raw)) return null
  const sz = l?.size || 10
  return Math.max(0, toTopDownY(raw, m) - sz * 0.85)
}

function blockBottomPt(block, m) {
  if (Number.isFinite(block.yMin)) return toTopDownY(block.yMin, m)
  const l = block.line ?? block.lines?.[block.lines?.length - 1] ?? block.col1Lines?.[block.col1Lines?.length - 1]
  const raw = block.y ?? l?.yBot ?? l?.y
  if (!Number.isFinite(raw)) return null
  const sz = l?.size || 10
  return toTopDownY(raw, m) + sz * 0.25
}

function toPptxRuns(text, o, fontScale = 1) {
  const clean = U.cleanText(text)
  if (!clean) return []
  const pt = clamp((o.size || 11) * fontScale, 6, 72)
  const color = U.normHex(o.color) || '1E293B'
  return U.segmentByScript(clean).map((seg) => {
    let fontFace = o.code ? 'Consolas' : 'Arial'
    if (!o.code) {
      if (seg.script === 'cjk') fontFace = CJK_FONT(seg.text)
      else if (seg.script === 'deva') fontFace = 'Nirmala UI'
      else if (seg.script === 'emoji') fontFace = 'Segoe UI Emoji'
    }
    const opts = {
      fontSize: Math.round(pt * 10) / 10,
      bold: !!o.bold,
      italic: !!o.italic,
      strike: !!o.strike,
      underline: o.underline ? { style: 'sng' } : undefined,
      superscript: !!o.sup,
      subscript: !!o.sub,
      color,
      fontFace,
    }
    if (o.bullet) opts.bullet = o.bullet
    return { text: seg.text, options: opts }
  })
}

function addParagraphToSlide(slide, line, ctx, opts = {}) {
  if (!line || !line.text || !line.text.trim()) return null
  const { g, tr, alignOf, numbering, cursorY } = ctx
  const size = line.size || g.bodySize
  const isH1 = size >= g.h1
  const isH2 = !isH1 && (size >= g.h2 || (line.isBold && size > g.bodySize * 1.05 && line.text.length < 100))

  const rtl = !!line.isRTL || U.isMostlyRtl(line.text)
  const al = opts.align || alignOf(line)
  const li = numbering?.map?.get(line)
  const isBullet = !!li || BULLET_RE.test(line.text)
  const isNumbered = !li && NUMBERED_RE.test(line.text)

  const rawSpans = line.spans?.length
    ? line.spans
    : [{ text: line.text, size: line.size, bold: line.isBold, italic: line.isItalic }]
  const spans = li ? stripMarker(rawSpans, li.marker) : rawSpans

  let bulletOpt
  if (li) {
    bulletOpt = li.ordered ? { type: 'number' } : true
  } else if (isBullet) {
    bulletOpt = true
  } else if (isNumbered) {
    bulletOpt = { type: 'number' }
  }

  const runs = []
  spans.forEach((sp, idx) => {
    let txt = sp.text
    if (idx === 0 && !li && isBullet) txt = txt.replace(BULLET_RE, '')
    runs.push(...toPptxRuns(txt, {
      size: sp.size || size,
      bold: sp.bold ?? (line.isBold || isH1 || isH2),
      italic: sp.italic ?? line.isItalic,
      strike: sp.strike,
      underline: sp.underline,
      sup: sp.superScript,
      sub: sp.subScript,
      color: sp.color,
      code: line.isCode,
      bullet: idx === 0 ? bulletOpt : undefined,
    }, tr.fontScale))
  })
  if (!runs.length) return null

  const xPt = opts.xPt ?? (Number.isFinite(line.x) ? line.x : 48)
  const wPt = opts.wPt ?? (Number.isFinite(line.xEnd) && line.xEnd > xPt ? Math.max(line.xEnd - xPt + 24, tr.pageW - xPt - 36) : tr.pageW - xPt - 36)
  const x = opts.xIn ?? tr.x(xPt)
  const w = clamp(opts.wIn ?? tr.w(wPt), 0.6, ctx.slideDims.width - x - 0.1)

  const topPt = blockTopPt({ line }, ctx.m)
  const botPt = blockBottomPt({ line }, ctx.m)
  const naturalY = topPt != null ? tr.y(topPt) : cursorY
  const y = Math.max(cursorY, naturalY)

  // Estimate wrapped line count so multi-line blocks get enough vertical room without colliding
  const avgCharIn = ((size * tr.fontScale) / 72) * 0.52
  const charsPerLine = Math.max(12, Math.floor(w / Math.max(0.05, avgCharIn)))
  const plainLen = runs.reduce((s, r) => s + r.text.length, 0)
  const estLines = Math.max(1, Math.ceil(plainLen / charsPerLine))
  const lineHIn = Math.max(0.18, ((size * tr.fontScale * 1.32) / 72))
  const boxH = Math.max(
    botPt != null && topPt != null ? tr.h(botPt - topPt) : 0.22,
    estLines * lineHIn + 0.04
  )
  const clampedH = Math.min(boxH, Math.max(0.2, ctx.slideDims.height - y - 0.08))

  slide.addText(runs, {
    x,
    y,
    w,
    h: clampedH,
    align: rtl ? 'right' : (al === 'justify' ? 'left' : al),
    valign: 'top',
    margin: 2,
    wrap: true,
    rtlMode: rtl || undefined,
    indentLevel: li?.level || 0,
  })
  return y + clampedH + 0.05
}

function addTableToSlide(slide, block, ctx, cursorY) {
  const { tr, m, slideDims } = ctx
  const numCols = Math.max(1, block.numCols || block.colWidths?.length || 1)
  const rawW = Number.isFinite(block.tableWidth) && block.tableWidth >= 100
    ? clamp(block.tableWidth, 100, tr.pageW - 48)
    : tr.pageW - 72
  const slideTableW = clamp(tr.w(rawW), 2, slideDims.width - 0.4)

  const totalTw = Math.round(rawW * 20)
  let colTw = U.percentToTwips(Array.from({ length: numCols }, (_, i) => block.colWidths?.[i]), totalTw)

  const rows = (block.rows || []).map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) }))
  U.normalizeTableRows(rows, numCols, () => ({ text: '', columnSpan: 1 }))

  const needs = new Array(numCols).fill(0)
  for (const r of rows) {
    let c0 = 0
    for (const c of r.cells) {
      if ((c.columnSpan || 1) === 1) needs[c0] = Math.max(needs[c0], U.cellMinTwips(c.text, c.fontSize || 10))
      c0 += Math.max(1, c.columnSpan || 1)
    }
  }
  colTw = U.fitColumnWidths(colTw, needs)
  const colWInches = colTw.map((twVal) => (twVal / totalTw) * slideTableW)

  const vt = block.theme?.fromVector ? block.theme : null
  const hdrBg = U.normHex(vt?.bg) || '1E293B'
  const hdrFg = vt ? (U.normHex(vt.text) || U.contrastText(hdrBg)) : 'FFFFFF'
  const borderHex = U.normHex(vt?.border) || 'CBD5E1'

  // Precompute rowspan lengths for vMerge === 'restart' cells and omit 'continue' cells (PptxGenJS requirement)
  const gridSlots = rows.map((r) => {
    const out = []
    let col = 0
    for (const c of r.cells) {
      out.push({ cell: c, col })
      col += Math.max(1, c.columnSpan || 1)
    }
    return out
  })

  const pptxRows = rows.map((r, ri) => {
    const rowCells = []
    for (const slot of gridSlots[ri]) {
      const c = slot.cell
      if (c.vMerge === 'continue') continue

      let rowspan = c.rowSpan || 1
      if (c.vMerge === 'restart' && rowspan <= 1) {
        let rr = ri + 1
        while (rr < rows.length) {
          const below = gridSlots[rr].find((s) => s.col === slot.col)
          if (below?.cell?.vMerge === 'continue') { rowspan++; rr++ } else break
        }
      }

      const isHdr = !!(r.isHeader || c.isHeader)
      const bgHex = isHdr ? hdrBg : (U.normHex(c.fill) || (ri % 2 === 1 ? 'F8FAFC' : 'FFFFFF'))
      const fgHex = isHdr ? hdrFg : U.contrastText(bgHex)
      const cellPt = clamp((c.fontSize || 9.5) * tr.fontScale, 6, 18)

      const cellOpts = {
        bold: !!(c.bold || isHdr),
        color: fgHex,
        fill: { color: bgHex },
        fontSize: Math.round(cellPt * 10) / 10,
        fontFace: 'Arial',
        align: c.align || 'left',
        valign: 'middle',
        margin: 3,
        border: { pt: 0.5, color: borderHex },
      }
      if ((c.columnSpan || 1) > 1) cellOpts.colspan = c.columnSpan
      if (rowspan > 1) cellOpts.rowspan = rowspan

      rowCells.push({ text: U.cleanText(c.text), options: cellOpts })
    }
    return rowCells.length ? rowCells : [{ text: '' }]
  })

  const topPt = blockTopPt(block, m)
  const x = Number.isFinite(block.x0) ? tr.x(block.x0) : Math.max(0.2, (slideDims.width - slideTableW) / 2)
  const y = Math.max(cursorY, topPt != null ? tr.y(topPt) : cursorY)

  slide.addTable(pptxRows, {
    x,
    y,
    w: slideTableW,
    colW: colWInches,
    autoPage: false,
  })

  const estRowH = clamp(0.28 * tr.fontScale, 0.2, 0.4)
  return y + Math.max(0.4, rows.length * estRowH) + 0.1
}

function addColumnsToSlide(slide, block, ctx, cursorY) {
  const { tr, slideDims, m } = ctx
  const gap = 0.25
  const leftX = 0.35
  const usableW = slideDims.width - leftX * 2
  const colW = (usableW - gap) / 2
  const topPt = blockTopPt(block, m)
  const startY = Math.max(cursorY, topPt != null ? tr.y(topPt) : cursorY)

  let y1 = startY
  for (const l of block.col1Lines || []) {
    const nextY = addParagraphToSlide(slide, l, { ...ctx, cursorY: y1 }, { xIn: leftX, wIn: colW, align: 'left' })
    if (nextY != null) y1 = nextY
  }
  let y2 = startY
  for (const l of block.col2Lines || []) {
    const nextY = addParagraphToSlide(slide, l, { ...ctx, cursorY: y2 }, { xIn: leftX + colW + gap, wIn: colW, align: 'left' })
    if (nextY != null) y2 = nextY
  }
  return Math.max(y1, y2) + 0.08
}

function addCalloutToSlide(slide, block, ctx, cursorY) {
  const { tr, m, slideDims } = ctx
  const accent = U.normHex(block.admonition?.color) || '3B82F6'
  const bg = U.normHex(block.admonition?.bg) || 'F1F5F9'
  const text = (block.lines || []).map((l) => U.cleanText(l.text)).filter(Boolean).join('\n')
  if (!text) return cursorY

  const topPt = blockTopPt(block, m)
  const y = Math.max(cursorY, topPt != null ? tr.y(topPt) : cursorY)
  const x = 0.4
  const w = slideDims.width - 0.8
  const h = clamp(0.22 * Math.max(1, (block.lines || []).length) + 0.16, 0.4, slideDims.height - y - 0.1)

  slide.addText(text, {
    x,
    y,
    w,
    h,
    fill: { color: bg },
    line: { color: accent, width: 1.5 },
    fontSize: Math.round(clamp(10 * tr.fontScale, 7, 14) * 10) / 10,
    fontFace: 'Arial',
    color: '1E293B',
    margin: 6,
    valign: 'middle',
    wrap: true,
  })
  return y + h + 0.08
}

function addCodeToSlide(slide, block, ctx, cursorY) {
  const { tr, m, slideDims } = ctx
  const lines = block.lines || []
  if (!lines.length) return cursorY
  const minX = Math.min(...lines.map((l) => l.x ?? 0))
  const codeText = lines
    .map((l) => {
      const pad = ' '.repeat(Math.max(0, Math.round(((l.x ?? minX) - minX) / (0.55 * (l.size || 9)))))
      return pad + U.cleanText(l.text)
    })
    .join('\n')

  const topPt = blockTopPt(block, m)
  const y = Math.max(cursorY, topPt != null ? tr.y(topPt) : cursorY)
  const x = 0.4
  const w = slideDims.width - 0.8
  const h = clamp(0.18 * lines.length + 0.18, 0.45, Math.min(3.5, slideDims.height - y - 0.1))

  slide.addText(codeText, {
    x,
    y,
    w,
    h,
    fill: { color: 'F4F5F7' },
    line: { color: 'D0D4DA', width: 0.75 },
    fontFace: 'Consolas',
    fontSize: Math.round(clamp(9 * tr.fontScale, 7, 12) * 10) / 10,
    color: '0F172A',
    margin: 6,
    valign: 'top',
    wrap: true,
  })
  return y + h + 0.08
}

function addImageToSlide(slide, img, tr, fullSlide = false, slideDims = null) {
  const data = imageDataUri(img)
  if (fullSlide && slideDims) {
    slide.addImage({ data, x: 0, y: 0, w: slideDims.width, h: slideDims.height, sizing: { type: 'contain', w: slideDims.width, h: slideDims.height } })
    return
  }
  const x = tr.x(img.x)
  const y = tr.y(img.y)
  const w = clamp(tr.w(img.w), 0.25, tr.pageW * tr.scale)
  const h = clamp(tr.h(img.h), 0.25, tr.pageH * tr.scale)
  slide.addImage({ data, x, y, w, h })
}

function populateSlide(slide, m, g, slideDims, mode, warn) {
  const tr = makeTransform(m, slideDims)
  if (mode === 'minimal' || m.mode === 'failed') {
    const fallbackText = U.cleanText((m.lines || []).map((l) => l.text).join(' ')) || `[Slide ${m.pageNum} could not be converted]`
    slide.addText(fallbackText, { x: 0.5, y: 0.5, w: slideDims.width - 1, h: slideDims.height - 1, fontSize: 12, color: '1E293B', valign: 'top', wrap: true })
    return
  }

  if (m.pageImage) {
    addImageToSlide(slide, m.pageImage, tr, true, slideDims)
    return
  }

  if (mode === 'plain') {
    const plainLines = U.mergePlainLines(m.lines || [])
    if (plainLines.length === 0) {
      slide.addText(`[Slide ${m.pageNum}]`, { x: 0.5, y: 0.5, w: slideDims.width - 1, h: 0.5, fontSize: 12, color: '64748B' })
      return
    }
    const text = plainLines.map((l) => U.cleanText(l.text)).filter(Boolean).join('\n')
    slide.addText(text, { x: 0.45, y: 0.4, w: slideDims.width - 0.9, h: slideDims.height - 0.8, fontSize: 11, color: '1E293B', valign: 'top', wrap: true })
    return
  }

  // Optional large vector backgrounds (banners/cards) rendered behind text
  for (const r of (m.vector?.rects || []).slice(0, 12)) {
    if (!r.fill && !r.stroke) continue
    if (r.w < 40 || r.h < 16) continue
    // Skip full-page white backgrounds
    if (r.w > tr.pageW * 0.9 && r.h > tr.pageH * 0.9 && U.normHex(r.fill) === 'FFFFFF') continue
    const topY = toTopDownY(r.y + r.h, m)
    slide.addShape('rect', {
      x: tr.x(r.x),
      y: tr.y(topY),
      w: clamp(tr.w(r.w), 0.2, slideDims.width),
      h: clamp(tr.h(r.h), 0.12, slideDims.height),
      fill: r.fill ? { color: U.normHex(r.fill) || 'FFFFFF' } : undefined,
      line: r.stroke ? { color: U.normHex(r.stroke) || 'CBD5E1', width: clamp(r.lineWidth || 0.75, 0.25, 3) } : undefined,
    })
  }

  // Embedded raster images
  for (const img of m.images || []) {
    try { addImageToSlide(slide, img, tr) } catch { /* skip broken image */ }
  }

  const alignOf = U.makeAlignmentDetector(m.lines || [], g.bodySize)
  const ctx = { g, tr, m, slideDims, alignOf, warn, numbering: g.numbering }
  let cursorY = 0.25
  let blockFailures = 0

  for (const block of m.blocks || []) {
    if (cursorY >= slideDims.height - 0.15) break
    try {
      let nextY = null
      if (block.type === 'table') nextY = addTableToSlide(slide, block, ctx, cursorY)
      else if (block.type === 'columns') nextY = addColumnsToSlide(slide, block, ctx, cursorY)
      else if (block.type === 'callout') nextY = addCalloutToSlide(slide, block, ctx, cursorY)
      else if (block.type === 'code') nextY = addCodeToSlide(slide, block, ctx, cursorY)
      else if (block.type === 'paragraph') nextY = addParagraphToSlide(slide, block.line, { ...ctx, cursorY })
      if (Number.isFinite(nextY)) cursorY = nextY
    } catch {
      blockFailures++
      const txt = U.cleanText(
        block.line?.text ||
        block.lines?.map((l) => l.text).join(' ') ||
        ''
      )
      if (txt) {
        slide.addText(txt, { x: 0.4, y: cursorY, w: slideDims.width - 0.8, h: 0.35, fontSize: 10, color: '1E293B', wrap: true })
        cursorY += 0.4
      }
    }
  }
  if (blockFailures) {
    warn?.(m.pageNum, 'BLOCK_FALLBACK', `Slide ${m.pageNum}: ${blockFailures} block(s) fell back to plain text.`, 'info')
  }
}

/**
 * Builds an editable PowerPoint (.pptx) Blob from analyzed PDF page models.
 * @param {object[]} models
 * @param {{bodySize?:number,title?:string,slideLayout?:'auto'|'16:9'|'4:3',warn?:Function,
 *          onProgress?:(i:number,n:number)=>void,yieldFn?:()=>Promise<void>,isAborted?:()=>boolean,
 *          PptxConstructor?:any}} o
 * @returns {Promise<{blob:Blob, packMode:string, modes:string[]}>}
 */
export async function buildPptxBlob(models, o = {}) {
  const { warn, onProgress, yieldFn, isAborted, PptxConstructor = PptxGenJS } = o
  const filtered = (models || []).filter((m) => !isEmptyPageModel(m))
  const activeModels = filtered.length > 0 ? filtered : (models?.length > 0 ? [models[0]] : [])
  const numbering = buildDocumentNumbering(activeModels)
  const g = { bodySize: o.bodySize || 11, numbering }
  g.h1 = g.bodySize * 1.45
  g.h2 = g.bodySize * 1.18

  const slideDims = resolveSlideDims(activeModels, o.slideLayout || 'auto')
  const createDeck = (packMode) => {
    const pptx = new PptxConstructor()
    pptx.author = 'PDFForge'
    pptx.title = U.cleanText(o.title || 'Converted Presentation')
    if (slideDims.custom) {
      pptx.defineLayout({ name: slideDims.layoutName, width: slideDims.width, height: slideDims.height })
    }
    pptx.layout = slideDims.layoutName
    return pptx
  }

  const n = activeModels.length
  const modes = []
  const pptx = createDeck('rich')

  for (let i = 0; i < n; i++) {
    if (isAborted?.()) throw U.abortError()
    onProgress?.(i, n)
    const m = activeModels[i]
    const slide = pptx.addSlide()
    try {
      populateSlide(slide, m, g, slideDims, 'rich', warn)
      modes.push(m.pageImage ? 'image' : m.mode)
    } catch (e) {
      warn?.(m.pageNum, 'BUILD_FALLBACK', `Slide ${m.pageNum}: rich layout failed (${e?.message || e}); used plain text.`)
      try {
        populateSlide(slide, m, g, slideDims, 'plain', warn)
        modes.push('plain')
      } catch {
        populateSlide(slide, m, g, slideDims, 'minimal', warn)
        modes.push('failed')
      }
    }
    await yieldFn?.()
  }

  onProgress?.(n, n)
  await yieldFn?.(true)

  let blob = null
  let packMode = 'rich'
  try {
    blob = await pptx.write({ outputType: 'blob' })
    if (!(await U.looksLikeZip(blob))) throw new Error('packed file is not a valid zip')
  } catch (e) {
    warn?.(null, 'PACK_FALLBACK', `Rich PPTX packaging failed (${e?.message || e}); rebuilt as plain slides.`)
    packMode = 'plain'
    blob = null
  }

  if (!blob) {
    const fallbackPptx = createDeck('plain')
    for (const m of activeModels) {
      populateSlide(fallbackPptx.addSlide(), m, g, slideDims, 'plain', warn)
    }
    blob = await fallbackPptx.write({ outputType: 'blob' })
  }

  return { blob, packMode, modes }
}
