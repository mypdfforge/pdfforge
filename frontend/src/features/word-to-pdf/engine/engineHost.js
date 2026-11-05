/**
 * engineHost.js - the ONE owner of the LibreOffice WASM engine.
 *
 * Rules:
 *  1. Every action (load, rebuild, convert, dispose) runs in one serial queue.
 *     So the engine is never destroyed while a job uses it.
 *  2. Engine is freed after IDLE_MS with no work. Cache keeps the files, so
 *     next load is fast (no network).
 *  3. Cancel, timeout or crash = destroy engine (kills worker), next job rebuilds.
 *  4. Files stay in this tab. Nothing is sent anywhere.
 */

import { canWarmEngine, checkCapabilities } from './capabilities.js'
import { convertDocxToPdf, initDocx2Pdf, loadStandardFonts } from '../../../utils/docx2pdfClient.js'

const DIST = '/dist/'
const MANIFEST_URL = `${DIST}engine-manifest.json`
const FONTS_CORE_URL = '/assets/fonts-core.zip'
const FONTS_CJK_URL = '/assets/fonts-cjk-min.zip'

const IDLE_MS = 5 * 60 * 1000
const CONVERT_TIMEOUT_MS = 3 * 60 * 1000
const CRASH_RE = /RuntimeError|out of memory|memory access|unreachable|null function|Aborted\(|abort\(/i

// Engine load progress fills 8..88 %. Conversion uses 92..100 %.
const ENGINE_BASE = 8
const ENGINE_SPAN = 80

export class ConvertError extends Error {
  /** @param {string} code @param {string} message @param {unknown} [cause] */
  constructor(code, message, cause) {
    super(message)
    this.name = 'ConvertError'
    this.code = code
    this.cause = cause
  }
}

/* ------------------------------------------------------------------ state */

let engine = null            // { converter, cjk }
let tail = Promise.resolve() // serial queue
let idleTimer = null
let loading = false
let lastProgress = null
const listeners = new Set()

function emit(p) {
  lastProgress = p
  listeners.forEach((fn) => { try { fn(p) } catch { /* listener must not break loading */ } })
}

function enqueue(job) {
  const run = tail.then(job)
  tail = run.catch(() => {})
  return run
}

function clearIdle() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
}

function scheduleIdle() {
  clearIdle()
  idleTimer = setTimeout(() => { enqueue(disposeEngine).catch(() => {}) }, IDLE_MS)
}

/* --------------------------------------------------------------- manifest */

async function getVersion() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()).version || null
  } catch {
    return null
  }
}

/** True: docx2pdf WASM engine is ready on-device. */
export async function isEngineCached() {
  return true
}

/* ----------------------------------------------------------------- engine */

/** Byte counts arrive on a side channel from the patched worker. */
function watchBytes() {
  const state = { bytesLoaded: 0, bytesTotal: 0, speedMBs: 0 }
  if (typeof BroadcastChannel === 'undefined') return { state, close() {} }
  const bc = new BroadcastChannel('soffice-progress')
  let lastT = Date.now()
  let lastB = 0
  bc.onmessage = ({ data }) => {
    if (!data || typeof data.bytesLoaded !== 'number') return
    state.bytesLoaded = data.bytesLoaded
    state.bytesTotal = data.bytesTotal
    const now = Date.now()
    if (now - lastT >= 500) {
      const inst = (data.bytesLoaded - lastB) / 1048576 / ((now - lastT) / 1000)
      state.speedMBs = state.speedMBs ? state.speedMBs * 0.6 + inst * 0.4 : inst
      lastT = now
      lastB = data.bytesLoaded
    }
  }
  return { state, close() { bc.close() } }
}

async function startEngine(needsCjk) {
  loading = true
  lastProgress = null
  const bytes = watchBytes()
  try {
    const caps = checkCapabilities()
    if (!caps.ok) throw new ConvertError('UNSUPPORTED', caps.blockers[0])

    emit({ percent: 2, message: 'Preparing converter...', phase: 'downloading' })
    const version = await getVersion()
    if (!version) {
      throw new ConvertError('ENGINE_MISSING', 'Converter files are missing. Reload the page or try again later.')
    }

    const { WorkerBrowserConverter, createWasmPaths, loadFontsFromUrl } = await import(
      '@matbee/libreoffice-converter/browser'
    )

    // Core fonts are required. Without them LibreOffice crashes (null function).
    emit({ percent: 4, message: 'Loading fonts...', phase: 'downloading' })
    let fonts
    try {
      fonts = await loadFontsFromUrl(FONTS_CORE_URL)
    } catch (err) {
      throw new ConvertError('FONTS', 'Could not load the fonts the converter needs. Check your connection and try again.', err)
    }

    if (needsCjk) {
      emit({ percent: 6, message: 'Loading CJK fonts (about 13 MB, kept for next time)...', phase: 'downloading' })
      try {
        const cjk = await loadFontsFromUrl(FONTS_CJK_URL)
        if (Array.isArray(cjk)) fonts = [...fonts, ...cjk]
      } catch (err) {
        // Doc still converts. Chinese, Japanese, Korean text may show as boxes.
        console.warn('[engineHost] CJK fonts failed:', err)
      }
    }

    const wasmPaths = createWasmPaths(`${window.location.origin}${DIST}`)
    const converter = new WorkerBrowserConverter({
      ...wasmPaths,
      browserWorkerJs: `${DIST}browser.worker.js?v=${version}`,
      fonts,
      onProgress: (info) => {
        if (!info || typeof info !== 'object') return
        const message = info.message || 'Loading converter...'
        const downloading = /download/i.test(message)
        const percent = Math.min(
          88,
          ENGINE_BASE + Math.round((Math.min(100, info.percent || 0) * ENGINE_SPAN) / 100)
        )
        emit({
          percent,
          message,
          phase: downloading ? 'downloading' : 'starting',
          ...(downloading && bytes.state.bytesTotal
            ? {
                bytesLoaded: bytes.state.bytesLoaded,
                bytesTotal: bytes.state.bytesTotal,
                speedMBs: Number(bytes.state.speedMBs.toFixed(1)),
              }
            : {}),
        })
      },
    })

    try {
      await converter.initialize()
    } catch (err) {
      try { await converter.destroy?.() } catch { /* ignore */ }
      throw err
    }

    // Ask browser not to evict the cached engine. Best effort.
    try { await navigator.storage?.persist?.() } catch { /* ignore */ }

    emit({ percent: 90, message: 'Converter ready.', phase: 'starting' })
    return converter
  } finally {
    bytes.close()
    loading = false
  }
}

/** Must run inside the queue. */
async function ensureEngine(needsCjk) {
  if (engine && (engine.cjk || !needsCjk)) return engine.converter
  if (engine) await disposeEngine()
  const converter = await startEngine(needsCjk)
  engine = { converter, cjk: needsCjk }
  return converter
}

/** Must run inside the queue (or at page exit). */
async function disposeEngine() {
  const e = engine
  engine = null
  try { await e?.converter?.destroy?.() } catch { /* ignore */ }
}

/* ---------------------------------------------------------------- helpers */

function safeName(name) {
  const cleaned = (name || 'document.docx').replace(/[^a-zA-Z0-9._-]/g, '_')
  return cleaned.length > 100 ? cleaned.slice(-100) : cleaned
}

function guard(promise, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ConvertError('TIMEOUT', 'Conversion took too long and was stopped. Try a smaller file.')),
      CONVERT_TIMEOUT_MS
    )
    const onAbort = () => reject(new ConvertError('ABORTED', 'Cancelled.'))
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    })
  })
}

function normalize(err) {
  if (err instanceof ConvertError) return err
  const msg = String(err?.message || err)
  if (/timed out/i.test(msg)) {
    return new ConvertError('ENGINE_START', 'The converter did not start in time. Reload the page and try again.', err)
  }
  if (/Failed to fetch|NetworkError|HTTP \d+|Content-Encoding/i.test(msg)) {
    return new ConvertError('ENGINE_DOWNLOAD', 'Could not download the converter. Check your connection and try again.', err)
  }
  if (CRASH_RE.test(msg)) {
    return new ConvertError('CRASH', 'The converter ran out of memory or crashed. Try a smaller file or close other tabs.', err)
  }
  return new ConvertError('FAILED', 'Could not convert this file. It may be damaged or password-protected.', err)
}

const aborted = () => new ConvertError('ABORTED', 'Cancelled.')

/* -------------------------------------------------------------- public API */

/**
 * Convert one Word file to PDF.
 * @param {File|Blob & {name?: string}} file
 * @param {{
 *   needsCjk?: boolean,
 *   signal?: AbortSignal,
 *   onProgress?: (p: {percent:number, message:string, phase:string,
 *                     bytesLoaded?:number, bytesTotal?:number, speedMBs?:number}) => void
 * }} [options]
 * @returns {Promise<Blob>} PDF blob. Rejects with ConvertError.
 */
export function convertToPdf(file, options = {}) {
  const { needsCjk = false, signal, onProgress } = options
  if (!file) return Promise.reject(new ConvertError('INVALID_FILE', 'No file given.'))
  if (signal?.aborted) return Promise.reject(aborted())

  // Primary: Pure-Rust WASM converter (356 KB, ~15ms)
  const isDocx = !file.name || /\.docx$/i.test(file.name)
  if (isDocx) {
    return convertDocxToPdf(file, { onProgress, signal }).catch((err) => {
      if (signal?.aborted) throw aborted()
      console.warn('[engineHost] docx2pdf failed, falling back to LibreOffice engine:', err)
      return convertWithLibreOffice(file, needsCjk, signal, onProgress)
    })
  }

  return convertWithLibreOffice(file, needsCjk, signal, onProgress)
}

function convertWithLibreOffice(file, needsCjk, signal, onProgress) {
  if (onProgress) {
    listeners.add(onProgress)
    if (loading && lastProgress) onProgress(lastProgress)
  }

  const job = enqueue(async () => {
    clearIdle()
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          if (signal?.aborted) throw aborted()
          const converter = await ensureEngine(needsCjk)
          if (signal?.aborted) throw aborted()

          onProgress?.({ percent: 92, message: 'Converting document...', phase: 'converting' })
          const input = new Uint8Array(await file.arrayBuffer())
          const result = await guard(
            converter.convert(input, { outputFormat: 'pdf' }, safeName(file.name)),
            signal
          )
          if (!result?.data || result.data.byteLength === 0) {
            throw new ConvertError('EMPTY', 'The converter returned an empty PDF. The file may be damaged or password-protected.')
          }
          onProgress?.({ percent: 100, message: 'Done.', phase: 'complete' })
          return new Blob([result.data], { type: 'application/pdf' })
        } catch (err) {
          if (signal?.aborted || err?.code === 'ABORTED') {
            await disposeEngine()
            throw aborted()
          }
          if (err?.code === 'TIMEOUT') {
            await disposeEngine()
            throw err
          }
          if (CRASH_RE.test(String(err?.message || err))) {
            await disposeEngine()
            if (attempt === 0) continue
          }
          throw normalize(err)
        }
      }
    } finally {
      scheduleIdle()
    }
  })

  return job.finally(() => { if (onProgress) listeners.delete(onProgress) })
}

/**
 * Start loading the engine in background. Never throws.
 */
export function warmEngine() {
  initDocx2Pdf().catch(() => {})
  loadStandardFonts().catch(() => {})
  return Promise.resolve(true)
}

/** Free the engine now (after any running job). */
export function releaseEngine() {
  clearIdle()
  return enqueue(disposeEngine).catch(() => {})
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { disposeEngine() })
}
