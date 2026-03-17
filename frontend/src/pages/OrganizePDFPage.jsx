import React, { useState, useCallback, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import { Upload, Loader2, CheckCircle, AlertCircle, RotateCw, Trash2, Plus } from 'lucide-react'
import axios from 'axios'
import { downloadBlob } from '../utils/api'

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
    setFile(f); setErrMsg(''); setLoading(true)
    try {
      const form = new FormData(); form.append('file', f)
      const { data } = await axios.post('/api/tools/thumbnails', form)
      setPages(data.thumbnails.map((t, i) => ({
        id: `p-${i}-${Date.now()}`,
        thumb: t.img,
        rotation: 0,
        blank: false,
        origIdx: i,
      })))
    } catch (e) {
      setErrMsg('Failed to load PDF: ' + (e.response?.data?.detail || e.message))
    } finally { setLoading(false) }
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
              {pages.map((pg, i) => (
                <div key={pg.id}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragEnter={() => handleDragEnter(i)}
                  onDragEnd={handleDragEnd}
                  onDragOver={e => e.preventDefault()}
                  onMouseEnter={() => setHoverId(pg.id)}
                  onMouseLeave={() => setHoverId(null)}
                  style={{
                    position: 'relative', cursor: 'grab',
                    width: '140px', flexShrink: 0,
                    transition: 'transform 0.15s',
                    transform: hoverId === pg.id ? 'translateY(-3px)' : 'none',
                  }}>

                  {/* Thumbnail */}
                  <div style={{
                    width: '140px', height: '180px', borderRadius: '10px', overflow: 'hidden',
                    border: `2px solid ${hoverId === pg.id ? 'var(--accent)' : 'var(--border)'}`,
                    background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'border-color 0.15s',
                    boxShadow: hoverId === pg.id ? '0 8px 24px rgba(108,99,255,0.2)' : '0 2px 8px rgba(0,0,0,0.3)',
                  }}>
                    {pg.blank ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: 'var(--text3)' }}>
                        <div style={{ width: '60px', height: '80px', background: '#fff', borderRadius: '4px', border: '1px solid var(--border)' }} />
                        <span style={{ fontSize: '10px' }}>Blank Page</span>
                      </div>
                    ) : (
                      <img src={pg.thumb} alt={`Page ${i + 1}`}
                        style={{
                          width: '100%', height: '100%', objectFit: 'contain',
                          transform: `rotate(${pg.rotation}deg)`,
                          transition: 'transform 0.25s',
                        }} />
                    )}
                  </div>

                  {/* Hover action buttons */}
                  {hoverId === pg.id && (
                    <div style={{
                      position: 'absolute', top: '8px', right: '8px',
                      display: 'flex', flexDirection: 'column', gap: '5px',
                    }}>
                      {!pg.blank && (
                        <button onClick={() => rotatePage(pg.id)}
                          title="Rotate 90°"
                          style={{
                            width: '28px', height: '28px', borderRadius: '7px', border: 'none',
                            background: 'rgba(108,99,255,0.85)', color: '#fff', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            backdropFilter: 'blur(4px)',
                          }}>
                          <RotateCw size={13} />
                        </button>
                      )}
                      <button onClick={() => deletePage(pg.id)}
                        title="Delete page"
                        style={{
                          width: '28px', height: '28px', borderRadius: '7px', border: 'none',
                          background: 'rgba(229,83,75,0.85)', color: '#fff', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          backdropFilter: 'blur(4px)',
                        }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}

                  {/* Page label */}
                  <div style={{ textAlign: 'center', marginTop: '7px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 600 }}>
                      {pg.blank ? '+ Blank' : `Page ${i + 1}`}
                    </span>
                    {pg.rotation !== 0 && (
                      <span style={{ fontSize: '10px', color: 'var(--accent2)', marginLeft: '5px' }}>
                        {pg.rotation}°
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {/* Add blank page card */}
              <div onClick={addBlank}
                style={{
                  width: '140px', height: '180px', borderRadius: '10px',
                  border: '2px dashed var(--border)', background: 'transparent',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: 'var(--text3)', gap: '8px', transition: 'all 0.15s',
                  flexShrink: 0,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent2)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text3)' }}>
                <Plus size={22} />
                <span style={{ fontSize: '11px', fontWeight: 600 }}>Add Blank</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
