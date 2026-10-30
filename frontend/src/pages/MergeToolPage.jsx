import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import {
  Upload, Loader2, CheckCircle, AlertCircle, FileText, X, ZoomIn, RotateCw, RotateCcw, Copy,
  Trash2, Undo2, GripVertical, ChevronUp, ChevronDown, ShieldCheck, FilePlus, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { downloadBlob } from '../utils/api'
import { formatBytes } from '../utils/credits'
import { getThumbnailsProgressive, getFullResPage, evictFromCache } from '../utils/thumbCache'
import { loadDoc, dropDoc, movePage, moveFilePages, byFileOrder, mergePages } from '../utils/mergeClient'

const W = 140, H = 180
// each file gets its color once, when added, so it never changes when files are reordered (cycles after 6 files)
const DOC_COLORS = ['#3b82f6','#10b981','#f59e0b','#ec4899','#8b5cf6','#06b6d4']
let seq = 0, dupSeq = 0
const newBlank = fileId => ({ id:`${fileId}+${++dupSeq}`, fileId, origIdx:-1, rotation:0, thumb:null, deleted:false, blank:true })

// Layout: root is exactly viewport high, so the sidebar and the canvas each own their scrollbar
// and the Merge button (sidebar footer) can never be pushed out of view.
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
.mp-mob-btn{width:26px;height:26px;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:all .12s}
.mp-mob-btn:disabled{opacity:.25;cursor:default}
.mp-mob-btn:not(:disabled):active{background:var(--bg3);color:var(--text)}
.mp-mob-btn-danger{color:var(--red)}
@media (hover:none){
  .mp-actions{display:none}
  .mp-card-mobile-bar{display:flex !important}
}
@media (hover:hover){
  .mp-card-mobile-bar{display:none}
}
@keyframes mpPulse{0%,100%{opacity:1}50%{opacity:.5}}
@media (min-width:769px){
  .mp-files-bar{display:none}
  .mp-foot-mobile{display:none}
  .mp-side-content{display:flex;flex-direction:column;flex:1;min-height:0}
}
@media (max-width:768px){
  .mp-root{height:100vh;height:100dvh;overflow:hidden}
  .mp-wrap{flex-direction:column;overflow:hidden;flex:1}
  .mp-side{width:100%;border-right:none;border-bottom:1px solid var(--border);flex-shrink:0}
  .mp-files-bar{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg2);border-bottom:1px solid var(--border);cursor:pointer}
  .mp-side-content{display:none}
  .mp-side.open .mp-side-content{display:flex;flex-direction:column;max-height:48vh;overflow-y:auto}
  .mp-side:not(.open){border-bottom:none}
  .mp-side .mp-foot{display:none}
  .mp-canvas{flex:1;min-height:0;height:auto;overflow-y:auto;padding:12px 14px 110px}
  .mp-foot-mobile{position:fixed;bottom:0;left:0;right:0;z-index:90;background:var(--bg2);border-top:1px solid var(--border);padding:10px 14px max(10px,env(safe-area-inset-bottom));box-shadow:0 -6px 20px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:8px}
}
`

// ── Full-res zoom ─────────────────────────────────────────────────────
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

// ── One page card ─────────────────────────────────────────────────────
// Outer box has 10px side padding so there is no dead gap between cards: every pixel of the grid is a drop target.
const PageCard = React.memo(function PageCard({ pg, num, side, ghost, src, docN, color, start, h, canMoveLeft, canMoveRight }) {
  const sideways = pg.rotation % 180 !== 0
  return (
    <div className="mp-card" draggable data-page-id={pg.id}
      onDragStart={e => h.dragStart(e, pg.id)} onDragEnd={h.dragEnd}
      onDragOver={e => h.over(e, pg.id)} onDrop={e => h.drop(e, pg.id)}
      onTouchStart={e => h.touchStart(e, pg.id)}
      onTouchMove={e => h.touchMove(e, pg.id)}
      onTouchEnd={e => h.touchEnd(e, pg.id)}
      title={src}
      style={{ position:'relative', width:W + 20, padding:'0 10px 16px', cursor:'grab', opacity: ghost ? .35 : 1,
        touchAction: 'pan-y',
        transform: side === 'before' ? 'translateX(8px)' : side === 'after' ? 'translateX(-8px)' : 'none' }}>
      {/* page-break marker: first card of a run from a new file. pointer-events:none so it never blocks a drop */}
      {start && <div style={{ position:'absolute', top:0, left:0, height:H, borderLeft:`2px dashed ${color}`, pointerEvents:'none', opacity:.8 }}/>}
      {side && <div style={{ position:'absolute', top:0, height:H, [side === 'before' ? 'left' : 'right']:2, width:4, borderRadius:2, background:'var(--brand)', boxShadow:'0 0 10px var(--brand)', animation:'mpPulse 1s ease infinite', zIndex:20 }}/>}
      <div style={{ position:'relative', width:W }}>
        <div className="mp-thumb" onClick={() => !pg.deleted && !pg.blank && h.zoom(pg.id)}
          style={{ width:W, height:H, borderRadius:10, overflow:'hidden', border:`3px solid ${color}`, background:'var(--bg3)', display:'flex', alignItems:'center', justifyContent:'center', transition:'border-color .15s', cursor:'pointer' }}>
          {pg.blank
            ? <div style={{ width:'100%', height:'100%', background:'#fff', color:'#999', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center', ...(pg.deleted && { opacity:.35 }) }}>Blank</div>
            : pg.thumb
            ? <img src={pg.thumb} alt="" draggable={false}
                style={{ width:'100%', height:'100%', objectFit:'contain', background:'#fff', transform:`rotate(${pg.rotation}deg)${sideways ? ' scale(.77)' : ''}`, transition:'transform .2s', ...(pg.deleted && { opacity:.35, filter:'grayscale(1)' }) }}/>
            : <div style={{ width:'85%', height:'90%', borderRadius:4, background:'linear-gradient(90deg,var(--bg2) 25%,var(--bg3) 50%,var(--bg2) 75%)', backgroundSize:'200% 100%', animation:'shimmer 1.4s infinite' }}/>}
        </div>
        {pg.deleted ? (
          <div style={{ position:'absolute', top:0, left:0, width:W, height:H, borderRadius:10, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:10 }}>
            <button className="btn btn-ghost" onClick={() => h.patch(pg.id, { deleted:false })} style={{ height:28, padding:'0 10px', fontSize:12 }}><Undo2 size={13}/> Undo</button>
          </div>
        ) : (
          <div className="mp-actions" style={{ position:'absolute', top:8, right:8, display:'flex', flexDirection:'column', gap:5, zIndex:10 }}>
            {!pg.blank && <Act label="Zoom" bg="rgba(30,30,50,.9)" onClick={() => h.zoom(pg.id)}><ZoomIn size={13}/></Act>}
            <Act label="Rotate 90°"    bg="rgba(234,88,12,.9)"  onClick={() => h.rotate([pg.id])}><RotateCw size={13}/></Act>
            <Act label="Duplicate page" bg="rgba(16,155,117,.9)" onClick={() => h.duplicate(pg.id)}><Copy size={13}/></Act>
            <Act label="Insert blank page after" bg="rgba(99,102,241,.9)" onClick={() => h.blankAfter(pg.id)}><FilePlus size={13}/></Act>
            <Act label="Delete"        bg="rgba(229,83,75,.9)"  onClick={() => h.patch(pg.id, { deleted:true })}><Trash2 size={13}/></Act>
          </div>
        )}
        <div style={{ textAlign:'center', marginTop:7, fontSize:11, fontWeight:600, color:'var(--text3)' }}>
          <div style={{ width:W, boxSizing:'border-box', margin:'0 auto 4px', padding:'3px 6px', borderRadius:6, background:color, color:'#fff', fontSize:11, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', opacity: pg.deleted ? .5 : 1 }}>
            Doc {docN} · {pg.blank ? 'blank' : `p. ${pg.origIdx + 1}`}
          </div>
          {pg.deleted ? 'Removed' : `Page ${num}`}
          {pg.dup && !pg.deleted && <span style={{ color:'var(--green)', marginLeft:5 }}>copy</span>}
          {pg.rotation !== 0 && !pg.deleted && <span style={{ color:'var(--accent2)', marginLeft:5 }}>{pg.rotation}°</span>}
        </div>
        {!pg.deleted && (
          <div className="mp-card-mobile-bar" style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:3, marginTop:5 }}>
            <button className="mp-mob-btn" disabled={!canMoveLeft} onClick={e => { e.stopPropagation(); h.moveDelta(pg.id, -1) }} aria-label="Move left" title="Move page left">
              <ChevronLeft size={13}/>
            </button>
            <button className="mp-mob-btn" onClick={e => { e.stopPropagation(); h.rotate([pg.id]) }} aria-label="Rotate 90°" title="Rotate 90°">
              <RotateCw size={12}/>
            </button>
            <button className="mp-mob-btn" onClick={e => { e.stopPropagation(); h.duplicate(pg.id) }} aria-label="Duplicate" title="Duplicate page">
              <Copy size={12}/>
            </button>
            <button className="mp-mob-btn mp-mob-btn-danger" onClick={e => { e.stopPropagation(); h.patch(pg.id, { deleted:true }) }} aria-label="Delete" title="Delete page">
              <Trash2 size={12}/>
            </button>
            <button className="mp-mob-btn" disabled={!canMoveRight} onClick={e => { e.stopPropagation(); h.moveDelta(pg.id, 1) }} aria-label="Move right" title="Move page right">
              <ChevronRight size={13}/>
            </button>
          </div>
        )}
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

// ── Page ──────────────────────────────────────────────────────────────
export default function MergeToolPage({ onBack, organize = false, exportSeparate }) {
  const [files, setFiles]   = useState([])   // {id,file,name,size,count}
  const [pages, setPages]   = useState([])   // flat final order
  const [manual, setManual] = useState(false) // true once pages were dragged by hand
  const [errs, setErrs]     = useState([])
  const [state, setState]   = useState('idle')
  const [pct, setPct]       = useState(0)
  const [keepForms, setKeepForms] = useState(true)
  const [zoom, setZoom]     = useState(null)
  const [drop, setDrop]     = useState(null)   // {id, after} page drop slot
  const [dragging, setDragging] = useState(null)
  const [fileOver, setFileOver] = useState(null)
  const [filesOpen, setFilesOpen] = useState(false)

  const manualRef = useRef(false)
  const filesRef  = useRef([])
  const pagesRef  = useRef([])
  const dragId    = useRef(null)
  const fileDrag  = useRef(null)
  const scroller  = useRef(null)
  const stopRef   = useRef(null)
  const touchRef  = useRef(null)
  const dropRef   = useRef(drop)
  dropRef.current = drop
  filesRef.current = files
  pagesRef.current = pages
  const closeZoom = useCallback(() => setZoom(null), [])
  const setManualFlag = useCallback(v => { manualRef.current = v; setManual(v) }, [])
  useEffect(() => () => stopRef.current?.(), [])

  // ── Add files ──
  const onDrop = useCallback(async accepted => {
    for (const file of accepted) {            // sequential: keeps drop order stable
      const id = `f${++seq}`, color = DOC_COLORS[(seq - 1) % DOC_COLORS.length]
      try {
        const count = (await loadDoc(id, file)).getPageCount()
        setFiles(f => [...f, { id, file, name:file.name, size:file.size, count, color }])
        setPages(p => [...p, ...Array.from({ length:count }, (_, i) => ({ id:`${id}:${i}`, fileId:id, origIdx:i, rotation:0, thumb:null, deleted:false }))])
        // match by file+origIdx (not id) so duplicated pages get their thumb too
        getThumbnailsProgressive(file, (t, i) => setPages(p => p.map(pg => pg.fileId === id && pg.origIdx === i ? { ...pg, thumb:t.img } : pg)), 5)
          .catch(() => setErrs(x => [...x, `${file.name}: preview failed (merge still works)`]))
      } catch (e) {
        setErrs(x => [...x, `${file.name}: ${/encrypt/i.test(e.message) ? 'password-protected, unlock it first' : 'could not read this PDF'}`])
      }
    }
  }, [])
  const dz     = useDropzone({ onDrop, accept:{ 'application/pdf':['.pdf'] } })
  const canvas = useDropzone({ onDrop, accept:{ 'application/pdf':['.pdf'] }, noClick:true, noKeyboard:true })

  // ── File list actions: list AND its pages always move together ──
  const reorderFile = (from, to) => {
    if (to < 0 || to >= files.length || to === from) return
    const nf = [...files], [mv] = nf.splice(from, 1)
    nf.splice(to, 0, mv)
    const target = files[to]
    setFiles(nf)
    setPages(p => moveFilePages(p, mv.id, target.id, to > from)) // moves the block; manual page order inside stays
  }
  const removeFile = id => {
    const f = filesRef.current.find(x => x.id === id); if (f) evictFromCache(f.file)
    setFiles(fs => fs.filter(x => x.id !== id)); setPages(p => p.filter(pg => pg.fileId !== id))
    dropDoc(id)
  }
  const resetOrder = () => { setPages(p => byFileOrder(p, files)); setManualFlag(false) }

  // ── Stable page handlers (memoised cards depend on these) ──
  const h = useMemo(() => {
    const clean = () => { dragId.current = null; setDrop(null); setDragging(null); stopRef.current?.(); stopRef.current = null }
    const dropAt = (e, targetId, after) => {
      if (!dragId.current) return
      e?.preventDefault?.(); e?.stopPropagation?.()
      const from = dragId.current
      if (from !== targetId) { setPages(p => movePage(p, from, targetId, after)); setManualFlag(true) }
      clean()
    }
    const sideOf = e => { const r = e.currentTarget.getBoundingClientRect(); return e.clientX > r.left + r.width / 2 }
    // Native drag never auto-scrolls an inner box, so scroll it ourselves while the pointer is near its top/bottom edge.
    const startScroll = () => {
      let y = null, raf = 0
      const track = e => { y = e.clientY }
      window.addEventListener('dragover', track)
      const tick = () => {
        const el = scroller.current
        if (el && y != null) {
          const r = el.getBoundingClientRect(), Z = 90
          const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight)
          if (y < top + Z)         el.scrollTop -= Math.min(30, Math.ceil((top + Z - y) / 3))
          else if (y > bottom - Z) el.scrollTop += Math.min(30, Math.ceil((y - (bottom - Z)) / 3))
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      stopRef.current = () => { cancelAnimationFrame(raf); window.removeEventListener('dragover', track) }
    }
    return {
      dragStart: (e, id) => {
        dragId.current = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id)
        startScroll(); setTimeout(() => dragId.current === id && setDragging(id), 0) // after the drag image is taken
      },
      dragEnd: clean,
      over: (e, id) => {
        if (!dragId.current) return
        e.preventDefault(); e.dataTransfer.dropEffect = 'move'
        const after = sideOf(e)
        setDrop(d => d && d.id === id && d.after === after ? d : { id, after })
      },
      drop:   (e, id) => dropAt(e, id, sideOf(e)),
      dropAt,
      touchStart: (e, id) => {
        const t = e.touches[0]
        touchRef.current = { id, startX: t.clientX, startY: t.clientY, active: false }
      },
      touchMove: (e, id) => {
        const t = e.touches[0]
        const tr = touchRef.current
        if (!tr || tr.id !== id) return
        const dist = Math.hypot(t.clientX - tr.startX, t.clientY - tr.startY)
        if (dist > 12) {
          tr.active = true
          dragId.current = id
          setDragging(id)
          const el = document.elementFromPoint(t.clientX, t.clientY)
          const cardEl = el?.closest('[data-page-id]')
          if (cardEl) {
            const targetId = cardEl.getAttribute('data-page-id')
            if (targetId && targetId !== id) {
              const r = cardEl.getBoundingClientRect()
              const after = t.clientX > r.left + r.width / 2
              setDrop({ id: targetId, after })
            }
          }
        }
      },
      touchEnd: () => {
        const tr = touchRef.current
        if (tr && tr.active && dragId.current) {
          if (dropRef.current && dropRef.current.id && dropRef.current.id !== dragId.current) {
            setPages(p => movePage(p, dragId.current, dropRef.current.id, dropRef.current.after))
            setManualFlag(true)
          }
        }
        touchRef.current = null
        clean()
      },
      moveDelta: (id, delta) => {
        setPages(curr => {
          const idx = curr.findIndex(p => p.id === id)
          if (idx < 0) return curr
          const targetIdx = idx + delta
          if (targetIdx < 0 || targetIdx >= curr.length) return curr
          const next = [...curr]
          const [item] = next.splice(idx, 1)
          next.splice(targetIdx, 0, item)
          return next
        })
        setManualFlag(true)
      },
      slot:   (id, after) => setDrop(d => d && d.id === id && d.after === after ? d : { id, after }),
      patch:  (id, ch) => setPages(p => p.map(pg => pg.id === id ? { ...pg, ...ch } : pg)),
      rotate: ids => setPages(p => p.map(pg => ids.includes(pg.id) ? { ...pg, rotation:(pg.rotation + 90) % 360 } : pg)),
      duplicate: id => setPages(p => {
        const i = p.findIndex(x => x.id === id); if (i < 0) return p
        const next = [...p]
        next.splice(i + 1, 0, { ...p[i], id:`${p[i].id}~${++dupSeq}`, dup:true, deleted:false })
        return next
      }),
      blankAfter: id => setPages(p => {
        const i = p.findIndex(x => x.id === id); if (i < 0) return p
        const next = [...p]
        next.splice(i + 1, 0, newBlank(p[i].fileId))
        return next
      }),
      blankStart: () => setPages(p => p.length ? [newBlank(p[0].fileId), ...p] : p),
      zoom:   id => {
        const pg = pagesRef.current.find(x => x.id === id), f = pg && !pg.blank && filesRef.current.find(x => x.id === pg.fileId)
        if (f) setZoom({ file:f.file, pageNum:pg.origIdx + 1, rotation:pg.rotation })
      },
    }
  }, [setManualFlag])

  // ── Derived ──
  const fileMap  = useMemo(() => new Map(files.map((f, i) => [f.id, { ...f, n:i + 1 }])), [files])
  const nums     = useMemo(() => { let n = 0; const m = {}; for (const p of pages) if (!p.deleted) m[p.id] = ++n; return m }, [pages])
  const liveCnt  = Object.keys(nums).length
  const estSize  = useMemo(() => files.reduce((s, f) => s + f.size * pages.filter(p => p.fileId === f.id && !p.deleted).length / f.count, 0), [files, pages])

  const run = async (separate = false) => {
    setState('loading'); setPct(0)
    try {
      const prog = p => setPct(Math.round(p.done / p.total * 100))
      if (separate) downloadBlob(await exportSeparate(files, pages, prog, { keepForms }), 'organized.zip')
      else downloadBlob(await mergePages(files, pages, prog, { keepForms }), organize ? 'organized.pdf' : 'merged.pdf')
      setState('done'); setTimeout(() => setState('idle'), 3000)
    } catch (e) { setErrs([`Merge failed: ${e.message}`]); setState('idle') }
  }

  const isFilesOpen = filesOpen || files.length === 0

  return (
    <div className="mp-root">
      <style>{CSS}</style>
      <TopBar onBack={onBack} title={organize ? 'Organize PDF' : 'Merge PDFs'}
        subtitle={organize ? 'Reorder, rotate, duplicate, delete, add blank pages — then save' : 'Reorder files and pages, rotate, duplicate, delete — then merge'}/>
      {zoom && <ZoomModal {...zoom} onClose={closeZoom}/>}

      <div className="mp-wrap">
        {/* ── Left: files (own scroll) + pinned Merge button ── */}
        <aside className={`mp-side${isFilesOpen ? ' open' : ''}`}>
          {/* Mobile expandable strip (shown when files exist) */}
          {files.length > 0 && (
            <div className="mp-files-bar" onClick={() => setFilesOpen(o => !o)}>
              <div style={{ display:'flex', alignItems:'center', gap:8, flex:1, minWidth:0 }}>
                <FileText size={15} color="var(--brand)" style={{ flexShrink:0 }}/>
                <span style={{ fontSize:13, fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {files.length} document{files.length !== 1 ? 's' : ''} ({pages.filter(p => !p.deleted).length} pages)
                </span>
              </div>
              <button className="btn btn-ghost" style={{ height:28, fontSize:11, padding:'0 8px', flexShrink:0 }}>
                {filesOpen ? 'Done ▲' : '+ Files ▼'}
              </button>
            </div>
          )}

          <div className="mp-side-content">
            <div className="mp-top">
              <div className="badge badge-browser" style={{ height:'auto', padding:'6px 10px', whiteSpace:'normal' }}>
                <ShieldCheck size={13}/> Runs 100% in your browser • Zero data uploaded
              </div>
              <div {...dz.getRootProps()} style={{ border:`1px dashed ${dz.isDragActive ? 'var(--brand)' : 'var(--border2)'}`, background:'var(--bg2)', borderRadius:10, padding:'16px 12px', textAlign:'center', cursor:'pointer' }}>
                <input {...dz.getInputProps()}/>
                <Upload size={16} color="var(--brand)" style={{ display:'block', margin:'0 auto 6px' }}/>
                <p style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>Drop PDFs or <span style={{ color:'var(--brand)' }}>browse</span></p>
              </div>
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
                  {/* only the grip drags, so clicks on the buttons are never mistaken for a drag */}
                  <span draggable aria-label="Drag to reorder"
                    onDragStart={e => { fileDrag.current = i; e.dataTransfer.setData('text/plain', 'file'); e.dataTransfer.setDragImage(e.currentTarget.parentElement, 10, 10) }}
                    onDragEnd={() => { fileDrag.current = null; setFileOver(null) }}
                    style={{ display:'flex', cursor:'grab', flexShrink:0 }}><GripVertical size={14} color="var(--text3)"/></span>
                  <FileText size={14} color={f.color} style={{ flexShrink:0 }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div title={f.name} style={{ fontSize:12, fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>Doc {i + 1}: {f.name}</div>
                    <div style={{ fontSize:11, color:'var(--text3)' }}>{f.count} pg • {formatBytes(f.size)}</div>
                  </div>
                  <button className="icon-btn" aria-label="Move up"   disabled={i === 0}               onClick={() => reorderFile(i, i - 1)} style={{ width:24, height:24 }}><ChevronUp size={13}/></button>
                  <button className="icon-btn" aria-label="Move down" disabled={i === files.length - 1} onClick={() => reorderFile(i, i + 1)} style={{ width:24, height:24 }}><ChevronDown size={13}/></button>
                  <button className="icon-btn" aria-label="Rotate all pages" onClick={() => h.rotate(pages.filter(p => p.fileId === f.id).map(p => p.id))} style={{ width:24, height:24 }}><RotateCw size={13}/></button>
                  <button className="icon-btn" aria-label="Remove file" onClick={() => removeFile(f.id)} style={{ width:24, height:24 }}><X size={13}/></button>
                </div>
              ))}
              {files.length > 0 && <button className="btn btn-ghost" onClick={h.blankStart} style={{ flexShrink:0 }}><FilePlus size={13}/> Blank page at start</button>}
              {manual && <button className="btn btn-ghost" onClick={resetOrder} style={{ flexShrink:0 }}><RotateCcw size={13}/> Reset to file order</button>}
            </div>

            <div className="mp-foot">
              <div style={{ fontSize:12, color:'var(--text2)' }}>
                {files.length} file{files.length !== 1 && 's'} • {liveCnt} pages • ~{formatBytes(estSize)}
              </div>
              <button className="btn btn-primary" disabled={!liveCnt || state === 'loading'} onClick={() => run()}
                style={{ height:40, background: state === 'done' ? 'var(--green)' : undefined }}>
                {state === 'loading' ? <><Loader2 size={14} className="spin"/> {organize ? 'Saving' : 'Merging'} {pct}%</>
                  : state === 'done' ? <><CheckCircle size={14}/> Downloaded!</>
                  : organize ? (files.length > 1 ? 'Merge & download' : 'Save PDF')
                  : <>Merge {files.length || ''} PDF{files.length !== 1 && 's'}</>}
              </button>
              {exportSeparate && files.length > 1 && (
                <button className="btn btn-ghost" disabled={!liveCnt || state === 'loading'} onClick={() => run(true)} style={{ height:36 }}>
                  Download separately (.zip)
                </button>
              )}
              <label style={{ fontSize:11, color:'var(--text3)', display:'flex', gap:6, alignItems:'center', cursor:'pointer' }}>
                <input type="checkbox" checked={keepForms} onChange={e => setKeepForms(e.target.checked)}/>
                Keep forms fillable (same field names get renamed)
              </label>
            </div>
          </div>
        </aside>

        {/* ── Right: page flow (own scroll) ── */}
        <div {...canvas.getRootProps()} style={{ flex:1, minWidth:0, minHeight:0, display:'flex', outline: canvas.isDragActive ? '2px dashed var(--brand)' : 'none', outlineOffset:-6 }}>
          <div ref={scroller} className="mp-canvas">
            {!pages.length ? (
              <div style={{ height:'100%', minHeight:300, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:14, textAlign:'center' }}>
                Every page of every PDF shows up here.<br/>Drag pages to reorder, even across files.
              </div>
            ) : (
              <>
                {/* one continuous grid; empty space at the end = drop after the last page */}
                <div style={{ display:'grid', gridTemplateColumns:`repeat(auto-fill, ${W + 20}px)`, justifyContent:'start', margin:'0 -10px' }}
                  onDragOver={e => { if (dragId.current && e.target === e.currentTarget) { e.preventDefault(); h.slot(pages[pages.length - 1].id, true) } }}
                  onDrop={e => e.target === e.currentTarget && h.dropAt(e, pages[pages.length - 1].id, true)}>
                  {pages.map((pg, i) => {
                    const f = fileMap.get(pg.fileId)
                    return (
                      <PageCard key={pg.id} pg={pg} num={nums[pg.id]} h={h} ghost={dragging === pg.id}
                        side={drop?.id === pg.id ? (drop.after ? 'after' : 'before') : null}
                        docN={f.n} color={f.color} start={i > 0 && pages[i - 1].fileId !== pg.fileId}
                        src={`${f.name} · p.${pg.origIdx + 1}`}
                        canMoveLeft={i > 0} canMoveRight={i < pages.length - 1}/>
                    )
                  })}
                </div>
                {/* drop here = move to the very end */}
                <div onDragOver={e => dragId.current && e.preventDefault()} onDrop={e => h.dropAt(e, pages[pages.length - 1].id, true)}
                  style={{ minHeight:140 }}/>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Fixed bottom action footer for mobile devices ── */}
      {files.length > 0 && (
        <div className="mp-foot-mobile">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:11, color:'var(--text2)' }}>
            <span>{files.length} file{files.length !== 1 && 's'} • {liveCnt} pages</span>
            <label style={{ fontSize:11, color:'var(--text3)', display:'flex', gap:4, alignItems:'center', cursor:'pointer' }}>
              <input type="checkbox" checked={keepForms} onChange={e => setKeepForms(e.target.checked)}/>
              Keep forms fillable
            </label>
          </div>
          <div style={{ display:'flex', gap:8, width:'100%' }}>
            <button className="btn btn-primary" disabled={!liveCnt || state === 'loading'} onClick={() => run()}
              style={{ flex:1, minWidth:0, height:42, background: state === 'done' ? 'var(--green)' : undefined, fontSize:12, padding:'4px 8px', display:'flex', alignItems:'center', justifyContent:'center', textAlign:'center', whiteSpace:'normal', lineHeight:1.2 }}>
              {state === 'loading' ? <><Loader2 size={14} className="spin"/> {organize ? 'Saving' : 'Merging'} {pct}%</>
                : state === 'done' ? <><CheckCircle size={14}/> Downloaded!</>
                : organize ? (files.length > 1 ? 'Merge & download' : 'Save PDF')
                : <>Merge {files.length || ''} PDF{files.length !== 1 && 's'}</>}
            </button>
            {exportSeparate && files.length > 1 && (
              <button className="btn btn-ghost" disabled={!liveCnt || state === 'loading'} onClick={() => run(true)}
                style={{ flex:1, minWidth:0, height:42, padding:'4px 8px', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center', textAlign:'center', whiteSpace:'normal', lineHeight:1.2 }}>
                Separate (.zip)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
