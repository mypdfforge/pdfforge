import React, { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle, AlertCircle, Download, X } from 'lucide-react'
import { addVersion, listVersions } from '../core/projects.ts'
import { addToHistory } from '../../utils/credits'
import { friendlyError } from '../session.js'
import { ago } from '../ui-util.js'

const Modal = ({ title, onClose, children, busy }) => (
  <div className="pe-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
    <div className="pe-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><h3>{title}</h3>{!busy && <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={15} /></button>}</div>
      {children}
    </div>
  </div>
)
const fileName = (n) => n.replace(/\.pdf$/i, '') + '-edited.pdf'
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export function ExportDialog({ session, projectId, issues, onClose, onSelect }) {
  const blocking = issues.all.filter((i) => i.kind === 'overflow' || i.kind === 'collision')
  const [phase, setPhase] = useState(blocking.length ? 'confirm' : 'run')
  const [prog, setProg] = useState({ done: 0, total: 0 })
  const [res, setRes] = useState(null), [err, setErr] = useState('')
  const started = useRef(false)
  const name = fileName(session.doc.name)
  useEffect(() => {
    if (phase !== 'run' || started.current) return
    started.current = true
    ;(async () => {
      try {
        const r = await session.exportPdf((done, total) => setProg({ done, total }))
        setRes(r)
        if (r.validation.ok) {
          saveBlob(r.blob, name)
          addToHistory({ id: `editor-${Date.now()}`, name, toolLabel: 'Resume Editor', originalSize: session.bytes.length, outputSize: r.blob.size, outputUrl: null })
          if (projectId) addVersion(projectId, `Export ${new Date().toLocaleTimeString()}`, r.doc).catch(() => {})
        }
        setPhase('done')
      } catch (e) {
        if (e?.code === 'cancelled') return onClose()
        setErr(friendlyError(e)); setPhase('error')
      }
    })()
  }, [phase])
  const busy = phase === 'run'
  return (
    <Modal title="Export PDF" onClose={onClose} busy={busy}>
      {phase === 'confirm' && (<>
        <p className="pe-muted" style={{ marginBottom: 8 }}>Some edited text does not fit its original space:</p>
        {blocking.slice(0, 6).map((i, k) => <div key={k} className="pe-card pe-warn" style={{ marginBottom: 6, cursor: 'pointer' }} onClick={() => onSelect({ kind: session.doc.blocks?.some((b) => b.id === i.id) ? 'block' : 'el', id: i.id }, session.doc.els[i.id]?.page)}>{i.message}</div>)}
        {blocking.length > 6 && <div className="pe-muted">…and {blocking.length - 6} more</div>}
        <div className="pe-actions"><button className="btn btn-primary" onClick={onClose}>Go back and fix</button><button className="btn btn-ghost" onClick={() => setPhase('run')}>Export anyway</button></div>
      </>)}
      {phase === 'run' && (<>
        <p className="pe-muted"><Loader2 size={13} className="spin" style={{ verticalAlign: -2 }} /> Building your PDF on this device… {prog.total ? `page ${prog.done} of ${prog.total}` : ''}</p>
        <div className="pe-progress"><i style={{ width: prog.total ? `${(prog.done / prog.total) * 100}%` : '8%' }} /></div>
        <div className="pe-actions"><button className="btn btn-ghost" onClick={() => session.cancelExport()}>Cancel</button></div>
      </>)}
      {phase === 'done' && res && (<>
        {res.validation.ok
          ? <div className="pe-card" data-testid="export-ok"><CheckCircle size={14} className="pe-ok" style={{ verticalAlign: -2 }} /> <b>Downloaded {name}</b>
              <div className="pe-muted" style={{ marginTop: 4 }}>Verified by reopening the file: {res.validation.pageCount} page{res.validation.pageCount > 1 ? 's' : ''}, {res.validation.checked} edit{res.validation.checked === 1 ? '' : 's'} found, original text removed.</div></div>
          : <div className="pe-card pe-err" data-testid="export-bad"><AlertCircle size={14} style={{ verticalAlign: -2 }} /> <b>The exported file did not pass verification, so it was not downloaded automatically.</b>
              <div className="pe-muted" style={{ marginTop: 4 }}>{res.validation.pageCount !== res.validation.expectedPages && `Expected ${res.validation.expectedPages} pages, found ${res.validation.pageCount}. `}{res.validation.missing.length ? `Missing: "${res.validation.missing[0]}". ` : ''}{res.validation.leftovers.length ? `Old text still present: "${res.validation.leftovers[0]}".` : ''}</div></div>}
        {res.report.warnings.length > 0 && <div className="pe-card pe-warn" style={{ marginTop: 8 }}>{[...new Set(res.report.warnings)].slice(0, 4).map((w, i) => <div key={i}>{w}</div>)}</div>}
        <FontNotes doc={res.doc} />
        <div className="pe-actions"><button className="btn btn-primary" onClick={() => saveBlob(res.blob, name)}><Download size={14} /> {res.validation.ok ? 'Download again' : 'Download anyway'}</button><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
      </>)}
      {phase === 'error' && (<><div className="pe-card pe-err"><AlertCircle size={14} style={{ verticalAlign: -2 }} /> {err}</div><div className="pe-actions"><button className="btn btn-ghost" onClick={onClose}>Close</button></div></>)}
    </Modal>
  )
}

function FontNotes({ doc }) {
  const subs = [...new Set(doc.order.map((k) => doc.els[k]).filter((e) => !e.deleted && (e.text !== e.originalText || e.created) && e.fidelity === 'substituted').map((e) => e.mappedFont.replace(/^[A-Z]{6}\+/, '')))]
  if (!subs.length) return null
  return <div className="pe-muted" style={{ marginTop: 8 }}>Edited text that used {subs.join(', ')} was set in the closest standard font. Unedited text keeps its original font.</div>
}

export function FindDialog({ store, onClose, notify }) {
  const [find, setFind] = useState(''), [rep, setRep] = useState(''), [cs, setCs] = useState(false)
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const d = store.doc
  const count = find ? [...d.order.map((k) => d.els[k]).filter((e) => !e.locked && !e.deleted).map((e) => e.text), ...(d.mode === 'reflow' ? (d.blocks || []).map((b) => b.text) : [])].reduce((n, t) => n + (t.match(new RegExp(esc, cs ? 'g' : 'gi')) || []).length, 0) : 0
  return (
    <Modal title="Find & replace" onClose={onClose}>
      <div style={{ display: 'grid', gap: 8 }}>
        <input autoFocus aria-label="Find" placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} />
        <input aria-label="Replace with" placeholder="Replace with" value={rep} onChange={(e) => setRep(e.target.value)} />
        <label className="pe-muted"><input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> Match case</label>
        <div className="pe-muted">{find ? `${count} match${count === 1 ? '' : 'es'} in editable text` : 'Locked text is never changed.'}</div>
      </div>
      <div className="pe-actions"><button className="btn btn-primary" disabled={!find || !count} onClick={() => { const n = store.findReplace(find, rep, cs); notify(`Replaced ${n}`); onClose() }}>Replace all</button><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
    </Modal>
  )
}

export function VersionsDialog({ store, projectId, onClose, notify }) {
  const [list, setList] = useState(null)
  useEffect(() => { listVersions(projectId).then(setList).catch(() => setList([])) }, [])
  return (
    <Modal title="Version history" onClose={onClose}>
      <p className="pe-muted">Snapshots are stored only in this browser. One is added on every export.</p>
      <div className="pe-actions"><button className="btn btn-ghost" onClick={async () => { setList(await addVersion(projectId, 'Manual snapshot', store.doc)); notify('Snapshot saved') }}>Save snapshot now</button></div>
      <div style={{ marginTop: 10 }}>
        {list === null && <Loader2 size={14} className="spin" />}
        {list && !list.length && <div className="pe-muted">No snapshots yet.</div>}
        {list && list.map((v) => (
          <div key={v.id} className="pe-proj"><div><b>{v.label}</b><span className="pe-muted">{ago(v.at)}</span></div>
            <button className="btn btn-ghost" onClick={() => { if (confirm('Restore this version? Your current state stays in undo history.')) { store.commit('Restore version', () => v.doc); notify('Version restored'); onClose() } }}>Restore</button></div>
        ))}
      </div>
    </Modal>
  )
}
