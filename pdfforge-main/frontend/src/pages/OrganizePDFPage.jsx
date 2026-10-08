import React, { useState, useCallback, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import { Upload, Loader2, CheckCircle, AlertCircle, Plus } from 'lucide-react'
import axios from 'axios'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'
import VirtualPageGrid from '../components/VirtualPageGrid'

export default function OrganizePDFPage({ onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const [file,      setFile]      = useState(null)
  const [pages,     setPages]     = useState([])   // [{id, thumb, rotation, blank}]
  const [loading,   setLoading]   = useState(false)
  const [state,     setState]     = useState('idle')
  const [errMsg,    setErrMsg]    = useState('')
  const [hoverId,   setHoverId]   = useState(null)
  const dragItem    = useRef(null)
  const dragOverItem = useRef(null)

  const onDrop = useCallback(async accepted => {
    const f = accepted[0]
    setFile(f); setErrMsg(''); setLoading(true); setPages([])
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
  const rotatePage = (id) => setPages(p => p.map(pg => pg.id === id ? { ...pg, rotation: (pg.rotation + 90) % 360 } : pg))
  const deletePage = (id) => setPages(p => p.filter(pg => pg.id !== id))
  const addBlank   = () => setPages(p => [...p, {
    id: `blank-${Date.now()}`, thumb: null, rotation: 0, blank: true, origIdx: -1,
  }])

  /* ── Apply ── */
  const apply = async () => {
    if (!file || pages.length === 0) return
    setState('loading'); setErrMsg('')
    try {
      const form = new FormData()
      form.append('file', file)
      // Build instruction: array of {orig_idx, rotation, blank}
      const instructions = pages.map(pg => ({
        orig_idx: pg.origIdx,
        rotation: pg.rotation,
        blank: pg.blank,
      }))
      form.append('instructions', JSON.stringify(instructions))
      const response = await axios.post('/api/tools/organize', form, { responseType: 'blob', validateStatus: null })
      if (response.status !== 200) {
        const txt = await response.data.text()
        let msg = `Server error ${response.status}`
        try { msg = JSON.parse(txt).detail || msg } catch {}
        setErrMsg(msg); setState('idle'); return
      }
      downloadBlob(response.data, 'organized.pdf')
      setState('done'); setTimeout(() => setState('idle'), 3000)
    } catch (e) {
      setErrMsg('Error: ' + (e.response?.data?.detail || e.message)); setState('idle')
    }
  }

  const reset = () => { setFile(null); setPages([]); setErrMsg(''); setState('idle') }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <TopBar onBack={onBack} title="⊞ Organize PDF" subtitle="Drag to reorder, rotate, or delete pages"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory}
        onCategoryChange={onCategoryChange} search={search} onSearch={onSearch} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Top action bar ── */}
        {file && (
          <div style={{
            borderBottom: '1px solid var(--border)', background: 'var(--bg2)',
            padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <span style={{ fontSize: '13px', color: 'var(--text2)', marginRight: 'auto' }}>
              📄 <strong style={{ color: 'var(--text)' }}>{file.name}</strong>
              <span style={{ color: 'var(--text3)', marginLeft: '8px' }}>{pages.length} pages</span>
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
            <button onClick={apply} disabled={pages.length === 0 || state === 'loading'}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px', padding: '8px 20px',
                borderRadius: '9px', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
                background: state === 'done' ? 'var(--green)' : 'var(--accent)', color: '#fff',
                boxShadow: '0 4px 14px rgba(108,99,255,0.3)',
              }}>
              {state === 'loading' ? <><Loader2 size={14} className="spin" />Saving…</>
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
                background: isDragActive ? 'rgba(108,99,255,0.08)' : 'var(--bg2)',
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
                onAddBlank={addBlank}
              />
          )}
        </div>
      </div>
    </div>
  )
}
