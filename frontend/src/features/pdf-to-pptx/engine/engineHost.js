import { convertPdfToPptx as runPdfToPptxPipeline } from '../../../utils/pdfToPptxPipeline.js'
import { ConversionError, classifyPdfError, abortError } from '../../../utils/pdfToWordUtils.js'

export const LIMITS = {
  warnBytes: 150 * 1024 * 1024,
  maxBytes: 600 * 1024 * 1024,
  stallMs: 90_000,
  packStallMs: 240_000,
  maxMs: 30 * 60_000,
}

/**
 * Convert one PDF to PowerPoint (.pptx) — 100% in this browser tab, zero network.
 *
 * @param {File} file
 * @param {object} [opts]
 * @param {'editable'|'images'} [opts.mode='editable']
 * @param {'auto'|'16:9'|'4:3'} [opts.slideLayout='auto']
 * @param {(p:object)=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{blob:Blob, warnings:object[], stats:object, engine:string}>}
 */
export async function convertPdfToPptx(
  file,
  { onProgress, signal, mode = 'editable', slideLayout = 'auto', stallMs, maxMs } = {}
) {
  validateInput(file)
  if (signal?.aborted) throw abortError()

  const ctl = new AbortController()
  let failure = null
  const onUserAbort = () => ctl.abort()
  signal?.addEventListener('abort', onUserAbort, { once: true })

  let stallTimer = null
  let currentStall = stallMs ?? LIMITS.stallMs
  const arm = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      failure = new ConversionError(
        'STALLED',
        'Conversion stopped responding and was cancelled. Try a smaller file or split the PDF.'
      )
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
    arm()
    lastPercent = Math.max(lastPercent, Math.min(100, p.percent ?? 0))
    try { onProgress?.({ ...p, percent: lastPercent }) } catch { /* UI errors must not break conversion */ }
  }

  arm()
  try {
    const sizeNote = file.size > LIMITS.warnBytes ? ' (large file — this can take a while)' : ''
    report({ percent: 0, stage: 'loading', message: `Starting conversion${sizeNote}…` })

    const res = await runPdfToPptxPipeline(file, {
      mode,
      slideLayout,
      signal: ctl.signal,
      onProgress: report,
    })
    return { ...res, engine: mode === 'images' ? 'images' : 'robust' }
  } catch (err) {
    if (failure) throw failure
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
    throw new ConversionError(
      'TOO_LARGE',
      `This PDF is ${(file.size / 1048576).toFixed(0)} MB. Files above ${LIMITS.maxBytes / 1048576} MB cannot be converted safely in the browser.`
    )
  }
}
