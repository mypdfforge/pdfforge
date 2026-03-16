import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Loader2, CheckCircle, AlertCircle, Download, RotateCcw } from 'lucide-react'
import TopBar from '../components/TopBar'
import axios from 'axios'
import { downloadBlob } from '../utils/api'

// Convert pixel crop box (on canvas) to PDF points
function pxToPdfCrop(box, canvasW, canvasH, pdfW, pdfH) {
  const scaleX = pdfW / canvasW
  const scaleY = pdfH / canvasH
  return {
    left:   Math.round(box.x * scaleX),
    top:    Math.round(box.y * scaleY),
    right:  Math.round((canvasW - box.x - box.w) * scaleX),
    bottom: Math.round((canvasH - box.y - box.h) * scaleY),
  }
}

const HANDLE_SIZE = 10
const MIN_BOX = 40

function CropCanvas({ imgSrc, cropBox, onCropChange, pdfW, pdfH }) {
  const canvasRef   = useRef(null)
  const imgRef      = useRef(null)
  const dragging    = useRef(null) // { type:'move'|'nw'|'ne'|'sw'|'se'|'n'|'s'|'e'|'w', startX, startY, startBox }

  // Draw everything
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imgRef.current?.complete) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // Draw page image
    ctx.drawImage(imgRef.current, 0, 0, W, H)

    // Dim outside crop box
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    const { x, y, w, h } = cropBox
    ctx.fillRect(0, 0, W, y)                        // top
    ctx.fillRect(0, y + h, W, H - y - h)            // bottom
    ctx.fillRect(0, y, x, h)                         // left
    ctx.fillRect(x + w, y, W - x - w, h)            // right

    // Crop border
    ctx.strokeStyle = '#6c63ff'
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, w, h)

    // Grid lines inside box (rule of thirds)
    ctx.strokeStyle = 'rgba(108,99,255,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + w/3, y); ctx.lineTo(x + w/3, y + h)
    ctx.moveTo(x + 2*w/3, y); ctx.lineTo(x + 2*w/3, y + h)
    ctx.moveTo(x, y + h/3); ctx.lineTo(x + w, y + h/3)
    ctx.moveTo(x, y + 2*h/3); ctx.lineTo(x + w, y + 2*h/3)
    ctx.stroke()

    // Corner + edge handles
    const handles = getHandles(cropBox)
    handles.forEach(hnd => {
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#6c63ff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(hnd.cx, hnd.cy, HANDLE_SIZE/2 + 2, 0, Math.PI*2)
      ctx.fill(); ctx.stroke()
    })
  }, [imgSrc, cropBox])

  function getHandles(b) {
    const { x, y, w, h } = b
    return [
      { id:'nw', cx:x,       cy:y       },
      { id:'n',  cx:x+w/2,   cy:y       },
      { id:'ne', cx:x+w,     cy:y       },
      { id:'e',  cx:x+w,     cy:y+h/2   },
      { id:'se', cx:x+w,     cy:y+h     },
      { id:'s',  cx:x+w/2,   cy:y+h     },
      { id:'sw', cx:x,       cy:y+h     },
      { id:'w',  cx:x,       cy:y+h/2   },
    ]
  }

  function hitHandle(mx, my, b) {
    for (const hnd of getHandles(b)) {
      if (Math.abs(mx - hnd.cx) < HANDLE_SIZE+2 && Math.abs(my - hnd.cy) < HANDLE_SIZE+2) return hnd.id
    }
    return null
  }

  function hitMove(mx, my, b) {
    return mx > b.x && mx < b.x+b.w && my > b.y && my < b.y+b.h
  }

  function getPos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width  / rect.width
    const scaleY = canvasRef.current.height / rect.height
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return { mx: (clientX - rect.left) * scaleX, my: (clientY - rect.top) * scaleY }
  }

  function onMouseDown(e) {
    const { mx, my } = getPos(e)
    const handle = hitHandle(mx, my, cropBox)
    if (handle) {
      dragging.current = { type: handle, startX: mx, startY: my, startBox: { ...cropBox } }
    } else if (hitMove(mx, my, cropBox)) {
      dragging.current = { type: 'move', startX: mx, startY: my, startBox: { ...cropBox } }
    }
  }

  function onMouseMove(e) {
    if (!dragging.current) return
    const canvas = canvasRef.current
    const W = canvas.width, H = canvas.height
    const { mx, my } = getPos(e)
    const { type, startX, startY, startBox: s } = dragging.current
    const dx = mx - startX, dy = my - startY
    let { x, y, w, h } = s

    if (type === 'move') {
      x = Math.max(0, Math.min(W - w, x + dx))
      y = Math.max(0, Math.min(H - h, y + dy))
    } else {
      if (type.includes('e')) { w = Math.max(MIN_BOX, Math.min(W - x, w + dx)) }
      if (type.includes('w')) { const nw = Math.max(MIN_BOX, w - dx); x = Math.min(x + w - MIN_BOX, x + dx); w = nw; x = Math.max(0, x) }
      if (type.includes('s')) { h = Math.max(MIN_BOX, Math.min(H - y, h + dy)) }
      if (type.includes('n')) { const nh = Math.max(MIN_BOX, h - dy); y = Math.min(y + h - MIN_BOX, y + dy); h = nh; y = Math.max(0, y) }
    }

    onCropChange({ x, y, w, h })
  }

  function onMouseUp() { dragging.current = null }

  function getCursor(e) {
    if (!canvasRef.current) return
    const { mx, my } = getPos(e)
    const h = hitHandle(mx, my, cropBox)
    const cursors = { nw:'nw-resize', ne:'ne-resize', sw:'sw-resize', se:'se-resize', n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize', move:'move' }
    canvasRef.current.style.cursor = h ? cursors[h] : hitMove(mx, my, cropBox) ? 'move' : 'default'
  }

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <img ref={imgRef} src={imgSrc} alt="" style={{ display:'none' }} onLoad={() => {
        const canvas = canvasRef.current
        if (!canvas || !imgRef.current) return
        canvas.width  = imgRef.current.naturalWidth
        canvas.height = imgRef.current.naturalHeight
        // force redraw
        onCropChange({ ...cropBox })
      }}/>
      <canvas ref={canvasRef}
        style={{ maxWidth:'100%', maxHeight:'100%', cursor:'default', borderRadius:'3px', boxShadow:'0 4px 32px rgba(0,0,0,0.5)' }}
        onMouseDown={onMouseDown} onMouseMove={e => { getCursor(e); onMouseMove(e) }}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onTouchStart={onMouseDown} onTouchMove={onMouseMove} onTouchEnd={onMouseUp}
      />
    </div>
  )
}

export default function CropToolPage({ onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const [file,       setFile]       = useState(null)
  const [thumbs,     setThumbs]     = useState([])   // [{page, img, pdfW, pdfH}]
  const [loading,    setLoading]    = useState(false)
  const [activePage, setActivePage] = useState(1)
  const [cropBoxes,  setCropBoxes]  = useState({})   // { pageNum: {x,y,w,h} }
  const [status,     setStatus]     = useState('idle')
  const [errMsg,     setErrMsg]     = useState('')
  const [modCount,   setModCount]   = useState(0)

  const onDrop = useCallback(a => {
    if (!a.length) return
    setFile(a[0]); setThumbs([]); setCropBoxes({}); setActivePage(1); setErrMsg('')
  }, [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept:{'application/pdf':['.pdf']}, maxFiles:1 })

  // Load thumbnails at higher resolution for canvas
  useEffect(() => {
    if (!file) return
    setLoading(true)
    const form = new FormData(); form.append('file', file)
    axios.post('/api/tools/thumbnails', form)
      .then(r => {
        setThumbs(r.data.thumbnails)
        setLoading(false)
        // Init default crop boxes (full page) for each page
        const boxes = {}
        r.data.thumbnails.forEach(t => {
          boxes[t.page] = { x: 0, y: 0, w: t.width, h: t.height }
        })
        setCropBoxes(boxes)
      })
      .catch(() => setLoading(false))
  }, [file])

  useEffect(() => {
    const modified = Object.entries(cropBoxes).filter(([page, box]) => {
      const thumb = thumbs.find(t => t.page === parseInt(page))
      if (!thumb) return false
      return box.x > 2 || box.y > 2 || box.w < thumb.width - 2 || box.h < thumb.height - 2
    }).length
    setModCount(modified)
  }, [cropBoxes, thumbs])

  const activeThumb = thumbs.find(t => t.page === activePage)
  const activeCrop  = cropBoxes[activePage] || { x:0, y:0, w:100, h:100 }

  const handleCropChange = (box) => {
    setCropBoxes(prev => ({ ...prev, [activePage]: box }))
  }

  const applyToAll = () => {
    const box = cropBoxes[activePage]
    if (!box) return
    const newBoxes = {}
    thumbs.forEach(t => { newBoxes[t.page] = { ...box } })
    setCropBoxes(newBoxes)
  }

  const resetPage = () => {
    const thumb = thumbs.find(t => t.page === activePage)
    if (!thumb) return
    setCropBoxes(prev => ({ ...prev, [activePage]: { x:0, y:0, w:thumb.width, h:thumb.height } }))
  }

  const resetAll = () => {
    const boxes = {}
    thumbs.forEach(t => { boxes[t.page] = { x:0, y:0, w:t.width, h:t.height } })
    setCropBoxes(boxes)
  }

  const download = async () => {
    if (!file) return
    setStatus('loading'); setErrMsg('')
    try {
      // Build per-page crop data in PDF points
      const pageCrops = {}
      thumbs.forEach(t => {
        const box = cropBoxes[t.page]
        if (!box) return
        // Convert canvas px → PDF points (thumb is ~0.35 scale, PDF width ~595pt)
        // We stored px relative to thumbnail dims, convert to percentage then to points
        pageCrops[t.page] = pxToPdfCrop(box, t.width, t.height, t.width / 0.35, t.height / 0.35)
      })
      const form = new FormData()
      form.append('file', file)
      form.append('crops', JSON.stringify(pageCrops))
      const res = await axios.post('/api/tools/crop-visual', form, { responseType:'blob' })
      downloadBlob(res.data, 'cropped.pdf')
      setStatus('done'); setTimeout(() => setStatus('idle'), 3000)
    } catch(e) {
      setErrMsg(e.response?.data?.detail || e.message || 'Crop failed')
      setStatus('error')
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column' }}>
      <TopBar onBack={onBack} title="⬚ Crop PDF" subtitle="Drag to crop each page visually"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory} onCategoryChange={onCategoryChange}
        search={search} onSearch={onSearch}/>

      {!file ? (
        /* ── Upload screen ── */
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'40px' }}>
          <div style={{ width:'100%', maxWidth:'480px' }}>
            <div {...getRootProps()} style={{ background:isDragActive?'rgba(91,91,214,0.08)':'var(--bg2)', border:`2px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'16px', padding:'60px 40px', textAlign:'center', cursor:'pointer', transition:'all 0.15s' }}>
              <input {...getInputProps()}/>
              <div style={{ width:'56px', height:'56px', background:'rgba(108,99,255,0.1)', border:'1px solid rgba(108,99,255,0.3)', borderRadius:'14px', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', fontSize:'24px' }}>⬚</div>
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
        /* ── Main crop UI ── */
        <div style={{ display:'flex', flex:1, height:'calc(100vh - 90px)', overflow:'hidden' }}>

          {/* Left: page thumbnail sidebar */}
          <div style={{ width:'130px', flexShrink:0, borderRight:'1px solid var(--border)', background:'var(--bg2)', overflowY:'auto', display:'flex', flexDirection:'column' }}>
            <div style={{ padding:'8px', fontSize:'10px', fontWeight:700, color:'#b0b0cc', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid var(--border)' }}>
              Pages
            </div>
            {thumbs.map(t => {
              const box = cropBoxes[t.page]
              const isModified = box && (box.x > 2 || box.y > 2 || box.w < t.width - 2 || box.h < t.height - 2)
              return (
                <div key={t.page} onClick={() => setActivePage(t.page)}
                  style={{ padding:'8px', cursor:'pointer', background: activePage===t.page ? 'rgba(108,99,255,0.15)' : 'transparent', borderBottom:'1px solid var(--border)', transition:'background 0.12s', position:'relative' }}>
                  <div style={{ border:`2px solid ${activePage===t.page ? 'var(--accent)' : 'var(--border)'}`, borderRadius:'5px', overflow:'hidden' }}>
                    <img src={t.img} alt={`p${t.page}`} style={{ width:'100%', display:'block' }}/>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:'4px' }}>
                    <span style={{ fontSize:'9px', color: activePage===t.page ? '#ffffff' : '#b0b0cc' }}>p.{t.page}</span>
                    {isModified && <span style={{ fontSize:'8px', background:'var(--accent)', color:'#fff', borderRadius:'3px', padding:'1px 4px' }}>✂</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Center: canvas preview */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#0a0a12' }}>
            {/* Page info bar */}
            <div style={{ padding:'8px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:'12px', background:'var(--bg2)', flexShrink:0 }}>
              <span style={{ fontSize:'12px', color:'#ffffff', fontWeight:600 }}>Page {activePage} of {thumbs.length}</span>
              {activeThumb && activeCrop && (
                <span style={{ fontSize:'11px', color:'#b0b0cc' }}>
                  Crop: {Math.round(activeCrop.x)}px, {Math.round(activeCrop.y)}px — {Math.round(activeCrop.w)}×{Math.round(activeCrop.h)}
                </span>
              )}
              <div style={{ flex:1 }}/>
              <button onClick={resetPage}
                style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'12px', color:'#b0b0cc', background:'none', border:'1px solid var(--border)', borderRadius:'6px', padding:'4px 10px', cursor:'pointer' }}>
                <RotateCcw size={12}/> Reset page
              </button>
            </div>

            {/* Canvas */}
            <div style={{ flex:1, padding:'24px', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
              {activeThumb && (
                <CropCanvas
                  key={activePage}
                  imgSrc={activeThumb.img}
                  cropBox={activeCrop}
                  onCropChange={handleCropChange}
                  pdfW={activeThumb.width / 0.35}
                  pdfH={activeThumb.height / 0.35}
                />
              )}
            </div>

            {/* Bottom action bar */}
            <div style={{ padding:'12px 20px', borderTop:'1px solid var(--border)', background:'var(--bg2)', display:'flex', alignItems:'center', gap:'10px', flexShrink:0 }}>
              {/* Option A */}
              <button onClick={applyToAll}
                style={{ display:'flex', alignItems:'center', gap:'6px', padding:'9px 18px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--bg3)', color:'#ffffff', fontSize:'13px', fontWeight:600, cursor:'pointer', transition:'all 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor='var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor='var(--border)'}>
                ⟳ Apply to All Pages
              </button>

              {/* Option B */}
              <button onClick={() => setActivePage(p => Math.min(thumbs.length, p + 1))}
                style={{ display:'flex', alignItems:'center', gap:'6px', padding:'9px 18px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--bg3)', color:'#ffffff', fontSize:'13px', fontWeight:600, cursor:'pointer', transition:'all 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor='var(--green)'}
                onMouseLeave={e => e.currentTarget.style.borderColor='var(--border)'}>
                ✓ Crop This Page → Next
              </button>

              <button onClick={resetAll}
                style={{ padding:'9px 14px', borderRadius:'8px', border:'1px solid var(--border)', background:'none', color:'#b0b0cc', fontSize:'13px', cursor:'pointer' }}>
                Reset All
              </button>

              <div style={{ flex:1 }}/>

              {/* Summary */}
              {modCount > 0 && (
                <span style={{ fontSize:'12px', color:'#b0b0cc' }}>
                  {modCount} page{modCount!==1?'s':''} modified
                </span>
              )}

              {errMsg && (
                <span style={{ fontSize:'12px', color:'var(--red)', display:'flex', alignItems:'center', gap:'5px' }}>
                  <AlertCircle size={12}/> {errMsg}
                </span>
              )}

              {/* Download button */}
              <button onClick={download} disabled={status==='loading'}
                style={{ display:'flex', alignItems:'center', gap:'7px', padding:'10px 22px', borderRadius:'9px', border:'none', fontWeight:700, fontSize:'14px', cursor:'pointer', transition:'all 0.15s',
                  background: status==='done' ? 'var(--green)' : status==='loading' ? 'var(--bg3)' : 'var(--gold)',
                  color: status==='loading' ? '#b0b0cc' : '#000',
                  boxShadow: status!=='loading' ? '0 2px 16px rgba(245,166,35,0.4)' : 'none' }}>
                {status==='loading' ? <><Loader2 size={14} className="spin"/>Cropping…</>
                 : status==='done'  ? <><CheckCircle size={14}/>Downloaded!</>
                 :                    <><Download size={14}/>Download Cropped PDF</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
