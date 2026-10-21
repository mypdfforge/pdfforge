import React, { useState, useCallback, useRef, useMemo } from 'react'
import { ArrowLeft, Download, Loader2, CheckCircle, Upload as UploadIcon, Eye, Save, Crown, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import SectionCard  from '../components/SectionCard'
import axios from 'axios'
import * as api from '../utils/api'

// ── Preview Modal ──────────────────────────────────────────────────────
function PreviewModal({ sessionId, sections, onClose }) {
  const [pages,   setPages]   = useState([])
  const [current, setCurrent] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true); setError('')
      try {
        const { data } = await axios.post(`/api/export/${sessionId}/preview-edited`, { blocks: sections })
        if (!cancelled) { setPages(data.pages); setLoading(false) }
      } catch(e) {
        if (!cancelled) { setError('Preview failed. Is backend running?'); setLoading(false) }
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div onClick={e => { if (e.target===e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(6px)' }}>
      <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'16px', width:'90vw', maxWidth:'760px', maxHeight:'92vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 80px rgba(0,0,0,0.8)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 20px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <div>
            <span style={{ fontWeight:700, fontSize:'15px', color:'var(--text)' }}>Preview</span>
            {pages.length > 0 && <span style={{ fontSize:'12px', color:'var(--text3)', marginLeft:'10px' }}>Page {current+1} of {pages.length}</span>}
          </div>
          <button onClick={onClose} style={{ width:'30px', height:'30px', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'8px', cursor:'pointer', color:'var(--text3)' }}><X size={14}/></button>
        </div>
        <div style={{ flex:1, overflow:'auto', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }}>
          {loading && <div style={{ textAlign:'center', color:'var(--text3)' }}><Loader2 size={28} color="var(--accent)" className="spin" style={{ display:'block', margin:'0 auto 12px' }}/><p>Generating preview…</p></div>}
          {error && <p style={{ color:'var(--red)' }}>⚠ {error}</p>}
          {!loading && !error && pages[current] && (
            <img src={pages[current]} alt={`Page ${current+1}`} style={{ maxWidth:'100%', maxHeight:'70vh', boxShadow:'0 4px 24px rgba(0,0,0,0.5)', borderRadius:'2px', background:'#fff' }}/>
          )}
        </div>
        {pages.length > 1 && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'12px', padding:'12px', borderTop:'1px solid var(--border)', flexShrink:0 }}>
            <button onClick={() => setCurrent(c=>Math.max(0,c-1))} disabled={current===0}
              style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'13px', color:'var(--text3)', background:'none', border:'1px solid var(--border)', borderRadius:'7px', padding:'5px 12px', cursor:current===0?'not-allowed':'pointer', opacity:current===0?0.4:1 }}>
              <ChevronLeft size={13}/> Prev
            </button>
            {pages.map((_,i) => (
              <button key={i} onClick={() => setCurrent(i)}
                style={{ width:'28px', height:'28px', borderRadius:'7px', border:'1px solid var(--border)', background:i===current?'var(--accent)':'var(--bg3)', color:i===current?'#fff':'var(--text3)', fontSize:'12px', cursor:'pointer' }}>
                {i+1}
              </button>
            ))}
            <button onClick={() => setCurrent(c=>Math.min(pages.length-1,c+1))} disabled={current===pages.length-1}
              style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'13px', color:'var(--text3)', background:'none', border:'1px solid var(--border)', borderRadius:'7px', padding:'5px 12px', cursor:current===pages.length-1?'not-allowed':'pointer', opacity:current===pages.length-1?0.4:1 }}>
              Next <ChevronRight size={13}/>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Upload screen ──────────────────────────────────────────────────────
function UploadScreen({ onUploaded }) {
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState(null)

  const onDrop = useCallback(async (files) => {
    const file = files[0]; if (!file) return
    setUploading(true); setError(null)
    try {
      const { data } = await api.uploadPDF(file)
      onUploaded(data)
    } catch(e) { setError(e.response?.data?.detail || 'Upload failed.') }
    finally { setUploading(false) }
  }, [onUploaded])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept:{'application/pdf':['.pdf']}, maxFiles:1, disabled:uploading
  })

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'2rem', background:'var(--bg)', position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', width:'600px', height:'400px', background:'radial-gradient(ellipse, rgba(234,88,12,0.07) 0%, transparent 70%)', pointerEvents:'none' }}/>
      <div style={{ textAlign:'center', marginBottom:'36px', maxWidth:'500px' }}>
        <div style={{ display:'inline-flex', alignItems:'center', gap:'8px', fontSize:'11px', letterSpacing:'.1em', textTransform:'uppercase', color:'var(--accent2)', background:'rgba(234,88,12,0.1)', border:'1px solid rgba(234,88,12,0.2)', padding:'5px 18px', borderRadius:'999px', marginBottom:'22px' }}>✦ Resume Editor</div>
        <h2 style={{ fontFamily:"'Inter',sans-serif", fontSize:'42px', fontWeight:800, color:'var(--text)', marginBottom:'14px', letterSpacing:'-0.02em', lineHeight:1.1 }}>Edit your resume<br/><span style={{ color:'var(--accent2)' }}>without the pain.</span></h2>
        <p style={{ fontSize:'14px', color:'var(--text3)', lineHeight:1.75 }}>Upload your PDF. Every line appears as a card. Click to edit — layout preserved perfectly.</p>
      </div>
      <div {...getRootProps()} style={{ width:'100%', maxWidth:'480px', background:isDragActive?'rgba(234,88,12,0.08)':'var(--bg2)', border:`2px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'18px', padding:'52px 36px', textAlign:'center', cursor:uploading?'not-allowed':'pointer', transition:'all 0.2s', opacity:uploading?0.7:1, position:'relative' }}>
        <div style={{ position:'absolute', top:'12px', left:'12px', width:'18px', height:'18px', borderTop:'2px solid var(--border2)', borderLeft:'2px solid var(--border2)', borderRadius:'3px 0 0 0' }}/>
        <div style={{ position:'absolute', bottom:'12px', right:'12px', width:'18px', height:'18px', borderBottom:'2px solid var(--border2)', borderRight:'2px solid var(--border2)', borderRadius:'0 0 3px 0' }}/>
        <input {...getInputProps()}/>
        <div style={{ width:'60px', height:'60px', background:isDragActive?'var(--accent)':'var(--bg3)', border:`1px solid ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'16px', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px' }}>
          {uploading ? <Loader2 size={24} color="var(--accent2)" className="spin"/> : <UploadIcon size={24} color="var(--accent2)" strokeWidth={1.5}/>}
        </div>
        {uploading ? <p style={{ fontSize:'16px', fontWeight:500, color:'var(--text)' }}>Reading PDF…</p>
         : isDragActive ? <p style={{ fontSize:'18px', fontWeight:600, color:'var(--accent2)' }}>Drop it!</p>
         : <><p style={{ fontSize:'16px', fontWeight:500, color:'var(--text)' }}>Drop PDF here, or <span style={{ color:'var(--accent2)', textDecoration:'underline' }}>browse</span></p><p style={{ fontSize:'13px', color:'var(--text3)', marginTop:'8px' }}>PDF files only</p></>}
      </div>
      {error && <div style={{ display:'flex', alignItems:'center', gap:'8px', marginTop:'16px', maxWidth:'480px', width:'100%', background:'rgba(229,83,75,0.1)', border:'1px solid rgba(229,83,75,0.3)', borderRadius:'10px', padding:'10px 16px', fontSize:'13px', color:'var(--red)' }}>⚠ {error}</div>}
    </div>
  )
}

// ── Main Editor ────────────────────────────────────────────────────────
export default function EditorPage({ onBack }) {
  const [uploadData,   setUploadData]   = useState(null)
  const [sections,     setSections]     = useState([])
  const [saveState,    setSaveState]    = useState('idle')
  const [exporting,    setExporting]    = useState(false)
  const [done,         setDone]         = useState(false)
  const [showPreview,  setShowPreview]  = useState(false)
  const [exportError,  setExportError]  = useState('')

  // Wake Render backend on mount — free tier sleeps after inactivity.
  // Firing early means by the time the user finishes editing, backend is warm.
  React.useEffect(() => { api.wakeRender() }, [])

  const handleUploaded = (data) => {
    setUploadData(data)
    const all = data.pages.flatMap(pg =>
      pg.blocks.map(b => ({ ...b, original: b.text, changed: false }))
    )
    setSections(all)
  }

  const updateSection = (updated) => {
    setSections(prev => prev.map(s =>
      s.id === updated.id ? { ...updated, changed: updated.text !== updated.original } : s
    ))
  }

  const handleExport = async () => {
    setExporting(true)
    setExportError('')
    try {
      const { data } = await api.exportPDF(uploadData.sessionId, sections)
      api.downloadBlob(data, `${uploadData.filename.replace('.pdf','')}_edited.pdf`)
      setDone(true); setTimeout(() => setDone(false), 3000)
    } catch(e) {
      const status = e?.response?.status
      if (status === 404) {
        setExportError('Session expired — backend restarted. Please re-upload your PDF.')
      } else if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
        setExportError('Backend is waking up (free tier). Please wait 30 seconds and try again.')
      } else {
        setExportError('Export failed. Please try again.')
      }
    }
    finally { setExporting(false) }
  }

  const byPage = useMemo(() => {
    const map = {}
    sections.forEach(s => { if (!map[s.page]) map[s.page]=[]; map[s.page].push(s) })
    return map
  }, [sections])

  const changedCount = sections.filter(s => s.changed).length
  const pageCount    = uploadData?.pageCount || 0

  if (!uploadData) return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column' }}>
      <header style={{ height:'60px', padding:'0 24px', display:'flex', alignItems:'center', gap:'14px', borderBottom:'1px solid var(--border)', background:'rgba(13,13,20,0.97)', backdropFilter:'blur(12px)', position:'sticky', top:0, zIndex:50 }}>
        <button onClick={onBack} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', color:'var(--text3)', background:'none', border:'1px solid var(--border)', borderRadius:'8px', padding:'5px 12px', cursor:'pointer' }}><ArrowLeft size={13}/> Back</button>
        <div style={{ width:'1px', height:'18px', background:'var(--border)' }}/>
        <span style={{ fontFamily:"'Inter',sans-serif", fontSize:'15px', fontWeight:800, color:'var(--text)' }}>✦ Resume Editor</span>
      </header>
      <UploadScreen onUploaded={handleUploaded}/>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column' }}>

      <header style={{ position:'sticky', top:0, zIndex:40, background:'rgba(13,13,20,0.95)', backdropFilter:'blur(12px)', borderBottom:'1px solid var(--border)', height:'58px', padding:'0 20px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={onBack} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', color:'var(--text3)', background:'none', border:'1px solid var(--border)', borderRadius:'7px', padding:'5px 12px', cursor:'pointer' }}><ArrowLeft size={13}/> Back</button>
          <div style={{ width:'1px', height:'18px', background:'var(--border)' }}/>
          <div>
            <span style={{ fontFamily:"'Inter',sans-serif", fontWeight:800, fontSize:'15px', color:'var(--text)' }}>✦ Resume Editor</span>
            <span style={{ fontSize:'11px', color:'var(--text3)', marginLeft:'10px', fontFamily:'monospace' }}>
              {uploadData.filename} · {sections.length} lines · {pageCount}p
              {changedCount > 0 && <span style={{ color:'var(--gold)', marginLeft:'6px' }}>· {changedCount} edited</span>}
            </span>
          </div>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div style={{ fontSize:'11px', color:'var(--gold)', background:'rgba(245,166,35,0.07)', border:'1px solid rgba(245,166,35,0.2)', borderRadius:'7px', padding:'4px 10px', display:'flex', alignItems:'center', gap:'5px' }}>
            <Crown size={11}/> Upgrade for italic & color
          </div>
          <button onClick={() => setShowPreview(true)}
            style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', color:'var(--text)', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'8px', padding:'6px 13px', cursor:'pointer' }}>
            <Eye size={13} color="var(--accent2)"/> Preview
          </button>
          <button onClick={handleExport} disabled={exporting}
            style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', fontWeight:600, color:'#fff', background:done?'var(--green)':'var(--accent)', border:'none', borderRadius:'8px', padding:'7px 16px', cursor:exporting?'not-allowed':'pointer', boxShadow:'0 2px 12px rgba(234,88,12,0.35)', transition:'background 0.2s' }}>
            {exporting ? <><Loader2 size={13} className="spin"/> Exporting…</>
             : done     ? <><CheckCircle size={13}/> Downloaded!</>
             :             <><Download size={13}/> Export PDF</>}
          </button>
        </div>
      </header>

      {exportError && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', padding:'9px 20px', background:'rgba(229,83,75,0.1)', borderBottom:'1px solid rgba(229,83,75,0.25)', fontSize:'13px', color:'var(--red)', flexShrink:0 }}>
          <span>⚠ {exportError}</span>
          <button onClick={() => setExportError('')} style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:'16px', lineHeight:1 }}>×</button>
        </div>
      )}

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        <main style={{ flex:1, overflowY:'auto', padding:'24px', }}>
          <div style={{ maxWidth:'960px', margin:'0 auto', display:'flex', gap:'24px' }}>

            {/* Cards */}
            <div style={{ flex:1, display:'flex', flexDirection:'column', gap:'20px' }}>
              {Object.entries(byPage).map(([page, pageSections]) => (
                <div key={page}>
                  {pageCount > 1 && (
                    <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'10px' }}>
                      <span style={{ fontSize:'10px', fontFamily:'monospace', color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.1em' }}>Page {page}</span>
                      <div style={{ flex:1, height:'1px', background:'var(--border)' }}/>
                    </div>
                  )}
                  <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                    {pageSections.map(section => (
                      <SectionCard key={section.id} section={section} onChange={updateSection}/>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Sidebar */}
            <aside style={{ width:'210px', flexShrink:0, position:'sticky', top:'66px', alignSelf:'flex-start', display:'flex', flexDirection:'column', gap:'12px' }}>
              <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'12px', padding:'14px' }}>
                <p style={{ fontSize:'10px', fontFamily:'monospace', color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:'10px' }}>Document</p>
                {[['Lines', sections.length],['Pages', pageCount],['Edited', changedCount]].map(([l,v]) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', fontSize:'13px', padding:'4px 0', borderBottom:'1px solid var(--bg3)' }}>
                    <span style={{ color:'var(--text3)' }}>{l}</span>
                    <span style={{ color:'var(--text)', fontWeight:500 }}>{v}</span>
                  </div>
                ))}
              </div>

              <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'12px', padding:'14px' }}>
                <p style={{ fontSize:'10px', fontFamily:'monospace', color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:'10px' }}>Tips</p>
                {['Click card to edit','Enter = new line','Esc = cancel','Green = edited'].map(t => (
                  <p key={t} style={{ fontSize:'12px', color:'var(--text3)', lineHeight:1.7, paddingLeft:'11px', position:'relative' }}>
                    <span style={{ position:'absolute', left:0, color:'var(--accent)' }}>›</span>{t}
                  </p>
                ))}
              </div>

              <button onClick={() => setShowPreview(true)}
                style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:'7px', fontSize:'13px', fontWeight:500, color:'var(--text)', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'9px', cursor:'pointer' }}>
                <Eye size={14} color="var(--accent2)"/> Preview PDF
              </button>

              <button onClick={handleExport} disabled={exporting}
                style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:'7px', fontSize:'13px', fontWeight:600, color:'#fff', background:'var(--accent)', border:'none', borderRadius:'10px', padding:'10px', cursor:'pointer', boxShadow:'0 2px 12px rgba(234,88,12,0.3)' }}>
                <Download size={14}/> Export PDF
              </button>
            </aside>
          </div>
        </main>

      </div>

      {showPreview && (
        <PreviewModal
          sessionId={uploadData.sessionId}
          sections={sections}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}
