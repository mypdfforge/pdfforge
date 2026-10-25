import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import { Upload, Loader2, CheckCircle, AlertCircle, Plus, FileText, X, ZoomIn } from 'lucide-react'
import { clientOrganize } from '../utils/editClient'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive, getFullResPage } from '../utils/thumbCache'
import VirtualPageGrid from '../components/VirtualPageGrid'

// ── ZoomModal — full-screen high-res page view ─────────────────────────
// Re-implemented locally so OrganizePDFPage has no cross-page import dep.
function ZoomModal({ file, pageNum, onClose }) {
  const [imgSrc,  setImgSrc]  = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!file || !pageNum) return
    setLoading(true)
    getFullResPage(file, pageNum, 1.8)
      .then(t => { setImgSrc(t.img); setLoading(false) })
      .catch(() => setLoading(false))
  }, [file, pageNum])

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.85)',
        display:'flex', alignItems:'center', justifyContent:'center',
        backdropFilter:'blur(4px)', padding:'24px' }}>
      <div style={{ position:'relative', maxWidth:'90vw', maxHeight:'92vh', display:'flex', flexDirection:'column', gap:'10px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:'13px', color:'var(--text3)', fontWeight:600 }}>Page {pageNum} — Full Resolution</span>
          <button onClick={onClose}
            style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'8px',
              padding:'5px 12px', color:'var(--text3)', cursor:'pointer', fontSize:'12px', display:'flex', alignItems:'center', gap:'5px' }}>
            <X size={12}/> Close
          </button>
        </div>
        {loading
          ? <div style={{ width:'500px', height:'600px', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)' }}>
              <Loader2 size={28} color="var(--accent)" className="spin"/>
            </div>
          : <img src={imgSrc} alt={`Page ${pageNum}`}
              style={{ maxWidth:'85vw', maxHeight:'85vh', objectFit:'contain',
                boxShadow:'0 8px 60px rgba(0,0,0,0.8)', borderRadius:'4px', background:'#fff' }}/>
        }
      </div>
    </div>
  )
}

export default function OrganizePDFPage({ onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const [file,      setFile]      = useState(null)
  const [pages,     setPages]     = useState([])   // [{id, thumb, rotation, blank, origIdx}]
  const [loading,   setLoading]   = useState(false)
  const [state,     setState]     = useState('idle')
  const [errMsg,    setErrMsg]    = useState('')
  const [pct, setPct] = useState(0)
  const [hoverId,   setHoverId]   = useState(null)
  const [zoomPage,  setZoomPage]  = useState(null)  // { file, pageNum } for ZoomModal
  const doneRef     = useRef(false)   // true once every thumbnail has loaded
  const dragItem    = useRef(null)
  const dragOverItem = useRef(null)

  const onDrop = useCallback(async accepted => {
    const f = accepted[0]
    setFile(f); setErrMsg(''); setLoading(true); setPages([])
    doneRef.current = false
    try {
      let first = true
      await getThumbnailsProgressive(f, (thumb, idx) => {
        if (first) { setLoading(false); first = false }
        setPages(prev => [...prev, {
          id: `p-${idx}-${Date.now()}`,
          thumb: thumb.img,
          rotation: 0,
          blank: false,
          origIdx: idx,
        }])
      }, 5)
      doneRef.current = true
    } catch (e) {
      setErrMsg('Failed to load PDF: ' + e.message)
      setLoading(false)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1,
  })

  /* ── Drag & Drop reorder ── */
  const handleDragStart = (i) => { dragItem.current = i }
  const handleDragEnter = (i) => { dragOverItem.current = i }
  const handleDragEnd   = () => {
    if (dragItem.current === null || dragOverItem.current === null) return
    const arr = [...pages]
    const dragged = arr.splice(dragItem.current, 1)[0]
    arr.splice(dragOverItem.current, 0, dragged)
    setPages(arr)
    dragItem.current = null; dragOverItem.current = null
  }

  /* ── Page actions ── */
  const rotatePage    = (id) => setPages(p => p.map(pg => pg.id === id ? { ...pg, rotation: (pg.rotation + 90) % 360 } : pg))
  // soft delete: card stays (dimmed, with Undo); skipped on save
  const deletePage    = (id) => setPages(p => p.map(pg => pg.id === id ? { ...pg, isDeleted: true } : pg))
  const undeletePage  = (id) => setPages(p => p.map(pg => pg.id === id ? { ...pg, isDeleted: false } : pg))
  const addBlank      = () => setPages(p => [...p, {
    id: `blank-${Date.now()}`, thumb: null, rotation: 0, blank: true, origIdx: -1,
  }])

  /** Duplicate: insert a clone of the target page immediately after it. */
  const duplicatePage = (id) => {
    setPages(prev => {
      const idx = prev.findIndex(pg => pg.id === id)
      if (idx === -1) return prev
      const original = prev[idx]
      const clone = {
        ...original,
        id: `clone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      }
      const next = [...prev]
      next.splice(idx + 1, 0, clone)
      return next
    })
  }

  /** Zoom: open ZoomModal for the target page using its origIdx as 1-based page number. */
  const zoomPageAction = (id) => {
    const pg = pages.find(p => p.id === id)
    if (!pg || pg.blank || pg.origIdx < 0) return
    setZoomPage({ file, pageNum: pg.origIdx + 1 })
  }

  /* ── Apply ── */
  const livePages = pages.filter(pg => !pg.isDeleted)
  const apply = async () => {
    if (!file || livePages.length === 0) return
    if (!doneRef.current) {
      setErrMsg('Still loading pages. Please wait a moment, then save.')
      return
    }
    setState('loading'); setErrMsg(''); setPct(0)
    try {
      const steps = livePages.map(pg => ({ origIdx: pg.origIdx, rotation: pg.rotation, blank: pg.blank }))
      const response = await clientOrganize(file, steps, p => setPct(Math.round(p.done / p.total * 100)))
      downloadBlob(response.data, 'organized.pdf')
      setState('done'); setTimeout(() => setState('idle'), 3000)
    } catch (e) {
      setErrMsg('Error: ' + (e.response?.data?.detail || e.message)); setState('idle')
    }
  }

  const reset = () => { setFile(null); setPages([]); setErrMsg(''); setState('idle'); doneRef.current = false }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <TopBar onBack={onBack} title="⊞ Organize PDF" subtitle="Drag to reorder, rotate, duplicate, or delete pages"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory}
        onCategoryChange={onCategoryChange} search={search} onSearch={onSearch} />

      {/* ZoomModal overlay */}
      {zoomPage && (
        <ZoomModal file={zoomPage.file} pageNum={zoomPage.pageNum} onClose={() => setZoomPage(null)} />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Top action bar ── */}
        {file && (
          <div style={{
            borderBottom: '1px solid var(--border)', background: 'var(--bg2)',
            padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <span style={{ display:'flex', alignItems:'center', gap:'6px', fontSize: '13px', color: 'var(--text2)', marginRight: 'auto' }}>
              <FileText size={14} color="var(--brand)" style={{ flexShrink:0 }} />
              <strong style={{ color: 'var(--text)' }}>{file.name}</strong>
              <span style={{ color: 'var(--text3)', marginLeft: '8px' }}>{livePages.length} pages</span>
            </span>
            <button onClick={addBlank}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
              <Plus size={13} /> Add Blank Page
            </button>
            <button onClick={reset}
              style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text3)', cursor: 'pointer', fontSize: '12px' }}>
              Change PDF
            </button>
            {errMsg && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--red)' }}>
                <AlertCircle size={13} /> {errMsg}
              </div>
            )}
            <button onClick={apply} disabled={livePages.length === 0 || state === 'loading'}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px', padding: '8px 20px',
                borderRadius: '9px', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
                background: state === 'done' ? 'var(--green)' : 'var(--accent)', color: '#fff',
                boxShadow: '0 4px 14px rgba(234,88,12,0.3)',
              }}>
              {state === 'loading' ? <><Loader2 size={14} className="spin" />Saving {pct}%</>
                : state === 'done' ? <><CheckCircle size={14} />Downloaded!</>
                : <>⊞ Save PDF</>}
            </button>
          </div>
        )}

        {/* ── Main content ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: file ? '24px' : '0' }}>
          {!file ? (
            /* Upload zone */
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
              <div {...getRootProps()} style={{
                background: isDragActive ? 'rgba(234,88,12,0.08)' : 'var(--bg2)',
                border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '20px', padding: '60px 40px', textAlign: 'center', cursor: 'pointer',
                transition: 'all 0.2s', maxWidth: '480px', width: '100%',
              }}>
                <input {...getInputProps()} />
                <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.4 }}>⊞</div>
                <p style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>Drop your PDF here</p>
                <p style={{ fontSize: '13px', color: 'var(--text3)' }}>Pages will appear as thumbnails you can drag to reorder</p>
              </div>
            </div>
          ) : loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', color: 'var(--text3)' }}>
              <Loader2 size={36} color="var(--accent)" className="spin" style={{ marginBottom: '14px' }} />
              <p style={{ fontSize: '14px' }}>Loading page thumbnails…</p>
            </div>
          ) : (
            /* Thumbnail grid */
            <VirtualPageGrid
                pages={pages}
                hoverId={hoverId}
                onHover={setHoverId}
                onDragStart={handleDragStart}
                onDragEnter={handleDragEnter}
                onDragEnd={handleDragEnd}
                onRotate={rotatePage}
                onDelete={deletePage}
                onUndelete={undeletePage}
                onDuplicate={duplicatePage}
                onZoom={zoomPageAction}
                onAddBlank={addBlank}
              />
          )}
        </div>
      </div>
    </div>
  )
}
