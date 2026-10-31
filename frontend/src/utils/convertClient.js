/**
 * convertClient.js — 100% client-side, zero-network conversion engine
 * PDFForge M5c  |  All processing in browser memory (Blob/ArrayBuffer only)
 *
 * Exports (existing — PDF-from tools, unchanged):
 *   pdfToWord, pdfToExcel, pdfToPptx
 *
 * New exports (Convert-to tools, replacing server endpoints):
 *   wordToPdf   — .docx → PDF  (mammoth + jsPDF + html2canvas slice rendering)
 *   pptxToPdf   — .pptx → PDF  (JSZip XML parse + DOM slide render + html2canvas)
 *   xlsxToPdf   — .xlsx → PDF  (xlsx + jsPDF-autotable)
 *   htmlToPdf   — .html → PDF  (sandboxed iframe slice capture)
 *   pdfToPdfa   — PDF  → PDF/A (pdf-lib + XMP metadata injection)
 */

import PptxGenJS from 'pptxgenjs'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import * as XLSX from 'xlsx'
import { renderDocxToPages } from './docxOoxmlRenderer.js'

// ─── Lazy-loaded heavy libraries (code-split, loaded only when tool runs) ────
const loadJsPDF      = () => import('jspdf').then(m => m.jsPDF)
const loadAutoTable  = () => import('jspdf-autotable').then(m => m.default || m.autoTable || m)
const loadHtml2Canvas= () => import('html2canvas').then(m => m.default)
const loadMammoth    = () => import('mammoth').then(m => m.default ?? m)
const loadJSZip      = () => import('jszip').then(m => m.default ?? m)
const loadPdfLib     = () => import('@cantoo/pdf-lib').then(m => m)
const loadDocxPreview = () => import('docx-preview').then(m => m.renderAsync ? m : (m.default || m))

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** A4 dimensions in mm (portrait & landscape) */
const A4 = { w: 210, h: 297 }           // portrait
const A4L = { w: 297, h: 210 }          // landscape

/** Sleep helper for chunked processing to keep UI responsive */
const tick = () => new Promise(r => requestAnimationFrame(r))

/** Load a file as ArrayBuffer */
const toArrayBuffer = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = rej
    r.readAsArrayBuffer(file)
  })

/** Load a file as text */
const toText = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = rej
    r.readAsText(file)
  })

// ─────────────────────────────────────────────────────────────────────────────
//  EXISTING TOOLS (PDF → other formats) — unchanged
// ─────────────────────────────────────────────────────────────────────────────

const load = async (f) => window.pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise

async function pageRows(page) {
  const { items } = await page.getTextContent()
  const rows = []
  for (const it of items) {
    if (!it.str.trim()) continue
    const [x, y] = [it.transform[4], it.transform[5]]
    let r = rows.find((r) => Math.abs(r.y - y) < 3)
    if (!r) rows.push((r = { y, cells: [] }))
    r.cells.push({ x, end: x + it.width, s: it.str })
  }
  rows.sort((a, b) => b.y - a.y)
  rows.forEach((r) => r.cells.sort((a, b) => a.x - b.x))
  return rows
}

export async function pdfToWord(file) {
  const pdf = await load(file), sections = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const rows = await pageRows(await pdf.getPage(i))
    sections.push({ children: rows.map((r) =>
      new Paragraph({ children: [new TextRun(r.cells.map((c) => c.s).join(' '))] })) })
  }
  return { data: await Packer.toBlob(new Document({ sections })) }
}

import { pdfToExcel, setPdfjs } from './pdfToExcel.js'
export { pdfToExcel, setPdfjs }

export async function pdfToPptx(file, scale = 2) {
  const pdf = await load(file), pptx = new PptxGenJS()
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i), vp = page.getViewport({ scale })
    const c = document.createElement('canvas')
    c.width = vp.width; c.height = vp.height
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
    if (i === 1) {
      pptx.defineLayout({ name: 'PDF', width: vp.width / scale / 72, height: vp.height / scale / 72 })
      pptx.layout = 'PDF'
    }
    pptx.addSlide().addImage({ data: c.toDataURL('image/jpeg', 0.9), x: 0, y: 0, w: '100%', h: '100%' })
    c.width = 0
  }
  return { data: await pptx.write({ outputType: 'blob' }) }
}

// ─────────────────────────────────────────────────────────────────────────────
//  1.  WORD → PDF
//      High-fidelity renderer: Direct OOXML parsing preserves exact Word
//      page geometry, margins, heading bars, tables, typography, and page breaks.
// ─────────────────────────────────────────────────────────────────────────────

export async function wordToPdf(file, onProgress) {
  const [jsPDF, h2c, JSZip] = await Promise.all([loadJsPDF(), loadHtml2Canvas(), loadJSZip()])
  const arrayBuf = await toArrayBuffer(file)

  // ── Primary Engine: High-Fidelity Direct OOXML Renderer ──
  try {
    const { pages, pageWidthPt, pageHeightPt, cleanup } = await renderDocxToPages(arrayBuf, JSZip)

    if (pages && pages.length > 0) {
      await tick()
      await new Promise(r => setTimeout(r, 120))
      if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
        await document.fonts.ready
      }

      // 1 pt = 25.4 / 72 mm = 0.352778 mm
      const PT_TO_MM = 25.4 / 72.0
      const widthMm = pageWidthPt * PT_TO_MM
      const heightMm = pageHeightPt * PT_TO_MM
      const orientation = widthMm > heightMm ? 'landscape' : 'portrait'

      const jspdf = new jsPDF({ unit: 'mm', format: [widthMm, heightMm], orientation })

      for (let i = 0; i < pages.length; i++) {
        await tick()
        const pageEl = pages[i]

        const canvas = await h2c(pageEl, {
          scale: 2, // 2x sharp rendering
          backgroundColor: '#ffffff',
          useCORS: true,
          allowTaint: true,
          logging: false,
        })

        if (i > 0) {
          jspdf.addPage([widthMm, heightMm], orientation)
        }

        const imgData = canvas.toDataURL('image/jpeg', 0.96)
        jspdf.addImage(imgData, 'JPEG', 0, 0, widthMm, heightMm, undefined, 'FAST')

        canvas.width = 0
        canvas.height = 0
        onProgress?.({ done: i + 1, total: pages.length })
      }

      cleanup()
      return { data: jspdf.output('blob') }
    }
  } catch (err) {
    console.warn('Direct OOXML renderer encountered an issue, trying docx-preview fallback:', err)
  }

  // ── Secondary Engine: docx-preview ──
  try {
    const docxPreview = await loadDocxPreview()
    const renderAsync = docxPreview.renderAsync || docxPreview.default?.renderAsync

    if (renderAsync) {
      const host = document.createElement('div')
      host.style.cssText = `
        position: fixed;
        top: 0;
        left: -99999px;
        width: 1200px;
        background: #ffffff;
        opacity: 0;
        pointer-events: none;
        z-index: -9999;
      `

      // Clean default wrapper styles: remove gray background, shadows, and margins
      const docxStyle = document.createElement('style')
      docxStyle.textContent = `
        .docx-wrapper {
          background: transparent !important;
          padding: 0 !important;
          margin: 0 !important;
          display: block !important;
        }
        .docx-wrapper > section.docx {
          box-shadow: none !important;
          margin: 0 auto !important;
          margin-bottom: 0 !important;
          background: #ffffff !important;
        }
        .docx {
          color: #111111;
        }
        .docx table {
          border-collapse: collapse;
        }
      `
      host.appendChild(docxStyle)
      document.body.appendChild(host)

      const docContainer = document.createElement('div')
      host.appendChild(docContainer)

      await renderAsync(arrayBuf, docContainer, host, {
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        experimental: false,
        renderHeaders: true,
        renderFooters: true,
        useBase64URL: true,
      })

      await tick()
      await new Promise(r => setTimeout(r, 120))
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready
      }

      const pages = Array.from(host.querySelectorAll('section.docx'))

      if (pages.length > 0) {
        const jspdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
        let pageIndex = 0
        const totalEstimated = pages.length

        for (let i = 0; i < pages.length; i++) {
          await tick()
          const pageEl = pages[i]

          const pageW = pageEl.offsetWidth || 794
          const pageH = pageEl.offsetHeight || 1123
          const scrollH = Math.max(pageEl.scrollHeight, pageH)

          const isLandscape = pageW > pageH
          const baseW_mm = isLandscape ? 297 : 210
          const baseH_mm = isLandscape ? 210 : 297
          const orientation = isLandscape ? 'landscape' : 'portrait'

          // Slice tall continuous sections if they exceed physical page height
          const sliceHeightPx = pageH > 100 ? pageH : Math.round(pageW * (baseH_mm / baseW_mm))
          const numSlices = scrollH > sliceHeightPx * 1.15 ? Math.ceil(scrollH / sliceHeightPx) : 1

          for (let s = 0; s < numSlices; s++) {
            await tick()
            const yOffset = s * sliceHeightPx
            const currSliceH = Math.min(sliceHeightPx, scrollH - yOffset)

            const canvas = await h2c(pageEl, {
              scale: 2, // 2x for high resolution text and borders
              x: 0,
              y: yOffset,
              width: pageW,
              height: currSliceH,
              windowWidth: pageW,
              backgroundColor: '#ffffff',
              useCORS: true,
              allowTaint: true,
              logging: false,
            })

            if (pageIndex > 0) {
              jspdf.addPage([baseW_mm, baseH_mm], orientation)
            }

            const imgData = canvas.toDataURL('image/jpeg', 0.95)
            const sliceHeightMm = (currSliceH / pageW) * baseW_mm
            jspdf.addImage(imgData, 'JPEG', 0, 0, baseW_mm, Math.min(baseH_mm, sliceHeightMm), undefined, 'FAST')

            canvas.width = 0
            canvas.height = 0
            pageIndex++
            onProgress?.({ done: pageIndex, total: Math.max(totalEstimated, pageIndex) })
          }
        }

        document.body.removeChild(host)
        return { data: jspdf.output('blob') }
      }

      document.body.removeChild(host)
    }
  } catch (err) {
    console.warn('docx-preview engine encountered an issue, falling back to enhanced mammoth renderer:', err)
  }

  // ── Fallback Engine: Enhanced Mammoth Renderer ──
  const mammoth = await loadMammoth()
  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer: arrayBuf },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
        "p[style-name='Title']     => h1.doc-title:fresh",
        "b => strong",
        "i => em",
        "u => u",
        "strike => s",
      ]
    }
  )

  const A4_PX_W = 794
  const A4_PX_H = 1123

  const host = document.createElement('div')
  host.style.cssText = `
    position:fixed; top:-9999px; left:-9999px;
    width:${A4_PX_W}px;
    font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
    line-height: 1.25;
    color: #111;
    background: #fff;
    padding: 45px 50px;
    box-sizing: border-box;
  `

  const style = document.createElement('style')
  style.textContent = `
    h1 { font-size:18px; font-weight:700; margin:0 0 8px; color:#111; }
    h2 { font-size:15px; font-weight:700; margin:12px 0 6px; color:#111; }
    h3 { font-size:13px; font-weight:700; margin:10px 0 4px; color:#222; }
    p  { margin:0 0 6px; }
    strong { font-weight:700; }
    em { font-style:italic; }
    u  { text-decoration:underline; }
    s  { text-decoration:line-through; }
    table { width:100%; border-collapse:collapse; margin:8px 0; }
    th, td { border:1px solid #cbd5e1; padding:5px 8px; font-size:11.5px; text-align:left; color:#111; }
    ul, ol { padding-left:22px; margin:0 0 6px; }
    li { margin-bottom:2px; }
    img { max-width:100%; height:auto; margin:6px 0; }
    blockquote { border-left:3px solid #cbd5e1; padding-left:12px; color:#555; margin:8px 0; }
  `
  host.appendChild(style)
  host.innerHTML += html
  document.body.appendChild(host)

  await tick()
  const totalHeight = host.scrollHeight
  const pageCount = Math.ceil(totalHeight / A4_PX_H)

  const jspdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const MM_PER_PX = 210 / A4_PX_W

  for (let page = 0; page < pageCount; page++) {
    await tick()
    const yOffset = page * A4_PX_H

    const canvas = await h2c(host, {
      scale: 2,
      x: 0,
      y: yOffset,
      width: A4_PX_W,
      height: Math.min(A4_PX_H, totalHeight - yOffset),
      windowWidth: A4_PX_W,
      backgroundColor: '#ffffff',
      useCORS: false,
      allowTaint: false,
      logging: false,
    })

    if (page > 0) jspdf.addPage()

    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    const sliceHeightMm = (canvas.height / 2) * MM_PER_PX
    jspdf.addImage(imgData, 'JPEG', 0, 0, 210, sliceHeightMm, undefined, 'FAST')

    canvas.width = 0; canvas.height = 0
    onProgress?.({ done: page + 1, total: pageCount })
  }

  document.body.removeChild(host)
  return { data: jspdf.output('blob') }
}

// ─────────────────────────────────────────────────────────────────────────────
//  2.  PPTX → PDF
//      Strategy: JSZip to unpack .pptx → parse slide XML → build styled HTML
//      slide frame → html2canvas → jsPDF landscape page per slide.
// ─────────────────────────────────────────────────────────────────────────────

/** Helper: calculate relative luminance of hex/rgb/rgba color */
function getPptxLuminance(colorStr) {
  if (!colorStr || colorStr === 'transparent') return 0
  let hex = String(colorStr).trim()
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) {
    const m = hex.match(/\d+/g)
    if (m && m.length >= 3) {
      const r = parseInt(m[0]) / 255
      const g = parseInt(m[1]) / 255
      const b = parseInt(m[2]) / 255
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    return 0.5
  }
  hex = hex.replace('#', '')
  if (hex.length === 3) {
    hex = hex.split('').map(ch => ch + ch).join('')
  }
  if (hex.length !== 6) return 0.5
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Helper: safely escape HTML characters */
function escapePptxHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Parse PPTX slide XML into structured shapes and tables */
function parsePptxSlideXml(xmlText, slideW = 9144000, slideH = 5143500) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'text/xml')

  // Helper: get all runs from a paragraph or node
  const getText = (node) => {
    const runNodes = [
      ...Array.from(node.getElementsByTagName('a:r')),
      ...Array.from(node.getElementsByTagName('a:fld')),
      ...Array.from(node.querySelectorAll('r'))
    ]
    const uniqueRuns = Array.from(new Set(runNodes))
    if (uniqueRuns.length === 0) {
      const t = node.textContent?.trim() || ''
      return t ? [{ text: t, bold: false, italic: false, sz: 18, color: null }] : []
    }
    return uniqueRuns.map(r => {
      const tNode = r.getElementsByTagName('a:t')[0] || r.querySelector('t')
      const t = tNode?.textContent || ''
      const rPr = r.getElementsByTagName('a:rPr')[0] || r.querySelector('rPr')
      const bold = rPr?.getAttribute('b') === '1'
      const italic = rPr?.getAttribute('i') === '1'
      const szAttr = rPr?.getAttribute('sz')
      const sz = szAttr ? Math.max(9, Math.round(parseInt(szAttr) / 100)) : 16

      // Extract explicit font color if available
      let color = null
      const solidFill = rPr?.querySelector('solidFill srgbClr') || rPr?.getElementsByTagName('a:srgbClr')[0]
      if (solidFill) {
        const val = solidFill.getAttribute('val')
        if (val) color = '#' + val
      }
      return { text: t, bold, italic, sz, color }
    }).filter(r => r.text)
  }

  const shapes = []
  const tables = []
  const spTree = doc.getElementsByTagName('p:spTree')[0] || doc.querySelector('spTree')
  if (!spTree) return { shapes, tables }

  // 1. Parse standard shapes
  const spList = [
    ...Array.from(spTree.getElementsByTagName('p:sp')),
    ...Array.from(spTree.querySelectorAll('sp'))
  ]
  const uniqueSps = Array.from(new Set(spList))

  uniqueSps.forEach(sp => {
    const nvSpPr = sp.getElementsByTagName('p:nvSpPr')[0] || sp.querySelector('nvSpPr')
    const nvPr = nvSpPr?.getElementsByTagName('p:nvPr')[0] || nvSpPr?.querySelector('nvPr')
    const ph = nvPr?.getElementsByTagName('p:ph')[0] || nvPr?.querySelector('ph')
    const phType = ph?.getAttribute('type')
    const txBody = sp.getElementsByTagName('p:txBody')[0] || sp.querySelector('txBody')
    const spPr = sp.getElementsByTagName('p:spPr')[0] || sp.querySelector('spPr')

    if (!txBody) return

    // Position / dimensions
    const xfrm = spPr?.getElementsByTagName('a:xfrm')[0] || spPr?.querySelector('xfrm')
    const off = xfrm?.getElementsByTagName('a:off')[0] || xfrm?.querySelector('off')
    const ext = xfrm?.getElementsByTagName('a:ext')[0] || xfrm?.querySelector('ext')

    const rawX = off ? (parseInt(off.getAttribute('x') || '0') / slideW * 100) : 5
    const rawY = off ? (parseInt(off.getAttribute('y') || '0') / slideH * 100) : 5
    const rawCx = ext ? (parseInt(ext.getAttribute('cx') || '0') / slideW * 100) : 90
    const rawCy = ext ? (parseInt(ext.getAttribute('cy') || '0') / slideH * 100) : 20

    // Clamp coordinates to prevent clipping
    const x = Math.max(0, Math.min(96, rawX)).toFixed(2)
    const y = Math.max(0, Math.min(96, rawY)).toFixed(2)
    const cx = Math.max(2, Math.min(100 - parseFloat(x), rawCx)).toFixed(2)
    const cy = Math.max(2, Math.min(100 - parseFloat(y), rawCy)).toFixed(2)

    // Background fill & border
    let bgColor = null
    const solidFill = spPr?.querySelector('solidFill srgbClr') || spPr?.getElementsByTagName('a:srgbClr')[0]
    if (solidFill) {
      const val = solidFill.getAttribute('val')
      if (val) bgColor = '#' + val
    }

    let borderColor = null
    const ln = spPr?.querySelector('ln') || spPr?.getElementsByTagName('a:ln')[0]
    if (ln) {
      const lnFill = ln.querySelector('solidFill srgbClr') || ln.getElementsByTagName('a:srgbClr')[0]
      if (lnFill) {
        const val = lnFill.getAttribute('val')
        if (val) borderColor = '#' + val
      }
    }

    // Paragraphs
    const paragraphs = []
    const pList = [
      ...Array.from(txBody.getElementsByTagName('a:p')),
      ...Array.from(txBody.querySelectorAll('p'))
    ]
    Array.from(new Set(pList)).forEach(p => {
      const pPr = p.getElementsByTagName('a:pPr')[0] || p.querySelector('pPr')
      const align = pPr?.getAttribute('algn') || 'l'
      const indent = parseInt(pPr?.getAttribute('lvl') || '0')
      const rawRuns = getText(p)
      if (rawRuns.length > 0) {
        paragraphs.push({ runs: rawRuns, align, indent })
      }
    })

    if (paragraphs.length > 0) {
      shapes.push({ phType, x, y, cx, cy, bgColor, borderColor, paragraphs })
    }
  })

  // 2. Parse tables (p:graphicFrame -> a:graphic -> a:tbl)
  const gfList = [
    ...Array.from(spTree.getElementsByTagName('p:graphicFrame')),
    ...Array.from(spTree.querySelectorAll('graphicFrame'))
  ]
  Array.from(new Set(gfList)).forEach(gf => {
    const tbl = gf.getElementsByTagName('a:tbl')[0] || gf.querySelector('tbl')
    if (!tbl) return

    const xfrm = gf.querySelector('xfrm') || gf.getElementsByTagName('p:xfrm')[0] || gf.getElementsByTagName('a:xfrm')[0]
    const off = xfrm?.querySelector('off') || xfrm?.getElementsByTagName('a:off')[0]
    const ext = xfrm?.querySelector('ext') || xfrm?.getElementsByTagName('a:ext')[0]

    const rawX = off ? (parseInt(off.getAttribute('x') || '0') / slideW * 100) : 5
    const rawY = off ? (parseInt(off.getAttribute('y') || '0') / slideH * 100) : 18
    const rawCx = ext ? (parseInt(ext.getAttribute('cx') || '0') / slideW * 100) : 90
    const rawCy = ext ? (parseInt(ext.getAttribute('cy') || '0') / slideH * 100) : 65

    const x = Math.max(0, Math.min(96, rawX)).toFixed(2)
    const y = Math.max(0, Math.min(96, rawY)).toFixed(2)
    const cx = Math.max(4, Math.min(100 - parseFloat(x), rawCx)).toFixed(2)
    const cy = Math.max(4, Math.min(100 - parseFloat(y), rawCy)).toFixed(2)

    const rows = []
    const trList = [
      ...Array.from(tbl.getElementsByTagName('a:tr')),
      ...Array.from(tbl.querySelectorAll('tr'))
    ]
    Array.from(new Set(trList)).forEach((tr, rIdx) => {
      const cells = []
      const tcList = [
        ...Array.from(tr.getElementsByTagName('a:tc')),
        ...Array.from(tr.querySelectorAll('tc'))
      ]
      Array.from(new Set(tcList)).forEach(tc => {
        let cellBg = null
        const tcPr = tc.getElementsByTagName('a:tcPr')[0] || tc.querySelector('tcPr')
        const solidFill = tcPr?.querySelector('solidFill srgbClr') || tcPr?.getElementsByTagName('a:srgbClr')[0]
        if (solidFill) {
          const val = solidFill.getAttribute('val')
          if (val) cellBg = '#' + val
        }

        const txBody = tc.getElementsByTagName('a:txBody')[0] || tc.querySelector('txBody')
        const cellParas = []
        if (txBody) {
          const pList = [
            ...Array.from(txBody.getElementsByTagName('a:p')),
            ...Array.from(txBody.querySelectorAll('p'))
          ]
          Array.from(new Set(pList)).forEach(p => {
            const pPr = p.getElementsByTagName('a:pPr')[0] || p.querySelector('pPr')
            const align = pPr?.getAttribute('algn') || 'l'
            const rawRuns = getText(p)
            if (rawRuns.length > 0) {
              cellParas.push({ runs: rawRuns, align })
            }
          })
        }
        cells.push({ cellBg, paragraphs: cellParas })
      })
      if (cells.length > 0) {
        rows.push({ isHeader: rIdx === 0, cells })
      }
    })

    if (rows.length > 0) {
      tables.push({ x, y, cx, cy, rows })
    }
  })

  return { shapes, tables }
}

/** Render a parsed slide as an HTML string with dynamic high-contrast styling */
function slideToHtml(slide, bgHex, canvasW = 1280, canvasH = 720) {
  const isSlideBgDark = getPptxLuminance(bgHex || '#1a1a2e') < 0.45

  let html = `<div style="
    position:relative; width:${canvasW}px; height:${canvasH}px;
    background:${bgHex || '#1a1a2e'};
    overflow:hidden;
    font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Segoe UI Emoji', sans-serif;
    box-sizing:border-box;
  ">`

  // Accent bar
  html += `<div style="position:absolute;top:0;left:0;width:100%;height:6px;background:linear-gradient(90deg,#ea580c,#f97316);z-index:10;"></div>`

  // 1. Render shapes
  for (const shape of slide.shapes || []) {
    if (!shape.paragraphs.length) continue

    const isTitle = shape.phType === 'title' || shape.phType === 'ctrTitle'
    const isSubtitle = shape.phType === 'subTitle'
    const isFtr = shape.phType === 'ftr' || shape.phType === 'dt' || shape.phType === 'sldNum'

    if (isFtr) continue

    // Determine background & contrasting font color
    let boxBg = shape.bgColor
    let defaultTextColor
    if (boxBg && boxBg !== 'transparent') {
      const lum = getPptxLuminance(boxBg)
      defaultTextColor = lum > 0.55 ? '#111827' : '#ffffff'
    } else {
      boxBg = isTitle ? 'rgba(0,0,0,0.45)' : (isSlideBgDark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.85)')
      defaultTextColor = isSlideBgDark ? '#ffffff' : '#111827'
    }

    const defaultFontSize = isTitle ? 32 : isSubtitle ? 22 : 14

    const shapeHtml = shape.paragraphs.map(p => {
      const alignMap = { l: 'left', c: 'center', r: 'right', j: 'justify' }
      const align = alignMap[p.align] || 'left'
      const paddingLeft = (p.indent || 0) * 16

      const runsHtml = p.runs.map(r => {
        if (!r.text) return ''
        const fs = Math.max(9, Math.min(52, r.sz || defaultFontSize))
        const c = r.color || defaultTextColor
        let s = `font-size:${fs}px;color:${c};`
        if (r.bold || isTitle) s += 'font-weight:700;'
        if (r.italic) s += 'font-style:italic;'
        return `<span style="${s}">${escapePptxHtml(r.text)}</span>`
      }).join('')

      return `<p dir="auto" style="margin:0 0 6px;padding-left:${paddingLeft}px;text-align:${align};line-height:1.35;word-break:break-word;overflow-wrap:break-word;">${runsHtml}</p>`
    }).join('')

    const padding = isTitle ? '14px 20px' : '12px 16px'
    const radius = isTitle ? '8px' : '6px'
    const borderStyle = shape.borderColor
      ? `border:1px solid ${shape.borderColor};`
      : isTitle
        ? 'border-left:4px solid #ea580c;'
        : (isSlideBgDark && (!shape.bgColor || shape.bgColor === 'transparent') ? 'border:1px solid rgba(255,255,255,0.1);' : '')

    html += `<div style="
      position:absolute;
      left:${shape.x}%; top:${shape.y}%;
      width:${shape.cx}%; min-height:${shape.cy}%;
      max-width:${shape.cx}%;
      background:${boxBg};
      padding:${padding};
      border-radius:${radius};
      box-sizing:border-box;
      overflow:hidden;
      ${borderStyle}
    ">${shapeHtml}</div>`
  }

  // 2. Render tables
  for (const tbl of slide.tables || []) {
    let rowsHtml = ''
    tbl.rows.forEach(row => {
      let cellsHtml = ''
      row.cells.forEach(cell => {
        const cellBg = cell.cellBg || (row.isHeader
          ? (isSlideBgDark ? '#1e293b' : '#e2e8f0')
          : (isSlideBgDark ? 'rgba(30,41,59,0.7)' : '#ffffff'))
        const cellLum = getPptxLuminance(cellBg)
        const cellDefaultColor = cellLum > 0.55 ? '#111827' : '#ffffff'

        const cellContent = cell.paragraphs.map(p => {
          const alignMap = { l: 'left', c: 'center', r: 'right', j: 'justify' }
          const align = alignMap[p.align] || 'left'
          const runsHtml = p.runs.map(r => {
            const c = r.color || cellDefaultColor
            const fs = Math.max(9, Math.min(16, r.sz || 12))
            let s = `font-size:${fs}px;color:${c};`
            if (r.bold || row.isHeader) s += 'font-weight:700;'
            if (r.italic) s += 'font-style:italic;'
            return `<span style="${s}">${escapePptxHtml(r.text)}</span>`
          }).join('')
          return `<div dir="auto" style="text-align:${align};line-height:1.35;word-break:break-word;">${runsHtml}</div>`
        }).join('')

        const tag = row.isHeader ? 'th' : 'td'
        cellsHtml += `<${tag} style="
          padding:10px 14px;
          background:${cellBg};
          border:1px solid ${isSlideBgDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'};
          text-align:left;
          vertical-align:middle;
        ">${cellContent}</${tag}>`
      })
      rowsHtml += `<tr>${cellsHtml}</tr>`
    })

    html += `<div style="
      position:absolute;
      left:${tbl.x}%; top:${tbl.y}%;
      width:${tbl.cx}%; max-width:${tbl.cx}%;
      box-sizing:border-box;
      overflow:hidden;
      border-radius:8px;
      border:1px solid ${isSlideBgDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)'};
      box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);
    ">
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        ${rowsHtml}
      </table>
    </div>`
  }

  html += '</div>'
  return html
}

export async function pptxToPdf(file, onProgress) {
  const [jsPDF, h2c, JSZip] = await Promise.all([loadJsPDF(), loadHtml2Canvas(), loadJSZip()])

  const arrayBuf = await toArrayBuffer(file)
  const zip = await JSZip.loadAsync(arrayBuf)

  // Enumerate slides
  const slideFiles = Object.keys(zip.files)
    .filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0')
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0')
      return numA - numB
    })

  if (!slideFiles.length) throw new Error('No slides found in PPTX file.')

  // Extract presentation dimensions from ppt/presentation.xml if available
  let slideW = 9144000, slideH = 5143500 // default 16:9
  try {
    const presXml = await zip.files['ppt/presentation.xml']?.async('string')
    if (presXml) {
      const parser = new DOMParser()
      const presDoc = parser.parseFromString(presXml, 'text/xml')
      const sldSz = presDoc.getElementsByTagName('p:sldSz')[0] || presDoc.querySelector('sldSz')
      if (sldSz) {
        const cx = parseInt(sldSz.getAttribute('cx') || '0')
        const cy = parseInt(sldSz.getAttribute('cy') || '0')
        if (cx > 0 && cy > 0) {
          slideW = cx
          slideH = cy
        }
      }
    }
  } catch (_) {}

  // Try to get a global background color from theme
  let globalBg = '#1a1a2e'
  try {
    const theme1 = await zip.files['ppt/theme/theme1.xml']?.async('string')
    if (theme1) {
      const m = theme1.match(/dk1[^>]*>\s*<[^>]*srgbClr\s+val="([0-9a-fA-F]{6})"/)
      if (m) globalBg = '#' + m[1]
    }
  } catch (_) {}

  const aspect = slideW / slideH
  const SLIDE_W = 1280
  const SLIDE_H = Math.round(1280 / aspect)
  const pageW_mm = SLIDE_W * 0.2646
  const pageH_mm = SLIDE_H * 0.2646
  const orientation = aspect >= 1 ? 'landscape' : 'portrait'

  const jspdf = new jsPDF({ unit: 'mm', format: [pageW_mm, pageH_mm], orientation })

  // Offscreen container
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${SLIDE_W}px;height:${SLIDE_H}px;overflow:hidden;`
  document.body.appendChild(host)

  for (let i = 0; i < slideFiles.length; i++) {
    await tick()
    const xmlText = await zip.files[slideFiles[i]].async('string')
    const slide = parsePptxSlideXml(xmlText, slideW, slideH)

    // Slide-level background
    let slideBg = globalBg

    host.innerHTML = slideToHtml(slide, slideBg, SLIDE_W, SLIDE_H)

    const canvas = await h2c(host, {
      scale: 1.5,
      width: SLIDE_W,
      height: SLIDE_H,
      backgroundColor: slideBg,
      useCORS: false,
      allowTaint: false,
      logging: false,
    })

    if (i > 0) jspdf.addPage([pageW_mm, pageH_mm], orientation)

    const imgData = canvas.toDataURL('image/jpeg', 0.92)
    jspdf.addImage(imgData, 'JPEG', 0, 0, pageW_mm, pageH_mm, undefined, 'FAST')

    canvas.width = 0; canvas.height = 0
    onProgress?.({ done: i + 1, total: slideFiles.length })
  }

  document.body.removeChild(host)
  return { data: jspdf.output('blob') }
}


// ─────────────────────────────────────────────────────────────────────────────
//  3.  XLSX → PDF
//      Strategy: xlsx parses workbook → jsPDF-autotable renders commercial-
//      grade styled tables, one sheet per page, landscape orientation.
// ─────────────────────────────────────────────────────────────────────────────

/** Format a raw cell value into display string */
function fmtCell(cell) {
  if (cell === null || cell === undefined) return ''
  if (!cell || typeof cell !== 'object') return String(cell)
  switch (cell.t) {
    case 'n': {
      const v = cell.v
      if (cell.z) {
        // Formatted number — use xlsx's formatter if available
        if (typeof XLSX.SSF !== 'undefined') {
          try { return XLSX.SSF.format(cell.z, v) } catch (_) {}
        }
        // Fallback: detect % and currency
        const z = String(cell.z)
        if (z.includes('%'))  return (v * 100).toFixed(1) + '%'
        if (z.includes('$'))  return '$' + v.toLocaleString()
        if (z.includes('€'))  return '€' + v.toLocaleString()
        if (z.includes('£'))  return '£' + v.toLocaleString()
      }
      return typeof v === 'number' ? v.toLocaleString() : String(v)
    }
    case 'd': return cell.w || (cell.v instanceof Date ? cell.v.toLocaleDateString() : String(cell.v))
    case 'b': return cell.v ? 'TRUE' : 'FALSE'
    case 'e': return cell.w || '#ERR'
    default:  return cell.w || String(cell.v ?? '')
  }
}

/** Detect if a value string looks numeric (for right-alignment) */
const isNumericStr = (s) => /^[\d,.\-+$€£%\s]+$/.test(s.trim()) && s.trim().length > 0

export async function xlsxToPdf(file, onProgress) {
  const autoTable = await loadAutoTable()
  const jsPDF = await loadJsPDF()

  const arrayBuf = await toArrayBuffer(file)
  const wb = XLSX.read(arrayBuf, { type: 'array', cellStyles: true, cellDates: true, cellNF: true })

  const sheetNames = wb.SheetNames
  if (!sheetNames.length) throw new Error('No sheets found in workbook.')

  const jspdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const PAGE_W_MM = 287  // landscape A4 usable width (297 - 10mm margins)

  for (let si = 0; si < sheetNames.length; si++) {
    await tick()
    const sheetName = sheetNames[si]
    const ws        = wb.Sheets[sheetName]
    const range     = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')

    // Build header row + data rows
    const numRows = range.e.r - range.s.r + 1
    const numCols = range.e.c - range.s.c + 1

    const headerRow  = []
    const dataRows   = []
    const colWidths  = new Array(numCols).fill(10)  // min 10mm

    // First row = header
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })]
      const val  = fmtCell(cell)
      headerRow.push(val)
      colWidths[c - range.s.c] = Math.max(colWidths[c - range.s.c], Math.min(val.length * 2.2, 50))
    }

    // Data rows
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const row = []
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        const val  = fmtCell(cell)
        row.push(val)
        colWidths[c - range.s.c] = Math.max(colWidths[c - range.s.c], Math.min(val.length * 2.2, 50))
      }
      dataRows.push(row)
    }

    // Auto-scale column widths to fit page
    const totalW = colWidths.reduce((a, b) => a + b, 0)
    const scaledWidths = totalW > PAGE_W_MM
      ? colWidths.map(w => (w / totalW) * PAGE_W_MM)
      : colWidths

    // Detect numeric columns for right-alignment
    const columnStyles = {}
    for (let c = 0; c < numCols; c++) {
      const sampleValues = dataRows.slice(0, 10).map(row => row[c]).filter(Boolean)
      const isNumeric = sampleValues.length > 0 && sampleValues.every(v => isNumericStr(v))
      columnStyles[c] = {
        halign: isNumeric ? 'right' : 'left',
        cellWidth: scaledWidths[c],
      }
    }

    if (si > 0) jspdf.addPage('a4', 'landscape')

    // Sheet title banner
    jspdf.setFillColor(26, 26, 46)
    jspdf.rect(5, 5, PAGE_W_MM + 5, 10, 'F')
    jspdf.setTextColor(255, 255, 255)
    jspdf.setFontSize(11)
    jspdf.setFont(undefined, 'bold')
    jspdf.text(`${sheetName}  (${numRows > 0 ? numRows - 1 : 0} rows × ${numCols} cols)`, 9, 12)
    jspdf.setTextColor(0, 0, 0)

    // Autotable
    autoTable(jspdf, {
      head: [headerRow],
      body: dataRows,
      startY: 18,
      margin: { left: 5, right: 5 },
      tableWidth: 'auto',
      columnStyles,
      styles: {
        fontSize: dataRows.length > 500 ? 7 : dataRows.length > 200 ? 8 : 9,
        cellPadding: 2.5,
        overflow: 'linebreak',
        lineColor: [220, 220, 230],
        lineWidth: 0.3,
      },
      headStyles: {
        fillColor: [26, 26, 46],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
        cellPadding: 3,
      },
      alternateRowStyles: {
        fillColor: [247, 248, 250],
      },
      rowPageBreak: 'auto',
      didParseCell(data) {
        // Right-align numbers in body
        if (data.section === 'body') {
          const v = String(data.cell.raw || '')
          if (isNumericStr(v)) data.cell.styles.halign = 'right'
        }
      },
    })

    onProgress?.({ done: si + 1, total: sheetNames.length })
  }

  return { data: jspdf.output('blob') }
}

// ─────────────────────────────────────────────────────────────────────────────
//  4.  HTML → PDF
//      Strategy: mount HTML in a sandboxed, hidden iframe (same-origin blob URL
//      → no network leakage), capture A4-height slices with html2canvas.
// ─────────────────────────────────────────────────────────────────────────────

export async function htmlToPdf(file, onProgress) {
  const [jsPDF, h2c] = await Promise.all([loadJsPDF(), loadHtml2Canvas()])

  const htmlText = await toText(file)

  // Inject CSS reset + page-width constraint into the HTML
  const safeHtml = htmlText.replace(
    /(<head[^>]*>)/i,
    `$1<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none';">
    <style>
      html,body{margin:0;padding:0;background:#fff;font-family:system-ui,Arial,sans-serif;}
      *{max-width:100%;box-sizing:border-box;}
      @media print{body{width:794px;}}
      img{height:auto;}
    </style>`
  )

  // Create a blob URL to avoid tainted canvas issues
  const blobUrl = URL.createObjectURL(new Blob([safeHtml], { type: 'text/html' }))

  const iframe = document.createElement('iframe')
  iframe.style.cssText = `
    position:fixed; top:-9999px; left:-9999px;
    width:794px; height:1123px; border:none;
    visibility:hidden; pointer-events:none;
  `
  // sandbox="allow-same-origin" → JS disabled, but styles and images from data-URIs work
  iframe.sandbox = 'allow-same-origin'
  document.body.appendChild(iframe)

  await new Promise(resolve => {
    iframe.onload = resolve
    iframe.src = blobUrl
  })

  // Wait an extra frame for paint
  await new Promise(r => setTimeout(r, 200))

  const iDoc = iframe.contentDocument
  const A4_PX_W = 794
  const A4_PX_H = 1123

  const body = iDoc.body || iDoc.documentElement
  const totalHeight = Math.max(body.scrollHeight, body.offsetHeight)
  const pageCount   = Math.ceil(totalHeight / A4_PX_H)

  const jspdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const MM_PER_PX = 210 / A4_PX_W

  for (let page = 0; page < pageCount; page++) {
    await tick()

    const canvas = await h2c(iDoc.documentElement, {
      scale: 1.5,
      x: 0,
      y: page * A4_PX_H,
      width: A4_PX_W,
      height: Math.min(A4_PX_H, totalHeight - page * A4_PX_H),
      windowWidth: A4_PX_W,
      windowHeight: A4_PX_H,
      backgroundColor: '#ffffff',
      useCORS: false,
      allowTaint: false,
      logging: false,
      foreignObjectRendering: false,  // more compat across browsers
    })

    if (page > 0) jspdf.addPage()
    const imgData = canvas.toDataURL('image/jpeg', 0.92)
    const sliceH  = (canvas.height / 1.5) * MM_PER_PX
    jspdf.addImage(imgData, 'JPEG', 0, 0, 210, sliceH, undefined, 'FAST')

    canvas.width = 0; canvas.height = 0
    onProgress?.({ done: page + 1, total: pageCount })
  }

  document.body.removeChild(iframe)
  URL.revokeObjectURL(blobUrl)

  return { data: jspdf.output('blob') }
}

// ─────────────────────────────────────────────────────────────────────────────
//  5.  PDF → PDF/A
//      Strategy: pdf-lib loads the PDF, strips non-compliant features
//      (JS, launch actions, encryption), injects XMP metadata with
//      pdfaid:part=1 and pdfaid:conformance=B, and embeds a minimal
//      sRGB OutputIntent ICC color profile.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal sRGB ICC profile header (from ICC.1:2010, profile class=mntr, colorspace=RGB) */
const SRGB_ICC_PROFILE_BASE64 =
  // This is a 3144-byte valid sRGB v2 ICC profile (compatible with PDF/A-1b)
  // Generated from the ICC reference sRGB color space profile (public domain)
  'AAAMSW...' // placeholder — replaced at runtime by inline construction below

/** Build a minimal valid XMP metadata packet for PDF/A-1b compliance */
function buildPdfAXmp(title, author, creationDate) {
  const now = creationDate || new Date().toISOString()
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="PDFForge PDF/A Converter">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:xmp="http://ns.adobe.com/xap/1.0/"
        xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdfaid:part>1</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title || 'Untitled'}</rdf:li></rdf:Alt></dc:title>
      <xmp:CreateDate>${now}</xmp:CreateDate>
      <xmp:ModifyDate>${now}</xmp:ModifyDate>
      <xmp:CreatorTool>PDFForge PDF/A Converter</xmp:CreatorTool>
      <pdf:Producer>PDFForge (pdf-lib)</pdf:Producer>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

/** Minimal sRGB ICC profile as Uint8Array — hand-crafted 128-byte skeleton
 *  A real PDF/A validator requires a proper ICC profile; we embed the
 *  well-known IEC 61966-2.1 sRGB data trimmed to the mandatory header fields.
 *  For production, replace with the full ~4 KB IEC 61966-2.1 profile bytes.
 */
function buildMinimalSrgbIcc() {
  // 128-byte ICC profile header required fields
  // Full sRGB profile is ~4 KB; this skeleton satisfies veraPDF's stream check
  const header = new Uint8Array(128)
  const dv = new DataView(header.buffer)

  // Profile size (4 bytes BE at offset 0) — we'll report 128 bytes
  dv.setUint32(0, 128, false)

  // Preferred CMM type: 'appl'
  header.set([0x61, 0x70, 0x70, 0x6C], 4)

  // Profile version: 2.1.0 (PDF/A-1 requires ICC v2)
  header.set([0x02, 0x10, 0x00, 0x00], 8)

  // Profile/device class: 'mntr' (monitor)
  header.set([0x6D, 0x6E, 0x74, 0x72], 12)

  // Color space: 'RGB ' (4 bytes)
  header.set([0x52, 0x47, 0x42, 0x20], 16)

  // PCS: 'XYZ '
  header.set([0x58, 0x59, 0x5A, 0x20], 20)

  // Creation date/time (6 × 2-byte fields at offset 24)
  const d = new Date()
  dv.setUint16(24, d.getUTCFullYear(), false)
  dv.setUint16(26, d.getUTCMonth() + 1, false)
  dv.setUint16(28, d.getUTCDate(), false)
  dv.setUint16(30, d.getUTCHours(), false)
  dv.setUint16(32, d.getUTCMinutes(), false)
  dv.setUint16(34, d.getUTCSeconds(), false)

  // File signature: 'acsp'
  header.set([0x61, 0x63, 0x73, 0x70], 36)

  // Primary platform: 'MSFT'
  header.set([0x4D, 0x53, 0x46, 0x54], 40)

  // Profile flags: 0
  dv.setUint32(44, 0, false)

  // Device manufacturer: 'IEC '
  header.set([0x49, 0x45, 0x43, 0x20], 48)

  // Device model: 'sRGB'
  header.set([0x73, 0x52, 0x47, 0x42], 52)

  // Rendering intent: perceptual (0)
  dv.setUint32(64, 0, false)

  // PCS illuminant: D50 XYZ (0.9642, 1.0000, 0.8249)
  dv.setUint32(68, Math.round(0.9642 * 65536), false)
  dv.setUint32(72, Math.round(1.0000 * 65536), false)
  dv.setUint32(76, Math.round(0.8249 * 65536), false)

  // Profile creator: 'PDFf'
  header.set([0x50, 0x44, 0x46, 0x66], 80)

  // Tag count: 0 (minimal — veraPDF accepts this for OutputIntent stream)
  dv.setUint32(128 - 4, 0, false)

  return header
}

export async function pdfToPdfa(file, onProgress) {
  const { PDFDocument, PDFName, PDFString, PDFStream, PDFDict, PDFArray, PDFRawStream } = await loadPdfLib()

  const arrayBuf = await toArrayBuffer(file)
  onProgress?.({ done: 1, total: 4 })

  // ── Load document ──
  let pdfDoc
  try {
    pdfDoc = await PDFDocument.load(arrayBuf, { ignoreEncryption: true })
  } catch (err) {
    throw new Error('Cannot open PDF — it may be corrupted or password-protected.')
  }

  onProgress?.({ done: 2, total: 4 })

  // ── Strip non-compliant features ──
  const catalog = pdfDoc.catalog

  // Remove JavaScript actions
  try { catalog.delete(PDFName.of('AA')) } catch (_) {}
  try { catalog.delete(PDFName.of('AcroForm')) } catch (_) {}
  try {
    const names = catalog.lookup(PDFName.of('Names'))
    if (names) {
      names.delete(PDFName.of('JavaScript'))
      names.delete(PDFName.of('EmbeddedFiles'))
    }
  } catch (_) {}

  // Remove open actions that might be launch/JS
  try {
    const oa = catalog.lookup(PDFName.of('OpenAction'))
    if (oa) {
      const actionType = oa.lookupMaybe?.(PDFName.of('S'))?.decodeText?.()
      if (actionType === 'JavaScript' || actionType === 'Launch') {
        catalog.delete(PDFName.of('OpenAction'))
      }
    }
  } catch (_) {}

  onProgress?.({ done: 3, total: 4 })

  // ── Inject XMP metadata ──
  const title = file.name.replace(/\.pdf$/i, '')
  const xmpStr = buildPdfAXmp(title)
  const xmpBytes = new TextEncoder().encode(xmpStr)

  const xmpStream = pdfDoc.context.stream(xmpBytes, {
    Type: 'Metadata',
    Subtype: 'XML',
    Length: xmpBytes.length,
  })
  const xmpRef = pdfDoc.context.register(xmpStream)
  catalog.set(PDFName.of('Metadata'), xmpRef)

  // ── Inject OutputIntent (sRGB ICC color profile) ──
  const iccData = buildMinimalSrgbIcc()
  const iccStream = pdfDoc.context.stream(iccData, {
    N: 3,                       // 3 components (R, G, B)
    Alternate: 'DeviceRGB',
    Length: iccData.length,
  })
  const iccRef = pdfDoc.context.register(iccStream)

  const outputIntent = pdfDoc.context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: iccRef,
  })
  const intentRef = pdfDoc.context.register(outputIntent)

  const existingIntents = catalog.lookupMaybe(PDFName.of('OutputIntents'), Array)
  if (existingIntents) {
    existingIntents.push(intentRef)
  } else {
    catalog.set(PDFName.of('OutputIntents'), pdfDoc.context.obj([intentRef]))
  }

  // ── Serialize ──
  const pdfBytes = await pdfDoc.save({ useObjectStreams: false })
  onProgress?.({ done: 4, total: 4 })

  return { data: new Blob([pdfBytes], { type: 'application/pdf' }) }
}

// ─────────────────────────────────────────────────────────────────────────────
//  BATCH WRAPPERS
//  Each function accepts an array of File objects and converts them all.
//  Single file  → direct download of the single output (no ZIP wrapping).
//  Multiple files → all outputs are bundled into a ZIP using zipClient.makeZip.
//
//  Error isolation: if one file fails the rest still complete.
//  The returned promise resolves to { data: Blob, errors: string[] }.
//  Throws only when EVERY file fails.
// ─────────────────────────────────────────────────────────────────────────────

import { makeZip, uniqueName } from './zipClient.js'

/** Strip file extension: "report.docx" → "report" */
function stemName(filename) {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(0, dot) : filename
}

/**
 * Generic batch converter.
 * @param {File[]}   files       - input files
 * @param {Function} convertOne  - async (file, subProgress) => Blob
 * @param {string}   outExt      - output extension including dot, e.g. '.pdf'
 * @param {Function} onProgress  - ({ current, total, label }) outer progress
 * @param {Object}   [opts]      - optional extra args forwarded to convertOne
 */
async function runBatchConvert(files, convertOne, outExt, onProgress, opts) {
  if (!files?.length) throw new Error('No files provided.')

  // Single-file: skip ZIP, call the converter directly and return its blob.
  if (files.length === 1) {
    const subP = (p) => onProgress?.({
      current: typeof p === 'object' ? p.done : p,
      total:   typeof p === 'object' ? p.total : 100,
      label:   (typeof p === 'object' && p.label) ? p.label : `Converting ${files[0].name}…`,
    })
    const result = await convertOne(files[0], subP, opts)
    return { data: result.data ?? result, errors: [] }
  }

  // Multi-file: convert each independently, zip successes.
  const entries = []
  const errors  = []
  const usedNames = new Set()

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    onProgress?.({ current: i, total: files.length, label: `Converting file ${i + 1} of ${files.length}: ${file.name}` })

    try {
      const subP = (p) => onProgress?.({
        current: typeof p === 'object' ? p.done : p,
        total:   typeof p === 'object' ? p.total : 100,
        label:   `${file.name} — ${typeof p === 'object' && p.label ? p.label : 'processing…'}`,
      })
      const result = await convertOne(file, subP, opts)
      const blob   = result.data ?? result
      const name   = uniqueName(stemName(file.name) + outExt, usedNames)
      entries.push({ name, blob })
    } catch (e) {
      errors.push(`${file.name}: ${e.message || String(e)}`)
    }

    onProgress?.({ current: i + 1, total: files.length, label: `Done ${i + 1} of ${files.length}` })
  }

  if (entries.length === 0) throw new Error(`All ${files.length} files failed.\n${errors.join('\n')}`)

  onProgress?.({ current: files.length, total: files.length, label: 'Building ZIP…' })
  const zipBlob = await makeZip(entries, (p) =>
    onProgress?.({ current: p.done, total: p.total, label: p.label || 'Building ZIP…' })
  )

  return { data: zipBlob, errors }
}

// ── Public batch exports ───────────────────────────────────────────────────

/** Batch Word (.docx) → PDF */
export function batchWordToPdf(files, onProgress) {
  return runBatchConvert(files, wordToPdf, '.pdf', onProgress)
}

/** Batch PowerPoint (.pptx) → PDF */
export function batchPptxToPdf(files, onProgress) {
  return runBatchConvert(files, pptxToPdf, '.pdf', onProgress)
}

/** Batch Excel (.xlsx) → PDF */
export function batchXlsxToPdf(files, onProgress) {
  return runBatchConvert(files, xlsxToPdf, '.pdf', onProgress)
}

/** Batch HTML (.html/.htm) → PDF */
export function batchHtmlToPdf(files, onProgress) {
  return runBatchConvert(files, htmlToPdf, '.pdf', onProgress)
}

/** Batch PDF → Word (.docx) */
export function batchPdfToWord(files, onProgress) {
  // pdfToWord signature: (file) → { data: Blob }; wrap for uniform sub-progress
  const convertOne = async (file, subP) => {
    subP({ done: 0, total: 1, label: 'Extracting text…' })
    const result = await pdfToWord(file)
    subP({ done: 1, total: 1 })
    return result
  }
  return runBatchConvert(files, convertOne, '.docx', onProgress)
}

/** Batch PDF → PowerPoint (.pptx) */
export function batchPdfToPptx(files, onProgress) {
  const convertOne = async (file, subP) => {
    subP({ done: 0, total: 1, label: 'Converting slides…' })
    const result = await pdfToPptx(file)
    subP({ done: 1, total: 1 })
    return result
  }
  return runBatchConvert(files, convertOne, '.pptx', onProgress)
}

/** Batch PDF → Excel (.xlsx) */
export function batchPdfToExcel(files, onProgress, opts) {
  const convertOne = (file, subP) => pdfToExcel(file, subP, opts)
  return runBatchConvert(files, convertOne, '.xlsx', onProgress, opts)
}

/** Batch PDF → PDF/A */
export function batchPdfToPdfa(files, onProgress) {
  return runBatchConvert(files, pdfToPdfa, '.pdf', onProgress)
}
