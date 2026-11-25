/**
 * ocrLayoutAnalysis.js
 * Client-side Document Layout Analysis for native + OCR lines.
 *  - header/footer zones
 *  - tables (grid from geometry, colspan, wrapped-cell merge) -> markdown / html / json
 *  - code blocks (monospace pitch, indent grid, no autocorrect)
 *  - nested lists (indent clusters, markers kept verbatim)
 *  - recursive XY-cut reading order (columns before gutter crossing)
 *  - form fields (checkbox / radio / text line / signature / date)
 * shortcut: heuristics only, no ML layout model. Upgrade: add a small ONNX layout model.
 */
import { fixFieldConfusables, normalizePunctuation, normalizeBullet } from './ocrPostProcess.js'

const median = arr => {
  const a = arr.filter(x => x > 0).sort((x, y) => x - y)
  return a.length ? a[Math.floor(a.length / 2)] : 0
}

export function enrichLineGeometry(rawLines) {
  return rawLines.map((line, index) => {
    const box = line.box || []
    const xs = box.map(p => p[0])
    const ys = box.map(p => p[1])
    const xMin = xs.length ? Math.min(...xs) : 0
    const xMax = xs.length ? Math.max(...xs) : 0
    const yMin = ys.length ? Math.min(...ys) : 0
    const yMax = ys.length ? Math.max(...ys) : 0
    return {
      ...line,
      source: line.source || 'ocr',
      originalIndex: index,
      xMin, xMax, yMin, yMax,
      width: xMax - xMin,
      height: yMax - yMin,
      xCenter: (xMin + xMax) / 2,
      yCenter: (yMin + yMax) / 2,
    }
  })
}

export function partitionPageZones(lines, canvasHeight) {
  const hT = canvasHeight * 0.085
  const fT = canvasHeight * 0.915
  const header = []
  const body = []
  const footer = []
  for (const l of lines) {
    if (l.yCenter < hT) header.push({ ...l, zone: 'header' })
    else if (l.yCenter > fT) footer.push({ ...l, zone: 'footer' })
    else body.push({ ...l, zone: 'body' })
  }
  const byRow = (a, b) => a.yMin - b.yMin || a.xMin - b.xMin
  header.sort(byRow)
  footer.sort(byRow)
  return { header, body, footer }
}

/* ───────────────────────── rows ───────────────────────── */

function clusterRows(lines, medH) {
  const sorted = [...lines].sort((a, b) => a.yCenter - b.yCenter || a.xMin - b.xMin)
  const rows = []
  let cur = []
  let anchor = 0
  for (const l of sorted) {
    if (!cur.length) { cur = [l]; anchor = l.yCenter; continue }
    if (Math.abs(l.yCenter - anchor) < medH * 0.55) cur.push(l)
    else { rows.push(cur.sort((a, b) => a.xMin - b.xMin)); cur = [l]; anchor = l.yCenter }
  }
  if (cur.length) rows.push(cur.sort((a, b) => a.xMin - b.xMin))
  return rows
}

const rowTop = r => Math.min(...r.map(l => l.yMin))
const rowBottom = r => Math.max(...r.map(l => l.yMax))

/* ───────────────────────── tables ───────────────────────── */

function looksLikeProseColumns(multiRows) {
  const cells = multiRows.flat()
  const avg = cells.reduce((s, c) => s + c.text.length, 0) / cells.length
  if (avg < 24 || multiRows.length < 4) return false
  const nCols = Math.max(...multiRows.map(r => r.length))
  for (let c = 0; c < nCols; c++) {
    const w = multiRows.map(r => r[c]?.width).filter(Boolean)
    if (w.length >= 4 && median(w) / Math.max(...w) < 0.75) return false
  }
  return true
}

function buildTable(run, medH) {
  const nCols = Math.max(...run.map(r => r.length))
  const ref = run.filter(r => r.length === nCols)
  const cols = []
  for (let c = 0; c < nCols; c++) {
    cols.push({
      x0: Math.min(...ref.map(r => r[c].xMin)),
      x1: Math.max(...ref.map(r => r[c].xMax)),
    })
  }
  const colsOf = cell => {
    const hit = []
    cols.forEach((col, i) => {
      const ov = Math.min(cell.xMax, col.x1) - Math.max(cell.xMin, col.x0)
      if (ov >= 0.4 * (col.x1 - col.x0)) hit.push(i)
    })
    if (hit.length) return [hit[0], hit[hit.length - 1]]
    let best = 0
    let bd = Infinity
    cols.forEach((col, i) => {
      const d = Math.abs((col.x0 + col.x1) / 2 - cell.xCenter)
      if (d < bd) { bd = d; best = i }
    })
    return [best, best]
  }

  const rows = []
  let prevBottom = null
  for (const r of run) {
    const gap = prevBottom == null ? Infinity : rowTop(r) - prevBottom
    // shortcut: tight gap = wrapped cell text. Upgrade: use ruling lines from the image.
    const wrap = rows.length > 0 && gap < medH * 0.3
    const cells = r.map(c => {
      const [c0, c1] = colsOf(c)
      return { c0, c1, text: c.text.trim(), xMin: c.xMin, xMax: c.xMax, yMin: c.yMin, yMax: c.yMax }
    })
    if (wrap) {
      const prev = rows[rows.length - 1]
      for (const cell of cells) {
        const host = prev.cells.find(p => p.c0 <= cell.c0 && p.c1 >= cell.c0)
        if (host) {
          host.text += ' ' + cell.text
          host.yMax = Math.max(host.yMax, cell.yMax)
        } else prev.cells.push(cell)
      }
    } else rows.push({ cells })
    prevBottom = rowBottom(r)
  }
  return { rows, nCols }
}

function renderTable(rows, nCols) {
  const clean = t => fixFieldConfusables(t).replace(/\s+/g, ' ').trim()
  rows.forEach(r => r.cells.forEach(c => { c.text = clean(c.text) }))
  const md = rows.map(r => {
    const arr = Array(nCols).fill('')
    for (const c of r.cells) arr[c.c0] = c.text.replace(/\|/g, '\\|')
    return '| ' + arr.join(' | ') + ' |'
  })
  md.splice(1, 0, '| ' + Array(nCols).fill('---').join(' | ') + ' |')

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = '<table>' + rows.map((r, ri) => {
    const tag = ri === 0 ? 'th' : 'td'
    const cells = [...r.cells].sort((a, b) => a.c0 - b.c0)
    let out = ''
    let col = 0
    for (const c of cells) {
      while (col < c.c0) { out += `<${tag}></${tag}>`; col++ }
      const span = c.c1 - c.c0 + 1
      out += `<${tag}${span > 1 ? ` colspan="${span}"` : ''}>${esc(c.text)}</${tag}>`
      col = c.c1 + 1
    }
    while (col < nCols) { out += `<${tag}></${tag}>`; col++ }
    return `<tr>${out}</tr>`
  }).join('') + '</table>'

  return {
    markdown: md.join('\n'),
    html,
    nCols,
    rows: rows.map(r => r.cells.map(c => ({ text: c.text, col: c.c0, colspan: c.c1 - c.c0 + 1, bbox: [c.xMin, c.yMin, c.xMax, c.yMax] }))),
  }
}

function pseudo(kind, lines, extra) {
  const xMin = Math.min(...lines.map(l => l.xMin))
  const xMax = Math.max(...lines.map(l => l.xMax))
  const yMin = Math.min(...lines.map(l => l.yMin))
  const yMax = Math.max(...lines.map(l => l.yMax))
  return {
    [kind]: true, lines, xMin, xMax, yMin, yMax,
    width: xMax - xMin, height: yMax - yMin,
    xCenter: (xMin + xMax) / 2, yCenter: (yMin + yMax) / 2,
    ...extra,
  }
}

function detectTables(lines, medH) {
  const rows = clusterRows(lines, medH)
  const blocks = []
  const used = new Set()
  let i = 0
  while (i < rows.length) {
    if (rows[i].length < 2) { i++; continue }
    const run = [rows[i]]
    // A lone wide title row right above the grid is a merged (colspan) header.
    const above = rows[i - 1]
    if (above && above.length === 1 && !used.has(above[0]) && above[0].text.length < 100 && !/[.]$/.test(above[0].text)) {
      const w = Math.max(...rows[i].map(c => c.xMax)) - Math.min(...rows[i].map(c => c.xMin))
      if (rowTop(rows[i]) - rowBottom(above) <= medH * 2.0 && above[0].width >= 0.6 * w) run.unshift(above)
    }
    let j = i + 1
    while (j < rows.length) {
      const r = rows[j]
      const gap = rowTop(r) - rowBottom(run[run.length - 1])
      if (r.length >= 2 && gap <= medH * 2.2) { run.push(r); j++; continue }
      if (r.length === 1 && gap <= medH * 0.9) {
        const x = r[0].xMin
        if (run.some(rr => rr.some(c => Math.abs(c.xMin - x) < medH))) { run.push(r); j++; continue }
      }
      break
    }
    const multi = run.filter(r => r.length >= 2)
    if (multi.length >= 2 && !looksLikeProseColumns(multi)) {
      const { rows: trows, nCols } = buildTable(run, medH)
      const t = renderTable(trows, nCols)
      const flat = run.flat()
      flat.forEach(l => used.add(l))
      blocks.push(pseudo('isTable', flat, { table: t }))
    }
    i = Math.max(j, i + 1)
  }
  return { blocks, rest: lines.filter(l => !used.has(l)) }
}

/* ───────────────────────── code ───────────────────────── */

const CODE_RE = /^\s*(def |class |import |from \S+ import|return\b|if |elif |else:|for |while |try:|except|with |async |await |#|\/\/|\/\*|\*\/|@\w+|print\(|[\w.[\]]+\s*(=|\+=|-=)\s|[\w.]+\(.*\)\s*:?\s*$|[)\]}]\s*$|[{}]\s*$)/
const STRONG_RE = /^\s*(def |class |import |from \S+ import|return\b|elif |else:|try:|except|#|\/\/|if .*:$|for .*:$)/

function isCodeLine(l) {
  if (CODE_RE.test(l.text)) return true
  const words = l.text.trim().split(/\s+/).length
  return words <= 4 && /[()[\]{}=:_.]/.test(l.text)
}

function evalCodeRun(run, medH) {
  if (run.length < 3) return null
  const cpw = run.filter(l => l.text.trim().length >= 8).map(l => l.width / l.text.length)
  if (cpw.length >= 2) {
    const mean = cpw.reduce((a, b) => a + b, 0) / cpw.length
    const sd = Math.sqrt(cpw.reduce((s, v) => s + (v - mean) ** 2, 0) / cpw.length)
    if (sd / mean > 0.2) return null
  }
  if (!run.some(l => STRONG_RE.test(l.text))) return null
  const adv = median(cpw) || median(run.map(l => l.width / Math.max(1, l.text.length)))
  const minX = Math.min(...run.map(l => l.xMin))
  const out = []
  let prev = null
  for (const l of run) {
    if (prev) {
      const pitch = prev.height * 1.35
      const blanks = Math.round((l.yMin - prev.yMin) / pitch) - 1
      for (let b = 0; b < blanks; b++) out.push('')
    }
    let sp = Math.round((l.xMin - minX) / adv)
    const snapped = Math.round(sp / 4) * 4
    if (Math.abs(sp - snapped) <= 1) sp = snapped // 4-space grid
    out.push(' '.repeat(Math.max(0, sp)) + l.text.trim())
    prev = l
  }
  return pseudo('isCode', run, { codeText: out.join('\n') })
}

function findCodeBlocks(lines, medH) {
  const sorted = [...lines].sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)
  const blocks = []
  const used = new Set()
  let run = []
  const flush = () => {
    const b = evalCodeRun(run, medH)
    if (b) { blocks.push(b); run.forEach(l => used.add(l)) }
    run = []
  }
  for (const l of sorted) {
    if (!isCodeLine(l)) { flush(); continue }
    const prev = run[run.length - 1]
    if (prev && l.yMin - prev.yMax > medH * 2.2) flush()
    run.push(l)
  }
  flush()
  return { blocks, rest: lines.filter(l => !used.has(l)) }
}

/* ───────────────────────── reading order (XY-cut) ───────────────────────── */

function flat(it) { return it.lines || [it] }

function findVerticalGutter(items, minGutter) {
  const segs = items.map(i => [i.xMin, i.xMax]).sort((a, b) => a[0] - b[0])
  let end = segs[0][1]
  let best = null
  for (let k = 1; k < segs.length; k++) {
    const gap = segs[k][0] - end
    if (gap >= minGutter && (!best || gap > best.gap)) best = { gap, x: end + gap / 2 }
    end = Math.max(end, segs[k][1])
  }
  return best
}

function columnLike(items) {
  const ls = items.flatMap(flat)
  if (ls.length < 3) return false
  return ls.reduce((s, l) => s + l.text.length, 0) / ls.length >= 18
}

function sortRows(items, medH) {
  const sorted = [...items].sort((a, b) => a.yCenter - b.yCenter || a.xMin - b.xMin)
  const out = []
  let row = []
  let anchor = 0
  for (const it of sorted) {
    if (row.length && Math.abs(it.yCenter - anchor) >= medH * 0.5) {
      out.push(...row.sort((a, b) => a.xMin - b.xMin))
      row = []
    }
    if (!row.length) anchor = it.yCenter
    row.push(it)
  }
  out.push(...row.sort((a, b) => a.xMin - b.xMin))
  return out
}

function xyCut(items, ctx) {
  if (items.length <= 1) return items
  const gut = findVerticalGutter(items, ctx.minGutter)
  if (gut) {
    const L = items.filter(i => i.xCenter < gut.x)
    const R = items.filter(i => i.xCenter >= gut.x)
    if (L.length && R.length && columnLike(L) && columnLike(R)) return [...xyCut(L, ctx), ...xyCut(R, ctx)]
  }
  const regionW = Math.max(...items.map(i => i.xMax)) - Math.min(...items.map(i => i.xMin))
  const isWide = i => i.width > regionW * 0.6
  if (items.some(isWide) && !items.every(isWide)) {
    const sorted = sortRows(items, ctx.medH)
    const out = []
    let group = []
    for (const it of sorted) {
      if (isWide(it)) {
        if (group.length) { out.push(...xyCut(group, ctx)); group = [] }
        out.push(it)
      } else group.push(it)
    }
    if (group.length) out.push(...xyCut(group, ctx))
    return out
  }
  return sortRows(items, ctx.medH)
}

/* ───────────────────────── text rendering ───────────────────────── */

const LIST_RE = /^(?:[•◦▪▫●○■□·‣⁃*]|[-–—]|\(?\d{1,3}[.)]|\d{1,3}(?:\.\d{1,3})+\.?[a-z]?[.)]?|\(?[a-z][.)]|\([ivxlc]+\))\s+\S/i
const HEADING_RE = /^(Section|Chapter|Part)\s+\d+\b/i

function fixProse(l) {
  l.text = normalizePunctuation(fixFieldConfusables(l.text))
}

function renderPlainRun(lines, medH, charW) {
  // clusters: break on big vertical gap or when order jumps back up (new column)
  const clusters = []
  let cur = []
  for (const l of lines) {
    const prev = cur[cur.length - 1]
    if (prev && (l.yMin - prev.yMax > prev.height * 1.8 || l.yMin < prev.yMin - prev.height * 0.5)) {
      clusters.push(cur); cur = []
    }
    cur.push(l)
  }
  if (cur.length) clusters.push(cur)

  const out = []
  for (const cl of clusters) {
    cl.forEach(fixProse)
    const minLeft = Math.min(...cl.map(l => l.xMin))
    const listXs = cl.filter(l => LIST_RE.test(l.text)).map(l => l.xMin).sort((a, b) => a - b)
    const levels = []
    for (const x of listXs) if (!levels.length || x - levels[levels.length - 1] > charW * 0.9) levels.push(x)
    const depthOf = x => {
      let d = 0
      levels.forEach((lx, i) => { if (x >= lx - charW * 0.9) d = i })
      return d
    }

    // join same-row neighbours (side-by-side short fragments) with a space
    let rowAnchor = null
    let rowText = ''
    const flushRow = () => { if (rowText) out.push(rowText); rowText = ''; rowAnchor = null }
    for (const l of cl) {
      const sameRow = rowAnchor && Math.abs(l.yCenter - rowAnchor.yCenter) < medH * 0.5 && l.xMin >= rowAnchor.xMax - charW
      if (sameRow) { rowText += ' ' + l.text; rowAnchor = l; continue }
      flushRow()
      rowAnchor = l
      if (LIST_RE.test(l.text)) {
        const t = l.text.replace(/^(\S)/, (_, m) => normalizeBullet(m))
        rowText = '  '.repeat(depthOf(l.xMin)) + t.replace(/^•(?=\s)/, '-')
      } else if (l.height > medH * 1.35 || (HEADING_RE.test(l.text) && l.text.length < 90 && !/[.]$/.test(l.text))) {
        rowText = `\n## ${l.text}\n`
      } else {
        const off = l.xMin - minLeft
        const sp = off >= charW * 1.5 ? Math.max(1, Math.round(off / (charW * 1.1))) : 0
        rowText = ' '.repeat(sp) + l.text
      }
    }
    flushRow()
  }
  return out.join('\n')
}

function renderItems(items, medH, charW) {
  const parts = []
  const flatLines = []
  let run = []
  const flushRun = () => {
    if (!run.length) return
    parts.push(renderPlainRun(run, medH, charW))
    flatLines.push(...run)
    run = []
  }
  for (const it of items) {
    if (it.isTable) { flushRun(); parts.push('\n' + it.table.markdown + '\n'); flatLines.push(...it.lines) }
    else if (it.isCode) { flushRun(); parts.push('```\n' + it.codeText + '\n```'); flatLines.push(...it.lines.map(l => ({ ...l, noCorrect: true }))) }
    else run.push(it)
  }
  flushRun()
  return { text: parts.join('\n'), lines: flatLines }
}

/* ───────────────────────── form fields ───────────────────────── */

const CHECK_RE = /^\s*(?:(\[)\s*([xX✓✔√]?)\s*(\])|(\()\s*([xX✓✔√]?)\s*(\))|([☐☑☒□]))\s*(.*)$/

export function detectFormFields(lines) {
  const fields = []
  let radioGroup = 0
  let prevRadio = false
  for (const l of lines) {
    const t = l.text
    const m = CHECK_RE.exec(t)
    if (m) {
      const bracket = m[1] ? 'checkbox' : m[4] ? 'radio' : 'checkbox'
      const mark = m[2] || m[5] || ''
      const glyph = m[7]
      const checked = !!mark || glyph === '☑' || glyph === '☒'
      if (bracket === 'radio') { if (!prevRadio) radioGroup++; prevRadio = true } else prevRadio = false
      fields.push({
        type: bracket, state: checked ? 'checked' : 'unchecked', label: (m[8] || '').trim(),
        group: bracket === 'radio' ? radioGroup : undefined,
        bbox: [l.xMin, l.yMin, l.xMax, l.yMax],
      })
      continue
    }
    prevRadio = false
    if (/_{4,}|\.{6,}/.test(t)) {
      const label = t.replace(/[_.]{4,}/g, '').trim()
      const type = /signature|sign here/i.test(label) ? 'signature' : /^date\b/i.test(label) ? 'date' : 'text'
      fields.push({ type, label, bbox: [l.xMin, l.yMin, l.xMax, l.yMax] })
    } else if (/^(signature|sign here)\s*:?\s*$/i.test(t.trim())) {
      fields.push({ type: 'signature', label: t.trim(), bbox: [l.xMin, l.yMin, l.xMax, l.yMax] })
    }
  }
  return fields
}

/* ───────────────────────── pipeline ───────────────────────── */

export function reconstructPageLayout(rawLines, canvasWidth, canvasHeight) {
  const empty = {
    allLines: [], bodyLines: [], headerLines: [], footerLines: [], fullText: '',
    avgConfidence: 100.0, lowConfidenceCount: 0, tables: [], formFields: [],
  }
  if (!rawLines || rawLines.length === 0) return empty

  const enriched = enrichLineGeometry(rawLines)
  const { header, body, footer } = partitionPageZones(enriched, canvasHeight)
  const medH = median(enriched.map(l => l.height)) || 14
  const charW = Math.max(5, medH * 0.55)

  const t = detectTables(body, medH)
  const c = findCodeBlocks(t.rest, medH)
  const items = [...c.rest, ...t.blocks, ...c.blocks]
  const ordered = xyCut(items, { medH, minGutter: Math.max(15, charW * 2) })
  const rendered = renderItems(ordered, medH, charW)

  header.forEach(fixProse)
  footer.forEach(fixProse)
  const allLines = [...header, ...rendered.lines, ...footer]

  const textParts = []
  if (header.length) textParts.push(header.map(l => l.text).join(' '))
  if (rendered.text) textParts.push(rendered.text)
  if (footer.length) textParts.push(footer.map(l => l.text).join(' '))

  const ocr = rawLines.filter(l => l.source !== 'native')
  const avg = ocr.length ? Math.round((ocr.reduce((s, l) => s + (l.mean != null ? l.mean : 0.95), 0) / ocr.length) * 1000) / 10 : 100.0
  const lowCount = ocr.filter(l => (l.mean != null ? l.mean : 1) < 0.85).length

  return {
    allLines,
    bodyLines: rendered.lines,
    headerLines: header,
    footerLines: footer,
    fullText: textParts.join('\n\n'),
    avgConfidence: avg,
    lowConfidenceCount: lowCount,
    tables: ordered.filter(i => i.isTable).map(i => ({ bbox: [i.xMin, i.yMin, i.xMax, i.yMax], ...i.table })),
    formFields: detectFormFields(allLines),
  }
}
