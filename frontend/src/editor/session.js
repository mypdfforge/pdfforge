// One open document: engine (worker), pdf.js doc, measurer, store. Owns preview rendering and export. Everything runs on this device.
import { createEngine } from './core/engineClient.ts'
import { extractDocument } from './core/extract.ts'
import { Measurer } from './core/fonts.ts'
import { EditorStore } from './core/store.ts'
import { buildPlan } from './core/plan.ts'
import { overlaysByPage } from './core/overlays.ts'
import { LIMITS } from './core/limits.ts'
import { validateExport } from './core/validate.ts'

// Same CDN globals the rest of the platform uses (see index.html). No document bytes are ever sent to them.
export const PDFLIB_URL = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

const globals = () => {
  const L = window.PDFLib, pdfjs = window.pdfjsLib
  if (!L || !pdfjs) throw new Error('The PDF libraries are still loading. Please try again in a moment.')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
  return { L, pdfjs }
}
export const friendlyError = (e) => {
  if (e?.code === 'encrypted') return 'This PDF is password-protected. Unlock it first, then open it here.'
  if (e?.code === 'corrupt' || e?.name === 'InvalidPDFException' || e?.name === 'MissingPDFException') return 'This file could not be read as a PDF. It may be damaged.'
  if (e?.name === 'PasswordException') return 'This PDF is password-protected. Unlock it first, then open it here.'
  if (e instanceof RangeError || /memory|allocation/i.test(e?.message ?? '')) return 'Your device ran out of memory while processing this PDF. Try a smaller file.'
  return e?.message || 'Something went wrong while opening this PDF.'
}

export async function openSession({ bytes, name, restored, makeWorker, onProgress }) {
  const { L, pdfjs } = globals()
  const engine = await createEngine(L, PDFLIB_URL, makeWorker)
  let task = null
  try {
    const { pageCount } = await engine.open(bytes)
    if (pageCount > LIMITS.maxPages) throw new Error(`This PDF has ${pageCount} pages. The in-browser editor supports up to ${LIMITS.maxPages} pages.`)
    task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 })
    const pdf = await task.promise
    const m = await Measurer.create(L)
    let doc = restored, notes = []
    if (!doc) { const r = await extractDocument(pdf, (i) => engine.analyzePage(i), name, onProgress); doc = r.doc; notes = r.notes }
    return new Session({ engine, pdf, task, m, store: new EditorStore(doc, m), bytes, notes, pdfjs })
  } catch (e) { task?.destroy?.(); engine.close(); throw e }
}

export class Session {
  constructor(o) {
    Object.assign(this, o)
    this.cache = new Map() // page signature -> preview bytes
    this._plan = null; this._ov = null
    this.exporting = null
  }
  get doc() { return this.store.doc }
  plan() { if (this._plan?.doc !== this.doc) this._plan = { doc: this.doc, v: buildPlan(this.doc, this.m) }; return this._plan.v }
  overlays() { if (this._ov?.doc !== this.doc) this._ov = { doc: this.doc, v: overlaysByPage(this.doc, this.m) }; return this._ov.v }
  isDirtyPage(i) { const p = this.plan().pages[i]; return !!p && (p.src === null || p.edits.length > 0 || p.draws.length > 0) }
  sig(i) { const p = this.plan().pages[i]; return p ? (this.isDirtyPage(i) ? `${i}:${p.src}:` + JSON.stringify([p.edits, p.draws]) : `${i}:orig`) : '' }

  /** Render output page i into canvas. Preview = the export engine's own output, so it cannot disagree with the download. */
  renderPage(canvas, i, zoom) {
    let cancelled = false, rt = null, tmp = null
    const promise = (async () => {
      const plan = this.plan(), pp = plan.pages[i]
      if (!pp) return
      let page
      if (!this.isDirtyPage(i)) page = await this.pdf.getPage(pp.src + 1)
      else {
        const sig = this.sig(i)
        let bytes = this.cache.get(sig)
        if (!bytes) {
          bytes = (await this.engine.build(plan, { only: [i] }).promise).bytes
          this.cache.set(sig, bytes); if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value)
        }
        if (cancelled) return
        tmp = await this.pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise
        page = await tmp.getPage(1)
      }
      if (cancelled) return
      const scale = zoom * Math.min(window.devicePixelRatio || 1, 2)
      const vp = page.getViewport({ scale })
      const off = document.createElement('canvas')
      off.width = Math.max(1, Math.floor(vp.width)); off.height = Math.max(1, Math.floor(vp.height))
      rt = page.render({ canvasContext: off.getContext('2d'), viewport: vp })
      await rt.promise
      if (cancelled) return
      canvas.width = off.width; canvas.height = off.height
      canvas.getContext('2d').drawImage(off, 0, 0)
      off.width = off.height = 0
    })().catch((e) => { if (!cancelled && e?.name !== 'RenderingCancelledException') console.error('render failed', e) })
      .finally(() => { try { tmp?.destroy() } catch {} })
    return { promise, cancel: () => { cancelled = true; try { rt?.cancel() } catch {} } }
  }

  /** Full export in the worker. Returns { blob, validation, report }. Cancellable via cancelExport(). */
  async exportPdf(onProgress) {
    const plan = this.plan(), doc = this.doc // snapshot: the export always matches the revision the user clicked on
    const t = this.engine.build(plan, { onProgress })
    this.exporting = t
    try {
      const { bytes, report } = await t.promise
      const validation = await validateExport(this.pdfjs, bytes, doc, plan)
      return { blob: new Blob([bytes], { type: 'application/pdf' }), bytes, validation, report, doc }
    } finally { this.exporting = null }
  }
  cancelExport() { this.exporting?.cancel() }

  dispose() {
    this.cancelExport()
    try { this.pdf.destroy() } catch {}
    try { this.task?.destroy() } catch {}
    this.engine.close()
    this.cache.clear()
  }
}
