import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import {
  Loader2, CheckCircle, AlertCircle,
  Trash2, PenTool, Type, Image as ImageIcon,
  ChevronLeft, ChevronRight, Download, Check, Lock, Plus,
} from 'lucide-react'
import axios from 'axios'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'
<<<<<<< HEAD
=======

// Must match scale used in thumbCache.js renderPage()
const THUMB_SCALE = 0.3
>>>>>>> ca46ded7371cddbc4005a85dbdc6abf72772763f

const HANDWRITING_FONTS = [
  { name:'Dancing Script', css:"'Dancing Script', cursive",  url:'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap' },
  { name:'Pacifico',       css:"'Pacifico', cursive",        url:'https://fonts.googleapis.com/css2?family=Pacifico&display=swap' },
  { name:'Caveat',         css:"'Caveat', sans-serif",        url:'https://fonts.googleapis.com/css2?family=Caveat:wght@700&display=swap' },
]

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

// ── Draw tab ──────────────────────────────────────────────────────────────────
function DrawTab({ onSig }) {
  const cvRef   = useRef(null)
  const drawing = useRef(false)
  const [hasStrokes, setHasStrokes] = useState(false)

  const pos = (e, c) => { const r=c.getBoundingClientRect(),s=e.touches?e.touches[0]:e; return [s.clientX-r.left,s.clientY-r.top] }
  const start = e => { drawing.current=true; const c=cvRef.current,ctx=c.getContext('2d'),[x,y]=pos(e,c); ctx.beginPath(); ctx.moveTo(x,y); e.preventDefault() }
  const move  = e => {
    if (!drawing.current) return
    const c=cvRef.current,ctx=c.getContext('2d'),[x,y]=pos(e,c)
    ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.strokeStyle='#111'
    ctx.lineTo(x,y); ctx.stroke(); setHasStrokes(true); e.preventDefault()
  }
  const stop  = () => { drawing.current=false }
  const clear = () => { cvRef.current.getContext('2d').clearRect(0,0,cvRef.current.width,cvRef.current.height); setHasStrokes(false) }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
      <div style={{ position:'relative', borderRadius:'8px', overflow:'hidden', border:'1.5px solid var(--border)' }}>
        <canvas ref={cvRef} width={230} height={90}
          style={{ display:'block', background:'#fff', cursor:'crosshair', touchAction:'none', width:'100%' }}
          onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop}
          onTouchStart={start} onTouchMove={move} onTouchEnd={stop}/>
        {!hasStrokes && <p style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', fontSize:'11px', color:'#bbb', pointerEvents:'none', textAlign:'center', width:'100%' }}>Draw here</p>}
      </div>
      <div style={{ display:'flex', gap:'6px' }}>
        <button onClick={clear} style={{ flex:1, padding:'6px', borderRadius:'7px', border:'1px solid var(--border)', background:'var(--bg4)', color:'var(--text3)', cursor:'pointer', fontSize:'11px', display:'flex', alignItems:'center', justifyContent:'center', gap:'4px' }}>
          <Trash2 size={10}/> Clear
        </button>
        <button onClick={() => onSig(cvRef.current.toDataURL('image/png'))} disabled={!hasStrokes}
          style={{ flex:2, padding:'6px', borderRadius:'7px', border:'none', background:hasStrokes?'var(--accent)':'var(--bg4)', color:hasStrokes?'#fff':'var(--text3)', cursor:hasStrokes?'pointer':'not-allowed', fontSize:'11px', fontWeight:700 }}>
          Use This
        </button>
      </div>
    </div>
  )
}

// ── Type tab ──────────────────────────────────────────────────────────────────
function TypeTab({ onSig }) {
  useGoogleFonts()
  const [text, setText] = useState('')
  const [sel,  setSel]  = useState(0)

  const confirm = () => {
    if (!text.trim()) return
    const c=document.createElement('canvas'); c.width=380; c.height=90
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,380,90)
    ctx.font=`55px ${HANDWRITING_FONTS[sel].css}`; ctx.fillStyle='#111'
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(text,190,45)
    onSig(c.toDataURL('image/png'))
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
      <input value={text} onChange={e=>setText(e.target.value)} placeholder="Type your name…"
        style={{ background:'var(--bg4)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'7px', padding:'7px 10px', fontSize:'12px', outline:'none', width:'100%', boxSizing:'border-box' }}/>
      {HANDWRITING_FONTS.map((f,i) => (
        <button key={f.name} onClick={() => setSel(i)}
          style={{ padding:'8px 10px', borderRadius:'8px', textAlign:'left', cursor:'pointer', border:`2px solid ${sel===i?'var(--accent)':'var(--border)'}`, background:sel===i?'rgba(108,99,255,0.08)':'var(--bg4)', color:'#111', fontFamily:f.css, fontSize:'18px' }}>
          {text || 'Signature'}
        </button>
      ))}
      <button onClick={confirm} disabled={!text.trim()}
        style={{ padding:'7px', borderRadius:'7px', border:'none', background:text.trim()?'var(--accent)':'var(--bg4)', color:text.trim()?'#fff':'var(--text3)', cursor:text.trim()?'pointer':'not-allowed', fontWeight:700, fontSize:'11px' }}>
        Use This
      </button>
    </div>
  )
}

// ── Upload tab ────────────────────────────────────────────────────────────────
function UploadTab({ onSig }) {
  const onDrop = useCallback(a => { const r=new FileReader(); r.onload=e=>onSig(e.target.result); r.readAsDataURL(a[0]) }, [onSig])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept:{'image/*':[]}, maxFiles:1 })
  return (
    <div {...getRootProps()} style={{ background:isDragActive?'rgba(108,99,255,0.08)':'var(--bg4)', border:`2px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'8px', padding:'18px', textAlign:'center', cursor:'pointer' }}>
      <input {...getInputProps()}/>
      <ImageIcon size={16} color="var(--accent2)" style={{ display:'block', margin:'0 auto 6px' }}/>
      <p style={{ fontSize:'11px', color:'var(--text2)', fontWeight:500 }}>PNG / JPG / SVG</p>
      <p style={{ fontSize:'10px', color:'var(--text3)', marginTop:'3px' }}>Transparent bg preferred</p>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SignPDFPage({ onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
<<<<<<< HEAD
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
=======
  const [file,       setFile]      = useState(null)
  const [pages,      setPages]     = useState([])   // [{page, img, width, height}]
  const [activePage, setActivePage]= useState(1)
  const [loading,    setLoading]   = useState(false)
  const [tab,        setTab]       = useState('draw')
  const [sigData,    setSigData]   = useState(null)
  const [status,     setStatus]    = useState('idle')
  const [errMsg,     setErrMsg]    = useState('')

  // sigsByPage: { pageNum: [{id, sigData, x, y, w, h, locked}] }
  // x/y/w/h in display pixels relative to the rendered <img>
  const [sigsByPage, setSigsByPage] = useState({})

  const activeOp = useRef(null)
  const imgRef   = useRef(null)
>>>>>>> ca46ded7371cddbc4005a85dbdc6abf72772763f

  const TABS = [
    { id:'draw',   label:'Draw',   icon:<PenTool size={11}/> },
    { id:'type',   label:'Type',   icon:<Type size={11}/> },
    { id:'upload', label:'Upload', icon:<ImageIcon size={11}/> },
  ]

  // ── Load PDF ───────────────────────────────────────────────────────────────
  const onDrop = useCallback(async accepted => {
    const f=accepted[0]; setFile(f); setErrMsg(''); setLoading(true); setPages([]); setSigsByPage({})
    let first=true
    await getThumbnailsProgressive(f, thumb => {
      if (first) { setLoading(false); first=false }
      if (thumb.img) setPages(prev=>[...prev,thumb])
    }, 8).catch(()=>setLoading(false))
  }, [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept:{'application/pdf':['.pdf']}, maxFiles:1 })

  const activeThumb = pages.find(p=>p.page===activePage)

  // ── Place new sig on current page ─────────────────────────────────────────
  const placeSignature = () => {
    if (!sigData || !imgRef.current) return
    const el = imgRef.current
    const w  = Math.round(el.offsetWidth * 0.28)
    const h  = Math.round(w * 0.35)
    const x  = Math.round((el.offsetWidth  - w) / 2)
    const y  = Math.round((el.offsetHeight - h) * 0.75)
    const id = `sig-${Date.now()}`
    setSigsByPage(prev => ({
      ...prev,
      [activePage]: [...(prev[activePage]||[]), { id, sigData, x, y, w, h, locked:false }],
    }))
  }

  // ── Drag / resize ─────────────────────────────────────────────────────────
  const onMouseMove = e => {
    const op=activeOp.current; if (!op||!imgRef.current) return
    const dx=e.clientX-op.startMx, dy=e.clientY-op.startMy
    const el=imgRef.current
    setSigsByPage(prev => {
      const sigs=(prev[op.pageNum]||[]).map(s => {
        if (s.id!==op.sigId||s.locked) return s
        if (op.op==='move') {
          return {...s, x:Math.max(0,Math.min(el.offsetWidth-s.w,  op.startX+dx)),
                        y:Math.max(0,Math.min(el.offsetHeight-s.h, op.startY+dy))}
        }
        if (op.op==='resize') {
          return {...s, w:Math.max(50,op.startW+dx), h:Math.max(18,op.startH+Math.round(dx*0.35))}
        }
        return s
      })
      return {...prev,[op.pageNum]:sigs}
    })
  }
  const onMouseUp   = () => { activeOp.current=null }
  const startMove   = (e,pg,id,x,y) => { activeOp.current={pageNum:pg,sigId:id,op:'move',  startMx:e.clientX,startMy:e.clientY,startX:x,startY:y}; e.preventDefault() }
  const startResize = (e,pg,id,w,h) => { activeOp.current={pageNum:pg,sigId:id,op:'resize',startMx:e.clientX,startMy:e.clientY,startW:w,startH:h};  e.stopPropagation(); e.preventDefault() }

  const lockSig   = (pg,id) => setSigsByPage(p=>({...p,[pg]:(p[pg]||[]).map(s=>s.id===id?{...s,locked:true}:s)}))
  const unlockSig = (pg,id) => setSigsByPage(p=>({...p,[pg]:(p[pg]||[]).map(s=>s.id===id?{...s,locked:false}:s)}))
  const deleteSig = (pg,id) => setSigsByPage(p=>({...p,[pg]:(p[pg]||[]).filter(s=>s.id!==id)}))

  const totalLocked = Object.values(sigsByPage).flat().filter(s=>s.locked).length

  // ── Download — chains one backend call per signature ──────────────────────
  // COORDINATE MATH:
  //   thumbCache renders at scale=0.3  →  thumb.width = pdf_pts * 0.3
  //   pdf_x = (display_x / img.offsetWidth) * thumb.width / 0.3
  //   PyMuPDF uses top-left origin same as browser — NO Y-flip needed.
  const apply = async () => {
    // Sort by page number so chaining applies sigs in order (page 1 → 2 → 3 etc.)
    const allSigs = Object.entries(sigsByPage)
      .flatMap(([pg,sigs]) => sigs.filter(s=>s.locked).map(s=>({...s,page:Number(pg)})))
      .sort((a,b) => a.page - b.page)
    if (!file||allSigs.length===0) { setErrMsg('Lock at least one signature first.'); return }
    setStatus('loading'); setErrMsg('')
    try {
      // Measure display size ONCE from the live img element.
      // All pages share the same container width so the ratio is the same for every page.
      // Bug fix: previously only the ACTIVE page got the correct ratio; all other pages
      // fell back to thumb.width/thumb.width = 1, giving wrong coords (too small/wrong pos).
      const refDispW = imgRef.current ? imgRef.current.offsetWidth  : null
      const refDispH = imgRef.current ? imgRef.current.offsetHeight : null

      let currentFile = file
      for (const sig of allSigs) {
        const thumb = pages.find(p=>p.page===sig.page)
        if (!thumb) continue

        // Use the measured display size; if imgRef is unavailable use thumb dimensions
        // (both give ratio=1 which is correct since thumb coords === display coords then)
        const dispW = refDispW || thumb.width
        const dispH = refDispH
          ? refDispH * (thumb.height / (pages.find(p=>p.page===activePage)?.height || thumb.height))
          : thumb.height

        const rX     = thumb.width  / dispW   // thumb-px per display-px
        const rY     = thumb.height / dispH
        const pdfX   = Math.round((sig.x * rX) / THUMB_SCALE)
        const pdfY   = Math.round((sig.y * rY) / THUMB_SCALE)
        const pdfW   = Math.round((sig.w * rX) / THUMB_SCALE)
        const pdfH   = Math.round((sig.h * rY) / THUMB_SCALE)
        const form   = new FormData()
        form.append('file',      currentFile)
        form.append('signature', sig.sigData)
        form.append('x',         String(pdfX))
        form.append('y',         String(pdfY))
        form.append('width',     String(pdfW))
        form.append('height',    String(pdfH))
        form.append('page',      String(sig.page))
        const res = await axios.post('/api/tools/sign', form, { responseType:'blob', validateStatus:null })
        if (res.status!==200) {
          const txt=await res.data.text(); let msg=`Server error ${res.status}`
          try { msg=JSON.parse(txt).detail||msg } catch {}
          setErrMsg(msg); setStatus('idle'); return
        }
        currentFile = new File([res.data],'signed.pdf',{type:'application/pdf'})
      }
      downloadBlob(currentFile,'signed.pdf')
      setStatus('done'); setTimeout(()=>setStatus('idle'),3000)
    } catch(e) { setErrMsg(e.response?.data?.detail||e.message||'Sign failed'); setStatus('idle') }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ height:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <TopBar onBack={onBack} title="✍ Sign PDF" subtitle="Draw, type or upload — add multiple signatures"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory}
        onCategoryChange={onCategoryChange} search={search} onSearch={onSearch}/>

      {!file ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'40px' }}>
          <div style={{ maxWidth:'460px', width:'100%' }}>
            <div {...getRootProps()} style={{ background:isDragActive?'rgba(108,99,255,0.08)':'var(--bg2)', border:`2px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'16px', padding:'56px 40px', textAlign:'center', cursor:'pointer' }}>
              <input {...getInputProps()}/>
              <div style={{ fontSize:'38px', marginBottom:'14px', opacity:0.5 }}>✍</div>
              <p style={{ color:'var(--text)', fontWeight:600, fontSize:'15px', marginBottom:'7px' }}>Drop your PDF here</p>
              <p style={{ color:'var(--text3)', fontSize:'12px' }}>or click to browse</p>
            </div>
<<<<<<< HEAD
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
=======
>>>>>>> ca46ded7371cddbc4005a85dbdc6abf72772763f
          </div>
        </div>
      ) : (
        /* 3-panel: settings | thumbnail strip | interactive preview */
        <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>

          {/* ━━ Panel 1: Settings (255px) — scrolls independently ━━ */}
          <div style={{ width:'255px', flexShrink:0, borderRight:'1px solid var(--border)', overflowY:'auto', padding:'12px', display:'flex', flexDirection:'column', gap:'8px', background:'var(--bg2)' }}>

            {/* File chip */}
            <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'8px', padding:'6px 10px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:'11px', color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>📄 {file.name}</span>
              <button onClick={()=>{setFile(null);setPages([]);setSigData(null);setSigsByPage({})}} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:'15px', flexShrink:0 }}>×</button>
            </div>
<<<<<<< HEAD
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
=======

            {/* Signature creator */}
            <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'11px 12px', display:'flex', flexDirection:'column', gap:'8px' }}>
              <p style={{ fontSize:'10px', fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--text3)', margin:0 }}>Create Signature</p>
              <div style={{ display:'flex', gap:'3px', background:'var(--bg4)', borderRadius:'7px', padding:'2px' }}>
                {TABS.map(t=>(
                  <button key={t.id} onClick={()=>setTab(t.id)}
                    style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:'4px', padding:'5px 3px', borderRadius:'5px', border:'none', cursor:'pointer', fontSize:'10px', fontWeight:600, background:tab===t.id?'var(--accent)':'transparent', color:tab===t.id?'#fff':'var(--text2)', transition:'all 0.15s' }}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
              {tab==='draw'   && <DrawTab   onSig={setSigData}/>}
              {tab==='type'   && <TypeTab   onSig={setSigData}/>}
              {tab==='upload' && <UploadTab onSig={setSigData}/>}
            </div>

            {/* Signature ready + Place button */}
            {sigData && (
              <div style={{ background:'var(--bg3)', border:'1px solid var(--accent)', borderRadius:'10px', padding:'10px 12px', display:'flex', flexDirection:'column', gap:'7px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <p style={{ fontSize:'10px', fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--accent2)', margin:0 }}>✓ Ready</p>
                  <button onClick={()=>setSigData(null)} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:'13px' }}>×</button>
                </div>
                <img src={sigData} alt="sig" style={{ maxHeight:'32px', objectFit:'contain', background:'#fff', borderRadius:'4px', padding:'3px' }}/>
                <button onClick={placeSignature}
                  style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'5px', padding:'7px', borderRadius:'7px', border:'none', background:'var(--accent)', color:'#fff', fontWeight:700, fontSize:'11px', cursor:'pointer' }}>
                  <Plus size={12}/> Place on Page {activePage}
                </button>
                <p style={{ fontSize:'10px', color:'var(--text3)', margin:0, lineHeight:1.4 }}>Drag to position · resize corner · click ✓ Done to lock</p>
              </div>
            )}

            {/* Saved sigs summary */}
            {totalLocked > 0 && (
              <div style={{ background:'var(--bg3)', border:'1px solid var(--green)', borderRadius:'10px', padding:'10px 12px', display:'flex', flexDirection:'column', gap:'5px' }}>
                <p style={{ fontSize:'10px', fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--green)', margin:0 }}>
                  ✓ {totalLocked} Signature{totalLocked!==1?'s':''} Saved
                </p>
                {Object.entries(sigsByPage).flatMap(([pg,sigs])=>
                  sigs.filter(s=>s.locked).map(s=>(
                    <div key={s.id} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'10px', color:'var(--text2)' }}>
                      <Lock size={9} color="var(--green)"/>
                      <span style={{ flex:1 }}>Page {pg}</span>
                      <button onClick={()=>{setActivePage(Number(pg));unlockSig(Number(pg),s.id)}}
                        style={{ fontSize:'10px', background:'none', border:'1px solid var(--border)', borderRadius:'3px', color:'var(--text3)', cursor:'pointer', padding:'1px 5px' }}>Edit</button>
                      <button onClick={()=>deleteSig(Number(pg),s.id)}
                        style={{ fontSize:'10px', background:'none', border:'1px solid rgba(229,83,75,0.3)', borderRadius:'3px', color:'var(--red)', cursor:'pointer', padding:'1px 5px' }}>×</button>
                    </div>
                  ))
>>>>>>> ca46ded7371cddbc4005a85dbdc6abf72772763f
                )}
              </div>
            )}

            {/* Steps */}
            <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'10px 12px' }}>
              <p style={{ fontSize:'10px', fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--text3)', margin:'0 0 5px' }}>Steps</p>
              <ol style={{ fontSize:'10px', color:'var(--text2)', paddingLeft:'13px', margin:0, lineHeight:1.8 }}>
                <li>Draw / type / upload signature</li>
                <li>Click <strong style={{ color:'var(--accent2)' }}>Place on Page N</strong></li>
                <li>Drag to position · resize corner</li>
                <li>Click <strong style={{ color:'var(--green)' }}>✓ Done</strong> to lock</li>
                <li>Repeat for more sigs / pages</li>
                <li>Download when finished</li>
              </ol>
            </div>

            {errMsg && (
              <div style={{ display:'flex', gap:'6px', background:'rgba(229,83,75,0.1)', border:'1px solid rgba(229,83,75,0.3)', borderRadius:'7px', padding:'8px 10px', fontSize:'10px', color:'var(--red)', lineHeight:1.4 }}>
                <AlertCircle size={11} style={{ flexShrink:0, marginTop:'1px' }}/> {errMsg}
              </div>
            )}
            <div style={{ height:'65px', flexShrink:0 }}/>
          </div>

          {/* ━━ Panel 2: Thumbnail strip (110px) — scrolls independently ━━ */}
          <div style={{ width:'110px', flexShrink:0, borderRight:'1px solid var(--border)', background:'var(--bg2)', overflowY:'auto', display:'flex', flexDirection:'column' }}>
            <div style={{ padding:'6px 8px', borderBottom:'1px solid var(--border)', fontSize:'9px', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.06em', position:'sticky', top:0, background:'var(--bg2)', zIndex:1, display:'flex', alignItems:'center', gap:'4px' }}>
              Pages {loading && <Loader2 size={9} className="spin"/>}
            </div>
            {pages.map(p => {
              const sigCount = (sigsByPage[p.page]||[]).filter(s=>s.locked).length
              return (
                <div key={p.page} onClick={()=>setActivePage(p.page)}
                  style={{ padding:'6px', cursor:'pointer', background:activePage===p.page?'rgba(108,99,255,0.12)':'transparent', borderBottom:'1px solid var(--border)', position:'relative', transition:'background 0.1s' }}>
                  <div style={{ border:`2px solid ${activePage===p.page?'var(--accent)':'var(--border)'}`, borderRadius:'4px', overflow:'hidden' }}>
                    <img src={p.img} alt={`p${p.page}`} style={{ width:'100%', display:'block' }}/>
                  </div>
                  <span style={{ fontSize:'9px', color:activePage===p.page?'var(--accent2)':'var(--text3)', display:'block', textAlign:'center', marginTop:'2px' }}>p.{p.page}</span>
                  {/* Green badge showing how many sigs locked on this page */}
                  {sigCount > 0 && (
                    <div style={{ position:'absolute', top:'8px', right:'8px', background:'var(--green)', borderRadius:'50%', width:'15px', height:'15px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'9px', color:'#fff', fontWeight:700 }}>
                      {sigCount}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ━━ Panel 3: Interactive preview — scrolls independently ━━ */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#12121c' }}>
            {/* Workspace header */}
            <div style={{ padding:'8px 16px', borderBottom:'1px solid var(--border)', background:'var(--bg2)', display:'flex', alignItems:'center', gap:'10px', flexShrink:0 }}>
              <span style={{ fontSize:'12px', color:'var(--text)', fontWeight:600 }}>Page {activePage} of {pages.length}</span>
              {(sigsByPage[activePage]||[]).length > 0 && (
                <span style={{ fontSize:'11px', color:'var(--accent2)' }}>
                  {(sigsByPage[activePage]||[]).length} sig{(sigsByPage[activePage]||[]).length!==1?'s':''} on this page
                </span>
              )}
              {sigData && (sigsByPage[activePage]||[]).length===0 && (
                <span style={{ fontSize:'11px', color:'var(--text3)' }}>Click "Place on Page" to add a signature</span>
              )}
              <div style={{ display:'flex', gap:'5px', marginLeft:'auto' }}>
                <button onClick={()=>setActivePage(p=>Math.max(1,p-1))} disabled={activePage<=1}
                  style={{ width:'26px', height:'26px', borderRadius:'6px', border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--text2)', cursor:activePage<=1?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', opacity:activePage<=1?0.4:1 }}>
                  <ChevronLeft size={12}/>
                </button>
                <button onClick={()=>setActivePage(p=>Math.min(pages.length,p+1))} disabled={activePage>=pages.length}
                  style={{ width:'26px', height:'26px', borderRadius:'6px', border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--text2)', cursor:activePage>=pages.length?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', opacity:activePage>=pages.length?0.4:1 }}>
                  <ChevronRight size={12}/>
                </button>
              </div>
            </div>

            {/* Preview area — only this scrolls */}
            <div
              style={{ flex:1, overflowY:'auto', padding:'16px', display:'flex', alignItems:'flex-start', justifyContent:'center', minHeight:0, position:'relative', userSelect:'none' }}
              onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
            >
              {!activeThumb ? (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', color:'var(--text3)' }}>
                  <Loader2 size={26} color="var(--accent)" className="spin" style={{ marginBottom:'10px' }}/>
                  <p style={{ fontSize:'12px' }}>Loading pages…</p>
                </div>
              ) : (
                <div style={{ position:'relative', display:'inline-block', maxWidth:'560px', width:'100%' }}>
                  <p style={{ fontSize:'10px', color:'var(--text3)', marginBottom:'8px', textAlign:'center' }}>
                    {(sigsByPage[activePage]||[]).filter(s=>!s.locked).length > 0
                      ? 'Drag sigs to position · corner to resize · ✓ Done to lock'
                      : '← Use the left panel to create and place a signature'}
                  </p>
                  <div style={{ position:'relative', display:'inline-block', width:'100%' }}>
                    {/* Page image — constrained to fit screen */}
                    <img
                      ref={imgRef}
                      src={activeThumb.img}
                      alt={`Page ${activePage}`}
                      style={{ width:'100%', maxHeight:'calc(100vh - 175px)', objectFit:'contain', display:'block', boxShadow:'0 6px 40px rgba(0,0,0,0.7)', borderRadius:'3px', background:'#fff' }}
                    />

                    {/* Render all sigs on this page */}
                    {(sigsByPage[activePage]||[]).map(sig => (
                      <div key={sig.id}
                        onMouseDown={sig.locked ? undefined : e=>startMove(e,activePage,sig.id,sig.x,sig.y)}
                        style={{ position:'absolute', left:sig.x, top:sig.y, width:sig.w, height:sig.h,
                          cursor:sig.locked?'default':'move',
                          border:`2px dashed ${sig.locked?'var(--green)':'var(--accent)'}`,
                          borderRadius:'3px', overflow:'visible' }}>

                        <img src={sig.sigData} alt="sig"
                          style={{ width:'100%', height:'100%', objectFit:'contain', background:'rgba(255,255,255,0.9)', borderRadius:'2px', display:'block' }}/>

                        {/* Resize handle */}
                        {!sig.locked && (
                          <div onMouseDown={e=>startResize(e,activePage,sig.id,sig.w,sig.h)}
                            style={{ position:'absolute', bottom:-6, right:-6, width:13, height:13, background:'var(--accent)', borderRadius:'3px', cursor:'se-resize', border:'2px solid #fff', zIndex:2 }}/>
                        )}

                        {/* ✓ Done button floats above sig box */}
                        {!sig.locked && (
                          <button onClick={()=>lockSig(activePage,sig.id)}
                            style={{ position:'absolute', top:-30, left:'50%', transform:'translateX(-50%)', display:'flex', alignItems:'center', gap:'4px', padding:'3px 10px', borderRadius:'20px', border:'none', background:'var(--green)', color:'#fff', fontSize:'10px', fontWeight:700, cursor:'pointer', whiteSpace:'nowrap', boxShadow:'0 2px 8px rgba(62,207,142,0.5)', zIndex:10 }}>
                            <Check size={10}/> Done
                          </button>
                        )}

                        {/* Delete × button */}
                        <button onClick={()=>deleteSig(activePage,sig.id)}
                          style={{ position:'absolute', top:-8, right:-8, width:16, height:16, borderRadius:'50%', background:'var(--red)', border:'2px solid #fff', color:'#fff', fontSize:'10px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', zIndex:10 }}>
                          ×
                        </button>

                        {/* Lock icon */}
                        {sig.locked && (
                          <div style={{ position:'absolute', top:-8, left:-8, background:'var(--green)', borderRadius:'50%', width:'16px', height:'16px', display:'flex', alignItems:'center', justifyContent:'center' }}>
                            <Lock size={8} color="#fff"/>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ height:'65px' }}/>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating download button */}
      {file && (
        <button onClick={apply} disabled={status==='loading'}
          style={{ position:'fixed', bottom:'20px', right:'20px', zIndex:9000,
            display:'flex', alignItems:'center', gap:'8px', padding:'11px 20px',
            borderRadius:'50px', border:'none',
            background: status==='done'?'var(--green)':status==='loading'?'var(--bg3)':totalLocked>0?'var(--accent)':'var(--bg3)',
            color: (status==='loading'||totalLocked===0)?'var(--text2)':'#fff',
            fontWeight:700, fontSize:'13px',
            cursor: totalLocked===0?'not-allowed':'pointer',
            boxShadow:'0 4px 18px rgba(108,99,255,0.4),0 2px 6px rgba(0,0,0,0.4)',
            transition:'all 0.2s', opacity:totalLocked===0?0.5:1 }}>
          {status==='loading' ? <><Loader2 size={13} className="spin"/> Signing…</>
            : status==='done' ? <><CheckCircle size={13}/> Downloaded!</>
            : totalLocked > 0 ? <><Download size={13}/> Download ({totalLocked} sig{totalLocked!==1?'s':''})</>
            : <><Download size={13}/> Lock a signature first</>}
        </button>
      )}
    </div>
  )
}
