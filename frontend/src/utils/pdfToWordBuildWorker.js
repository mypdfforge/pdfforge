/**
 * pdfToWordBuildWorker.js — Web Worker that builds + packs the .docx off the main thread.
 * Bundled by Vite/webpack via `new Worker(new URL('./pdfToWordBuildWorker.js', import.meta.url), {type:'module'})`.
 * Same-origin, no network access.
 */
import { buildDocxBlob } from './docxBuild.js'
import { createSlicer } from './pdfToWordUtils.js'

self.postMessage({ type: 'ready' })

self.onmessage = async (ev) => {
  const { models, bodySize, title } = ev.data || {}
  try {
    const res = await buildDocxBlob(models, {
      bodySize, title,
      warn: (page, code, message, level) => self.postMessage({ type: 'warn', page, code, message, level }),
      onProgress: (i, n) => self.postMessage({ type: 'progress', i, n }),
      yieldFn: createSlicer(8),
    })
    self.postMessage({ type: 'done', blob: res.blob, packMode: res.packMode, modes: res.modes })
  } catch (e) {
    self.postMessage({ type: 'error', message: e?.message || String(e) })
  }
}
