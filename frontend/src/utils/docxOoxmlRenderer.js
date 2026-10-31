/**
 * docxOoxmlRenderer.js — High-fidelity client-side OOXML DOM renderer
 *
 * Implements strict OOXML parsing to render Word (.docx) documents with
 * exact page geometries, heading bars, tables, typography, and page breaks.
 */

const twipsToPt = (twips) => parseFloat(twips || '0') / 20.0
const halfPtToPt = (sz) => parseFloat(sz || '24') / 2.0
const eighthPtToPt = (sz) => parseFloat(sz || '4') / 8.0

/**
 * Resolves font-family with metric-compatible fallbacks.
 * Times New Roman → Liberation Serif / Tinos
 * Calibri → Carlito
 */
export function resolveFontFamily(fontName) {
  if (!fontName) return "'Times New Roman', 'Liberation Serif', 'Tinos', serif"
  const fn = fontName.toLowerCase()
  if (fn.includes('calibri')) return "'Calibri', 'Carlito', sans-serif"
  if (fn.includes('times')) return "'Times New Roman', 'Liberation Serif', 'Tinos', serif"
  if (fn.includes('arial')) return "'Arial', 'Liberation Sans', sans-serif"
  if (fn.includes('noto sans symbols')) return "'Noto Sans Symbols', sans-serif"
  if (fn.includes('wingdings') || fn.includes('symbol')) return "'Noto Sans Symbols', 'Segoe UI Symbol', sans-serif"
  return `'${fontName}', sans-serif`
}

/**
 * Maps bullet glyph from numbering.xml to visual representation.
 */
function getBulletGlyph(numInfo) {
  if (!numInfo) return '•'
  const text = numInfo.lvlText || ''
  const font = (numInfo.rFonts || '').toLowerCase()

  // Square bullet detection (Wingdings 0xF0A7 or square characters)
  if (
    text === '' ||
    text === '▪' ||
    text === '■' ||
    font.includes('wingdings') ||
    (text.length === 1 && text.charCodeAt(0) === 0xF0A7)
  ) {
    return '▪'
  }

  // Standard round bullet
  if (text === '' || (text.length === 1 && text.charCodeAt(0) === 0xF0B7) || font.includes('symbol')) {
    return '•'
  }

  return text || '•'
}

/**
 * Parses a DOCX ArrayBuffer directly via OOXML DOM and builds page elements.
 */
export async function renderDocxToPages(arrayBuffer, JSZip) {
  const zip = await JSZip.loadAsync(arrayBuffer)

  // 1. Load embedded fonts if present (e.g. word/fonts/NotoSansSymbols-regular.ttf)
  if (typeof document !== 'undefined' && document.fonts && typeof FontFace !== 'undefined') {
    const fontFiles = Object.keys(zip.files).filter(k => k.startsWith('word/fonts/'))
    for (const fPath of fontFiles) {
      try {
        const fontName = fPath.replace(/^word\/fonts\//, '').replace(/\.[^.]+$/, '').replace(/-.*/, '')
        const fontBuf = await zip.files[fPath].async('arraybuffer')
        const face = new FontFace(fontName || 'Noto Sans Symbols', fontBuf)
        await face.load()
        document.fonts.add(face)
      } catch (_) {
        // Fallback to metric system fonts if FontFace fails
      }
    }
  }

  const docXml = await zip.files['word/document.xml'].async('string')
  const stylesXml = await zip.files['word/styles.xml']?.async('string') || ''
  const numberingXml = await zip.files['word/numbering.xml']?.async('string') || ''

  const parser = typeof DOMParser !== 'undefined' ? new DOMParser() : null
  if (!parser) throw new Error('DOMParser is required for OOXML rendering.')

  const doc = parser.parseFromString(docXml, 'text/xml')
  const stylesDoc = stylesXml ? parser.parseFromString(stylesXml, 'text/xml') : null
  const numDoc = numberingXml ? parser.parseFromString(numberingXml, 'text/xml') : null

  // 2. Parse Numbering
  const numMap = {}
  if (numDoc) {
    const abstractNums = {}
    const anNodes = numDoc.getElementsByTagName('w:abstractNum')
    for (let i = 0; i < anNodes.length; i++) {
      const an = anNodes[i]
      const anId = an.getAttribute('w:abstractNumId')
      const lvl = an.getElementsByTagName('w:lvl')[0]
      if (lvl) {
        const numFmt = lvl.getElementsByTagName('w:numFmt')[0]?.getAttribute('w:val') || 'bullet'
        const lvlText = lvl.getElementsByTagName('w:lvlText')[0]?.getAttribute('w:val') || '•'
        const rFonts = lvl.getElementsByTagName('w:rFonts')[0]?.getAttribute('w:ascii') || ''
        const ind = lvl.getElementsByTagName('w:ind')[0]?.getAttribute('w:left') || '720'
        abstractNums[anId] = { numFmt, lvlText, rFonts, indent: twipsToPt(ind) }
      }
    }
    const numNodes = numDoc.getElementsByTagName('w:num')
    for (let i = 0; i < numNodes.length; i++) {
      const num = numNodes[i]
      const numId = num.getAttribute('w:numId')
      const anId = num.getElementsByTagName('w:abstractNumId')[0]?.getAttribute('w:val')
      if (abstractNums[anId]) numMap[numId] = abstractNums[anId]
    }
  }

  // 3. Parse docDefaults and Styles
  let defaultFont = 'Times New Roman'
  let defaultSz = 12
  const styleMap = {}

  if (stylesDoc) {
    const rPrDef = stylesDoc.getElementsByTagName('w:rPrDefault')[0]
    if (rPrDef) {
      const rf = rPrDef.getElementsByTagName('w:rFonts')[0]?.getAttribute('w:ascii')
      if (rf) defaultFont = rf
      const sz = rPrDef.getElementsByTagName('w:sz')[0]?.getAttribute('w:val')
      if (sz) defaultSz = halfPtToPt(sz)
    }

    const styleNodes = stylesDoc.getElementsByTagName('w:style')
    for (let i = 0; i < styleNodes.length; i++) {
      const s = styleNodes[i]
      const id = s.getAttribute('w:styleId')
      const rPr = s.getElementsByTagName('w:rPr')[0]
      const rf = rPr?.getElementsByTagName('w:rFonts')[0]?.getAttribute('w:ascii')
      const sz = rPr?.getElementsByTagName('w:sz')[0]?.getAttribute('w:val')
      styleMap[id] = {
        font: rf || defaultFont,
        sz: sz ? halfPtToPt(sz) : defaultSz,
      }
    }
  }

  // 4. Page Geometry from Section Properties
  let pageW_pt = 595.45
  let pageH_pt = 841.7
  let padTop_pt = 36
  let padRight_pt = 36
  let padBottom_pt = 36
  let padLeft_pt = 36

  const sectPrNodes = doc.getElementsByTagName('w:sectPr')
  if (sectPrNodes.length > 0) {
    const sp = sectPrNodes[0]
    const pgSz = sp.getElementsByTagName('w:pgSz')[0]
    if (pgSz) {
      pageW_pt = twipsToPt(pgSz.getAttribute('w:w'))
      pageH_pt = twipsToPt(pgSz.getAttribute('w:h'))
    }
    const pgMar = sp.getElementsByTagName('w:pgMar')[0]
    if (pgMar) {
      padTop_pt = twipsToPt(pgMar.getAttribute('w:top'))
      padRight_pt = twipsToPt(pgMar.getAttribute('w:right'))
      padBottom_pt = twipsToPt(pgMar.getAttribute('w:bottom'))
      padLeft_pt = twipsToPt(pgMar.getAttribute('w:left'))
    }
  }

  // Helper: render paragraph element
  function createParagraphElement(pNode) {
    const pPr = pNode.getElementsByTagName('w:pPr')[0]
    const pStyle = pPr?.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val')
    const inheritedStyle = styleMap[pStyle] || { font: defaultFont, sz: defaultSz }

    const pBdr = pPr?.getElementsByTagName('w:pBdr')[0]
    const shd = pPr?.getElementsByTagName('w:shd')[0]
    const isHeading = Boolean(pBdr && shd && (shd.getAttribute('w:fill') || '').toUpperCase() === 'D9D9D9')

    const jc = pPr?.getElementsByTagName('w:jc')[0]?.getAttribute('w:val')
    const textAlign = jc === 'both' || jc === 'distribute' ? 'justify' : jc === 'center' ? 'center' : jc === 'right' ? 'right' : 'left'

    const numPr = pPr?.getElementsByTagName('w:numPr')[0]
    const numId = numPr?.getElementsByTagName('w:numId')[0]?.getAttribute('w:val')
    const numInfo = numId ? numMap[numId] : null

    const spacing = pPr?.getElementsByTagName('w:spacing')[0]
    const beforePt = spacing?.getAttribute('w:before') ? twipsToPt(spacing.getAttribute('w:before')) : 0
    const afterPt = spacing?.getAttribute('w:after') ? twipsToPt(spacing.getAttribute('w:after')) : 0

    // Render runs
    const rNodes = pNode.getElementsByTagName('w:r')
    const runSpans = []
    let totalText = ''

    for (let i = 0; i < rNodes.length; i++) {
      const r = rNodes[i]
      const rPr = r.getElementsByTagName('w:rPr')[0]
      const rf = rPr?.getElementsByTagName('w:rFonts')[0]?.getAttribute('w:ascii') || inheritedStyle.font
      const szAttr = rPr?.getElementsByTagName('w:sz')[0]?.getAttribute('w:val')
      const sz = szAttr ? halfPtToPt(szAttr) : inheritedStyle.sz
      const isBold = rPr?.getElementsByTagName('w:b').length > 0
      const isItalic = rPr?.getElementsByTagName('w:i').length > 0
      const isUnderline = rPr?.getElementsByTagName('w:u').length > 0
      const isStrike = rPr?.getElementsByTagName('w:strike').length > 0
      const color = rPr?.getElementsByTagName('w:color')[0]?.getAttribute('w:val') || '000000'

      const tNodes = r.getElementsByTagName('w:t')
      for (let j = 0; j < tNodes.length; j++) {
        const t = tNodes[j]
        const text = t.textContent || ''
        totalText += text
        const isPreserve = t.getAttribute('xml:space') === 'preserve'

        const span = document.createElement('span')
        span.style.fontFamily = resolveFontFamily(rf)
        span.style.fontSize = `${sz}pt`
        span.style.color = `#${color}`
        if (isBold) span.style.fontWeight = 'bold'
        if (isItalic) span.style.fontStyle = 'italic'
        if (isUnderline) span.style.textDecoration = 'underline'
        if (isStrike) span.style.textDecoration = 'line-through'
        if (isPreserve) span.style.whiteSpace = 'pre-wrap'
        span.textContent = text
        runSpans.push(span)
      }
    }

    // Rule 4: Empty paragraphs are real spacing. Keep them with their font size.
    if (!totalText.trim() && !isHeading) {
      const emptyP = document.createElement('p')
      emptyP.style.cssText = `min-height:${inheritedStyle.sz}pt;margin:${beforePt}pt 0 ${afterPt}pt;line-height:1.15;`
      emptyP.innerHTML = '&nbsp;'
      return emptyP
    }

    // Rule 3: Heading bars = full-width grey fill + black 2.25pt top & bottom border.
    if (isHeading) {
      const headDiv = document.createElement('div')
      headDiv.style.cssText = `
        background-color: #D9D9D9;
        border-top: 2.25pt solid #000000;
        border-bottom: 2.25pt solid #000000;
        padding: 2pt 4pt;
        margin: ${Math.max(beforePt, 4)}pt 0 4pt;
        box-sizing: border-box;
        width: 100%;
        text-align: ${textAlign};
        line-height: 1.2;
      `
      runSpans.forEach(s => headDiv.appendChild(s))
      return headDiv
    }

    // Rule 7: Bullets with real square glyphs
    if (numInfo) {
      const bulletContainer = document.createElement('div')
      bulletContainer.style.cssText = `
        display: flex;
        align-items: baseline;
        margin-left: ${numInfo.indent || 18}pt;
        margin-bottom: 2pt;
        line-height: 1.25;
      `
      const bulletGlyph = document.createElement('span')
      bulletGlyph.style.cssText = `
        width: 14pt;
        flex-shrink: 0;
        font-size: 8pt;
        text-align: left;
      `
      bulletGlyph.textContent = getBulletGlyph(numInfo)
      bulletContainer.appendChild(bulletGlyph)

      const contentDiv = document.createElement('div')
      contentDiv.style.cssText = `flex: 1; text-align: ${textAlign};`
      runSpans.forEach(s => contentDiv.appendChild(s))
      bulletContainer.appendChild(contentDiv)

      return bulletContainer
    }

    // Standard paragraph
    const p = document.createElement('p')
    p.style.cssText = `margin:${beforePt}pt 0 ${afterPt}pt;text-align:${textAlign};line-height:1.2;`
    runSpans.forEach(s => p.appendChild(s))
    return p
  }

  // Helper: render table element
  function createTableElement(tblNode) {
    const tbl = document.createElement('table')
    tbl.style.cssText = `
      table-layout: fixed;
      width: 100%;
      border-collapse: collapse;
      margin: 4pt 0;
      border: 0.5pt solid #000000;
    `

    // tblGrid column layout
    const tblGrid = tblNode.getElementsByTagName('w:tblGrid')[0]
    if (tblGrid) {
      const cols = tblGrid.getElementsByTagName('w:gridCol')
      let totalW = 0
      for (let c = 0; c < cols.length; c++) totalW += parseFloat(cols[c].getAttribute('w:w') || '0')
      const colgroup = document.createElement('colgroup')
      for (let c = 0; c < cols.length; c++) {
        const w = parseFloat(cols[c].getAttribute('w:w') || '0')
        const col = document.createElement('col')
        col.style.width = `${((w / totalW) * 100).toFixed(2)}%`
        colgroup.appendChild(col)
      }
      tbl.appendChild(colgroup)
    }

    // Rows and cells
    const trNodes = tblNode.getElementsByTagName('w:tr')
    for (let r = 0; r < trNodes.length; r++) {
      const trNode = trNodes[r]
      const trHeight = trNode.getElementsByTagName('w:trHeight')[0]?.getAttribute('w:val')
      const tr = document.createElement('tr')
      if (trHeight) {
        const hPt = twipsToPt(trHeight)
        tr.style.height = `${hPt}pt`
        tr.style.minHeight = `${hPt}pt`
      }

      const tcNodes = trNode.getElementsByTagName('w:tc')
      for (let c = 0; c < tcNodes.length; c++) {
        const tcNode = tcNodes[c]
        const td = document.createElement('td')
        const vAlign = tcNode.getElementsByTagName('w:vAlign')[0]?.getAttribute('w:val')
        const va = vAlign === 'center' ? 'middle' : vAlign === 'bottom' ? 'bottom' : 'top'

        td.style.cssText = `
          border: 0.5pt solid #000000;
          padding: 2pt 5.4pt;
          box-sizing: border-box;
          vertical-align: ${va};
        `

        const cellPs = tcNode.getElementsByTagName('w:p')
        for (let cp = 0; cp < cellPs.length; cp++) {
          td.appendChild(createParagraphElement(cellPs[cp]))
        }
        tr.appendChild(td)
      }
      tbl.appendChild(tr)
    }

    return tbl
  }

  // 5. Partition Body Elements into Word-accurate Pages
  const body = doc.getElementsByTagName('w:body')[0]
  const children = Array.from(body.childNodes).filter(
    n => n.nodeType === 1 && (n.nodeName === 'w:p' || n.nodeName === 'w:tbl')
  )

  const partitionedPages = [[]]
  let curPage = partitionedPages[0]

  for (const child of children) {
    if (child.nodeName === 'w:p') {
      // Rule 1: Break where Word flows it (lastRenderedPageBreak or explicit page break)
      const hasPageBreak =
        child.getElementsByTagName('w:lastRenderedPageBreak').length > 0 ||
        Array.from(child.getElementsByTagName('w:br')).some(b => b.getAttribute('w:type') === 'page')

      if (hasPageBreak && curPage.length > 0) {
        curPage = []
        partitionedPages.push(curPage)
      }
      curPage.push(child)
    } else {
      curPage.push(child)
    }
  }

  // 6. Build Page DOM containers
  const host = document.createElement('div')
  host.style.cssText = `
    position: fixed;
    top: 0;
    left: -99999px;
    opacity: 0;
    pointer-events: none;
    z-index: -9999;
  `
  document.body.appendChild(host)

  const pageElements = []

  partitionedPages.forEach((elems) => {
    const pageEl = document.createElement('div')
    pageEl.className = 'docx-ooxml-page'
    pageEl.setAttribute('spellcheck', 'false')
    pageEl.setAttribute('contenteditable', 'false')

    // Rules 1, 9, 10
    pageEl.style.cssText = `
      width: ${pageW_pt}pt;
      height: ${pageH_pt}pt;
      min-height: ${pageH_pt}pt;
      max-height: ${pageH_pt}pt;
      box-sizing: border-box;
      padding: ${padTop_pt}pt ${padRight_pt}pt ${padBottom_pt}pt ${padLeft_pt}pt;
      background-color: #ffffff !important;
      color: #000000 !important;
      color-scheme: light !important;
      position: relative;
      overflow: hidden;
      font-family: ${resolveFontFamily(defaultFont)};
      font-size: ${defaultSz}pt;
      line-height: 1.15;
      margin: 0 !important;
      box-shadow: none !important;
    `

    elems.forEach((el) => {
      if (el.nodeName === 'w:p') {
        pageEl.appendChild(createParagraphElement(el))
      } else if (el.nodeName === 'w:tbl') {
        pageEl.appendChild(createTableElement(el))
      }
    })

    host.appendChild(pageEl)
    pageElements.push(pageEl)
  })

  return {
    pages: pageElements,
    pageWidthPt: pageW_pt,
    pageHeightPt: pageH_pt,
    cleanup: () => {
      if (host.parentNode) {
        document.body.removeChild(host)
      }
    },
  }
}
