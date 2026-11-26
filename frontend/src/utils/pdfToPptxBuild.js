/**
 * pdfToPptxBuild.js — turns per-page "models" (from the PDF-to-Word analysis layer)
 * into an editable PowerPoint (.pptx) Blob via PptxGenJS, with OOXML normalization,
 * RTL support, sub/superscript preservation, deep list indentation, code syntax blocks,
 * native form shapes, callout stripes, financial table styling, and semantic timelines.
 */
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import * as U from './pdfToWordUtils.js'
import { wrapUnbrokenStrings } from './pdfLayoutSegmenter.js'
import { buildDocumentNumbering, stripMarker, parseListMarker } from './pdfNumbering.js'

const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const BULLET_RE = /^[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF•●○◦▪■□–—·*‣⁃\-]\s+/
const HIER_NUM_RE = /^(\d+(?:\.\d+)+(?:\.[a-zA-Z])?\.?|\d+\.\d+\.[a-zA-Z]\.?)\s+(.*)$/
const SIMPLE_NUM_RE = /^(\d+[.)]|[a-zA-Z][.)]|[ivxlcdmIVXLCDM]{1,5}[.)])\s+(.*)$/
const CITATION_RE = /^(\[\d+\])\s+(.*)$/
const CURRENCY_NEG_RE = /^\(\s*[$€£¥]?\s*[\d,]+(?:\.\d+)?\s*\)$/
const POS_PCT_RE = /^\+\s*[\d,.]+%$/
const NUMERIC_CELL_RE = /^\(?\s*[$€£¥+\-]?\s*[$€£¥]?\s*[\d,]+(?:\.\d+)?\s*(?:%|\bUSD\b|\bEUR\b|\bGBP\b)?\s*\)?$/i
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
 * Repairs PptxGenJS 4.0.1 OOXML where multiple <a:pPr> tags are emitted inside a single <a:p>.
 * ECMA-376 allows at most one <a:pPr> as the first child of <a:p>; duplicate mid-paragraph
 * <a:pPr> nodes cause PowerPoint to strip inline baseline/sub/sup/RTL run formatting.
 */
export async function normalizePptxXml(blob) {
  try {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const slidePaths = Object.keys(zip.files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    for (const path of slidePaths) {
      const xml = await zip.file(path).async('string')
      const fixed = xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_match, inner) => {
        const pPrMatches = inner.match(/<a:pPr\b[^>]*>(?:[\s\S]*?<\/a:pPr>)?|<a:pPr\b[^>]*\/>/g)
        if (!pPrMatches || pPrMatches.length <= 1) return `<a:p>${inner}</a:p>`
        let firstPPr = pPrMatches[0]
        // Hoist rtl="1" if any pPr inside the paragraph carried it
        if (!/\brtl="1"/.test(firstPPr) && pPrMatches.some((p) => /\brtl="1"/.test(p))) {
          firstPPr = firstPPr.replace('<a:pPr', '<a:pPr rtl="1"')
        }
        const withoutAllPPr = inner.replace(/<a:pPr\b[^>]*>(?:[\s\S]*?<\/a:pPr>)?|<a:pPr\b[^>]*\/>/g, '')
        return `<a:p>${firstPPr}${withoutAllPPr}</a:p>`
      })
      zip.file(path, fixed)
    }
    return await zip.generateAsync({ type: 'blob', mimeType: MIME_PPTX })
  } catch {
    return blob
  }
}

function resolveSlideDims(models, slideLayout = 'auto') {
  if (slideLayout === '16:9') return { layoutName: 'LAYOUT_16x9', width: 10, height: 5.625, custom: false }
  if (slideLayout === '4:3') return { layoutName: 'LAYOUT_4x3', width: 10, height: 7.5, custom: false }

  const first = models.find((m) => m && Number.isFinite(m.w) && Number.isFinite(m.h)) || { w: 720, h: 405 }
  const rawW = first.w / 72
  const rawH = first.h / 72
  let width = clamp(rawW, 4, 20)
  let height = clamp(rawH, 4, 20)
  if (rawW > 20 || rawH > 20) {
    const k = Math.min(20 / rawW, 20 / rawH)
    width = rawW * k
    height = rawH * k
  }
  return { layoutName: 'PDFFORGE_AUTO', width, height, custom: true }
}

function makeTransform(m, slide) {
  const pageW = Math.max(72, m.w || 595.28)
  const pageH = Math.max(72, m.h || 841.89)
  const scale = Math.min(slide.width / pageW, slide.height / pageH)
  const offsetX = (slide.width - pageW * scale) / 2
  const offsetY = (slide.height - pageH * scale) / 2
  const fontScale = clamp(scale * 72, 0.5, 1.35)
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

function hasLongUnbrokenToken(text) {
  return String(text || '').split(/\s+/).some((w) => w.length >= 40)
}

function prepareDisplayText(text, isCode = false) {
  const clean = U.cleanText(text)
  if (!clean || isCode) return clean
  if (hasLongUnbrokenToken(clean)) {
    try { return wrapUnbrokenStrings(clean, 60) } catch { return clean }
  }
  return clean
}

function scriptFont(seg, code = false) {
  if (code) return 'Consolas'
  if (seg.script === 'cjk') return CJK_FONT(seg.text)
  if (seg.script === 'deva') return 'Nirmala UI'
  if (seg.script === 'emoji') return 'Segoe UI Emoji'
  return 'Arial'
}

function toPptxRuns(text, o, fontScale = 1) {
  const clean = prepareDisplayText(text, o.code)
  if (!clean) return []
  const minPt = (o.sup || o.sub) ? 6 : 6.5
  const pt = clamp((o.size || 11) * fontScale, minPt, 72)
  const color = U.normHex(o.color) || '1E293B'
  return U.segmentByScript(clean).map((seg, idx) => {
    const opts = {
      fontSize: Math.round(pt * 10) / 10,
      bold: !!o.bold,
      italic: !!o.italic,
      strike: !!o.strike,
      underline: o.underline ? { style: 'sng' } : undefined,
      superscript: !!o.sup,
      subscript: !!o.sub,
      color,
      fontFace: scriptFont(seg, o.code),
    }
    if (o.rtl || seg.script === 'rtl') opts.rtlMode = true
    if (o.bullet && idx === 0) opts.bullet = o.bullet
    return { text: seg.text, options: opts }
  })
}

/** Cluster distinct list x-offsets on a slide into clean 0..6 indentation levels. */
function buildSlideIndentLevels(m) {
  const map = new Map()
  const listXs = []
  for (const b of m.blocks || []) {
    if (b.type !== 'paragraph' || !b.line) continue
    const l = b.line
    const t = (l.text || '').trim()
    if (l.isListLike || BULLET_RE.test(t) || HIER_NUM_RE.test(t) || SIMPLE_NUM_RE.test(t)) {
      if (Number.isFinite(l.x)) listXs.push(l.x)
    }
  }
  const clusters = []
  for (const x of [...listXs].sort((a, b) => a - b)) {
    const last = clusters[clusters.length - 1]
    if (last != null && Math.abs(x - last) <= 4.5) continue
    clusters.push(x)
  }
  for (const b of m.blocks || []) {
    if (b.type !== 'paragraph' || !b.line) continue
    const l = b.line
    const t = (l.text || '').trim()
    const hier = t.match(HIER_NUM_RE)
    if (hier) {
      const depth = clamp(hier[1].replace(/\.$/, '').split('.').length - 1, 0, 6)
      map.set(l, { kind: 'hier', prefix: hier[1], body: hier[2], level: depth })
      continue
    }
    if (clusters.length > 1 && Number.isFinite(l.x)) {
      const idx = clusters.findIndex((cx) => Math.abs(cx - l.x) <= 4.5)
      if (idx >= 0) map.set(l, { kind: 'xcluster', level: clamp(idx, 0, 6) })
    }
  }
  return map
}

/** Render interactive form lines (checkboxes, radio groups, signature/blank lines) using native PPTX shapes. */
function tryAddFormControl(slide, line, ctx) {
  const text = (line.text || '').trim()
  if (!text) return null
  const { tr, slideDims, cursorY } = ctx
  const topPt = blockTopPt({ line }, ctx.m)
  const y = Math.max(cursorY, topPt != null ? tr.y(topPt) : cursorY)
  const xBase = tr.x(Number.isFinite(line.x) ? line.x : 54)
  const fontSize = Math.round(clamp((line.size || 10) * tr.fontScale, 7.5, 13) * 10) / 10

  // 1. Checkbox row: "[ ] ..." or "[X] ..." or "☐ ..." / "☑ ..."
  const cbMatch = text.match(/^(\[\s*\]|\[[xX]\]|[☐☑])\s+(.*)$/)
  if (cbMatch) {
    const checked = /\[[xX]\]|☑/.test(cbMatch[1])
    const boxSize = 0.16
    slide.addShape('rect', {
      x: xBase,
      y: y + 0.03,
      w: boxSize,
      h: boxSize,
      fill: { color: checked ? 'EA580C' : 'FFFFFF' },
      line: { color: checked ? 'EA580C' : '475569', width: 1.2 },
    })
    if (checked) {
      slide.addText('✓', {
        x: xBase - 0.01,
        y: y + 0.01,
        w: boxSize + 0.02,
        h: boxSize + 0.02,
        fontSize: 9,
        bold: true,
        color: 'FFFFFF',
        align: 'center',
        valign: 'middle',
        margin: 0,
      })
    }
    const labelW = Math.max(1, slideDims.width - (xBase + boxSize + 0.12) - 0.2)
    slide.addText(cbMatch[2], {
      x: xBase + boxSize + 0.1,
      y,
      w: labelW,
      h: 0.26,
      fontSize,
      fontFace: 'Arial',
      color: '1E293B',
      valign: 'middle',
      margin: 1,
      wrap: true,
    })
    return y + 0.3
  }

  // 2. Radio button group: "( ) Overall ... ( ) 1 - Poor ... (X) 4 - Excellent"
  const radioRe = /\(([ xX•●]?)\)\s*([^()]*)/g
  const radioTokens = [...text.matchAll(radioRe)].filter((m) => /\([ xX•●]?\)/.test(m[0]))
  if (radioTokens.length >= 2) {
    let curX = xBase
    let curY = y
    const rowH = 0.26
    for (const tok of radioTokens) {
      const selected = /[xX•●]/.test(tok[1])
      const label = tok[2].trim()
      const estW = 0.24 + Math.min(2.8, Math.max(0.4, label.length * 0.075))
      if (curX + estW > slideDims.width - 0.2) {
        curX = xBase + 0.2
        curY += rowH
      }
      slide.addShape('ellipse', {
        x: curX,
        y: curY + 0.04,
        w: 0.15,
        h: 0.15,
        fill: { color: 'FFFFFF' },
        line: { color: selected ? 'EA580C' : '475569', width: 1.2 },
      })
      if (selected) {
        slide.addShape('ellipse', {
          x: curX + 0.04,
          y: curY + 0.08,
          w: 0.07,
          h: 0.07,
          fill: { color: 'EA580C' },
          line: { color: 'EA580C', width: 0.5 },
        })
      }
      if (label) {
        slide.addText(label, {
          x: curX + 0.19,
          y: curY,
          w: estW - 0.19,
          h: rowH,
          fontSize,
          bold: selected,
          fontFace: 'Arial',
          color: selected ? '0F172A' : '334155',
          valign: 'middle',
          margin: 1,
        })
      }
      curX += estW + 0.08
    }
    return curY + rowH + 0.06
  }

  // 3. Signature / blank underline line: "____..." or "Signature: _____ Date: 2026-10-31"
  if (/^[_─━]{5,}$/.test(text)) {
    const lineW = clamp(slideDims.width - xBase - 0.5, 1.5, 6.5)
    slide.addShape('line', {
      x: xBase,
      y: y + 0.14,
      w: lineW,
      h: 0,
      line: { color: '64748B', width: 1.2 },
    })
    return y + 0.24
  }

  const sigMatch = text.match(/^(.*?:\s*)(_{5,})(.*)$/)
  if (sigMatch) {
    const prefix = sigMatch[1].trim()
    const suffix = sigMatch[3].trim()
    const prefixW = clamp(prefix.length * 0.075 + 0.15, 0.8, 3.2)
    slide.addText(prefix, {
      x: xBase,
      y,
      w: prefixW,
      h: 0.26,
      fontSize,
      bold: true,
      fontFace: 'Arial',
      color: '1E293B',
      valign: 'bottom',
      margin: 1,
    })
    const ruleX = xBase + prefixW + 0.05
    const suffixW = suffix ? clamp(suffix.length * 0.075 + 0.2, 0.8, 2.2) : 0
    const ruleW = clamp(slideDims.width - ruleX - suffixW - 0.4, 1.2, 3.6)
    slide.addShape('line', {
      x: ruleX,
      y: y + 0.22,
      w: ruleW,
      h: 0,
      line: { color: '475569', width: 1.2 },
    })
    if (suffix) {
      slide.addText(suffix, {
        x: ruleX + ruleW + 0.12,
        y,
        w: suffixW,
        h: 0.26,
        fontSize,
        fontFace: 'Arial',
        color: '334155',
        valign: 'bottom',
        margin: 1,
      })
    }
    return y + 0.32
  }

  return null
}

function addParagraphToSlide(slide, line, ctx, opts = {}) {
  if (!line || !line.text || !line.text.trim()) return null
  if (!opts.skipFormControls) {
    const formNextY = tryAddFormControl(slide, line, ctx)
    if (formNextY != null) return formNextY
  }

  const { g, tr, alignOf, numbering, slideIndents, cursorY } = ctx
  const size = line.size || g.bodySize
  const isH1 = size >= g.h1
  const isH2 = !isH1 && (size >= g.h2 || (line.isBold && size > g.bodySize * 1.05 && line.text.length < 100))

  const rtl = !!line.isRTL || U.isMostlyRtl(line.text)
  const al = opts.align || alignOf(line)
  const li = numbering?.map?.get(line)
  const slideIndent = slideIndents?.get(line)
  const trimmed = line.text.trim()

  const isHier = slideIndent?.kind === 'hier'
  const isCitation = CITATION_RE.test(trimmed)
  const isBullet = !isHier && (!!li?.kind && li.kind === 'bullet' || BULLET_RE.test(trimmed) || !!line.isListLike)
  const isSimpleNum = !isHier && !isBullet && SIMPLE_NUM_RE.test(trimmed)

  const rawSpans = line.spans?.length
    ? line.spans
    : [{ text: line.text, size: line.size, bold: line.isBold, italic: line.isItalic }]

  const level = slideIndent?.level ?? li?.level ?? 0
  let bulletOpt
  let spans = rawSpans
  if (isHier) {
    // Keep exact hierarchical outline prefix (1.1, 1.1.1, 1.2.1.a) intact and bolded
    spans = [
      { text: slideIndent.prefix + ' ', size: size, bold: true, color: level === 0 ? '0F172A' : '1E293B' },
      { text: slideIndent.body, size: size, bold: level <= 1 && line.isBold },
    ]
  } else if (isBullet) {
    bulletOpt = true
    spans = li ? stripMarker(rawSpans, li.marker) : rawSpans
  } else if (isSimpleNum && li && !/^Section\s+/i.test(trimmed)) {
    const mNum = trimmed.match(SIMPLE_NUM_RE)
    if (mNum) {
      spans = [
        { text: mNum[1] + ' ', size, bold: true },
        ...stripMarker(rawSpans, li.marker),
      ]
    }
  } else if (isCitation) {
    const cm = trimmed.match(CITATION_RE)
    if (cm) {
      spans = [
        { text: cm[1] + ' ', size, bold: true, color: '1D4ED8' },
        { text: cm[2], size, italic: false },
      ]
    }
  }

  const runs = []
  spans.forEach((sp, idx) => {
    let txt = sp.text
    if (idx === 0 && isBullet && !li) txt = txt.replace(BULLET_RE, '')
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
      rtl,
      bullet: idx === 0 ? bulletOpt : undefined,
    }, tr.fontScale))
  })
  if (!runs.length) return null

  const indentExtraIn = (isHier || isBullet) ? level * 0.22 : (isCitation ? 0.15 : 0)
  const xPt = opts.xPt ?? (Number.isFinite(line.x) ? line.x : 48)
  const baseX = opts.xIn ?? tr.x(xPt)
  const x = clamp(baseX + indentExtraIn, 0.1, ctx.slideDims.width - 1.2)
  const wPt = opts.wPt ?? (Number.isFinite(line.xEnd) && line.xEnd > xPt ? Math.max(line.xEnd - xPt + 24, tr.pageW - xPt - 36) : tr.pageW - xPt - 36)
  const w = clamp(opts.wIn ?? (tr.w(wPt) - indentExtraIn), 0.6, ctx.slideDims.width - x - 0.1)

  const topPt = blockTopPt({ line }, ctx.m)
  const botPt = blockBottomPt({ line }, ctx.m)
  const naturalY = topPt != null ? tr.y(topPt) : cursorY
  const y = Math.max(cursorY, naturalY)

  const hasLong = hasLongUnbrokenToken(trimmed)
  const avgCharIn = ((size * tr.fontScale) / 72) * 0.52
  const charsPerLine = Math.max(12, Math.floor(w / Math.max(0.05, avgCharIn)))
  const plainLen = runs.reduce((s, r) => s + r.text.length, 0)
  const estLines = Math.max(1, Math.ceil(plainLen / charsPerLine))
  const lineHIn = Math.max(0.18, ((size * tr.fontScale * 1.34) / 72))
  const boxH = Math.max(
    botPt != null && topPt != null ? tr.h(botPt - topPt) : 0.22,
    estLines * lineHIn + (hasLong ? 0.1 : 0.04)
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
    fit: hasLong ? 'shrink' : 'none',
    rtlMode: rtl || undefined,
    indentLevel: isBullet ? clamp(level, 0, 6) : 0,
  })
  return y + clampedH + (isBullet || isHier ? 0.03 : 0.05)
}

/** Semantic renderer for Phase 01..05 workflow tables (Slide 12). */
function tryAddWorkflowDiagram(slide, block, ctx, cursorY) {
  const rows = block.rows || []
  if (rows.length < 2) return null
  const isWorkflow = rows.every((r) => /^Phase\s+\d+/i.test((r.cells?.[0]?.text || '').trim()))
  if (!isWorkflow) return null

  const { tr, m, slideDims } = ctx
  const topPt = blockTopPt(block, m)
  let y = Math.max(cursorY, topPt != null ? tr.y(topPt) : cursorY)
  const x = 0.4
  const w = slideDims.width - 0.8
  const cardH = clamp((slideDims.height - y - 0.35) / rows.length - 0.08, 0.48, 0.82)

  const statusPalette = (status) => {
    const s = String(status || '').toUpperCase()
    if (/COMPLETE|DONE|PASS/.test(s)) return { bg: 'DCFCE7', fg: '166534', accent: '10B981' }
    if (/PROGRESS|ACTIVE|RUN/.test(s)) return { bg: 'DBEAFE', fg: '1E40AF', accent: '3B82F6' }
    return { bg: 'F1F5F9', fg: '475569', accent: '94A3B8' }
  }

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].cells || []
    const title = U.cleanText(cells[0]?.text || '')
    const desc = U.cleanText(cells[1]?.text || '')
    const status = U.cleanText(cells[2]?.text || '')
    const pal = statusPalette(status)

    slide.addShape('roundRect', {
      x, y, w, h: cardH,
      rectRadius: 0.08,
      fill: { color: 'F8FAFC' },
      line: { color: 'CBD5E1', width: 0.75 },
    })
    slide.addShape('rect', {
      x, y, w: 0.07, h: cardH,
      fill: { color: pal.accent },
      line: { color: pal.accent, width: 0 },
    })

    const titleW = Math.min(2.15, w * 0.28)
    const statusW = status ? 1.15 : 0
    const descW = Math.max(1.5, w - titleW - statusW - 0.35)

    slide.addText(title, {
      x: x + 0.14, y, w: titleW, h: cardH,
      fontSize: 9.5, bold: true, fontFace: 'Arial', color: '0F172A', valign: 'middle', margin: 3, wrap: true,
    })
    slide.addText(desc, {
      x: x + 0.18 + titleW, y, w: descW, h: cardH,
      fontSize: 9, fontFace: 'Arial', color: '334155', valign: 'middle', margin: 3, wrap: true,
    })
    if (status) {
      const pillH = Math.min(0.28, cardH - 0.14)
      slide.addText(status, {
        x: x + w - statusW - 0.12,
        y: y + (cardH - pillH) / 2,
        w: statusW,
        h: pillH,
        fill: { color: pal.bg },
        line: { color: pal.accent, width: 0.75 },
        fontSize: 8,
        bold: true,
        fontFace: 'Arial',
        color: pal.fg,
        align: 'center',
        valign: 'middle',
        margin: 2,
      })
    }
    if (i < rows.length - 1) {
      slide.addShape('downArrow', {
        x: x + 0.28,
        y: y + cardH + 0.01,
        w: 0.14,
        h: 0.06,
        fill: { color: '94A3B8' },
        line: { color: '94A3B8', width: 0 },
      })
    }
    y += cardH + 0.08
  }
  return y + 0.04
}

/** Semantic renderer for Incident Response Timeline tables (Slide 19). */
function tryAddIncidentTimeline(slide, block, ctx, cursorY) {
  const rows = block.rows || []
  if (rows.length < 2) return null
  const hdrText = (rows[0].cells || []).map((c) => c.text).join(' ')
  if (!/timestamp/i.test(hdrText) || !/severity/i.test(hdrText)) return null

  const { tr, m, slideDims } = ctx
  const topPt = blockTopPt(block, m)
  let y = Math.max(cursorY, topPt != null ? tr.y(topPt) : cursorY)
  const dataRows = rows.slice(1)
  const spineX = 1.68
  const xCard = 1.92
  const wCard = slideDims.width - xCard - 0.35
  const rowH = clamp((slideDims.height - y - 0.25) / dataRows.length - 0.08, 0.48, 0.78)

  const sevColor = (sev) => {
    const s = String(sev || '').toUpperCase()
    if (s.includes('CRITICAL')) return { dot: 'DC2626', bg: 'FEF2F2', fg: '991B1B' }
    if (s.includes('HIGH')) return { dot: 'EA580C', bg: 'FFF7ED', fg: '9A3412' }
    if (s.includes('MEDIUM')) return { dot: 'D97706', bg: 'FFFBEB', fg: '92400E' }
    return { dot: '2563EB', bg: 'EFF6FF', fg: '1E40AF' }
  }

  // Vertical timeline spine
  const totalSpan = dataRows.length * (rowH + 0.08) - 0.08
  slide.addShape('line', {
    x: spineX,
    y: y + rowH / 2,
    w: 0,
    h: Math.max(0.2, totalSpan - rowH),
    line: { color: 'CBD5E1', width: 2 },
  })

  for (const r of dataRows) {
    const c = r.cells || []
    const ts = U.cleanText(c[0]?.text || '')
    const sev = U.cleanText(c[1]?.text || '')
    const desc = U.cleanText(c[2]?.text || '')
    const rem = U.cleanText(c[3]?.text || '')
    const sc = sevColor(sev)

    // Timestamp on left of spine
    slide.addText(ts, {
      x: 0.3,
      y,
      w: spineX - 0.42,
      h: rowH,
      fontSize: 8,
      bold: true,
      fontFace: 'Consolas',
      color: '475569',
      align: 'right',
      valign: 'middle',
      margin: 2,
    })

    // Timeline node dot
    slide.addShape('ellipse', {
      x: spineX - 0.075,
      y: y + rowH / 2 - 0.075,
      w: 0.15,
      h: 0.15,
      fill: { color: sc.dot },
      line: { color: 'FFFFFF', width: 1.5 },
    })

    // Event card on right of spine
    slide.addShape('roundRect', {
      x: xCard,
      y,
      w: wCard,
      h: rowH,
      rectRadius: 0.06,
      fill: { color: sc.bg },
      line: { color: sc.dot, width: 0.75 },
    })

    const badgeW = 0.95
    const bodyW = Math.max(1.5, wCard - badgeW - 0.25)
    slide.addText(sev, {
      x: xCard + 0.08,
      y: y + (rowH - 0.24) / 2,
      w: badgeW,
      h: 0.24,
      fill: { color: sc.dot },
      fontSize: 7.5,
      bold: true,
      fontFace: 'Arial',
      color: 'FFFFFF',
      align: 'center',
      valign: 'middle',
      margin: 1,
    })

    slide.addText([
      { text: desc + (rem ? '\n' : ''), options: { fontSize: 8.5, bold: true, color: sc.fg, fontFace: 'Arial' } },
      ...(rem ? [{ text: `Action: ${rem}`, options: { fontSize: 8, color: '334155', fontFace: 'Arial' } }] : []),
    ], {
      x: xCard + badgeW + 0.16,
      y,
      w: bodyW,
      h: rowH,
      valign: 'middle',
      margin: 3,
      wrap: true,
    })

    y += rowH + 0.08
  }
  return y + 0.04
}

function addTableToSlide(slide, block, ctx, cursorY) {
  const semanticWf = tryAddWorkflowDiagram(slide, block, ctx, cursorY)
  if (semanticWf != null) return semanticWf
  const semanticTl = tryAddIncidentTimeline(slide, block, ctx, cursorY)
  if (semanticTl != null) return semanticTl

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

  // Collapse partial merged header banners where cell[0] has title text and trailing cells are empty
  for (const r of rows) {
    if (r.isHeader && r.cells.length > 1 && r.cells[0].text?.trim()) {
      const restEmpty = r.cells.slice(1).every((c) => !(c.text || '').trim())
      if (restEmpty) {
        r.cells = [{ ...r.cells[0], columnSpan: numCols }]
      }
    }
  }

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
    const rowLabel = (r.cells?.[0]?.text || '').trim()
    const isSummaryRow = /^(gross operating margin|net ebitda margin|total\b)/i.test(rowLabel)
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

      const rawText = U.cleanText(c.text)
      const isRtl = U.isMostlyRtl(rawText)
      const isNum = !isRtl && NUMERIC_CELL_RE.test(rawText)
      const isNegCurrency = CURRENCY_NEG_RE.test(rawText)
      const isPosPct = POS_PCT_RE.test(rawText)
      const isHdr = !!(r.isHeader || c.isHeader)

      const bgHex = isHdr ? hdrBg : (U.normHex(c.fill) || (ri % 2 === 1 ? 'F8FAFC' : 'FFFFFF'))
      let fgHex = isHdr ? hdrFg : U.contrastText(bgHex)
      if (!isHdr) {
        if (isNegCurrency) fgHex = 'B91C1C'
        else if (isPosPct) fgHex = '047857'
      }

      const cellPt = clamp((c.fontSize || 9.5) * tr.fontScale, 6.5, 18)
      const align = isRtl ? 'right' : (isNum ? 'right' : (c.align || 'left'))
      const cellRuns = toPptxRuns(rawText, {
        size: c.fontSize || 9.5,
        bold: !!(c.bold || isHdr || isSummaryRow),
        color: fgHex,
        rtl: isRtl,
      }, tr.fontScale)

      const cellOpts = {
        bold: !!(c.bold || isHdr || isSummaryRow),
        color: fgHex,
        fill: { color: bgHex },
        fontSize: Math.round(cellPt * 10) / 10,
        align,
        valign: 'middle',
        margin: [4, 6, 4, 6],
        rtlMode: isRtl || undefined,
        border: { pt: 0.5, color: borderHex },
      }
      if ((c.columnSpan || 1) > 1) cellOpts.colspan = c.columnSpan
      if (rowspan > 1) cellOpts.rowspan = rowspan

      rowCells.push({
        text: cellRuns.length ? cellRuns : rawText,
        options: cellOpts,
      })
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

  const estRowH = clamp(0.32 * tr.fontScale, 0.24, 0.45)
  return y + Math.max(0.45, rows.length * estRowH) + 0.1
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
  const rawText = (block.lines || []).map((l) => U.cleanText(l.text)).filter(Boolean).join('\n')
  if (!rawText) return cursorY

  const topPt = blockTopPt(block, m)
  const y = Math.max(cursorY, topPt != null ? tr.y(topPt) : cursorY)
  const x = 0.4
  const w = slideDims.width - 0.8
  const estLines = Math.max((block.lines || []).length, Math.ceil(rawText.length / 85))
  const h = clamp(0.22 * estLines + 0.22, 0.48, Math.max(0.48, slideDims.height - y - 0.1))

  // Background card + prominent left accent stripe
  slide.addShape('rect', {
    x, y, w, h,
    fill: { color: bg },
    line: { color: 'E2E8F0', width: 0.75 },
  })
  slide.addShape('rect', {
    x, y, w: 0.07, h,
    fill: { color: accent },
    line: { color: accent, width: 0 },
  })

  const tagMatch = rawText.match(/^(\[[A-Z]+\])\s*([\s\S]*)$/)
  const fontSize = Math.round(clamp(10 * tr.fontScale, 7.5, 13) * 10) / 10
  const runs = tagMatch
    ? [
        { text: tagMatch[1] + ' ', options: { bold: true, color: accent, fontSize, fontFace: 'Arial' } },
        { text: tagMatch[2], options: { bold: false, color: '1E293B', fontSize, fontFace: 'Arial' } },
      ]
    : [{ text: rawText, options: { color: '1E293B', fontSize, fontFace: 'Arial' } }]

  slide.addText(runs, {
    x: x + 0.14,
    y: y + 0.04,
    w: w - 0.22,
    h: h - 0.08,
    margin: 4,
    valign: 'middle',
    wrap: true,
  })
  return y + h + 0.1
}

/** Lightweight syntax token highlighter for code blocks. */
function tokenizeCodeLine(lineText, fontSize) {
  const commentIdx = lineText.indexOf('#')
  const codePart = commentIdx >= 0 ? lineText.slice(0, commentIdx) : lineText
  const commentPart = commentIdx >= 0 ? lineText.slice(commentIdx) : ''
  const runs = []

  const tokenRe = /("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\b(?:def|class|import|from|export|const|let|var|if|elif|else|for|while|with|as|return|raise|try|except|finally|in|not|and|or|True|False|None|await|async)\b|\b\d+(?:\.\d+)?\b)/g
  let last = 0
  for (const m of codePart.matchAll(tokenRe)) {
    if (m.index > last) {
      runs.push({ text: codePart.slice(last, m.index), options: { fontFace: 'Consolas', fontSize, color: 'E2E8F0' } })
    }
    const tok = m[0]
    const color = /^["']/.test(tok) ? '86EFAC' : /^\d/.test(tok) ? 'FCD34D' : '93C5FD'
    runs.push({ text: tok, options: { fontFace: 'Consolas', fontSize, color, bold: color === '93C5FD' } })
    last = m.index + tok.length
  }
  if (last < codePart.length) {
    runs.push({ text: codePart.slice(last), options: { fontFace: 'Consolas', fontSize, color: 'E2E8F0' } })
  }
  if (commentPart) {
    runs.push({ text: commentPart, options: { fontFace: 'Consolas', fontSize, color: '94A3B8', italic: true } })
  }
  return runs
}

function addCodeToSlide(slide, block, ctx, cursorY) {
  const { tr, m, slideDims } = ctx
  const lines = block.lines || []
  if (!lines.length) return cursorY
  const minX = Math.min(...lines.map((l) => l.x ?? 0))
  const fontSize = Math.round(clamp(9.5 * tr.fontScale, 8.5, 12) * 10) / 10

  const allRuns = []
  lines.forEach((l, idx) => {
    const spaces = Math.max(0, Math.round(((l.x ?? minX) - minX) / (0.55 * (l.size || 9))))
    // Non-breaking spaces prevent PowerPoint from collapsing leading indentation
    const pad = '\u00A0'.repeat(spaces)
    const raw = U.cleanText(l.text).replace(/^( +)/, (sp) => '\u00A0'.repeat(sp.length))
    const lineRuns = tokenizeCodeLine(pad + raw, fontSize)
    if (idx < lines.length - 1 && lineRuns.length) {
      lineRuns[lineRuns.length - 1].options.breakLine = true
    }
    allRuns.push(...lineRuns)
  })

  const topPt = blockTopPt(block, m)
  const y = Math.max(cursorY, topPt != null ? tr.y(topPt) : cursorY)
  const x = 0.4
  const w = slideDims.width - 0.8
  const h = clamp(0.19 * lines.length + 0.24, 0.55, Math.min(4.2, slideDims.height - y - 0.1))

  slide.addText(allRuns, {
    x,
    y,
    w,
    h,
    fill: { color: '0F172A' },
    line: { color: '334155', width: 1 },
    fontFace: 'Consolas',
    fontSize,
    color: 'E2E8F0',
    margin: 8,
    valign: 'top',
    wrap: true,
    fit: 'shrink',
  })
  return y + h + 0.1
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

  for (const img of m.images || []) {
    try { addImageToSlide(slide, img, tr) } catch { /* skip broken image */ }
  }

  const alignOf = U.makeAlignmentDetector(m.lines || [], g.bodySize)
  const slideIndents = buildSlideIndentLevels(m)
  const ctx = { g, tr, m, slideDims, alignOf, warn, numbering: g.numbering, slideIndents }
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
  const createDeck = () => {
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
  const pptx = createDeck()

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
    blob = await normalizePptxXml(blob)
  } catch (e) {
    warn?.(null, 'PACK_FALLBACK', `Rich PPTX packaging failed (${e?.message || e}); rebuilt as plain slides.`)
    packMode = 'plain'
    blob = null
  }

  if (!blob) {
    const fallbackPptx = createDeck()
    for (const m of activeModels) {
      populateSlide(fallbackPptx.addSlide(), m, g, slideDims, 'plain', warn)
    }
    blob = await normalizePptxXml(await fallbackPptx.write({ outputType: 'blob' }))
  }

  return { blob, packMode, modes }
}
