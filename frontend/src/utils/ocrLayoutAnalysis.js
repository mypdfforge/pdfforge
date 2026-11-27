/**
 * ocrLayoutAnalysis.js
 * Client-side Document Layout Analysis for native + OCR lines.
 *  - Header/footer zones + cross-page canonical deduplication (DEFECT 02 / 13)
 *  - Tables: grid from geometry, merged colspan headers, wrapped-cell join -> markdown/html/json (DEFECT 10)
 *  - Code blocks: monospace pitch, 4-space indent grid, bracket balance validation, no autocorrect (DEFECT 07)
 *  - Nested lists: up to 10 levels via indent clusters & ListNode tree (DEFECT 12)
 *  - Protected unbroken tokens: wrapped URL/JWT/Base64/Hex rejoining without spaces (DEFECT 05)
 *  - Recursive XY-cut reading order: columns before gutter crossing (DEFECT 11)
 *  - Form fields: checkbox / radio / text line / signature / date (DEFECT 14)
 *  - Core invariant metadata: page, bbox, confidence, origin, script, regionType, flagged
 */
import {
  fixFieldConfusables,
  normalizePunctuation,
  normalizeBullet,
  detectScript,
  isProtectedText,
  shouldJoinWithoutSpace,
  normalizeForCompare,
  repairCodeSyntax,
  repairProtectedString,
  quarantineGibberish,
} from './ocrPostProcess.js'

const median = arr => {
  const a = arr.filter(x => x > 0).sort((x, y) => x - y)
  return a.length ? a[Math.floor(a.length / 2)] : 0
}

/**
 * Wrapped URL / JWT / Base64 lines are repaired as ONE string (same length, confusable classes only)
 * and split back, so the PDF text layer carries the corrected token and wrapping is untouched.
 */
export function repairProtectedLines(lines) {
  const tok = l => l.source !== 'native' && !l.unreadable && l.text && !/\s/.test(l.text.trim()) && l.text.trim().length >= 20 && /[A-Za-z0-9]/.test(l.text)
  const sorted = lines.filter(tok).sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)
  let group = []
  const flush = () => {
    if (group.length) {
      const joined = group.map(l => l.text.trim()).join('')
      const fixed = repairProtectedString(joined)
      if (fixed !== joined && fixed.length === joined.length) {
        let pos = 0
        for (const l of group) {
          const n = l.text.trim().length
          l.text = fixed.slice(pos, pos + n)
          l.tokenRepaired = true
          l.flagged = true
          pos += n
        }
      }
    }
    group = []
  }
  for (const l of sorted) {
    const prev = group[group.length - 1]
    if (prev && (l.yMin - prev.yMax > prev.height * 1.6 || Math.abs(l.xMin - prev.xMin) > prev.height * 3)) flush()
    group.push(l)
  }
  flush()
}

export function enrichLineGeometry(rawLines, pageNumber = 1) {
  return rawLines.map((line, index) => {
    const box = line.box || []
    const xs = box.map(p => p[0])
    const ys = box.map(p => p[1])
    const xMin = Number.isFinite(line.xMin) ? line.xMin : (xs.length ? Math.min(...xs) : 0)
    const xMax = Number.isFinite(line.xMax) ? line.xMax : (xs.length ? Math.max(...xs) : 0)
    const yMin = Number.isFinite(line.yMin) ? line.yMin : (ys.length ? Math.min(...ys) : 0)
    const yMax = Number.isFinite(line.yMax) ? line.yMax : (ys.length ? Math.max(...ys) : 0)
    const src = line.source || 'ocr'
    const conf = line.mean ?? 1
    return {
      ...line,
      page: line.page || pageNumber,
      source: src,
      origin: src === 'native' ? 'source-text' : 'recognized',
      confidence: conf,
      flagged: !!line.flagged || (src !== 'native' && conf < 0.85),
      script: line.script || detectScript(line.text),
      originalIndex: index,
      xMin, xMax, yMin, yMax,
      bbox: [xMin, yMin, xMax, yMax],
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
    if (l.yCenter < hT) header.push({ ...l, zone: 'header', regionType: 'HEADER' })
    else if (l.yCenter > fT) footer.push({ ...l, zone: 'footer', regionType: 'FOOTER' })
    else body.push({ ...l, zone: 'body', regionType: l.regionType || 'PARAGRAPH' })
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

/* ───────────────────────── tables (DEFECT 10) ───────────────────────── */

function looksLikeProseColumns(multiRows) {
  const cells = multiRows.flat()
  const avg = cells.reduce((s, c) => s + c.text.length, 0) / cells.length
  if (avg < 24 || multiRows.length < 4) return false
  const nCols = Math.max(...multiRows.map(r => r.length))
  // term | definition tables: one column of short labels next to long text is a table, not prose columns
  for (let c = 0; c < nCols; c++) {
    const col = multiRows.map(r => r[c]?.text.length).filter(Boolean)
    if (col.length >= 3 && col.reduce((a, b) => a + b, 0) / col.length < 0.5 * avg && Math.max(...col) < 40) return false
  }
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
      if (ov >= 0.4 * Math.max(1, col.x1 - col.x0)) hit.push(i)
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
    const cells = r.map(c => {
      const [c0, c1] = colsOf(c)
      return { c0, c1, text: c.text.trim(), xMin: c.xMin, xMax: c.xMax, yMin: c.yMin, yMax: c.yMax, src: [c] }
    })

    // Wrapped continuation inside a cell:
    // Tight gap OR partial subset of columns closely trailing the previous row
    const prevRow = rows[rows.length - 1]
    const isBannerHeader = rows.length === 0 && cells.length === 1 && cells[0].c1 - cells[0].c0 + 1 > 1
    const isBannerCont = rows.length === 1 && rows[0].cells.length === 1 && cells.length === 1 && (cells[0].c1 - cells[0].c0 + 1) > 1 && gap < medH * 1.1
    const wrap = !isBannerHeader && prevRow && (
      isBannerCont ||
      gap < medH * 0.35 ||
      (gap < medH * 0.9 && cells.length < nCols && !(prevRow.cells.length === 1 && (prevRow.cells[0].c1 - prevRow.cells[0].c0 + 1) > 1))
    )

    if (wrap) {
      for (const cell of cells) {
        const host = prevRow.cells.find(p => p.c0 <= cell.c0 && p.c1 >= cell.c0)
        if (host) {
          host.text += (shouldJoinWithoutSpace(host.text, cell.text) ? '' : ' ') + cell.text
          host.src.push(...cell.src)
          host.yMax = Math.max(host.yMax, cell.yMax)
          host.xMax = Math.max(host.xMax, cell.xMax)
          host.xMin = Math.min(host.xMin, cell.xMin)
        } else {
          prevRow.cells.push(cell)
        }
      }
    } else {
      rows.push({ cells })
    }
    prevBottom = rowBottom(r)
  }
  markRowSpans(rows, nCols)
  return { rows, nCols }
}

/**
 * Vertical merges. A body cell spans downward when every row beneath it has a real cell in every
 * OTHER column but nothing in this cell's columns (classic grouped first column). Header row is
 * never a rowspan origin and a row needs >= 2 cells, so sparse tables are not mis-merged.
 */
function markRowSpans(rows, nCols) {
  const covered = rows.map(() => new Set())
  const colsFilled = (row, ri) => {
    const set = new Set(covered[ri])
    for (const c of row.cells) for (let k = c.c0; k <= c.c1; k++) set.add(k)
    return set
  }
  for (let ri = 1; ri < rows.length - 1; ri++) {
    for (const c of rows[ri].cells) {
      if (c.rowspan > 1 || rows[ri].cells.length < 2 || !c.text.trim()) continue
      let k = 0
      for (let rj = ri + 1; rj < rows.length; rj++) {
        const filled = colsFilled(rows[rj], rj)
        let slotEmpty = true
        for (let x = c.c0; x <= c.c1; x++) if (filled.has(x)) slotEmpty = false
        const othersFull = Array.from({ length: nCols }, (_, x) => x)
          .filter(x => x < c.c0 || x > c.c1).every(x => filled.has(x))
        if (!slotEmpty || !othersFull) break
        k++
      }
      if (k >= 1) {
        c.rowspan = k + 1
        for (let j = 1; j <= k; j++) for (let x = c.c0; x <= c.c1; x++) covered[ri + j].add(x)
      }
    }
  }
  rows.forEach((r, i) => { r.covered = covered[i] })
}

function renderTable(rows, nCols) {
  const clean = t => normalizePunctuation(fixFieldConfusables(t)).replace(/\s+/g, ' ').trim()
  rows.forEach(r => r.cells.forEach(c => {
    c.text = clean(c.text)
    if (/^\(?\s*[+\-€$£¥]?\s*[\d,.]+%?\s*\)?$/.test(c.text)) c.align = 'right'
    else if (/^[✓✔✗×☑☒☐□○◉]$/.test(c.text)) c.align = 'center'
    else c.align = 'left'
  }))

  // TASK #5: Table-column consistency check (e.g., AO -> A0 when sibling cells have A1/A2/B0; a -> α in statistical headers)
  for (let col = 0; col < nCols; col++) {
    const colCells = rows.flatMap(r => r.cells.filter(c => c.c0 === col && c.c1 === col))
    const hasNumericIndex = colCells.some(c => /\b[ABCTSV]\d\b/.test(c.text))
    if (hasNumericIndex) {
      for (const c of colCells) {
        c.text = c.text.replace(/\b([ABCTSV])O\b/g, '$10')
      }
    }
  }
  if (rows[0]) {
    for (const c of rows[0].cells) {
      c.text = c.text.replace(/(^|\s|\()a(\s*\)|$)/g, (m, p, s) =>
        rows.some(r => r.cells.some(rc => /[μσ±]/.test(rc.text))) ? `${p}α${s}` : m
      )
    }
  }

  // PDF text layer + JSON read the LINE objects, so every cell correction is written back to them
  for (const r of rows) for (const c of r.cells) {
    const live = c.src.filter(l => !l.unreadable)
    if (c.src.length === 1 && live.length) c.src[0].text = c.text
    else for (const l of live) l.text = clean(l.text)
  }

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
      while (col < c.c0) { if (!r.covered?.has(col)) out += `<${tag}></${tag}>`; col++ }
      const span = c.c1 - c.c0 + 1
      out += `<${tag}${span > 1 ? ` colspan="${span}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}>${esc(c.text)}</${tag}>`
      col = c.c1 + 1
    }
    while (col < nCols) { if (!r.covered?.has(col)) out += `<${tag}></${tag}>`; col++ }
    return `<tr>${out}</tr>`
  }).join('') + '</table>'

  return {
    markdown: md.join('\n'),
    html,
    nCols,
    rows: rows.map((r, ri) => r.cells.map(c => ({
      text: c.text,
      col: c.c0,
      colspan: c.c1 - c.c0 + 1,
      rowspan: c.rowspan || 1,
      align: c.align,
      isHeader: ri === 0,
      bbox: [c.xMin, c.yMin, c.xMax, c.yMax],
    }))),
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
    const gridW = Math.max(...rows[i].map(c => c.xMax)) - Math.min(...rows[i].map(c => c.xMin))

    // Pull 1 or 2 lone merged banner header lines immediately above the grid
    for (let up = 1; up <= 2 && i - up >= 0; up++) {
      const above = rows[i - up]
      const topRow = run[0]
      if (above && above.length === 1 && !used.has(above[0]) && above[0].text.length < 110 && !/[.]$/.test(above[0].text)) {
        if (rowTop(topRow) - rowBottom(above) <= medH * 2.0 && above[0].width >= 0.45 * gridW) {
          run.unshift(above)
          continue
        }
      }
      break
    }

    let j = i + 1
    while (j < rows.length) {
      const r = rows[j]
      const gap = rowTop(r) - rowBottom(run[run.length - 1])
      if (r.length >= 2 && gap <= medH * 2.2) { run.push(r); j++; continue }
      if (r.length === 1 && gap <= medH * 1.1) {
        const x = r[0].xMin
        if (run.some(rr => rr.some(c => Math.abs(c.xMin - x) < medH * 1.2))) { run.push(r); j++; continue }
      }
      break
    }
    const multi = run.filter(r => r.length >= 2)
    if (multi.length >= 2 && !looksLikeProseColumns(multi)) {
      const { rows: trows, nCols } = buildTable(run, medH)
      const t = renderTable(trows, nCols)
      const flat = run.flat()
      flat.forEach(l => { l.regionType = 'TABLE' })
      run.flat().forEach(l => used.add(l))
      blocks.push(pseudo('isTable', flat, { table: t, regionType: 'TABLE' }))
    }
    i = Math.max(j, i + 1)
  }
  return { blocks, rest: lines.filter(l => !used.has(l)) }
}

/* ───────────────────────── code blocks & validation (DEFECT 07) ───────────────────────── */

const CODE_RE = /^\s*(def |class |import |from \S+ import|return\b|if |elif |else:|for |while |try:|except|finally:|with |async |await |#|\/\/|\/\*|\*\/|@\w+|print\(|const |let |var |function |export |[\w.[\]]+\s*(=|\+=|-=)\s|[\w.]+\(.*\)\s*:?\s*$|[)\]}]\s*$|[{}]\s*$)/
const STRONG_RE = /^\s*(def |class |import |from \S+ import|return\b|elif |else:|try:|except|finally:|#|\/\/|if .*:$|for .*:$|with .*:$|async def )/

function isCodeLine(l) {
  if (l.isMono) return true
  if (CODE_RE.test(l.text)) return true
  const words = l.text.trim().split(/\s+/).length
  return words <= 4 && /[()[\]{}=:_.]/.test(l.text)
}

/** Validates brackets ((), [], {}, <>) & quotes balance inside reconstructed code blocks. */
export function validateCodeBrackets(codeText) {
  const stack = []
  const pairs = { '(': ')', '[': ']', '{': '}' }
  const closers = { ')': '(', ']': '[', '}': '{' }
  const issues = []
  const lines = (codeText || '').split('\n')

  lines.forEach((line, li) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) return
    let inQuote = null
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci]
      const prev = ci > 0 ? line[ci - 1] : ''
      const next = line[ci + 1] || ''
      if (inQuote) {
        if (ch === inQuote && prev !== '\\') inQuote = null
        continue
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch
        continue
      }
      if (ch === '#' || (ch === '/' && next === '/')) break
      // Validate paired generic/template angle brackets (e.g. List<str>), ignoring ->, <=, >=, and comparisons
      if (ch === '<' && next !== '=' && next !== ' ' && /[A-Za-z_/?!]/.test(next)) {
        stack.push({ ch: '<', line: li + 1 })
      } else if (ch === '>' && prev !== '-' && prev !== '=' && prev !== ' ' && stack[stack.length - 1]?.ch === '<') {
        stack.pop()
      } else if (pairs[ch]) {
        stack.push({ ch, line: li + 1 })
      } else if (closers[ch]) {
        const top = stack[stack.length - 1]
        if (!top || top.ch !== closers[ch]) {
          issues.push(`Line ${li + 1}: unexpected "${ch}"`)
        } else {
          stack.pop()
        }
      }
    }
    if (inQuote) issues.push(`Line ${li + 1}: unclosed ${inQuote} quote`)
  })
  for (const unclosed of stack) {
    issues.push(`Line ${unclosed.line}: unclosed "${unclosed.ch}"`)
  }
  return { balanced: issues.length === 0, issues, unclosed: stack.map(u => u.ch) }
}

function evalCodeRun(run) {
  const hasMono = run.some(l => l.isMono)
  if (!hasMono && run.length < 3) return null
  if (hasMono && run.length < 2) return null

  const cpw = run.filter(l => l.text.trim().length >= 8).map(l => l.width / l.text.length)
  if (!hasMono && cpw.length >= 2) {
    const mean = cpw.reduce((a, b) => a + b, 0) / cpw.length
    const sd = Math.sqrt(cpw.reduce((s, v) => s + (v - mean) ** 2, 0) / cpw.length)
    if (sd / mean > 0.28) return null
  }
  if (!hasMono && !run.some(l => STRONG_RE.test(l.text))) return null

  const adv = median(cpw) || median(run.map(l => l.width / Math.max(1, l.text.length))) || 7
  const minX = Math.min(...run.map(l => l.xMin))
  const out = []
  const outIdx = []
  let prev = null
  for (const l of run) {
    if (prev) {
      const pitch = prev.height * 1.35
      const blanks = Math.max(0, Math.round((l.yMin - prev.yMin) / pitch) - 1)
      for (let b = 0; b < Math.min(blanks, 3); b++) out.push('')
    }
    let sp = Math.round((l.xMin - minX) / adv)
    const snapped = Math.round(sp / 4) * 4
    if (Math.abs(sp - snapped) <= 1) sp = snapped // 4-space grid
    outIdx.push(out.length)
    out.push(' '.repeat(Math.max(0, sp)) + l.text.trim())
    prev = l
  }
  const codeText = repairCodeSyntax(out.join('\n'))
  const validation = validateCodeBrackets(codeText)
  const fixedLines = codeText.split('\n')
  // syntax repairs go back onto the line objects so the PDF text layer matches the exported code
  const tagged = run.map((l, i) => ({ ...l, text: (fixedLines[outIdx[i]] ?? l.text).trim(), regionType: 'CODE', noCorrect: true }))
  return pseudo('isCode', tagged, { codeText, regionType: 'CODE', bracketValidation: validation })
}

function findCodeBlocks(lines, medH) {
  const sorted = [...lines].sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)
  const blocks = []
  const used = new Set()
  let run = []
  const flush = () => {
    const b = evalCodeRun(run)
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

/* ───────────────────────── text, lists (10 levels), & protected tokens ───────────────────────── */

const LIST_RE = /^(?:[•◦▪▫●○■□·‣⁃*](?=\s*\S)|[-–—]\s+\S|\(?\d{1,3}[.)]\s+\S|\d{1,3}(?:\.\d{1,3})+\.?[a-z]?[.)]?\s+\S|\(?[a-z][.)]\s+\S|\([ivxlc]+\)\s+\S)/i
const STANDALONE_MARKER_RE = /^(?:[•◦▪▫●○■□·‣⁃*\-–—]|\(?\d{1,3}(?:\.\d{1,3})*[.)]?|\(?[a-z][.)]|\([ivxlc]+\))$/i
const HEADING_RE = /^(Section|Chapter|Part)\s+\d+\b/i

/**
 * TASK #4: Re-attaches standalone hanging bullet/number markers (e.g. "•" split from
 * "Primary Data Centers" by a hanging tab) before layout/table analysis so list hierarchy
 * is never flattened into prose.
 */
export function attachStandaloneListMarkers(lines, medH) {
  const sorted = [...lines].sort((a, b) => a.yCenter - b.yCenter || a.xMin - b.xMin)
  const absorbed = new Set()
  const merged = []

  for (let i = 0; i < sorted.length; i++) {
    if (absorbed.has(i)) continue
    const l = sorted[i]
    const txt = (l.text || '').trim()
    if (STANDALONE_MARKER_RE.test(txt)) {
      let partnerIdx = -1
      let bestGap = Infinity
      for (let j = i + 1; j < sorted.length; j++) {
        if (absorbed.has(j)) continue
        const r = sorted[j]
        if (Math.abs(r.yCenter - l.yCenter) > medH * 0.6) {
          if (r.yCenter - l.yCenter > medH) break
          continue
        }
        const gap = r.xMin - l.xMax
        if (r.xMin >= l.xMin && gap >= -2 && gap <= medH * 4.0 && gap < bestGap && !STANDALONE_MARKER_RE.test((r.text || '').trim())) {
          bestGap = gap
          partnerIdx = j
        }
      }
      if (partnerIdx !== -1) {
        const p = sorted[partnerIdx]
        absorbed.add(partnerIdx)
        const combined = txt + ' ' + p.text.trim()
        const xMin = Math.min(l.xMin, p.xMin)
        const xMax = Math.max(l.xMax, p.xMax)
        const yMin = Math.min(l.yMin, p.yMin)
        const yMax = Math.max(l.yMax, p.yMax)
        merged.push({
          ...p,
          text: combined,
          xMin, xMax, yMin, yMax,
          bbox: [xMin, yMin, xMax, yMax],
          box: [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax]],
          width: xMax - xMin,
          height: yMax - yMin,
          xCenter: (xMin + xMax) / 2,
          yCenter: (yMin + yMax) / 2,
        })
        continue
      }
    }
    merged.push(l)
  }
  return merged
}

function fixProse(l) {
  if (l.noCorrect || isProtectedText(l.text)) return
  l.text = normalizePunctuation(fixFieldConfusables(l.text))
}

function renderPlainRun(lines, medH, charW, listTreeCollector) {
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
    // Cluster list indent stops (up to 10 nesting levels)
    const levels = []
    for (const x of listXs) {
      if (!levels.length || x - levels[levels.length - 1] > charW * 0.65) {
        if (levels.length < 10) levels.push(x)
      }
    }
    const depthOf = x => {
      let d = 0
      levels.forEach((lx, i) => { if (x >= lx - charW * 0.65) d = Math.min(9, i) })
      return d
    }

    let rowAnchor = null
    let rowText = ''
    const flushRow = () => { if (rowText) out.push(rowText); rowText = ''; rowAnchor = null }

    const nodeStack = []

    for (const l of cl) {
      const isList = LIST_RE.test(l.text)
      const sameRow = !isList && rowAnchor && !LIST_RE.test(rowAnchor.text) &&
        Math.abs(l.yCenter - rowAnchor.yCenter) < medH * 0.5 && l.xMin >= rowAnchor.xMax - charW

      if (sameRow) {
        rowText += (shouldJoinWithoutSpace(rowText, l.text) ? '' : ' ') + l.text
        rowAnchor = l
        continue
      }

      // DEFECT 05: Rejoin wrapped protected tokens across adjacent lines without inserting spaces
      if (!isList && rowAnchor && shouldJoinWithoutSpace(rowText, l.text)) {
        rowText += l.text.trim()
        rowAnchor = l
        continue
      }

      flushRow()
      rowAnchor = l
      if (isList) {
        const depth = depthOf(l.xMin)
        l.regionType = 'LIST'
        l.listLevel = depth
        const t = l.text.replace(/^([•◦▪▫●○■□·‣⁃*])\s*/, (_, m) => normalizeBullet(m) + ' ').replace(/\s+/g, ' ').trim()
        const markerMatch = t.match(/^(\S+)/)
        const marker = markerMatch ? markerMatch[1] : '-'
        rowText = '  '.repeat(depth) + t.replace(/^•(?=\s)/, '-')

        if (listTreeCollector) {
          const node = { level: depth, marker, text: t, bbox: l.bbox, children: [] }
          while (nodeStack.length && nodeStack[nodeStack.length - 1].level >= depth) {
            nodeStack.pop()
          }
          if (nodeStack.length) {
            nodeStack[nodeStack.length - 1].children.push(node)
          } else {
            listTreeCollector.push(node)
          }
          nodeStack.push(node)
        }
      } else if (l.height > medH * 1.35 || (HEADING_RE.test(l.text) && l.text.length < 90 && !/[.]$/.test(l.text))) {
        l.regionType = 'HEADING'
        rowText = `\n## ${l.text}\n`
      } else {
        if (l.script === 'hebrew' || l.script === 'arabic') l.regionType = 'RTL_TEXT'
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
  const listTree = []
  let run = []
  const flushRun = () => {
    if (!run.length) return
    parts.push(renderPlainRun(run, medH, charW, listTree))
    flatLines.push(...run)
    run = []
  }
  for (const it of items) {
    if (it.isTable) { flushRun(); parts.push('\n' + it.table.markdown + '\n'); flatLines.push(...it.lines) }
    else if (it.isCode) { flushRun(); parts.push('```\n' + it.codeText + '\n```'); flatLines.push(...it.lines.map(l => ({ ...l, noCorrect: true }))) }
    else run.push(it)
  }
  flushRun()
  return { text: parts.join('\n'), lines: flatLines, listTree }
}

/* ───────────────────────── form fields (DEFECT 14) ───────────────────────── */

const CHECK_RE = /^\s*(?:(\[)\s*([xX✓✔√]?)\s*(\])|(\()\s*([xX✓✔√]?)\s*(\))|([☐☑☒□○◉]))\s*(.*)$/

export function detectFormFields(lines) {
  const fields = []
  let radioGroup = 0
  let prevRadio = false
  for (const l of lines) {
    const t = l.text
    const m = CHECK_RE.exec(t)
    if (m) {
      const glyph = m[7]
      const isRadioGlyph = glyph === '○' || glyph === '◉'
      const bracket = m[1] ? 'checkbox' : (m[4] || isRadioGlyph) ? 'radio' : 'checkbox'
      const mark = m[2] || m[5] || ''
      const checked = !!mark || glyph === '☑' || glyph === '☒' || glyph === '◉'
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
      const dateMatch = t.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/)
      const type = /signature|sign here/i.test(label) ? 'signature' : /^date\b/i.test(label) ? 'date' : 'text'
      fields.push({ type, label, value: dateMatch ? dateMatch[1] : undefined, bbox: [l.xMin, l.yMin, l.xMax, l.yMax] })
    } else if (/^(signature|sign here)\s*:?\s*$/i.test(t.trim())) {
      fields.push({ type: 'signature', label: t.trim(), bbox: [l.xMin, l.yMin, l.xMax, l.yMax] })
    } else if (/^date\s*:\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i.test(t.trim())) {
      const dm = t.trim().match(/^date\s*:\s*(.+)$/i)
      fields.push({ type: 'date', label: 'Date', value: dm[1].trim(), bbox: [l.xMin, l.yMin, l.xMax, l.yMax] })
    }
  }
  return fields
}

/* ───────────────────────── cross-page header/footer reconciliation (DEFECT 02/13) ───────────────────────── */

const furnitureNorm = s => String(s || '')
  .normalize('NFKC')
  .replace(/[·•●▪◦]/g, '•')
  .replace(/[—–]{1,2}/g, '—')
  .replace(/\s+/g, ' ')
  .trim()

/**
 * Reconciles running headers/footers across pages:
 * - Unifies glyph variants (· vs •, —— vs —) to the majority canonical string
 * - Deduplicates repeated headers/footers inside a page and strips any leaked duplicate from body
 */
export function reconcileDocumentHeadersFooters(pages) {
  if (!pages || pages.length < 2) return pages
  const pickCanonical = (getArr) => {
    const counts = new Map()
    for (const p of pages) {
      const txt = furnitureNorm(getArr(p).map(l => l.text).join(' '))
      if (!txt) continue
      const key = txt.replace(/\d+/g, '#').toLowerCase()
      if (!counts.has(key)) counts.set(key, new Map())
      const variants = counts.get(key)
      variants.set(txt, (variants.get(txt) || 0) + 1)
    }
    const winners = new Map()
    for (const [key, variants] of counts) {
      let bestTxt = '', bestN = 0
      for (const [v, n] of variants) if (n > bestN) { bestTxt = v; bestN = n }
      if (bestN >= 2) winners.set(key, bestTxt)
    }
    return winners
  }

  const hdrWinners = pickCanonical(p => p.headerLines || [])
  const ftrWinners = pickCanonical(p => p.footerLines || [])

  for (const p of pages) {
    const normList = (arr, winners) => {
      const seen = new Set()
      const kept = []
      for (const l of arr || []) {
        const clean = furnitureNorm(l.text)
        const key = clean.replace(/\d+/g, '#').toLowerCase()
        const canonical = winners.get(key) || clean
        const dedupKey = normalizeForCompare(canonical)
        if (!dedupKey || seen.has(dedupKey)) continue
        seen.add(dedupKey)
        kept.push({ ...l, text: canonical })
      }
      return kept
    }
    p.headerLines = normList(p.headerLines, hdrWinners)
    p.footerLines = normList(p.footerLines, ftrWinners)

    // Rebuild text cleanly with single header + body + single footer
    const hdrText = p.headerLines.map(l => l.text).join(' ')
    const ftrText = p.footerLines.map(l => l.text).join(' ')
    const bodyText = (p.bodyText || '').trim()
    p.text = [hdrText, bodyText, ftrText].filter(Boolean).join('\n\n')
    p.lines = [...p.headerLines, ...(p.bodyLines || []), ...p.footerLines]
  }
  return pages
}

/* ───────────────────────── pipeline ───────────────────────── */

export function reconstructPageLayout(rawLines, canvasWidth, canvasHeight, pageNumber = 1) {
  const empty = {
    allLines: [], bodyLines: [], headerLines: [], footerLines: [], fullText: '', bodyText: '',
    avgConfidence: 100.0, lowConfidenceCount: 0, tables: [], codeBlocks: [], listTree: [], formFields: [],
  }
  if (!rawLines || rawLines.length === 0) return empty

  const enriched = enrichLineGeometry(rawLines, pageNumber)
  quarantineGibberish(enriched)
  repairProtectedLines(enriched)
  const medH = median(enriched.map(l => l.height)) || 14
  const charW = Math.max(5, medH * 0.55)
  const { header, body: rawBody, footer } = partitionPageZones(enriched, canvasHeight)
  const body = attachStandaloneListMarkers(rawBody, medH)

  // Code first: detect shaded/monospace/code-shaped runs BEFORE tables and BEFORE any prose
  // normalisation, so code is never tabled, spell-fixed or confusable-fixed.
  const c = findCodeBlocks(body, medH)
  const t = detectTables(c.rest, medH)
  const items = [...t.rest, ...t.blocks, ...c.blocks]
  const ordered = xyCut(items, { medH, minGutter: Math.max(15, charW * 2) })
  const rendered = renderItems(ordered, medH, charW)

  header.forEach(h => { h.text = furnitureNorm(normalizePunctuation(fixFieldConfusables(h.text))) })
  footer.forEach(f => { f.text = furnitureNorm(normalizePunctuation(fixFieldConfusables(f.text))) })
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
    bodyText: rendered.text,
    fullText: textParts.join('\n\n'),
    avgConfidence: avg,
    lowConfidenceCount: lowCount,
    tables: ordered.filter(i => i.isTable).map(i => ({ bbox: [i.xMin, i.yMin, i.xMax, i.yMax], ...i.table })),
    codeBlocks: ordered.filter(i => i.isCode).map(i => ({ bbox: [i.xMin, i.yMin, i.xMax, i.yMax], codeText: i.codeText, ...i.bracketValidation })),
    listTree: rendered.listTree,
    formFields: detectFormFields(allLines),
  }
}
