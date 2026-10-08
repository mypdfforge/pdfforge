import React, { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Loader2, CheckCircle, AlertCircle, Download, RotateCw, RotateCcw } from 'lucide-react'
import TopBar from '../components/TopBar'
import axios from 'axios'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'

export default function RotateToolPage({ onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const [file,      setFile]      = useState(null)
  const [pages,     setPages]     = useState([])   // [{id, img, width, height, rotation}]
  const [selected,  setSelected]  = useState(new Set())
  const [loading,   setLoading]   = useState(false)
  const [status,    setStatus]    = useState('idle')
  const [errMsg,    setErrMsg]    = useState('')

  const onDrop = useCallback(a => {
    if (!a.length) return
    setFile(a[0]); setPages([]); setSelected(new Set()); setErrMsg('')
  }, [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept:{'application/pdf':['.pdf']}, maxFiles:1 })

  // Load thumbnails
  useEffect(() => {
    if (!file) return
    setLoading(true)
    setPages([])
    let first = true
    getThumbnailsProgressive(file, (thumb) => {
      if (first) { setLoading(false); first = false }  // hide spinner after page 1
      if (thumb.img) {  // skip placeholders for unrendered pages
        setPages(prev => [...prev, {
          id: thumb.page, img: thumb.img,
          width: thumb.width, height: thumb.height, rotation: 0
        }])
      }
    }, 8)
    .catch(() => setLoading(false))
  }, [file])

  // ── Selection helpers ──
  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const selectAll  = () => setSelected(new Set(pages.map(p => p.id)))
  const selectNone = () => setSelected(new Set())
  const selectOdd  = () => setSelected(new Set(pages.filter(p => p.id % 2 === 1).map(p => p.id)))
  const selectEven = () => setSelected(new Set(pages.filter(p => p.id % 2 === 0).map(p => p.id)))

  // ── Rotate helpers ──
  // Rotate a single page or all selected pages
  const rotate = (id, dir) => {
    const delta = dir === 'cw' ? 90 : -90
    const targets = selected.has(id) && selected.size > 1 ? selected : new Set([id])
    setPages(prev => prev.map(p =>
      targets.has(p.id) ? { ...p, rotation: ((p.rotation + delta) % 360 + 360) % 360 } : p
    ))
  }

  const rotateSelected = (dir) => {
    if (selected.size === 0) return
    const delta = dir === 'cw' ? 90 : -90
    setPages(prev => prev.map(p =>
      selected.has(p.id) ? { ...p, rotation: ((p.rotation + delta) % 360 + 360) % 360 } : p
    ))
  }

  const resetAll = () => setPages(prev => prev.map(p => ({ ...p, rotation: 0 })))

  // Count modified pages
  const modifiedCount = pages.filter(p => p.rotation !== 0).length

  // ── Download ──
  const download = async () => {
    if (!file || !modifiedCount) return
    setStatus('loading'); setErrMsg('')
    try {
      const rotations = {}
      pages.forEach(p => { if (p.rotation !== 0) rotations[p.id] = p.rotation })
      const form = new FormData()
      form.append('file', file)
      form.append('rotations', JSON.stringify(rotations))
      const res = await axios.post('/api/tools/rotate-visual', form, { responseType: 'blob' })
      downloadBlob(res.data, 'rotated.pdf')
      setStatus('done'); setTimeout(() => setStatus('idle'), 3000)
    } catch(e) {
      setErrMsg(e.response?.data?.detail || e.message || 'Rotation failed')
      setStatus('error')
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column' }}>
      <TopBar onBack={onBack} title="↻ Rotate Pages" subtitle="Click arrows on thumbnails to rotate"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory} onCategoryChange={onCategoryChange}
        search={search} onSearch={onSearch}/>

      {!file ? (
        /* ── Upload screen ── */
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'40px' }}>
          <div style={{ width:'100%', maxWidth:'480px' }}>
            <div {...getRootProps()} style={{ background:isDragActive?'rgba(91,91,214,0.08)':'var(--bg2)', border:`2px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'16px', padding:'60px 40px', textAlign:'center', cursor:'pointer', transition:'all 0.15s' }}>
              <input {...getInputProps()}/>
              <div style={{ width:'56px', height:'56px', background:'rgba(62,207,142,0.1)', border:'1px solid rgba(62,207,142,0.3)', borderRadius:'14px', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', fontSize:'24px' }}>↻</div>
              <p style={{ color:'#ffffff', fontWeight:600, fontSize:'16px', marginBottom:'8px' }}>Drop your PDF here</p>
              <p style={{ color:'#b0b0cc', fontSize:'13px' }}>or click to browse</p>
            </div>
          </div>
        </div>

      ) : loading ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:'12px', color:'#b0b0cc' }}>
          <Loader2 size={32} className="spin" color="var(--accent)"/>
          <p>Loading pages…</p>
        </div>

      ) : (
        <div style={{ display:'flex', flex:1, flexDirection:'column', height:'calc(100vh - 90px)', overflow:'hidden' }}>

          {/* ── Toolbar ── */}
          <div style={{ padding:'10px 20px', borderBottom:'1px solid var(--border)', background:'var(--bg2)', display:'flex', alignItems:'center', gap:'8px', flexShrink:0, flexWrap:'wrap' }}>

            {/* Selection */}
            <span style={{ fontSize:'12px', color:'#b0b0cc', fontWeight:600, marginRight:'4px' }}>Select:</span>
            {[['All', selectAll], ['None', selectNone], ['Odd', selectOdd], ['Even', selectEven]].map(([l, fn]) => (
              <button key={l} onClick={fn}
                style={{ fontSize:'12px', padding:'5px 12px', borderRadius:'6px', border:'1px solid var(--border)', background:'var(--bg3)', color:'#d0d0e8', cursor:'pointer' }}>
                {l}
              </button>
            ))}

            <div style={{ width:'1px', height:'20px', background:'var(--border)', margin:'0 4px' }}/>

            {/* Batch rotate */}
            <span style={{ fontSize:'12px', color:'#b0b0cc', fontWeight:600 }}>
              Rotate {selected.size > 0 ? `${selected.size} selected` : 'selected'}:
            </span>
            <button onClick={() => rotateSelected('ccw')} disabled={selected.size === 0}
              style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'12px', padding:'5px 12px', borderRadius:'6px', border:'1px solid var(--border)', background:selected.size>0?'var(--bg3)':'var(--bg2)', color:selected.size>0?'#d0d0e8':'#555566', cursor:selected.size>0?'pointer':'not-allowed' }}>
              <RotateCcw size={13}/> 90° CCW
            </button>
            <button onClick={() => rotateSelected('cw')} disabled={selected.size === 0}
              style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'12px', padding:'5px 12px', borderRadius:'6px', border:'1px solid var(--border)', background:selected.size>0?'var(--bg3)':'var(--bg2)', color:selected.size>0?'#d0d0e8':'#555566', cursor:selected.size>0?'pointer':'not-allowed' }}>
              <RotateCw size={13}/> 90° CW
            </button>

            <div style={{ flex:1 }}/>

            {modifiedCount > 0 && (
              <button onClick={resetAll}
                style={{ fontSize:'12px', padding:'5px 12px', borderRadius:'6px', border:'1px solid var(--border)', background:'none', color:'#b0b0cc', cursor:'pointer' }}>
                Reset All
              </button>
            )}

            {errMsg && (
              <span style={{ fontSize:'12px', color:'var(--red)', display:'flex', alignItems:'center', gap:'5px' }}>
                <AlertCircle size={12}/> {errMsg}
              </span>
            )}

            {modifiedCount > 0 && (
              <span style={{ fontSize:'12px', color:'#b0b0cc' }}>
                {modifiedCount} page{modifiedCount !== 1 ? 's' : ''} rotated
              </span>
            )}

            <button onClick={download} disabled={!modifiedCount || status === 'loading'}
              style={{ display:'flex', alignItems:'center', gap:'7px', padding:'8px 20px', borderRadius:'8px', border:'none', fontWeight:700, fontSize:'13px', cursor: modifiedCount ? 'pointer' : 'not-allowed', opacity: modifiedCount ? 1 : 0.45, transition:'all 0.15s',
                background: status==='done' ? 'var(--green)' : status==='loading' ? 'var(--bg3)' : 'var(--accent)',
                color: status==='loading' ? '#b0b0cc' : '#fff',
                boxShadow: modifiedCount ? '0 2px 12px rgba(108,99,255,0.35)' : 'none' }}>
              {status==='loading' ? <><Loader2 size={13} className="spin"/>Applying…</>
               : status==='done'  ? <><CheckCircle size={13}/>Downloaded!</>
               :                    <><Download size={13}/>Download Rotated PDF</>}
            </button>
          </div>

          {/* ── Page grid ── */}
          <div style={{ flex:1, overflowY:'auto', padding:'24px', display:'flex', flexWrap:'wrap', gap:'16px', alignContent:'flex-start' }}>
            {pages.map(p => {
              const isSel = selected.has(p.id)
              const isRotated = p.rotation !== 0
              return (
                <div key={p.id}
                  style={{ position:'relative', width:'140px', flexShrink:0, cursor:'pointer',
                    borderRadius:'12px', border:`2px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`,
                    background: isSel ? 'rgba(108,99,255,0.08)' : 'var(--bg2)',
                    boxShadow: isSel ? '0 0 0 3px rgba(108,99,255,0.2)' : 'none',
                    transition:'all 0.15s', overflow:'visible' }}>

                  {/* Thumbnail — click to select */}
                  <div onClick={() => toggleSelect(p.id)}
                    style={{ padding:'8px', paddingBottom:'4px', overflow:'hidden', borderRadius:'10px 10px 0 0' }}>
                    <div style={{ overflow:'hidden', borderRadius:'6px', background:'#fff' }}>
                      <img src={p.img} alt={`p${p.id}`}
                        style={{ width:'100%', display:'block', transition:'transform 0.3s ease',
                          transform: `rotate(${p.rotation}deg)`,
                          // For 90/270 we need to scale to fit
                          ...(p.rotation === 90 || p.rotation === 270 ? {
                            width: `${p.height / p.width * 100}%`,
                            marginLeft: `${(1 - p.height/p.width) / 2 * 100}%`,
                          } : {})
                        }}/>
                    </div>
                  </div>

                  {/* Page label + rotation badge */}
                  <div style={{ padding:'4px 8px 6px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <span style={{ fontSize:'11px', color: isSel ? '#ffffff' : '#b0b0cc', fontWeight:600 }}>p.{p.id}</span>
                    {isRotated && (
                      <span style={{ fontSize:'10px', background:'var(--green)', color:'#000', borderRadius:'4px', padding:'1px 5px', fontWeight:700 }}>
                        {p.rotation}°
                      </span>
                    )}
                  </div>

                  {/* Rotate buttons — always visible at bottom */}
                  <div style={{ position:'absolute', bottom:'-18px', left:'50%', transform:'translateX(-50%)', display:'flex', gap:'4px', zIndex:10 }}>
                    <button onClick={e => { e.stopPropagation(); rotate(p.id, 'ccw') }}
                      title="Rotate 90° counter-clockwise"
                      style={{ width:'32px', height:'32px', borderRadius:'50%', border:'2px solid var(--border)', background:'var(--bg3)', color:'#d0d0e8', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.15s', boxShadow:'0 2px 8px rgba(0,0,0,0.3)' }}
                      onMouseEnter={e => { e.currentTarget.style.background='var(--accent)'; e.currentTarget.style.color='#fff' }}
                      onMouseLeave={e => { e.currentTarget.style.background='var(--bg3)'; e.currentTarget.style.color='#d0d0e8' }}>
                      <RotateCcw size={14}/>
                    </button>
                    <button onClick={e => { e.stopPropagation(); rotate(p.id, 'cw') }}
                      title="Rotate 90° clockwise"
                      style={{ width:'32px', height:'32px', borderRadius:'50%', border:'2px solid var(--border)', background:'var(--bg3)', color:'#d0d0e8', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.15s', boxShadow:'0 2px 8px rgba(0,0,0,0.3)' }}
                      onMouseEnter={e => { e.currentTarget.style.background='var(--accent)'; e.currentTarget.style.color='#fff' }}
                      onMouseLeave={e => { e.currentTarget.style.background='var(--bg3)'; e.currentTarget.style.color='#d0d0e8' }}>
                      <RotateCw size={14}/>
                    </button>
                  </div>

                  {/* Checkbox top-right */}
                  <div onClick={() => toggleSelect(p.id)}
                    style={{ position:'absolute', top:'6px', right:'6px', width:'20px', height:'20px', borderRadius:'50%',
                      background: isSel ? 'var(--accent)' : 'rgba(0,0,0,0.5)', border:'2px solid #fff',
                      display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', color:'#fff', fontWeight:700, cursor:'pointer' }}>
                    {isSel ? '✓' : ''}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
