/**
 * pdfToPptxPipeline.js — hardened, per-page-isolated PDF → .pptx converter.
 * 100% client-side. Reuses the PDF-to-Word analysis layer (analyzePage, table stitching,
 * vector extraction, image extraction, abortable/timeout watchdogs, and memory budgets)
 * plus PPTX-specific normalization for code blocks, deep lists, and visual-order RTL.
 */
import {
  analyzePage,
  renderPageCanvas,
  canvasToImage,
  releaseCanvas,
  ANALYZE_DEFAULTS,
} from './pdfToWordPipeline.js'
import { buildPptxBlob } from './pdfToPptxBuild.js'
import * as U from './pdfToWordUtils.js'

export { ConversionError } from './pdfToWordUtils.js'

const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const VISUAL_RTL_CLUE_RE = /(?:^|[\s,(])[ךםןףץ][\u0590-\u05FF]|(?:^|[\s,(])[ًٌٍةى][\u0600-\u06FF]/

/**
 * Restores pre-reversed visual-order RTL strings (e.g. from PDF generators that emit
 * Arabic/Hebrew glyphs left-to-right) back into logical reading order.
 */
export function restoreVisualRtlText(text, pageLines = null) {
  if (!text || !U.isMostlyRtl(text) || !VISUAL_RTL_CLUE_RE.test(text)) return text

  const reverseLine = (s) => {
    const mirror = { '(':')', ')':'(', '[':']', ']':'[', '{':'}', '}':'{' }
    // Reverse character order across RTL segments while keeping embedded ASCII numbers/words intact
    const chars = [...s.trim()].reverse()
    let out = chars.join('')
    // Un-reverse embedded LTR/digit runs that were flipped by full-string reversal
    out = out.replace(/[A-Za-z0-9][A-Za-z0-9.,:/_@#%+\-]*[A-Za-z0-9]|[A-Za-z0-9]/g, (m) =>
      m.length > 1 ? [...m].reverse().join('') : m
    )
    // Fix mirrored parentheses/brackets after reversal
    out = out.replace(/[()[\]{}]/g, (ch) => mirror[ch] || ch)
    return out
  }

  // If the cell text spans multiple original PDF lines, extract RTL runs per PDF line in top-to-bottom order
  if (Array.isArray(pageLines) && pageLines.length > 0) {
    const rtlRuns = []
    const orderedLines = [...pageLines].sort((a, b) => (b.y ?? 0) - (a.y ?? 0))
    for (const l of orderedLines) {
      if (!l.text) continue
      // Extract RTL-dominant spans/chunks from lines that may also contain other columns
      const matches = l.text.match(/[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF][^\nA-Za-z]{2,}/g) || []
      for (const m of matches) {
        const seg = m.trim()
        if (seg.length >= 3 && text.includes(seg) && !rtlRuns.includes(seg)) {
          rtlRuns.push(seg)
        }
      }
    }
    if (rtlRuns.length > 1) {
      const joined = rtlRuns.map((seg) => reverseLine(seg)).join(' ')
      if (joined.length >= text.length * 0.7) return joined
    }
  }

  return reverseLine(text)
}

function repairBrokenLongTokens(text) {
  if (!text || text.length < 40) return text
  let out = text
  if (/https?:\/\//i.test(out)) {
    let prev
    do {
      prev = out
      out = out.replace(/(https?:\/\/\S*?)\s+([a-z0-9\-_./?&=+%]+)/gi, (m, left, right) => {
        if (/[/?&=_-]$/.test(left) || /[/?&=._]/.test(right) || right.length >= 20) return left + right
        return m
      })
    } while (out !== prev)
  }
  out = out.replace(/([A-Za-z0-9+/]{30,})\s+([A-Za-z0-9+/=]{16,})/g, '$1$2')
  return out
}

/**
 * Coalesces shattered code blocks and splits accidentally merged list-item paragraphs
 * without altering the shared PDF-to-Word segmentation modules.
 */
export function normalizeModelForPptx(m) {
  if (!m || m.mode === 'failed' || m.pageImage || !Array.isArray(m.blocks)) return m

  // 0. Repair PDF line-wrap spaces inside long URLs and Base64 strings
  for (const b of m.blocks) {
    if (b.type === 'paragraph' && b.line && !b.line.isCode) {
      const fixed = repairBrokenLongTokens(b.line.text)
      if (fixed !== b.line.text) {
        b.line.text = fixed
        if (Array.isArray(b.line.spans) && b.line.spans.length) {
          b.line.spans = [{ ...b.line.spans[0], text: fixed }]
        }
      }
    }
  }

  // 1. Restore visual-order RTL inside table cells first (using unmutated m.lines for line boundaries)
  for (const b of m.blocks) {
    if (b.type === 'table' && Array.isArray(b.rows)) {
      for (const r of b.rows) {
        for (const c of r.cells || []) {
          if (c.text && VISUAL_RTL_CLUE_RE.test(c.text)) {
            c.text = restoreVisualRtlText(c.text, m.lines)
          }
        }
      }
    }
  }

  // 2. Restore visual-order RTL in lines
  for (const l of m.lines || []) {
    if (l.text && VISUAL_RTL_CLUE_RE.test(l.text)) {
      l.text = restoreVisualRtlText(l.text)
      if (Array.isArray(l.spans) && l.spans.length === 1) l.spans[0].text = l.text
    }
  }

  // 3. Coalesce fragmented code blocks (when wrapped/commented lines lost isCode)
  const blocks = []
  const rawBlocks = m.blocks
  let i = 0
  while (i < rawBlocks.length) {
    const b = rawBlocks[i]
    if (b.type === 'code') {
      // Find the furthest code block connected via small-font non-section/non-checkbox lines
      let endIdx = i
      for (let j = i + 1; j < rawBlocks.length; j++) {
        const nb = rawBlocks[j]
        if (nb.type === 'code') { endIdx = j; continue }
        if (nb.type === 'paragraph' && nb.line) {
          const t = (nb.line.text || '').trim()
          const sz = nb.line.size || 10
          if (sz <= 10.5 && !/^Section\s+\d+/i.test(t) && !nb.line.checkbox && !nb.line.admonition) {
            continue
          }
        }
        break
      }

      if (endIdx > i) {
        const codeLines = []
        for (let k = i; k <= endIdx; k++) {
          const kb = rawBlocks[k]
          if (kb.type === 'code') codeLines.push(...(kb.lines || []))
          else if (kb.type === 'paragraph' && kb.line) codeLines.push(kb.line)
        }
        // Re-join sub-lines that share the same PDF y coordinate (split by column detector)
        const byY = []
        const sorted = [...codeLines].sort((a, b) => (b.y ?? 0) - (a.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
        for (const cl of sorted) {
          const last = byY[byY.length - 1]
          if (last && Math.abs((last.y ?? 0) - (cl.y ?? 0)) <= 2.5) {
            last.parts.push(cl)
          } else {
            byY.push({ y: cl.y, parts: [cl] })
          }
        }
        const rebuiltLines = byY.map((row) => {
          row.parts.sort((a, b) => (a.x ?? 0) - (b.x ?? 0))
          const first = row.parts[0]
          let text = ''
          let prevEnd = first.x ?? 0
          for (let pi = 0; pi < row.parts.length; pi++) {
            const part = row.parts[pi]
            if (pi > 0) {
              const gap = Math.max(1, Math.round(((part.x ?? prevEnd) - prevEnd) / 4.8))
              text += ' '.repeat(Math.min(gap, 16))
            }
            text += (part.text || '').trim()
            prevEnd = part.xEnd ?? ((part.x ?? 0) + (part.text?.length || 0) * 5)
          }
          return { ...first, text, isCode: true }
        })
        blocks.push({ type: 'code', lines: rebuiltLines })
        i = endIdx + 1
        continue
      }
    }

    // 3. Split merged multi-item list paragraphs (e.g., 7-level bullet hierarchy with wide vertical gaps)
    if (b.type === 'paragraph' && b.line && Array.isArray(b.line.spans) && b.line.spans.length >= 4) {
      const yTop = b.line.yTop ?? b.line.y
      const yBot = b.line.yBot ?? b.line.y
      const lo = Math.min(yTop, yBot) - 2
      const hi = Math.max(yTop, yBot) + 2
      const matching = (m.lines || [])
        .filter((l) => Number.isFinite(l.y) && l.y >= lo && l.y <= hi && (l.text || '').trim())
        .sort((a, b2) => b2.y - a.y)
      if (matching.length >= 4) {
        const gaps = []
        for (let gi = 1; gi < matching.length; gi++) {
          gaps.push(Math.abs(matching[gi - 1].y - matching[gi].y))
        }
        const minGap = Math.min(...gaps)
        const sz = b.line.size || 10
        const hasPeriodEndings = matching.filter((l) => /\.\s*$/.test(l.text.trim())).length
        // Wide vertical line gap (>= 1.85x font size) + unpunctuated items indicates list items, not wrapped prose
        if (minGap >= sz * 1.85 && hasPeriodEndings <= Math.floor(matching.length * 0.25)) {
          for (const ml of matching) {
            blocks.push({ type: 'paragraph', line: { ...ml, isListLike: true } })
          }
          i++
          continue
        }
      }
    }

    // 3b. Split merged cross-reference / bullet entries (e.g. "• Table 4.1: ... • Table 5.1: ...")
    if (b.type === 'paragraph' && b.line && !b.line.isCode) {
      const txt = b.line.text || ''
      const refMatches = [...txt.matchAll(/(?:•\s*)?(?:Table|Figure|Listing)\s+\d+\.\d+:[\s\S]*?(?=(?:•\s*)?(?:Table|Figure|Listing)\s+\d+\.\d+:|$)/g)]
        .map((m2) => m2[0].trim())
        .filter(Boolean)
      if (refMatches.length > 1) {
        refMatches.forEach((part, idx) => {
          blocks.push({
            type: 'paragraph',
            line: {
              ...b.line,
              text: part,
              spans: [{ text: part, size: b.line.size, bold: b.line.isBold, italic: b.line.isItalic }],
              y: (b.line.y ?? 0) - idx * 14,
              isListLike: true,
            },
          })
        })
        i++
        continue
      }
    }

    // 3c. Re-attach orphan continuation lines to legal clauses (e.g. "14.1 ..." + "Section 8 (Data Confidentiality).")
    if (
      b.type === 'paragraph' &&
      b.line &&
      blocks.length > 0 &&
      blocks[blocks.length - 1].type === 'paragraph' &&
      /^\d+\.\d+\s+[A-Z]/.test((blocks[blocks.length - 1].line?.text || '').trim())
    ) {
      const curTxt = (b.line.text || '').trim()
      if (
        curTxt.length <= 80 &&
        !/^(\d+\.\d+|Section\s+\d+:)/i.test(curTxt) &&
        /\.\s*$/.test(curTxt) &&
        !/\.\s*$/.test((blocks[blocks.length - 1].line?.text || '').trim())
      ) {
        const prevLine = blocks[blocks.length - 1].line
        prevLine.text = prevLine.text.trim() + ' ' + curTxt
        if (Array.isArray(prevLine.spans)) {
          prevLine.spans.push({ text: ' ' + curTxt, size: prevLine.size, bold: false, italic: false })
        }
        i++
        continue
      }
    }

    // 3d. Coalesce wrapped prose continuation lines split across consecutive paragraph blocks
    if (
      b.type === 'paragraph' &&
      b.line &&
      blocks.length > 0 &&
      blocks[blocks.length - 1].type === 'paragraph' &&
      blocks[blocks.length - 1].line
    ) {
      const prev = blocks[blocks.length - 1].line
      const cur = b.line
      const prevTxt = (prev.text || '').trim()
      const curTxt = (cur.text || '').trim()
      const pSz = prev.size || 11
      const cSz = cur.size || 11
      const isSpecial = (l, t) =>
        l.isCode || l.isListLike || l.isRTL ||
        /^(?:[•●○◦▪■□–—·*‣⁃\-]\s+|\d+(?:\.\d+)*[.)]?\s+|\[\d+\]\s+|(?:Table|Figure|Listing|Section)\s+\d+)/i.test(t)
      const sameMargin = Number.isFinite(prev.x) && Number.isFinite(cur.x) && Math.abs(prev.x - cur.x) <= 8
      const closeY = Number.isFinite(prev.y) && Number.isFinite(cur.y) && Math.abs(prev.y - cur.y) <= pSz * 1.75
      const sameStyle = Math.abs(pSz - cSz) <= 0.8 && !!prev.isBold === !!cur.isBold && !!prev.isItalic === !!cur.isItalic
      const looksWrapped = !/[.!?:]$/.test(prevTxt) || (prevTxt.length >= 65 && /^[a-z]/.test(curTxt))
      if (prevTxt && curTxt && !isSpecial(prev, prevTxt) && !isSpecial(cur, curTxt) && sameMargin && closeY && sameStyle && looksWrapped) {
        const lastToken = prevTxt.split(/\s+/).pop() || ''
        const firstToken = curTxt.split(/\s+/)[0] || ''
        const isUnbrokenCont = lastToken.length >= 45 && firstToken.length >= 20 && !/[.,;:!?]$/.test(lastToken)
        const joiner = isUnbrokenCont ? '' : ' '
        prev.text = prevTxt + joiner + curTxt
        if (Array.isArray(prev.spans)) {
          const curSpans = Array.isArray(cur.spans) && cur.spans.length
            ? cur.spans
            : [{ text: curTxt, size: cSz, bold: cur.isBold, italic: cur.isItalic }]
          if (joiner) prev.spans.push({ text: joiner, size: pSz, bold: prev.isBold, italic: prev.isItalic })
          prev.spans.push(...curSpans)
        }
        if (Number.isFinite(cur.yBot)) prev.yBot = cur.yBot
        if (Number.isFinite(cur.xEnd)) prev.xEnd = Math.max(prev.xEnd || 0, cur.xEnd)
        i++
        continue
      }
    }

    blocks.push(b)
    i++
  }

  m.blocks = blocks
  return m
}

/**
 * @param {File|Blob} file
 * @param {object} [opts]
 * @param {'editable'|'images'} [opts.mode='editable']
 * @param {'auto'|'16:9'|'4:3'} [opts.slideLayout='auto']
 * @param {(p:object)=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.pageTimeoutMs]
 * @returns {Promise<{blob:Blob, warnings:object[], stats:object}>}
 */
export async function convertPdfToPptx(file, opts = {}) {
  const cfg = { ...ANALYZE_DEFAULTS, mode: 'editable', slideLayout: 'auto', ...opts }
  const { signal, onProgress } = cfg
  const warnings = []
  const warn = (page, code, message, level = 'warn') => warnings.push({ page, code, message, level })
  const vel = U.makeVelocityTracker()
  const slice = U.createSlicer(8)
  const stats = { pages: 0, rich: 0, plain: 0, image: 0, failed: 0, images: 0, packMode: 'rich', elapsedMs: 0 }
  const t0 = U.now()

  const emit = (stage, message, percent, page, total) => {
    const v = total ? vel.snapshot(page ?? 0, total) : {}
    onProgress?.({
      percent: Math.round(percent),
      stage,
      message,
      page,
      totalPages: total,
      pagesPerSec: v.pagesPerSec,
      etaSec: v.etaSec ?? null,
      warnings: warnings.length,
    })
  }

  U.throwIfAborted(signal)
  const pdfjs = globalThis.pdfjsLib
  if (!pdfjs?.getDocument) throw new U.ConversionError('NO_PDFJS', 'PDF engine (pdf.js) is not loaded.')

  emit('loading', 'Reading PDF…', 1)
  let buf = await U.abortable(file.arrayBuffer(), signal)
  let task = null
  let pdf = null
  try {
    task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false })
    pdf = await U.abortable(task.promise, signal)
  } catch (e) {
    try { task?.destroy?.() } catch { /* ignore */ }
    throw U.classifyPdfError(e)
  } finally {
    buf = null
  }

  try {
    const n = pdf.numPages
    stats.pages = n
    if (!n) throw new U.ConversionError('EMPTY', 'This PDF has no pages.')

    const hist = new Map()
    const mem = { imageBytes: 0, lowMem: false, skipImages: false }
    const models = new Array(n)

    for (let p = 1; p <= n; p++) {
      U.throwIfAborted(signal)
      emit('analyze', `Analyzing page ${p} of ${n}…`, 2 + 68 * ((p - 1) / n), p - 1, n)
      try {
        if (cfg.mode === 'images') {
          models[p - 1] = await U.abortable(
            U.withTimeout(renderPageAsSlideModel(pdf, p, mem), cfg.pageTimeoutMs, `Page ${p}`),
            signal
          )
        } else {
          const m = await U.abortable(
            U.withTimeout(analyzePage(pdf, p, { pdfjs, hist, mem, warn, cfg }), cfg.pageTimeoutMs, `Page ${p}`),
            signal
          )
          normalizeModelForPptx(m)
          const hasAnyContent = (m.blocks && m.blocks.length > 0) || (m.images && m.images.length > 0) || m.pageImage
          if (!hasAnyContent && typeof document !== 'undefined' && !mem.skipImages) {
            try {
              const fallbackImg = await renderPageAsSlideModel(pdf, p, mem)
              m.pageImage = fallbackImg.pageImage
              m.mode = 'image'
            } catch { /* keep empty/minimal model */ }
          }
          models[p - 1] = m
        }
      } catch (e) {
        if (e?.code === 'ABORTED') throw e
        warn(p, 'PAGE_FAILED', `Page ${p} could not be analysed (${e?.message || e}).`)
        models[p - 1] = { pageNum: p, mode: 'failed', w: 720, h: 405, lines: [], blocks: [], images: [], vector: null }
      }

      if (mem.imageBytes > cfg.imageBudgetSoft && !mem.lowMem) {
        mem.lowMem = true
        warn(null, 'LOW_MEMORY', 'Large images detected — remaining images are downscaled to keep the browser stable.', 'info')
      }
      if (mem.imageBytes > cfg.imageBudgetHard) mem.skipImages = true
      if (p % 10 === 0) { try { pdf.cleanup() } catch { /* ignore */ } }
      await slice(true)
    }

    const bodySize = U.dominantSize(hist, 11)
    const title = (cfg.title || file.name || 'Converted Presentation').replace(/\.pdf$/i, '')
    emit('build', 'Building PowerPoint slides…', 72, 0, n)
    stats.images = models.reduce((s, m) => s + (m.images?.length || 0) + (m.pageImage ? 1 : 0), 0)

    // Slides map 1:1 to PDF pages: cross-page table stitching (a Word concern) would drop pages.

    const built = await buildPptxBlob(models, {
      bodySize,
      title,
      slideLayout: cfg.slideLayout,
      warn,
      yieldFn: slice,
      isAborted: () => !!signal?.aborted,
      onProgress: (i, total) =>
        emit(
          i >= total ? 'pack' : 'build',
          i >= total ? 'Packaging PowerPoint (.pptx)…' : `Building slide ${i + 1} of ${total}…`,
          i >= total ? 92 : 72 + 19 * (i / Math.max(1, total)),
          i,
          total
        ),
    })

    stats.packMode = built.packMode
    for (const mode of built.modes) {
      if (mode === 'image') stats.image++
      else if (mode === 'failed') stats.failed++
      else if (mode === 'rich') stats.rich++
      else stats.plain++
    }

    for (const m of models) {
      m.images = null
      m.pageImage = null
      m.blocks = null
      m.lines = null
      m.vector = null
    }

    stats.elapsedMs = Math.round(U.now() - t0)
    emit('done', 'Done', 100, n, n)
    return { blob: built.blob, warnings, stats }
  } finally {
    try { await pdf.cleanup?.() } catch { /* ignore */ }
    try { await task?.destroy?.() } catch { /* ignore */ }
  }
}

async function renderPageAsSlideModel(pdf, pageNum, mem) {
  const page = await pdf.getPage(pageNum)
  const vp = page.getViewport({ scale: 1 })
  let rendered = null
  try {
    rendered = await renderPageCanvas(page, vp, mem)
    const img = await canvasToImage(rendered.canvas, 0, 0, rendered.canvas.width, rendered.canvas.height, mem, 'jpeg')
    mem.imageBytes += img.data.byteLength
    return {
      pageNum,
      mode: 'image',
      w: vp.width,
      h: vp.height,
      lines: [],
      blocks: [],
      images: [],
      pageImage: { ...img, w: vp.width, h: vp.height },
      vector: null,
      topDown: true,
    }
  } finally {
    if (rendered) releaseCanvas(rendered.canvas)
    try { page.cleanup() } catch { /* ignore */ }
  }
}

export { MIME_PPTX }
