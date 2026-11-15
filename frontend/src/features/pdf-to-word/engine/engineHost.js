import { convertPdfToDocx } from '../../../utils/pdfToWordPipeline.js'
import { ConversionError, classifyPdfError, abortError, looksLikeZip } from '../../../utils/pdfToWordUtils.js'

export const LIMITS = {
  warnBytes: 150 * 1024 * 1024, // soft warning
  maxBytes: 600 * 1024 * 1024,  // hard stop (a bigger PDF will not fit in one tab's memory)
  stallMs: 90_000,              // no progress for this long → abort ("hung")
  packStallMs: 240_000,         // packaging is one long step, allow more
  maxMs: 30 * 60_000,           // absolute ceiling for one file
}

/**
 * Convert one PDF to a Word (.docx) document — 100% in this browser tab, zero network.
 *
 * Resolves with a valid .docx Blob whenever the PDF can be opened at all (bad pages degrade
 * to text/image and are reported in `warnings`). Rejects only with a typed error:
 *   ABORTED | STALLED | TIMEOUT | ENCRYPTED | INVALID_PDF | TOO_LARGE | OOM | EMPTY | NO_PDFJS | INTERNAL
 *
 * @param {File} file
 * @param {object} [opts]
 * @param {(p:{percent:number,message:string,stage:string,page?:number,totalPages?:number,
 *           pagesPerSec?:number,etaSec?:number|null,warnings?:number})=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @param {'robust'|'auto'|'hifi'} [opts.engine]  robust = per-page isolated pipeline (default)
 *        auto = try the legacy whole-document hi-fi engine first (small files), fall back to robust
 * @returns {Promise<{blob:Blob, warnings:object[], stats:object, engine:string}>}
 */
export async function convertPdfToWord(file, { onProgress, signal, engine = 'robust', stallMs, maxMs } = {}) {
  validateInput(file)
  if (signal?.aborted) throw abortError()

  // Our own controller = caller's signal + watchdog + absolute timeout.
  const ctl = new AbortController()
  let failure = null // set when the watchdog (not the user) aborts
  const onUserAbort = () => ctl.abort()
  signal?.addEventListener('abort', onUserAbort, { once: true })

  let stallTimer = null
  let currentStall = stallMs ?? LIMITS.stallMs
  const arm = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      failure = new ConversionError('STALLED', 'Conversion stopped responding and was cancelled. Try a smaller file or split the PDF.')
      ctl.abort()
    }, currentStall)
  }
  const hardTimer = setTimeout(() => {
    failure = new ConversionError('TIMEOUT', 'Conversion took too long and was cancelled.')
    ctl.abort()
  }, maxMs ?? LIMITS.maxMs)

  let lastPercent = 0
  const report = (p) => {
    currentStall = p.stage === 'pack' ? Math.max(stallMs ?? 0, LIMITS.packStallMs) : (stallMs ?? LIMITS.stallMs)
    arm() // any sign of life resets the watchdog
    lastPercent = Math.max(lastPercent, Math.min(100, p.percent ?? 0)) // never move backwards
    try { onProgress?.({ ...p, percent: lastPercent }) } catch { /* UI errors must not break conversion */ }
  }

  arm()
  try {
    const sizeNote = file.size > LIMITS.warnBytes ? ' (large file — this can take a while)' : ''
    report({ percent: 0, stage: 'loading', message: `Starting conversion${sizeNote}…` })

    if (engine === 'auto' || engine === 'hifi') {
      const hifi = await tryHighFidelity(file, ctl.signal, report)
      if (hifi) return { blob: hifi, warnings: [], stats: { engine: 'hifi' }, engine: 'hifi' }
      if (engine === 'hifi') throw new ConversionError('INTERNAL', 'High-fidelity engine failed.')
      lastPercent = 0
    }

    const res = await convertPdfToDocx(file, { signal: ctl.signal, onProgress: report })
    return { ...res, engine: 'robust' }
  } catch (err) {
    if (failure) throw failure                 // watchdog fired: report STALLED/TIMEOUT, not ABORTED
    throw classifyPdfError(err)
  } finally {
    clearTimeout(stallTimer)
    clearTimeout(hardTimer)
    signal?.removeEventListener('abort', onUserAbort)
  }
}

function validateInput(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new ConversionError('INVALID_PDF', 'No file provided.')
  if (file.size === 0) throw new ConversionError('INVALID_PDF', 'This file is empty.')
  const looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
  if (!looksPdf) throw new ConversionError('INVALID_PDF', 'Only PDF files can be converted.')
  if (file.size > LIMITS.maxBytes) {
    throw new ConversionError('TOO_LARGE', `This PDF is ${(file.size / 1048576).toFixed(0)} MB. Files above ${LIMITS.maxBytes / 1048576} MB cannot be converted safely in the browser.`)
  }
}

/**
 * Optional first attempt with the whole-document hi-fi engine (pdf2docx-web).
 * It cannot isolate failing pages or report progress per page, so it only runs for modest files,
 * is raced against the abort signal, and its output is validated before we trust it.
 */
async function tryHighFidelity(file, signal, report) {
  if (file.size > 25 * 1024 * 1024) return null
  try {
    const { pdfToWordHiFi } = await import('../../../utils/convertClient.js')
    if (typeof pdfToWordHiFi !== 'function') return null
    report({ percent: 2, stage: 'analyze', message: 'Running high-fidelity engine…' })
    const result = await raceAbort(pdfToWordHiFi(file, (p) => {
      const pct = typeof p === 'number' ? p * 100 : 0
      report({ percent: Math.min(95, pct), stage: 'analyze', message: 'Running high-fidelity engine…' })
    }), signal)
    const blob = result?.data
    return blob && (await looksLikeZip(blob)) ? blob : null
  } catch (e) {
    if (e?.code === 'ABORTED' || signal.aborted) throw abortError()
    return null // fall through to the robust pipeline
  }
}

function raceAbort(promise, signal) {
  if (signal.aborted) { promise.catch(() => {}); return Promise.reject(abortError()) }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) }
    )
  })
}
