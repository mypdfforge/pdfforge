import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import { Upload, Loader2, CheckCircle, AlertCircle, Trash2, PenTool, Type, Image as ImageIcon } from 'lucide-react'
import axios from 'axios'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'

const HANDWRITING_FONTS = [
  { name: 'Dancing Script', css: "'Dancing Script', cursive", url: 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap' },
  { name: 'Pacifico',       css: "'Pacifico', cursive",       url: 'https://fonts.googleapis.com/css2?family=Pacifico&display=swap' },
  { name: 'Caveat',         css: "'Caveat', sans-serif",      url: 'https://fonts.googleapis.com/css2?family=Caveat:wght@700&display=swap' },
]

/* ── Inject Google Fonts ── */
function useGoogleFonts() {
  useEffect(() => {
    HANDWRITING_FONTS.forEach(f => {
      if (!document.querySelector(`link[href="${f.url}"]`)) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'; link.href = f.url
        document.head.appendChild(link)
      }
    })
  }, [])
}

/* ── Draw Tab ── */
function DrawTab({ onSig }) {
  const canvasRef = useRef(null)
  const drawing   = useRef(false)
  const [hasStrokes, setHasStrokes] = useState(false)

  const getPos = (e, canvas) => {
    const r = canvas.getBoundingClientRect()
    const src = e.touches ? e.touches[0] : e
    return [src.clientX - r.left, src.clientY - r.top]
  }

  const start = e => {
    drawing.current = true
    const c = canvasRef.current; const ctx = c.getContext('2d')
    const [x, y] = getPos(e, c)
    ctx.beginPath(); ctx.moveTo(x, y)
    e.preventDefault()
  }
  const move = e => {
    if (!drawing.current) return
    const c = canvasRef.current; const ctx = c.getContext('2d')
    const [x, y] = getPos(e, c)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1a2e'
    ctx.lineTo(x, y); ctx.stroke()
    setHasStrokes(true)
    e.preventDefault()
  }
  const stop = () => { drawing.current = false }

  const clear = () => {
    const c = canvasRef.current; const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, c.width, c.height); setHasStrokes(false)
  }

  const confirm = () => {
    const dataUrl = canvasRef.current.toDataURL('image/png')
    onSig(dataUrl)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
        <canvas ref={canvasRef} width={280} height={130}
          style={{ display: 'block', background: '#ffffff', cursor: 'crosshair', touchAction: 'none', width: '100%' }}
          onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop}
          onTouchStart={start} onTouchMove={move} onTouchEnd={stop}
        />
        <p style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: '12px', color: '#ccc', pointerEvents: 'none', opacity: hasStrokes ? 0 : 1, transition: 'opacity 0.2s', textAlign: 'center' }}>
          Draw your signature here
        </p>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={clear}
          style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text3)', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
          <Trash2 size={12} /> Clear
        </button>
        <button onClick={confirm} disabled={!hasStrokes}
          style={{ flex: 2, padding: '8px', borderRadius: '8px', border: 'none', background: hasStrokes ? 'var(--accent)' : 'var(--bg3)', color: hasStrokes ? '#fff' : 'var(--text3)', cursor: hasStrokes ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 700 }}>
          Use This Signature
        </button>
      </div>
    </div>
  )
}

/* ── Type Tab ── */
function TypeTab({ onSig }) {
  useGoogleFonts()
  const [text, setText] = useState('')
  const [selectedFont, setSelectedFont] = useState(0)

  const confirm = () => {
    if (!text.trim()) return
    const canvas = document.createElement('canvas')
    canvas.width = 400; canvas.height = 100
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = `60px ${HANDWRITING_FONTS[selectedFont].css}`
    ctx.fillStyle = '#1a1a2e'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(text, 200, 50)
    onSig(canvas.toDataURL('image/png'))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <input value={text} onChange={e => setText(e.target.value)} placeholder="Type your name…"
        style={{ width: '100%', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {HANDWRITING_FONTS.map((f, i) => (
          <button key={f.name} onClick={() => setSelectedFont(i)}
            style={{
              padding: '12px 16px', borderRadius: '10px', textAlign: 'left', cursor: 'pointer',
              border: `2px solid ${selectedFont === i ? 'var(--accent)' : 'var(--border)'}`,
              background: selectedFont === i ? 'rgba(108,99,255,0.1)' : 'var(--bg3)',
              color: '#1a1a2e', fontFamily: f.css, fontSize: '22px',
              backdropFilter: 'none',
            }}>
            <span style={{ color: selectedFont === i ? '#1a1a2e' : '#1a1a2e' }}>
              {text || 'Your Signature'}
            </span>
          </button>
        ))}
      </div>
      <button onClick={confirm} disabled={!text.trim()}
        style={{ padding: '9px', borderRadius: '8px', border: 'none', background: text.trim() ? 'var(--accent)' : 'var(--bg3)', color: text.trim() ? '#fff' : 'var(--text3)', cursor: text.trim() ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '13px' }}>
        Use This Signature
      </button>
    </div>
  )
}

/* ── Upload Tab ── */
function UploadTab({ onSig }) {
  const onDrop = useCallback(accepted => {
    const reader = new FileReader()
    reader.onload = e => onSig(e.target.result)
    reader.readAsDataURL(accepted[0])
  }, [onSig])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.svg'] }, maxFiles: 1,
  })
  return (
    <div {...getRootProps()} style={{
      background: isDragActive ? 'rgba(108,99,255,0.08)' : 'var(--bg3)',
      border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: '10px', padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
    }}>
      <input {...getInputProps()} />
      <ImageIcon size={20} color="var(--accent2)" style={{ display: 'block', margin: '0 auto 10px' }} />
      <p style={{ fontSize: '13px', color: 'var(--text2)', fontWeight: 500 }}>Drop PNG / JPG / SVG</p>
      <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '5px' }}>Best with transparent background</p>
    </div>
  )
}

/* ── Main Component ── */
export default function SignPDFPage({ onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const [file,      setFile]      = useState(null)
  const [preview,   setPreview]   = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [tab,       setTab]       = useState('draw')
  const [sigData,   setSigData]   = useState(null)   // base64 PNG
  const [sigPos,    setSigPos]    = useState({ x: null, y: null })  // null = auto-center on first load
  const [sigSize,   setSigSize]   = useState({ w: 180, h: 60 })
  const [page,      setPage]      = useState(1)
  const [totalPages,setTotalPages]= useState(1)
  const [state,     setState]     = useState('idle')
  const [errMsg,    setErrMsg]    = useState('')
  const dragging    = useRef(false)
  const resizing    = useRef(false)
  const dragStart   = useRef(null)
  const previewRef  = useRef(null)
  const imgRef       = useRef(null)

  const onDrop = useCallback(async accepted => {
    const f = accepted[0]; setFile(f); setErrMsg(''); setLoading(true)
    try {
      let firstPage = true
      await getThumbnailsProgressive(f, (thumb) => {
        if (firstPage && thumb.img) {
          setPreview(thumb.img)
          setLoading(false)   // show preview after page 1
          firstPage = false
        }
        setTotalPages(thumb.page)
      }, 8)
    } catch (e) { setErrMsg('Failed to load PDF'); setLoading(false) }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1,
  })

  /* ── Signature drag on preview ── */
  const onSigMouseDown = e => {
    dragging.current = true
    dragStart.current = { mx: e.clientX, my: e.clientY, px: sigPos.x, py: sigPos.y }
    e.preventDefault()
  }
  const onResizeMouseDown = e => {
    resizing.current = true
    dragStart.current = { mx: e.clientX, my: e.clientY, w: sigSize.w, h: sigSize.h }
    e.stopPropagation(); e.preventDefault()
  }
  const onMouseMove = e => {
    if (dragging.current && dragStart.current) {
      const dx  = e.clientX - dragStart.current.mx
      const dy  = e.clientY - dragStart.current.my
      const img = imgRef.current
      // Clamp to image bounds so signature stays on page
      const maxX = img ? img.offsetWidth  - sigSize.w : 9999
      const maxY = img ? img.offsetHeight - sigSize.h : 9999
      setSigPos({
        x: Math.max(0, Math.min(maxX, dragStart.current.px + dx)),
        y: Math.max(0, Math.min(maxY, dragStart.current.py + dy)),
      })
    }
    if (resizing.current && dragStart.current) {
      const dx = e.clientX - dragStart.current.mx
      setSigSize({ w: Math.max(80, dragStart.current.w + dx), h: Math.max(30, dragStart.current.h + Math.round(dx * 0.33)) })
    }
  }
  const onMouseUp = () => { dragging.current = false; resizing.current = false; dragStart.current = null }

  const apply = async () => {
    if (!file || !sigData) return
    setState('loading'); setErrMsg('')
    try {
      // Calculate relative positions
      const imgEl = previewRef.current?.querySelector('img')
      const scaleX = imgEl ? (imgEl.naturalWidth || 595) / imgEl.offsetWidth : 1
      const scaleY = imgEl ? (imgEl.naturalHeight || 842) / imgEl.offsetHeight : 1
      const form = new FormData()
      form.append('file', file)
      form.append('signature', sigData)          // base64 PNG
      form.append('x', String(Math.round(sigPos.x * scaleX)))
      form.append('y', String(Math.round(sigPos.y * scaleY)))
      form.append('width', String(Math.round(sigSize.w * scaleX)))
      form.append('height', String(Math.round(sigSize.h * scaleY)))
      form.append('page', String(page))
      const response = await axios.post('/api/tools/sign', form, { responseType: 'blob', validateStatus: null })
      if (response.status !== 200) {
        const txt = await response.data.text()
        let msg = `Server error ${response.status}`
        try { msg = JSON.parse(txt).detail || msg } catch {}
        setErrMsg(msg); setState('idle'); return
      }
      downloadBlob(response.data, 'signed.pdf')
      setState('done'); setTimeout(() => setState('idle'), 3000)
    } catch (e) {
      setErrMsg('Error: ' + (e.response?.data?.detail || e.message)); setState('idle')
    }
  }

  const TABS = [
    { id: 'draw',   label: 'Draw',   icon: <PenTool size={13} /> },
    { id: 'type',   label: 'Type',   icon: <Type size={13} /> },
    { id: 'upload', label: 'Upload', icon: <ImageIcon size={13} /> },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <TopBar onBack={onBack} title="✍ Sign PDF" subtitle="Draw, type or upload your signature"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory}
        onCategoryChange={onCategoryChange} search={search} onSearch={onSearch} />

      <div style={{ display: 'flex', flex: 1, height: 'calc(100vh - 52px)', overflow: 'hidden' }}>

        {/* ── Sidebar ── */}
        <div style={{ width: '340px', flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* File */}
          {!file ? (
            <div {...getRootProps()} style={{ background: isDragActive ? 'rgba(108,99,255,0.08)' : 'var(--bg2)', border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '12px', padding: '30px 20px', textAlign: 'center', cursor: 'pointer' }}>
              <input {...getInputProps()} />
              <Upload size={20} color="var(--accent2)" style={{ margin: '0 auto 10px', display: 'block' }} />
              <p style={{ color: 'var(--text)', fontWeight: 500, fontSize: '14px' }}>Drop PDF here</p>
              <p style={{ color: 'var(--text3)', fontSize: '12px', marginTop: '4px' }}>or click to browse</p>
            </div>
          ) : (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '9px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', color: 'var(--text)' }}>📄 {file.name}</span>
              <button onClick={() => { setFile(null); setPreview(null); setSigData(null); setSigPos({ x: null, y: null }) }} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '18px' }}>×</button>
            </div>
          )}

          {/* Signature creator */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text3)' }}>Create Signature</p>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', background: 'var(--bg3)', borderRadius: '8px', padding: '3px' }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', padding: '6px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, transition: 'all 0.15s', background: tab === t.id ? 'var(--accent)' : 'transparent', color: tab === t.id ? '#fff' : 'var(--text2)' }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {tab === 'draw'   && <DrawTab   onSig={setSigData} />}
            {tab === 'type'   && <TypeTab   onSig={setSigData} />}
            {tab === 'upload' && <UploadTab onSig={setSigData} />}
          </div>

          {/* Signature preview */}
          {sigData && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--accent)', borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--accent2)' }}>✓ Signature Ready</p>
                <button onClick={() => setSigData(null)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '16px' }}>×</button>
              </div>
              <img src={sigData} alt="Signature preview" style={{ maxHeight: '50px', objectFit: 'contain', background: '#fff', borderRadius: '6px', padding: '4px' }} />
              <p style={{ fontSize: '11px', color: 'var(--text3)' }}>Drag the signature on the preview to position it. Drag the corner to resize.</p>
            </div>
          )}

          {/* Page selector */}
          {file && totalPages > 1 && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: '8px' }}>Sign Page</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input type="number" min={1} max={totalPages} value={page} onChange={e => setPage(+e.target.value)}
                  style={{ width: '70px', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '7px', padding: '6px 10px', fontSize: '13px', outline: 'none' }} />
                <span style={{ fontSize: '12px', color: 'var(--text3)' }}>of {totalPages}</span>
              </div>
            </div>
          )}

          {errMsg && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', background: 'rgba(229,83,75,0.1)', border: '1px solid rgba(229,83,75,0.3)', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: 'var(--red)', lineHeight: 1.5 }}>
              <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '1px' }} /> {errMsg}
            </div>
          )}

          <button onClick={apply} disabled={!file || !sigData || state === 'loading'}
            style={{ padding: '12px', background: state === 'done' ? 'var(--green)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: '10px', cursor: !file || !sigData ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 4px 16px rgba(108,99,255,0.25)', opacity: !file || !sigData ? 0.5 : 1 }}>
            {state === 'loading' ? <><Loader2 size={15} className="spin" />Signing…</>
              : state === 'done' ? <><CheckCircle size={15} />Downloaded!</>
              : <>✍ Apply Signature</>}
          </button>
        </div>

        {/* ── Preview Panel ── */}
        <div ref={previewRef}
          style={{ flex: 1, background: '#14141f', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px', overflow: 'hidden', position: 'relative', userSelect: 'none' }}
          onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>

          {!file ? (
            <div style={{ textAlign: 'center', color: 'var(--text3)' }}>
              <div style={{ fontSize: '52px', marginBottom: '14px', opacity: 0.25 }}>✍</div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text2)' }}>Upload a PDF to get started</p>
              <p style={{ fontSize: '13px', marginTop: '6px' }}>Your signature will appear on the preview</p>
            </div>
          ) : loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text3)' }}>
              <Loader2 size={32} color="var(--accent)" className="spin" style={{ display: 'block', margin: '0 auto 12px' }} />
              <p style={{ fontSize: '13px' }}>Loading preview…</p>
            </div>
          ) : preview ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '12px', textAlign: 'center' }}>
                {sigData ? 'Drag the signature to position it' : 'Create a signature to place it on the PDF'}
              </p>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img
                  ref={imgRef}
                  src={preview} alt="PDF preview"
                  onLoad={e => {
                    // Auto-center signature on first load
                    if (sigPos.x === null) {
                      setSigPos({
                        x: Math.round((e.target.offsetWidth  - 180) / 2),
                        y: Math.round((e.target.offsetHeight - 60)  / 2),
                      })
                    }
                  }}
                  style={{ maxWidth: '100%', maxHeight: '70vh', boxShadow: '0 8px 48px rgba(0,0,0,0.6)', borderRadius: '4px', background: '#fff', display: 'block' }} />

                {/* Draggable signature overlay */}
                {sigData && sigPos.x !== null && (
                  <div
                    onMouseDown={onSigMouseDown}
                    style={{
                      position: 'absolute', left: sigPos.x, top: sigPos.y,
                      width: sigSize.w, height: sigSize.h,
                      cursor: 'move', border: '2px dashed var(--accent)',
                      borderRadius: '4px', overflow: 'visible',
                    }}>
                    <img src={sigData} alt="Signature"
                      style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'rgba(255,255,255,0.85)', borderRadius: '3px', display: 'block' }} />
                    {/* Resize handle */}
                    <div onMouseDown={onResizeMouseDown}
                      style={{
                        position: 'absolute', bottom: -6, right: -6,
                        width: 14, height: 14, background: 'var(--accent)',
                        borderRadius: '3px', cursor: 'se-resize', border: '2px solid #fff',
                      }} />
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
