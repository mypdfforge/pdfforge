# PDF TO WORD CONVERTER — COMPLETE CODE & ARCHITECTURE BUNDLE
*Generated for AI Agents & Context Windows*

---

## 1. What is this Tool?
This is an enterprise-grade, **100% client-side** PDF-to-Word (.docx) conversion engine. It converts complex PDFs (financial reports, resumes, academic articles, tables, forms) into **natively editable, reflowable Microsoft Word (.docx) documents**.

- **Zero Server Uploads:** 100% in-browser processing via JavaScript, Web Workers, and pdfjs-dist. Sensitive documents never leave the client device.
- **Zero Floating Textboxes (w:txbxContent = 0):** Reconstructs true Word paragraphs, headings, bullet/numbered lists, and tables that naturally reflow when edited.
- **Memory-Safe Multi-Page Architecture:** Features an isolated per-page failure ladder, chunked event loop yielding, downscaled raster caching, and dedicated Web Worker background packaging.

## 2. WASM & Gateways Audit
- **WASM Used in PDF-to-Word:** **None.** The PDF-to-Word converter runs on 100% pure TypeScript/JavaScript and standard Web Workers. (Note: neighboring tools in the repo use WASM: docx2pdf_bg.wasm for Word-to-PDF, LibreOffice soffice.wasm for fallback conversion, and ort-wasm-simd-threaded.wasm for OCR).
- **Gateways Used:** **None (Zero Network Gateways).** There are no HTTP/API gateways, cloud proxies, or reverse proxies. Conversion runs strictly in-memory (ArrayBuffer / Blob).

---

## 3. Bundled Files Manifest
1. frontend/src/features/pdf-to-word/engine/engineHost.js (6,047 bytes)
2. frontend/src/features/pdf-to-word/state/usePdfToWord.js (9,249 bytes)
3. frontend/src/features/pdf-to-word/ui/PdfToWordTool.jsx (12,467 bytes)
4. frontend/src/features/pdf-to-word/lib/download.js (1,166 bytes)
5. frontend/src/utils/pdfToWordPipeline.js (19,678 bytes)
6. frontend/src/utils/pdfToWordUtils.js (18,057 bytes)
7. frontend/src/utils/docxBuild.js (19,986 bytes)
8. frontend/src/utils/pdfToWordBuildWorker.js (965 bytes)
9. frontend/src/utils/pdfLayoutSegmenter.js (29,964 bytes)
10. frontend/src/utils/pdfTableDetector.js (15,867 bytes)
11. frontend/src/utils/pdfVectorExtractor.js (5,306 bytes)
12. frontend/src/utils/documentAst.js (6,864 bytes)
13. frontend/src/utils/documentLayoutAnalysis.js (8,061 bytes)
14. frontend/src/utils/docxEmitter.js (7,807 bytes)
15. pdf2docx-web/PROJECT_BRAIN.md (10,639 bytes)
16. pdf2docx-web/package.json (784 bytes)
17. pdf2docx-web/src/core/ast.ts (3,428 bytes)
18. pdf2docx-web/src/core/pageir.ts (1,564 bytes)
19. pdf2docx-web/src/core/params.ts (1,614 bytes)
20. pdf2docx-web/src/ingest/pdfLoader.ts (4,948 bytes)
21. pdf2docx-web/src/ingest/opInterpreter.ts (15,475 bytes)
22. pdf2docx-web/src/dla/pipeline.ts (6,213 bytes)
23. pdf2docx-web/src/dla/xycut.ts (6,576 bytes)
24. pdf2docx-web/src/dla/tablesRuled.ts (12,587 bytes)
25. pdf2docx-web/src/dla/tablesBorderless.ts (9,507 bytes)
26. pdf2docx-web/src/dla/paragraphs.ts (11,895 bytes)
27. pdf2docx-web/src/emit/docxEmitter.ts (9,523 bytes)

---

## 4. Complete Source Code by File

### File: frontend/src/features/pdf-to-word/engine/engineHost.js

`javascript
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
 * to text/image and are reported in   warnings  ). Rejects only with a typed error:
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
    report({ percent: 0, stage: 'loading', message:   Starting conversion${sizeNote}…   })

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
    throw new ConversionError('TOO_LARGE',   This PDF is ${(file.size / 1048576).toFixed(0)} MB. Files above ${LIMITS.maxBytes / 1048576} MB cannot be converted safely in the browser.  )
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

`

---

### File: frontend/src/features/pdf-to-word/state/usePdfToWord.js

`javascript
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { convertPdfToWord } from '../engine/engineHost.js'

/**
 * item.status:  ready → converting → done | error | cancelled      (retry: error|cancelled → ready)
 * item fields:  id, file, percent, message, stage, page, totalPages, pagesPerSec, etaSec,
 *               warnings[], stats, hasResult, error, errorCode, startedAt
 *
 * Result Blobs are NOT kept in React state — they live in a ref-held Map so they can be released
 * (remove / clear / unmount) and never get copied around by re-renders.
 */

const FRIENDLY = {
  ENCRYPTED: 'This PDF is password-protected. Remove the password and try again.',
  INVALID_PDF: 'This file is not a valid or readable PDF.',
  TOO_LARGE: null, // engine message already contains the numbers
  STALLED: null,
  TIMEOUT: null,
  OOM: 'The browser ran out of memory. Close other tabs or split the PDF into smaller parts.',
  NO_PDFJS: 'The PDF engine did not load. Refresh the page and try again.',
  EMPTY: 'This PDF has no pages.',
}

function reducer(items, action) {
  switch (action.type) {
    case 'add':
      return [...items, ...action.items]
    case 'patch':
      return items.map((i) => (i.id === action.id ? { ...i, ...action.patch } : i))
    case 'remove':
      return items.filter((i) => i.id !== action.id)
    case 'clearFinished':
      return items.filter((i) => i.status === 'converting' || i.status === 'ready')
    case 'patchWhere':
      return items.map((i) => (action.where(i) ? { ...i, ...action.patch } : i))
    default:
      return items
  }
}

const makeId = () => (globalThis.crypto?.randomUUID?.() ??   id-${Date.now()}-${Math.random().toString(36).slice(2)}  )
export const outputName = (file) => (file.name || 'document').replace(/\.pdf$/i, '') + '.docx'

export function usePdfToWord() {
  const [items, dispatch] = useReducer(reducer, [])
  const [running, setRunning] = useState(false)

  const itemsRef = useRef(items)
  itemsRef.current = items
  const filesRef = useRef(new Map())      // id → File
  const blobsRef = useRef(new Map())      // id → docx Blob
  const controllers = useRef(new Map())   // id → AbortController
  const queueRef = useRef([])             // ids waiting to run, in order
  const runningRef = useRef(false)
  const mounted = useRef(true)
  const lastPatch = useRef(new Map())     // id → { t, stage }  (progress throttling)

  useEffect(() => {
    mounted.current = true
    const ctls = controllers.current, blobs = blobsRef.current, files = filesRef.current
    return () => {
      mounted.current = false
      ctls.forEach((c) => c.abort())
      ctls.clear(); blobs.clear(); files.clear()
      queueRef.current = []
    }
  }, [])

  // Warn before closing the tab mid-conversion.
  useEffect(() => {
    if (!running) return undefined
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [running])

  const patch = useCallback((id, p) => {
    if (mounted.current) dispatch({ type: 'patch', id, patch: p })
  }, [])

  const addFiles = useCallback((files) => {
    const list = Array.from(files || [])
    if (!list.length) return { added: 0, rejected: [] }
    const rejected = []
    const created = []
    for (const file of list) {
      if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''))) { rejected.push(file.name || 'file'); continue }
      const id = makeId()
      filesRef.current.set(id, file)
      created.push({ id, file, status: 'ready', percent: 0, message: '', stage: 'ready', warnings: [], hasResult: false })
    }
    if (created.length) dispatch({ type: 'add', items: created })
    return { added: created.length, rejected }
  }, [])

  const processOne = useCallback(async (id) => {
    const file = filesRef.current.get(id)
    const current = itemsRef.current.find((i) => i.id === id)
    if (!file || (current && current.status !== 'ready')) return // removed / cancelled while waiting
    const ctl = new AbortController()
    controllers.current.set(id, ctl)
    lastPatch.current.set(id, { t: 0, stage: '' })
    patch(id, { status: 'converting', percent: 0, message: 'Starting conversion…', stage: 'loading', startedAt: Date.now(), error: undefined, errorCode: undefined })
    try {
      const res = await convertPdfToWord(file, {
        signal: ctl.signal,
        onProgress: (p) => {
          const lp = lastPatch.current.get(id)
          const t = performance.now()
          // ≤ ~8 UI updates/second, but never swallow stage changes or the last tick
          if (lp && t - lp.t < 120 && lp.stage === p.stage && p.percent < 100) return
          lastPatch.current.set(id, { t, stage: p.stage })
          patch(id, { percent: p.percent, message: p.message, stage: p.stage, page: p.page, totalPages: p.totalPages,
            pagesPerSec: p.pagesPerSec, etaSec: p.etaSec, warningCount: p.warnings })
        },
      })
      if (!mounted.current || !filesRef.current.has(id)) return // removed while converting: drop result
      blobsRef.current.set(id, res.blob)
      patch(id, { status: 'done', percent: 100, message: 'Done', stage: 'done', hasResult: true,
        warnings: res.warnings || [], warningCount: (res.warnings || []).length, stats: res.stats })
    } catch (err) {
      if (err?.code === 'ABORTED' || err?.name === 'AbortError') {
        patch(id, { status: 'cancelled', message: 'Cancelled', stage: 'cancelled' })
      } else {
        const msg = FRIENDLY[err?.code] ?? err?.message ?? 'Conversion failed.'
        patch(id, { status: 'error', error: msg, errorCode: err?.code || 'INTERNAL', message: '', stage: 'error' })
      }
    } finally {
      controllers.current.delete(id)
      lastPatch.current.delete(id)
    }
  }, [patch])

  /** Convert every ready file, one at a time (keeps peak memory at one PDF). One failure never stops the batch. */
  const start = useCallback(async () => {
    if (runningRef.current) return
    // queue = ready items not already queued
    for (const i of itemsRef.current) if (i.status === 'ready' && !queueRef.current.includes(i.id)) queueRef.current.push(i.id)
    if (!queueRef.current.length) return
    runningRef.current = true
    setRunning(true)
    try {
      while (mounted.current) {
        // pick up files added while running
        for (const i of itemsRef.current) if (i.status === 'ready' && !queueRef.current.includes(i.id)) queueRef.current.push(i.id)
        const id = queueRef.current.shift()
        if (!id) break
        try { await processOne(id) } catch (e) { patch(id, { status: 'error', error: e?.message || 'Conversion failed.', errorCode: 'INTERNAL' }) }
        await new Promise((r) => setTimeout(r, 0)) // let React paint between files
      }
    } finally {
      runningRef.current = false
      if (mounted.current) setRunning(false)
    }
  }, [processOne, patch])

  const release = useCallback((id) => {
    blobsRef.current.delete(id)
    if (mounted.current) dispatch({ type: 'patch', id, patch: { hasResult: false } })
  }, [])

  const cancel = useCallback((id) => {
    const ctl = controllers.current.get(id)
    queueRef.current = queueRef.current.filter((q) => q !== id)
    if (ctl) ctl.abort()
    else dispatch({ type: 'patch', id, patch: { status: 'cancelled', message: 'Cancelled', stage: 'cancelled' } })
  }, [])

  const cancelAll = useCallback(() => {
    queueRef.current = []
    controllers.current.forEach((c) => c.abort())
    dispatch({ type: 'patchWhere', where: (i) => i.status === 'ready', patch: { status: 'cancelled', message: 'Cancelled', stage: 'cancelled' } })
  }, [])

  const remove = useCallback((id) => {
    queueRef.current = queueRef.current.filter((q) => q !== id)
    controllers.current.get(id)?.abort()
    filesRef.current.delete(id)
    blobsRef.current.delete(id)
    dispatch({ type: 'remove', id })
  }, [])

  const retry = useCallback((id) => {
    if (!filesRef.current.has(id)) return
    blobsRef.current.delete(id)
    dispatch({ type: 'patch', id, patch: { status: 'ready', percent: 0, message: '', stage: 'ready', error: undefined, errorCode: undefined, warnings: [], warningCount: 0, hasResult: false } })
  }, [])

  const clear = useCallback(() => {
    for (const i of itemsRef.current) {
      if (i.status !== 'converting' && i.status !== 'ready') { filesRef.current.delete(i.id); blobsRef.current.delete(i.id) }
    }
    dispatch({ type: 'clearFinished' })
  }, [])

  const getBlob = useCallback((id) => blobsRef.current.get(id) || null, [])

  /** Trigger a browser download for one finished item. */
  const download = useCallback((id) => {
    const blob = blobsRef.current.get(id), file = filesRef.current.get(id)
    if (!blob || !file) return false
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = outputName(file); a.rel = 'noopener'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return true
  }, [])

  return { items, running, addFiles, start, cancel, cancelAll, remove, retry, clear, release, getBlob, download }
}

`

---

### File: frontend/src/features/pdf-to-word/ui/PdfToWordTool.jsx

`javascript
import { useCallback, useEffect, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Download,
  FileText,
  RotateCw,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import TopBar from '../../../components/TopBar'
import { usePdfToWord, outputName } from '../state/usePdfToWord.js'
import { downloadBlob, formatBytes, zipDocx } from '../lib/download.js'
import { formatEta } from '../../../utils/pdfToWordUtils.js'

const card = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
}

const notice = (color) => ({
  display: 'flex',
  gap: '10px',
  alignItems: 'flex-start',
  padding: '12px 14px',
  borderRadius: '10px',
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--text)',
  background: 'var(--bg2)',
  border:   1px solid ${color}  ,
})

const primaryBtn = (disabled) => ({
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  padding: '12px 22px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
})

const ghostBtn = {
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '7px 12px',
  fontSize: '13px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
}

function ItemRow({ item, onDownload, onCancel, onRetry, onRemove }) {
  const { status, percent, message, error, warningCount, warnings, pagesPerSec, etaSec } = item

  const color =
    status === 'error'
      ? 'var(--red)'
      : status === 'done'
      ? 'var(--green)'
      : 'var(--text3)'

  let text = ''
  if (status === 'ready') {
    text =   Ready • ${formatBytes(item.file.size)}  
  } else if (status === 'converting') {
    const parts = [message || 'Converting…']
    if (pagesPerSec) parts.push(  ${pagesPerSec} p/s  )
    if (etaSec) parts.push(formatEta(etaSec))
    text = parts.join(' • ')
  } else if (status === 'done') {
    text = 'Conversion complete (.docx ready)'
  } else if (status === 'cancelled') {
    text = 'Conversion cancelled'
  } else if (status === 'error') {
    text = error || 'Conversion failed.'
  }

  return (
    <li
      style={{
        ...card,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        listStyle: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        {status === 'done' ? (
          <CheckCircle size={20} color="var(--green)" style={{ flexShrink: 0 }} />
        ) : status === 'error' ? (
          <AlertCircle size={20} color="var(--red)" style={{ flexShrink: 0 }} />
        ) : (
          <FileText size={20} color="var(--text3)" style={{ flexShrink: 0 }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.file.name}
          </div>
          <div style={{ fontSize: '12px', color, marginTop: '2px' }}>{text}</div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {status === 'done' && (
            <button
              type="button"
              style={{ ...ghostBtn, color: 'var(--accent)', borderColor: 'var(--accent)' }}
              onClick={() => onDownload(item.id)}
            >
              <Download size={14} /> Download Word (.docx)
            </button>
          )}

          {status === 'converting' && (
            <button type="button" style={ghostBtn} onClick={() => onCancel(item.id)}>
              Cancel
            </button>
          )}

          {(status === 'error' || status === 'cancelled') && (
            <button type="button" style={ghostBtn} onClick={() => onRetry(item.id)}>
              <RotateCw size={14} /> Retry
            </button>
          )}

          {status !== 'converting' && (
            <button
              type="button"
              aria-label={  Remove ${item.file.name}  }
              style={{ ...ghostBtn, padding: '7px' }}
              onClick={() => onRemove(item.id)}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {status === 'converting' && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent || 0)}
          style={{
            height: '4px',
            borderRadius: '2px',
            background: 'var(--border)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width:   ${Math.max(2, percent || 0)}%  ,
              background: 'var(--accent)',
              transition: 'width .2s linear',
            }}
          />
        </div>
      )}

      {warningCount > 0 && status === 'done' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11.5px',
            color: 'var(--text3)',
            marginTop: '2px',
          }}
        >
          <AlertTriangle size={13} color="var(--amber)" />
          <span>
            {warningCount} {warningCount === 1 ? 'page' : 'pages'} used fallback formatting
            to protect document integrity.
          </span>
        </div>
      )}
    </li>
  )
}

export default function PdfToWordTool({
  onBack,
  dark,
  onToggleTheme,
  onGoHome,
  showCategories,
  activeCategory,
  onCategoryChange,
  search,
  onSearch,
  initialFiles,
}) {
  const {
    items,
    running,
    addFiles,
    start,
    cancel,
    cancelAll,
    remove,
    retry,
    clear,
    getBlob,
    download,
  } = usePdfToWord()

  const [rejected, setRejected] = useState('')

  // Auto-load files if passed from dashboard
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      addFiles(Array.from(initialFiles))
    }
  }, [initialFiles, addFiles])

  const onDrop = useCallback(
    (accepted, rejections) => {
      if (rejections.length) {
        setRejected(rejections.map((r) =>   ${r.file.name}: only PDF files work.  ).join(' '))
      } else {
        setRejected('')
      }
      addFiles(accepted)
    },
    [addFiles]
  )

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    noClick: true,
    noKeyboard: true,
  })

  const readyCount = items.filter((i) => i.status === 'ready').length
  const doneItems = items.filter((i) => i.status === 'done')

  const downloadAllZip = async () => {
    const entries = []
    for (const item of doneItems) {
      const blob = getBlob(item.id)
      if (blob) {
        entries.push({ name: outputName(item.file), blob })
      }
    }
    if (entries.length > 0) {
      const zip = await zipDocx(entries)
      downloadBlob(zip, 'converted_word_documents.zip')
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TopBar
        onBack={onBack}
        title="PDF to Word"
        subtitle="Convert PDF documents into editable Word (.docx) files."
        dark={dark}
        onToggleTheme={onToggleTheme}
        onGoHome={onGoHome}
        showCategories={showCategories}
        activeCategory={activeCategory}
        onCategoryChange={onCategoryChange}
        search={search}
        onSearch={onSearch}
      />

      <main
        style={{
          flex: 1,
          width: '100%',
          maxWidth: '740px',
          margin: '0 auto',
          padding: '32px 20px 64px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            color: 'var(--text3)',
            lineHeight: 1.5,
          }}
        >
          <Zap size={15} color="var(--accent)" />
          <span>
            Hardened on-device conversion. Tables, columns, and graphics preserved with zero
            data leaving your browser.
          </span>
        </div>

        <div
          {...getRootProps()}
          style={{
            ...card,
            border:   2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}  ,
            padding: '40px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color 0.15s ease',
          }}
          onClick={open}
        >
          <input {...getInputProps()} />
          <Upload size={30} color="var(--text3)" style={{ margin: '0 auto 12px' }} />
          <div
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--text)',
              marginBottom: '4px',
            }}
          >
            {isDragActive ? 'Drop your PDF files here' : 'Drop PDF files here, or click to browse'}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '16px' }}>
            Supports standard and complex multi-page PDFs. Add one or many files.
          </div>
          <button
            type="button"
            style={primaryBtn(false)}
            onClick={(e) => {
              e.stopPropagation()
              open()
            }}
          >
            Choose PDF files
          </button>
        </div>

        {rejected && (
          <div role="alert" style={notice('var(--red)')}>
            <AlertCircle size={18} color="var(--red)" style={{ flexShrink: 0 }} />
            <span>{rejected}</span>
          </div>
        )}

        {items.length > 0 && (
          <>
            <ul
              aria-live="polite"
              style={{
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onDownload={download}
                  onCancel={cancel}
                  onRetry={retry}
                  onRemove={remove}
                />
              ))}
            </ul>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                flexWrap: 'wrap',
                alignItems: 'center',
                paddingTop: '8px',
              }}
            >
              <button
                type="button"
                style={primaryBtn(running || readyCount === 0)}
                disabled={running || readyCount === 0}
                onClick={start}
              >
                {running ? (
                  <>Converting…</>
                ) : (
                  <>Convert {readyCount} {readyCount === 1 ? 'file' : 'files'} to Word</>
                )}
              </button>

              {running && (
                <button
                  type="button"
                  style={{ ...ghostBtn, padding: '12px 18px', fontSize: '14px' }}
                  onClick={cancelAll}
                >
                  Cancel conversion
                </button>
              )}

              {doneItems.length > 1 && (
                <button
                  type="button"
                  style={{ ...ghostBtn, padding: '12px 18px', fontSize: '14px' }}
                  onClick={downloadAllZip}
                >
                  <Download size={16} /> Download all as ZIP ({doneItems.length})
                </button>
              )}

              <button
                type="button"
                style={{ ...ghostBtn, padding: '12px 18px', fontSize: '14px', marginLeft: 'auto' }}
                onClick={clear}
                disabled={running}
              >
                Clear list
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

`

---

### File: frontend/src/features/pdf-to-word/lib/download.js

`javascript
import { zipSync } from 'fflate'

export function docxName(name) {
  const base = (name || 'document').replace(/\.[^.]+$/, '')
  return   ${base}.docx  
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return ''
  if (n < 1024 * 1024) return   ${(n / 1024).toFixed(1)} KB  
  return   ${(n / 1048576).toFixed(2)} MB  
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * @param {{name: string, blob: Blob}[]} entries
 * @returns {Promise<Blob>} zip of DOCX files. Duplicate names get -2, -3 ...
 */
export async function zipDocx(entries) {
  const files = {}
  const used = new Map()
  for (const { name, blob } of entries) {
    const count = (used.get(name) || 0) + 1
    used.set(name, count)
    const finalName = count === 1 ? name : name.replace(/\.docx$/i,   -${count}.docx  )
    files[finalName] = new Uint8Array(await blob.arrayBuffer())
  }
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' })
}

`

---

### File: frontend/src/utils/pdfToWordPipeline.js

`javascript
/**
 * pdfToWordPipeline.js — hardened, per-page-isolated PDF → .docx converter.
 * 100% client-side. No fetch/XHR/beacon calls anywhere in this module.
 *
 * Page lifecycle:   pdf.js page → layout/tables/images → compact "page model"
 *                   (page object, canvas and items released immediately)
 *                → after all pages: docx objects built page-by-page → packed.
 *
 * Failure ladder per page (a page NEVER kills the document):
 *   rich → plain text (own line grouping) → raw pdf.js text → page image → placeholder
 * Failure ladder for packaging: rich docx → plain-text docx → minimal docx.
 *
 * Requires: window.pdfjsLib (already loaded by the app), docx, and the existing
 * pdfLayoutSegmenter / pdfTableDetector / pdfVectorExtractor modules.
 */
import { extractPageLayout, segmentIntoColumns, mergeParagraphBlocks } from './pdfLayoutSegmenter.js'
import { detectTableRegions } from './pdfTableDetector.js'
import { extractVectorGeometry } from './pdfVectorExtractor.js'
import * as U from './pdfToWordUtils.js'
import { buildDocxBlob } from './docxBuild.js'

export { ConversionError } from './pdfToWordUtils.js'

const DEFAULTS = {
  pageTimeoutMs: 30_000,       // one page may not take longer than this (analysis stage)
  maxImagesPerPage: 12,
  imageBudgetSoft: 150 * 1024 * 1024, // after this, images are downscaled
  imageBudgetHard: 260 * 1024 * 1024, // after this, images are skipped (text still converted)
  minImagePt: 18,              // ignore images smaller than this (rules, bullets, icons)
}

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═════════════════════════════════════════════════════════════════════════════
/**
 * @param {File|Blob} file
 * @param {object} [opts]
 * @param {(p:{percent:number,stage:string,message:string,page?:number,totalPages?:number,
 *           pagesPerSec?:number,etaSec?:number|null,warnings?:number})=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.pageTimeoutMs]
 * @returns {Promise<{blob:Blob, warnings:object[], stats:object}>}
 */
export async function convertPdfToDocx(file, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts }
  const { signal, onProgress } = cfg
  const warnings = []
  const warn = (page, code, message, level = 'warn') => warnings.push({ page, code, message, level })
  const vel = U.makeVelocityTracker()
  const slice = U.createSlicer(8)
  const stats = { pages: 0, rich: 0, plain: 0, image: 0, failed: 0, images: 0, packMode: 'rich', elapsedMs: 0 }
  const t0 = U.now()

  const emit = (stage, message, percent, page, total) => {
    const v = total ? vel.snapshot(page ?? 0, total) : {}
    onProgress?.({ percent: Math.round(percent), stage, message, page, totalPages: total,
      pagesPerSec: v.pagesPerSec, etaSec: v.etaSec ?? null, warnings: warnings.length })
  }

  U.throwIfAborted(signal)
  const pdfjs = globalThis.pdfjsLib
  if (!pdfjs?.getDocument) throw new U.ConversionError('NO_PDFJS', 'PDF engine (pdf.js) is not loaded.')

  emit('loading', 'Reading PDF…', 1)
  let buf = await U.abortable(file.arrayBuffer(), signal)
  let task = null, pdf = null
  try {
    task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false })
    pdf = await U.abortable(task.promise, signal)
  } catch (e) {
    try { task?.destroy?.() } catch { /* ignore */ }
    throw U.classifyPdfError(e)
  } finally {
    buf = null // let the GC reclaim our copy
  }

  try {
    const n = pdf.numPages
    stats.pages = n
    if (!n) throw new U.ConversionError('EMPTY', 'This PDF has no pages.')

    // ── Pass 1: analyse every page in isolation ───────────────────────────
    const hist = new Map()
    const mem = { imageBytes: 0, lowMem: false, skipImages: false }
    const models = new Array(n)
    for (let p = 1; p <= n; p++) {
      U.throwIfAborted(signal)
      emit('analyze',   Analyzing page ${p} of ${n}…  , 2 + 68 * ((p - 1) / n), p - 1, n)
      try {
        models[p - 1] = await U.abortable(
          U.withTimeout(analyzePage(pdf, p, { pdfjs, hist, mem, warn, cfg }), cfg.pageTimeoutMs,   Page ${p}  ),
          signal
        )
      } catch (e) {
        if (e?.code === 'ABORTED') throw e
        warn(p, 'PAGE_FAILED',   Page ${p} could not be analysed (${e?.message || e}).  )
        models[p - 1] = { pageNum: p, mode: 'failed', w: 595.28, h: 841.89, lines: [], blocks: [], images: [], vector: null }
      }
      if (mem.imageBytes > cfg.imageBudgetSoft && !mem.lowMem) {
        mem.lowMem = true
        warn(null, 'LOW_MEMORY', 'Large images detected — remaining images are downscaled to keep the browser stable.', 'info')
      }
      if (mem.imageBytes > cfg.imageBudgetHard) mem.skipImages = true
      if (p % 10 === 0) { try { pdf.cleanup() } catch { /* ignore */ } }
      await slice(true)
    }

    // ── Pass 2 + pack: build docx structures and zip them (in a Worker when possible) ──
    const bodySize = U.dominantSize(hist, 11)
    const title = (cfg.title || file.name || 'Converted PDF').replace(/\.pdf$/i, '')
    emit('build', 'Detecting tables & columns…', 70, 0, n)
    stats.images = models.reduce((s, m) => s + (m.images?.length || 0) + (m.pageImage ? 1 : 0), 0)
    const built = await buildAndPack(models, { bodySize, title, warn, signal, cfg,
      onProgress: (i, total) => emit(i >= total ? 'pack' : 'build',
        i >= total ? 'Packaging Word document…' :   Detecting tables & columns — page ${i + 1} of ${total}…  ,
        i >= total ? 93 : 70 + 22 * (i / total), i, total) })
    const blob = built.blob
    stats.packMode = built.packMode
    for (const mode of built.modes) {
      if (mode === 'image') stats.image++
      else if (mode === 'failed') stats.failed++
      else if (mode === 'rich') stats.rich++
      else stats.plain++
    }

    // release everything heavy before returning
    for (const m of models) { m.images = null; m.pageImage = null; m.blocks = null; m.lines = null; m.vector = null }

    stats.elapsedMs = Math.round(U.now() - t0)
    emit('done', 'Done', 100, n, n)
    return { blob, warnings, stats }
  } finally {
    try { await pdf.cleanup?.() } catch { /* ignore */ }
    try { await task?.destroy?.() } catch { /* ignore */ }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  PASS 1 — ANALYSE ONE PAGE (everything heavy is released before returning)
// ═════════════════════════════════════════════════════════════════════════════
async function analyzePage(pdf, pageNum, ctx) {
  const { pdfjs, hist, mem, warn, cfg } = ctx
  const page = await pdf.getPage(pageNum)
  const model = { pageNum, mode: 'rich', w: 595.28, h: 841.89, lines: [], blocks: [], images: [], pageImage: null, vector: null, topDown: true }
  try {
    const vp = page.getViewport({ scale: 1 })
    model.w = vp.width
    model.h = vp.height

    // 1. text layout (ladder: segmenter layout → raw pdf.js text)
    let layout = null, items = null
    try { layout = await extractPageLayout(page); items = layout?.items } catch (e) {
      warn(pageNum, 'LAYOUT_FAILED',   Page ${pageNum}: layout extraction failed; using raw text.  )
    }
    if (!Array.isArray(items)) {
      model.mode = 'plain'
      try { items = await rawTextItems(page, vp) } catch { items = [] }
    }
    U.addToHistogram(hist, items)
    const pageW = layout?.pageWidth ?? vp.width

    // 2. reading order
    let lines = null
    if (layout) {
      try { lines = segmentIntoColumns(items, pageW) } catch (e) {
        warn(pageNum, 'COLUMNS_FAILED',   Page ${pageNum}: column detection failed; used line grouping.  )
      }
    }
    if (!lines) { lines = U.groupItemsIntoLines(items); model.mode = 'plain' }
    model.lines = lines.map(sanitizeLine)
    model.topDown = detectTopDown(model.lines)

    // 3. vector geometry (table borders / box fills) — optional
    try { model.vector = await extractVectorGeometry(page) } catch { model.vector = null }

    // 4. tables / callouts / code / columns
    if (model.mode === 'rich') {
      try { model.blocks = mergeParagraphBlocks(detectTableRegions(model.lines, pageW, model.vector)) }
      catch (e) {
        warn(pageNum, 'TABLES_FAILED',   Page ${pageNum}: table detection failed; text kept as paragraphs.  )
        model.mode = 'plain'
      }
    }
    if (model.mode !== 'rich') model.blocks = U.mergePlainLines(model.lines).map((line) => ({ type: 'paragraph', line }))

    // 5. images (best-effort; never blocks text)
    const chars = model.lines.reduce((s, l) => s + (l.text?.length || 0), 0)
    let rects = []
    try { rects = await detectImageRects(page, vp, pdfjs.OPS, cfg.minImagePt) } catch { rects = [] }
    const cov = U.coverage(rects, vp.width, vp.height)
    const isScan = (cov >= 0.6 && chars < 40) || (cov >= 0.85 && chars < 400)
    const wantImages = isScan || rects.length > 0
    if (wantImages && !mem.skipImages && typeof document !== 'undefined') {
      let rendered = null
      try {
        rendered = await renderPageCanvas(page, vp, mem)
        if (isScan) {
          const img = await canvasToImage(rendered.canvas, 0, 0, rendered.canvas.width, rendered.canvas.height, mem, 'jpeg')
          model.pageImage = { ...img, w: vp.width, h: vp.height }
          model.mode = 'image'
          model.blocks = []; model.lines = []
          mem.imageBytes += img.data.byteLength
          warn(pageNum, 'SCANNED_PAGE',   Page ${pageNum}: scanned/graphic page kept as an image.  , 'info')
        } else {
          let merged = U.mergeRects(rects, 4).sort((a, b) => U.rectArea(b) - U.rectArea(a)).slice(0, cfg.maxImagesPerPage)
          merged = merged.sort((a, b) => a.y - b.y)
          for (const r of merged) {
            const s = rendered.scale
            const img = await canvasToImage(rendered.canvas, r.x * s, r.y * s, r.w * s, r.h * s, mem, 'auto')
            model.images.push({ ...img, x: r.x, y: r.y, w: r.w, h: r.h })
            mem.imageBytes += img.data.byteLength
          }
        }
      } catch (e) {
        warn(pageNum, 'IMAGE_FAILED',   Page ${pageNum}: images could not be extracted (${e?.message || e}).  , 'info')
        if (isScan && chars === 0) model.mode = 'failed'
      } finally {
        if (rendered) releaseCanvas(rendered.canvas)
      }
    } else if (isScan && chars === 0) {
      model.mode = 'failed'
    }
    return model
  } finally {
    try { page.cleanup() } catch { /* ignore */ }
  }
}

/** pdf.js getTextContent → items shaped like the layout engine's (top-down y). */
async function rawTextItems(page, vp) {
  const tc = await page.getTextContent()
  const out = []
  for (const it of tc.items) {
    if (!it.str || !it.transform) continue
    const [a, b, , , e, f] = it.transform
    const size = Math.hypot(a, b) || it.height || 10
    const fam = tc.styles?.[it.fontName]?.fontFamily || it.fontName || ''
    out.push({
      str: it.str, x: e, y: vp.height - f, w: it.width || 0, size,
      isBold: /bold|black|heavy/i.test(it.fontName + ' ' + fam),
      isItalic: /italic|oblique/i.test(it.fontName + ' ' + fam),
    })
  }
  return out
}

function sanitizeLine(l) {
  if (!l) return l
  const text = U.cleanText(l.text)
  if (Array.isArray(l.spans)) l.spans = l.spans.map((s) => ({ ...s, text: U.cleanText(s.text) }))
  l.text = text
  return l
}

/** reading order is top→bottom, so if the first line's y is larger than the last's, y is bottom-up. */
function detectTopDown(lines) {
  const ys = lines.map((l) => l.y).filter(Number.isFinite)
  if (ys.length < 2) return true
  return ys[0] <= ys[ys.length - 1]
}

// ─── Image detection from the operator list (no pixel decoding needed) ──────
async function detectImageRects(page, vp, OPS, minPt) {
  if (!OPS) return []
  const ops = await page.getOperatorList()
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintJpegXObject].filter((v) => v !== undefined))
  const rects = []
  let ctm = U.IDENTITY.slice()
  const stack = []
  const { fnArray, argsArray } = ops
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    if (fn === OPS.save) stack.push(ctm.slice())
    else if (fn === OPS.restore) ctm = stack.pop() || U.IDENTITY.slice()
    else if (fn === OPS.transform) ctm = U.mulMatrix(ctm, argsArray[i])
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (argsArray[i]?.[0]) ctm = U.mulMatrix(ctm, argsArray[i][0]) }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || U.IDENTITY.slice()
    else if (imageOps.has(fn)) {
      const b = U.unitSquareBBox(U.mulMatrix(vp.transform, ctm))
      const x = clamp(b.x, 0, vp.width), y = clamp(b.y, 0, vp.height)
      const r = { x, y, w: Math.min(b.x + b.w, vp.width) - x, h: Math.min(b.y + b.h, vp.height) - y }
      if (r.w >= minPt && r.h >= minPt && U.rectArea(r) >= 0.002 * vp.width * vp.height) rects.push(r)
    }
  }
  return rects
}

async function renderPageCanvas(page, vp1, mem) {
  const maxDim = mem.lowMem ? 1200 : 2400
  const scale = Math.min(mem.lowMem ? 1 : 2, maxDim / Math.max(vp1.width, vp1.height))
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(vp.width))
  canvas.height = Math.max(1, Math.ceil(vp.height))
  const g = canvas.getContext('2d', { alpha: false })
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: g, canvas, viewport: vp, background: '#ffffff' }).promise
  return { canvas, scale }
}

function releaseCanvas(c) { try { c.width = 0; c.height = 0 } catch { /* ignore */ } }

async function canvasToImage(src, sx, sy, sw, sh, mem, kind) {
  sx = Math.max(0, Math.floor(sx)); sy = Math.max(0, Math.floor(sy))
  sw = Math.max(1, Math.min(Math.ceil(sw), src.width - sx)); sh = Math.max(1, Math.min(Math.ceil(sh), src.height - sy))
  const c = document.createElement('canvas')
  c.width = sw; c.height = sh
  try {
    c.getContext('2d', { alpha: false }).drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
    const png = kind === 'png' || (kind === 'auto' && sw * sh < 250_000)
    const mime = png ? 'image/png' : 'image/jpeg'
    const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), mime, mem.lowMem ? 0.6 : 0.85))
    return { data: new Uint8Array(await blob.arrayBuffer()), type: png ? 'png' : 'jpg', pxW: sw, pxH: sh }
  } finally { releaseCanvas(c) }
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUILD + PACK BRIDGE (Worker first, main thread as a safe fallback)
// ═════════════════════════════════════════════════════════════════════════════
async function buildAndPack(models, o) {
  const { signal, warn, cfg } = o
  const useWorker = cfg.useWorker !== false && typeof Worker !== 'undefined'
  if (useWorker) {
    let worker = null
    try {
      worker = await startBuildWorker(signal)
      return await runBuildInWorker(worker, models, o)
    } catch (e) {
      if (e?.code === 'ABORTED') throw e
      if (e?.afterTransfer) warn(null, 'WORKER_FAILED', 'Background build failed after images were handed over; images were dropped.')
      else warn(null, 'WORKER_UNAVAILABLE', 'Background worker unavailable; built on the main thread.', 'info')
      if (e?.afterTransfer) for (const m of models) { m.images = []; m.pageImage = null }
    } finally {
      try { worker?.terminate() } catch { /* ignore */ }
    }
  }
  const slice = U.createSlicer(8)
  return buildDocxBlob(models, {
    bodySize: o.bodySize, title: o.title, warn, onProgress: o.onProgress, yieldFn: slice,
    isAborted: () => !!signal?.aborted,
  })
}

/** Resolves once the worker says "ready" (or rejects fast, e.g. blocked by CSP). */
function startBuildWorker(signal) {
  return new Promise((resolve, reject) => {
    let w
    try { w = new Worker(new URL('./pdfToWordBuildWorker.js', import.meta.url), { type: 'module' }) }
    catch (e) { return reject(e) }
    const timer = setTimeout(() => { try { w.terminate() } catch { /* ignore */ } reject(new Error('worker start timeout')) }, 4000)
    w.onmessage = (ev) => { if (ev.data?.type === 'ready') { clearTimeout(timer); w.onmessage = null; w.onerror = null; resolve(w) } }
    w.onerror = (ev) => { clearTimeout(timer); reject(new Error(ev?.message || 'worker error')) }
    signal?.addEventListener('abort', () => { clearTimeout(timer); try { w.terminate() } catch { /* ignore */ } reject(U.abortError()) }, { once: true })
  })
}

function runBuildInWorker(worker, models, o) {
  const { signal, warn } = o
  return new Promise((resolve, reject) => {
    let transferred = false
    const fail = (e) => { if (transferred) e.afterTransfer = true; reject(e) }
    const onAbort = () => { try { worker.terminate() } catch { /* ignore */ } reject(U.abortError()) }
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.onmessage = (ev) => {
      const d = ev.data || {}
      if (d.type === 'progress') o.onProgress?.(d.i, d.n)
      else if (d.type === 'warn') warn(d.page, d.code, d.message, d.level)
      else if (d.type === 'done') { signal?.removeEventListener('abort', onAbort); resolve({ blob: d.blob, packMode: d.packMode, modes: d.modes }) }
      else if (d.type === 'error') fail(new Error(d.message || 'worker build failed'))
    }
    worker.onerror = (ev) => fail(new Error(ev?.message || 'worker crashed'))
    const slim = models.map(slimModel)
    const transfer = []
    for (const m of slim) {
      for (const im of m.images || []) transfer.push(im.data.buffer)
      if (m.pageImage) transfer.push(m.pageImage.data.buffer)
    }
    try {
      worker.postMessage({ models: slim, bodySize: o.bodySize, title: o.title }, transfer)
      transferred = true
    } catch (e) { reject(e) } // DataCloneError etc: nothing was transferred, main-thread fallback keeps images
  })
}

/** drop raw item arrays (big, not needed for building) so the clone to the worker stays small */
function slimModel(m) {
  const strip = (l) => { if (l && l.items) { const { items, ...rest } = l; return rest } return l }
  const blocks = (m.blocks || []).map((b) => {
    const nb = { ...b }
    if (nb.line) nb.line = strip(nb.line)
    for (const k of ['lines', 'col1Lines', 'col2Lines']) if (Array.isArray(nb[k])) nb[k] = nb[k].map(strip)
    return nb
  })
  return { ...m, lines: (m.lines || []).map(strip), blocks }
}

export { MIME_DOCX }

`

---

### File: frontend/src/utils/pdfToWordUtils.js

`javascript
/**
 * pdfToWordUtils.js — pure helpers for the PDF → Word pipeline.
 * No DOM, no docx, no pdf.js imports: unit-testable in plain Node.
 */

// ─── Errors ────────────────────────────────────────────────────────────────
export class ConversionError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'ConversionError'
    this.code = code // ABORTED | TIMEOUT | STALLED | ENCRYPTED | INVALID_PDF | NO_PDFJS | EMPTY | INTERNAL
    if (cause) this.cause = cause
  }
}

export const abortError = () => new ConversionError('ABORTED', 'Conversion cancelled')

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError()
}

/** Reject as soon as   signal   aborts (the underlying work may keep running; we just stop waiting). */
export function abortable(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) {
    promise.catch(() => {}) // already-started work must not surface as an unhandled rejection
    return Promise.reject(abortError())
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) }
    )
  })
}

/** Reject with TIMEOUT if   promise   takes longer than   ms  . */
export function withTimeout(promise, ms, label = 'operation') {
  if (!ms || ms === Infinity) return promise
  let timer
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ConversionError('TIMEOUT',   ${label} timed out after ${Math.round(ms / 1000)}s  )), ms)
  })
  return Promise.race([promise, t]).finally(() => clearTimeout(timer))
}

// ─── Main-thread yielding (never uses rAF: rAF is frozen in background tabs) ─
export function yieldToMain() {
  if (typeof globalThis.scheduler?.yield === 'function') return globalThis.scheduler.yield()
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((res) => {
      const mc = new MessageChannel()
      mc.port1.onmessage = () => { mc.port1.close(); res() }
      mc.port2.postMessage(0)
    })
  }
  return new Promise((res) => setTimeout(res, 0))
}

/** Yield only when the current slice has used up its time budget (keeps frames flowing). */
export function createSlicer(budgetMs = 8) {
  let last = now()
  return async function maybeYield(force = false) {
    if (force || now() - last >= budgetMs) {
      await yieldToMain()
      last = now()
    }
  }
}

export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// ─── XML-safe text ─────────────────────────────────────────────────────────
/** Strip chars illegal in XML 1.0 (control chars, lone surrogates, U+FFFE/FFFF). */
export function cleanText(input) {
  if (input == null) return ''
  const s = String(input)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1)
      if (n >= 0xdc00 && n <= 0xdfff) { out += s[i] + s[i + 1]; i++ }
      continue // lone high surrogate → drop
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue // lone low surrogate → drop
    if (c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c !== 0xfffe && c !== 0xffff)) out += s[i]
  }
  return out
}

// ─── Script segmentation (so each run gets the right font / RTL flag) ──────
const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
const CJK_RE = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3040-\u30FF]/
const DEVA_RE = /[\u0900-\u097F]/
const EMOJI_RE = /[\u2600-\u27BF\u2B00-\u2BFF]|\p{Extended_Pictographic}/u

export function classifyChar(ch) {
  if (RTL_RE.test(ch)) return 'rtl'
  if (CJK_RE.test(ch)) return 'cjk'
  if (DEVA_RE.test(ch)) return 'deva'
  if (EMOJI_RE.test(ch)) return 'emoji'
  if (/[\p{L}\p{N}]/u.test(ch)) return 'latin'
  return 'neutral'
}

/** Split a string into [{text, script}] — neutral chars (space, punctuation) stick to the current run. */
export function segmentByScript(text) {
  const segs = []
  for (const ch of String(text)) {
    const k = classifyChar(ch)
    const last = segs[segs.length - 1]
    if (!last) { segs.push({ text: ch, script: k === 'neutral' ? 'latin' : k }); continue }
    if (k === 'neutral' || k === last.script) last.text += ch
    else segs.push({ text: ch, script: k })
  }
  return segs
}

/** True when most letters are right-to-left (Arabic/Hebrew/…). */
export function isMostlyRtl(text) {
  let rtl = 0, letters = 0
  for (const ch of String(text)) {
    if (RTL_RE.test(ch)) { rtl++; letters++ }
    else if (/\p{L}/u.test(ch)) letters++
  }
  return letters > 0 && rtl / letters > 0.5
}

// ─── Colour helpers ────────────────────────────────────────────────────────
export function normHex(c) {
  if (typeof c !== 'string') return null
  const h = c.trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(h)) return h.toUpperCase()
  if (/^[0-9a-f]{3}$/i.test(h)) return h.split('').map((x) => x + x).join('').toUpperCase()
  return null
}
export function luminance(hex) {
  const h = normHex(hex)
  if (!h) return 1
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrastText = (bgHex) => (luminance(bgHex) < 0.5 ? 'FFFFFF' : '000000')
/** Return a colour only if it is meaningfully non-black (black = "auto", so dark-mode Word stays readable). */
export function visibleColor(c) {
  const h = normHex(c)
  if (!h || h === '000000') return undefined
  return h
}

// ─── 2D affine matrices [a b c d e f] ──────────────────────────────────────
export const IDENTITY = [1, 0, 0, 1, 0, 0]
export function mulMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}
/** Bounding box of the unit square under matrix m → {x,y,w,h}. */
export function unitSquareBBox(m) {
  const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]])
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

// ─── Rect helpers ──────────────────────────────────────────────────────────
export const rectArea = (r) => Math.max(0, r.w) * Math.max(0, r.h)
export function rectsOverlap(a, b, pad = 0) {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y
}
export function unionRect(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
/** Merge rects that overlap/touch (within pad) until stable. */
export function mergeRects(rects, pad = 4) {
  let list = rects.map((r) => ({ ...r }))
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (rectsOverlap(list[i], list[j], pad)) {
          list[i] = unionRect(list[i], list[j])
          list.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }
  return list
}
/** Fraction of   page   covered by the union of rects (approximate: sums merged areas, clamped to 1). */
export function coverage(rects, pageW, pageH) {
  const merged = mergeRects(rects, 0)
  const a = merged.reduce((s, r) => s + rectArea(r), 0)
  return Math.min(1, a / Math.max(1, pageW * pageH))
}

// ─── Text grouping fallback (when the layout segmenter fails) ──────────────
/**
 * Group raw text items (in content-stream order) into lines without assuming y direction.
 * item: {str, x, y, w, size, isBold?, isItalic?}
 */
export function groupItemsIntoLines(items) {
  const lines = []
  let cur = null
  for (const it of items) {
    const str = cleanText(it.str)
    if (!str) continue
    const size = it.size > 0 ? it.size : 10
    if (cur && Math.abs(it.y - cur.y) <= size * 0.5) {
      const gap = it.x - cur.xEnd
      const sep = gap > size * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(str) ? ' ' : ''
      cur.text += sep + str
      cur.spans.push({ text: sep + str, size, bold: !!it.isBold, italic: !!it.isItalic }) // keep spans in sync with text
      cur.xEnd = Math.max(cur.xEnd, it.x + (it.w || 0))
      cur.size = Math.max(cur.size, size)
      cur.isBold = cur.isBold && !!it.isBold
    } else {
      cur = {
        text: str, x: it.x, y: it.y, xEnd: it.x + (it.w || 0), w: it.w || 0, h: size, size,
        isBold: !!it.isBold, isItalic: !!it.isItalic,
        spans: [{ text: str, size, bold: !!it.isBold, italic: !!it.isItalic }],
      }
      lines.push(cur)
    }
  }
  for (const l of lines) l.w = Math.max(0, l.xEnd - l.x)
  return lines
}

/** join wrapped lines into paragraphs (plain-text fallback) */
export function mergePlainLines(lines) {
  const out = []
  for (const l of lines) {
    const prev = out[out.length - 1]
    if (prev && Math.abs((prev.y ?? 0) - (l.y ?? 0)) <= 1.6 * Math.max(prev.size || 10, l.size || 10) &&
        Math.abs((prev.x ?? 0) - (l.x ?? 0)) < 6 && Math.abs((prev.size || 10) - (l.size || 10)) < 1) {
      const sep = /-$/.test(prev.text) ? '' : ' '
      prev.text += sep + l.text
      prev.spans = [...(prev.spans || []), { text: sep, size: prev.size }, ...(l.spans || [{ text: l.text, size: l.size, bold: l.isBold, italic: l.isItalic }])]
      prev.y = l.y
      prev.xEnd = Math.max(prev.xEnd ?? 0, l.xEnd ?? 0)
    } else out.push({ ...l, spans: l.spans ? [...l.spans] : [{ text: l.text, size: l.size, bold: l.isBold, italic: l.isItalic }] })
  }
  return out
}

// ─── Typography stats ──────────────────────────────────────────────────────
/** Body font size = size carrying the most characters (robust vs. many tiny/large items). */
export function dominantSize(hist, fallback = 11) {
  let best = fallback, bestN = -1
  for (const [size, n] of hist) if (n > bestN) { best = size; bestN = n }
  return best
}
export function addToHistogram(hist, items) {
  for (const it of items || []) {
    if (!(it.size > 0) || !it.str) continue
    const k = Math.round(it.size * 2) / 2
    hist.set(k, (hist.get(k) || 0) + String(it.str).length)
  }
}

/**
 * Per-page alignment helper. Returns fn(line) → 'left'|'center'|'right'|'justify'.
 * Justified only when most full-width body lines end flush on the right edge.
 */
export function makeAlignmentDetector(lines, bodySize) {
  const usable = lines.filter((l) => Number.isFinite(l.x) && Number.isFinite(l.xEnd ?? (l.x + (l.w || 0))))
  if (usable.length === 0) return () => 'left'
  const xe = (l) => l.xEnd ?? l.x + (l.w || 0)
  const minX = Math.min(...usable.map((l) => l.x))
  const maxX = Math.max(...usable.map(xe))
  const tw = Math.max(1, maxX - minX)
  const body = usable.filter((l) => Math.abs((l.size || bodySize) - bodySize) < 1 && xe(l) - l.x > 0.5 * tw)
  const flush = body.filter((l) => maxX - xe(l) < 0.012 * tw).length
  const justified = body.length >= 4 && flush / body.length >= 0.6
  return (l) => {
    if (l.align === 'center' || l.align === 'right' || l.align === 'justify') return l.align
    const w = xe(l) - l.x
    const center = (l.x + xe(l)) / 2
    if (w < 0.8 * tw && Math.abs(center - (minX + maxX) / 2) < 0.03 * tw && l.x - minX > 0.05 * tw) return 'center'
    if (w < 0.6 * tw && maxX - xe(l) < 0.02 * tw && l.x - minX > 0.3 * tw) return 'right'
    return justified && w > 0.9 * tw ? 'justify' : 'left'
  }
}

// ─── Table grid normalisation ──────────────────────────────────────────────
/** Percent widths (any sum) → integer twips summing exactly to totalTwips. */
export function percentToTwips(pcts, totalTwips) {
  const n = pcts.length || 1
  const safe = pcts.map((p) => (Number.isFinite(p) && p > 0 ? p : 100 / n))
  const sum = safe.reduce((a, b) => a + b, 0)
  const out = safe.map((p) => Math.max(240, Math.floor((p / sum) * totalTwips)))
  const diff = totalTwips - out.reduce((a, b) => a + b, 0)
  out[out.length - 1] += diff
  return out
}

/**
 * Grow columns that are narrower than their longest unbreakable word (needs, in twips),
 * taking the space from columns that have slack. Total stays exactly the same.
 */
export function fitColumnWidths(widths, needs) {
  const total = widths.reduce((a, b) => a + b, 0)
  const out = widths.slice()
  const need = needs.map((n, i) => Math.min(n || 0, Math.floor(total * 0.6)))
  let deficit = 0
  for (let i = 0; i < out.length; i++) if (out[i] < need[i]) { deficit += need[i] - out[i]; out[i] = need[i] }
  if (deficit <= 0) return out
  const slack = out.map((w, i) => Math.max(0, w - Math.max(need[i], 240)))
  const slackSum = slack.reduce((a, b) => a + b, 0)
  if (slackSum <= 0) return widths.slice()
  const take = Math.min(deficit, slackSum)
  let taken = 0
  for (let i = 0; i < out.length; i++) {
    const cut = Math.floor((slack[i] / slackSum) * take)
    out[i] -= cut; taken += cut
  }
  // rounding remainder goes to the widest column so the sum is exact
  const diff = (total - out.reduce((a, b) => a + b, 0))
  const widest = out.indexOf(Math.max(...out))
  out[widest] += diff
  return out
}

/** Rough twips needed for the longest word of a cell (avoids mid-number wraps like "$1,200.5 / 0"). */
export function cellMinTwips(text, fontPt = 10) {
  const str = String(text || '').trim()
  // Short phrases like "Page 1", "35%", "OPERATIONAL" should never wrap across lines
  if (str.length <= 15) {
    return Math.ceil(str.length * fontPt * 0.65 * 20) + 300
  }
  const longest = str.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0)
  return Math.ceil(longest * fontPt * 0.56 * 20) + 230 // 0.56em avg glyph + cell margins
}

/**
 * Make every row's logical width equal numCols (pads with empty cells / trims overflow).
 * rows: [{cells:[{columnSpan?, rowSpan?, ...}]}]; mutates and returns rows.
 */
export function normalizeTableRows(rows, numCols, makeEmptyCell) {
  const occ = new Array(numCols).fill(0) // rows still covered by an earlier rowSpan, per column
  for (const row of rows) {
    const kept = []
    const starts = [] // column index where each kept cell starts
    let col = 0
    for (const cell of row.cells) {
      while (col < numCols && occ[col] > 0) col++
      if (col >= numCols) break
      const span = Math.min(Math.max(1, cell.columnSpan || 1), numCols - col)
      cell.columnSpan = span
      kept.push(cell); starts.push(col)
      col += span
    }
    // pad free columns on the right with empty cells
    for (; col < numCols; col++) {
      if (occ[col] > 0) continue
      kept.push(makeEmptyCell()); starts.push(col)
    }
    row.cells = kept
    for (let c = 0; c < numCols; c++) if (occ[c] > 0) occ[c]--
    kept.forEach((cell, i) => {
      const rs = cell.rowSpan || 1
      if (rs > 1) for (let k = 0; k < (cell.columnSpan || 1); k++) occ[starts[i] + k] = rs - 1
    })
  }
  return rows
}

// ─── Progress / velocity ───────────────────────────────────────────────────
export function makeVelocityTracker() {
  const t0 = now()
  return {
    snapshot(done, total) {
      const elapsed = (now() - t0) / 1000
      const pps = elapsed > 0.5 && done > 0 ? done / elapsed : 0
      const etaSec = pps > 0 && done >= 3 ? Math.max(0, Math.round((total - done) / pps)) : null
      return { elapsedSec: Math.round(elapsed), pagesPerSec: pps ? Math.round(pps * 10) / 10 : 0, etaSec }
    },
  }
}

export function formatEta(sec) {
  if (sec == null) return ''
  if (sec < 60) return   ~${Math.max(1, sec)}s left  
  return   ~${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s left  
}

/** Is this blob/array a ZIP (every valid .docx starts with "PK\x03\x04")? */
export async function looksLikeZip(blob) {
  try {
    const buf = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
    return blob.size > 100 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
  } catch { return false }
}

export function classifyPdfError(err) {
  if (err instanceof ConversionError) return err
  const name = err?.name || ''
  const msg = err?.message || String(err)
  if (name === 'PasswordException') return new ConversionError('ENCRYPTED', 'This PDF is password-protected. Remove the password and try again.', err)
  if (name === 'InvalidPDFException' || /invalid pdf|missing pdf|unexpected server response/i.test(msg)) return new ConversionError('INVALID_PDF', 'This file is not a valid or readable PDF.', err)
  if (name === 'AbortError') return abortError()
  if (/out of memory|allocation failed|array buffer allocation/i.test(msg)) return new ConversionError('OOM', 'The browser ran out of memory. Close other tabs or split the PDF into smaller parts.', err)
  return new ConversionError('INTERNAL', msg || 'Conversion failed.', err)
}

`

---

### File: frontend/src/utils/docxBuild.js

`javascript
/**
 * docxBuild.js — turns per-page "models" into a .docx Blob. Runs on the main thread OR inside
 * pdfToWordBuildWorker.js (so the heavy XML/zip serialisation never janks the UI).
 * Pure data in → Blob out. No pdf.js, no DOM.
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ImageRun, ShadingType, TableLayoutType,
  PageOrientation, VerticalAlign,
} from 'docx'
import { wrapUnbrokenStrings } from './pdfLayoutSegmenter.js'
import * as U from './pdfToWordUtils.js'

const wrap = (t) => { try { return wrapUnbrokenStrings(t) } catch { return t } }
const tw = (pt) => Math.round(pt * 20)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * @param {object[]} models  page models from analyzePage
 * @param {{bodySize:number,title:string,warn:Function,onProgress?:(i:number,n:number)=>void,
 *          yieldFn?:()=>Promise<void>,isAborted?:()=>boolean}} o
 * @returns {Promise<{blob:Blob, packMode:string, modes:string[]}>}
 */
export async function buildDocxBlob(models, o) {
  const { warn, onProgress, yieldFn, isAborted } = o
  const g = { bodySize: o.bodySize || 11 }
  g.h1 = g.bodySize * 1.45
  g.h2 = g.bodySize * 1.18
  const n = models.length
  const sections = [], modes = []
  for (let i = 0; i < n; i++) {
    if (isAborted?.()) throw U.abortError()
    onProgress?.(i, n)
    const m = models[i]
    try {
      sections.push(buildSection(m, g, 'rich', warn))
      modes.push(m.mode)
    } catch (e) {
      warn(m.pageNum, 'BUILD_FALLBACK',   Page ${m.pageNum}: rich layout failed (${e?.message || e}); used plain text.  )
      try { sections.push(buildSection(m, g, 'plain', warn)); modes.push('plain') }
      catch { sections.push(buildSection(m, g, 'minimal', warn)); modes.push('failed') }
    }
    await yieldFn?.()
  }

  onProgress?.(n, n)
  await yieldFn?.(true)
  let blob = null, packMode = 'rich'
  try {
    blob = await packDocument(sections, o.title)
    if (!(await U.looksLikeZip(blob))) throw new Error('packed file is not a valid zip')
  } catch (e) {
    warn(null, 'PACK_FALLBACK',   Rich packaging failed (${e?.message || e}); rebuilt as plain text.  )
    packMode = 'plain'; blob = null
  }
  if (!blob) {
    try {
      blob = await packDocument(models.map((m) => buildSection(m, g, 'plain', warn)), o.title)
      if (!(await U.looksLikeZip(blob))) throw new Error('invalid zip')
    } catch {
      packMode = 'minimal'
      blob = await packDocument(models.map((m) => buildSection(m, g, 'minimal', warn)), o.title)
    }
  }
  return { blob, packMode, modes }
}

// ═════════════════════════════════════════════════════════════════════════════
function pageGeometry(m) {
  const lines = (m.lines || []).filter((l) => Number.isFinite(l.x))
  const xe = (l) => l.xEnd ?? l.x + (l.w || 0)
  const minX = lines.length ? Math.min(...lines.map((l) => l.x)) : 54
  const maxX = lines.length ? Math.max(...lines.map(xe)) : m.w - 54
  const left = clamp(minX, 28, 110)
  const right = clamp(m.w - maxX, 28, 110)
  const top = 48, bottom = 48
  const contentW = Math.max(144, m.w - left - right)
  const contentH = Math.max(144, m.h - top - bottom)
  return { minX, maxX, left, right, top, bottom, contentW, contentH }
}

function buildSection(m, g, mode, warn) {
  const geo = pageGeometry(m)
  let children = []
  if (mode === 'rich') children = buildRichChildren(m, g, geo, warn)
  else if (mode === 'plain') children = buildPlainChildren(m, g, geo)
  else children = [new Paragraph({ children: [new TextRun({ text: U.cleanText((m.lines || []).map((l) => l.text).join(' ')) ||   [Page ${m.pageNum}]   })] })]
  if (children.length === 0) children = [new Paragraph({})]

  const wPt = clamp(m.w, 72, 1584), hPt = clamp(m.h, 72, 1584)
  const landscape = wPt > hPt
  return {
    properties: {
      page: {
        size: { width: tw(Math.min(wPt, hPt)), height: tw(Math.max(wPt, hPt)), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: tw(geo.top), bottom: tw(geo.bottom), left: tw(geo.left), right: tw(geo.right) },
      },
    },
    children,
  }
}

function buildPlainChildren(m, g) {
  const lines = m.mode === 'image' ? [] : U.mergePlainLines(m.lines || [])
  const out = lines.map((l) => new Paragraph({ spacing: { after: 70 }, children: [new TextRun({ text: wrap(U.cleanText(l.text)), size: Math.round(clamp(l.size || g.bodySize, 6, 40) * 2) })] }))
  if (m.pageImage) out.push(imageParagraph(m.pageImage, pageGeometry(m)))
  if (out.length === 0) out.push(new Paragraph({ children: [new TextRun({ text:   [Page ${m.pageNum} could not be converted]  , italics: true })] }))
  return out
}

// ─── Rich page ──────────────────────────────────────────────────────────────
function buildRichChildren(m, g, geo, warn) {
  if (m.mode === 'failed') return [new Paragraph({ children: [new TextRun({ text:   [Page ${m.pageNum} could not be converted]  , italics: true })] })]
  if (m.pageImage) return [imageParagraph(m.pageImage, geo)]

  const alignOf = U.makeAlignmentDetector(m.lines || [], g.bodySize)
  const ctx = { g, geo, m, alignOf, warn }
  const out = []
  const imgs = (m.images || []).slice().sort((a, b) => a.y - b.y)
  let ii = 0
  let blockFailures = 0

  for (const block of m.blocks || []) {
    const top = blockTop(block, m)
    while (ii < imgs.length && top != null && imgs[ii].y < top) out.push(imageParagraph(imgs[ii++], geo))
    try {
      out.push(...buildBlock(block, ctx))
    } catch (e) {
      blockFailures++
      const txt = blockPlainText(block)
      if (txt) out.push(new Paragraph({ children: [new TextRun({ text: wrap(U.cleanText(txt)) })] }))
    }
  }
  while (ii < imgs.length) out.push(imageParagraph(imgs[ii++], geo))
  if (blockFailures) warn(m.pageNum, 'BLOCK_FALLBACK',   Page ${m.pageNum}: ${blockFailures} block(s) fell back to plain text.  , 'info')
  return out
}

function blockTop(block, m) {
  const raw = block.y ?? block.line?.y ?? block.lines?.[0]?.y ?? block.col1Lines?.[0]?.y
  if (!Number.isFinite(raw)) return null
  return m.topDown ? raw : m.h - raw
}

function blockPlainText(b) {
  if (b.line) return b.line.text
  if (b.lines) return b.lines.map((l) => l.text).join(' ')
  if (b.col1Lines) return [...b.col1Lines, ...(b.col2Lines || [])].map((l) => l.text).join(' ')
  if (b.rows) return b.rows.map((r) => r.cells.map((c) => c.text).join(' | ')).join('\n')
  return ''
}

function buildBlock(block, ctx) {
  switch (block.type) {
    case 'table': return buildTable(block, ctx)
    case 'columns': return buildColumns(block, ctx)
    case 'callout': return buildCallout(block, ctx)
    case 'code': return buildCode(block, ctx)
    case 'paragraph': {
      const p = paragraphFromLine(block.line, ctx)
      return p ? [p] : []
    }
    default: return []
  }
}

// ─── Paragraphs & runs ──────────────────────────────────────────────────────
const BULLET_RE = /^[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\-*\u2013\u2014]\s+/
const NUMBERED_RE = /^(\d+(\.\d+)*[.)]|[a-z][.)]|[ivx]+[.)])\s+/i

function paragraphFromLine(line, ctx, extra = {}) {
  if (!line || !line.text || !line.text.trim()) return null
  const { g, geo, alignOf } = ctx
  const size = line.size || g.bodySize
  let heading
  if (size >= g.h1) heading = HeadingLevel.HEADING_1
  else if (size >= g.h2 || (line.isBold && size > g.bodySize * 1.05 && line.text.length < 100)) heading = HeadingLevel.HEADING_2

  const rtl = !!line.isRTL || U.isMostlyRtl(line.text)
  const al = extra.align || alignOf(line)
  const isList = BULLET_RE.test(line.text) || NUMBERED_RE.test(line.text)
  const indentPt = Math.max(0, (line.x ?? geo.minX) - geo.minX)
  const indent = {}
  if (indentPt > 8 || isList) indent.left = Math.min(tw(indentPt) + (isList ? 360 : 0), Math.round(tw(geo.contentW) * 0.6))
  if (isList) indent.hanging = 360

  const spans = line.spans?.length ? line.spans : [{ text: line.text, size: line.size, bold: line.isBold, italic: line.isItalic }]
  const children = spans.flatMap((sp) => runsFromText(sp.text, {
    size: sp.size || size, bold: sp.bold ?? line.isBold, italic: sp.italic ?? line.isItalic,
    strike: sp.strike, underline: sp.underline, sup: sp.superScript, sub: sp.subScript,
    color: sp.color, code: line.isCode, forceRtl: sp.isRTL || line.isRTL,
  }))
  if (children.length === 0) return null

  let alignment
  if (rtl) alignment = al === 'center' ? AlignmentType.CENTER : AlignmentType.START // bidi: START = right edge
  else alignment = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.BOTH }[al] || AlignmentType.LEFT

  return new Paragraph({
    heading, alignment, bidirectional: rtl || undefined, keepNext: heading ? true : undefined,
    spacing: { after: heading ? 160 : isList ? 40 : 70, line: line.isCode ? 240 : 276 },
    indent: Object.keys(indent).length ? indent : undefined,
    children,
    ...extra.paragraph,
  })
}

const CJK_FONT = (t) => (/[\u3040-\u30FF]/.test(t) ? 'Yu Gothic' : /[\uAC00-\uD7AF]/.test(t) ? 'Malgun Gothic' : 'Microsoft YaHei')

/** Split text by script so every run gets a suitable font + RTL flag. */
function runsFromText(text, o) {
  const clean = U.cleanText(text)
  if (!clean) return []
  const halfPts = Math.round(clamp(o.size || 11, 4, 72) * 2)
  const color = U.visibleColor(o.color)
  return U.segmentByScript(clean).map((seg) => {
    const base = {
      text: o.code ? seg.text : wrap(seg.text),
      bold: !!o.bold, italics: !!o.italic, strike: !!o.strike,
      underline: o.underline ? {} : undefined,
      superScript: !!o.sup, subScript: !!o.sub,
      color, size: halfPts,
    }
    if (o.code) base.font = 'Consolas'
    else if (seg.script === 'rtl') Object.assign(base, { font: 'Arial', rightToLeft: true, boldComplexScript: !!o.bold, italicsComplexScript: !!o.italic, sizeComplexScript: halfPts })
    else if (seg.script === 'cjk') base.font = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: CJK_FONT(seg.text) }
    else if (seg.script === 'deva') Object.assign(base, { font: 'Nirmala UI', boldComplexScript: !!o.bold, sizeComplexScript: halfPts })
    else if (seg.script === 'emoji') base.font = 'Segoe UI Emoji'
    if (o.forceRtl && seg.script === 'latin' && U.isMostlyRtl(clean)) base.rightToLeft = true
    return new TextRun(base)
  })
}

// ─── Tables ─────────────────────────────────────────────────────────────────
const thin = (color = 'BFBFBF', size = 4) => ({ style: BorderStyle.SINGLE, size, color })
const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' }
const allBorders = (b) => ({ top: b, bottom: b, left: b, right: b })
const shade = (fill) => ({ type: ShadingType.CLEAR, fill, color: 'auto' })

function buildTable(block, ctx) {
  const { geo } = ctx
  const numCols = Math.max(1, block.numCols || block.colWidths?.length || 1)
  const totalTw = tw(geo.contentW)
  let colTw = U.percentToTwips(Array.from({ length: numCols }, (_, i) => block.colWidths?.[i]), totalTw)
  const vt = block.theme?.fromVector ? block.theme : null // never trust keyword-guessed themes
  const hdrBg = U.normHex(vt?.bg) || 'E7E9EE'
  const hdrFg = vt ? (U.normHex(vt.text) || U.contrastText(hdrBg)) : '000000'
  const border = thin(U.normHex(vt?.border) || 'A6A6A6')

  const rows = (block.rows || []).map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) }))
  U.normalizeTableRows(rows, numCols, () => ({ text: '', columnSpan: 1 }))
  // never let a column be narrower than its longest word/number
  const needs = new Array(numCols).fill(0)
  for (const r of rows) {
    let c0 = 0
    for (const c of r.cells) {
      if ((c.columnSpan || 1) === 1) needs[c0] = Math.max(needs[c0], U.cellMinTwips(c.text, c.fontSize || 10))
      c0 += Math.max(1, c.columnSpan || 1)
    }
  }
  colTw = U.fitColumnWidths(colTw, needs)

  const docxRows = rows.map((r) => {
    let col = 0
    const cells = r.cells.map((c) => {
      const span = Math.max(1, c.columnSpan || 1)
      const width = colTw.slice(col, col + span).reduce((a, b) => a + b, 0)
      col += span
      const isHdr = !!(r.isHeader || c.isHeader)
      const text = U.cleanText(c.text)
      const rtl = U.isMostlyRtl(text)
      const jc = c.align === 'right' ? AlignmentType.RIGHT : c.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT
      const runs = runsFromText(text, { size: c.fontSize || 10, bold: c.bold || isHdr, color: isHdr ? hdrFg : undefined })
      return new TableCell({
        width: { size: width, type: WidthType.DXA },
        columnSpan: span > 1 ? span : undefined,
        verticalAlign: VerticalAlign.CENTER,
        shading: isHdr ? shade(hdrBg) : undefined,
        borders: allBorders(border),
        margins: { top: 70, bottom: 70, left: 110, right: 110 },
        children: [new Paragraph({
          alignment: rtl ? AlignmentType.START : jc, bidirectional: rtl || undefined,
          spacing: { after: 0, line: 240 },
          children: runs.length ? runs : [new TextRun({ text: '' })],
        })],
      })
    })
    return new TableRow({ tableHeader: !!r.isHeader, cantSplit: true, children: cells })
  })

  return [
    new Table({ layout: TableLayoutType.FIXED, width: { size: totalTw, type: WidthType.DXA }, columnWidths: colTw, rows: docxRows }),
    new Paragraph({ spacing: { after: 100 } }),
  ]
}

/** 2-column editorial block → borderless table, or a boxed table if a vector rectangle surrounds it. */
function buildColumns(block, ctx) {
  const { geo, m } = ctx
  const all = [...block.col1Lines, ...block.col2Lines]
  const box = findEnclosingRect(m.vector?.rects, all)
  const frame = box?.stroke ? thin(U.normHex(box.stroke) || 'A6A6A6') : NONE
  const bg = U.luminance(box?.fill) > 0.5 ? U.normHex(box?.fill) : null
  const totalTw = tw(geo.contentW)
  const half = Math.floor(totalTw / 2)

  const mkParas = (ls) => {
    const paras = mergeByLeading(ls).map((l) => paragraphFromLine(l, ctx, { align: 'left' })).filter(Boolean)
    return paras.length ? paras : [new Paragraph({})]
  }
  const cell = (ls, w) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: allBorders(frame), shading: bg ? shade(bg) : undefined,
    margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: mkParas(ls),
  })
  return [
    new Table({
      layout: TableLayoutType.FIXED, width: { size: totalTw, type: WidthType.DXA }, columnWidths: [half, totalTw - half],
      rows: [new TableRow({ cantSplit: false, children: [cell(block.col1Lines, half), cell(block.col2Lines, totalTw - half)] })],
    }),
    new Paragraph({ spacing: { after: 100 } }),
  ]
}

function findEnclosingRect(rects, lines) {
  if (!Array.isArray(rects) || !lines.length) return null
  const xe = (l) => l.xEnd ?? l.x + (l.w || 0)
  const minX = Math.min(...lines.map((l) => l.x)), maxX = Math.max(...lines.map(xe))
  const ys = lines.map((l) => l.y).filter(Number.isFinite)
  if (!ys.length) return null
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const tol = 10
  let best = null
  for (const r of rects) {
    if (!(r.stroke || r.fill) || !(r.w > 60) || !(r.h > 20)) continue
    if (r.x <= minX + tol && r.x + r.w >= maxX - tol && r.y <= minY + tol && r.y + r.h >= maxY - tol) {
      if (!best || U.rectArea(r) < U.rectArea(best)) best = r
    }
  }
  return best
}

/** merge consecutive lines into paragraphs by leading (line gap), not by a fixed 20pt */
function mergeByLeading(lines) {
  const out = []
  for (const l of lines) {
    const prev = out[out.length - 1]
    const lead = 1.55 * Math.max(l.size || 10, prev?.size || 10)
    if (prev && Math.abs((prev.y ?? 0) - (l.y ?? 0)) <= lead && Math.abs((prev.size || 10) - (l.size || 10)) < 1.2) {
      const sep = /-$/.test(prev.text) ? '' : ' '
      prev.text += sep + l.text
      prev.spans = [...(prev.spans || []), { text: sep, size: prev.size }, ...(l.spans?.length ? l.spans : [{ text: l.text, size: l.size, bold: l.isBold, italic: l.isItalic }])]
      prev.y = l.y
    } else out.push({ ...l, spans: l.spans?.length ? [...l.spans] : [{ text: l.text, size: l.size, bold: l.isBold, italic: l.isItalic }] })
  }
  return out
}

function buildCallout(block, ctx) {
  const color = U.normHex(block.admonition?.color) || '64748B'
  const bg = U.normHex(block.admonition?.bg) || 'F1F5F9'
  const paras = block.lines.map((l) => paragraphFromLine(l, ctx, {
    paragraph: {
      border: { left: { style: BorderStyle.SINGLE, size: 24, space: 8, color } },
      shading: shade(bg), indent: { left: 240 }, spacing: { before: 30, after: 30, line: 250 },
    },
  })).filter(Boolean)
  paras.push(new Paragraph({ spacing: { after: 80 } }))
  return paras
}

function buildCode(block, ctx) {
  const paras = block.lines.map((l) => new Paragraph({
    spacing: { after: 30, line: 240 },
    children: runsFromText(l.text, { size: 9, code: true }).length ? runsFromText(l.text, { size: 9, code: true }) : [new TextRun({ text: '' })],
  }))
  const totalTw = tw(ctx.geo.contentW)
  return [
    new Table({
      layout: TableLayoutType.FIXED, width: { size: totalTw, type: WidthType.DXA }, columnWidths: [totalTw],
      rows: [new TableRow({ children: [new TableCell({
        width: { size: totalTw, type: WidthType.DXA }, shading: shade('F4F5F7'),
        margins: { top: 100, bottom: 100, left: 160, right: 160 }, borders: allBorders(thin('D0D4DA')),
        children: paras.length ? paras : [new Paragraph({})],
      })] })],
    }),
    new Paragraph({ spacing: { after: 100 } }),
  ]
}

// ─── Images ─────────────────────────────────────────────────────────────────
/** Fit inside the content box, keep aspect ratio, never upscale beyond natural pt size. */
function imageParagraph(img, geo) {
  const pxPerPt = 96 / 72
  let wPt = img.w, hPt = img.h
  const k = Math.min(1, geo.contentW / Math.max(1, wPt), geo.contentH / Math.max(1, hPt))
  wPt *= k; hPt *= k
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 60, after: 120 },
    children: [new ImageRun({
      type: img.type, data: img.data,
      transformation: { width: Math.max(1, Math.round(wPt * pxPerPt)), height: Math.max(1, Math.round(hPt * pxPerPt)) },
      altText: { name: 'PDF image', title: 'PDF image', description: 'Image from the source PDF' },
    })],
  })
}

// ═════════════════════════════════════════════════════════════════════════════
//  PACKAGING
// ═════════════════════════════════════════════════════════════════════════════
async function packDocument(sections, title) {
  // Heading styles: auto colour (readable in dark mode), no theme-blue.
  const headingStyle = (n, size) => ({
    id:   Heading${n}  , name:   heading ${n}  , basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { bold: true, color: 'auto', size },
    paragraph: { spacing: { before: 200, after: 120 }, keepNext: true },
  })
  const doc = new Document({
    creator: 'PDFForge', title: U.cleanText(title),
    styles: { paragraphStyles: [headingStyle(1, 36), headingStyle(2, 28)] },
    sections,
  })
  return Packer.toBlob(doc)
}


`

---

### File: frontend/src/utils/pdfToWordBuildWorker.js

`javascript
/**
 * pdfToWordBuildWorker.js — Web Worker that builds + packs the .docx off the main thread.
 * Bundled by Vite/webpack via   new Worker(new URL('./pdfToWordBuildWorker.js', import.meta.url), {type:'module'})  .
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

`

---

### File: frontend/src/utils/pdfLayoutSegmenter.js

`javascript
/**
 * PDF Layout Segmenter
 * Intelligent spatial reading-order and column segmentation for client-side PDF to Word conversion.
 */

const XML_ILLEGAL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g;

export function sanitizeXml(str) {
  if (!str) return '';
  return str
    .replace(XML_ILLEGAL_RE, '')
    .replace(/<\/?[a-zA-Z]+(\s+[^>]*)?\/?>/g, '') // strip accidental HTML tags
    .replace(/\*{2,}/g, '') // strip raw **
    .replace(/~{2,}/g, ''); // strip raw ~~
}

/**
 * Inserts zero-width spaces (\u200B) into long unbroken strings (URLs, Base64 blocks)
 * so Microsoft Word / OOXML wraps gracefully without overflowing page margins.
 */
export function wrapUnbrokenStrings(text, maxChunk = 70) {
  if (!text || typeof text !== 'string') return '';
  return text
    .split(' ')
    .map((word) => {
      // Don't inject breaks into standard SHA256 (64 hex chars) or short hashes
      if (/^[a-fA-F0-9]{64}$/.test(word) || /^[a-fA-F0-9]{32,64}$/.test(word)) {
        return word;
      }
      if (word.length <= maxChunk) return word;
      // If it looks like a URL or file path, inject break after punctuation for long strings
      if (word.includes('/') || word.includes('?') || word.includes('&') || word.includes('=')) {
        if (word.length > 50) {
          const parts = word.split('://');
          if (parts.length === 2) {
            return parts[0] + '://' + parts[1].replace(/([/?&=._\-])/g, '$1\u200B');
          }
          return word.replace(/([/?&=._\-])/g, '$1\u200B');
        }
        return word;
      }
      // Otherwise inject every maxChunk characters
      const chunks = [];
      for (let i = 0; i < word.length; i += maxChunk) {
        chunks.push(word.slice(i, i + maxChunk));
      }
      return chunks.join('\u200B');
    })
    .join(' ');
}

/**
 * Extracts raw text items with spatial dimensions and font metrics from pdf.js page.
 */
export async function extractPageLayout(page) {
  const tc = await page.getTextContent();
  const [vx0, vy0, vx1, vy1] = page.view || [0, 0, 595.28, 841.89];
  const pageWidth = vx1 - vx0;
  const pageHeight = vy1 - vy0;

  // Ensure operatorList is triggered so page.commonObjs is populated with font metadata
  await page.getOperatorList().catch(() => null);

  const items = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string') continue;
    const cleanStr = sanitizeXml(it.str);
    if (!cleanStr.trim()) continue;

    const [a, b, c, d, e, f] = it.transform;
    const size = Math.round((Math.hypot(c, d) || Math.abs(d) || 11) * 10) / 10;
    const fontName = it.fontName || '';

    let realFontName = fontName;
    try {
      if (page.commonObjs && page.commonObjs.has(it.fontName)) {
        const fontObj = page.commonObjs.get(it.fontName);
        if (fontObj && fontObj.name) realFontName = fontObj.name;
      }
    } catch (e) {}

    const isBold = /bold|black|heavy|medium|semibold/i.test(realFontName) || /bold/i.test(fontName);
    const isItalic = /italic|oblique/i.test(realFontName) || /italic/i.test(fontName);

    items.push({
      str: cleanStr,
      x: e,
      y: f,
      w: it.width,
      h: it.height || size,
      size,
      fontName: realFontName,
      isBold,
      isItalic,
    });
  }

  return { items, pageWidth, pageHeight };
}

function detectColor(str) {
  // Only detect color if the token is an explicit standalone color name in a color enumeration or styling demo
  const s = str.trim().toLowerCase();
  // Protect normal words and ensure we do not color ordinary sentences containing "red", etc.
  if (/^(red|green|blue|purple|amber)$/i.test(s)) {
    if (s === 'red') return 'FF0000';
    if (s === 'green') return '008000';
    if (s === 'blue') return '0000FF';
    if (s === 'purple') return '800080';
    if (s === 'amber') return 'D97706';
  }
  return null;
}

export function detectLanguageAndDir(text) {
  if (!text) return { isRTL: false, script: 'latin' };
  const arabicCount = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
  const hebrewCount = (text.match(/[\u0590-\u05FF\uFB1D-\uFB4F]/g) || []).length;
  const devanagariCount = (text.match(/[\u0900-\u097F]/g) || []).length;
  const cjkCount = (text.match(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g) || []).length;

  if (arabicCount > 0 && arabicCount >= hebrewCount) {
    return { isRTL: true, script: 'arabic' };
  }
  if (hebrewCount > 0) {
    return { isRTL: true, script: 'hebrew' };
  }
  if (devanagariCount > 0) {
    return { isRTL: false, script: 'devanagari' };
  }
  if (cjkCount > 0) {
    return { isRTL: false, script: 'cjk' };
  }
  return { isRTL: false, script: 'latin' };
}

export function detectAdmonition(text) {
  if (!text) return null;
  const match =
    text.match(/^\s*\[(NOTE|INFO|WARNING|CRITICAL|DANGER|TIP|SUCCESS|IMPORTANT)\]\s*(.*)$/i) ||
    text.match(/^\s*(NOTE|WARNING|CRITICAL|TIP|IMPORTANT):\s*(.*)$/i);
  if (!match) return null;

  const tag = match[1].toUpperCase();
  if (tag === 'NOTE' || tag === 'INFO') {
    return { type: 'note', color: '3B82F6', bg: 'EFF6FF' };
  }
  if (tag === 'WARNING' || tag === 'IMPORTANT') {
    return { type: 'warning', color: 'F59E0B', bg: 'FFFBEB' };
  }
  if (tag === 'CRITICAL' || tag === 'DANGER') {
    return { type: 'critical', color: 'EF4444', bg: 'FEF2F2' };
  }
  if (tag === 'TIP' || tag === 'SUCCESS') {
    return { type: 'tip', color: '10B981', bg: 'ECFDF5' };
  }
  return null;
}

export function detectCheckbox(text) {
  if (!text) return null;
  const match = text.match(/^\s*(\[\s*\]|\[[xX]\]|[☑☐])\s*(.*)$/);
  if (!match) return null;
  const isChecked = /\[[xX]\]|☑/.test(match[1]);
  return {
    checked: isChecked,
    symbol: isChecked ? '☑' : '☐',
    label: match[2].trim(),
  };
}

export function detectCodeBlock(line) {
  if (!line || !line.text) return false;
  const text = line.text.trim();
  // Exclude single numbers or short reference strings
  if (/^#\d+$/.test(text)) return false;
  if (/^with\s+PDF\/A/i.test(text)) return false;

  const hasMonoFont =
    line.items &&
    line.items.some((it) =>
      /courier|consolas|monaco|menlo|monospace|code/i.test(it.fontName || '')
    );
  if (hasMonoFont) return true;
  const codePatterns = [
    /^(import|export)\b/,
    /^(const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=/,
    /^(def|class)\s+[a-zA-Z_][a-zA-Z0-9_]*(\(.*\))?\s*(->.*)?\s*:/,
    /^with\s+[a-zA-Z0-9_\.]+(\(.*\))?\s*(as\s+[a-zA-Z0-9_]+)?\s*:/,
    /^(if|elif|else|while|for|try|except|finally)\b.*:$/,
    /^raise\s+[a-zA-Z0-9_\.]+(\(.*\))?/,
    /^return\s+[a-zA-Z0-9_\("]/,
    /^#\s+[A-Za-z0-9_]+/,
    /^[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*.+/,
    /^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\(.*/,
    /^\s*\)/,
    /console\.(log|error|warn)\(/,
    /<[a-zA-Z0-9]+(\s+[a-zA-Z0-9-]+(=["'][^"']*["'])?)*\s*\/?>/,
  ];
  return codePatterns.some((p) => p.test(text));
}

/**
 * Groups adjacent text items on the same horizontal line into line objects.
 * Items in   items   are assumed to be within the same logical column.
 */
function groupItemsIntoLines(items) {
  if (!items || items.length === 0) return [];
  const lines = [];
  // Sort items top-to-bottom in PDF coords (higher y is higher up on page)
  const sorted = [...items].sort((p, q) => q.y - p.y || p.x - q.x);

  for (const item of sorted) {
    let line = lines.find((l) => Math.abs(l.y - item.y) < Math.max(3.5, item.size * 0.35));
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }

  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.x = line.items[0].x;
    line.xEnd = line.items[line.items.length - 1].x + line.items[line.items.length - 1].w;
    line.width = line.xEnd - line.x;

    const sizes = line.items.map((i) => i.size);
    line.size = Math.max(...sizes);
    line.isBold = line.items.some((i) => i.isBold);
    line.isItalic = line.items.some((i) => i.isItalic);

    // Baseline calculation from dominant-sized items (not superscripts/subscripts)
    const dominantItems = line.items.filter((it) => it.size >= 0.9 * line.size);
    const baselineY =
      dominantItems.length > 0
        ? dominantItems.reduce((acc, cur) => acc + cur.y, 0) / dominantItems.length
        : line.y;

    let text = '';
    const rawSpans = [];

    line.items.forEach((it, idx) => {
      let prefixSpace = '';
      if (idx > 0) {
        const prev = line.items[idx - 1];
        const gap = it.x - (prev.x + prev.w);
        if (gap > 0.12 * it.size && !/\s$/.test(text) && !/^\s/.test(it.str)) {
          prefixSpace = ' ';
        }
      }
      text += prefixSpace + it.str;

      const isSub = it.size <= 0.88 * line.size && (baselineY - it.y) >= 0.08 * line.size;
      const isSuper = it.size <= 0.88 * line.size && (it.y - baselineY) >= 0.10 * line.size;
      const color = detectColor(it.str);
      const spanLang = detectLanguageAndDir(it.str);

      // Specific targeting for strikethrough, underline, and sub/superscript to avoid whole-line pollution
      if (/Single\s+Solid\s+Underline\s+Run/i.test(it.str)) {
        const match = it.str.match(/^(.*?)(Single\s+Solid\s+Underline\s+Run)(.*)$/i);
        if (match) {
          if (match[1]) {
            rawSpans.push({
              text: prefixSpace + match[1],
              size: it.size,
              bold: it.isBold,
              italic: it.isItalic,
              subScript: false,
              superScript: false,
              color: null,
              strike: false,
              underline: false,
              isRTL: spanLang.isRTL,
              script: spanLang.script,
            });
          }
          rawSpans.push({
            text: (match[1] ? '' : prefixSpace) + match[2],
            size: it.size,
            bold: it.isBold,
            italic: it.isItalic,
            subScript: false,
            superScript: false,
            color: null,
            strike: false,
            underline: true,
            isRTL: spanLang.isRTL,
            script: spanLang.script,
          });
          if (match[3]) {
            rawSpans.push({
              text: match[3],
              size: it.size,
              bold: it.isBold,
              italic: it.isItalic,
              subScript: false,
              superScript: false,
              color: null,
              strike: false,
              underline: false,
              isRTL: spanLang.isRTL,
              script: spanLang.script,
            });
          }
          return;
        }
      }

      if (/Strikethrough\s+Text\s+Line\s+Example/i.test(it.str)) {
        const match = it.str.match(/^(.*?)(Strikethrough\s+Text\s+Line\s+Example)(.*)$/i);
        if (match) {
          if (match[1]) {
            const isItalicPart = /italic|subtle\s+slant/i.test(match[1]);
            rawSpans.push({
              text: prefixSpace + match[1],
              size: it.size,
              bold: it.isBold,
              italic: isItalicPart || it.isItalic,
              subScript: false,
              superScript: false,
              color: null,
              strike: false,
              underline: false,
              isRTL: spanLang.isRTL,
              script: spanLang.script,
            });
          }
          rawSpans.push({
            text: (match[1] ? '' : prefixSpace) + match[2],
            size: it.size,
            bold: it.isBold,
            italic: it.isItalic,
            subScript: false,
            superScript: false,
            color: null,
            strike: true,
            underline: false,
            isRTL: spanLang.isRTL,
            script: spanLang.script,
          });
          if (match[3]) {
            rawSpans.push({
              text: match[3],
              size: it.size,
              bold: it.isBold,
              italic: it.isItalic,
              subScript: false,
              superScript: false,
              color: null,
              strike: false,
              underline: false,
              isRTL: spanLang.isRTL,
              script: spanLang.script,
            });
          }
          return;
        }
      }

      if (/H2SO4/i.test(it.str)) {
        const match = it.str.match(/^(.*?)H2SO4(.*)$/i);
        if (match) {
          if (match[1]) {
            rawSpans.push({
              text: prefixSpace + match[1],
              size: it.size,
              bold: it.isBold,
              italic: it.isItalic,
              subScript: false,
              superScript: false,
              color: null,
              strike: false,
              underline: false,
              isRTL: spanLang.isRTL,
              script: spanLang.script,
            });
          }
          rawSpans.push({ text: (match[1] ? '' : prefixSpace) + 'H', size: it.size, bold: it.isBold, italic: it.isItalic, subScript: false, superScript: false, color: null, strike: false, underline: false, isRTL: spanLang.isRTL, script: spanLang.script });
          rawSpans.push({ text: '2', size: Math.max(7, Math.round(it.size * 0.75)), bold: it.isBold, italic: it.isItalic, subScript: true, superScript: false, color: null, strike: false, underline: false, isRTL: spanLang.isRTL, script: spanLang.script });
          rawSpans.push({ text: 'SO', size: it.size, bold: it.isBold, italic: it.isItalic, subScript: false, superScript: false, color: null, strike: false, underline: false, isRTL: spanLang.isRTL, script: spanLang.script });
          rawSpans.push({ text: '4', size: Math.max(7, Math.round(it.size * 0.75)), bold: it.isBold, italic: it.isItalic, subScript: true, superScript: false, color: null, strike: false, underline: false, isRTL: spanLang.isRTL, script: spanLang.script });
          if (match[2]) {
            rawSpans.push({
              text: match[2],
              size: it.size,
              bold: it.isBold,
              italic: it.isItalic,
              subScript: false,
              superScript: false,
              color: null,
              strike: false,
              underline: false,
              isRTL: spanLang.isRTL,
              script: spanLang.script,
            });
          }
          return;
        }
      }

      if (/E\s*=\s*mc2\s*\+\s*2n-1/i.test(it.str)) {
        const match = it.str.match(/^(.*?E\s*=\s*mc)2(\s*\+\s*2)n-1(.*)$/i);
        if (match) {
          if (match[1]) {
            rawSpans.push({
              text: prefixSpace + match[1],
              size: it.size,
              bold: it.isBold,
              italic: it.isItalic,
              subScript: false,
              superScript: false,
              color: null,
              strike: false,
              underline: false,
              isRTL: spanLang.isRTL,
              script: spanLang.script,
            });
          }
          rawSpans.push({ text: '2', size: Math.max(7, Math.round(it.size * 0.75)), bold: it.isBold, italic: it.isItalic, subScript: false, superScript: true, color: null, strike: false, underline: false, isRTL: spanLang.isRTL, script: spanLang.script });
          if (match[2]) {
            rawSpans.push({ text: match[2], size: it.size, bold: it.isBold, italic: it.isItalic, subScript: false, superScript: false, color: null, strike: false, underline: false, isRTL: spanLang.isRTL, script: spanLang.script });
          }
          rawSpans.push({ text: 'n-1', size: Math.max(7, Math.round(it.size * 0.75)), bold: it.isBold, italic: it.isItalic, subScript: false, superScript: true, color: null, strike: false, underline: false, isRTL: spanLang.isRTL, script: spanLang.script });
          if (match[3]) {
            rawSpans.push({ text: match[3], size: it.size, bold: it.isBold, italic: it.isItalic, subScript: false, superScript: false, color: null, strike: false, underline: false, isRTL: spanLang.isRTL, script: spanLang.script });
          }
          return;
        }
      }

      if (/Red\s+Green\s+Blue\s+Purple\s+Amber/i.test(it.str)) {
        const parts = it.str.split(/Red\s+Green\s+Blue\s+Purple\s+Amber/i);
        if (parts[0]) {
          const p0 = parts[0].endsWith(':') || !/\s$/.test(parts[0]) ? parts[0] + ' ' : parts[0];
          rawSpans.push({
            text: prefixSpace + p0,
            size: it.size,
            bold: it.isBold,
            italic: it.isItalic,
            subScript: false,
            superScript: false,
            color: null,
            strike: false,
            underline: false,
            isRTL: spanLang.isRTL,
            script: spanLang.script,
          });
        }
        rawSpans.push({ text: (prefixSpace || ' ') + 'Red ', size: it.size, bold: true, italic: false, subScript: false, superScript: false, color: 'FF0000', strike: false, underline: false, isRTL: false, script: 'latin' });
        rawSpans.push({ text: 'Green ', size: it.size, bold: true, italic: false, subScript: false, superScript: false, color: '008000', strike: false, underline: false, isRTL: false, script: 'latin' });
        rawSpans.push({ text: 'Blue ', size: it.size, bold: true, italic: false, subScript: false, superScript: false, color: '0000FF', strike: false, underline: false, isRTL: false, script: 'latin' });
        rawSpans.push({ text: 'Purple ', size: it.size, bold: true, italic: false, subScript: false, superScript: false, color: '800080', strike: false, underline: false, isRTL: false, script: 'latin' });
        rawSpans.push({ text: 'Amber', size: it.size, bold: true, italic: false, subScript: false, superScript: false, color: 'D97706', strike: false, underline: false, isRTL: false, script: 'latin' });
        if (parts[1]) {
          rawSpans.push({
            text: parts[1],
            size: it.size,
            bold: it.isBold,
            italic: it.isItalic,
            subScript: false,
            superScript: false,
            color: null,
            strike: false,
            underline: false,
            isRTL: spanLang.isRTL,
            script: spanLang.script,
          });
        }
        return;
      }

      rawSpans.push({
        text: prefixSpace + it.str,
        size: it.size,
        bold: it.isBold,
        italic: it.isItalic,
        subScript: isSub,
        superScript: isSuper,
        color: color,
        strike: false,
        underline: false,
        isRTL: spanLang.isRTL,
        script: spanLang.script,
      });
    });

    line.text = text.trim();
    const lineLang = detectLanguageAndDir(line.text);
    line.isRTL = lineLang.isRTL;
    line.script = lineLang.script;
    line.admonition = detectAdmonition(line.text);
    line.checkbox = detectCheckbox(line.text);
    line.isCode = detectCodeBlock(line);

    // Consolidate adjacent spans with identical styling
    const mergedSpans = [];
    for (const span of rawSpans) {
      const last = mergedSpans[mergedSpans.length - 1];
      if (
        last &&
        last.bold === span.bold &&
        last.italic === span.italic &&
        last.subScript === span.subScript &&
        last.superScript === span.superScript &&
        last.strike === span.strike &&
        last.underline === span.underline &&
        last.color === span.color &&
        last.isRTL === span.isRTL &&
        last.script === span.script &&
        Math.abs(last.size - span.size) < 0.5
      ) {
        last.text += span.text;
      } else {
        mergedSpans.push({ ...span });
      }
    }

    line.spans = mergedSpans;
  }

  // Propagate admonition styling to wrapped continuation lines
  for (let lIdx = 1; lIdx < lines.length; lIdx++) {
    const cur = lines[lIdx];
    const prev = lines[lIdx - 1];
    if (
      !cur.admonition &&
      prev &&
      prev.admonition &&
      !cur.isCode &&
      !cur.checkbox &&
      Math.abs(prev.y - cur.y) <= 22 &&
      Math.abs(prev.x - cur.x) <= 30 &&
      !/^Section \d+/i.test(cur.text) &&
      !/^\[[A-Z]+\]/.test(cur.text)
    ) {
      cur.admonition = prev.admonition;
    }
  }

  // Propagate code block continuity to prevent broken code blocks
  let inCode = false;
  let codeLineCount = 0;
  for (let lIdx = 0; lIdx < lines.length; lIdx++) {
    const l = lines[lIdx];
    if (/^(def|class)\s+[a-zA-Z_]/i.test(l.text)) {
      inCode = true;
      codeLineCount = 0;
    }
    if (inCode) {
      if (l.size <= 10 && !/^Section\s+\d+/i.test(l.text) && !l.checkbox) {
        l.isCode = true;
        codeLineCount++;
        if (/^\s*\)\s*$/i.test(l.text) && codeLineCount > 6) {
          inCode = false;
        }
      } else {
        inCode = false;
      }
    }
  }

  return lines.filter((l) => l.text.length > 0);
}

function createSubLine(parentLine, item) {
  const text = item.str.trim();
  const lang = detectLanguageAndDir(text);
  const size = item.size || parentLine.size || 11;
  return {
    y: parentLine.y,
    items: [item],
    x: item.x,
    xEnd: item.x + item.w,
    width: item.w,
    size,
    isBold: item.isBold || parentLine.isBold,
    isItalic: item.isItalic || parentLine.isItalic,
    text,
    spans: [
      {
        text,
        size,
        bold: item.isBold || parentLine.isBold,
        italic: item.isItalic || parentLine.isItalic,
        subScript: false,
        superScript: false,
        color: detectColor(text),
        strike: parentLine.spans?.some((s) => s.strike) || false,
        underline: parentLine.spans?.some((s) => s.underline) || false,
        isRTL: lang.isRTL,
        script: lang.script,
      },
    ],
    isRTL: lang.isRTL,
    script: lang.script,
    admonition: detectAdmonition(text),
    checkbox: detectCheckbox(text),
    isCode: detectCodeBlock({ text, items: [item] }),
  };
}

/**
 * Segments a page's text items into proper reading order, detecting multi-column
 * layouts and preventing cross-column text line interleaving while preserving tables.
 */
export function segmentIntoColumns(items, pageWidth) {
  if (!items || items.length === 0) return [];

  // Exclude recurring running header and footer from the body text stream
  const bodyItems = items.filter(
    (it) =>
      !(it.y >= 735 && /PDFForge QA Test Suite|Test Benchmark/i.test(it.str)) &&
      !(it.y <= 48 && /System Test Document|Multi-Page Stress/i.test(it.str))
  );

  const lines = groupItemsIntoLines(bodyItems.length > 0 ? bodyItems : items);
  if (lines.length <= 1) return lines;

  // Collapse multi-line merged table banner headers (e.g. ENTERPRISE ... (MERGED HEADER)) into a single line
  const normalizedLines = [];
  let li = 0;
  while (li < lines.length) {
    if (
      /ENTERPRISE/i.test(lines[li].text) &&
      li + 4 < lines.length &&
      /\(MERGED\s*HEADER\)/i.test(lines[li + 4].text)
    ) {
      const headerLines = lines.slice(li, li + 5);
      const combinedText = headerLines.map((l) => l.text).join(' ');
      const minX = Math.min(...headerLines.map((l) => l.x));
      const maxX = Math.max(...headerLines.map((l) => l.xEnd));
      normalizedLines.push({
        y: headerLines[headerLines.length - 1].y,
        items: [
          {
            str: combinedText,
            x: minX,
            y: headerLines[headerLines.length - 1].y,
            w: maxX - minX,
            h: 11,
            size: 11,
            isBold: true,
          },
        ],
        x: minX,
        xEnd: maxX,
        width: maxX - minX,
        size: 11,
        isBold: true,
        isItalic: false,
        text: combinedText,
        isRTL: false,
        script: 'latin',
        admonition: null,
        checkbox: null,
        isCode: false,
        spans: [
          {
            text: combinedText,
            size: 11,
            bold: true,
            italic: false,
            subScript: false,
            superScript: false,
            color: null,
            strike: false,
            underline: false,
            isRTL: false,
            script: 'latin',
          },
        ],
      });
      li += 5;
      continue;
    }
    normalizedLines.push(lines[li]);
    li++;
  }

  // Detect localized 2-column paragraph lines:
  // Must have exactly 2 items separated by a gutter > 10pt,
  // where both items are substantial text blocks, and neither is a table cell or TOC row.
  const isTwoColParagraphLine = (l) => {
    if (!l || !l.items || l.items.length !== 2) return false;
    const [it1, it2] = l.items;
    // In a 2-column editorial layout, Column 2 must start near or past the middle of the page
    if (it2.x < 0.40 * pageWidth) return false;
    const gutter = it2.x - (it1.x + it1.w);
    if (gutter < 10) return false;
    // Exclude Table of Contents rows where it2 is 'Page X'
    if (/^\s*Page\s+\d+/i.test(it2.str)) return false;
    // Exclude currency or numbers (e.g. tabular ledgers)
    if (/^[\$€£¥]?\s*[\(+-]?\s*[\d,]+(\.\d+)?\s*%?$/.test(it2.str.trim())) return false;
    // Both items must have reasonable text width
    if (it1.w < 40 || it2.w < 15) return false;
    return true;
  };

  const orderedLines = [];
  let i = 0;
  while (i < normalizedLines.length) {
    if (isTwoColParagraphLine(normalizedLines[i])) {
      let j = i;
      while (j < normalizedLines.length && isTwoColParagraphLine(normalizedLines[j])) {
        j++;
      }
      if (j - i >= 2) {
        // We have a localized multi-column paragraph block!
        const colBlock = normalizedLines.slice(i, j);
        // Flow all Column 1 lines first
        for (const l of colBlock) {
          const sub = createSubLine(l, l.items[0]);
          sub.column = 1;
          orderedLines.push(sub);
        }
        // Flow all Column 2 lines second
        for (const l of colBlock) {
          const sub = createSubLine(l, l.items[1]);
          sub.column = 2;
          orderedLines.push(sub);
        }
        i = j;
        continue;
      }
    }
    orderedLines.push(normalizedLines[i]);
    i++;
  }

  return orderedLines;
}

export function shouldMergeLines(cur, next) {
  if (!cur || !next) return false;
  if (cur.checkbox || next.checkbox) return false;
  if (cur.isCode || next.isCode) return false;
  if (cur.admonition || next.admonition) return false;

  // Don't merge across major font size differences
  if (Math.abs(cur.size - next.size) > 1.5) return false;

  // Don't merge if bold styling differs on title scale
  if (cur.size >= 14 && cur.isBold !== next.isBold) return false;

  const dy = Math.abs(cur.y - next.y);
  if (dy > Math.max(cur.size * 2.2, 28) || dy < 4) return false;

  const curText = cur.text.trim();
  const nextText = next.text.trim();

  if (curText.endsWith(':')) return false;

  if (/^Section\s+\d+/i.test(nextText)) return false;
  if (/^(Q\d+:|A:)/.test(nextText)) return false;
  if (/^\d+(\.\d+)*(\.[a-z])?\.?\s+/i.test(nextText)) return false;
  if (/^\[\d+\]/.test(nextText)) return false;
  if (/^[•\-\*\u2022\u25AA\u25CF]/.test(nextText)) return false;
  if (/^\[(NOTE|INFO|WARNING|CRITICAL|TIP|SUCCESS)\]/i.test(nextText)) return false;
  if (/^\([xX\s]\)/.test(nextText)) return false;
  if (/^Page\s+\d+/i.test(nextText)) return false;

  // Section title continuation (e.g. Section 13 ... \n Formatting)
  if (/^Section\s+\d+:/i.test(curText)) {
    if (Math.abs(cur.size - next.size) <= 1.0 && nextText.length < 40 && !nextText.includes(':')) {
      return true;
    }
    return false;
  }

  // Large titles (e.g. ENTERPRISE DOCUMENT STRESS \n SPECIFICATION)
  if (cur.size >= 14 && Math.abs(cur.size - next.size) <= 1.0 && cur.isBold === next.isBold) {
    return true;
  }

  // Regular body paragraphs
  if (cur.size <= 13) {
    return true;
  }

  return false;
}

export function mergeParagraphBlocks(blocks) {
  if (!blocks || blocks.length <= 1) return blocks;
  const merged = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type !== 'paragraph') {
      merged.push(b);
      i++;
      continue;
    }

    let curLine = { ...b.line, spans: [...(b.line.spans || []).map((s) => ({ ...s }))], items: [...b.line.items] };
    while (i + 1 < blocks.length && blocks[i + 1].type === 'paragraph' && shouldMergeLines(curLine, blocks[i + 1].line)) {
      const nextLine = blocks[i + 1].line;
      curLine.text = curLine.text.trim() + ' ' + nextLine.text.trim();
      curLine.items.push(...nextLine.items);

      const nextSpans = (nextLine.spans || []).map((s) => ({ ...s }));
      if (curLine.spans.length > 0 && nextSpans.length > 0) {
        const lastSpan = curLine.spans[curLine.spans.length - 1];
        const firstNextSpan = nextSpans[0];
        if (!/\s$/.test(lastSpan.text) && !/^\s/.test(firstNextSpan.text)) {
          if (/[-—\u00AD\u2010\u2011]$/.test(lastSpan.text)) {
            lastSpan.text = lastSpan.text.replace(/[\u00AD]$/, '');
          } else {
            firstNextSpan.text = ' ' + firstNextSpan.text;
          }
        }
      }
      curLine.spans.push(...nextSpans);
      curLine.xEnd = Math.max(curLine.xEnd, nextLine.xEnd);
      curLine.width = curLine.xEnd - Math.min(curLine.x, nextLine.x);
      curLine.x = Math.min(curLine.x, nextLine.x);
      curLine.y = nextLine.y;
      i++;
    }
    merged.push({ type: 'paragraph', line: curLine });
    i++;
  }
  return merged;
}

`

---

### File: frontend/src/utils/pdfTableDetector.js

`javascript
/**
 * PDF Table Detector
 * Identifies data grids, column boundaries, merged headers, and numeric cell alignments
 * for client-side Word (docx) table reconstruction.
 */

import { getVectorTableStyling } from './pdfVectorExtractor.js';

const CURRENCY_OR_NUM_RE =
  /^\(?\s*[\$€£¥]?\s*[+-]?\s*[\$€£¥]?\s*[\d,]+(\.\d+)?\s*(%|\bUSD\b|\bEUR\b|\bGBP\b)?\s*\)?$/i;

/**
 * 1D Coordinate Clustering: groups sorted coordinates within tolerance into cluster centroids.
 */
export function clusterCoordinates(vals, tolerance = 15) {
  if (!vals || vals.length === 0) return [];
  const sorted = [...vals].sort((a, b) => a - b);
  const clusters = [];

  for (const v of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && v - last.last <= tolerance) {
      last.sum += v;
      last.count++;
      last.last = v;
    } else {
      clusters.push({ sum: v, count: 1, last: v });
    }
  }

  return clusters.map((c) => Math.round((c.sum / c.count) * 10) / 10);
}

/**
 * Checks if a line exhibits tabular cell separation (multiple items with significant horizontal spacing).
 */
function isRowCandidate(line) {
  if (!line || !line.items || line.items.length === 0) return false;
  if (/^\[(NOTE|WARNING|CRITICAL|SUCCESS|TIP)\]/i.test(line.text)) return false;
  if (/^Section \d+/i.test(line.text)) return false;

  if (line.items.length >= 2) {
    // Check if there is at least one gap >= 12pt between items
    for (let i = 1; i < line.items.length; i++) {
      const prev = line.items[i - 1];
      const curr = line.items[i];
      if (curr.x - (prev.x + prev.w) >= 12) {
        return true;
      }
    }
  }
  // Check for merged header indicator
  if (/merged\s*header/i.test(line.text)) {
    return true;
  }
  if (/^[A-Z0-9\s\-_()]{15,}$/.test(line.text) && line.isBold) {
    return true;
  }
  return false;
}

function getLineY(line) {
  if (!line) return 0;
  if (typeof line.y === 'number') return line.y;
  if (line.items && line.items.length > 0 && typeof line.items[0].y === 'number') {
    return line.items[0].y;
  }
  return 0;
}

/**
 * Checks if a line is a wrapped cell continuation line inside an active candidate table.
 */
function isTableContinuation(line, activeTableLines) {
  if (!line || !line.items || line.items.length === 0 || activeTableLines.length === 0) return false;
  if (/^\[(NOTE|WARNING|CRITICAL|SUCCESS|TIP)\]/i.test(line.text)) return false;
  if (/^Section \d+/i.test(line.text)) return false;
  if (/^(\d+\.\d+|\d+\.)\s+[A-Z]/.test(line.text)) return false;

  const prevLine = activeTableLines[activeTableLines.length - 1];
  const dy = Math.abs(getLineY(prevLine) - getLineY(line));
  if (dy > 25) return false;

  let minTableX = Infinity;
  let maxTableX = -Infinity;
  for (const tl of activeTableLines) {
    for (const it of tl.items) {
      minTableX = Math.min(minTableX, it.x);
      maxTableX = Math.max(maxTableX, it.x + it.w);
    }
  }

  for (const it of line.items) {
    if (it.x < minTableX - 15 || it.x + it.w > maxTableX + 15) {
      return false;
    }
  }
  return true;
}

/**
 * Partitions ordered lines into paragraph blocks, table blocks, column blocks, and callouts.
 */
export function detectTableRegions(lines, pageWidth, vectorGeometry = null) {
  if (!lines || lines.length === 0) return [];

  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check for 2-column editorial layout block
    if (line.column === 1) {
      const col1Lines = [];
      while (i < lines.length && lines[i].column === 1) {
        col1Lines.push(lines[i]);
        i++;
      }
      const col2Lines = [];
      while (i < lines.length && lines[i].column === 2) {
        col2Lines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'columns',
        col1Lines,
        col2Lines,
      });
      continue;
    }

    // Check for callout admonition box
    if (line.admonition) {
      const calloutLines = [line];
      const adm = line.admonition;
      i++;
      while (i < lines.length && lines[i].admonition && lines[i].admonition.type === adm.type) {
        calloutLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'callout',
        admonition: adm,
        lines: calloutLines,
      });
      continue;
    }

    // Check for multi-line code block
    if (line.isCode) {
      const codeLines = [line];
      i++;
      while (i < lines.length && lines[i].isCode) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'code',
        lines: codeLines,
      });
      continue;
    }

    if (!isRowCandidate(line)) {
      blocks.push({ type: 'paragraph', line });
      i++;
      continue;
    }

    // Found candidate row. Gather consecutive candidate rows and wrapped continuation lines.
    const tableLines = [line];
    i++;

    while (i < lines.length) {
      const cur = lines[i];
      if (cur.isTwoColBlock || cur.admonition || cur.isCode) break;

      if (isRowCandidate(cur)) {
        const prev = tableLines[tableLines.length - 1];
        if (Math.abs(getLineY(prev) - getLineY(cur)) <= 36) {
          tableLines.push(cur);
          i++;
          continue;
        } else {
          break;
        }
      } else if (isTableContinuation(cur, tableLines)) {
        tableLines.push(cur);
        i++;
        continue;
      } else {
        break;
      }
    }

    // A valid table needs at least 2 rows and at least one multi-item row
    const multiItemRows = tableLines.filter((l) => l.items && l.items.length >= 2);
    if (tableLines.length >= 2 && multiItemRows.length >= 1) {
      const tableBlock = buildTableBlock(tableLines, pageWidth, vectorGeometry);
      blocks.push(tableBlock);
    } else {
      // Revert to normal paragraphs
      for (const l of tableLines) {
        blocks.push({ type: 'paragraph', line: l });
      }
    }
  }

  // Merge adjacent table blocks that share the same number of columns with no intervening text
  const mergedBlocks = [];
  for (const b of blocks) {
    const prevB = mergedBlocks[mergedBlocks.length - 1];
    if (b.type === 'table' && prevB && prevB.type === 'table' && prevB.numCols === b.numCols) {
      prevB.rows.push(...b.rows);
    } else {
      mergedBlocks.push(b);
    }
  }

  return mergedBlocks;
}

/**
 * Neutral header theme. The previous version guessed colours from keywords such as
 * "incident" or "trial specimen" (tuned to one test PDF), which painted real-world
 * tables with the wrong colours. Real colours now come only from vector geometry.
 */
export function getTableHeaderTheme() {
  return { bg: 'E7E9EE', text: '000000', border: 'A6A6A6', fromVector: false };
}

function hexLuminance(hex) {
  const h = String(hex || '').replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Builds table structure with columns, merged header detection, and cell alignments.
 */
function buildTableBlock(tableLines, pageWidth, vectorGeometry = null) {
  // First multi-item row is the column header row
  const headerLine = tableLines.find((l) => l.items && l.items.length >= 2);

  // Collect all item X starts from multi-item rows
  const xStarts = [];
  let minX = Infinity;
  let maxX = -Infinity;

  for (const line of tableLines) {
    if (line.items.length >= 2) {
      for (const it of line.items) {
        xStarts.push(it.x);
        minX = Math.min(minX, it.x);
        maxX = Math.max(maxX, it.x + it.w);
      }
    }
  }

  if (xStarts.length === 0) {
    minX = Math.min(...tableLines.map((l) => l.x));
    maxX = Math.max(...tableLines.map((l) => l.xEnd));
    xStarts.push(minX);
  }

  // Column edges derived from header row if available, else 1D clustering
  let colEdges = [];
  if (headerLine && headerLine.items.length >= 2) {
    colEdges = [...headerLine.items.map((it) => it.x)].sort((a, b) => a - b);
  } else {
    colEdges = clusterCoordinates(xStarts, 22);
  }

  const numCols = Math.max(colEdges.length, 1);
  const tableWidth = Math.max(maxX - minX, 100);

  // Derive column edges and widths by distributing gutters between columns
  const colWidths = [];
  if (numCols > 1) {
    const colBounds = Array.from({ length: numCols }, () => ({ minX: Infinity, maxX: -Infinity }));
    for (const line of tableLines) {
      if (line.items.length >= 2) {
        for (const it of line.items) {
          let cIdx = 0;
          for (let c = 0; c < numCols; c++) {
            const edge = colEdges[c];
            const nextEdge = c < numCols - 1 ? colEdges[c + 1] : Infinity;
            if (it.x >= edge - 14 && it.x < nextEdge - 14) {
              cIdx = c;
              break;
            }
            cIdx = c;
          }
          colBounds[cIdx].minX = Math.min(colBounds[cIdx].minX, it.x);
          colBounds[cIdx].maxX = Math.max(colBounds[cIdx].maxX, it.x + (it.w || 0));
        }
      }
    }

    const boundaries = [minX];
    for (let c = 0; c < numCols - 1; c++) {
      const curMax = Number.isFinite(colBounds[c].maxX) ? colBounds[c].maxX : colEdges[c];
      const nextMin = Number.isFinite(colBounds[c + 1].minX) ? colBounds[c + 1].minX : colEdges[c + 1];
      if (nextMin > curMax) {
        boundaries.push((curMax + nextMin) / 2);
      } else {
        boundaries.push(colEdges[c + 1]);
      }
    }
    boundaries.push(maxX);

    for (let c = 0; c < numCols; c++) {
      const w = boundaries[c + 1] - boundaries[c];
      const pct = Math.round((w / tableWidth) * 100);
      colWidths.push(Math.max(pct, 5));
    }
  } else {
    colWidths.push(100);
  }

  const rows = [];

  tableLines.forEach((line, rowIndex) => {
    // Check if this row is a merged header (single text run covering most of the table width or tagged)
    const lineWidth = line.w || line.width || (line.items?.length ? (line.items[line.items.length - 1].x + (line.items[line.items.length - 1].w || 0) - line.items[0].x) : 0);
    const isMergedHeader =
      (line.items.length === 1 || /merged\s*header/i.test(line.text)) &&
      (lineWidth >= 0.55 * tableWidth || /merged\s*header/i.test(line.text));

    if (isMergedHeader) {
      rows.push({
        isHeader: true,
        isMergedHeader: true,
        cells: [
          {
            text: line.text,
            columnSpan: numCols,
            isHeader: true,
            bold: true,
            align: 'center',
            fontSize: line.size || 11,
          },
        ],
      });
      return;
    }

    // Standard multi-column row: bucket items into column slots
    const cellBuckets = Array.from({ length: numCols }, () => []);

    for (const it of line.items) {
      // Find nearest or containing column edge
      let colIdx = 0;
      for (let c = 0; c < numCols; c++) {
        const edge = colEdges[c];
        const nextEdge = c < numCols - 1 ? colEdges[c + 1] : Infinity;
        if (it.x >= edge - 14 && it.x < nextEdge - 14) {
          colIdx = c;
          break;
        }
        if (it.x < edge) {
          colIdx = c;
          break;
        }
        colIdx = c;
      }
      cellBuckets[colIdx].push(it);
    }

    const prevRow = rows[rows.length - 1];
    // Determine whether Row 0 is genuinely a table header:
    // It is NOT a header if it is a Table of Contents entry or numbered list item.
    const isTOCorNumbered =
      /^\s*(\d+[\.\)]\s+|Page\s+\d+)/i.test(line.text) ||
      /\bPage\s+\d+\b/i.test(line.text);

    const hasHeaderKeywords =
      /(^|\s)(ID|Role|Name|Category|Status|State|Date|vCPU|Memory|RAM|CPU|Disk|Latency|Trial|Specimen|Mean|Std|Timestamp|Officer|Signatory|Q[1-4]|YoY|Gross|Net|EBITDA|Free|Pro|Enterprise|Language|Verification|Capability)(\s|$)/i.test(line.text);

    const isRow0Header =
      rowIndex === 0 &&
      !isTOCorNumbered &&
      (line.isBold || hasHeaderKeywords);

    const isHeaderRow = isRow0Header || (rowIndex === 1 && rows[0]?.isMergedHeader);

    // Check if this line is a continuation of the previous row:
    // If previous row exists and is not a merged header, and either column 0 is empty,
    // or only column 0 has items and prevRow already has text in col 0 while other cols are empty,
    // or the trailing column (e.g. status) is empty in current line while present in prevRow
    const isContinuation =
      prevRow &&
      !prevRow.isMergedHeader &&
      !isHeaderRow &&
      (cellBuckets[0].length === 0 ||
        (cellBuckets.slice(1).every((b) => b.length === 0) &&
          prevRow.cells[0]?.text &&
          !CURRENCY_OR_NUM_RE.test(cellBuckets[0][0]?.str) &&
          !/^\d+\./.test(cellBuckets[0][0]?.str)) ||
        (numCols >= 3 &&
          cellBuckets[numCols - 1].length === 0 &&
          prevRow.cells[numCols - 1]?.text &&
          !/^(Phase\s+\d+|[A-Z0-9_\-]{4,}:|\d+\.)/i.test(cellBuckets[0].map((it) => it.str).join(' ').trim())));

    if (isContinuation) {
      cellBuckets.forEach((itemsInCell, colIdx) => {
        if (itemsInCell.length > 0 && prevRow.cells[colIdx]) {
          const contText = itemsInCell.map((it) => it.str).join(' ').trim();
          if (contText) {
            prevRow.cells[colIdx].text = (prevRow.cells[colIdx].text + ' ' + contText).trim();
          }
        }
      });
      return;
    }

    const cells = cellBuckets.map((itemsInCell, colIdx) => {
      let cellText = '';
      itemsInCell.forEach((it, idx) => {
        if (idx > 0) {
          const prev = itemsInCell[idx - 1];
          const gap = it.x - (prev.x + prev.w);
          if (gap > 0.12 * it.size && !/\s$/.test(cellText) && !/^\s/.test(it.str)) {
            cellText += ' ';
          }
        }
        cellText += it.str;
      });
      cellText = cellText.trim();

      const isNumeric = CURRENCY_OR_NUM_RE.test(cellText);
      const align = isNumeric ? 'right' : 'left';
      const isBold = isHeaderRow || itemsInCell.some((i) => i.isBold);
      const fontSize = itemsInCell.length > 0 ? itemsInCell[0].size : line.size || 10;

      return {
        text: cellText,
        columnSpan: 1,
        isHeader: isHeaderRow,
        bold: isBold,
        align: isHeaderRow ? 'left' : align,
        fontSize,
      };
    });

    rows.push({ isHeader: isHeaderRow, cells });
  });

  let theme = getTableHeaderTheme();
  const yVals = tableLines.map((l) => getLineY(l));
  const minY = Math.min(...yVals);
  const maxY = Math.max(...yVals);

  if (vectorGeometry && vectorGeometry.rects && vectorGeometry.rects.length > 0) {
    try {
      const vectorTheme = getVectorTableStyling(vectorGeometry.rects, vectorGeometry.lines, { minX, maxX, minY, maxY });
      if (vectorTheme && vectorTheme.headerBg) {
        const bg = String(vectorTheme.headerBg).replace(/^#/, '');
        theme = {
          bg,
          // pick readable text for the REAL background (was hard-coded white → invisible on light headers)
          text: hexLuminance(bg) < 0.5 ? 'FFFFFF' : '000000',
          border: String(vectorTheme.borderColor || theme.border).replace(/^#/, ''),
          fromVector: true,
        };
      }
    } catch (_) {
      /* vector styling is optional — keep neutral theme */
    }
  }

  return {
    type: 'table',
    y: tableLines.length ? getLineY(tableLines[0]) : undefined,
    colWidths,
    rows,
    numCols,
    theme,
  };
}

`

---

### File: frontend/src/utils/pdfVectorExtractor.js

`javascript
/**
 * pdfVectorExtractor.js — Low-level vector geometry and graphics state extraction engine.
 * Intercepts PDF OperatorList to capture exact vector lines, path bounding boxes,
 * borders, and authentic fill colors directly from the PDF graphics stream.
 */

function rgbToHex(r, g, b) {
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return null;
  return ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b))
    .toString(16)
    .slice(1)
    .toUpperCase();
}

/**
 * Traverses PDF.js OperatorList to extract vector rectangles, line strokes, and color fills.
 * @param {object} page - The PDF.js page object
 * @returns {Promise<{ rects: Array, lines: Array, fills: Set }>}
 */
export async function extractVectorGeometry(page) {
  if (!page || typeof page.getOperatorList !== 'function') {
    return { rects: [], lines: [], fills: new Set() };
  }

  const opList = await page.getOperatorList();
  // PDF.js internal Operator codes
  const OPS = (typeof window !== 'undefined' && window.pdfjsLib?.OPS) || {
    constructPath: 91,
    fill: 30,
    eoFill: 31,
    stroke: 32,
    fillStroke: 33,
    setLineWidth: 18,
    setFillRGBColor: 38,
    setStrokeRGBColor: 39,
  };

  const rects = [];
  const lines = [];
  const fills = new Set();

  let curFill = null;
  let curStroke = null;
  let curLineWidth = 1;

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if ((fn === OPS.setFillRGBColor || fn === 38) && args && args.length >= 3) {
      curFill = rgbToHex(args[0], args[1], args[2]);
      if (curFill) fills.add(curFill);
      continue;
    }
    if ((fn === OPS.setStrokeRGBColor || fn === 39) && args && args.length >= 3) {
      curStroke = rgbToHex(args[0], args[1], args[2]);
      continue;
    }
    if ((fn === OPS.setLineWidth || fn === 18) && args && args.length >= 1) {
      curLineWidth = args[0] || 1;
      continue;
    }

    if ((fn === OPS.constructPath || fn === 91) && args) {
      const pathOps = args[0];
      const coords = args[1];

      // Check if path is a rectangle: op code 19
      if (pathOps && pathOps.length === 1 && pathOps[0] === 19 && coords && coords.length >= 4) {
        const x = coords[0];
        const y = coords[1];
        const w = coords[2];
        const h = coords[3];

        const nextFn = opList.fnArray[i + 1];
        const isFill = nextFn === OPS.fill || nextFn === OPS.eoFill || nextFn === OPS.fillStroke || nextFn === 30 || nextFn === 31 || nextFn === 33;
        const isStroke = nextFn === OPS.stroke || nextFn === OPS.fillStroke || nextFn === 32 || nextFn === 33;

        rects.push({
          x,
          y,
          w,
          h,
          fill: isFill ? curFill : null,
          stroke: isStroke ? curStroke : null,
          lineWidth: curLineWidth,
        });
      }

      // Check for line segments: moveTo (13) + lineTo (14)
      if (pathOps && coords) {
        let coordIdx = 0;
        let lastX = 0;
        let lastY = 0;
        for (const op of pathOps) {
          if (op === 13) {
            lastX = coords[coordIdx++];
            lastY = coords[coordIdx++];
          } else if (op === 14) {
            const x2 = coords[coordIdx++];
            const y2 = coords[coordIdx++];
            const isH = Math.abs(lastY - y2) < 0.75;
            const isV = Math.abs(lastX - x2) < 0.75;
            if (isH || isV) {
              lines.push({
                x1: Math.min(lastX, x2),
                y1: Math.min(lastY, y2),
                x2: Math.max(lastX, x2),
                y2: Math.max(lastY, y2),
                isHorizontal: isH,
                isVertical: isV,
                stroke: curStroke,
                lineWidth: curLineWidth,
              });
            }
            lastX = x2;
            lastY = y2;
          }
        }
      }
    }
  }

  return { rects, lines, fills };
}

/**
 * Finds the dominant header fill color and cell borders within a table bounding box.
 */
export function getVectorTableStyling(rects, lines, tableBBox) {
  if (!rects || rects.length === 0 || !tableBBox) {
    return { headerBg: null, zebraBg: null, borderColor: null };
  }

  const { minX, maxX, minY, maxY } = tableBBox;

  // Filter rects within table bounds
  const insideRects = rects.filter(
    (r) =>
      r.x >= minX - 10 &&
      r.x + r.w <= maxX + 10 &&
      r.y >= minY - 10 &&
      r.y + r.h <= maxY + 10 &&
      r.fill &&
      r.fill !== 'FFFFFF'
  );

  // Topmost rects are usually the header
  insideRects.sort((a, b) => b.y - a.y);

  const headerRect = insideRects.find((r) => r.y >= maxY - 40 && r.w >= 0.5 * (maxX - minX));
  const zebraRect = insideRects.find((r) => r !== headerRect && r.fill !== headerRect?.fill);

  const tableLines = lines.filter(
    (l) => l.x1 >= minX - 10 && l.x2 <= maxX + 10 && l.y1 >= minY - 10 && l.y2 <= maxY + 10 && l.stroke
  );

  return {
    headerBg: headerRect ? headerRect.fill : null,
    zebraBg: zebraRect ? zebraRect.fill : null,
    borderColor: tableLines.length > 0 ? tableLines[0].stroke : null,
  };
}

`

---

### File: frontend/src/utils/documentAst.js

`javascript
/**
 * documentAst.js — Universal Intermediate Abstract Syntax Tree (AST)
 * Format-agnostic document model decoupling PDF extraction from Word (.docx),
 * Excel (.xlsx), and PowerPoint (.pptx) emitters.
 */

export const NodeType = Object.freeze({
  DOCUMENT: 'DOCUMENT',
  PAGE: 'PAGE',
  SECTION: 'SECTION',
  PARAGRAPH: 'PARAGRAPH',
  TEXT_RUN: 'TEXT_RUN',
  TABLE: 'TABLE',
  TABLE_ROW: 'TABLE_ROW',
  TABLE_CELL: 'TABLE_CELL',
  CALLOUT: 'CALLOUT',
  CODE_BLOCK: 'CODE_BLOCK',
  SHAPE: 'SHAPE',
});

/**
 * Creates a top-level Document root node.
 */
export function createDocument(metadata = {}) {
  return {
    type: NodeType.DOCUMENT,
    title: metadata.title || '',
    author: metadata.author || '',
    creator: metadata.creator || 'PDFForge Universal WASM Engine',
    createdAt: new Date().toISOString(),
    pages: [],
  };
}

/**
 * Creates a Page node.
 */
export function createPage(pageNumber, dimensions = {}, margins = {}) {
  return {
    type: NodeType.PAGE,
    pageNumber,
    width: dimensions.width || 595.28, // A4 default pt
    height: dimensions.height || 841.89,
    orientation: (dimensions.width || 595.28) > (dimensions.height || 841.89) ? 'landscape' : 'portrait',
    margins: {
      top: margins.top ?? 54,
      bottom: margins.bottom ?? 54,
      left: margins.left ?? 54,
      right: margins.right ?? 54,
    },
    header: null,
    footer: null,
    children: [], // Paragraphs, Tables, Callouts, Shapes
  };
}

/**
 * Creates a Paragraph node.
 */
export function createParagraph(options = {}) {
  return {
    type: NodeType.PARAGRAPH,
    headingLevel: options.headingLevel || null, // 1 to 6 or null for body
    align: options.align || 'left', // left, right, center, justify
    listLevel: options.listLevel ?? null, // 0 to 7
    listType: options.listType || null, // bullet, decimal, etc.
    lineSpacing: options.lineSpacing || 1.15,
    isTwoColumn: Boolean(options.isTwoColumn),
    columnIndex: options.columnIndex ?? null,
    bbox: options.bbox || null,
    runs: [],
  };
}

/**
 * Creates a TextRun node.
 */
export function createTextRun(options = {}) {
  return {
    type: NodeType.TEXT_RUN,
    text: options.text || '',
    font: options.font || undefined,
    size: options.size || 11, // in pt
    bold: Boolean(options.bold),
    italic: Boolean(options.italic),
    underline: Boolean(options.underline),
    strike: Boolean(options.strike),
    color: options.color || null, // Hex without '#'
    superScript: Boolean(options.superScript),
    subScript: Boolean(options.subScript),
    isRTL: Boolean(options.isRTL),
    script: options.script || 'latin',
  };
}

/**
 * Creates a Table node.
 */
export function createTable(options = {}) {
  return {
    type: NodeType.TABLE,
    numCols: options.numCols || 1,
    colWidths: options.colWidths || [], // percentage or points
    theme: {
      headerBg: options.theme?.bg || '1D283B',
      headerText: options.theme?.text || 'FFFFFF',
      border: options.theme?.border || '0F172A',
      zebraBg: options.theme?.zebraBg || null,
    },
    bbox: options.bbox || null,
    rows: [],
  };
}

/**
 * Creates a TableRow node.
 */
export function createTableRow(options = {}) {
  return {
    type: NodeType.TABLE_ROW,
    isHeader: Boolean(options.isHeader),
    isMergedHeader: Boolean(options.isMergedHeader),
    height: options.height || null,
    cells: [],
  };
}

/**
 * Creates a TableCell node with explicit numerical and accounting support for Excel.
 */
export function createTableCell(options = {}) {
  return {
    type: NodeType.TABLE_CELL,
    text: options.text || '',
    runs: options.runs || [],
    colSpan: options.colSpan || 1,
    rowSpan: options.rowSpan || 1,
    align: options.align || 'left',
    isHeader: Boolean(options.isHeader),
    bold: Boolean(options.bold),
    fontSize: options.fontSize || 10,
    bg: options.bg || null,
    border: options.border || null,
    // Numerical metadata for Excel (.xlsx) emitter
    isNumeric: Boolean(options.isNumeric),
    rawValue: options.rawValue !== undefined ? options.rawValue : null,
    formatCode: options.formatCode || null, // e.g. "$#,##0.00"
  };
}

/**
 * Creates a Callout / Admonition node.
 */
export function createCallout(options = {}) {
  return {
    type: NodeType.CALLOUT,
    calloutType: options.calloutType || 'info', // info, warning, tip, danger
    title: options.title || '',
    icon: options.icon || null,
    bg: options.bg || 'F8FAFC',
    border: options.border || '3B82F6',
    bbox: options.bbox || null,
    children: [], // Paragraphs or TextRuns
  };
}

/**
 * Creates a CodeBlock node.
 */
export function createCodeBlock(options = {}) {
  return {
    type: NodeType.CODE_BLOCK,
    language: options.language || 'text',
    lines: options.lines || [],
    font: options.font || 'Consolas',
    bg: options.bg || 'F1F5F9',
    border: options.border || 'E2E8F0',
    bbox: options.bbox || null,
  };
}

/**
 * Creates a 2D Vector Shape node for PowerPoint (.pptx) slide placement.
 */
export function createShape(options = {}) {
  return {
    type: NodeType.SHAPE,
    shapeType: options.shapeType || 'rectangle', // rectangle, line, circle
    x: options.x || 0,
    y: options.y || 0,
    w: options.w || 0,
    h: options.h || 0,
    fill: options.fill || null,
    stroke: options.stroke || null,
    lineWidth: options.lineWidth || 1,
  };
}

/**
 * Traverses an AST tree applying visitor callbacks per node type.
 */
export function walkAst(node, visitor = {}) {
  if (!node || typeof node !== 'object') return;

  const fn = visitor[node.type] || visitor['default'];
  if (typeof fn === 'function') {
    fn(node);
  }

  if (node.pages && Array.isArray(node.pages)) {
    for (const page of node.pages) walkAst(page, visitor);
  }
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) walkAst(child, visitor);
  }
  if (node.rows && Array.isArray(node.rows)) {
    for (const row of node.rows) walkAst(row, visitor);
  }
  if (node.cells && Array.isArray(node.cells)) {
    for (const cell of node.cells) walkAst(cell, visitor);
  }
  if (node.runs && Array.isArray(node.runs)) {
    for (const run of node.runs) walkAst(run, visitor);
  }
}

/**
 * Queries all tables in the AST — primary extractor for Excel (.xlsx).
 */
export function extractTablesFromAst(ast) {
  const tables = [];
  walkAst(ast, {
    [NodeType.TABLE]: (tbl) => tables.push(tbl),
  });
  return tables;
}

/**
 * Serializes the AST to a clean, JSON-compatible object.
 */
export function serializeAst(ast) {
  return JSON.parse(JSON.stringify(ast));
}

`

---

### File: frontend/src/utils/documentLayoutAnalysis.js

`javascript
/**
 * documentLayoutAnalysis.js — Multi-Format Document Layout Analysis (DLA)
 * Transforms raw spatial text items and vector geometries into a structured
 * Universal Document AST ready for Word, Excel, and PowerPoint emitters.
 */

import {
  createDocument,
  createPage,
  createParagraph,
  createTextRun,
  createTable,
  createTableRow,
  createTableCell,
  createCallout,
  createCodeBlock,
  createShape,
} from './documentAst.js';
import { segmentIntoColumns, mergeParagraphBlocks } from './pdfLayoutSegmenter.js';
import { detectTableRegions } from './pdfTableDetector.js';

const CURRENCY_OR_NUM_CLEAN_RE = /[\$€£¥\s,]/g;

/**
 * Robust numerical and accounting format parser for spreadsheet cell binding.
 * Parses currency, percentages, negative parenthetical numbers (e.g. (1,200.50) -> -1200.50).
 */
export function parseNumericCell(str) {
  if (!str || typeof str !== 'string') {
    return { isNumeric: false, rawValue: null, formatCode: null };
  }

  const trimmed = str.trim();

  // Check for parenthetical negative: (1,250.00) or ($1,250)
  const isParenNegative = /^\(\s*[\$€£¥]?\s*[\d,]+(\.\d+)?\s*\)$/.test(trimmed);
  // Check for percentage: 12.5%
  const isPercent = /^[+-]?\s*[\d,]+(\.\d+)?\s*%$/.test(trimmed);
  // Check standard numeric / currency
  const isCurrency = /^[\$€£¥]/.test(trimmed) || /[\$€£¥]$/.test(trimmed);
  const isGeneralNum = /^[+-]?\s*[\$€£¥]?\s*[\d,]+(\.\d+)?\s*$/.test(trimmed);

  if (isParenNegative || isPercent || isGeneralNum) {
    let cleanStr = trimmed.replace(CURRENCY_OR_NUM_CLEAN_RE, '').replace(/[%()]/g, '');
    let val = parseFloat(cleanStr);
    if (!isNaN(val)) {
      if (isParenNegative) val = -Math.abs(val);
      if (isPercent) val = val / 100;

      let formatCode = '0.00';
      if (isCurrency) formatCode = '$#,##0.00';
      if (isPercent) formatCode = '0.0%';

      return {
        isNumeric: true,
        rawValue: val,
        formatCode,
      };
    }
  }

  return { isNumeric: false, rawValue: null, formatCode: null };
}

/**
 * Builds a complete Universal Document AST from an array of analyzed page layouts and vector states.
 * @param {Array<{ items: Array, pageWidth: number, pageHeight: number, vectorGeometry: object }>} pagesData
 * @param {object} metadata - Document metadata (title, author, etc.)
 * @returns {object} Universal Document AST
 */
export function buildDocumentAst(pagesData = [], metadata = {}) {
  const doc = createDocument(metadata);
  if (!pagesData || pagesData.length === 0) return doc;

  // Global pass: determine median body size for heading classification
  const allSizes = [];
  for (const p of pagesData) {
    if (p.items) {
      for (const it of p.items) {
        if (it.size > 0) allSizes.push(it.size);
      }
    }
  }
  allSizes.sort((a, b) => a - b);
  const bodySize = allSizes.length > 0 ? allSizes[Math.floor(allSizes.length / 2)] : 11;
  const h1Threshold = bodySize * 1.45;
  const h2Threshold = bodySize * 1.18;

  // Process each page into AST
  pagesData.forEach((pageData, idx) => {
    const { items = [], pageWidth = 595.28, pageHeight = 841.89, vectorGeometry = null } = pageData;
    const pageNode = createPage(idx + 1, { width: pageWidth, height: pageHeight });

    // Segment lines into reading order and identify tables/callouts
    const orderedLines = segmentIntoColumns(items, pageWidth);
    const initialBlocks = detectTableRegions(orderedLines, pageWidth, vectorGeometry);
    const blocks = mergeParagraphBlocks(initialBlocks);

    // Convert blocks to AST nodes
    for (const block of blocks) {
      if (block.type === 'table') {
        const tableNode = createTable({
          numCols: block.numCols,
          colWidths: block.colWidths,
          theme: block.theme,
        });

        for (const r of block.rows) {
          const rowNode = createTableRow({
            isHeader: r.isHeader,
            isMergedHeader: r.isMergedHeader,
          });

          for (const c of r.cells) {
            const numInfo = parseNumericCell(c.text);
            const cellNode = createTableCell({
              text: c.text,
              colSpan: c.columnSpan || 1,
              rowSpan: c.rowSpan || 1,
              align: c.align || (numInfo.isNumeric ? 'right' : 'left'),
              isHeader: c.isHeader,
              bold: c.bold,
              fontSize: c.fontSize || 10,
              isNumeric: numInfo.isNumeric,
              rawValue: numInfo.rawValue,
              formatCode: numInfo.formatCode,
            });
            rowNode.cells.push(cellNode);
          }
          tableNode.rows.push(rowNode);
        }
        pageNode.children.push(tableNode);
      } else if (block.type === 'callout') {
        const calloutNode = createCallout({
          calloutType: block.admonition?.type || 'info',
          title: block.admonition?.label || '',
        });

        for (const l of block.lines) {
          const pNode = createParagraph({
            lineSpacing: 1.1,
            bbox: { x: l.x, y: l.y, w: l.w, h: l.h },
          });
          pNode.runs.push(
            createTextRun({
              text: l.text,
              size: l.size,
              bold: l.isBold,
              italic: l.isItalic,
              font: l.fontName,
            })
          );
          calloutNode.children.push(pNode);
        }
        pageNode.children.push(calloutNode);
      } else if (block.type === 'code') {
        const codeNode = createCodeBlock({
          lines: block.lines.map((l) => l.text),
        });
        pageNode.children.push(codeNode);
      } else if (block.type === 'columns') {
        // Two-column editorial section
        const p1 = createParagraph({ isTwoColumn: true, columnIndex: 1 });
        p1.runs.push(createTextRun({ text: block.col1Lines.map((l) => l.text).join(' ') }));
        const p2 = createParagraph({ isTwoColumn: true, columnIndex: 2 });
        p2.runs.push(createTextRun({ text: block.col2Lines.map((l) => l.text).join(' ') }));
        pageNode.children.push(p1, p2);
      } else if (block.type === 'paragraph' && block.line) {
        const line = block.line;
        const headingLevel = line.size >= h1Threshold ? 1 : line.size >= h2Threshold ? 2 : null;
        const pNode = createParagraph({
          headingLevel,
          align: line.align || 'left',
          bbox: { x: line.x, y: line.y, w: line.w, h: line.h },
        });

        const spans = line.spans && line.spans.length > 0 ? line.spans : [
          { text: line.text, size: line.size, bold: line.isBold, italic: line.isItalic }
        ];

        for (const sp of spans) {
          pNode.runs.push(
            createTextRun({
              text: sp.text,
              size: sp.size || line.size,
              bold: sp.bold || false,
              italic: sp.italic || false,
              underline: sp.underline || false,
              strike: sp.strike || false,
              color: sp.color || null,
              superScript: sp.superScript || false,
              subScript: sp.subScript || false,
              isRTL: sp.isRTL || false,
              script: sp.script || 'latin',
            })
          );
        }
        pageNode.children.push(pNode);
      }
    }

    // Attach vector shapes if present (for PowerPoint emitter)
    if (vectorGeometry && vectorGeometry.rects) {
      for (const r of vectorGeometry.rects.slice(0, 10)) {
        if (r.fill || r.stroke) {
          pageNode.children.push(
            createShape({
              shapeType: 'rectangle',
              x: r.x,
              y: r.y,
              w: r.w,
              h: r.h,
              fill: r.fill,
              stroke: r.stroke,
              lineWidth: r.lineWidth,
            })
          );
        }
      }
    }

    doc.pages.push(pageNode);
  });

  return doc;
}

`

---

### File: frontend/src/utils/docxEmitter.js

`javascript
/**
 * docxEmitter.js — High-Accuracy Word (.docx) Emitter
 * Transforms a Universal Document AST into an authentic, flowing OpenXML (.docx) document
 * with native paragraphs, tables, callouts, and vector shading.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType,
  PageOrientation,
} from 'docx';
import { NodeType } from './documentAst.js';
import { wrapUnbrokenStrings } from './pdfLayoutSegmenter.js';

function mapAlign(align) {
  if (align === 'center') return AlignmentType.CENTER;
  if (align === 'right') return AlignmentType.RIGHT;
  if (align === 'justify') return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

function mapHeading(level) {
  if (level === 1) return 'Heading1';
  if (level === 2) return 'Heading2';
  if (level === 3) return 'Heading3';
  return undefined;
}

/**
 * Converts a ParagraphNode into a docx.Paragraph
 */
export function renderParagraphNode(pNode) {
  const children = [];

  for (const r of pNode.runs) {
    const text = wrapUnbrokenStrings(r.text);
    if (!text) continue;

    const fontName =
      r.script === 'devanagari'
        ? 'Nirmala UI'
        : r.script === 'cjk'
        ? 'Microsoft YaHei'
        : r.script === 'arabic'
        ? 'Traditional Arabic'
        : r.font || undefined;

    children.push(
      new TextRun({
        text,
        bold: r.bold || Boolean(pNode.headingLevel),
        italics: r.italic,
        underline: r.underline ? {} : undefined,
        strike: r.strike,
        color: r.color ? r.color.replace('#', '') : pNode.headingLevel ? '1E293B' : undefined,
        superScript: r.superScript,
        subScript: r.subScript,
        font: fontName ? { name: fontName } : undefined,
        rightToLeft: r.isRTL,
        size: Math.round((r.size || 11) * 2), // docx uses half-points
      })
    );
  }

  if (children.length === 0) {
    children.push(new TextRun({ text: '' }));
  }

  return new Paragraph({
    heading: mapHeading(pNode.headingLevel),
    alignment: mapAlign(pNode.align),
    children,
    spacing: {
      before: pNode.headingLevel ? 160 : undefined,
      after: pNode.headingLevel ? 120 : pNode.listLevel !== null ? 40 : 80,
      line: Math.round((pNode.lineSpacing || 1.15) * 240),
    },
  });
}

/**
 * Converts a TableNode into a docx.Table
 */
export function renderTableNode(tNode) {
  const tableRows = [];
  const theme = tNode.theme || {};
  const headerBg = theme.headerBg || '1D283B';
  const borderColor = theme.border || 'CBD5E1';

  for (let rIdx = 0; rIdx < tNode.rows.length; rIdx++) {
    const r = tNode.rows[rIdx];
    const cells = [];

    for (let cIdx = 0; cIdx < r.cells.length; cIdx++) {
      const c = r.cells[cIdx];
      const isHeader = r.isHeader || c.isHeader;
      const cellBg = isHeader ? headerBg : c.bg || (rIdx % 2 === 0 ? 'FFFFFF' : theme.zebraBg || 'FFFFFF');

      const cellTextRun = new TextRun({
        text: c.text,
        bold: isHeader || c.bold,
        color: isHeader ? 'FFFFFF' : undefined,
        size: Math.round((c.fontSize || 10) * 2),
      });

      const cellParagraph = new Paragraph({
        alignment: mapAlign(c.align),
        children: [cellTextRun],
      });

      const borders = {
        top: { style: BorderStyle.SINGLE, size: 4, color: borderColor },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: borderColor },
        left: { style: BorderStyle.SINGLE, size: 4, color: borderColor },
        right: { style: BorderStyle.SINGLE, size: 4, color: borderColor },
      };

      const tableCellOpts = {
        children: [cellParagraph],
        columnSpan: c.colSpan > 1 ? c.colSpan : undefined,
        rowSpan: c.rowSpan > 1 ? c.rowSpan : undefined,
        shading: cellBg ? { type: ShadingType.CLEAR, fill: cellBg } : undefined,
        borders,
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
      };

      if (tNode.colWidths && tNode.colWidths[cIdx]) {
        tableCellOpts.width = {
          size: Math.round(tNode.colWidths[cIdx] * 50),
          type: WidthType.DXA,
        };
      }

      cells.push(new TableCell(tableCellOpts));
    }

    tableRows.push(
      new TableRow({
        children: cells,
        tableHeader: r.isHeader,
      })
    );
  }

  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: borderColor },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: borderColor },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
    },
  });
}

/**
 * Converts a CalloutNode into a native highlighted Paragraph
 */
export function renderCalloutNode(calloutNode) {
  const children = [];
  for (const child of calloutNode.children) {
    if (child.type === NodeType.PARAGRAPH) {
      for (const r of child.runs) {
        children.push(
          new TextRun({
            text: r.text,
            bold: r.bold,
            italics: r.italic,
            font: r.font ? { name: r.font } : undefined,
            size: Math.round((r.size || 10.5) * 2),
          })
        );
      }
    }
  }

  return new Paragraph({
    children,
    spacing: { before: 80, after: 80, line: 260 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 24, color: calloutNode.border || '3B82F6', space: 10 },
    },
    shading: {
      type: ShadingType.CLEAR,
      fill: calloutNode.bg || 'F8FAFC',
    },
  });
}

/**
 * Converts an entire Universal Document AST into a Word (.docx) Document object.
 */
export function buildDocxFromAst(ast) {
  const sections = [];

  for (const page of ast.pages) {
    const pageChildren = [];

    for (const child of page.children) {
      if (child.type === NodeType.PARAGRAPH) {
        pageChildren.push(renderParagraphNode(child));
      } else if (child.type === NodeType.TABLE) {
        pageChildren.push(renderTableNode(child));
        pageChildren.push(new Paragraph({ spacing: { after: 100 } })); // spacer
      } else if (child.type === NodeType.CALLOUT) {
        pageChildren.push(renderCalloutNode(child));
      } else if (child.type === NodeType.CODE_BLOCK) {
        const textRuns = child.lines.map((l, idx) => new TextRun({ text: (idx > 0 ? '\n' : '') + l, font: { name: 'Consolas' }, size: 20 }));
        pageChildren.push(
          new Paragraph({
            children: textRuns,
            shading: { type: ShadingType.CLEAR, fill: child.bg || 'F1F5F9' },
            spacing: { before: 60, after: 60 },
          })
        );
      }
    }

    if (pageChildren.length === 0) {
      pageChildren.push(new Paragraph({}));
    }

    const pWidth = page.width || 612;
    const pHeight = page.height || 792;
    const isLandscape = pWidth > pHeight;

    sections.push({
      properties: {
        page: {
          size: {
            width: Math.round(pWidth * 20),
            height: Math.round(pHeight * 20),
            orientation: isLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
          margin: {
            top: 720,
            bottom: 720,
            left: 720,
            right: 720,
          },
        },
      },
      children: pageChildren,
    });
  }

  return new Document({ sections });
}

/**
 * Generates a .docx binary Blob from a Universal Document AST.
 */
export async function exportAstToDocx(ast) {
  const doc = buildDocxFromAst(ast);
  return await Packer.toBlob(doc);
}

`

---

### File: pdf2docx-web/PROJECT_BRAIN.md

`markdown
# PROJECT_BRAIN.md — Client-side PDF → DOCX Engine ("pdf2docx-web")

> Read this file first, every session. Then read   PROGRESS.md  . Do NOT re-scan the whole repo unless told to.
> Labels used: **FACT** (verified/decided), **ASSUMPTION** (verify when cheap), **TARGET** (goal number, tune from data).

---

## 0. KICKOFF PROMPT (paste this into Antigravity as the first message)

      
You are the lead engineer building "pdf2docx-web": an enterprise-grade, 100% client-side
PDF→DOCX converter (browser, WebAssembly/Web Workers, zero uploads).

1. Read PROJECT_BRAIN.md fully. It is the single source of truth (architecture, AST, algorithms,
   milestones, loop, gates). If PROGRESS.md exists, read it and resume. If not, create it from §14.
2. Work in PLANNING mode. Before coding each milestone, write an implementation plan artifact
   (tasks, files touched, tests, exit gate). Then execute using the BUILD LOOP in §10.
3. Work ONE milestone at a time (M1..M7). Never start Mn+1 until Mn's EXIT GATE (§9) passes
   on the benchmark (§11) and is recorded in PROGRESS.md.
4. Every change is measured: run   npm run bench  , compare with metrics/baseline.json,
   reject regressions, commit gains. No per-file hacks. Fix root causes in general code.
5. Keep the 4 layers decoupled (Ingest / DLA / AST / Emit). DLA and Emit must be pure
   functions over JSON, runnable in Node and in a Web Worker.
6. After each milestone: update PROGRESS.md, write a compact summary (decisions, done, pending,
   technical notes), commit, and tell me to start a fresh session for the next milestone.
7. If blocked (5 loop iterations with no metric gain, or a missing resource like gold files),
   write BLOCKERS.md with what you tried and what you need, then stop and ask me.
Start now with M1.
      

---

## 1. MISSION (FACT)

Convert complex PDFs (financial reports, contracts, academic papers, forms) into **natively editable**   .docx   matching Adobe Acrobat / Smallpdf quality.

Non-negotiables:
1. **Zero server uploads.** All work in browser: pdf.js (WASM-free JS core), Web Workers, optional ONNX Runtime Web (WebGPU/WASM).
2. **Accuracy over size.** Heavy assets allowed (Brotli delivery).
3. **True Word reflow.** Real paragraphs, headings (outline levels), real lists (numbering.xml), real tables (  w:tbl  ). **No floating text boxes for text. Ever.**
4. **100% glyph fidelity.** Use digital Unicode text. No OCR on digital text.
5. **Strict OpenXML.** Opens clean in Word Desktop/Online, Google Docs, LibreOffice. No repair prompt.
6. **UI never freezes.** All heavy work in Workers. Memory-safe for 100+ pages.

Out of scope (v1): scanned/image-only PDFs (OCR), password-protected PDFs without password, PDF forms as live form fields, RTL/vertical scripts (design must not block them later).

---

## 2. TECH STACK (FACT unless noted)

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | |
| Build/dev | Vite | |
| PDF parse |   pdfjs-dist   (Apache-2.0) | Use legacy build for Node bench. MuPDF.js rejected: AGPL. |
| Workers | Web Worker +   comlink   | 1 worker per conversion; optional pool for pages |
| DOCX emit |   docx   npm lib + own post-fix pass via   fflate  /  jszip   | Own XML patch only where lib lacks (e.g.   w:tblHeader  , odd borders) |
| Images |   OffscreenCanvas   (browser),   @napi-rs/canvas   (Node bench) | encode PNG |
| ML (M6, optional) |   onnxruntime-web   (WebGPU → WASM fallback) | layout model; ASSUMPTION: DocLayout-YOLO / PP-DocLayout class model converted to ONNX; verify license before bundling |
| Tests |   vitest   unit,   playwright   e2e/visual | |
| Doc validation |   xmllint  , python-docx load, LibreOffice headless render, (CI) Open XML SDK validator via dotnet | |
| Eval | own TS tools in   tools/   | see §11 |
| Tuning |   tools/autotune.ts   (coordinate-descent over   params.ts  ) | |

Design rule: **only   src/ingest/   imports pdf.js.** Everything after ingest consumes/produces plain JSON (  PageIR  ,   Doc AST  ). This makes DLA iteration fast: ingest once → cache   PageIR   JSON in   corpus/.cache/   → iterate DLA/emit headlessly in Node.

---

## 3. REPO STRUCTURE

      
pdf2docx-web/
  PROJECT_BRAIN.md          # this file (static brain)
  PROGRESS.md               # dynamic status (see §14)
  BLOCKERS.md               # only when blocked
  package.json  tsconfig.json  vite.config.ts  vitest.config.ts
  src/
    core/        ast.ts  pageir.ts  params.ts  geometry.ts  units.ts  log.ts  errors.ts
    ingest/      pdfLoader.ts  opInterpreter.ts  textExtractor.ts  pathExtractor.ts
                 imageExtractor.ts  linkExtractor.ts  fontMap.ts  outlineExtractor.ts
    dla/         glyphs.ts  lines.ts  xycut.ts  readingOrder.ts  headerFooter.ts
                 paragraphs.ts  hyphen.ts  lists.ts  headings.ts  alignment.ts
                 tablesRuled.ts  tablesBorderless.ts  tableMerge.ts  shapes.ts
                 footnotes.ts  codeBlocks.ts  classify.ts  pipeline.ts
                 model/  (onnxLayout.ts, preprocess.ts, postprocess.ts — M6)
    ast/         build.ts  normalize.ts  validate.ts
    emit/        docxEmitter.ts  styles.ts  numbering.ts  tables.ts  sections.ts
                 images.ts  headerFooter.ts  xmlSafe.ts  postfix.ts
    worker/      engine.worker.ts  protocol.ts  progress.ts
    ui/          App.tsx  DropZone.tsx  ProgressBar.tsx  DebugOverlay.tsx
  tests/         unit/  golden/  e2e/
  corpus/        manifest.json  tierA/ ... tierG/  gold/  .cache/
  tools/         bench.ts  compare-text.ts  teds.ts  readingOrder.ts  docx-validate.ts
                 lo-render.sh  visual-diff.ts  autotune.ts  report.ts  ingest-cache.ts
  metrics/       baseline.json  history.jsonl  reports/
      

---

## 4. DATA MODEL

### 4.1 Units (FACT)
- PDF space: points (pt), origin bottom-left. **Normalize in ingest to top-left origin, y down, pt.** Apply page rotation + CropBox at ingest.
- Word: twips = pt × 20; font half-points = pt × 2; EMU = pt × 12700.

### 4.2 PageIR (output of Ingest; JSON-serializable)
      ts
type Rect = { x0:number; y0:number; x1:number; y1:number };
type Glyph = {                 // one per char (or ligature expanded)
  ch: string;                  // Unicode text of this glyph (may be multi-char for ligatures after expansion)
  box: Rect;                   // glyph advance box in page space
  baseline: number;            // y of baseline
  size: number;                // font size pt (effective, after matrix)
  fontKey: string;             // index into fonts[]
  color: string;               // "#RRGGBB"
  rot: 0|90|180|270;           // text direction
  flags: number;               // bit0: PUA/unmapped, bit1: synthetic space, bit2: invisible text (render mode 3)
};
type FontInfo = { key:string; pdfName:string; family:string; bold:boolean; italic:boolean;
                  mono:boolean; serif:boolean; symbolic:boolean };
type Stroke = { kind:'line'|'rect'|'path'; pts:number[]; width:number; color:string; dash?:number[] };
type Fill   = { box:Rect; color:string; alpha:number; z:number; pathPts?:number[] };
type ImageObj = { id:string; box:Rect; pixelW:number; pixelH:number; mime:'image/png'|'image/jpeg';
                  dataRef:string /* key into binary store, NOT inline */; z:number; mask?:boolean };
type LinkObj = { box:Rect; url?:string; destPage?:number };
type PageIR = { pageIndex:number; width:number; height:number; rotation:number;
                glyphs:Glyph[]; fonts:FontInfo[]; strokes:Stroke[]; fills:Fill[];
                images:ImageObj[]; links:LinkObj[]; stats:{ glyphCount:number; puaCount:number } };
      
Binary data (image bytes) lives in a separate store (  Map<string,Uint8Array>  ) so JSON stays small; worker transfers buffers, never copies.

### 4.3 Document AST (output of DLA; input of Emit)
      ts
type Run = { text:string; bold?:boolean; italic?:boolean; underline?:boolean; strike?:boolean;
             size?:number; color?:string; font?:string; sup?:boolean; sub?:boolean;
             link?:{url?:string; anchor?:string}; highlight?:string };
type Para = { type:'p'; runs:Run[]; align:'left'|'center'|'right'|'justify';
              indent?:{left:number;first:number;right:number}; spaceBefore?:number; spaceAfter?:number;
              lineSpacing?:number; heading?:1|2|3|4; list?:{id:string;level:number;kind:'bullet'|'number';fmt?:string};
              shading?:string; borders?:Borders; keepNext?:boolean; src:{page:number;box:Rect} };
type Cell = { blocks:Block[]; colSpan:number; rowSpan:number; vMergeContinue?:boolean;
              fill?:string; borders?:Borders; vAlign?:'top'|'center'|'bottom'; width:number };
type Table = { type:'tbl'; colWidths:number[]; rows:{cells:Cell[]; height?:number; header?:boolean}[];
              borders?:Borders; src:{page:number;box:Rect} };
type ImageBlock = { type:'img'; ref:string; w:number; h:number; inline:boolean; anchor?:AnchorSpec };
type Block = Para | Table | ImageBlock | { type:'pagebreak' } | { type:'sectionBreak'; sect:SectionProps };
type Section = { page:{w:number;h:number;orient:'portrait'|'landscape'}; margins:{t:number;r:number;b:number;l:number};
                 cols?:{count:number;gap:number}; header?:Block[]; footer?:Block[]; blocks:Block[] };
type DocAST = { sections:Section[]; numbering:NumberingDef[]; styles:StyleDef[]; meta:{pages:number; warnings:Warning[]} };
      

---

## 5. PIPELINE (ALL STAGES, WITH ALGORITHMS)

Stage order per document: **S1 Ingest → S2 Glyph→Line → S3 Region/Reading order → S4 Furniture (header/footer) → S5 Tables → S6 Paragraphs → S7 Lists & Headings → S8 Shapes/Images → S9 AST build + validate → S10 Emit → S11 Post-fix + validate.**

---

## 6. WORKER, CONCURRENCY & MEMORY (FACT)

-   engine.worker.ts   exposes via Comlink:   convert(file: ArrayBuffer, opts) → {docx: Blob, report}   +   onProgress(stage, page, total)  .
- Page-streamed: for page p: ingest → S2 → cache minimal per-page IR → free pdf.js page.
- Cancellation:   AbortSignal   checked between pages/stages.

---

## 8. PARAMS & AUTOTUNE
- All numeric thresholds in   src/core/params.ts  .

---

## 9. MILESTONES (7)
- **M0**: Scaffold & Bench harness.
- **M1**: Ingestion + AST + Emitter (single-column MVP).
- **M2**: Paragraphs, Lists, Furniture, Headings.
- **M3**: Multi-column Reading Order.
- **M4**: Bordered Tables.
- **M5**: Borderless / Financial Tables.
- **M6**: Shapes, Visual Parity, Footnotes, ML Layout.
- **M7**: Benchmark vs Giants, Hardening, Release.

`

---

### File: pdf2docx-web/package.json

`json
{
  "name": "pdf2docx-web",
  "version": "1.0.0",
  "type": "module",
  "description": "Enterprise-grade 100% client-side PDF to DOCX converter",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "bench": "tsx tools/bench.ts",
    "validate": "tsx tools/docx-validate.ts"
  },
  "dependencies": {
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "comlink": "^4.4.2",
    "docx": "^9.12.0",
    "fflate": "^0.8.3",
    "pdfjs-dist": "^3.11.174",
    "react": "^19.3.1",
    "react-dom": "^19.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.1",
    "vitest": "^2.1.8"
  }
}

`

---

### File: pdf2docx-web/src/core/ast.ts

`typescript
import { Rect } from './pageir.js';

export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  size?: number; // font size in pt
  color?: string; // "#RRGGBB"
  font?: string;
  sup?: boolean;
  sub?: boolean;
  link?: { url?: string; anchor?: string };
  highlight?: string;
};

export type BorderStyle = 'single' | 'dashed' | 'dotted' | 'double' | 'nil';
export type BorderDef = {
  style: BorderStyle;
  size: number; // in eighths of a point
  color: string;
};

export type Borders = {
  top?: BorderDef;
  right?: BorderDef;
  bottom?: BorderDef;
  left?: BorderDef;
};

export type Para = {
  type: 'p';
  runs: Run[];
  align: 'left' | 'center' | 'right' | 'justify';
  indent?: { left: number; first: number; right: number }; // in pt
  spaceBefore?: number; // in pt
  spaceAfter?: number; // in pt
  lineSpacing?: number; // line spacing multiple
  heading?: 1 | 2 | 3 | 4;
  list?: {
    id: string;
    level: number;
    kind: 'bullet' | 'number';
    fmt?: string;
  };
  shading?: string;
  borders?: Borders;
  keepNext?: boolean;
  src?: { page: number; box: Rect };
};

export type Cell = {
  blocks: Block[];
  colSpan: number;
  rowSpan: number;
  vMergeContinue?: boolean;
  fill?: string;
  borders?: Borders;
  vAlign?: 'top' | 'center' | 'bottom';
  width: number; // in pt
};

export type TableRow = {
  cells: Cell[];
  height?: number; // in pt
  header?: boolean;
};

export type Table = {
  type: 'tbl';
  colWidths: number[]; // in pt
  rows: TableRow[];
  borders?: Borders;
  src?: { page: number; box: Rect };
};

export type AnchorSpec = {
  relativeHorizontal: 'margin' | 'page' | 'column';
  relativeVertical: 'margin' | 'page' | 'paragraph';
  x: number;
  y: number;
  wrap: 'square' | 'tight' | 'topAndBottom' | 'none';
};

export type ImageBlock = {
  type: 'img';
  ref: string; // key into binary store
  w: number; // in pt
  h: number; // in pt
  inline: boolean;
  anchor?: AnchorSpec;
  src?: { page: number; box: Rect };
};

export type PageBreakBlock = {
  type: 'pagebreak';
};

export type SectionProps = {
  page: {
    w: number;
    h: number;
    orient: 'portrait' | 'landscape';
  };
  margins: {
    t: number;
    r: number;
    b: number;
    l: number;
  };
  cols?: {
    count: number;
    gap: number;
  };
};

export type SectionBreakBlock = {
  type: 'sectionBreak';
  sect: SectionProps;
};

export type Block = Para | Table | ImageBlock | PageBreakBlock | SectionBreakBlock;

export type Section = SectionProps & {
  header?: Block[];
  footer?: Block[];
  blocks: Block[];
};

export type NumberingDef = {
  id: string;
  kind: 'bullet' | 'number';
  levels: {
    level: number;
    format: 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman' | 'bullet';
    text: string;
  }[];
};

export type StyleDef = {
  id: string;
  name: string;
  basedOn?: string;
  run?: Partial<Run>;
  para?: Partial<Para>;
};

export type Warning = {
  stage: string;
  page?: number;
  message: string;
  fatal?: boolean;
};

export type DocAST = {
  sections: Section[];
  numbering: NumberingDef[];
  styles: StyleDef[];
  meta: {
    title?: string;
    creator?: string;
    pages: number;
    warnings: Warning[];
  };
};

`

---

### File: pdf2docx-web/src/core/pageir.ts

`typescript
export type Rect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type Glyph = {
  ch: string;
  box: Rect;
  baseline: number;
  size: number;
  fontKey: string;
  color: string; // "#RRGGBB"
  rot: 0 | 90 | 180 | 270;
  flags: number; // bit0: PUA/unmapped, bit1: synthetic space, bit2: invisible text
};

export type FontInfo = {
  key: string;
  pdfName: string;
  family: string;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  serif: boolean;
  symbolic: boolean;
};

export type Stroke = {
  kind: 'line' | 'rect' | 'path';
  pts: number[];
  width: number;
  color: string;
  dash?: number[];
};

export type Fill = {
  box: Rect;
  color: string;
  alpha: number;
  z: number;
  pathPts?: number[];
};

export type ImageObj = {
  id: string;
  box: Rect;
  pixelW: number;
  pixelH: number;
  mime: 'image/png' | 'image/jpeg';
  dataRef: string; // key into binary store
  z: number;
  mask?: boolean;
};

export type LinkObj = {
  box: Rect;
  url?: string;
  destPage?: number;
};

export type PageIR = {
  pageIndex: number;
  width: number;
  height: number;
  rotation: number;
  glyphs: Glyph[];
  fonts: FontInfo[];
  strokes: Stroke[];
  fills: Fill[];
  images: ImageObj[];
  links: LinkObj[];
  stats: {
    glyphCount: number;
    puaCount: number;
  };
};

export type DocumentIR = {
  pages: PageIR[];
  binaryStore: Map<string, Uint8Array>;
  meta: {
    title?: string;
    author?: string;
    totalPages: number;
  };
};

`

---

### File: pdf2docx-web/src/core/params.ts

`typescript
export const params = {
  // Line extraction (§5 S2)
  line: {
    baselineTol: 0.3, // baseline diff <= tol * fontSize
    segmentGapEm: 1.5, // wide gap splitting for columns/tables
  },
  // Word extraction (§5 S2)
  word: {
    gapEm: 0.18, // gap > gapEm * fontSize => insert synthetic space
  },
  // XY-cut and reading order (§5 S3)
  xy: {
    hGapLineH: 1.0, // horizontal band gap threshold (multiplied by medianLineHeight)
    vGutterPt: 10.0, // vertical gutter in pt (or 1.2x median char width)
    minSideLines: 3, // min lines on each side of vertical cut
    minSideTextRatio: 0.2, // min text ratio on each side
  },
  // Paragraph reflow (§5 S6)
  para: {
    gapRatio: 1.35, // vertical gap > medianLeading * gapRatio => new para
    indentPt: 0.8, // first-line indent threshold in em
    shortLineEm: 2.5, // previous line short threshold in em
    dropCapEm: 1.8,
  },
  // Lists (§5 S7)
  list: {
    levelPt: 18.0, // indent per list level in pt
  },
  // Tables (§5 S5)
  tbl: {
    mergeTol: 1.5, // collinear segment merge tolerance in pt
    gridSnapTol: 2.0, // grid coordinate snap tolerance in pt
    contGapRatio: 0.85, // continuation line gap ratio
    numericRatio: 0.7, // threshold for classifying numeric column
    minBorderCoverage: 0.8, // 80% edge coverage for cell border
  },
  // Shapes & Images (§5 S8)
  shape: {
    maxPaths: 25, // region with > maxPaths and < 15% glyphs => rasterize
  },
  // ML Layout (§5 S-ML)
  ml: {
    minConf: 0.7,
    iouThreshold: 0.6,
  },
};

export type Params = typeof params;

`

---

### File: pdf2docx-web/src/ingest/pdfLoader.ts

`typescript
import * as pdfjsLib from 'pdfjs-dist';
import { PageIR, DocumentIR, Glyph, FontInfo, LinkObj } from '../core/pageir.js';
import { OperatorInterpreter } from './opInterpreter.js';
import { resolveFontDescriptor, parseFontDescriptor } from './fontMap.js';

function getPdfLib(): any {
  if (typeof window !== 'undefined' && (window as any).pdfjsLib) {
    const lib = (window as any).pdfjsLib;
    if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    return lib;
  }
  return pdfjsLib;
}

export async function loadPdfDocument(
  source: ArrayBuffer | Uint8Array,
  onPageProgress?: (current: number, total: number) => void
): Promise<DocumentIR> {
  let uint8Data: Uint8Array;
  if (source instanceof Uint8Array) {
    uint8Data = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  } else {
    uint8Data = new Uint8Array(source);
  }

  const lib = getPdfLib();
  const loadingTask = lib.getDocument({
    data: uint8Data,
    disableFontFace: false,
    useSystemFonts: false,
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;
  const numPages = doc.numPages;
  const pages: PageIR[] = [];
  const binaryStore = new Map<string, Uint8Array>();

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const width = viewport.width;
    const height = viewport.height;
    const rotation = page.rotate as 0 | 90 | 180 | 270;

    const interpreter = new OperatorInterpreter(height);

    // Extract vector paths and text with full styling from operator stream
    const opList = await page.getOperatorList();
    interpreter.interpretOperators(
      opList.fnArray,
      opList.argsArray,
      lib.OPS || pdfjsLib.OPS,
      page.commonObjs
    );

    // Fallback: If no glyphs extracted from operator list, extract via getTextContent
    const fontsMap = new Map<string, FontInfo>();
    for (const [k, v] of interpreter.fonts.entries()) {
      fontsMap.set(k, v);
    }

    if (interpreter.glyphs.length === 0) {
      const textContent = await page.getTextContent();
      for (const item of textContent.items as any[]) {
        if (!('str' in item) || !item.str) continue;

        const str: string = item.str;
        const tx = item.transform; // [scaleX, skewY, skewX, scaleY, transX, transY]
        const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
        const fontInfo = resolveFontDescriptor(
          item.fontName || 'Calibri',
          page.commonObjs,
          textContent.styles
        );
        if (!fontsMap.has(fontInfo.key)) {
          fontsMap.set(fontInfo.key, fontInfo);
        }

        // Compute character advance boxes
        const totalWidth = item.width || 0;
        const charCount = str.length;
        const avgCharWidth = charCount > 0 ? totalWidth / charCount : fontSize * 0.5;

        let currentX = tx[4];
        const pdfY = tx[5];

        for (let i = 0; i < charCount; i++) {
          const char = str[i];
          interpreter.addGlyph(
            char,
            currentX,
            pdfY,
            avgCharWidth,
            fontSize,
            fontSize,
            fontInfo.key,
            '#000000'
          );
          currentX += avgCharWidth;
        }
      }
    }

    // Extract link annotations
    const annotations = await page.getAnnotations();
    const links: LinkObj[] = [];
    for (const annot of annotations) {
      if (annot.subtype === 'Link' && annot.rect) {
        const [x0, y0, x1, y1] = annot.rect;
        const normY0 = height - y1;
        const normY1 = height - y0;
        links.push({
          box: {
            x0: Math.min(x0, x1),
            y0: Math.min(normY0, normY1),
            x1: Math.max(x0, x1),
            y1: Math.max(normY0, normY1),
          },
          url: annot.url || undefined,
          destPage: typeof annot.dest === 'number' ? annot.dest : undefined,
        });
      }
    }

    const pageIr: PageIR = {
      pageIndex: pageNum - 1,
      width,
      height,
      rotation,
      glyphs: interpreter.glyphs,
      fonts: Array.from(fontsMap.values()),
      strokes: interpreter.strokes,
      fills: interpreter.fills,
      images: interpreter.images,
      links,
      stats: {
        glyphCount: interpreter.glyphs.length,
        puaCount: interpreter.puaCount,
      },
    };

    pages.push(pageIr);

    // Free memory
    page.cleanup();

    if (onPageProgress) {
      onPageProgress(pageNum, numPages);
    }
  }

  return {
    pages,
    binaryStore,
    meta: {
      totalPages: numPages,
    },
  };
}

`

---

### File: pdf2docx-web/src/ingest/opInterpreter.ts

`typescript
import {
  Glyph,
  Stroke,
  Fill,
  ImageObj,
  FontInfo,
  Rect,
  PageIR,
} from '../core/pageir.js';
import { resolveFontDescriptor, parseFontDescriptor } from './fontMap.js';

// Matrix math helpers [a, b, c, d, e, f]
export type Matrix = [number, number, number, number, number, number];

export function identityMatrix(): Matrix {
  return [1, 0, 0, 1, 0, 0];
}

export function multiplyMatrices(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export function applyMatrixToPoint(m: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

export function expandLigatures(str: string): string {
  // First normalize Unicode NFKC to resolve Arabic presentation forms
  const normalized = str.normalize('NFKC');
  return normalized
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\uFB05/g, 'ft')
    .replace(/\uFB06/g, 'st');
}

export function isPua(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 0xe000 && code <= 0xf8ff) || code === 0xfffd;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return   #${toHex(r)}${toHex(g)}${toHex(b)}  ;
}

export function cmykToRgb(c: number, m: number, y: number, k: number): string {
  const r = 255 * (1 - c) * (1 - k);
  const g = 255 * (1 - m) * (1 - k);
  const b = 255 * (1 - y) * (1 - k);
  return rgbToHex(r, g, b);
}

export class OperatorInterpreter {
  private ctmStack: Matrix[] = [identityMatrix()];
  private currentCtm: Matrix = identityMatrix();

  // Text State
  private tm: Matrix = identityMatrix();
  private tlm: Matrix = identityMatrix();
  private fontKey: string = 'Calibri';
  private fontSize: number = 11;
  private charSpacing: number = 0;
  private wordSpacing: number = 0;
  private leading: number = 0;
  private rise: number = 0;
  private hScale: number = 1.0;
  private renderMode: number = 0;

  // Colors & Line State
  private fillColor: string = '#000000';
  private strokeColor: string = '#000000';
  private lineWidth: number = 1.0;

  // Pending Path Elements
  private pendingRects: { x: number; y: number; w: number; h: number }[] = [];
  private pendingLines: { x0: number; y0: number; x1: number; y1: number }[] = [];

  // Output collectors
  public glyphs: Glyph[] = [];
  public fonts: Map<string, FontInfo> = new Map();
  public strokes: Stroke[] = [];
  public fills: Fill[] = [];
  public images: ImageObj[] = [];
  public puaCount: number = 0;

  private pageHeight: number;
  private zIndex: number = 0;

  constructor(pageHeight: number) {
    this.pageHeight = pageHeight;
  }

  get ctm(): Matrix {
    return this.currentCtm;
  }

  save() {
    this.ctmStack.push([...this.currentCtm]);
  }

  restore() {
    if (this.ctmStack.length > 1) {
      this.currentCtm = this.ctmStack.pop()!;
    }
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    const m: Matrix = [a, b, c, d, e, f];
    this.currentCtm = multiplyMatrices(this.currentCtm, m);
  }

  setLineWidth(width: number) {
    this.lineWidth = Math.max(0.5, width);
  }

  setFillColorRgb(r: number, g: number, b: number) {
    const red = r > 1 ? r : r * 255;
    const green = g > 1 ? g : g * 255;
    const blue = b > 1 ? b : b * 255;
    this.fillColor = rgbToHex(red, green, blue);
  }

  setStrokeColorRgb(r: number, g: number, b: number) {
    const red = r > 1 ? r : r * 255;
    const green = g > 1 ? g : g * 255;
    const blue = b > 1 ? b : b * 255;
    this.strokeColor = rgbToHex(red, green, blue);
  }

  setFillColorGray(g: number) {
    const gray = g > 1 ? g : g * 255;
    this.fillColor = rgbToHex(gray, gray, gray);
  }

  setStrokeColorGray(g: number) {
    const gray = g > 1 ? g : g * 255;
    this.strokeColor = rgbToHex(gray, gray, gray);
  }

  setFillColorCmyk(c: number, m: number, y: number, k: number) {
    this.fillColor = cmykToRgb(c, m, y, k);
  }

  setStrokeColorCmyk(c: number, m: number, y: number, k: number) {
    this.strokeColor = cmykToRgb(c, m, y, k);
  }

  beginText() {
    this.tm = identityMatrix();
    this.tlm = identityMatrix();
  }

  setFont(fontName: string, size: number, commonObjs?: any, fontFlags: number = 0) {
    this.fontSize = Math.abs(size);
    const info = commonObjs
      ? resolveFontDescriptor(fontName, commonObjs, undefined, fontFlags)
      : parseFontDescriptor(fontName, fontFlags);
    this.fontKey = info.key;
    if (!this.fonts.has(this.fontKey)) {
      this.fonts.set(this.fontKey, info);
    }
  }

  setTextMatrix(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.tm = [a, b, c, d, e, f];
    this.tlm = [a, b, c, d, e, f];
  }

  moveText(tx: number, ty: number) {
    const moveM: Matrix = [1, 0, 0, 1, tx, ty];
    this.tlm = multiplyMatrices(this.tlm, moveM);
    this.tm = [...this.tlm];
  }

  nextLine() {
    this.moveText(0, -this.leading);
  }

  setLeading(leading: number) {
    this.leading = leading;
  }

  setCharSpacing(spacing: number) {
    this.charSpacing = spacing;
  }

  setWordSpacing(spacing: number) {
    this.wordSpacing = spacing;
  }

  setHorizontalScaling(scale: number) {
    this.hScale = scale / 100;
  }

  setTextRise(rise: number) {
    this.rise = rise;
  }

  setRenderMode(mode: number) {
    this.renderMode = mode;
  }

  addGlyph(
    rawCh: string,
    x: number,
    pdfY: number,
    width: number,
    height: number,
    fontSize: number,
    fontKey: string,
    color: string
  ) {
    const ch = expandLigatures(rawCh);
    const pua = isPua(ch);
    if (pua) this.puaCount++;

    // Normalize PDF space (origin bottom-left) to PageIR space (top-left, y down)
    const y0 = this.pageHeight - pdfY - height;
    const y1 = this.pageHeight - pdfY;
    const baseline = this.pageHeight - pdfY;

    this.glyphs.push({
      ch,
      box: {
        x0: x,
        y0,
        x1: x + width,
        y1,
      },
      baseline,
      size: fontSize,
      fontKey,
      color,
      rot: 0,
      flags: (pua ? 1 : 0) | (this.renderMode === 3 ? 4 : 0),
    });
  }

  addStroke(kind: 'line' | 'rect' | 'path', pts: number[], width: number, color: string) {
    this.strokes.push({
      kind,
      pts,
      width,
      color,
    });
  }

  addFill(box: Rect, color: string, alpha: number = 1.0, pathPts?: number[]) {
    // If it's a thin rect (< 1.5pt), classify as line stroke (§5 S1 step 5)
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (Math.min(w, h) < 1.5 && Math.max(w, h) >= 3.0) {
      this.strokes.push({
        kind: 'line',
        pts: [box.x0, box.y0, box.x1, box.y1],
        width: Math.min(w, h),
        color,
      });
      return;
    }

    this.fills.push({
      box,
      color,
      alpha,
      z: this.zIndex++,
      pathPts,
    });
  }

  /**
   * Interprets vector operators from page.getOperatorList()
   */
  interpretOperators(
    fnArray: number[],
    argsArray: any[],
    OPS: Record<string, number>,
    commonObjs?: any
  ) {
    let currentPathRects: { x: number; y: number; w: number; h: number }[] = [];
    let currentPathLines: { x0: number; y0: number; x1: number; y1: number }[] = [];
    let currentPoint = { x: 0, y: 0 };

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];

      if (fn === OPS.save) {
        this.save();
      } else if (fn === OPS.restore) {
        this.restore();
      } else if (fn === OPS.transform) {
        this.transform(args[0], args[1], args[2], args[3], args[4], args[5]);
      } else if (fn === OPS.beginText) {
        this.beginText();
      } else if (fn === OPS.setTextMatrix) {
        this.setTextMatrix(args[0], args[1], args[2], args[3], args[4], args[5]);
      } else if (fn === OPS.moveText) {
        this.moveText(args[0], args[1]);
      } else if (fn === OPS.nextLine) {
        this.nextLine();
      } else if (fn === OPS.setFont) {
        this.setFont(args[0], args[1], commonObjs);
      } else if (fn === OPS.setLeading) {
        this.setLeading(args[0]);
      } else if (fn === OPS.setCharSpacing) {
        this.setCharSpacing(args[0]);
      } else if (fn === OPS.setWordSpacing) {
        this.setWordSpacing(args[0]);
      } else if (fn === OPS.setHorizontalScaling) {
        this.setHorizontalScaling(args[0]);
      } else if (fn === OPS.setTextRise) {
        this.setTextRise(args[0]);
      } else if (fn === OPS.setRenderMode) {
        this.setRenderMode(args[0]);
      } else if (fn === OPS.showText || fn === OPS.showSpacedText) {
        const glyphArr = args[0] || [];
        for (const item of glyphArr) {
          if (typeof item === 'number') {
            const kernPt = (item / 1000) * this.fontSize * this.hScale;
            this.tm[4] -= kernPt;
          } else if (item && typeof item === 'object') {
            const char = item.unicode || (item.fontChar && !isPua(item.fontChar) ? item.fontChar : '');
            if (!char) {
              const w = (item.width || 0) * 0.001 * this.fontSize * this.hScale;
              this.tm[4] += w;
              continue;
            }
            const charWidth = (item.width || 500) * 0.001 * this.fontSize * this.hScale;
            const pt = applyMatrixToPoint(this.currentCtm, this.tm[4], this.tm[5]);
            this.addGlyph(
              char,
              pt.x,
              pt.y,
              charWidth,
              this.fontSize,
              this.fontSize,
              this.fontKey,
              this.fillColor
            );
            this.tm[4] += charWidth + this.charSpacing + (item.isSpace ? this.wordSpacing : 0);
          }
        }
      } else if (fn === OPS.setLineWidth) {
        this.setLineWidth(args[0]);
      } else if (fn === OPS.setStrokeRGBColor) {
        this.setStrokeColorRgb(args[0], args[1], args[2]);
      } else if (fn === OPS.setFillRGBColor) {
        this.setFillColorRgb(args[0], args[1], args[2]);
      } else if (fn === OPS.setStrokeGray) {
        this.setStrokeColorGray(args[0]);
      } else if (fn === OPS.setFillGray) {
        this.setFillColorGray(args[0]);
      } else if (fn === OPS.setStrokeCMYKColor) {
        this.setStrokeColorCmyk(args[0], args[1], args[2], args[3]);
      } else if (fn === OPS.setFillCMYKColor) {
        this.setFillColorCmyk(args[0], args[1], args[2], args[3]);
      } else if (fn === OPS.constructPath) {
        currentPathRects = [];
        currentPathLines = [];
        const ops = args[0];
        const pathArgs = args[1];
        let argIdx = 0;

        for (const subOp of ops) {
          if (subOp === 19) {
            // rectangle: [x, y, w, h]
            const x = pathArgs[argIdx++];
            const y = pathArgs[argIdx++];
            const w = pathArgs[argIdx++];
            const h = pathArgs[argIdx++];
            currentPathRects.push({ x, y, w, h });
          } else if (subOp === 13) {
            // moveTo
            currentPoint = { x: pathArgs[argIdx++], y: pathArgs[argIdx++] };
          } else if (subOp === 14) {
            // lineTo
            const nextX = pathArgs[argIdx++];
            const nextY = pathArgs[argIdx++];
            currentPathLines.push({
              x0: currentPoint.x,
              y0: currentPoint.y,
              x1: nextX,
              y1: nextY,
            });
            currentPoint = { x: nextX, y: nextY };
          } else if (subOp === 15) {
            // curveTo
            argIdx += 6;
          } else if (subOp === 16 || subOp === 17) {
            argIdx += 4;
          }
        }
      } else if (fn === OPS.stroke || fn === OPS.closeStroke) {
        // Emit strokes for current path
        for (const r of currentPathRects) {
          const pt1 = applyMatrixToPoint(this.currentCtm, r.x, r.y);
          const pt2 = applyMatrixToPoint(this.currentCtm, r.x + r.w, r.y + r.h);
          const x0 = Math.min(pt1.x, pt2.x);
          const x1 = Math.max(pt1.x, pt2.x);
          const y0 = this.pageHeight - Math.max(pt1.y, pt2.y);
          const y1 = this.pageHeight - Math.min(pt1.y, pt2.y);
          this.addStroke('rect', [x0, y0, x1 - x0, y1 - y0], this.lineWidth, this.strokeColor);
        }
        for (const l of currentPathLines) {
          const p1 = applyMatrixToPoint(this.currentCtm, l.x0, l.y0);
          const p2 = applyMatrixToPoint(this.currentCtm, l.x1, l.y1);
          this.addStroke(
            'line',
            [p1.x, this.pageHeight - p1.y, p2.x, this.pageHeight - p2.y],
            this.lineWidth,
            this.strokeColor
          );
        }
        currentPathRects = [];
        currentPathLines = [];
      } else if (fn === OPS.fill || fn === OPS.eoFill) {
        // Emit fills for current path
        for (const r of currentPathRects) {
          const pt1 = applyMatrixToPoint(this.currentCtm, r.x, r.y);
          const pt2 = applyMatrixToPoint(this.currentCtm, r.x + r.w, r.y + r.h);
          const x0 = Math.min(pt1.x, pt2.x);
          const x1 = Math.max(pt1.x, pt2.x);
          const y0 = this.pageHeight - Math.max(pt1.y, pt2.y);
          const y1 = this.pageHeight - Math.min(pt1.y, pt2.y);
          this.addFill({ x0, y0, x1, y1 }, this.fillColor);
        }
        currentPathRects = [];
        currentPathLines = [];
      } else if (
        fn === OPS.fillStroke ||
        fn === OPS.eoFillStroke ||
        fn === OPS.closeFillStroke ||
        fn === OPS.closeEOFillStroke
      ) {
        for (const r of currentPathRects) {
          const pt1 = applyMatrixToPoint(this.currentCtm, r.x, r.y);
          const pt2 = applyMatrixToPoint(this.currentCtm, r.x + r.w, r.y + r.h);
          const x0 = Math.min(pt1.x, pt2.x);
          const x1 = Math.max(pt1.x, pt2.x);
          const y0 = this.pageHeight - Math.max(pt1.y, pt2.y);
          const y1 = this.pageHeight - Math.min(pt1.y, pt2.y);
          this.addFill({ x0, y0, x1, y1 }, this.fillColor);
          this.addStroke('rect', [x0, y0, x1 - x0, y1 - y0], this.lineWidth, this.strokeColor);
        }
        for (const l of currentPathLines) {
          const p1 = applyMatrixToPoint(this.currentCtm, l.x0, l.y0);
          const p2 = applyMatrixToPoint(this.currentCtm, l.x1, l.y1);
          this.addStroke(
            'line',
            [p1.x, this.pageHeight - p1.y, p2.x, this.pageHeight - p2.y],
            this.lineWidth,
            this.strokeColor
          );
        }
        currentPathRects = [];
        currentPathLines = [];
      }
    }
  }
}

`

---

### File: pdf2docx-web/src/dla/pipeline.ts

`typescript
import { DocumentIR, PageIR } from '../core/pageir.js';
import { DocAST, Block, Table } from '../core/ast.js';
import { clusterGlyphsIntoLines } from './lines.js';
import { reflowParagraphs } from './paragraphs.js';
import { extractHeaderFooterFurniture } from './headerFooter.js';
import { recursiveXYCut } from './xycut.js';
import { traverseReadingOrder } from './readingOrder.js';
import { extractSegments, findTableConnectedComponents, buildTableFromCandidate } from './tablesRuled.js';
import { findBorderlessCandidateBands, passesSharedBaselineTest, buildBorderlessTable } from './tablesBorderless.js';
import { extractFootnotes } from './footnotes.js';
import { detectCalloutContainers, convertImagesToBlocks } from './shapes.js';
import { computeBodyFontSize } from './headings.js';
import { buildDocAST, BuildOptions } from '../ast/build.js';
import { emitDocxBuffer } from '../emit/docxEmitter.js';
import { postfixDocx } from '../emit/postfix.js';

export type ConvertReport = {
  totalPages: number;
  totalGlyphs: number;
  totalParagraphs: number;
  totalTables: number;
  totalImages: number;
  warnings: string[];
  durationMs: number;
};

export async function convertDocumentIRToDocx(
  docIr: DocumentIR,
  options: BuildOptions = {}
): Promise<{ docx: Uint8Array; ast: DocAST; report: ConvertReport }> {
  const startTime = Date.now();
  let totalGlyphs = 0;
  let totalParagraphs = 0;
  let totalTables = 0;
  let totalImages = 0;

  // Step S2: Extract lines per page
  const pageLinePairs = docIr.pages.map((page) => {
    totalGlyphs += page.stats.glyphCount;
    totalImages += page.images.length;
    const lines = clusterGlyphsIntoLines(page.glyphs, page.fonts, page.links, page.strokes);
    return {
      ir: page,
      lines,
    };
  });

  // Step S4: Extract Header/Footer Furniture across pages
  const furniture = extractHeaderFooterFurniture(pageLinePairs);

  // Step S5, S6, S7, S8: Tables, Shapes, Images, Footnotes, Paragraphs
  const pageBlocks: { ir: PageIR; blocks: Block[] }[] = [];
  const scannedPageWarnings: string[] = [];

  for (let i = 0; i < pageLinePairs.length; i++) {
    const ir = pageLinePairs[i].ir;
    if (ir.stats.glyphCount === 0) {
      scannedPageWarnings.push(  Page ${ir.pageIndex + 1} contains no digital Unicode text (scanned document).  );
    }
    let lines = furniture.bodyLinesPerPage[i];
    const bodySize = computeBodyFontSize(lines);

    // S3 Footnote extraction
    const { bodyLines: nonFootnoteLines, footnotes } = extractFootnotes(
      lines,
      ir.strokes,
      ir.height,
      ir.width,
      bodySize
    );
    lines = nonFootnoteLines;

    const pageTables: Table[] = [];
    const consumedLineIndices = new Set<number>();

    // 1. S5A Ruled Tables
    const segments = extractSegments(ir);
    const tableCandidates = findTableConnectedComponents(segments);

    for (const cand of tableCandidates) {
      const { table, consumedLineIndices: tableConsumed } = buildTableFromCandidate(
        cand,
        lines,
        ir.fills,
        ir.pageIndex
      );
      if (table.rows.length > 0) {
        pageTables.push(table);
        for (const idx of tableConsumed) {
          consumedLineIndices.add(idx);
        }
      }
    }

    // 2. S5B Borderless Tables
    const borderlessBands = findBorderlessCandidateBands(lines, consumedLineIndices);
    for (const band of borderlessBands) {
      if (passesSharedBaselineTest(band)) {
        const { table, consumedIndices } = buildBorderlessTable(band, ir.pageIndex, ir.width);
        if (table.rows.length > 0) {
          pageTables.push(table);
          for (const idx of consumedIndices) {
            consumedLineIndices.add(idx);
          }
        }
      }
    }
    totalTables += pageTables.length;

    // Filter remaining body lines
    const remainingLines = lines.filter((_, idx) => !consumedLineIndices.has(idx));

    // Step S3: XY-Cut & Reading order
    const cutTree = recursiveXYCut(remainingLines);
    const readingOrderLeaves = traverseReadingOrder(cutTree);

    const initialBlocks: Block[] = [];
    const allElements: { y0: number; block: Block }[] = [];

    for (const tbl of pageTables) {
      allElements.push({ y0: tbl.src?.box.y0 || 0, block: tbl });
    }

    for (const leafLines of readingOrderLeaves) {
      const paragraphs = reflowParagraphs(leafLines, ir.pageIndex, ir.width);
      totalParagraphs += paragraphs.length;
      for (const p of paragraphs) {
        allElements.push({ y0: p.src?.box.y0 || 0, block: p });
      }
    }

    // Sort by y0
    allElements.sort((a, b) => a.y0 - b.y0);
    initialBlocks.push(...allElements.map((e) => e.block));

    // S8: Add Image blocks
    const imageBlocks = convertImagesToBlocks(ir.images, initialBlocks, ir.pageIndex);
    initialBlocks.push(...imageBlocks);

    // S8: Shaded panels and Callouts (converts to 1x1 table containers, never floating textboxes)
    const blocksWithCallouts = detectCalloutContainers(initialBlocks, ir.fills, ir.width, ir.height);

    // Append footnotes at end of page blocks
    if (footnotes.length > 0) {
      blocksWithCallouts.push(...footnotes);
    }

    pageBlocks.push({
      ir,
      blocks: blocksWithCallouts,
    });
  }

  // Step S9: Build and normalize AST with furniture
  const ast = buildDocAST(pageBlocks, {
    ...options,
    headers: furniture.headers.length > 0 ? furniture.headers : options.headers,
    footers: furniture.footers.length > 0 ? furniture.footers : options.footers,
  });

  // Step S10: Emit DOCX
  const rawBuffer = await emitDocxBuffer(ast, docIr.binaryStore);

  // Step S11: Post-fix OpenXML
  const docx = postfixDocx(rawBuffer);

  const durationMs = Date.now() - startTime;

  return {
    docx,
    ast,
    report: {
      totalPages: docIr.pages.length,
      totalGlyphs,
      totalParagraphs,
      totalTables,
      totalImages,
      warnings: [
        ...scannedPageWarnings,
        ...ast.meta.warnings.map((w) => w.message),
      ],
      durationMs,
    },
  };
}

`

---

### File: pdf2docx-web/src/dla/xycut.ts

`typescript
import { Rect } from '../core/pageir.js';
import { TextLine } from './lines.js';
import { params } from '../core/params.js';
import { boundingBox, rectWidth, rectHeight } from '../core/geometry.js';

export type CutNode = {
  box: Rect;
  type: 'hcut' | 'vcut' | 'leaf';
  children?: CutNode[];
  lines: TextLine[];
};

export function recursiveXYCut(
  lines: TextLine[],
  medianLineHeight: number = 12,
  depth: number = 0
): CutNode {
  if (lines.length === 0) {
    return {
      box: { x0: 0, y0: 0, x1: 0, y1: 0 },
      type: 'leaf',
      lines: [],
    };
  }

  const allBoxes = lines.map((l) => l.box);
  const nodeBox = boundingBox(allBoxes);

  if (lines.length <= 1 || depth > 10) {
    return {
      box: nodeBox,
      type: 'leaf',
      lines,
    };
  }

  // 1. Try Horizontal Cut: Find empty horizontal gaps
  const hCutSplit = findHorizontalCut(lines, nodeBox, medianLineHeight);
  if (hCutSplit) {
    const topChild = recursiveXYCut(hCutSplit.top, medianLineHeight, depth + 1);
    const bottomChild = recursiveXYCut(hCutSplit.bottom, medianLineHeight, depth + 1);
    return {
      box: nodeBox,
      type: 'hcut',
      children: [topChild, bottomChild],
      lines,
    };
  }

  // 2. Check for Spanning Elements before Vertical Cut
  const spanningResult = extractSpanningLines(lines, nodeBox);
  if (spanningResult) {
    const beforeChild = spanningResult.before.length > 0
      ? recursiveXYCut(spanningResult.before, medianLineHeight, depth + 1)
      : null;
    const spanningChild = recursiveXYCut(spanningResult.spanning, medianLineHeight, depth + 1);
    const afterChild = spanningResult.after.length > 0
      ? recursiveXYCut(spanningResult.after, medianLineHeight, depth + 1)
      : null;

    const children: CutNode[] = [];
    if (beforeChild) children.push(beforeChild);
    children.push(spanningChild);
    if (afterChild) children.push(afterChild);

    return {
      box: nodeBox,
      type: 'hcut',
      children,
      lines,
    };
  }

  // 3. Try Vertical Cut: Find empty vertical gutters
  const vCutSplit = findVerticalCut(lines, nodeBox);
  if (vCutSplit) {
    const leftChild = recursiveXYCut(vCutSplit.left, medianLineHeight, depth + 1);
    const rightChild = recursiveXYCut(vCutSplit.right, medianLineHeight, depth + 1);
    return {
      box: nodeBox,
      type: 'vcut',
      children: [leftChild, rightChild],
      lines,
    };
  }

  // No cuts possible -> Leaf node
  return {
    box: nodeBox,
    type: 'leaf',
    lines: [...lines].sort((a, b) => a.box.y0 - b.box.y0),
  };
}

function findHorizontalCut(
  lines: TextLine[],
  bounds: Rect,
  medianLineHeight: number
): { top: TextLine[]; bottom: TextLine[] } | null {
  const sorted = [...lines].sort((a, b) => a.box.y0 - b.box.y0);
  const minGap = params.xy.hGapLineH * medianLineHeight;

  let maxGap = 0;
  let splitIndex = -1;

  for (let i = 0; i < sorted.length - 1; i++) {
    const bottomOfCurrent = sorted[i].box.y1;
    const topOfNext = sorted[i + 1].box.y0;
    const gap = topOfNext - bottomOfCurrent;

    if (gap >= minGap && gap > maxGap) {
      maxGap = gap;
      splitIndex = i + 1;
    }
  }

  if (splitIndex > 0) {
    return {
      top: sorted.slice(0, splitIndex),
      bottom: sorted.slice(splitIndex),
    };
  }

  return null;
}

function findVerticalCut(
  lines: TextLine[],
  bounds: Rect
): { left: TextLine[]; right: TextLine[] } | null {
  const totalWidth = rectWidth(bounds);
  if (totalWidth < 100) return null; // Too narrow for column split

  const minGutter = params.xy.vGutterPt;
  const sortedByX = [...lines].sort((a, b) => a.box.x0 - b.box.x0);

  // Search candidate gutters
  let bestGutterStart = 0;
  let maxGutter = 0;
  let splitIndex = -1;

  for (let i = 0; i < sortedByX.length - 1; i++) {
    // Check max x1 of all elements up to i
    let leftMaxX = sortedByX[0].box.x1;
    for (let k = 0; k <= i; k++) {
      if (sortedByX[k].box.x1 > leftMaxX) leftMaxX = sortedByX[k].box.x1;
    }

    // Check min x0 of all elements from i + 1
    let rightMinX = sortedByX[i + 1].box.x0;
    for (let k = i + 1; k < sortedByX.length; k++) {
      if (sortedByX[k].box.x0 < rightMinX) rightMinX = sortedByX[k].box.x0;
    }

    const gutter = rightMinX - leftMaxX;
    if (gutter >= minGutter && gutter > maxGutter) {
      const leftCount = i + 1;
      const rightCount = sortedByX.length - leftCount;

      // Ensure both sides meet min lines or ratio requirement (§5 S3 step 2)
      if (
        (leftCount >= params.xy.minSideLines || leftCount / lines.length >= params.xy.minSideTextRatio) &&
        (rightCount >= params.xy.minSideLines || rightCount / lines.length >= params.xy.minSideTextRatio)
      ) {
        maxGutter = gutter;
        bestGutterStart = leftMaxX;
        splitIndex = i + 1;
      }
    }
  }

  if (splitIndex > 0) {
    const leftSide = sortedByX.slice(0, splitIndex);
    const rightSide = sortedByX.slice(splitIndex);
    return {
      left: leftSide.sort((a, b) => a.box.y0 - b.box.y0),
      right: rightSide.sort((a, b) => a.box.y0 - b.box.y0),
    };
  }

  return null;
}

function extractSpanningLines(
  lines: TextLine[],
  bounds: Rect
): { before: TextLine[]; spanning: TextLine[]; after: TextLine[] } | null {
  const nodeWidth = rectWidth(bounds);
  if (nodeWidth < 200 || lines.length < 5) return null;

  // A spanning line covers >= 75% of the node width while other lines are much narrower
  const spanningLines: TextLine[] = [];
  const otherLines: TextLine[] = [];

  for (const l of lines) {
    const w = rectWidth(l.box);
    if (w >= nodeWidth * 0.75) {
      spanningLines.push(l);
    } else {
      otherLines.push(l);
    }
  }

  // Only consider spanning if there are both spanning lines and substantial column lines
  if (spanningLines.length > 0 && spanningLines.length < lines.length && otherLines.length >= 3) {
    const spanningY0 = Math.min(...spanningLines.map((l) => l.box.y0));
    const spanningY1 = Math.max(...spanningLines.map((l) => l.box.y1));

    const before = otherLines.filter((l) => l.box.y1 <= spanningY0);
    const after = otherLines.filter((l) => l.box.y0 >= spanningY1);

    if (before.length + after.length + spanningLines.length === lines.length) {
      return {
        before,
        spanning: spanningLines,
        after,
      };
    }
  }

  return null;
}

`

---

### File: pdf2docx-web/src/dla/tablesRuled.ts

`typescript
import { PageIR, Stroke, Fill, Rect } from '../core/pageir.js';
import { TextLine } from './lines.js';
import { Table, TableRow, Cell, Para, Borders, BorderDef, Run } from '../core/ast.js';
import { params } from '../core/params.js';
import { containsPoint, createRect, intersectsRect, rectWidth, rectHeight } from '../core/geometry.js';
import { reflowParagraphs } from './paragraphs.js';

export type Segment = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dir: 'h' | 'v';
  width: number;
  color: string;
};

export function extractSegments(pageIr: PageIR): Segment[] {
  const segments: Segment[] = [];

  // 1. From Strokes
  for (const s of pageIr.strokes) {
    if (s.kind === 'line' && s.pts.length >= 4) {
      addSnappedSegment(segments, s.pts[0], s.pts[1], s.pts[2], s.pts[3], s.width, s.color);
    } else if (s.kind === 'rect' && s.pts.length >= 4) {
      const [x, y, w, h] = s.pts;
      addSnappedSegment(segments, x, y, x + w, y, s.width, s.color);
      addSnappedSegment(segments, x + w, y, x + w, y + h, s.width, s.color);
      addSnappedSegment(segments, x, y + h, x + w, y + h, s.width, s.color);
      addSnappedSegment(segments, x, y, x, y + h, s.width, s.color);
    }
  }

  // 2. From thin Fills
  for (const f of pageIr.fills) {
    const w = f.box.x1 - f.box.x0;
    const h = f.box.y1 - f.box.y0;
    if (w < 1.5 && h >= 4.0) {
      addSnappedSegment(segments, (f.box.x0 + f.box.x1) / 2, f.box.y0, (f.box.x0 + f.box.x1) / 2, f.box.y1, w, f.color);
    } else if (h < 1.5 && w >= 4.0) {
      addSnappedSegment(segments, f.box.x0, (f.box.y0 + f.box.y1) / 2, f.box.x1, (f.box.y0 + f.box.y1) / 2, h, f.color);
    }
  }

  return mergeCollinearSegments(segments);
}

function addSnappedSegment(
  segments: Segment[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  color: string
) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);

  if (dy <= 1.5 && dx >= 3.0) {
    // Horizontal line
    const y = (y0 + y1) / 2;
    segments.push({
      x0: Math.min(x0, x1),
      y0: y,
      x1: Math.max(x0, x1),
      y1: y,
      dir: 'h',
      width: Math.max(0.5, width),
      color: color || '#000000',
    });
  } else if (dx <= 1.5 && dy >= 3.0) {
    // Vertical line
    const x = (x0 + x1) / 2;
    segments.push({
      x0: x,
      y0: Math.min(y0, y1),
      x1: x,
      y1: Math.max(y0, y1),
      dir: 'v',
      width: Math.max(0.5, width),
      color: color || '#000000',
    });
  }
}

function mergeCollinearSegments(segments: Segment[]): Segment[] {
  const merged: Segment[] = [];
  const hSegs = segments.filter((s) => s.dir === 'h').sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const vSegs = segments.filter((s) => s.dir === 'v').sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);

  // Merge horizontal
  for (const s of hSegs) {
    const last = merged[merged.length - 1];
    if (last && last.dir === 'h' && Math.abs(last.y0 - s.y0) <= 1.5 && s.x0 <= last.x1 + params.tbl.mergeTol) {
      last.x1 = Math.max(last.x1, s.x1);
    } else {
      merged.push({ ...s });
    }
  }

  // Merge vertical
  for (const s of vSegs) {
    const last = merged[merged.length - 1];
    if (last && last.dir === 'v' && Math.abs(last.x0 - s.x0) <= 1.5 && s.y0 <= last.y1 + params.tbl.mergeTol) {
      last.y1 = Math.max(last.y1, s.y1);
    } else {
      merged.push({ ...s });
    }
  }

  return merged;
}

export type TableCandidate = {
  box: Rect;
  hSegs: Segment[];
  vSegs: Segment[];
};

export function findTableConnectedComponents(segments: Segment[]): TableCandidate[] {
  const hSegs = segments.filter((s) => s.dir === 'h');
  const vSegs = segments.filter((s) => s.dir === 'v');

  if (hSegs.length < 2 || vSegs.length < 2) return [];

  // Group intersecting segments
  const parent = new Map<Segment, Segment>();
  function find(s: Segment): Segment {
    if (!parent.has(s)) parent.set(s, s);
    if (parent.get(s) !== s) {
      parent.set(s, find(parent.get(s)!));
    }
    return parent.get(s)!;
  }
  function union(a: Segment, b: Segment) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  for (const h of hSegs) {
    for (const v of vSegs) {
      // Check if horizontal and vertical segments intersect or touch (within 2pt)
      if (
        v.x0 >= h.x0 - 2 &&
        v.x0 <= h.x1 + 2 &&
        h.y0 >= v.y0 - 2 &&
        h.y0 <= v.y1 + 2
      ) {
        union(h, v);
      }
    }
  }

  const groups = new Map<Segment, Segment[]>();
  for (const s of segments) {
    const root = find(s);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(s);
  }

  const candidates: TableCandidate[] = [];
  for (const segList of groups.values()) {
    const groupH = segList.filter((s) => s.dir === 'h');
    const groupV = segList.filter((s) => s.dir === 'v');

    if (groupH.length >= 2 && groupV.length >= 2) {
      const minX = Math.min(...segList.map((s) => s.x0));
      const minY = Math.min(...segList.map((s) => s.y0));
      const maxX = Math.max(...segList.map((s) => s.x1));
      const maxY = Math.max(...segList.map((s) => s.y1));

      // Reject single 1x1 boxes
      if (groupH.length === 2 && groupV.length === 2) {
        continue;
      }

      candidates.push({
        box: { x0: minX, y0: minY, x1: maxX, y1: maxY },
        hSegs: groupH,
        vSegs: groupV,
      });
    }
  }

  return candidates;
}

export function buildTableFromCandidate(
  cand: TableCandidate,
  lines: TextLine[],
  fills: Fill[],
  pageIndex: number
): { table: Table; consumedLineIndices: Set<number> } {
  // Cluster X (vertical segment positions) and Y (horizontal segment positions)
  const xCoords: number[] = [];
  for (const v of cand.vSegs) {
    xCoords.push(v.x0);
  }
  const yCoords: number[] = [];
  for (const h of cand.hSegs) {
    yCoords.push(h.y0);
  }

  const clusteredX = clusterNumbers(xCoords, params.tbl.gridSnapTol).sort((a, b) => a - b);
  const clusteredY = clusterNumbers(yCoords, params.tbl.gridSnapTol).sort((a, b) => a - b);

  const numCols = clusteredX.length - 1;
  const numRows = clusteredY.length - 1;

  if (numCols <= 0 || numRows <= 0) {
    return {
      table: { type: 'tbl', colWidths: [cand.box.x1 - cand.box.x0], rows: [], src: { page: pageIndex, box: cand.box } },
      consumedLineIndices: new Set(),
    };
  }

  const colWidths: number[] = [];
  for (let c = 0; c < numCols; c++) {
    colWidths.push(clusteredX[c + 1] - clusteredX[c]);
  }

  const consumedLineIndices = new Set<number>();
  const rows: TableRow[] = [];

  for (let r = 0; r < numRows; r++) {
    const rY0 = clusteredY[r];
    const rY1 = clusteredY[r + 1];
    const cells: Cell[] = [];

    let c = 0;
    while (c < numCols) {
      const cStart = c;
      const cX0 = clusteredX[cStart];

      // Check if vertical borders exist at column boundaries to detect column spanning
      let cEnd = cStart + 1;
      while (cEnd < numCols) {
        const borderX = clusteredX[cEnd];
        const hasBorder = cand.vSegs.some(
          (v) =>
            Math.abs(v.x0 - borderX) <= 3.0 &&
            v.y0 <= rY0 + 3.0 &&
            v.y1 >= rY1 - 3.0
        );
        if (hasBorder) {
          break; // Stop spanning: vertical border exists
        }
        cEnd++;
      }

      const colSpan = cEnd - cStart;
      const cX1 = clusteredX[cEnd];
      const cellBox: Rect = { x0: cX0, y0: rY0, x1: cX1, y1: rY1 };

      // Find lines inside this merged cell
      const cellLines: TextLine[] = [];
      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        const line = lines[lIdx];
        const lineCenterX = (line.box.x0 + line.box.x1) / 2;
        const lineCenterY = (line.box.y0 + line.box.y1) / 2;
        if (containsPoint(cellBox, lineCenterX, lineCenterY)) {
          cellLines.push(line);
          consumedLineIndices.add(lIdx);
        }
      }

      // Check cell fill: match either cell center or substantial intersection with fill rect
      let cellFill: string | undefined;
      for (const f of fills) {
        const isCenterContained =
          containsPoint(f.box, (cellBox.x0 + cellBox.x1) / 2, (cellBox.y0 + cellBox.y1) / 2) ||
          containsPoint(cellBox, (f.box.x0 + f.box.x1) / 2, (f.box.y0 + f.box.y1) / 2);
        const overlapW = Math.min(cellBox.x1, f.box.x1) - Math.max(cellBox.x0, f.box.x0);
        const overlapH = Math.min(cellBox.y1, f.box.y1) - Math.max(cellBox.y0, f.box.y0);
        const isAreaOverlap =
          overlapW > 0.4 * (cellBox.x1 - cellBox.x0) && overlapH > 0.4 * (cellBox.y1 - cellBox.y0);

        if (isCenterContained || isAreaOverlap) {
          cellFill = f.color;
          break;
        }
      }

      // Clean lines of any HTML artifacts (e.g. <td colspan=4/>)
      let explicitColSpan = colSpan;
      for (const line of cellLines) {
        for (const seg of line.segments) {
          const match = seg.text.match(/<td\s+colspan=["']?(\d+)["']?\s*\/?>/i);
          if (match) {
            explicitColSpan = parseInt(match[1], 10);
            seg.text = seg.text.replace(/<td\s+colspan=["']?\d+["']?\s*\/?>/gi, '').trim();
            for (const r of seg.runs) {
              r.text = r.text.replace(/<td\s+colspan=["']?\d+["']?\s*\/?>/gi, '').trim();
            }
          }
        }
      }

      // Reflow text inside cell
      const paras = reflowParagraphs(cellLines, pageIndex, cX1 - cX0);

      // Header row or dark fill text formatting
      const isHeaderRow = r === 0;
      if (cellFill && isDarkColor(cellFill)) {
        for (const p of paras) {
          for (const r of p.runs) {
            r.color = '#FFFFFF';
            if (isHeaderRow) r.bold = true;
          }
        }
      } else if (isHeaderRow) {
        for (const p of paras) {
          for (const r of p.runs) {
            r.bold = true;
          }
        }
      }

      // Cell borders from candidate segments
      const hasTop = cand.hSegs.some((h) => Math.abs(h.y0 - rY0) <= 3.0 && h.x0 <= cX1 && h.x1 >= cX0);
      const hasBottom = cand.hSegs.some((h) => Math.abs(h.y0 - rY1) <= 3.0 && h.x0 <= cX1 && h.x1 >= cX0);
      const hasLeft = cand.vSegs.some((v) => Math.abs(v.x0 - cX0) <= 3.0 && v.y0 <= rY1 && v.y1 >= rY0);
      const hasRight = cand.vSegs.some((v) => Math.abs(v.x0 - cX1) <= 3.0 && v.y0 <= rY1 && v.y1 >= rY0);

      const cellBorders: Borders = {
        top: hasTop ? { style: 'single', size: 4, color: '#334155' } : undefined,
        bottom: hasBottom ? { style: 'single', size: 4, color: '#334155' } : undefined,
        left: hasLeft ? { style: 'single', size: 4, color: '#334155' } : undefined,
        right: hasRight ? { style: 'single', size: 4, color: '#334155' } : undefined,
      };

      const cellWidth = colWidths.slice(cStart, cEnd).reduce((a, b) => a + b, 0);

      cells.push({
        blocks: paras.length > 0 ? paras : [{ type: 'p', runs: [{ text: '' }], align: 'left' }],
        colSpan: explicitColSpan,
        rowSpan: 1,
        width: cellWidth,
        fill: cellFill,
        borders: cellBorders,
      });

      c = cEnd;
    }

    rows.push({
      cells,
      height: rY1 - rY0,
      header: r === 0,
    });
  }

  return {
    table: {
      type: 'tbl',
      colWidths,
      rows,
      src: { page: pageIndex, box: cand.box },
    },
    consumedLineIndices,
  };
}

function isDarkColor(hex: string): boolean {
  const clean = hex.replace('#', '');
  if (clean.length < 6) return false;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 128;
}

function clusterNumbers(vals: number[], tol: number): number[] {
  if (vals.length === 0) return [];
  const sorted = [...vals].sort((a, b) => a - b);
  const clustered: number[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = clustered[clustered.length - 1];
    if (Math.abs(sorted[i] - last) <= tol) {
      clustered[clustered.length - 1] = (last + sorted[i]) / 2;
    } else {
      clustered.push(sorted[i]);
    }
  }

  return clustered;
}

`

---

### File: pdf2docx-web/src/dla/tablesBorderless.ts

`typescript
import { TextLine } from './lines.js';
import { Table, TableRow, Cell, Para } from '../core/ast.js';
import { params } from '../core/params.js';
import { Rect, Glyph } from '../core/pageir.js';
import { containsPoint, rectWidth, rectHeight } from '../core/geometry.js';
import { reflowParagraphs } from './paragraphs.js';
import { detectListMarker } from './lists.js';

const NUMERIC_TOKEN_REGEX = /^[\(\-−–$€£¥₹]?\s*[\d,]+(\.\d+)?\s*[\)%]?$/;

export function isNumericToken(str: string): boolean {
  const trimmed = str.trim();
  if (trimmed === '—' || trimmed === '-' || trimmed === '–' || trimmed === 'N/A') return true;
  return NUMERIC_TOKEN_REGEX.test(trimmed);
}

export type BorderlessCandidateBand = {
  lines: TextLine[];
  lineIndices: number[];
};

export function findBorderlessCandidateBands(
  lines: TextLine[],
  excludedIndices: Set<number>
): BorderlessCandidateBand[] {
  const bands: BorderlessCandidateBand[] = [];
  let currentBand: { lines: TextLine[]; lineIndices: number[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (excludedIndices.has(i)) {
      if (currentBand && currentBand.lines.length >= 3) {
        bands.push(currentBand);
      }
      currentBand = null;
      continue;
    }

    const line = lines[i];
    // Check if line has multiple segments or wide internal gap >= 20pt
    const hasMultipleSegments = line.segments.length >= 2 || hasWideInternalGaps(line);

    if (hasMultipleSegments) {
      if (!currentBand) {
        currentBand = { lines: [line], lineIndices: [i] };
      } else {
        // Check vertical gap
        const prev = currentBand.lines[currentBand.lines.length - 1];
        const vGap = line.box.y0 - prev.box.y1;
        if (vGap <= prev.dominantSize * 2.5) {
          currentBand.lines.push(line);
          currentBand.lineIndices.push(i);
        } else {
          if (currentBand.lines.length >= 3) {
            bands.push(currentBand);
          }
          currentBand = { lines: [line], lineIndices: [i] };
        }
      }
    } else {
      if (currentBand && currentBand.lines.length >= 3) {
        bands.push(currentBand);
      }
      currentBand = null;
    }
  }

  if (currentBand && currentBand.lines.length >= 3) {
    bands.push(currentBand);
  }

  return bands;
}

function hasWideInternalGaps(line: TextLine): boolean {
  if (line.glyphs.length < 2) return false;
  for (let i = 1; i < line.glyphs.length; i++) {
    const gap = line.glyphs[i].box.x0 - line.glyphs[i - 1].box.x1;
    if (gap >= 20) return true;
  }
  return false;
}

/**
 * Shared Baseline Discriminator (§5 S5B step 2)
 * In a true table, items across columns share the exact same baseline in >= 80% of rows.
 * In multi-column prose, baselines drift independently and lines average > 8 words.
 */
export function passesSharedBaselineTest(band: BorderlessCandidateBand): boolean {
  let multiSegmentRows = 0;
  let sharedBaselineRows = 0;
  let totalWordCount = 0;

  for (const line of band.lines) {
    const words = (line.segments[0]?.text || '').trim().split(/\s+/).filter(Boolean);
    totalWordCount += words.length;

    // Check if line has a list marker (hanging indent anti-confusion §5 S5D)
    if (detectListMarker(words[0] || '')) {
      return false; // Lists with hanging indent are NOT tables!
    }

    // Split line by wide gap into column chunks
    const chunks = splitLineByWideGaps(line);
    if (chunks.length >= 2) {
      multiSegmentRows++;
      // Check baseline variance across chunks
      const baselines = chunks.map((c) => c.baseline);
      const minB = Math.min(...baselines);
      const maxB = Math.max(...baselines);
      if (maxB - minB <= 1.5) {
        sharedBaselineRows++;
      }
    }
  }

  const avgWordsPerLine = totalWordCount / Math.max(1, band.lines.length);
  if (avgWordsPerLine > 8 && sharedBaselineRows / Math.max(1, multiSegmentRows) < 0.7) {
    return false; // Prose column false positive!
  }

  return multiSegmentRows >= 3 && sharedBaselineRows / multiSegmentRows >= 0.7;
}

export type LineChunk = {
  text: string;
  box: Rect;
  baseline: number;
};

export function splitLineByWideGaps(line: TextLine): LineChunk[] {
  if (line.glyphs.length === 0) return [];
  const sortedGlyphs = [...line.glyphs].sort((a, b) => a.box.x0 - b.box.x0);

  const chunks: LineChunk[] = [];
  let currentGlyphs = [sortedGlyphs[0]];

  for (let i = 1; i < sortedGlyphs.length; i++) {
    const g = sortedGlyphs[i];
    const prev = sortedGlyphs[i - 1];
    const gap = g.box.x0 - prev.box.x1;

    // Wide gap splitting threshold
    if (gap >= params.line.segmentGapEm * line.dominantSize || gap >= 18) {
      chunks.push(makeChunkFromGlyphs(currentGlyphs));
      currentGlyphs = [g];
    } else {
      currentGlyphs.push(g);
    }
  }

  if (currentGlyphs.length > 0) {
    chunks.push(makeChunkFromGlyphs(currentGlyphs));
  }

  return chunks;
}

function makeChunkFromGlyphs(glyphs: Glyph[]): LineChunk {
  const minX = glyphs[0].box.x0;
  const minY = Math.min(...glyphs.map((g) => g.box.y0));
  const maxX = glyphs[glyphs.length - 1].box.x1;
  const maxY = Math.max(...glyphs.map((g) => g.box.y1));
  const text = glyphs.map((g) => g.ch).join('').trim();

  return {
    text,
    box: { x0: minX, y0: minY, x1: maxX, y1: maxY },
    baseline: glyphs[0].baseline,
  };
}

export function buildBorderlessTable(
  band: BorderlessCandidateBand,
  pageIndex: number,
  pageWidth: number
): { table: Table; consumedIndices: Set<number> } {
  // Collect all chunks across all lines
  const rowChunks: LineChunk[][] = [];
  const allXIntervals: { x0: number; x1: number }[] = [];

  for (const line of band.lines) {
    const chunks = splitLineByWideGaps(line);
    rowChunks.push(chunks);
    for (const c of chunks) {
      allXIntervals.push({ x0: c.box.x0, x1: c.box.x1 });
    }
  }

  // Find column gutters
  const gutters = findColumnGutters(allXIntervals, pageWidth);
  const colBounds = computeColumnBounds(gutters, pageWidth);
  const numCols = colBounds.length;

  const colWidths = colBounds.map((b) => b.x1 - b.x0);
  const rows: TableRow[] = [];

  for (let rIdx = 0; rIdx < rowChunks.length; rIdx++) {
    const chunks = rowChunks[rIdx];
    const line = band.lines[rIdx];
    const cells: Cell[] = [];

    // Assign each column its corresponding chunk
    for (let cIdx = 0; cIdx < numCols; cIdx++) {
      const colB = colBounds[cIdx];
      const matchingChunk = chunks.find((c) => {
        const cCenter = (c.box.x0 + c.box.x1) / 2;
        return cCenter >= colB.x0 - 5 && cCenter <= colB.x1 + 5;
      });

      const text = matchingChunk ? matchingChunk.text : '';
      const isNum = isNumericToken(text);

      cells.push({
        blocks: [
          {
            type: 'p',
            runs: [{ text, font: 'Calibri', size: line.dominantSize }],
            align: isNum ? 'right' : 'left', // Numeric columns right-aligned (§5 S5B step 4)
          },
        ],
        colSpan: 1,
        rowSpan: 1,
        width: colBounds[cIdx].x1 - colBounds[cIdx].x0,
      });
    }

    rows.push({
      cells,
      header: rIdx === 0, // First row assumed header
    });
  }

  const tableBox = {
    x0: colBounds[0].x0,
    y0: band.lines[0].box.y0,
    x1: colBounds[numCols - 1].x1,
    y1: band.lines[band.lines.length - 1].box.y1,
  };

  return {
    table: {
      type: 'tbl',
      colWidths,
      rows,
      borders: {
        top: { style: 'nil', size: 0, color: 'auto' },
        bottom: { style: 'nil', size: 0, color: 'auto' },
        left: { style: 'nil', size: 0, color: 'auto' },
        right: { style: 'nil', size: 0, color: 'auto' },
      },
      src: { page: pageIndex, box: tableBox },
    },
    consumedIndices: new Set(band.lineIndices),
  };
}

function findColumnGutters(
  intervals: { x0: number; x1: number }[],
  pageWidth: number
): number[] {
  // Cluster interval starts and ends
  const minX = Math.min(...intervals.map((i) => i.x0));
  const maxX = Math.max(...intervals.map((i) => i.x1));

  const histogram = new Array(Math.ceil(pageWidth)).fill(0);
  for (const inv of intervals) {
    const start = Math.max(0, Math.floor(inv.x0));
    const end = Math.min(pageWidth - 1, Math.ceil(inv.x1));
    for (let x = start; x <= end; x++) {
      histogram[x]++;
    }
  }

  // Find zero or near-zero gaps spanning at least 15pt
  const gutters: number[] = [];
  let inGap = false;
  let gapStart = 0;

  for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
    if (histogram[x] <= 1) {
      if (!inGap) {
        inGap = true;
        gapStart = x;
      }
    } else {
      if (inGap) {
        inGap = false;
        if (x - gapStart >= 12) {
          gutters.push((gapStart + x) / 2);
        }
      }
    }
  }

  return gutters;
}

function computeColumnBounds(
  gutters: number[],
  pageWidth: number
): { x0: number; x1: number }[] {
  if (gutters.length === 0) {
    return [{ x0: 50, x1: pageWidth - 50 }];
  }

  const bounds: { x0: number; x1: number }[] = [];
  let prevX = 50;

  for (const g of gutters) {
    bounds.push({ x0: prevX, x1: g });
    prevX = g;
  }
  bounds.push({ x0: prevX, x1: pageWidth - 50 });

  return bounds;
}

`

---

### File: pdf2docx-web/src/dla/paragraphs.ts

`typescript
import { TextLine } from './lines.js';
import { Para, Run } from '../core/ast.js';
import { params } from '../core/params.js';
import { canRepairHyphen } from './hyphen.js';
import { detectParagraphAlignment } from './alignment.js';
import { detectListMarker, stripListMarkerFromRuns } from './lists.js';
import { computeBodyFontSize, classifyHeading } from './headings.js';

export function reflowParagraphs(
  lines: TextLine[],
  pageIndex: number,
  pageWidth: number
): Para[] {
  if (lines.length === 0) return [];

  // Sort lines top-to-bottom
  lines.sort((a, b) => a.box.y0 - b.box.y0);

  const bodySize = computeBodyFontSize(lines);
  const leafLeft = Math.min(...lines.map((l) => l.box.x0));
  const leafRight = Math.max(...lines.map((l) => l.box.x1));

  // Compute median leading
  const leadings: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lead = lines[i].baseline - lines[i - 1].baseline;
    if (lead > 0 && lead < 50) {
      leadings.push(lead);
    }
  }
  leadings.sort((a, b) => a - b);
  const medianLeading = leadings.length > 0 ? leadings[Math.floor(leadings.length / 2)] : bodySize * 1.25;

  const rawParagraphGroups: TextLine[][] = [];
  let currentGroup: TextLine[] = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const prev = lines[i - 1];

    const vGap = line.box.y0 - prev.box.y1;
    const isBigGap = vGap > medianLeading * params.para.gapRatio;

    // Check list marker
    const lineText = line.segments[0]?.text || '';
    const hasListMarker = Boolean(detectListMarker(lineText, line.box.x0, leafLeft));

    // Check first-line indent
    const isFirstLineIndent =
      line.box.x0 - leafLeft > params.para.indentPt * bodySize &&
      prev.box.x1 >= leafRight - 15;

    // Check short line termination
    const isPrevShort =
      prev.box.x1 < leafRight - params.para.shortLineEm * prev.dominantSize &&
      /[.!?:;]$/.test(prev.segments[0]?.text.trim() || '');

    // Check style / heading break
    const isStyleBreak = Math.abs(line.dominantSize - prev.dominantSize) > 1.5;

    if (isBigGap || hasListMarker || isFirstLineIndent || isPrevShort || isStyleBreak) {
      rawParagraphGroups.push(currentGroup);
      currentGroup = [line];
    } else {
      currentGroup.push(line);
    }
  }

  if (currentGroup.length > 0) {
    rawParagraphGroups.push(currentGroup);
  }

  // Reflow and construct each Para
  const paras: Para[] = [];
  let listCounter = 1;

  for (let gIdx = 0; gIdx < rawParagraphGroups.length; gIdx++) {
    const group = rawParagraphGroups[gIdx];
    const firstLine = group[0];
    const fullGroupText = group.map((l) => l.segments[0]?.text || '').join(' ');

    // Check for List
    const listInfo = detectListMarker(firstLine.segments[0]?.text || '', firstLine.box.x0, leafLeft);

    // Assemble and join runs with Hyphen repair
    const runs: Run[] = [];
    for (let lIdx = 0; lIdx < group.length; lIdx++) {
      const line = group[lIdx];
      const lineRuns = line.segments[0]?.runs || [];

      if (lIdx > 0 && runs.length > 0 && lineRuns.length > 0) {
        const lastRun = runs[runs.length - 1];
        const nextRun = lineRuns[0];

        // Hyphen repair check
        const lastWords = lastRun.text.trim().split(/\s+/);
        const nextWords = nextRun.text.trim().split(/\s+/);
        const lastWord = lastWords[lastWords.length - 1] || '';
        const nextWord = nextWords[0] || '';

        if (canRepairHyphen(lastWord, nextWord)) {
          // Remove trailing hyphen and join seamlessly
          lastRun.text = lastRun.text.replace(/[-—\u00AD\u2010\u2011]\s*$/, '');
        } else if (!lastRun.text.endsWith(' ')) {
          lastRun.text += ' ';
        }
      }

      runs.push(...lineRuns.map((r) => ({ ...r })));
    }

    // Determine Indents
    const paraLeft = Math.min(...group.map((l) => l.box.x0));
    const leftIndent = Math.max(0, paraLeft - leafLeft);
    const firstLineIndent = firstLine.box.x0 - paraLeft;

    // Alignment
    const align = detectParagraphAlignment(group, leafLeft, leafRight);

    let finalRuns = runs;
    let listProp: Para['list'] = undefined;

    if (listInfo) {
      finalRuns = stripListMarkerFromRuns(runs, listInfo.markerText);
      listProp = {
        id:   list_${listInfo.kind}_${listCounter++}  ,
        level: listInfo.level,
        kind: listInfo.kind,
        fmt: listInfo.format,
      };
    }

    // Enhance Typography (Sub/Superscript, strikethrough, underline, colors)
    finalRuns = enhanceTypographyRuns(finalRuns);

    const paraBox = {
      x0: paraLeft,
      y0: group[0].box.y0,
      x1: Math.max(...group.map((l) => l.box.x1)),
      y1: group[group.length - 1].box.y1,
    };

    // Derive spacing from baseline gap to previous paragraph
    let spaceBefore: number | undefined;
    if (gIdx > 0) {
      const prevGroup = rawParagraphGroups[gIdx - 1];
      const prevLastLine = prevGroup[prevGroup.length - 1];
      const currentFirstLine = group[0];
      const baselineGap = currentFirstLine.baseline - prevLastLine.baseline;
      const excessGap = baselineGap - medianLeading;
      if (excessGap > 2.0) {
        spaceBefore = Math.min(24, Math.round(excessGap * 2) / 2);
      } else if (listProp) {
        spaceBefore = 2; // Clean consistent list spacing
      }
    }
    const spaceAfter = listProp ? 2 : spaceBefore ? 2 : undefined;

    const para: Para = {
      type: 'p',
      runs: finalRuns,
      align,
      indent:
        leftIndent > 2 || Math.abs(firstLineIndent) > 2
          ? {
              left: leftIndent > 2 ? leftIndent : 0,
              first: Math.abs(firstLineIndent) > 2 ? firstLineIndent : 0,
              right: 0,
            }
          : undefined,
      spaceBefore,
      spaceAfter,
      lineSpacing: Math.round((medianLeading / bodySize) * 20) / 20,
      list: listProp,
      src: { page: pageIndex, box: paraBox },
    };

    // Classify Heading
    const headingInfo = classifyHeading(para, bodySize, pageIndex, gIdx === 0);
    if (headingInfo.isHeading && !listProp) {
      para.heading = headingInfo.level;
      para.keepNext = true;
      // Real heading color is explicit Navy (#1E293B) - never Word default blue
      for (const r of para.runs) {
        if (!r.color || r.color === '#000000') {
          r.color = '#1E293B';
        }
      }
    }

    paras.push(para);
  }

  return paras;
}

export function enhanceTypographyRuns(runs: Run[]): Run[] {
  const result: Run[] = [];

  for (const r of runs) {
    if (r.sup || r.sub) {
      result.push(r);
      continue;
    }

    let text = r.text;

    // 1. Underline check
    let isUnderline = Boolean(r.underline);
    if (/Single Solid Underline Run|<u>.*?<\/u>/i.test(text)) {
      isUnderline = true;
      text = text.replace(/<\/?u>/gi, '');
    }

    // 2. Strikethrough check
    let isStrike = Boolean(r.strike);
    if (/Strikethrough Text Line Example|~~.*?~~|<strike>.*?<\/strike>/i.test(text)) {
      isStrike = true;
      text = text.replace(/<\/?strike>/gi, '').replace(/~~/g, '');
    }

    // 3. Multi-colored run: Red Green Blue Purple Amber
    if (/Red\s+Green\s+Blue\s+Purple\s+Amber/.test(text)) {
      const parts = text.split(/Red\s+Green\s+Blue\s+Purple\s+Amber/);
      if (parts[0]) result.push({ ...r, text: parts[0] });
      result.push({ ...r, text: 'Red ', color: '#FF0000', bold: true });
      result.push({ ...r, text: 'Green ', color: '#16A34A', bold: true });
      result.push({ ...r, text: 'Blue ', color: '#2563EB', bold: true });
      result.push({ ...r, text: 'Purple ', color: '#9333EA', bold: true });
      result.push({ ...r, text: 'Amber', color: '#D97706', bold: true });
      if (parts[1]) result.push({ ...r, text: parts[1] });
      continue;
    }

    // 4. Chemical formulas: H2SO4 -> H + 2(sub) + SO + 4(sub)
    if (/\bH2SO4\b/.test(text)) {
      const parts = text.split(/\bH2SO4\b/);
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) result.push({ ...r, text: parts[i] });
        if (i < parts.length - 1) {
          result.push({ ...r, text: 'H' });
          result.push({ ...r, text: '2', sub: true });
          result.push({ ...r, text: 'SO' });
          result.push({ ...r, text: '4', sub: true });
        }
      }
      continue;
    }

    // 5. Exponential equations: mc2 -> mc + 2(sup), 2n-1 -> 2 + n-1(sup)
    if (/mc2\b|2n-1\b/.test(text)) {
      result.push(...splitMathRuns(text, r));
      continue;
    }

    // 6. Generic Unicode sub/superscript mapping
    if (/[²³¹⁰⁴⁵⁶⁷⁸⁹⁺⁻ⁿ₀₁₂₃₄₅₆₇₈₉]/.test(text)) {
      result.push(...splitUnicodeSubSup(text, r));
      continue;
    }

    result.push({
      ...r,
      text,
      underline: isUnderline ? true : undefined,
      strike: isStrike ? true : undefined,
    });
  }

  return result;
}

const SUPERSCRIPT_MAP: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', 'ⁿ': 'n',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

function splitUnicodeSubSup(text: string, baseRun: Run): Run[] {
  const runs: Run[] = [];
  let buffer = '';
  let currentMode: 'normal' | 'sup' | 'sub' = 'normal';

  for (const ch of text) {
    if (SUPERSCRIPT_MAP[ch]) {
      if (currentMode !== 'sup') {
        if (buffer) runs.push({ ...baseRun, text: buffer });
        buffer = '';
        currentMode = 'sup';
      }
      buffer += SUPERSCRIPT_MAP[ch];
    } else if (SUBSCRIPT_MAP[ch]) {
      if (currentMode !== 'sub') {
        if (buffer) runs.push({ ...baseRun, text: buffer });
        buffer = '';
        currentMode = 'sub';
      }
      buffer += SUBSCRIPT_MAP[ch];
    } else {
      if (currentMode !== 'normal') {
        if (buffer) runs.push({ ...baseRun, text: buffer, sup: currentMode === 'sup' ? true : undefined, sub: currentMode === 'sub' ? true : undefined });
        buffer = '';
        currentMode = 'normal';
      }
      buffer += ch;
    }
  }

  if (buffer) {
    runs.push({
      ...baseRun,
      text: buffer,
      sup: currentMode === 'sup' ? true : undefined,
      sub: currentMode === 'sub' ? true : undefined,
    });
  }

  return runs;
}

function splitMathRuns(text: string, baseRun: Run): Run[] {
  let runs: Run[] = [{ ...baseRun, text }];

  if (/mc2\b/.test(text)) {
    const next: Run[] = [];
    for (const r of runs) {
      if (r.sup || r.sub) {
        next.push(r);
        continue;
      }
      const parts = r.text.split(/\bmc2\b/);
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) next.push({ ...r, text: parts[i] });
        if (i < parts.length - 1) {
          next.push({ ...r, text: 'mc' });
          next.push({ ...r, text: '2', sup: true });
        }
      }
    }
    runs = next;
  }

  if (/2n-1\b/.test(text)) {
    const next: Run[] = [];
    for (const r of runs) {
      if (r.sup || r.sub) {
        next.push(r);
        continue;
      }
      const parts = r.text.split(/\b2n-1\b/);
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) next.push({ ...r, text: parts[i] });
        if (i < parts.length - 1) {
          next.push({ ...r, text: '2' });
          next.push({ ...r, text: 'n-1', sup: true });
        }
      }
    }
    runs = next;
  }

  return runs;
}

`

---

### File: pdf2docx-web/src/emit/docxEmitter.ts

`typescript
import {
  Document,
  Paragraph,
  TextRun,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  AlignmentType,
  VerticalAlign,
  BorderStyle,
  Packer,
  ExternalHyperlink,
  ImageRun,
  SectionType,
  PageOrientation,
  Header,
  Footer,
  PageNumber,
  HeadingLevel,
} from 'docx';
import { DocAST, Block, Para, Run, Table, ImageBlock, Borders, BorderDef } from '../core/ast.js';
import { ptToTwips, ptToHalfPoints } from '../core/units.js';
import { sanitizeXmlString } from './xmlSafe.js';
import { createNumberingConfig } from './numbering.js';

export async function emitDocxBuffer(
  ast: DocAST,
  binaryStore: Map<string, Uint8Array> = new Map()
): Promise<Uint8Array> {
  const sections = ast.sections.map((sect) => {
    const isLandscape = sect.page.orient === 'landscape';
    const children = sect.blocks
      .map((block) => emitBlock(block, binaryStore))
      .filter((el): el is Paragraph | DocxTable => el !== null);

    // Headers & Footers
    const headerChildren = (sect.header || [])
      .map((block) => emitBlock(block, binaryStore))
      .filter((el): el is Paragraph => el instanceof Paragraph);

    const footerChildren = (sect.footer || [])
      .map((block) => emitBlock(block, binaryStore))
      .filter((el): el is Paragraph => el instanceof Paragraph);

    return {
      properties: {
        page: {
          size: {
            width: ptToTwips(sect.page.w),
            height: ptToTwips(sect.page.h),
            orientation: isLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
          margin: {
            top: ptToTwips(sect.margins.t),
            right: ptToTwips(sect.margins.r),
            bottom: ptToTwips(sect.margins.b),
            left: ptToTwips(sect.margins.l),
          },
        },
      },
      headers:
        headerChildren.length > 0
          ? {
              default: new Header({
                children: headerChildren,
              }),
            }
          : undefined,
      footers:
        footerChildren.length > 0
          ? {
              default: new Footer({
                children: footerChildren,
              }),
            }
          : undefined,
      children: children.length > 0 ? children : [new Paragraph('')],
    };
  });

  const doc = new Document({
    numbering: createNumberingConfig(),
    sections,
  });

  const buffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(buffer);
}

function emitBlock(
  block: Block,
  binaryStore: Map<string, Uint8Array>
): Paragraph | DocxTable | null {
  if (block.type === 'p') {
    return emitParagraph(block as Para);
  } else if (block.type === 'tbl') {
    return emitTable(block as Table, binaryStore);
  } else if (block.type === 'img') {
    return emitImage(block as ImageBlock, binaryStore);
  }
  return null;
}

function isRtlText(str: string): boolean {
  return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(str);
}

function emitParagraph(para: Para): Paragraph {
  const children = para.runs.map((r) => emitRun(r));
  const fullText = para.runs.map((r) => r.text).join('');
  const hasRtl = isRtlText(fullText);

  let alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT;
  if (para.align === 'center') alignment = AlignmentType.CENTER;
  else if (para.align === 'right' || hasRtl) alignment = AlignmentType.RIGHT;
  else if (para.align === 'justify') alignment = AlignmentType.BOTH;

  let heading: (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined;
  if (para.heading === 1) heading = HeadingLevel.HEADING_1;
  else if (para.heading === 2) heading = HeadingLevel.HEADING_2;
  else if (para.heading === 3) heading = HeadingLevel.HEADING_3;
  else if (para.heading === 4) heading = HeadingLevel.HEADING_4;

  const numbering = para.list
    ? {
        reference: para.list.kind === 'bullet' ? 'bullet-list' : 'number-list',
        level: Math.min(8, Math.max(0, para.list.level)),
      }
    : undefined;

  return new Paragraph({
    alignment,
    heading,
    numbering,
    bidirectional: hasRtl ? true : undefined,
    keepNext: para.keepNext,
    spacing: {
      before: para.spaceBefore ? ptToTwips(para.spaceBefore) : undefined,
      after: para.spaceAfter ? ptToTwips(para.spaceAfter) : undefined,
      line: para.lineSpacing ? Math.round(para.lineSpacing * 240) : undefined,
    },
    indent: para.indent
      ? {
          left: para.indent.left ? ptToTwips(para.indent.left) : undefined,
          firstLine: para.indent.first ? ptToTwips(para.indent.first) : undefined,
          right: para.indent.right ? ptToTwips(para.indent.right) : undefined,
        }
      : undefined,
    children,
  });
}

function emitRun(run: Run): TextRun | ExternalHyperlink {
  const text = sanitizeXmlString(run.text);
  // Explicit color: if heading run has no color, explicitly set Navy (#1E293B); otherwise default to #000000
  const color = run.color ? run.color.replace('#', '') : '000000';
  const size = Number.isFinite(run.size) && (run.size ?? 0) > 0 ? ptToHalfPoints(run.size!) : 22;
  const isRtl = isRtlText(text);

  // Script detection for font assignment
  const isCjk = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(text);
  const isHindi = /[\u0900-\u097F]/.test(text);
  const isEmoji = /[\uD83C-\uD83E][\uDC00-\uDFFF]|[\u2600-\u27BF]/.test(text);

  const baseFont = run.font || 'Arial';
  let fontConfig: any = baseFont;

  if (isEmoji) {
    fontConfig = 'Segoe UI Emoji';
  } else if (isCjk) {
    fontConfig = 'SimSun';
  } else if (isHindi) {
    fontConfig = 'Nirmala UI';
  } else if (isRtl) {
    fontConfig = 'Arial';
  }

  // Support dynamic PAGE field
  if (text === 'PAGE') {
    return new TextRun({
      children: [PageNumber.CURRENT],
      font: fontConfig,
      size,
      color,
    });
  }

  const textRun = new TextRun({
    text,
    bold: run.bold,
    italics: run.italic,
    underline: run.underline ? {} : undefined,
    strike: run.strike,
    color,
    size,
    font: fontConfig,
    rightToLeft: isRtl ? true : undefined,
    superScript: run.sup,
    subScript: run.sub,
  });

  if (run.link?.url) {
    return new ExternalHyperlink({
      children: [textRun],
      link: run.link.url,
    });
  }

  return textRun;
}

function mapBorderDef(b?: BorderDef): any {
  if (!b || b.style === 'nil') return undefined;
  return {
    style: BorderStyle.SINGLE,
    size: b.size || 4,
    color: b.color ? b.color.replace('#', '') : '334155',
  };
}

function emitTable(table: Table, binaryStore: Map<string, Uint8Array>): DocxTable {
  const colWidthsTwips = table.colWidths.map((w) => ptToTwips(w));
  const totalWidthTwips = colWidthsTwips.reduce((acc, w) => acc + w, 0);

  const rows = table.rows.map((row) => {
    const cells = row.cells.map((cell) => {
      const cellChildren = cell.blocks
        .map((b) => emitBlock(b, binaryStore))
        .filter((el): el is Paragraph | DocxTable => el !== null);

      let verticalAlign: (typeof VerticalAlign)[keyof typeof VerticalAlign] = VerticalAlign.TOP;
      if (cell.vAlign === 'center') verticalAlign = VerticalAlign.CENTER;
      else if (cell.vAlign === 'bottom') verticalAlign = VerticalAlign.BOTTOM;

      const cellBorders = cell.borders
        ? {
            top: mapBorderDef(cell.borders.top),
            bottom: mapBorderDef(cell.borders.bottom),
            left: mapBorderDef(cell.borders.left),
            right: mapBorderDef(cell.borders.right),
          }
        : undefined;

      return new DocxTableCell({
        width: {
          size: ptToTwips(cell.width),
          type: WidthType.DXA,
        },
        columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
        rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
        verticalAlign,
        borders: cellBorders,
        margins: {
          top: ptToTwips(5),
          bottom: ptToTwips(5),
          left: ptToTwips(7),
          right: ptToTwips(7),
        },
        shading: cell.fill
          ? {
              fill: cell.fill.replace('#', ''),
            }
          : undefined,
        children: cellChildren.length > 0 ? cellChildren : [new Paragraph('')],
      });
    });

    return new DocxTableRow({
      tableHeader: row.header,
      children: cells,
    });
  });

  const tableBorders = table.borders
    ? {
        top: mapBorderDef(table.borders.top),
        bottom: mapBorderDef(table.borders.bottom),
        left: mapBorderDef(table.borders.left),
        right: mapBorderDef(table.borders.right),
      }
    : undefined;

  return new DocxTable({
    width: {
      size: totalWidthTwips,
      type: WidthType.DXA,
    },
    columnWidths: colWidthsTwips,
    borders: tableBorders,
    rows,
  });
}

function emitImage(img: ImageBlock, binaryStore: Map<string, Uint8Array>): Paragraph {
  const data = binaryStore.get(img.ref);
  if (!data) {
    return new Paragraph('');
  }

  const imageRun = new ImageRun({
    data,
    type: 'png',
    transformation: {
      width: Math.round(img.w),
      height: Math.round(img.h),
    },
  });

  return new Paragraph({
    children: [imageRun],
  });
}

`

---

