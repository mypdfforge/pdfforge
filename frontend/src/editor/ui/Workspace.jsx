import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback } from 'react'
import { TopBar, FormatBar } from './Toolbar.jsx'
import Inspector from './Inspector.jsx'
import { ExportDialog, FindDialog, VersionsDialog } from './Dialogs.jsx'
import { rectToCss, cssToPdf } from '../core/geometry.ts'
import { saveDoc, addVersion, isStorageError } from '../core/projects.ts'
import { FONT_CSS, hex, sampleBackground } from '../ui-util.js'

const useStore = (s) => useSyncExternalStore(s.subscribe, s.getVersion)

function useVisible(ref, margin = '900px') {
  const [v, setV] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setV(true); return }
    const io = new IntersectionObserver(([e]) => setV(e.isIntersecting), { rootMargin: margin })
    io.observe(el); return () => io.disconnect()
  }, [ref, margin])
  return v
}

function TextEditor({ store, doc, target, rect, pageBox, zoom, onDone }) {
  const isBlock = target.kind === 'block'
  const obj = isBlock ? doc.blocks.find((b) => b.id === target.id) : doc.els[target.id]
  const [val, setVal] = useState(obj.text)
  const ref = useRef(null)
  const done = useRef(false)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const s = obj.style
  const css = rectToCss(pageBox, zoom, rect)
  const wrap = isBlock || obj.wrap
  const regionW = (isBlock ? obj.width : Math.max(obj.maxW, rect.w)) * zoom
  const lines = val.split('\n').length
  const width = wrap ? regionW : Math.max(regionW, css.width + 24)
  const lh = s.size * zoom * s.lineHeight
  const measure = store.m.width(val.split('\n').reduce((a, b) => (b.length > a.length ? b : a), ''), s)
  const over = !wrap && !isBlock && measure > obj.maxW + 0.5
  const commit = () => {
    if (done.current) return; done.current = true
    if (val !== obj.text) isBlock ? store.setBlockText(obj.id, val) : store.setText(obj.id, val)
    onDone()
  }
  const cancel = () => { done.current = true; onDone() }
  return (
    <>
      <textarea ref={ref} className={`pe-edit${wrap ? ' wrap' : ''}`} aria-label="Edit text" data-testid="text-editor" value={val} wrap={wrap ? 'soft' : 'off'}
        onChange={(e) => setVal(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') cancel(); else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() } }}
        style={{ left: css.left - 2, top: css.top - 2, width, height: Math.max(css.height, lines * lh) + 4, fontFamily: FONT_CSS[s.family], fontSize: s.size * zoom, lineHeight: `${lh}px`, fontWeight: s.bold ? 700 : 400, fontStyle: s.italic ? 'italic' : 'normal', color: hex(s.color), textAlign: s.align === 'justify' ? 'left' : s.align, letterSpacing: s.charSpacing * zoom, textDecoration: [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ') || 'none' }} />
      <div className={`pe-hint${over ? ' bad' : ''}`} style={{ left: css.left, top: css.top + Math.max(css.height, lines * lh) + 8 }}>
        {over ? `Wider than its region by ${Math.round(measure - obj.maxW)} pt: it will be flagged` : 'Enter to apply · Shift+Enter new line · Esc to cancel'}
      </div>
    </>
  )
}

function PageView({ session, store, doc, index, zoom, boxOf, overlays, issues, editing, setEditing, tool, setTool, canvasRefs, notify }) {
  const wrap = useRef(null), canvas = useRef(null)
  const visible = useVisible(wrap)
  const pp = session.plan().pages[index]
  const sig = session.sig(index)
  const pageBox = boxOf(index)
  useEffect(() => { canvasRefs.current[index] = canvas.current; return () => { delete canvasRefs.current[index] } }, [index])
  useEffect(() => {
    const c = canvas.current
    if (!visible) { if (c) { c.width = 0; c.height = 0 } return }
    const t = session.renderPage(c, index, zoom)
    return () => t.cancel()
  }, [visible, sig, zoom, session, index])
  const sel = store.selection
  const onPageDown = (e) => {
    if (tool !== 'add' || e.target.closest('.pe-ov')) return
    const r = wrap.current.getBoundingClientRect()
    const [x, y] = cssToPdf(pageBox, zoom, e.clientX - r.left, e.clientY - r.top)
    const id = store.addText(Math.min(index, doc.pages.length - 1), x, y)
    setTool(null); setEditing({ kind: 'el', id })
  }
  const items = overlays[index] || []
  return (
    <div ref={wrap} className={`pe-page${pp.src === null ? ' added' : ''}${tool === 'add' ? ' tool-add' : ''}`} data-page={index} data-testid={`page-${index}`}
      style={{ width: pp.w * zoom, height: pp.h * zoom }} onMouseDown={onPageDown}>
      <canvas ref={canvas} aria-label={`Page ${index + 1}`} />
      {visible && items.map((o) => {
        const c = rectToCss(pageBox, zoom, o.rect)
        const bad = (issues.byId[o.id] || []).some((i) => i.kind === 'overflow' || i.kind === 'collision')
        const isSel = sel && sel.kind === o.kind && sel.id === o.id
        const text = o.kind === 'block' ? doc.blocks.find((b) => b.id === o.id)?.text : doc.els[o.id]?.text
        const lockReason = o.locked ? doc.els[o.id]?.locked : null
        const open = () => lockReason ? notify(lockReason) : setEditing({ kind: o.kind, id: o.id, rect: o.rect, page: index })
        return (
          <div key={o.key} role="button" tabIndex={0} data-testid="ov" data-id={o.id} aria-label={`${o.locked ? 'Locked text' : 'Text'}: ${text}`}
            className={`pe-ov${isSel ? ' sel' : ''}${o.changed ? ' chg' : ''}${bad ? ' bad' : ''}${o.locked ? ' lock' : ''}${store.painter ? ' paint' : ''}`}
            style={{ left: c.left - 1, top: c.top - 1, width: c.width + 2, height: c.height + 2, display: editing && editing.kind === o.kind && editing.id === o.id ? 'none' : undefined }}
            title={lockReason || undefined}
            onClick={(e) => { e.stopPropagation(); if (store.painter) { if (lockReason) notify(lockReason); else store.paintOn({ kind: o.kind, id: o.id }) } else if (tool !== 'add') store.select({ kind: o.kind, id: o.id }) }}
            onDoubleClick={(e) => { e.stopPropagation(); if (!store.painter) open() }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); store.select({ kind: o.kind, id: o.id }); open() } else if (e.key === ' ') { e.preventDefault(); store.select({ kind: o.kind, id: o.id }) } }} />
        )
      })}
      {editing && editing.page === index && editing.rect && (
        <TextEditor store={store} doc={doc} target={editing} rect={editing.rect} pageBox={pageBox} zoom={zoom} onDone={() => setEditing(null)} />
      )}
    </div>
  )
}

function Thumb({ session, index, active, onClick, sigKey }) {
  const wrap = useRef(null), canvas = useRef(null)
  const visible = useVisible(wrap, '400px')
  const pp = session.plan().pages[index]
  useEffect(() => {
    if (!visible) return
    const t = session.renderPage(canvas.current, index, 0.17)
    return () => t.cancel()
  }, [visible, sigKey, session, index])
  return (
    <button ref={wrap} className={`pe-thumb${active ? ' on' : ''}`} onClick={onClick} aria-label={`Go to page ${index + 1}`} aria-current={active ? 'page' : undefined}>
      <canvas ref={canvas} style={{ width: pp.w * 0.17, height: pp.h * 0.17 }} /><span>{index + 1}</span>
    </button>
  )
}

export default function Workspace({ session, projectId, onClose }) {
  const store = session.store
  useStore(store)
  const doc = store.doc
  const plan = session.plan()
  const { pages: overlays, pageCount } = session.overlays()
  const issues = store.issues()
  const [zoom, setZoom] = useState(1)
  const [editing, setEditing] = useState(null)
  const [tool, setTool] = useState(null)
  const [cur, setCur] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [side, setSide] = useState(false)
  const [toast, setToast] = useState('')
  const [save, setSave] = useState({ state: projectId ? 'saved' : 'off', detail: projectId ? '' : 'Local storage unavailable: work is not saved between visits.' })
  const canvasRefs = useRef({}), scroller = useRef(null), toastT = useRef(0)
  const notify = useCallback((m) => { setToast(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(''), 4500) }, [])

  const boxOf = (i) => { const p = doc.pages[Math.min(i, doc.pages.length - 1)]; const pp = plan.pages[i]; return { x0: p.x0, y0: p.y0, width: pp.w, height: pp.h } }
  useEffect(() => { // fit width on open
    const w = scroller.current?.clientWidth; if (w) setZoom(Math.max(0.5, Math.min(1.4, +((w - 48) / doc.pages[0].width).toFixed(2))))
  }, [])

  // ---- autosave (debounced, serialised, never reports success before the write finished) ----
  const seq = useRef(0), saving = useRef(Promise.resolve()), timer = useRef(0)
  const flush = useCallback(() => {
    if (!projectId) return Promise.resolve()
    const mine = ++seq.current
    const doc0 = store.doc, edits = store.changedCount()
    setSave((s) => ({ ...s, state: 'saving' }))
    saving.current = saving.current.then(async () => {
      try {
        await saveDoc(projectId, doc0, edits)
        if (mine === seq.current) { if (store.doc === doc0) store.dirty = false; setSave({ state: store.doc === doc0 ? 'saved' : 'unsaved', detail: '' }) }
      } catch (e) {
        setSave({ state: 'failed', detail: isStorageError(e) ? 'Browser storage is full. Free up space or delete old documents; you can still export.' : 'Could not save to this browser. You can still export.' })
      }
    })
    return saving.current
  }, [projectId, store])
  useEffect(() => {
    if (!projectId || !store.dirty) return
    setSave((s) => (s.state === 'failed' ? s : { state: 'unsaved', detail: '' }))
    clearTimeout(timer.current); timer.current = setTimeout(flush, 1200)
    return () => clearTimeout(timer.current)
  }, [store.version])
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden' && store.dirty) flush() }
    const leave = (e) => { if (store.dirty && projectId) { flush(); e.preventDefault(); e.returnValue = '' } }
    document.addEventListener('visibilitychange', hide); window.addEventListener('beforeunload', leave)
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('beforeunload', leave); if (store.dirty) flush() }
  }, [flush])

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase()
      if (['input', 'textarea', 'select'].includes(tag) && !(e.ctrlKey || e.metaKey)) return
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase()
      if (mod && k === 'z' && !['textarea'].includes(tag)) { e.preventDefault(); e.shiftKey ? store.redo() : store.undo() }
      else if (mod && k === 'y') { e.preventDefault(); store.redo() }
      else if (mod && k === 's') { e.preventDefault(); flush(); notify('Saved in this browser') }
      else if (mod && ['b', 'i', 'u'].includes(k) && store.selection && tag !== 'textarea') { e.preventDefault(); const t = store.selection; const s = t.kind === 'block' ? doc.blocks.find((b) => b.id === t.id)?.style : doc.els[t.id]?.style; if (s) store.setStyle(k === 'b' ? { bold: !s.bold } : k === 'i' ? { italic: !s.italic } : { underline: !s.underline }) }
      else if (mod && (k === '=' || k === '+')) { e.preventDefault(); setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2))) }
      else if (mod && k === '-') { e.preventDefault(); setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2))) }
      else if (e.key === 'Escape') { store.cancelPainter(); setTool(null); if (!editing) store.select(null) }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selection && !editing && !['input', 'select'].includes(tag)) { e.preventDefault(); store.deleteSelected() }
      else if (e.key.startsWith('Arrow') && e.altKey && store.selection?.kind === 'el' && !editing && doc.mode === 'design' && !['input', 'select', 'textarea'].includes(tag)) {
        const d = e.shiftKey ? 10 : 1
        const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key]
        if (mv) { e.preventDefault(); store.moveElement(store.selection.id, mv[0], mv[1]) }
      }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [store, doc, editing, flush, notify])

  const sel = store.selection
  const target = sel ? (sel.kind === 'block' ? doc.blocks?.find((b) => b.id === sel.id) : doc.els[sel.id]) : null
  const style = target && (sel.kind === 'el' ? (!target.locked || target.cover || target.created ? target.style : null) : target.style)
  const match = useMemo(() => (sel ? store.matchSelection() : { els: [], blocks: [] }), [sel, doc])
  const matchCount = match.els.length + match.blocks.length

  const switchMode = (mode) => {
    if (mode === doc.mode) return
    if (mode === 'design' && doc.mode === 'reflow' && store.changedCount() && !confirm('Switching back to Design Lock discards paragraph-level reflow changes (you can undo this). Continue?')) return
    if (mode === 'reflow' && !confirm('Document Reflow rebuilds paragraphs from the page text. Text you edit is redrawn in the closest standard font; untouched text keeps its original font. Continue?')) return
    const { notes } = store.setMode(mode)
    if (notes[0]) notify(notes[0])
  }
  const coverLocked = (el) => {
    const pg = doc.pages[el.page], canvas = canvasRefs.current[el.page]
    const { color, uniform } = canvas ? sampleBackground(canvas, el.origBox, pg, zoom) : { color: [1, 1, 1], uniform: false }
    if (!confirm(`This replaces the original text with a flat ${uniform ? 'background colour sampled from the page' : 'white box (the background here is not uniform, so graphics underneath will be hidden)'}. Continue?`)) return
    store.coverLocked(el.id, color)
  }
  // current page = first page whose bottom edge is still below the top of the scroll area
  const updateCur = useCallback(() => {
    const sc = scroller.current; if (!sc) return
    const top = sc.getBoundingClientRect().top + 60
    for (const el of sc.querySelectorAll('[data-page]')) { if (el.getBoundingClientRect().bottom > top) { setCur(+el.dataset.page); return } }
  }, [])
  const rafId = useRef(0)
  const onScroll = () => { cancelAnimationFrame(rafId.current); rafId.current = requestAnimationFrame(updateCur) }
  useEffect(() => { updateCur() }, [zoom, pageCount])
  const goto = (i) => { setCur(i); wrapScroll(i) }
  const wrapScroll = (i) => scroller.current?.querySelector(`[data-page="${i}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  useEffect(() => { if (session.notes?.[0]) notify(session.notes[0]) }, [])
  const sigs = plan.pages.map((_, i) => session.sig(i))

  return (
    <div className="pe" data-testid="workspace" data-engine={session.engine.mode}>
      <TopBar doc={doc} store={store} saveState={save.state} saveDetail={save.detail} zoom={zoom} setZoom={setZoom}
        onBack={async () => { await flush(); onClose() }} onRename={(n) => store.commit('Rename', (d) => ({ ...d, name: n }))}
        onExport={() => { setEditing(null); setDialog('export') }} onFind={() => setDialog('find')} onVersions={() => setDialog('versions')} canVersions={!!projectId}
        onMode={switchMode} exporting={!!session.exporting} toggleSide={() => setSide((v) => !v)} />
      <FormatBar store={store} target={sel} style={style} tool={tool} setTool={setTool} matchCount={matchCount}
        onApplyAll={() => { const s = style; store.applyToAll(match, { family: s.family, bold: s.bold, italic: s.italic, size: s.size, color: s.color, underline: s.underline, strike: s.strike, highlight: s.highlight, align: s.align, lineHeight: s.lineHeight, charSpacing: s.charSpacing, wordSpacing: s.wordSpacing }, 'Apply to matching'); notify(`Applied to ${matchCount} items`) }} />
      <div className="pe-body">
        <nav className="pe-thumbs" aria-label="Pages">
          {plan.pages.map((_, i) => <Thumb key={i} session={session} index={i} active={cur === i} sigKey={sigs[i]} onClick={() => goto(i)} />)}
        </nav>
        <div className="pe-canvas" ref={scroller} onScroll={onScroll} onClick={() => !editing && !store.painter && store.select(null)}>
          {plan.pages.map((_, i) => (
            <PageView key={i} session={session} store={store} doc={doc} index={i} zoom={zoom} boxOf={boxOf} overlays={overlays} issues={issues}
              editing={editing} setEditing={setEditing} tool={tool} setTool={setTool} canvasRefs={canvasRefs} notify={notify} />
          ))}
        </div>
        <aside className={`pe-side${side ? ' open' : ''}`} aria-label="Properties">
          <Inspector session={session} store={store} doc={doc} sel={sel} target={target} issues={issues} pageCount={pageCount} cur={cur}
            onMode={switchMode} onCover={coverLocked} onEdit={(t) => { const o = overlays.flat().find((x) => x.kind === t.kind && x.id === t.id); if (o) setEditing({ ...t, rect: o.rect, page: overlays.findIndex((p) => p.includes(o)) }) }} onSelect={(t, page) => { store.select(t); if (page != null) goto(page) }} />
        </aside>
      </div>
      {toast && <div className="pe-toast" role="status">{toast}</div>}
      {dialog === 'export' && <ExportDialog session={session} projectId={projectId} issues={issues} onClose={() => setDialog(null)} onSelect={(t, page) => { setDialog(null); store.select(t); if (page != null) goto(page) }} />}
      {dialog === 'find' && <FindDialog store={store} onClose={() => setDialog(null)} notify={notify} />}
      {dialog === 'versions' && <VersionsDialog store={store} projectId={projectId} onClose={() => setDialog(null)} notify={notify} />}
    </div>
  )
}
