// PdfEngine: all pdf-lib work. Runs in a Web Worker (worker/exportWorker.ts) or in-thread as fallback.
import { parseContent, analyze, rewrite } from './contentStream.ts'
import type { Analysis, ShowOp } from './contentStream.ts'
import { readContent, readFonts, metricsFor, toBytes } from './pdflibInfo.ts'
import { standardName } from './fonts.ts'
import type { FontInfo } from './fonts.ts'
import type { Plan, PlanPage, Draw, BuildReport } from './types.ts'

export type EngineCode = 'encrypted' | 'corrupt' | 'too-large' | 'cancelled'
export class EngineError extends Error { code: EngineCode; constructor(code: EngineCode, msg: string) { super(msg); this.code = code } }
export type PageAnalysis = { readable: boolean; ops: ShowOp[]; fonts: Record<string, FontInfo>; images: number; paints: number }

const f3 = (n: number) => String(Math.round(n * 1000) / 1000)
const rgb = (c: number[]) => `${f3(c[0])} ${f3(c[1])} ${f3(c[2])} rg`

export class PdfEngine {
  private bytes: Uint8Array | null = null
  private src: any = null // never mutated; used for analysis and page copies
  L: any
  constructor(L: any) { this.L = L }

  async open(bytes: Uint8Array): Promise<{ pageCount: number }> {
    this.bytes = bytes
    try { this.src = await this.L.PDFDocument.load(bytes, { updateMetadata: false }) }
    catch (e: any) {
      if (/encrypt/i.test(e?.message ?? '')) throw new EngineError('encrypted', 'This PDF is password-protected. Unlock it first.')
      throw new EngineError('corrupt', 'This file could not be read as a PDF. It may be damaged.')
    }
    return { pageCount: this.src.getPageCount() }
  }
  close() { this.bytes = null; this.src = null }

  analyzePage(i: number): PageAnalysis {
    const page = this.src.getPage(i)
    const fonts = readFonts(this.L, this.src, page)
    const text = readContent(this.L, this.src, page)
    if (text === null) return { readable: false, ops: [], fonts, images: 0, paints: 0 }
    const a: Analysis = analyze(parseContent(text), metricsFor(fonts))
    return { readable: true, ops: a.ops, fonts, images: a.images, paints: a.paints }
  }

  /** Build output. `only` => preview of just those plan pages (fresh doc, source untouched). Otherwise full export, in place. */
  async build(plan: Plan, opts: { only?: number[]; onProgress?: (done: number, total: number) => void; isCancelled?: () => boolean } = {}): Promise<{ bytes: Uint8Array; report: BuildReport }> {
    const L = this.L
    const warnings: string[] = []
    const preview = !!opts.only
    const doc = preview ? await L.PDFDocument.create() : await L.PDFDocument.load(this.bytes!, { updateMetadata: false })
    const fonts = new Map<string, any>(), sets = new Map<string, Set<number>>()
    const getFont = (name: string) => {
      let f = fonts.get(name)
      if (!f) { f = doc.embedStandardFont(name); fonts.set(name, f); sets.set(name, new Set(f.getCharacterSet())) }
      return f
    }
    const indices = opts.only ?? plan.pages.map((_, i) => i)
    const out: any[] = []
    for (let k = 0; k < indices.length; k++) {
      if (opts.isCancelled?.()) throw new EngineError('cancelled', 'Cancelled')
      const pp = plan.pages[indices[k]]
      let page: any
      if (preview) {
        if (pp.src !== null) { ;[page] = await doc.copyPages(this.src, [pp.src]); doc.addPage(page) } else page = doc.addPage([pp.w, pp.h])
      } else page = pp.src !== null ? doc.getPage(pp.src) : doc.addPage([pp.w, pp.h])
      this.applyPage(doc, page, pp, getFont, sets, warnings)
      out.push(page)
      opts.onProgress?.(k + 1, indices.length)
      if (k % 10 === 9) await new Promise((r) => setTimeout(r, 0)) // let the thread breathe on big documents
    }
    const bytes: Uint8Array = await doc.save({ useObjectStreams: false })
    return { bytes, report: { warnings, pageCount: doc.getPageCount() } }
  }

  private applyPage(doc: any, page: any, pp: PlanPage, getFont: (n: string) => any, sets: Map<string, Set<number>>, warnings: string[]) {
    const L = this.L
    if (!pp.edits.length && !pp.draws.length) return
    const N = (s: string) => L.PDFName.of(s)
    const mk = (s: string) => doc.context.register(doc.context.flateStream(toBytes(s)))
    let existing: any[] = []
    const c = page.node.Contents()
    if (c) existing = c instanceof L.PDFArray ? c.asArray() : [page.node.get(N('Contents'))]
    let body: any[] = existing
    if (pp.edits.length) {
      const text = readContent(L, doc, page)
      if (text === null) throw new EngineError('corrupt', 'A page uses a content-stream filter that cannot be edited safely.')
      body = [mk(rewrite(text, parseContent(text), pp.edits))]
    }
    // Draw operators live in their own stream; the original is wrapped in q/Q so its graphics state cannot leak into ours.
    const fontKeys = new Map<string, any>()
    let ops = ''
    for (const d of pp.draws) ops += this.drawOps(page, d, getFont, sets, fontKeys, warnings)
    page.node.set(N('Contents'), doc.context.obj([mk('q'), ...body, mk('Q\n' + ops)]))
  }

  private drawOps(page: any, d: Draw, getFont: (n: string) => any, sets: Map<string, Set<number>>, keys: Map<string, any>, warnings: string[]) {
    if (d.kind === 'rect') return `q ${rgb(d.color)} ${f3(d.x)} ${f3(d.y)} ${f3(d.w)} ${f3(d.h)} re f Q\n`
    const name = standardName(d.family, d.bold, d.italic)
    const font = getFont(name)
    let key = keys.get(name)
    if (!key) { key = page.node.newFontDictionary(font.name, font.ref); keys.set(name, key) }
    const set = sets.get(name)!
    let text = ''
    let bad = false
    for (const ch of d.text) { if (set.has(ch.codePointAt(0)!)) text += ch; else { text += '?'; bad = true } }
    if (bad) warnings.push(`Some characters in "${d.text.slice(0, 30)}" are not available in ${name} and were replaced with "?".`)
    let s = `q ${rgb(d.color)}\n`
    if (text) s += `BT /${key.decodeText()} ${f3(d.size)} Tf ${f3(d.tc)} Tc ${f3(d.tw)} Tw ${f3(d.x)} ${f3(d.y)} Td ${font.encodeText(text).toString()} Tj ET\n`
    const th = Math.max(0.4, d.size * 0.06)
    if (d.underline) s += `${f3(d.x)} ${f3(d.y - d.size * 0.14)} ${f3(d.width)} ${f3(th)} re f\n`
    if (d.strike) s += `${f3(d.x)} ${f3(d.y + d.size * 0.3)} ${f3(d.width)} ${f3(th)} re f\n`
    return s + 'Q\n'
  }
}
