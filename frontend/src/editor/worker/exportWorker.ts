// Classic (iife) Web Worker. pdf-lib is loaded with importScripts from the same CDN the app already uses.
import { PdfEngine, EngineError } from '../core/engine.ts'
const ctx: any = self
let engine: PdfEngine | null = null
const cancelled = new Set<number>()

const fail = (id: number, e: any) => ctx.postMessage({ id, ok: false, code: e instanceof EngineError ? e.code : 'error', message: String(e?.message ?? e) })

ctx.onmessage = async (ev: MessageEvent) => {
  const m: any = ev.data
  try {
    if (m.type === 'cancel') { cancelled.add(m.target); return }
    if (m.type === 'init') {
      if (!ctx.PDFLib) {
        // Classic workers allow importScripts; in module workers it exists but throws, so fall back to import().
        try { ctx.importScripts(m.libUrl) } catch { await import(/* @vite-ignore */ m.libUrl) }
      }
      if (!ctx.PDFLib) throw new Error('pdf-lib failed to load in worker')
      engine = new PdfEngine(ctx.PDFLib)
      ctx.postMessage({ id: m.id, ok: true }); return
    }
    if (!engine) throw new Error('Engine not initialised')
    if (m.type === 'open') ctx.postMessage({ id: m.id, ok: true, result: await engine.open(new Uint8Array(m.bytes)) })
    else if (m.type === 'analyze') ctx.postMessage({ id: m.id, ok: true, result: engine.analyzePage(m.page) })
    else if (m.type === 'build') {
      const r = await engine.build(m.plan, {
        only: m.only, isCancelled: () => cancelled.has(m.id),
        onProgress: (done, total) => ctx.postMessage({ id: m.id, progress: { done, total } }),
      })
      cancelled.delete(m.id)
      ctx.postMessage({ id: m.id, ok: true, result: { bytes: r.bytes, report: r.report } }, [r.bytes.buffer])
    } else if (m.type === 'close') { engine.close(); engine = null; ctx.postMessage({ id: m.id, ok: true }) }
  } catch (e) { cancelled.delete(m.id); fail(m.id, e) }
}
