import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { checkCapabilities } from '../engine/capabilities.js'
import { convertToPdf, warmEngine, isEngineCached } from '../engine/engineHost.js'
import { probeDocument } from '../lib/probe.js'

/**
 * item.status: checking | ready | converting | done | error | cancelled
 */

function reducer(items, action) {
  switch (action.type) {
    case 'add':
      return [...items, ...action.items]
    case 'patch':
      return items.map((i) => (i.id === action.id ? { ...i, ...action.patch } : i))
    case 'remove':
      return items.filter((i) => i.id !== action.id)
    case 'clear':
      return items.filter((i) => i.status === 'converting')
    default:
      return items
  }
}

export function useWordToPdf() {
  const [items, dispatch] = useReducer(reducer, [])
  const [running, setRunning] = useState(false)
  const [engineCached, setEngineCached] = useState(false)
  const [caps] = useState(checkCapabilities)

  const itemsRef = useRef(items)
  itemsRef.current = items
  const controllers = useRef(new Map())
  const runningRef = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    isEngineCached().then((v) => mounted.current && setEngineCached(v))
    const map = controllers.current
    return () => {
      mounted.current = false
      map.forEach((c) => c.abort())
    }
  }, [])

  const patch = useCallback((id, p) => {
    if (mounted.current) dispatch({ type: 'patch', id, patch: p })
  }, [])

  const addFiles = useCallback((files) => {
    if (!caps.ok || !files.length) return
    const created = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: 'checking',
      hasCjk: false,
      percent: 0,
      message: '',
    }))
    dispatch({ type: 'add', items: created })

    created.forEach(async (item) => {
      const probe = await probeDocument(item.file)
      if (!probe.ok) {
        patch(item.id, { status: 'error', error: probe.message })
        return
      }
      patch(item.id, { status: 'ready', hasCjk: probe.hasCjk })
      warmEngine({ needsCjk: probe.hasCjk }) // never throws, skips on weak devices
    })
  }, [caps.ok, patch])

  const start = useCallback(async () => {
    if (runningRef.current || !caps.ok) return
    runningRef.current = true
    setRunning(true)
    const seen = new Set()
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === 'ready' && !seen.has(i.id))
        if (!next) break
        seen.add(next.id)

        const ctl = new AbortController()
        controllers.current.set(next.id, ctl)
        patch(next.id, { status: 'converting', percent: 0, message: 'Starting...', phase: 'starting' })
        try {
          const pdf = await convertToPdf(next.file, {
            needsCjk: next.hasCjk,
            signal: ctl.signal,
            onProgress: (p) => patch(next.id, p),
          })
          patch(next.id, { status: 'done', percent: 100, pdf })
          isEngineCached().then((v) => mounted.current && setEngineCached(v))
        } catch (err) {
          if (err?.code === 'ABORTED') patch(next.id, { status: 'cancelled' })
          else patch(next.id, { status: 'error', error: err?.message || 'Conversion failed.' })
        } finally {
          controllers.current.delete(next.id)
        }
      }
    } finally {
      runningRef.current = false
      if (mounted.current) setRunning(false)
    }
  }, [caps.ok, patch])

  const cancel = useCallback((id) => {
    const ctl = controllers.current.get(id)
    if (ctl) ctl.abort()
    else dispatch({ type: 'remove', id })
  }, [])

  const remove = useCallback((id) => dispatch({ type: 'remove', id }), [])
  const clear = useCallback(() => dispatch({ type: 'clear' }), [])

  return { items, running, caps, engineCached, addFiles, start, cancel, remove, clear }
}
