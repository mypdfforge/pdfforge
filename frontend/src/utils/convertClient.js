import PptxGenJS from 'pptxgenjs'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import * as XLSX from 'xlsx'

// All three return { data: Blob } so ToolPage's clientSide path downloads them.
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

export async function pdfToExcel(file) {
  const pdf = await load(file), wb = XLSX.utils.book_new()
  for (let i = 1; i <= pdf.numPages; i++) {
    const rows = await pageRows(await pdf.getPage(i))
    const aoa = rows.map((r) => {
      const out = []; let last = null
      for (const c of r.cells) {
        if (last !== null && c.x - last <= 8) out[out.length - 1] += c.s
        else out.push(c.s)
        last = c.end
      }
      return out
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `Page ${i}`.slice(0, 31))
  }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return { data: new Blob([buf]) }
}

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
