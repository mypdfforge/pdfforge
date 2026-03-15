import React, { useState, useCallback, useRef, useMemo } from 'react'
import { ArrowLeft, Download, Loader2, CheckCircle, Upload as UploadIcon, Sparkles, Eye, Save, Crown, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import SectionCard  from '../components/SectionCard'
import AIAssistant  from '../components/AIAssistant'
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
        const BASE = import.meta.env.VITE_API_URL || 'https://mypdfforge.onrender.com/api'
        const { data } = await axios.post(`${BASE}/export/${sessionId}/preview-edited`, { blocks: sections })
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
      <div style={{ background:'#13131e', border:'1px solid #252538', borderRadius:'16px', width:'90vw', maxWidth:'760px', maxHeight:'92vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 80px rgba(0,0,0,0.8)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 20px', borderBottom:'1px solid #252538', flexShrink:0 }}>
          <div>
            <span style={{ fontWeight:700, fontSize:'15px', color:'#eeeef5' }}>Preview</span>
            {pages.length > 0 && <span style={{ fontSize:'12px', color:'#5a5a78', marginLeft:'10px' }}>Page {current+1} of {pages.length}</span>}
          </div>
          <button onClick={onClose} style={{ width:'30px', height:'30px', display:'flex', alignItems:'center', justifyContent:'center', background:'#1e1e2e', border:'1px solid #252538', borderRadius:'8px', cursor:'pointer', color:'#9898b8' }}><X size={14}/></button>
        </div>
        <div style={{ flex:1, overflow:'auto', background:'#0d0d14', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }}>
          {loading && <div style={{ textAlign:'center', color:'#5a5a78' }}><Loader2 size={28} color="#6c63ff" className="spin" style={{ display:'block', margin:'0 auto 12px' }}/><p>Generating preview…</p></div>}
          {error && <p style={{ color:'#e5534b' }}>⚠ {error}</p>}
          {!loading && !error && pages[current] && (
            <img src={pages[current]} alt={`Page ${current+1}`} style={{ maxWidth:'100%', maxHeight:'70vh', boxShadow:'0 4px 24px rgba(0,0,0,0.5)', borderRadius:'2px', background:'#fff' }}/>
          )}
        </div>
        {pages.length > 1 && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'12px', padding:'12px', borderTop:'1px solid #252538', flexShrink:0 }}>
            <button onClick={() => setCurrent(c=>Math.max(0,c-1))} disabled={current===0}
              style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'13px', color:'#9898b8', background:'none', border:'1px solid #252538', borderRadius:'7px', padding:'5px 12px', cursor:current===0?'not-allowed':'pointer', opacity:current===0?0.4:1 }}>
              <ChevronLeft size={13}/> Prev
            </button>
            {pages.map((_,i) => (
              <button key={i} onClick={() => setCurrent(i)}
                style={{ width:'28px', height:'28px', borderRadius:'7px', border:'1px solid #252538', background:i===current?'#6c63ff':'#1e1e2e', color:i===current?'#fff':'#9898b8', fontSize:'12px', cursor:'pointer' }}>
                {i+1}
              </button>
            ))}
            <button onClick={() => setCurrent(c=>Math.min(pages.length-1,c+1))} disabled={current===pages.length-1}
              style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'13px', color:'#9898b8', background:'none', border:'1px solid #252538', borderRadius:'7px', padding:'5px 12px', cursor:current===pages.length-1?'not-allowed':'pointer', opacity:current===pages.length-1?0.4:1 }}>
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
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'2rem', background:'#0d0d14', position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', width:'600px', height:'400px', background:'radial-gradient(ellipse, rgba(108,99,255,0.07) 0%, transparent 70%)', pointerEvents:'none' }}/>
      <div style={{ textAlign:'center', marginBottom:'36px', maxWidth:'500px' }}>
        <div style={{ display:'inline-flex', alignItems:'center', gap:'8px', fontSize:'11px', letterSpacing:'.1em', textTransform:'uppercase', color:'#9d97ff', background:'rgba(108,99,255,0.1)', border:'1px solid rgba(108,99,255,0.2)', padding:'5px 18px', borderRadius:'999px', marginBottom:'22px' }}>✦ Resume Editor</div>
        <h2 style={{ fontFamily:"'Syne',sans-serif", fontSize:'42px', fontWeight:800, color:'#eeeef5', marginBottom:'14px', letterSpacing:'-0.02em', lineHeight:1.1 }}>Edit your resume<br/><span style={{ color:'#9d97ff' }}>without the pain.</span></h2>
        <p style={{ fontSize:'14px', color:'#9898b8', lineHeight:1.75 }}>Upload your PDF. Every line appears as a card. Click to edit — layout preserved perfectly.</p>
      </div>
      <div {...getRootProps()} style={{ width:'100%', maxWidth:'480px', background:isDragActive?'rgba(108,99,255,0.08)':'#13131e', border:`2px dashed ${isDragActive?'#6c63ff':'#252538'}`, borderRadius:'18px', padding:'52px 36px', textAlign:'center', cursor:uploading?'not-allowed':'pointer', transition:'all 0.2s', opacity:uploading?0.7:1, position:'relative' }}>
        <div style={{ position:'absolute', top:'12px', left:'12px', width:'18px', height:'18px', borderTop:'2px solid #2e2e48', borderLeft:'2px solid #2e2e48', borderRadius:'3px 0 0 0' }}/>
        <div style={{ position:'absolute', bottom:'12px', right:'12px', width:'18px', height:'18px', borderBottom:'2px solid #2e2e48', borderRight:'2px solid #2e2e48', borderRadius:'0 0 3px 0' }}/>
        <input {...getInputProps()}/>
        <div style={{ width:'60px', height:'60px', background:isDragActive?'#6c63ff':'#1e1e2e', border:`1px solid ${isDragActive?'#6c63ff':'#252538'}`, borderRadius:'16px', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px' }}>
          {uploading ? <Loader2 size={24} color="#9d97ff" className="spin"/> : <UploadIcon size={24} color="#9d97ff" strokeWidth={1.5}/>}
        </div>
        {uploading ? <p style={{ fontSize:'16px', fontWeight:500, color:'#eeeef5' }}>Reading PDF…</p>
         : isDragActive ? <p style={{ fontSize:'18px', fontWeight:600, color:'#9d97ff' }}>Drop it!</p>
         : <><p style={{ fontSize:'16px', fontWeight:500, color:'#eeeef5' }}>Drop PDF here, or <span style={{ color:'#9d97ff', textDecoration:'underline' }}>browse</span></p><p style={{ fontSize:'13px', color:'#5a5a78', marginTop:'8px' }}>PDF files only</p></>}
      </div>
      {error && <div style={{ display:'flex', alignItems:'center', gap:'8px', marginTop:'16px', maxWidth:'480px', width:'100%', background:'rgba(229,83,75,0.1)', border:'1px solid rgba(229,83,75,0.3)', borderRadius:'10px', padding:'10px 16px', fontSize:'13px', color:'#e5534b' }}>⚠ {error}</div>}
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
  const [showAI,       setShowAI]       = useState(false)
  const [showPreview,  setShowPreview]  = useState(false)

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

  const handleAISuggestion = (updatedBlock) => {
    setSections(prev => prev.map(s =>
      s.id === updatedBlock.id ? { ...updatedBlock, changed: updatedBlock.text !== updatedBlock.original } : s
    ))
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const { data } = await api.exportPDF(uploadData.sessionId, sections)
      api.downloadBlob(data, `${uploadData.filename.replace('.pdf','')}_edited.pdf`)
      setDone(true); setTimeout(() => setDone(false), 3000)
    } catch { alert('Export failed. Check backend is running.') }
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
      <header style={{ height:'60px', padding:'0 24px', display:'flex', alignItems:'center', gap:'14px', borderBottom:'1px solid #252538', background:'rgba(13,13,20,0.97)', backdropFilter:'blur(12px)', position:'sticky', top:0, zIndex:50 }}>
        <button onClick={onBack} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', color:'#9898b8', background:'none', border:'1px solid #252538', borderRadius:'8px', padding:'5px 12px', cursor:'pointer' }}><ArrowLeft size={13}/> Back</button>
        <div style={{ width:'1px', height:'18px', background:'#252538' }}/>
        <span style={{ fontFamily:"'Syne',sans-serif", fontSize:'15px', fontWeight:800, color:'#eeeef5' }}>✦ Resume Editor</span>
      </header>
      <UploadScreen onUploaded={handleUploaded}/>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'#0d0d14', display:'flex', flexDirection:'column' }}>

      <header style={{ position:'sticky', top:0, zIndex:40, background:'rgba(13,13,20,0.95)', backdropFilter:'blur(12px)', borderBottom:'1px solid #252538', height:'58px', padding:'0 20px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={onBack} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', color:'#9898b8', background:'none', border:'1px solid #252538', borderRadius:'7px', padding:'5px 12px', cursor:'pointer' }}><ArrowLeft size={13}/> Back</button>
          <div style={{ width:'1px', height:'18px', background:'#252538' }}/>
          <div>
            <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:'15px', color:'#eeeef5' }}>✦ Resume Editor</span>
            <span style={{ fontSize:'11px', color:'#5a5a78', marginLeft:'10px', fontFamily:'monospace' }}>
              {uploadData.filename} · {sections.length} lines · {pageCount}p
              {changedCount > 0 && <span style={{ color:'#f5a623', marginLeft:'6px' }}>· {changedCount} edited</span>}
            </span>
          </div>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div style={{ fontSize:'11px', color:'#f5a623', background:'rgba(245,166,35,0.07)', border:'1px solid rgba(245,166,35,0.2)', borderRadius:'7px', padding:'4px 10px', display:'flex', alignItems:'center', gap:'5px' }}>
            <Crown size={11}/> Upgrade for italic & color
          </div>
          <button onClick={() => setShowAI(s=>!s)}
            style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', fontWeight:600, color:showAI?'#fff':'#9d97ff', background:showAI?'linear-gradient(135deg,#6c63ff,#e879f9)':'rgba(108,99,255,0.1)', border:`1px solid ${showAI?'transparent':'rgba(108,99,255,0.3)'}`, borderRadius:'8px', padding:'6px 13px', cursor:'pointer' }}>
            <Sparkles size={13}/> AI
          </button>
          <button onClick={() => setShowPreview(true)}
            style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', color:'#eeeef5', background:'#1e1e2e', border:'1px solid #252538', borderRadius:'8px', padding:'6px 13px', cursor:'pointer' }}>
            <Eye size={13} color="#9d97ff"/> Preview
          </button>
          <button onClick={handleExport} disabled={exporting}
            style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', fontWeight:600, color:'#fff', background:done?'#3ecf8e':'#6c63ff', border:'none', borderRadius:'8px', padding:'7px 16px', cursor:exporting?'not-allowed':'pointer', boxShadow:'0 2px 12px rgba(108,99,255,0.35)', transition:'background 0.2s' }}>
            {exporting ? <><Loader2 size={13} className="spin"/> Exporting…</>
             : done     ? <><CheckCircle size={13}/> Downloaded!</>
             :             <><Download size={13}/> Export PDF</>}
          </button>
        </div>
      </header>

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        <main style={{ flex:1, overflowY:'auto', padding:'24px', marginRight:showAI?'380px':0, transition:'margin 0.3s ease' }}>
          <div style={{ maxWidth:'960px', margin:'0 auto', display:'flex', gap:'24px' }}>

            {/* Cards */}
            <div style={{ flex:1, display:'flex', flexDirection:'column', gap:'20px' }}>
              {Object.entries(byPage).map(([page, pageSections]) => (
                <div key={page}>
                  {pageCount > 1 && (
                    <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'10px' }}>
                      <span style={{ fontSize:'10px', fontFamily:'monospace', color:'#5a5a78', textTransform:'uppercase', letterSpacing:'.1em' }}>Page {page}</span>
                      <div style={{ flex:1, height:'1px', background:'#252538' }}/>
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
              <div style={{ background:'#13131e', border:'1px solid #252538', borderRadius:'12px', padding:'14px' }}>
                <p style={{ fontSize:'10px', fontFamily:'monospace', color:'#5a5a78', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:'10px' }}>Document</p>
                {[['Lines', sections.length],['Pages', pageCount],['Edited', changedCount]].map(([l,v]) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', fontSize:'13px', padding:'4px 0', borderBottom:'1px solid #1e1e2e' }}>
                    <span style={{ color:'#9898b8' }}>{l}</span>
                    <span style={{ color:'#eeeef5', fontWeight:500 }}>{v}</span>
                  </div>
                ))}
              </div>

              <div style={{ background:'#13131e', border:'1px solid #252538', borderRadius:'12px', padding:'14px' }}>
                <p style={{ fontSize:'10px', fontFamily:'monospace', color:'#5a5a78', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:'10px' }}>Tips</p>
                {['Click card to edit','Enter = new line','Esc = cancel','Green = edited'].map(t => (
                  <p key={t} style={{ fontSize:'12px', color:'#9898b8', lineHeight:1.7, paddingLeft:'11px', position:'relative' }}>
                    <span style={{ position:'absolute', left:0, color:'#6c63ff' }}>›</span>{t}
                  </p>
                ))}
              </div>

              <button onClick={() => setShowPreview(true)}
                style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:'7px', fontSize:'13px', fontWeight:500, color:'#eeeef5', background:'#1e1e2e', border:'1px solid #252538', borderRadius:'10px', padding:'9px', cursor:'pointer' }}>
                <Eye size={14} color="#9d97ff"/> Preview PDF
              </button>

              <button onClick={handleExport} disabled={exporting}
                style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:'7px', fontSize:'13px', fontWeight:600, color:'#fff', background:'#6c63ff', border:'none', borderRadius:'10px', padding:'10px', cursor:'pointer', boxShadow:'0 2px 12px rgba(108,99,255,0.3)' }}>
                <Download size={14}/> Export PDF
              </button>
            </aside>
          </div>
        </main>

        {showAI && (
          <AIAssistant
            sessionId={uploadData.sessionId}
            blocks={sections}
            onApplySuggestion={handleAISuggestion}
            onClose={() => setShowAI(false)}
          />
        )}
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
