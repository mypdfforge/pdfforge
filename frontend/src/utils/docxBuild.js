/**
 * docxBuild.js — turns per-page "models" into a .docx Blob. Runs on the main thread OR inside
 * pdfToWordBuildWorker.js (so the heavy XML/zip serialisation never janks the UI).
 * Pure data in → Blob out. No pdf.js, no DOM.
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ImageRun, ShadingType, TableLayoutType,
  PageOrientation, VerticalAlign, VerticalMergeType, HeightRule,
} from 'docx'
import { wrapUnbrokenStrings } from './pdfLayoutSegmenter.js'
import * as U from './pdfToWordUtils.js'
import { verifyDocxBlob } from './docxVerify.js'
import { buildDocumentNumbering, stripMarker } from './pdfNumbering.js'

const wrap = (t) => { try { return wrapUnbrokenStrings(t) } catch { return t } }
const tw = (pt) => Math.round(pt * 20)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * @param {object[]} models  page models from analyzePage
 * @param {{bodySize:number,title:string,warn:Function,onProgress?:(i:number,n:number)=>void,
 *          yieldFn?:()=>Promise<void>,isAborted?:()=>boolean}} o
 * @returns {Promise<{blob:Blob, packMode:string, modes:string[]}>}
 */
function isEmptyPageModel(m) {
  if (!m || m.mode === 'failed' || m.pageImage || m.images?.length) return false
  return !(m.blocks || []).some((b) => b.type !== 'paragraph' || (b.line?.text && b.line.text.trim()))
}

export async function buildDocxBlob(models, o) {
  const { warn, onProgress, yieldFn, isAborted } = o
  const filtered = models.filter((m) => !isEmptyPageModel(m))
  const activeModels = filtered.length > 0 ? filtered : (models.length > 0 ? [models[0]] : [])
  const numbering = buildDocumentNumbering(activeModels)
  const g = { bodySize: o.bodySize || 11, numbering }
  g.h1 = g.bodySize * 1.45
  g.h2 = g.bodySize * 1.18
  const n = activeModels.length
  const sections = [], modes = []
  for (let i = 0; i < n; i++) {
    if (isAborted?.()) throw U.abortError()
    onProgress?.(i, n)
    const m = activeModels[i]
    try {
      sections.push(buildSection(m, g, 'rich', warn))
      modes.push(m.mode)
    } catch (e) {
      warn(m.pageNum, 'BUILD_FALLBACK', `Page ${m.pageNum}: rich layout failed (${e?.message || e}); used plain text.`)
      try { sections.push(buildSection(m, g, 'plain', warn)); modes.push('plain') }
      catch { sections.push(buildSection(m, g, 'minimal', warn)); modes.push('failed') }
    }
    await yieldFn?.()
  }

  onProgress?.(n, n)
  await yieldFn?.(true)
  let blob = null, packMode = 'rich'
  try {
    blob = await packDocument(sections, o.title, numbering.config)
    if (!(await U.looksLikeZip(blob))) throw new Error('packed file is not a valid zip')
  } catch (e) {
    warn(null, 'PACK_FALLBACK', `Rich packaging failed (${e?.message || e}); rebuilt as plain text.`)
    packMode = 'plain'; blob = null
  }
  if (!blob) {
    try {
      blob = await packDocument(activeModels.map((m) => buildSection(m, g, 'plain', warn)), o.title, numbering.config)
      if (!(await U.looksLikeZip(blob))) throw new Error('invalid zip')
    } catch {
      packMode = 'minimal'
      blob = await packDocument(activeModels.map((m) => buildSection(m, g, 'minimal', warn)), o.title)
    }
  }

  if (blob) {
    try {
      const gate = await verifyDocxBlob(blob)
      if (!gate.ok) {
        warn(null, 'DOCX_VERIFY', 'OpenXML gate: ' + gate.violations.map((v) => v.code + ' ' + v.detail).join('; '))
      }
    } catch {
      // verification error shouldn't crash production if blob is otherwise valid
    }
  }

  return { blob, packMode, modes }
}

// ═════════════════════════════════════════════════════════════════════════════
function pageGeometry(m) {
  const lines = (m.lines || []).filter((l) => Number.isFinite(l.x))
  const xe = (l) => l.xEnd ?? l.x + (l.w || 0)
  const xs0 = lines.map((l) => l.x)
  const xs1 = lines.map(xe)
  for (const b of m.blocks || []) {
    if (Number.isFinite(b.x0)) xs0.push(b.x0)
    if (Number.isFinite(b.x1)) xs1.push(b.x1)
  }
  for (const r of m.vector?.rects || []) {
    if (r.w > 30 && r.x >= 0 && r.x + r.w <= m.w) { xs0.push(r.x); xs1.push(r.x + r.w) }
  }
  const minX = xs0.length ? Math.min(...xs0) : 54
  const maxX = xs1.length ? Math.max(...xs1) : m.w - 54
  const left = clamp(minX, 28, 76)
  const right = clamp(m.w - maxX, 28, 76)
  const top = 48, bottom = 48
  const contentW = Math.max(144, m.w - left - right)
  const contentH = Math.max(144, m.h - top - bottom)
  return { minX, maxX, left, right, top, bottom, contentW, contentH }
}

function buildSection(m, g, mode, warn) {
  const geo = pageGeometry(m)
  let children = []
  if (mode === 'rich') children = buildRichChildren(m, g, geo, warn)
  else if (mode === 'plain') children = buildPlainChildren(m, g, geo)
  else children = [new Paragraph({ children: [new TextRun({ text: U.cleanText((m.lines || []).map((l) => l.text).join(' ')) || `[Page ${m.pageNum}]` })] })]
  if (children.length === 0) children = [new Paragraph({})]

  const wPt = clamp(m.w, 72, 1584), hPt = clamp(m.h, 72, 1584)
  const landscape = wPt > hPt
  return {
    properties: {
      page: {
        size: { width: tw(Math.min(wPt, hPt)), height: tw(Math.max(wPt, hPt)), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: tw(geo.top), bottom: tw(geo.bottom), left: tw(geo.left), right: tw(geo.right) },
      },
    },
    children,
  }
}

function buildPlainChildren(m, g) {
  const lines = m.mode === 'image' ? [] : U.mergePlainLines(m.lines || [])
  const out = lines.map((l) => new Paragraph({ spacing: { after: 70 }, children: [new TextRun({ text: wrap(U.cleanText(l.text)), size: Math.round(clamp(l.size || g.bodySize, 6, 40) * 2) })] }))
  if (m.pageImage) out.push(imageParagraph(m.pageImage, pageGeometry(m)))
  if (out.length === 0) out.push(new Paragraph({ children: [new TextRun({ text: `[Page ${m.pageNum} could not be converted]`, italics: true })] }))
  return out
}

// ─── Rich page ──────────────────────────────────────────────────────────────
function buildRichChildren(m, g, geo, warn) {
  if (m.mode === 'failed') return [new Paragraph({ children: [new TextRun({ text: `[Page ${m.pageNum} could not be converted]`, italics: true })] })]
  if (m.pageImage) return [imageParagraph(m.pageImage, geo)]

  const alignOf = U.makeAlignmentDetector(m.lines || [], g.bodySize)
  const ctx = { g, geo, m, alignOf, warn, numbering: g.numbering }
  const out = []
  const imgs = (m.images || []).slice().sort((a, b) => a.y - b.y)
  let ii = 0
  let blockFailures = 0
  let prevBot = null

  for (const block of m.blocks || []) {
    const top = blockTop(block, m)
    const bot = blockBottom(block, m)
    while (ii < imgs.length && top != null && imgs[ii].y < top) out.push(imageParagraph(imgs[ii++], geo))
    const gapPt = prevBot != null && top != null ? clamp(top - prevBot, 0, 64) : 0
    try {
      out.push(...buildBlock(block, { ...ctx, spaceBeforePt: gapPt > 6 ? gapPt - 4 : 0 }))
    } catch (e) {
      blockFailures++
      const txt = blockPlainText(block)
      if (txt) out.push(new Paragraph({ children: [new TextRun({ text: wrap(U.cleanText(txt)) })] }))
    }
    if (bot != null) prevBot = bot
  }
  while (ii < imgs.length) out.push(imageParagraph(imgs[ii++], geo))
  if (blockFailures) warn(m.pageNum, 'BLOCK_FALLBACK', `Page ${m.pageNum}: ${blockFailures} block(s) fell back to plain text.`, 'info')
  return out
}

function blockTop(block, m) {
  if (Number.isFinite(block.yMax)) return m.topDown ? block.yMax : m.h - block.yMax
  const l = block.line ?? block.lines?.[0] ?? block.col1Lines?.[0]
  const raw = block.y ?? l?.yTop ?? l?.y
  if (!Number.isFinite(raw)) return null
  const sz = l?.size || 10
  return (m.topDown ? raw : m.h - raw) - sz * 0.85
}

function blockBottom(block, m) {
  if (Number.isFinite(block.yMin)) return m.topDown ? block.yMin : m.h - block.yMin
  const l = block.line ?? block.lines?.[block.lines?.length - 1] ?? block.col1Lines?.[block.col1Lines?.length - 1]
  const raw = block.y ?? l?.yBot ?? l?.y
  if (!Number.isFinite(raw)) return null
  const sz = l?.size || 10
  return (m.topDown ? raw : m.h - raw) + sz * 0.25
}

function blockPlainText(b) {
  if (b.line) return b.line.text
  if (b.lines) return b.lines.map((l) => l.text).join(' ')
  if (b.col1Lines) return [...b.col1Lines, ...(b.col2Lines || [])].map((l) => l.text).join(' ')
  if (b.rows) return b.rows.map((r) => r.cells.map((c) => c.text).join('\t')).join('\n')
  return ''
}

function buildBlock(block, ctx) {
  switch (block.type) {
    case 'table': return buildTable(block, ctx)
    case 'columns': return buildColumns(block, ctx)
    case 'callout': return buildCallout(block, ctx)
    case 'code': return buildCode(block, ctx)
    case 'paragraph': {
      const p = paragraphFromLine(block.line, ctx, { spaceBeforePt: ctx.spaceBeforePt })
      return p ? [p] : []
    }
    default: return []
  }
}

// ─── Paragraphs & runs ──────────────────────────────────────────────────────
const BULLET_RE = /^[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\-*\u2013\u2014]\s+/
const NUMBERED_RE = /^(\d+(\.\d+)*[.)]|[a-z][.)]|[ivx]+[.)])\s+/i

function paragraphFromLine(line, ctx, extra = {}) {
  if (!line || !line.text || !line.text.trim()) return null
  const { g, geo, alignOf } = ctx
  const size = line.size || g.bodySize
  let heading
  if (size >= g.h1) heading = HeadingLevel.HEADING_1
  else if (size >= g.h2 || (line.isBold && size > g.bodySize * 1.05 && line.text.length < 100)) heading = HeadingLevel.HEADING_2

  const rtl = !!line.isRTL || U.isMostlyRtl(line.text)
  const al = extra.align || alignOf(line)
  const li = ctx.numbering?.map?.get(line)
  const isList = !!li || BULLET_RE.test(line.text) || NUMBERED_RE.test(line.text)
  const indentPt = Math.max(0, (line.x ?? geo.minX) - geo.minX)
  const indent = {}
  if (!li && (indentPt > 8 || isList)) indent.left = Math.min(tw(indentPt) + (isList ? 360 : 0), Math.round(tw(geo.contentW) * 0.6))
  if (!li && isList) indent.hanging = 360

  const rawSpans = line.spans?.length ? line.spans : [{ text: line.text, size: line.size, bold: line.isBold, italic: line.isItalic }]
  const spans = li ? stripMarker(rawSpans, li.marker) : rawSpans
  const children = spans.flatMap((sp) => runsFromText(sp.text, {
    size: sp.size || size, bold: sp.bold ?? line.isBold, italic: sp.italic ?? line.isItalic,
    strike: sp.strike, underline: sp.underline, sup: sp.superScript, sub: sp.subScript,
    color: sp.color, code: line.isCode, forceRtl: sp.isRTL || line.isRTL,
  }))
  if (children.length === 0) return null

  let alignment
  if (rtl) alignment = al === 'center' ? AlignmentType.CENTER : AlignmentType.START // bidi: START = right edge
  else alignment = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.BOTH }[al] || AlignmentType.LEFT

  return new Paragraph({
    heading, alignment, bidirectional: rtl || undefined, keepNext: heading ? true : undefined,
    numbering: li ? { reference: li.reference, level: li.level } : undefined,
    spacing: {
      before: extra.spaceBeforePt > 0 ? tw(extra.spaceBeforePt) : undefined,
      after: heading ? 160 : isList ? 40 : 70,
      line: line.isCode ? 240 : 276,
    },
    indent: Object.keys(indent).length ? indent : undefined,
    children,
    ...extra.paragraph,
  })
}

const CJK_FONT = (t) => (/[\u3040-\u30FF]/.test(t) ? 'Yu Gothic' : /[\uAC00-\uD7AF]/.test(t) ? 'Malgun Gothic' : 'Microsoft YaHei')

/** Split text by script so every run gets a suitable font + RTL flag. */
function runsFromText(text, o) {
  const clean = U.cleanText(text)
  if (!clean) return []
  const halfPts = Math.round(clamp(o.size || 11, 4, 72) * 2)
  const color = U.visibleColor(o.color)
  return U.segmentByScript(clean).map((seg) => {
    const base = {
      text: o.code ? seg.text : wrap(seg.text),
      bold: !!o.bold, italics: !!o.italic, strike: !!o.strike,
      underline: o.underline ? {} : undefined,
      superScript: !!o.sup, subScript: !!o.sub,
      color, size: halfPts,
    }
    if (o.code) base.font = 'Consolas'
    else if (seg.script === 'rtl') Object.assign(base, { font: 'Arial', rightToLeft: true, boldComplexScript: !!o.bold, italicsComplexScript: !!o.italic, sizeComplexScript: halfPts })
    else if (seg.script === 'cjk') base.font = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: CJK_FONT(seg.text) }
    else if (seg.script === 'deva') Object.assign(base, { font: 'Nirmala UI', boldComplexScript: !!o.bold, sizeComplexScript: halfPts })
    else if (seg.script === 'emoji') base.font = 'Segoe UI Emoji'
    if (o.forceRtl && seg.script === 'latin' && U.isMostlyRtl(clean)) base.rightToLeft = true
    return new TextRun(base)
  })
}

// ─── Tables ─────────────────────────────────────────────────────────────────
const thin = (color = 'BFBFBF', size = 4) => ({ style: BorderStyle.SINGLE, size, color })
const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' }
const allBorders = (b) => ({ top: b, bottom: b, left: b, right: b })
const shade = (fill) => ({ type: ShadingType.CLEAR, fill, color: 'auto' })

function buildTable(block, ctx) {
  const { geo } = ctx
  const numCols = Math.max(1, block.numCols || block.colWidths?.length || 1)
  const rawW = Number.isFinite(block.tableWidth) && block.tableWidth >= 100
    ? clamp(block.tableWidth, 100, geo.contentW)
    : geo.contentW
  const totalTw = tw(rawW)
  let colTw = U.percentToTwips(Array.from({ length: numCols }, (_, i) => block.colWidths?.[i]), totalTw)
  const vt = block.theme?.fromVector ? block.theme : null // never trust keyword-guessed themes
  const hdrBg = U.normHex(vt?.bg) || 'E7E9EE'
  const hdrFg = vt ? (U.normHex(vt.text) || U.contrastText(hdrBg)) : '000000'
  const border = thin(U.normHex(vt?.border) || 'A6A6A6')

  const rows = (block.rows || []).map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) }))
  U.normalizeTableRows(rows, numCols, () => ({ text: '', columnSpan: 1 }))
  // never let a column be narrower than its longest word/number
  const needs = new Array(numCols).fill(0)
  for (const r of rows) {
    let c0 = 0
    for (const c of r.cells) {
      if ((c.columnSpan || 1) === 1) needs[c0] = Math.max(needs[c0], U.cellMinTwips(c.text, c.fontSize || 10))
      c0 += Math.max(1, c.columnSpan || 1)
    }
  }
  colTw = U.fitColumnWidths(colTw, needs)

  const docxRows = rows.map((r, ri) => {
    let col = 0
    const cells = r.cells.map((c) => {
      const span = Math.max(1, c.columnSpan || 1)
      const width = colTw.slice(col, col + span).reduce((a, b) => a + b, 0)
      col += span
      const isHdr = !!(r.isHeader || c.isHeader)
      const text = U.cleanText(c.text)
      const rtl = U.isMostlyRtl(text)
      const jc = c.align === 'right' ? AlignmentType.RIGHT : c.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT
      const runs = runsFromText(text, { size: c.fontSize || 10, bold: c.bold || isHdr, color: isHdr ? hdrFg : undefined })
      return new TableCell({
        width: { size: width, type: WidthType.DXA },
        columnSpan: span > 1 ? span : undefined,
        verticalMerge: c.vMerge === 'restart' ? VerticalMergeType.RESTART
                     : c.vMerge === 'continue' ? VerticalMergeType.CONTINUE : undefined,
        verticalAlign: VerticalAlign.CENTER,
        shading: isHdr ? shade(hdrBg) : (U.normHex(c.fill) ? shade(U.normHex(c.fill)) : undefined),
        borders: allBorders(border),
        margins: { top: 70, bottom: 70, left: 110, right: 110 },
        children: [new Paragraph({
          alignment: rtl ? AlignmentType.START : jc, bidirectional: rtl || undefined,
          spacing: { after: 0, line: 240 },
          children: runs.length ? runs : [new TextRun({ text: '' })],
        })],
      })
    })
    return new TableRow({
      tableHeader: !!r.isHeader || (block.repeatHeader && ri === 0),
      cantSplit: true,
      height: Number.isFinite(r.height) && r.height > 8 ? { value: tw(Math.max(8, r.height - 1)), rule: HeightRule.ATLEAST } : undefined,
      children: cells,
    })
  })

  return [
    new Table({ layout: TableLayoutType.FIXED, width: { size: totalTw, type: WidthType.DXA }, columnWidths: colTw, rows: docxRows }),
    new Paragraph({ spacing: { after: 100 } }),
  ]
}

/** 2-column editorial block → borderless table, or a boxed table if a vector rectangle surrounds it. */
function buildColumns(block, ctx) {
  const { geo, m } = ctx
  const all = [...block.col1Lines, ...block.col2Lines]
  const box = findEnclosingRect(m.vector?.rects, all)
  const frame = box?.stroke ? thin(U.normHex(box.stroke) || 'A6A6A6') : NONE
  const bg = U.luminance(box?.fill) > 0.5 ? U.normHex(box?.fill) : null
  const totalTw = tw(geo.contentW)
  const half = Math.floor(totalTw / 2)

  const mkParas = (ls) => {
    const paras = mergeByLeading(ls).map((l) => paragraphFromLine(l, ctx, { align: 'left' })).filter(Boolean)
    return paras.length ? paras : [new Paragraph({})]
  }
  const cell = (ls, w) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: allBorders(frame), shading: bg ? shade(bg) : undefined,
    margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: mkParas(ls),
  })
  return [
    new Table({
      layout: TableLayoutType.FIXED, width: { size: totalTw, type: WidthType.DXA }, columnWidths: [half, totalTw - half],
      rows: [new TableRow({ cantSplit: false, children: [cell(block.col1Lines, half), cell(block.col2Lines, totalTw - half)] })],
    }),
    new Paragraph({ spacing: { after: 100 } }),
  ]
}

function findEnclosingRect(rects, lines) {
  if (!Array.isArray(rects) || !lines.length) return null
  const xe = (l) => l.xEnd ?? l.x + (l.w || 0)
  const minX = Math.min(...lines.map((l) => l.x)), maxX = Math.max(...lines.map(xe))
  const ys = lines.map((l) => l.y).filter(Number.isFinite)
  if (!ys.length) return null
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const tol = 10
  let best = null
  for (const r of rects) {
    if (!(r.stroke || r.fill) || !(r.w > 60) || !(r.h > 20)) continue
    if (r.x <= minX + tol && r.x + r.w >= maxX - tol && r.y <= minY + tol && r.y + r.h >= maxY - tol) {
      if (!best || U.rectArea(r) < U.rectArea(best)) best = r
    }
  }
  return best
}

/** merge consecutive lines into paragraphs by leading (line gap), not by a fixed 20pt */
function mergeByLeading(lines) {
  const out = []
  for (const l of lines) {
    const prev = out[out.length - 1]
    const lead = 1.55 * Math.max(l.size || 10, prev?.size || 10)
    if (prev && Math.abs((prev.y ?? 0) - (l.y ?? 0)) <= lead && Math.abs((prev.size || 10) - (l.size || 10)) < 1.2) {
      const sep = /-$/.test(prev.text) ? '' : ' '
      prev.text += sep + l.text
      prev.spans = [...(prev.spans || []), { text: sep, size: prev.size }, ...(l.spans?.length ? l.spans : [{ text: l.text, size: l.size, bold: l.isBold, italic: l.isItalic }])]
      prev.y = l.y
    } else out.push({ ...l, spans: l.spans?.length ? [...l.spans] : [{ text: l.text, size: l.size, bold: l.isBold, italic: l.isItalic }] })
  }
  return out
}

function buildCallout(block, ctx) {
  const color = U.normHex(block.admonition?.color) || '64748B'
  const bg = U.normHex(block.admonition?.bg) || 'F1F5F9'
  const paras = block.lines.map((l) => paragraphFromLine(l, ctx, {
    paragraph: {
      border: { left: { style: BorderStyle.SINGLE, size: 24, space: 8, color } },
      shading: shade(bg), indent: { left: 240 }, spacing: { before: 30, after: 30, line: 250 },
    },
  })).filter(Boolean)
  paras.push(new Paragraph({ spacing: { after: 80 } }))
  return paras
}

function buildCode(block, ctx) {
  const minX = Math.min(...block.lines.map((l) => l.x ?? 0))
  const paras = block.lines.map((l) => {
    const pad = ' '.repeat(Math.max(0, Math.round(((l.x ?? minX) - minX) / (0.55 * (l.size || 9)))))
    const runs = runsFromText(pad + l.text, { size: 9, code: true })
    return new Paragraph({
      spacing: { after: 30, line: 240 },
      children: runs.length ? runs : [new TextRun({ text: '' })],
    })
  })
  const totalTw = tw(ctx.geo.contentW)
  return [
    new Table({
      layout: TableLayoutType.FIXED, width: { size: totalTw, type: WidthType.DXA }, columnWidths: [totalTw],
      rows: [new TableRow({ children: [new TableCell({
        width: { size: totalTw, type: WidthType.DXA }, shading: shade('F4F5F7'),
        margins: { top: 100, bottom: 100, left: 160, right: 160 }, borders: allBorders(thin('D0D4DA')),
        children: paras.length ? paras : [new Paragraph({})],
      })] })],
    }),
    new Paragraph({ spacing: { after: 100 } }),
  ]
}

// ─── Images ─────────────────────────────────────────────────────────────────
/** Fit inside the content box, keep aspect ratio, never upscale beyond natural pt size. */
function imageParagraph(img, geo) {
  const pxPerPt = 96 / 72
  let wPt = img.w, hPt = img.h
  const k = Math.min(1, geo.contentW / Math.max(1, wPt), geo.contentH / Math.max(1, hPt))
  wPt *= k; hPt *= k
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 60, after: 120 },
    children: [new ImageRun({
      type: img.type, data: img.data,
      transformation: { width: Math.max(1, Math.round(wPt * pxPerPt)), height: Math.max(1, Math.round(hPt * pxPerPt)) },
      altText: { name: 'PDF image', title: 'PDF image', description: 'Image from the source PDF' },
    })],
  })
}

// ═════════════════════════════════════════════════════════════════════════════
//  PACKAGING
// ═════════════════════════════════════════════════════════════════════════════
async function packDocument(sections, title, numberingConfig) {
  // Heading styles: auto colour (readable in dark mode), no theme-blue.
  const headingStyle = (n, size) => ({
    id: `Heading${n}`, name: `heading ${n}`, basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { bold: true, color: 'auto', size },
    paragraph: { spacing: { before: 200, after: 120 }, keepNext: true },
  })
  const doc = new Document({
    creator: 'PDFForge', title: U.cleanText(title),
    styles: { paragraphStyles: [headingStyle(1, 36), headingStyle(2, 28)] },
    numbering: numberingConfig?.length ? { config: numberingConfig } : undefined,
    sections,
  })
  return Packer.toBlob(doc)
}

