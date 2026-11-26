import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { convertPdfToPptx } from '../engine/engineHost.js'

const FRIENDLY = {
  ENCRYPTED: 'This PDF is password-protected. Remove the password and try again.',
  INVALID_PDF: 'This file is not a valid or readable PDF.',
  TOO_LARGE: null,
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

const makeId = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`)
export const outputName = (file) => (file.name || 'presentation').replace(/\.pdf$/i, '') + '.pptx'

export function usePdfToPptx() {
  const [items, dispatch] = useReducer(reducer, [])
  const [running, setRunning] = useState(false)
  const [mode, setMode] = useState('editable')
  const [slideLayout, setSlideLayout] = useState('auto')

  const itemsRef = useRef(items)
  itemsRef.current = items
  const optsRef = useRef({ mode, slideLayout })
  optsRef.current = { mode, slideLayout }

  const filesRef = useRef(new Map())
  const blobsRef = useRef(new Map())
  const controllers = useRef(new Map())
  const queueRef = useRef([])
  const runningRef = useRef(false)
  const mounted = useRef(true)
  const lastPatch = useRef(new Map())

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
      if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''))) {
        rejected.push(file.name || 'file')
        continue
      }
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
    if (!file || (current && current.status !== 'ready')) return
    const ctl = new AbortController()
    controllers.current.set(id, ctl)
    lastPatch.current.set(id, { t: 0, stage: '' })
    patch(id, { status: 'converting', percent: 0, message: 'Starting conversion…', stage: 'loading', startedAt: Date.now(), error: undefined, errorCode: undefined })
    try {
      const { mode: curMode, slideLayout: curLayout } = optsRef.current
      const res = await convertPdfToPptx(file, {
        mode: curMode,
        slideLayout: curLayout,
        signal: ctl.signal,
        onProgress: (p) => {
          const lp = lastPatch.current.get(id)
          const t = performance.now()
          if (lp && t - lp.t < 120 && lp.stage === p.stage && p.percent < 100) return
          lastPatch.current.set(id, { t, stage: p.stage })
          patch(id, {
            percent: p.percent, message: p.message, stage: p.stage, page: p.page, totalPages: p.totalPages,
            pagesPerSec: p.pagesPerSec, etaSec: p.etaSec, warningCount: p.warnings,
          })
        },
      })
      if (!mounted.current || !filesRef.current.has(id)) return
      blobsRef.current.set(id, res.blob)
      patch(id, {
        status: 'done', percent: 100, message: 'Done', stage: 'done', hasResult: true,
        warnings: res.warnings || [], warningCount: (res.warnings || []).length, stats: res.stats,
      })
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

  const start = useCallback(async () => {
    if (runningRef.current) return
    for (const i of itemsRef.current) if (i.status === 'ready' && !queueRef.current.includes(i.id)) queueRef.current.push(i.id)
    if (!queueRef.current.length) return
    runningRef.current = true
    setRunning(true)
    try {
      while (mounted.current) {
        for (const i of itemsRef.current) if (i.status === 'ready' && !queueRef.current.includes(i.id)) queueRef.current.push(i.id)
        const id = queueRef.current.shift()
        if (!id) break
        try { await processOne(id) } catch (e) { patch(id, { status: 'error', error: e?.message || 'Conversion failed.', errorCode: 'INTERNAL' }) }
        await new Promise((r) => setTimeout(r, 0))
      }
    } finally {
      runningRef.current = false
      if (mounted.current) setRunning(false)
    }
  }, [processOne, patch])

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

  return {
    items, running, mode, setMode, slideLayout, setSlideLayout,
    addFiles, start, cancel, cancelAll, remove, retry, clear, getBlob, download,
  }
}
