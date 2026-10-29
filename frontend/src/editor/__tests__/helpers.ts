import * as PDFLib from 'pdf-lib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PdfEngine } from '../core/engine.ts'
import { extractDocument } from '../core/extract.ts'
import { Measurer } from '../core/fonts.ts'

const dir = path.dirname(fileURLToPath(import.meta.url))
export const fixture = (n: string) => new Uint8Array(fs.readFileSync(path.join(dir, 'fixtures', n)))
export const L: any = PDFLib

let pdfjs: any
export async function getPdfjs() {
  if (!pdfjs) { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') }
  return pdfjs
}
export async function loadPdfjs(bytes: Uint8Array) {
  const lib = await getPdfjs()
  return lib.getDocument({ data: bytes.slice(), useSystemFonts: true, verbosity: 0 }).promise
}
export async function open(name: string) {
  const bytes = fixture(name)
  const engine = new PdfEngine(L)
  await engine.open(bytes.slice())
  const pdf = await loadPdfjs(bytes)
  const { doc, notes } = await extractDocument(pdf, async (i) => engine.analyzePage(i), name)
  const m = await Measurer.create(L)
  return { engine, pdf, doc, notes, m, bytes }
}
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await loadPdfjs(bytes)
  const out: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent()
    out.push(tc.items.map((x: any) => x.str).join('|'))
  }
  return out
}
