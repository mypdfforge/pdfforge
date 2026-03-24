import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import {
  Loader2, CheckCircle, AlertCircle, Download,
  RotateCcw, Crop, ChevronsRight, Maximize2, Check, X,
} from 'lucide-react'
import TopBar from '../components/TopBar'
import axios from 'axios'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'

// ─── PDF point conversion ─────────────────────────────────────────────────────
function pxToPdfCrop(box, canvasW, canvasH, pdfW, pdfH) {
  const sx = pdfW / canvasW, sy = pdfH / canvasH
  return {
    left:   Math.round(box.x * sx),
    top:    Math.round(box.y * sy),
    right:  Math.round((canvasW - box.x - box.w) * sx),
    bottom: Math.round((canvasH - box.y - box.h) * sy),
  }
}

const HANDLE_R = 7    // handle circle radius
const MIN_BOX  = 40

// Global snapshot read by applyToAll — never triggers re-render
let currentCropSettings = null

// ─── CropCanvas ───────────────────────────────────────────────────────────────
// Uses RAF + direct canvas drawing — no React re-renders during drag
function CropCanvas({ imgSrc, initCrop, onCropCommit }) {
  const canvasRef  = useRef(null)
  const imgRef     = useRef(null)
  const cropRef    = useRef(initCrop)   // mutable, no state
  const dragRef    = useRef(null)
  const rafRef     = useRef(null)
  const dirtyRef   = useRef(true)

  // Keep cropRef in sync when parent changes page
  useEffect(() => { cropRef.current = initCrop; dirtyRef.current = true }, [initCrop])

  // ── Draw loop (only runs when dirty) ─────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img || !img.complete || img.naturalWidth === 0) return

    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const { x, y, w, h } = cropRef.current

    ctx.clearRect(0, 0, W, H)
    ctx.drawImage(img, 0, 0, W, H)

    // dim outside crop
    ctx.fillStyle = 'rgba(0,0,0,0.58)'
    ctx.fillRect(0, 0, W, y)
    ctx.fillRect(0, y + h, W, H - y - h)
    ctx.fillRect(0, y, x, h)
    ctx.fillRect(x + w, y, W - x - w, h)

    // crop border
    ctx.strokeStyle = '#6c63ff'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)

    // rule-of-thirds
    ctx.strokeStyle = 'rgba(108,99,255,0.3)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(x + (w / 3) * i, y); ctx.lineTo(x + (w / 3) * i, y + h)
      ctx.moveTo(x, y + (h / 3) * i); ctx.lineTo(x + w, y + (h / 3) * i)
    }
    ctx.stroke()

    // handles
    const handles = getHandlePositions(cropRef.current)
    handles.forEach(hnd => {
      ctx.beginPath()
      ctx.arc(hnd.cx, hnd.cy, HANDLE_R, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.strokeStyle = '#6c63ff'
      ctx.lineWidth = 2
      ctx.stroke()
    })
  }, [])

  // Schedule a single RAF draw when dirty
  const schedDraw = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      draw()
    })
  }, [draw])

  // ── Image load: size canvas to fill container, then draw ─────────────────
  const onImgLoad = useCallback(() => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    const container = canvas?.parentElement
    if (!canvas || !img || !container) return

    // Fill the container while preserving aspect ratio
    const cw = container.clientWidth  || window.innerWidth
    const ch = container.clientHeight || window.innerHeight
    const aspect = img.naturalWidth / img.naturalHeight

    let W = cw, H = cw / aspect
    if (H > ch) { H = ch; W = H * aspect }

    canvas.width  = img.naturalWidth   // logical size for hit-testing
    canvas.height = img.naturalHeight
    canvas.style.width  = `${Math.floor(W)}px`
    canvas.style.height = `${Math.floor(H)}px`

    // Reset crop to full page
    cropRef.current = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
    if (initCrop && initCrop.w > 0) cropRef.current = { ...initCrop }

    dirtyRef.current = true
    schedDraw()
  }, [initCrop, schedDraw])

  useEffect(() => {
    // Re-draw when initCrop changes (page switch)
    dirtyRef.current = true
    schedDraw()
  }, [initCrop, schedDraw])

  // Cleanup RAF on unmount
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // ── Handle positions ──────────────────────────────────────────────────────
  function getHandlePositions(b) {
    const { x, y, w, h } = b
    return [
      { id:'nw', cx:x,       cy:y       }, { id:'n',  cx:x+w/2, cy:y       },
      { id:'ne', cx:x+w,     cy:y       }, { id:'e',  cx:x+w,   cy:y+h/2   },
      { id:'se', cx:x+w,     cy:y+h     }, { id:'s',  cx:x+w/2, cy:y+h     },
      { id:'sw', cx:x,       cy:y+h     }, { id:'w',  cx:x,     cy:y+h/2   },
    ]
  }

  // ── Coordinate mapping (CSS px → canvas logical px) ──────────────────────
  function getPos(e) {
    const canvas = canvasRef.current
    const rect   = canvas.getBoundingClientRect()
    const scaleX = canvas.width  / rect.width
    const scaleY = canvas.height / rect.height
    const src    = e.touches ? e.touches[0] : e
    return {
      mx: (src.clientX - rect.left)  * scaleX,
      my: (src.clientY - rect.top)   * scaleY,
    }
  }

  function hitHandle(mx, my, b) {
    for (const hnd of getHandlePositions(b)) {
      const dx = mx - hnd.cx, dy = my - hnd.cy
      if (dx * dx + dy * dy < (HANDLE_R + 4) * (HANDLE_R + 4)) return hnd.id
    }
    return null
  }
  function hitMove(mx, my, b) {
    return mx > b.x && mx < b.x + b.w && my > b.y && my < b.y + b.h
  }

  // ── Pointer events ────────────────────────────────────────────────────────
  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const { mx, my } = getPos(e)
    const handle = hitHandle(mx, my, cropRef.current)
    if (handle) {
      dragRef.current = { type: handle, startX: mx, startY: my, startBox: { ...cropRef.current } }
    } else if (hitMove(mx, my, cropRef.current)) {
      dragRef.current = { type: 'move', startX: mx, startY: my, startBox: { ...cropRef.current } }
    }
  }

  function onPointerMove(e) {
    const canvas = canvasRef.current
    if (!canvas) return

    // Update cursor even without drag
    if (!dragRef.current) {
      const { mx, my } = getPos(e)
      const handle = hitHandle(mx, my, cropRef.current)
      const cursors = { nw:'nw-resize', ne:'ne-resize', sw:'sw-resize', se:'se-resize', n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize' }
      canvas.style.cursor = handle ? cursors[handle] : hitMove(mx, my, cropRef.current) ? 'move' : 'crosshair'
      return
    }

    const W = canvas.width, H = canvas.height
    const { mx, my }       = getPos(e)
    const { type, startX, startY, startBox: s } = dragRef.current
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

    cropRef.current = { x, y, w, h }
    currentCropSettings = { ...cropRef.current }  // keep global in sync
    schedDraw()
  }

  function onPointerUp() {
    if (!dragRef.current) return
    dragRef.current = null
    // Commit final value to parent (only once on release — no lag during drag)
    onCropCommit({ ...cropRef.current })
  }

  return (
    <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
      <img
        ref={imgRef}
        src={imgSrc}
        alt=""
        style={{ display:'none' }}
        onLoad={onImgLoad}
      />
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          cursor: 'crosshair',
          borderRadius: '4px',
          boxShadow: '0 8px 60px rgba(0,0,0,0.8)',
          touchAction: 'none',    // prevent scroll during touch drag
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  )
}

// ─── Full-screen Crop Modal ───────────────────────────────────────────────────
// Mirrors ZoomModal pattern: position fixed, inset 0, zIndex 9999
function CropModal({ thumb, pageNum, totalPages, cropBox, onCropChange, onClose, onResetPage, onApplyToAll, onNext }) {
  const isModified = cropBox && thumb && (
    cropBox.x > 2 || cropBox.y > 2 ||
    cropBox.w < thumb.width - 2 || cropBox.h < thumb.height - 2
  )

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: '#080810',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* ── Header bar ── */}
      <div style={{
        height: '58px',
        padding: '0 20px',
        background: 'var(--bg2)',
        borderBottom: '2px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexShrink: 0,
      }}>
        {/* Icon + title */}
        <div style={{
          width: '34px', height: '34px', borderRadius: '9px',
          background: 'rgba(108,99,255,0.15)', border: '1px solid rgba(108,99,255,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Crop size={16} color="#9d97ff"/>
        </div>
        <div style={{ marginRight: 'auto' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.1 }}>
            Crop — Page {pageNum} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>of {totalPages}</span>
          </div>
          {cropBox && thumb && (
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
              {Math.round(cropBox.x)}, {Math.round(cropBox.y)}
              &nbsp;&nbsp;{Math.round(cropBox.w)} × {Math.round(cropBox.h)} px
              {isModified && <span style={{ color: 'var(--accent2)', marginLeft: '8px', fontWeight: 600 }}>✂ modified</span>}
            </div>
          )}
        </div>

        {/* ── Buttons: big, colourful, impossible to miss ── */}
        <button onClick={onResetPage}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '9px 16px', borderRadius: '9px',
            border: '1px solid #e5534b44', background: 'rgba(229,83,75,0.1)',
            color: 'var(--red)', fontSize: '13px', fontWeight: 600,
            cursor: 'pointer', transition: 'background 0.15s', whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(229,83,75,0.2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(229,83,75,0.1)'}>
          <RotateCcw size={14}/> Reset Page
        </button>

        <button onClick={onApplyToAll}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '9px 16px', borderRadius: '9px',
            border: '2px solid var(--accent)', background: 'rgba(108,99,255,0.12)',
            color: '#a9a4ff', fontSize: '13px', fontWeight: 700,
            cursor: 'pointer', transition: 'background 0.15s', whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(108,99,255,0.25)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(108,99,255,0.12)'}>
          <Crop size={14}/> Apply to All Pages
        </button>

        <button onClick={onNext} disabled={pageNum >= totalPages}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '9px 16px', borderRadius: '9px',
            border: '1px solid var(--border)', background: 'var(--bg3)',
            color: pageNum >= totalPages ? 'var(--text3)' : 'var(--text2)',
            fontSize: '13px', fontWeight: 600,
            cursor: pageNum >= totalPages ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s', opacity: pageNum >= totalPages ? 0.4 : 1,
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { if (pageNum < totalPages) { e.currentTarget.style.borderColor = 'var(--green)'; e.currentTarget.style.color = 'var(--green)' }}}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)' }}>
          <ChevronsRight size={14}/> Next Page
        </button>

        {/* DONE — green, prominent */}
        <button onClick={onClose}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 22px', borderRadius: '9px', border: 'none',
            background: 'var(--green)', color: '#fff',
            fontSize: '14px', fontWeight: 700,
            cursor: 'pointer', transition: 'opacity 0.15s',
            boxShadow: '0 2px 14px rgba(62,207,142,0.4)',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
          <Check size={15}/> Done
        </button>
      </div>

      {/* ── Canvas — fills ALL remaining space ── */}
      <div style={{
        flex: 1,
        padding: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: '#080810',
        minHeight: 0,        // critical: lets flex child shrink below content height
      }}>
        {thumb?.img && (
          <CropCanvas
            key={pageNum}           // remount on page change
            imgSrc={thumb.img}
            initCrop={cropBox}
            onCropCommit={onCropChange}
          />
        )}
      </div>

      {/* ── Footer hint ── */}
      <div style={{
        height: '32px', padding: '0 20px',
        background: 'var(--bg2)', borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0,
      }}>
        <span style={{ fontSize: '11px', color: 'var(--text3)' }}>
          Drag handles to resize &nbsp;·&nbsp; Drag inside box to move &nbsp;·&nbsp; Press <strong style={{ color: 'var(--accent2)' }}>Done</strong> when finished
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text3)', marginLeft: 'auto' }}>
          Page {pageNum} / {totalPages}
        </span>
      </div>
    </div>
  )
}

// ─── PageCard ─────────────────────────────────────────────────────────────────
function PageCard({ thumb, pageNum, isModified, cropBox, onClick }) {
  const cropPreview = cropBox && thumb && isModified ? {
    left:   `${(cropBox.x / thumb.width)  * 100}%`,
    top:    `${(cropBox.y / thumb.height) * 100}%`,
    width:  `${(cropBox.w / thumb.width)  * 100}%`,
    height: `${(cropBox.h / thumb.height) * 100}%`,
  } : null

  return (
    <div
      className="crop-card"
      onClick={onClick}
      style={{ position: 'relative', width: '130px', flexShrink: 0, cursor: 'pointer' }}
    >
      <div className="crop-thumb" style={{ width: '130px', height: '170px' }}>
        {thumb?.img
          ? <img src={thumb.img} alt={`Page ${pageNum}`} loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}/>
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader2 size={16} className="spin" color="var(--text3)"/>
            </div>
        }

        {/* Crop region preview overlay */}
        {cropPreview && (
          <>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.40)', pointerEvents: 'none' }}/>
            <div style={{
              position: 'absolute',
              left: cropPreview.left, top: cropPreview.top,
              width: cropPreview.width, height: cropPreview.height,
              border: '2px solid var(--accent)',
              background: 'transparent',
              pointerEvents: 'none',
            }}/>
          </>
        )}

        {/* ✂ badge */}
        {isModified && (
          <div style={{
            position: 'absolute', top: '5px', left: '5px',
            background: 'var(--accent)', color: '#fff',
            fontSize: '9px', fontWeight: 700, borderRadius: '4px',
            padding: '2px 5px',
          }}>✂</div>
        )}

        {/* Hover overlay with Crop + Fullscreen buttons */}
        <div className="crop-actions">
          <button
            onClick={e => { e.stopPropagation(); onClick() }}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 14px', borderRadius: '8px',
              background: 'var(--accent)', color: '#fff', border: 'none',
              fontSize: '12px', fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(108,99,255,0.6)',
            }}>
            <Crop size={13}/> Crop
          </button>
          <button
            onClick={e => { e.stopPropagation(); onClick() }}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '5px 11px', borderRadius: '7px', marginTop: '6px',
              background: 'rgba(255,255,255,0.13)',
              color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
              fontSize: '11px', fontWeight: 600, cursor: 'pointer',
            }}>
            <Maximize2 size={11}/> Fullscreen
          </button>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: '5px' }}>
        <span style={{
          fontSize: '11px',
          color: isModified ? 'var(--accent2)' : '#b0b0cc',
          fontWeight: isModified ? 700 : 400,
        }}>
          Page {pageNum}
        </span>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CropToolPage({
  onBack, dark, onToggleTheme, onGoHome,
  showCategories, activeCategory, onCategoryChange,
  search, onSearch,
}) {
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
        setCropBoxes(prev => ({
          ...prev,
          [thumb.page]: { x: 0, y: 0, w: thumb.width, h: thumb.height },
        }))
      }
    }, 8).catch(() => setLoading(false))
  }, [file])

  // Keep global snapshot in sync (for Apply to All)
  const activeCrop  = activePage ? cropBoxes[activePage] : null
  const activeThumb = pages.find(t => t.page === activePage)
  useEffect(() => { if (activeCrop) currentCropSettings = { ...activeCrop } }, [activeCrop])

  useEffect(() => {
    const count = pages.filter(t => {
      const b = cropBoxes[t.page]
      return b && (b.x > 2 || b.y > 2 || b.w < t.width - 2 || b.h < t.height - 2)
    }).length
    setModCount(count)
  }, [cropBoxes, pages])

  // Called only on pointer-up (not every frame) — no lag
  const handleCropCommit = useCallback((box) => {
    setCropBoxes(prev => ({ ...prev, [activePage]: box }))
    currentCropSettings = { ...box }
  }, [activePage])

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
    const t = pages.find(p => p.page === activePage)
    if (!t) return
    const full = { x: 0, y: 0, w: t.width, h: t.height }
    setCropBoxes(prev => ({ ...prev, [activePage]: full }))
    currentCropSettings = { ...full }
  }

  const resetAll = () => {
    const b = {}
    pages.forEach(t => { b[t.page] = { x: 0, y: 0, w: t.width, h: t.height } })
    setCropBoxes(b)
  }

  const download = async () => {
    if (!file) return
    setStatus('loading'); setErrMsg('')
    try {
      const pageCrops = {}
      pages.forEach(t => {
        const box = cropBoxes[t.page]
        if (!box) return
        pageCrops[t.page] = pxToPdfCrop(box, t.width, t.height, t.width / 0.35, t.height / 0.35)
      })
      const form = new FormData()
      form.append('file', file)
      form.append('crops', JSON.stringify(pageCrops))
      const res = await axios.post('/api/tools/crop-visual', form, { responseType: 'blob' })
      downloadBlob(res.data, 'cropped.pdf')
      setStatus('done'); setTimeout(() => setStatus('idle'), 3000)
    } catch (e) {
      setErrMsg(e.response?.data?.detail || e.message || 'Crop failed')
      setStatus('error')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .crop-card { transition: transform 0.12s; }
        .crop-card:hover { transform: translateY(-3px); }
        .crop-thumb {
          border-radius: 8px; overflow: hidden;
          background: var(--bg3); border: 2px solid var(--border);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          transition: border-color 0.12s, box-shadow 0.12s;
          position: relative;
        }
        .crop-card:hover .crop-thumb {
          border-color: var(--accent);
          box-shadow: 0 6px 24px rgba(108,99,255,0.25);
        }
        .crop-actions {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0.48);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          opacity: 0; pointer-events: none;
          transition: opacity 0.15s;
        }
        .crop-card:hover .crop-actions { opacity: 1; pointer-events: all; }
      `}</style>

      <TopBar
        onBack={onBack} title="⬚ Crop PDF"
        subtitle="Hover a page and click Crop to edit"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory}
        onCategoryChange={onCategoryChange} search={search} onSearch={onSearch}
      />

      {!file ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
          <div style={{ width: '100%', maxWidth: '480px' }}>
            <div {...getRootProps()} style={{
              background: isDragActive ? 'rgba(91,91,214,0.08)' : 'var(--bg2)',
              border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '16px', padding: '60px 40px', textAlign: 'center',
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
              <input {...getInputProps()}/>
              <div style={{
                width: '56px', height: '56px', background: 'rgba(108,99,255,0.1)',
                border: '1px solid rgba(108,99,255,0.3)', borderRadius: '14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px', fontSize: '24px',
              }}>⬚</div>
              <p style={{ color: 'var(--text)', fontWeight: 600, fontSize: '16px', marginBottom: '8px' }}>
                Drop your PDF here
              </p>
              <p style={{ color: 'var(--text3)', fontSize: '13px' }}>or click to browse</p>
            </div>
          </div>
        </div>

      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Top bar */}
          <div style={{
            padding: '8px 20px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg2)', display: 'flex', alignItems: 'center',
            gap: '10px', flexShrink: 0,
          }}>
            <span style={{ fontSize: '13px', color: 'var(--text2)' }}>
              📄 <strong style={{ color: 'var(--text)' }}>{file.name}</strong>
              <span style={{ color: 'var(--text3)', marginLeft: '8px' }}>
                {pages.length}{loading ? '…' : ''} pages
              </span>
            </span>
            {modCount > 0 && (
              <span style={{ fontSize: '12px', color: 'var(--accent2)', fontWeight: 700 }}>
                · {modCount} page{modCount !== 1 ? 's' : ''} cropped
              </span>
            )}
            {loading && <Loader2 size={13} color="var(--accent)" className="spin"/>}
            <div style={{ flex: 1 }}/>
            <button onClick={resetAll}
              style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '12px' }}>
              Reset All
            </button>
            <button onClick={() => { setFile(null); setPages([]); setCropBoxes({}) }}
              style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: '12px' }}>
              Change PDF
            </button>
            {errMsg && (
              <span style={{ fontSize: '12px', color: 'var(--red)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <AlertCircle size={12}/> {errMsg}
              </span>
            )}
            <button onClick={download} disabled={status === 'loading'}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '8px 20px', borderRadius: '9px', border: 'none',
                fontWeight: 700, fontSize: '13px', cursor: 'pointer',
                background: status === 'done' ? 'var(--green)' : status === 'loading' ? 'var(--bg3)' : 'var(--accent)',
                color: status === 'loading' ? 'var(--text3)' : '#fff',
                boxShadow: status !== 'loading' ? '0 2px 12px rgba(91,91,214,0.3)' : 'none',
              }}>
              {status === 'loading' ? <><Loader2 size={14} className="spin"/>Cropping…</>
                : status === 'done'  ? <><CheckCircle size={14}/>Downloaded!</>
                :                      <><Download size={14}/>Download Cropped PDF</>}
            </button>
          </div>

          {/* Grid */}
          {loading && pages.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: 'var(--text3)' }}>
              <Loader2 size={32} className="spin" color="var(--accent)"/>
              <p>Loading pages…</p>
            </div>
          ) : (
            <div style={{
              flex: 1, overflowY: 'auto', padding: '20px',
              display: 'flex', flexWrap: 'wrap', gap: '14px', alignContent: 'flex-start',
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
                    cropBox={box}
                    onClick={() => setActivePage(t.page)}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Full-screen modal — same zIndex pattern as ZoomModal */}
      {activePage && activeThumb && (
        <CropModal
          thumb={activeThumb}
          pageNum={activePage}
          totalPages={pages.length}
          cropBox={cropBoxes[activePage]}
          onCropChange={handleCropCommit}
          onClose={() => setActivePage(null)}
          onResetPage={resetPage}
          onApplyToAll={applyToAll}
          onNext={() => setActivePage(p => Math.min(pages.length, p + 1))}
        />
      )}
    </div>
  )
}
