import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import {
  Upload, Loader2, CheckCircle, AlertCircle, FileText, X, ZoomIn, RotateCw, RotateCcw,
  Undo2, GripVertical, ChevronUp, ChevronDown, ShieldCheck,
} from 'lucide-react'
import { downloadBlob } from '../utils/api'
import { formatBytes } from '../utils/credits'
import { getThumbnailsProgressive, getFullResPage, evictFromCache } from '../utils/thumbCache'
import { loadDoc, dropDoc, moveFilePages, byFileOrder, mergePages } from '../utils/mergeClient'

const W = 140, H = 180
// each file gets its color once, when added, so it never changes when files are reordered (cycles after 6 files)
const DOC_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4']
let seq = 0

// Layout: root is exactly viewport high, so the sidebar and the canvas each own their scrollbar
// Copied directly from MergeToolPage.jsx for 100% visual and interactive consistency.
const CSS = `
.mp-root{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden}
.mp-wrap{display:flex;flex:1;min-height:0;overflow:hidden}
.mp-side{width:300px;flex-shrink:0;min-height:0;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--bg)}
.mp-top{padding:14px 14px 0;display:flex;flex-direction:column;gap:10px;flex-shrink:0}
.mp-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
.mp-foot{flex-shrink:0;padding:12px 14px;border-top:1px solid var(--border);background:var(--bg);box-shadow:0 -6px 14px -8px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:8px}
.mp-canvas{flex:1;min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:16px 24px 24px}
.mp-card{transition:transform .18s ease,opacity .15s}
.mp-actions{opacity:0;transition:opacity .12s}
.mp-card:hover .mp-actions,.mp-card:focus-within .mp-actions{opacity:1}
.mp-card:hover .mp-thumb{border-color:var(--brand)}
@media (hover:none){.mp-actions{opacity:1}}
@keyframes mpPulse{0%,100%{opacity:1}50%{opacity:.5}}
@media (max-width:768px){
  .mp-root{height:auto;overflow:visible}
  .mp-wrap{flex-direction:column;overflow:visible}
  .mp-side{width:100%;border-right:none;border-bottom:1px solid var(--border)}
  .mp-list{flex:none;max-height:220px}
  .mp-foot{position:sticky;bottom:0;z-index:20}
  .mp-canvas{height:75vh;flex:none}
}
`

// ── Full-res zoom modal (copied from MergeToolPage) ───────────────────────────
function ZoomModal({ file, pageNum, rotation, onClose }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let off = false
    getFullResPage(file, pageNum, 1.8).then(t => { if (!off) setSrc(t.img) }).catch(() => { if (!off) onClose() })
    const key = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => { off = true; window.removeEventListener('keydown', key) }
  }, [file, pageNum, onClose])
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,.85)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <button className="btn btn-ghost" onClick={onClose} style={{ position:'absolute', top:16, right:16 }}><X size={14}/> Close</button>
      {src
        ? <img src={src} alt={`Page ${pageNum}`} style={{ maxWidth:'90vw', maxHeight:'90vh', background:'#fff', borderRadius:4, transform:`rotate(${rotation}deg)` }}/>
        : <Loader2 size={28} color="var(--brand)" className="spin"/>}
    </div>
  )
}

// ── One page card (copied from MergeToolPage with vertical action stack) ──────
const PageCard = React.memo(function PageCard({ pg, num, src, docN, color, h }) {
  const sideways = pg.rotation % 180 !== 0
  return (
    <div className="mp-card" style={{ position:'relative', width:W + 20, padding:'0 10px 16px' }} title={src}>
      <div style={{ position:'relative', width:W }}>
        <div className="mp-thumb" style={{ width:W, height:H, borderRadius:10, overflow:'hidden', border:`3px solid ${color}`, background:'var(--bg3)', display:'flex', alignItems:'center', justifyContent:'center', transition:'border-color .15s' }}>
          {pg.thumb
            ? <img src={pg.thumb} alt="" draggable={false}
                style={{ width:'100%', height:'100%', objectFit:'contain', background:'#fff', transform:`rotate(${pg.rotation}deg)${sideways ? ' scale(.77)' : ''}`, transition:'transform .2s' }}/>
            : <div style={{ width:'85%', height:'90%', borderRadius:4, background:'linear-gradient(90deg,var(--bg2) 25%,var(--bg3) 50%,var(--bg2) 75%)', backgroundSize:'200% 100%', animation:'shimmer 1.4s infinite' }}/>}
        </div>

        {/* Action icons stacked vertically on top-right (exact Merge Tool look) */}
        <div className="mp-actions" style={{ position:'absolute', top:8, right:8, display:'flex', flexDirection:'column', gap:5, zIndex:10 }}>
          <Act label="Zoom" bg="rgba(30,30,50,.9)" onClick={() => h.zoom(pg.id)}><ZoomIn size={13}/></Act>
          <Act label="Rotate 90° CW" bg="rgba(234,88,12,.9)" onClick={() => h.rotate([pg.id], 90)}><RotateCw size={13}/></Act>
          <Act label="Rotate 90° CCW" bg="rgba(234,88,12,.9)" onClick={() => h.rotate([pg.id], -90)}><RotateCcw size={13}/></Act>
          {pg.rotation !== 0 && (
            <Act label="Reset rotation" bg="rgba(229,83,75,.9)" onClick={() => h.resetRotation([pg.id])}><Undo2 size={13}/></Act>
          )}
        </div>

        {/* Page label and rotation badge */}
        <div style={{ textAlign:'center', marginTop:7, fontSize:11, fontWeight:600, color:'var(--text3)' }}>
          <div style={{ width:W, boxSizing:'border-box', margin:'0 auto 4px', padding:'3px 6px', borderRadius:6, background:color, color:'#fff', fontSize:11, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            Doc {docN} · p. {pg.origIdx + 1}
          </div>
          Page {num}
          {pg.rotation !== 0 && <span style={{ color:'var(--brand)', marginLeft:5, fontWeight:700 }}>{pg.rotation}°</span>}
        </div>
      </div>
    </div>
  )
})

const Act = ({ label, bg, onClick, children }) => (
  <button aria-label={label} title={label} onClick={e => { e.stopPropagation(); onClick() }}
    style={{ width:28, height:28, borderRadius:7, border:'none', background:bg, color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
    {children}
  </button>
)

// Helper: zip files separately, preserving per-page rotations
async function zipRotatedSeparately(files, pages, onProgress, opts) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip(), names = new Set()
  for (const [i, f] of files.entries()) {
    const base = f.name.replace(/\.pdf$/i, '') + '_rotated'
    let name = `${base}.pdf`, k = 2
    while (names.has(name)) name = `${base}-${k++}.pdf`
    names.add(name)
    const filePages = pages.filter(p => p.fileId === f.id)
    zip.file(name, await mergePages([f], filePages, null, opts))
    onProgress?.({ done: i + 1, total: files.length })
  }
  return zip.generateAsync({ type: 'blob' })
}

// ── RotateToolPage (Copied and adapted directly from MergeToolPage) ───────────
export default function RotateToolPage({ onBack }) {
  const [files, setFiles]   = useState([])
  const [pages, setPages]   = useState([])
  const [errs, setErrs]     = useState([])
  const [state, setState]   = useState('idle')
  const [pct, setPct]       = useState(0)
  const [keepForms, setKeepForms] = useState(true)
  const [zoom, setZoom]     = useState(null)
  const [fileOver, setFileOver] = useState(null)

  const filesRef  = useRef([])
  const pagesRef  = useRef([])
  const fileDrag  = useRef(null)
  const stopRef   = useRef(null)

  filesRef.current = files
  pagesRef.current = pages

  useEffect(() => () => stopRef.current?.(), [])

  // Exact dropzone logic from MergeToolPage
  const onDrop = useCallback(async accepted => {
    let cancelled = false
    stopRef.current = () => { cancelled = true }

    for (const file of accepted) {
      if (cancelled) break
      const id = `f${++seq}`
      const color = DOC_COLORS[(seq - 1) % DOC_COLORS.length]
      try {
        const count = (await loadDoc(id, file)).getPageCount()
        dropDoc(id)
        if (cancelled) break

        const fileRecord = { id, file, name: file.name, size: file.size, count, color, n: filesRef.current.length + 1 }
        setFiles(f => {
          const next = [...f, fileRecord]
          fileRecord.n = next.length
          return next
        })

        const placeholders = Array.from({ length: count }, (_, i) => ({
          id: `${id}:${i}`, fileId: id, origIdx: i, rotation: 0, thumb: null,
        }))
        setPages(p => [...p, ...placeholders])

        getThumbnailsProgressive(file, (thumb, idx) => {
          if (cancelled) return
          setPages(p => p.map(pg => pg.id === `${id}:${idx}` ? { ...pg, thumb: thumb.img } : pg))
        }, 6)
      } catch (e) {
        setErrs(err => [...err, `${file.name}: ${e.message || 'could not read PDF'}`])
      }
    }
  }, [])

  const dz = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] } })
  const canvas = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] }, noClick: true, noKeyboard: true })

  // File reordering and removal (from MergeToolPage)
  const reorderFile = (from, to) => {
    if (from === to) return
    const list = [...files], [item] = list.splice(from, 1)
    list.splice(to, 0, item)
    setFiles(list.map((f, i) => ({ ...f, n: i + 1 })))
    setPages(p => byFileOrder(p, list))
  }

  const removeFile = (id) => {
    evictFromCache(files.find(f => f.id === id)?.file)
    dropDoc(id)
    const list = files.filter(f => f.id !== id).map((f, i) => ({ ...f, n: i + 1 }))
    setFiles(list)
    setPages(p => p.filter(pg => pg.fileId !== id))
  }

  // Page Actions (Rotate, Zoom, Reset)
  const h = useMemo(() => ({
    rotate: (ids, delta = 90) => {
      const set = new Set(ids)
      setPages(p => p.map(pg => set.has(pg.id) ? { ...pg, rotation: (((pg.rotation + delta) % 360) + 360) % 360 } : pg))
    },
    resetRotation: (ids) => {
      const set = new Set(ids)
      setPages(p => p.map(pg => set.has(pg.id) ? { ...pg, rotation: 0 } : pg))
    },
    rotateAll: (delta) => {
      setPages(p => p.map(pg => ({ ...pg, rotation: (((pg.rotation + delta) % 360) + 360) % 360 })))
    },
    resetAll: () => {
      setPages(p => p.map(pg => ({ ...pg, rotation: 0 })))
    },
    zoom: (id) => {
      const pg = pagesRef.current.find(p => p.id === id)
      const f = filesRef.current.find(x => x.id === pg.fileId)
      if (pg && f) setZoom({ file: f.file, pageNum: pg.origIdx + 1, rotation: pg.rotation })
    },
  }), [])

  const closeZoom = () => setZoom(null)

  const fileMap = useMemo(() => new Map(files.map(f => [f.id, f])), [files])
  const rotatedCount = useMemo(() => pages.filter(p => p.rotation !== 0).length, [pages])
  const estSize = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files])

  // Download logic
  const run = async (separate = false) => {
    if (!pages.length || state === 'loading') return
    setState('loading'); setPct(0); setErrs([])
    const prog = p => setPct(Math.round(p.done / Math.max(1, p.total) * 100))
    try {
      if (separate) {
        downloadBlob(await zipRotatedSeparately(files, pages, prog, { keepForms }), 'rotated_files.zip')
      } else {
        const outName = files.length > 1
          ? `${files[0].name.replace(/\.pdf$/i, '')}_+${files.length - 1}_rotated_merged.pdf`
          : `${files[0].name.replace(/\.pdf$/i, '')}_rotated.pdf`
        downloadBlob(await mergePages(files, pages, prog, { keepForms }), outName)
      }
      setState('done'); setTimeout(() => setState('idle'), 3000)
    } catch (e) {
      setErrs([`Rotation failed: ${e.message}`]); setState('idle')
    }
  }

  return (
    <div className="mp-root">
      <style>{CSS}</style>
      <TopBar onBack={onBack} title="Rotate PDF" subtitle="Rotate pages across one or many PDFs, then save" />
      {zoom && <ZoomModal {...zoom} onClose={closeZoom} />}

      <div className="mp-wrap">
        {/* ── Left Sidebar (Exact Merge Tool look and feel) ── */}
        <aside className="mp-side">
          <div className="mp-top">
            <div className="badge badge-browser" style={{ height:'auto', padding:'6px 10px', whiteSpace:'normal' }}>
              <ShieldCheck size={13}/> Runs 100% in your browser • Zero data uploaded
            </div>

            {/* Exact drop box from MergeToolPage */}
            <div {...dz.getRootProps()} style={{ border:`1px dashed ${dz.isDragActive ? 'var(--brand)' : 'var(--border2)'}`, background:'var(--bg2)', borderRadius:10, padding:'16px 12px', textAlign:'center', cursor:'pointer' }}>
              <input {...dz.getInputProps()}/>
              <Upload size={16} color="var(--brand)" style={{ display:'block', margin:'0 auto 6px' }}/>
              <p style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>Drop PDFs or <span style={{ color:'var(--brand)' }}>browse</span></p>
            </div>

            {/* Quick batch rotate shortcuts */}
            {files.length > 0 && (
              <div style={{ display:'flex', gap:6 }}>
                <button className="btn btn-ghost" onClick={() => h.rotateAll(90)} style={{ flex:1, height:30, fontSize:12, padding:'0 8px' }}>
                  <RotateCw size={12}/> All +90°
                </button>
                <button className="btn btn-ghost" onClick={() => h.rotateAll(-90)} style={{ flex:1, height:30, fontSize:12, padding:'0 8px' }}>
                  <RotateCcw size={12}/> All -90°
                </button>
                {rotatedCount > 0 && (
                  <button className="btn btn-ghost" onClick={h.resetAll} style={{ height:30, fontSize:11, padding:'0 8px', color:'var(--text3)' }}>
                    Reset
                  </button>
                )}
              </div>
            )}

            {errs.length > 0 && (
              <div style={{ fontSize:12, color:'var(--red)', display:'flex', gap:6, alignItems:'flex-start' }}>
                <AlertCircle size={13} style={{ flexShrink:0, marginTop:2 }}/>
                <div style={{ flex:1 }}>{errs.map((m, i) => <div key={i}>{m}</div>)}</div>
                <button aria-label="Dismiss" onClick={() => setErrs([])} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer' }}><X size={12}/></button>
              </div>
            )}
          </div>

          <div className="mp-list">
            {files.map((f, i) => (
              <div key={f.id}
                onDragOver={e => { if (fileDrag.current != null) { e.preventDefault(); setFileOver(i) } }}
                onDrop={() => { const from = fileDrag.current; fileDrag.current = null; setFileOver(null); if (from != null) reorderFile(from, i) }}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 8px', background:'var(--bg2)', border:`1px solid ${fileOver === i ? 'var(--brand)' : 'var(--border)'}`, borderRadius:8, flexShrink:0 }}>
                <span draggable aria-label="Drag to reorder"
                  onDragStart={e => { fileDrag.current = i; e.dataTransfer.setData('text/plain', 'file'); e.dataTransfer.setDragImage(e.currentTarget.parentElement, 10, 10) }}
                  onDragEnd={() => { fileDrag.current = null; setFileOver(null) }}
                  style={{ display:'flex', cursor:'grab', flexShrink:0 }}><GripVertical size={14} color="var(--text3)"/></span>
                <FileText size={14} color={f.color} style={{ flexShrink:0 }}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div title={f.name} style={{ fontSize:12, fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>Doc {i + 1}: {f.name}</div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>{f.count} pg • {formatBytes(f.size)}</div>
                </div>
                <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => reorderFile(i, i - 1)} style={{ width:24, height:24 }}><ChevronUp size={13}/></button>
                <button className="icon-btn" aria-label="Move down" disabled={i === files.length - 1} onClick={() => reorderFile(i, i + 1)} style={{ width:24, height:24 }}><ChevronDown size={13}/></button>
                <button className="icon-btn" aria-label="Rotate all pages in this file" title="Rotate all pages in this file +90°" onClick={() => h.rotate(pages.filter(p => p.fileId === f.id).map(p => p.id), 90)} style={{ width:24, height:24 }}><RotateCw size={13}/></button>
                <button className="icon-btn" aria-label="Remove file" onClick={() => removeFile(f.id)} style={{ width:24, height:24 }}><X size={13}/></button>
              </div>
            ))}
          </div>

          <div className="mp-foot">
            <div style={{ fontSize:12, color:'var(--text2)' }}>
              {files.length} file{files.length !== 1 && 's'} • {pages.length} pages {rotatedCount > 0 ? `• ${rotatedCount} rotated` : ''} • ~{formatBytes(estSize)}
            </div>

            {/* If 1 file: direct download rotated PDF */}
            {files.length <= 1 ? (
              <button className="btn btn-primary" disabled={!pages.length || state === 'loading'} onClick={() => run(false)}
                style={{ height:40, background: state === 'done' ? 'var(--green)' : undefined }}>
                {state === 'loading' ? <><Loader2 size={14} className="spin"/> Saving {pct}%</>
                  : state === 'done' ? <><CheckCircle size={14}/> Downloaded!</>
                  : 'Download Rotated PDF'}
              </button>
            ) : (
              <>
                {/* If multiple files: Download separately (.zip) is primary */}
                <button className="btn btn-primary" disabled={!pages.length || state === 'loading'} onClick={() => run(true)}
                  style={{ height:40, background: state === 'done' ? 'var(--green)' : undefined }}>
                  {state === 'loading' ? <><Loader2 size={14} className="spin"/> Packaging {pct}%</>
                    : state === 'done' ? <><CheckCircle size={14}/> Downloaded!</>
                    : `Download ${files.length} Files (.zip)`}
                </button>
                <button className="btn btn-ghost" disabled={!pages.length || state === 'loading'} onClick={() => run(false)} style={{ height:36 }}>
                  Merge & download (.pdf)
                </button>
              </>
            )}

            <label style={{ fontSize:11, color:'var(--text3)', display:'flex', gap:6, alignItems:'center', cursor:'pointer' }}>
              <input type="checkbox" checked={keepForms} onChange={e => setKeepForms(e.target.checked)}/>
              Keep forms fillable
            </label>
          </div>
        </aside>

        {/* ── Right Canvas (Exact Merge Tool layout) ── */}
        <div {...canvas.getRootProps()} style={{ flex:1, minWidth:0, minHeight:0, display:'flex', outline: canvas.isDragActive ? '2px dashed var(--brand)' : 'none', outlineOffset:-6 }}>
          <div className="mp-canvas">
            {!pages.length ? (
              <div style={{ height:'100%', minHeight:300, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:14, textAlign:'center' }}>
                Every page of every PDF shows up here.<br/>Hover over any page to rotate, or use the sidebar buttons.
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:`repeat(auto-fill, ${W + 20}px)`, justifyContent:'start', margin:'0 -10px' }}>
                {pages.map((pg, i) => {
                  const f = fileMap.get(pg.fileId)
                  return (
                    <PageCard
                      key={pg.id}
                      pg={pg}
                      num={i + 1}
                      h={h}
                      docN={f?.n || 1}
                      color={f?.color || 'var(--brand)'}
                      src={`${f?.name || 'document'} · p.${pg.origIdx + 1}`}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
