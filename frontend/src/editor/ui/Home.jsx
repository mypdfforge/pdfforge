import React, { useRef, useState } from 'react'
import { Upload, Trash2, Copy, FileText, ShieldCheck, Pencil } from 'lucide-react'
import { ago, mb } from '../ui-util.js'

export default function Home({ projects, storageOk, onFile, onOpen, onDelete, onDuplicate, onRename, busy }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)
  const pick = (files) => { const f = [...(files || [])].find((x) => /pdf$/i.test(x.name) || x.type === 'application/pdf') || files?.[0]; if (f) onFile(f) }
  return (
    <div className="pe-home">
      <h1>Resume &amp; PDF Editor</h1>
      <p className="pe-muted" style={{ fontSize: 14 }}>Edit text, fonts and colours directly on the page. Everything happens in your browser.</p>
      <div className="badge badge-browser" style={{ marginTop: 10 }}><ShieldCheck size={12} /> Your PDF never leaves this device. No upload, no server processing.</div>
      <div className={`pe-drop${over ? ' over' : ''}`} role="button" tabIndex={0}
        onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files) }}>
        <Upload size={26} style={{ color: 'var(--brand)' }} />
        <div style={{ fontWeight: 600, marginTop: 8 }}>{busy ? 'Opening…' : 'Drop a PDF here, or click to choose'}</div>
        <div className="pe-muted">Up to 50 MB · 200 pages</div>
        <input ref={input} data-testid="file-input" type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
      </div>
      <h4 className="pe-muted" style={{ textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Your documents (saved in this browser only)</h4>
      {!storageOk && <div className="pe-card pe-warn pe-muted">Local storage is unavailable (private browsing?). You can still edit and export, but work will not be saved between visits.</div>}
      {storageOk && !projects.length && <div className="pe-muted">Nothing saved yet. Documents you edit are autosaved here and can be reopened later.</div>}
      {projects.map((p) => (
        <div className="pe-proj" key={p.id}>
          <FileText size={18} style={{ color: 'var(--text3)' }} />
          <div><b>{p.name}</b><span className="pe-muted">{p.pages} page{p.pages > 1 ? 's' : ''} · {mb(p.size)} · {p.edits} edit{p.edits === 1 ? '' : 's'} · {ago(p.updatedAt)}</span></div>
          <button className="btn btn-primary" onClick={() => onOpen(p.id)}>Open</button>
          <button className="icon-btn" title="Rename" aria-label={`Rename ${p.name}`} onClick={() => { const n = prompt('Rename document', p.name); if (n && n.trim()) onRename(p.id, n.trim()) }}><Pencil size={15} /></button>
          <button className="icon-btn" title="Duplicate" aria-label={`Duplicate ${p.name}`} onClick={() => onDuplicate(p.id)}><Copy size={15} /></button>
          <button className="icon-btn" title="Delete" aria-label={`Delete ${p.name}`} onClick={() => confirm(`Delete "${p.name}" from this browser? This cannot be undone.`) && onDelete(p.id)}><Trash2 size={15} /></button>
        </div>
      ))}
    </div>
  )
}
