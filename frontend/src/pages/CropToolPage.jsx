import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Loader2, CheckCircle, AlertCircle, Download, RotateCcw, X, Crop, ChevronsRight } from 'lucide-react'
import TopBar from '../components/TopBar'
import axios from 'axios'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// Global: always holds the latest crop of the currently active page.
// "Apply to All" reads this — no re-render cost, no prop drilling.
let currentCropSettings = null

// ─── CropCanvas ───────────────────────────────────────────────────────────────
function CropCanvas({ imgSrc, cropBox, onCropChange }) {
  const canvasRef = useRef(null)
  const imgRef    = useRef(null)
  const dragging  = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imgRef.current?.complete) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    ctx.drawImage(imgRef.current, 0, 0, W, H)

    const { x, y, w, h } = cropBox
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, 0, W, y)
    ctx.fillRect(0, y + h, W, H - y - h)
    ctx.fillRect(0, y, x, h)
    ctx.fillRect(x + w, y, W - x - w, h)

    ctx.strokeStyle = '#6c63ff'
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, w, h)

    ctx.strokeStyle = 'rgba(108,99,255,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + w/3, y);     ctx.lineTo(x + w/3, y + h)
    ctx.moveTo(x + 2*w/3, y);   ctx.lineTo(x + 2*w/3, y + h)
    ctx.moveTo(x, y + h/3);     ctx.lineTo(x + w, y + h/3)
    ctx.moveTo(x, y + 2*h/3);   ctx.lineTo(x + w, y + 2*h/3)
    ctx.stroke()

    getHandles(cropBox).forEach(hnd => {
      ctx.fillStyle = '#fff'
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
      { id:'nw', cx:x,       cy:y       }, { id:'n',  cx:x+w/2, cy:y       },
      { id:'ne', cx:x+w,     cy:y       }, { id:'e',  cx:x+w,   cy:y+h/2   },
      { id:'se', cx:x+w,     cy:y+h     }, { id:'s',  cx:x+w/2, cy:y+h     },
      { id:'sw', cx:x,       cy:y+h     }, { id:'w',  cx:x,     cy:y+h/2   },
    ]
  }

  function hitHandle(mx, my, b) {
    for (const hnd of getHandles(b)) {
      if (Math.abs(mx-hnd.cx) < HANDLE_SIZE+2 && Math.abs(my-hnd.cy) < HANDLE_SIZE+2) return hnd.id
    }
    return null
  }
  function hitMove(mx, my, b) { return mx>b.x && mx<b.x+b.w && my>b.y && my<b.y+b.h }

  function getPos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const sx = canvasRef.current.width  / rect.width
    const sy = canvasRef.current.height / rect.height
    const cx = e.touches ? e.touches[0].clientX : e.clientX
    const cy = e.touches ? e.touches[0].clientY : e.clientY
    return { mx:(cx-rect.left)*sx, my:(cy-rect.top)*sy }
  }

  function onMouseDown(e) {
    const {mx,my} = getPos(e)
    const handle = hitHandle(mx,my,cropBox)
    if (handle) dragging.current = { type:handle, startX:mx, startY:my, startBox:{...cropBox} }
    else if (hitMove(mx,my,cropBox)) dragging.current = { type:'move', startX:mx, startY:my, startBox:{...cropBox} }
  }

  function onMouseMove(e) {
    if (!dragging.current) return
    const canvas = canvasRef.current
    const W = canvas.width, H = canvas.height
    const {mx,my} = getPos(e)
    const {type,startX,startY,startBox:s} = dragging.current
    const dx=mx-startX, dy=my-startY
    let {x,y,w,h} = s
    if (type==='move') { x=Math.max(0,Math.min(W-w,x+dx)); y=Math.max(0,Math.min(H-h,y+dy)) }
    else {
      if(type.includes('e')){w=Math.max(MIN_BOX,Math.min(W-x,w+dx))}
      if(type.includes('w')){const nw=Math.max(MIN_BOX,w-dx);x=Math.min(x+w-MIN_BOX,x+dx);w=nw;x=Math.max(0,x)}
      if(type.includes('s')){h=Math.max(MIN_BOX,Math.min(H-y,h+dy))}
      if(type.includes('n')){const nh=Math.max(MIN_BOX,h-dy);y=Math.min(y+h-MIN_BOX,y+dy);h=nh;y=Math.max(0,y)}
    }
    onCropChange({x,y,w,h})
  }

  function onMouseUp() { dragging.current = null }

  function getCursor(e) {
    if (!canvasRef.current) return
    const {mx,my} = getPos(e)
    const h = hitHandle(mx,my,cropBox)
    const map = {nw:'nw-resize',ne:'ne-resize',sw:'sw-resize',se:'se-resize',n:'n-resize',s:'s-resize',e:'e-resize',w:'w-resize'}
    canvasRef.current.style.cursor = h ? map[h] : hitMove(mx,my,cropBox) ? 'move' : 'default'
  }

  return (
    <div style={{position:'relative',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <img ref={imgRef} src={imgSrc} alt="" style={{display:'none'}} onLoad={() => {
        const canvas = canvasRef.current
        if (!canvas || !imgRef.current) return
        canvas.width  = imgRef.current.naturalWidth
        canvas.height = imgRef.current.naturalHeight
        onCropChange({...cropBox})
      }}/>
      <canvas ref={canvasRef}
        style={{maxWidth:'100%',maxHeight:'100%',cursor:'default',borderRadius:'4px',boxShadow:'0 4px 32px rgba(0,0,0,0.6)'}}
        onMouseDown={onMouseDown} onMouseMove={e=>{getCursor(e);onMouseMove(e)}}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onTouchStart={onMouseDown} onTouchMove={onMouseMove} onTouchEnd={onMouseUp}
      />
    </div>
  )
}

// ─── PageCard — matches Split PDF grid card style ─────────────────────────────
function PageCard({ thumb, pageNum, isModified, onClick }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'8px', cursor:'pointer' }}
    >
      <div style={{
        width:'100%', aspectRatio:'3/4', borderRadius:'8px', overflow:'hidden',
        background:'var(--bg3)', position:'relative',
        border: `2px solid ${hovered ? 'var(--accent)' : 'transparent'}`,
        boxShadow: hovered ? '0 0 0 2px rgba(108,99,255,0.25)' : '0 2px 8px rgba(0,0,0,0.4)',
        transition:'border-color 0.15s, box-shadow 0.15s',
      }}>
        {thumb?.img
          ? <img src={thumb.img} alt={`page ${pageNum}`} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
          : <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <Loader2 size={16} className="spin" color="var(--text3)"/>
            </div>
        }

        {/* Hover action icon */}
        {hovered && (
          <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.3)',display:'flex',alignItems:'center',justifyContent:'center',gap:'8px'}}>
            <div style={{width:'34px',height:'34px',borderRadius:'8px',background:'var(--accent)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',boxShadow:'0 2px 8px rgba(0,0,0,0.4)'}}>
              <Crop size={16}/>
            </div>
          </div>
        )}

        {/* Cropped badge */}
        {isModified && (
          <div style={{position:'absolute',top:'5px',right:'5px',background:'var(--accent)',color:'#fff',fontSize:'9px',fontWeight:700,borderRadius:'4px',padding:'2px 5px'}}>
            ✂ cropped
          </div>
        )}
      </div>

      <span style={{fontSize:'12px', color:'var(--text2)', fontWeight:500}}>
        Page {pageNum}
      </span>
    </div>
  )
}

// ─── Crop Modal (fullscreen overlay, opens on card click) ─────────────────────
function CropModal({ thumb, pageNum, totalPages, cropBox, onCropChange, onClose, onResetPage, onApplyToAll, onNext }) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.8)',display:'flex',flexDirection:'column',backdropFilter:'blur(4px)'}}>
      {/* Header */}
      <div style={{padding:'10px 20px',background:'var(--bg2)',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:'12px',flexShrink:0}}>
        <span style={{fontSize:'13px',fontWeight:700,color:'var(--text)'}}>
          ⬚ Crop — Page {pageNum} of {totalPages}
        </span>
        {cropBox && thumb && (
          <span style={{fontSize:'11px',color:'var(--text3)'}}>
            {Math.round(cropBox.x)}, {Math.round(cropBox.y)} — {Math.round(cropBox.w)}×{Math.round(cropBox.h)}px
          </span>
        )}
        <div style={{flex:1}}/>
        <button onClick={onResetPage}
          style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'12px',color:'var(--text2)',background:'none',border:'1px solid var(--border)',borderRadius:'6px',padding:'5px 10px',cursor:'pointer'}}>
          <RotateCcw size={12}/> Reset
        </button>
        <button onClick={onApplyToAll}
          style={{display:'flex',alignItems:'center',gap:'6px',padding:'7px 16px',borderRadius:'8px',border:'1px solid var(--border)',background:'var(--bg3)',color:'var(--text)',fontSize:'12px',fontWeight:600,cursor:'pointer',transition:'border-color 0.15s'}}
          onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'}
          onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
          <Crop size={12}/> Apply to All
        </button>
        <button onClick={onNext} disabled={pageNum >= totalPages}
          style={{display:'flex',alignItems:'center',gap:'6px',padding:'7px 16px',borderRadius:'8px',border:'1px solid var(--border)',background:'var(--bg3)',color:pageNum>=totalPages?'var(--text3)':'var(--text)',fontSize:'12px',fontWeight:600,cursor:pageNum>=totalPages?'not-allowed':'pointer'}}>
          <ChevronsRight size={12}/> Next Page
        </button>
        <button onClick={onClose}
          style={{width:'32px',height:'32px',borderRadius:'8px',border:'1px solid var(--border)',background:'var(--bg3)',color:'var(--text2)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <X size={14}/>
        </button>
      </div>

      {/* Canvas */}
      <div style={{flex:1,padding:'24px',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',background:'#0a0a12'}}>
        {thumb && cropBox && (
          <CropCanvas key={pageNum} imgSrc={thumb.img} cropBox={cropBox} onCropChange={onCropChange}/>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CropToolPage({ onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const [file,       setFile]       = useState(null)
  const [pages,      setPages]      = useState([])
  const [loading,    setLoading]    = useState(false)
  const [activePage, setActivePage] = useState(null)
  const [cropBoxes,  setCropBoxes]  = useState({})
  const [status,     setStatus]     = useState('idle')
  const [errMsg,     setErrMsg]     = useState('')
  const [modCount,   setModCount]   = useState(0)

  const onDrop = useCallback(accepted => {
    if (!accepted.length) return
    setFile(accepted[0]); setPages([]); setCropBoxes({})
    setActivePage(null); setErrMsg(''); currentCropSettings = null
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1,
  })

  useEffect(() => {
    if (!file) return
    setLoading(true); setPages([])
    let first = true
    getThumbnailsProgressive(file, (thumb) => {
      if (first) { setLoading(false); first = false }
      if (thumb.img) {
        setPages(prev => [...prev, thumb])
        setCropBoxes(prev => ({ ...prev, [thumb.page]: { x:0, y:0, w:thumb.width, h:thumb.height } }))
      }
    }, 8).catch(() => setLoading(false))
  }, [file])

  // Keep currentCropSettings synced to active page's crop
  const activeCrop  = activePage ? cropBoxes[activePage] : null
  const activeThumb = pages.find(t => t.page === activePage)

  useEffect(() => {
    if (activeCrop) currentCropSettings = { ...activeCrop }
  }, [activeCrop])

  useEffect(() => {
    const count = pages.filter(t => {
      const box = cropBoxes[t.page]
      return box && (box.x > 2 || box.y > 2 || box.w < t.width - 2 || box.h < t.height - 2)
    }).length
    setModCount(count)
  }, [cropBoxes, pages])

  const handleCropChange = (box) => setCropBoxes(prev => ({ ...prev, [activePage]: box }))

  const applyToAll = () => {
    if (!currentCropSettings || !activeThumb) return
    const snap = { ...currentCropSettings }
    const newBoxes = {}
    pages.forEach(t => {
      const sx = t.width  / activeThumb.width
      const sy = t.height / activeThumb.height
      newBoxes[t.page] = {
        x: Math.max(0, Math.round(snap.x * sx)),
        y: Math.max(0, Math.round(snap.y * sy)),
        w: Math.min(t.width,  Math.round(snap.w * sx)),
        h: Math.min(t.height, Math.round(snap.h * sy)),
      }
    })
    setCropBoxes(newBoxes)
  }

  const resetPage = () => {
    const thumb = pages.find(t => t.page === activePage)
    if (!thumb) return
    setCropBoxes(prev => ({ ...prev, [activePage]: { x:0, y:0, w:thumb.width, h:thumb.height } }))
  }

  const resetAll = () => {
    const boxes = {}
    pages.forEach(t => { boxes[t.page] = { x:0, y:0, w:t.width, h:t.height } })
    setCropBoxes(boxes)
  }

  const download = async () => {
    if (!file) return
    setStatus('loading'); setErrMsg('')
    try {
      const pageCrops = {}
      pages.forEach(t => {
        const box = cropBoxes[t.page]
        if (!box) return
        pageCrops[t.page] = pxToPdfCrop(box, t.width, t.height, t.width/0.35, t.height/0.35)
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
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',flexDirection:'column'}}>
      <TopBar
        onBack={onBack} title="⬚ Crop PDF" subtitle="Click any page to set crop region"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory}
        onCategoryChange={onCategoryChange} search={search} onSearch={onSearch}
      />

      {!file ? (
        <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:'40px'}}>
          <div style={{width:'100%',maxWidth:'480px'}}>
            <div {...getRootProps()} style={{
              background:isDragActive?'rgba(91,91,214,0.08)':'var(--bg2)',
              border:`2px dashed ${isDragActive?'var(--accent)':'var(--border)'}`,
              borderRadius:'16px',padding:'60px 40px',textAlign:'center',cursor:'pointer',transition:'all 0.15s',
            }}>
              <input {...getInputProps()}/>
              <div style={{width:'56px',height:'56px',background:'rgba(108,99,255,0.1)',border:'1px solid rgba(108,99,255,0.3)',borderRadius:'14px',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px',fontSize:'24px'}}>⬚</div>
              <p style={{color:'var(--text)',fontWeight:600,fontSize:'16px',marginBottom:'8px'}}>Drop your PDF here</p>
              <p style={{color:'var(--text3)',fontSize:'13px'}}>or click to browse</p>
            </div>
          </div>
        </div>

      ) : (
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

          {/* Action bar */}
          <div style={{padding:'10px 24px',borderBottom:'1px solid var(--border)',background:'var(--bg2)',display:'flex',alignItems:'center',gap:'10px',flexShrink:0}}>
            <span style={{fontSize:'13px',color:'var(--text2)',marginRight:'auto'}}>
              📄 <strong style={{color:'var(--text)'}}>{file.name}</strong>
              <span style={{color:'var(--text3)',marginLeft:'8px'}}>{pages.length}{loading?'…':''} pages</span>
            </span>
            {modCount > 0 && (
              <span style={{fontSize:'12px',color:'var(--text3)'}}>{modCount} page{modCount!==1?'s':''} cropped</span>
            )}
            <button onClick={resetAll}
              style={{padding:'7px 14px',borderRadius:'8px',border:'1px solid var(--border)',background:'none',color:'var(--text3)',cursor:'pointer',fontSize:'12px'}}>
              Reset All
            </button>
            <button onClick={()=>{setFile(null);setPages([]);setCropBoxes({})}}
              style={{padding:'7px 14px',borderRadius:'8px',border:'1px solid var(--border)',background:'var(--bg3)',color:'var(--text2)',cursor:'pointer',fontSize:'12px'}}>
              Change PDF
            </button>
            {errMsg && (
              <span style={{fontSize:'12px',color:'var(--red)',display:'flex',alignItems:'center',gap:'5px'}}>
                <AlertCircle size={12}/> {errMsg}
              </span>
            )}
            <button onClick={download} disabled={status==='loading'}
              style={{
                display:'flex',alignItems:'center',gap:'7px',
                padding:'8px 20px',borderRadius:'9px',border:'none',
                fontWeight:700,fontSize:'13px',cursor:'pointer',
                background:status==='done'?'var(--green)':status==='loading'?'var(--bg3)':'var(--gold)',
                color:status==='loading'?'var(--text3)':'#000',
                boxShadow:status!=='loading'?'0 2px 16px rgba(245,166,35,0.4)':'none',
              }}>
              {status==='loading'?<><Loader2 size={14} className="spin"/>Cropping…</>
                :status==='done'?<><CheckCircle size={14}/>Downloaded!</>
                :<><Download size={14}/>Download Cropped PDF</>}
            </button>
          </div>

          {/* Full-width page grid — matches Split PDF */}
          {loading && pages.length === 0 ? (
            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:'12px',color:'var(--text3)'}}>
              <Loader2 size={32} className="spin" color="var(--accent)"/>
              <p>Loading pages…</p>
            </div>
          ) : (
            <div style={{
              flex:1, overflowY:'auto', padding:'24px',
              display:'grid',
              gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))',
              gap:'20px',
              alignContent:'start',
            }}>
              {pages.map(t => {
                const box = cropBoxes[t.page]
                const isModified = box && (box.x > 2 || box.y > 2 || box.w < t.width - 2 || box.h < t.height - 2)
                return (
                  <PageCard
                    key={t.page}
                    thumb={t}
                    pageNum={t.page}
                    isModified={isModified}
                    onClick={() => setActivePage(t.page)}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Crop editor modal — opens on card click */}
      {activePage && activeThumb && (
        <CropModal
          thumb={activeThumb}
          pageNum={activePage}
          totalPages={pages.length}
          cropBox={cropBoxes[activePage]}
          onCropChange={handleCropChange}
          onClose={() => setActivePage(null)}
          onResetPage={resetPage}
          onApplyToAll={applyToAll}
          onNext={() => setActivePage(p => Math.min(pages.length, p + 1))}
        />
      )}
    </div>
  )
}
