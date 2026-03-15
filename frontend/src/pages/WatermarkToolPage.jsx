import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { ArrowLeft, Upload, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import axios from 'axios'
import { downloadBlob } from '../utils/api'

export default function WatermarkToolPage({ onBack }) {
  const [file,     setFile]     = useState(null)
  const [text,     setText]     = useState('CONFIDENTIAL')
  const [opacity,  setOpacity]  = useState(0.25)
  const [rotation, setRotation] = useState(45)
  const [fontSize, setFontSize] = useState(52)
  const [preview,  setPreview]  = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [state,    setState]    = useState('idle')
  const [errMsg,   setErrMsg]   = useState('')
  const debounceRef = useRef(null)

  const onDrop = useCallback(a => { setFile(a[0]); setPreview(null); setErrMsg('') }, [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept:{'application/pdf':['.pdf']}, maxFiles:1
  })

  // Auto-preview on settings change
  useEffect(() => {
    if (!file) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(getPreview, 700)
    return () => clearTimeout(debounceRef.current)
  }, [file, text, opacity, rotation, fontSize])

  const getPreview = async () => {
    if (!file || !text.trim()) return
    setLoading(true)
    try {
      const form = new FormData()
      form.append('file',      file)
      form.append('text',      text)
      form.append('opacity',   String(opacity))
      form.append('rotation',  String(rotation))
      form.append('font_size', String(fontSize))
      const { data } = await axios.post('/api/tools/watermark/preview', form)
      setPreview(data.preview)
      setErrMsg('')
    } catch(e) {
      const msg = e.response?.data?.detail || e.message || 'Preview failed'
      setErrMsg(`Preview error: ${msg}`)
    } finally { setLoading(false) }
  }

  const apply = async () => {
    if (!file || !text.trim()) return
    setState('loading'); setErrMsg('')
    try {
      const form = new FormData()
      form.append('file',      file)
      form.append('text',      text)
      form.append('opacity',   String(opacity))
      form.append('rotation',  String(rotation))
      form.append('font_size', String(fontSize))

      const response = await axios.post('/api/tools/watermark', form, {
        responseType: 'blob',
        validateStatus: null,  // don't throw on non-2xx
      })

      // Check if response is an error (JSON) or success (PDF)
      if (response.status !== 200) {
        // Read the blob as text to get error message
        const text_err = await response.data.text()
        let msg = `Server error ${response.status}`
        try { msg = JSON.parse(text_err).detail || msg } catch {}
        setErrMsg(msg)
        setState('idle')
        return
      }

      downloadBlob(response.data, 'watermarked.pdf')
      setState('done')
      setTimeout(() => setState('idle'), 3000)
    } catch(e) {
      const msg = e.response?.data?.detail || e.message || 'Request failed'
      setErrMsg(`Error: ${msg}. Make sure backend is running on port 8000.`)
      setState('idle')
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column' }}>
      <header style={{ height:'60px', padding:'0 24px', display:'flex', alignItems:'center', gap:'14px', borderBottom:'1px solid var(--border)', background:'rgba(13,13,20,0.97)', backdropFilter:'blur(12px)', position:'sticky', top:0, zIndex:50 }}>
        <button onClick={onBack} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', color:'var(--text2)', background:'none', border:'1px solid var(--border)', borderRadius:'8px', padding:'5px 12px', cursor:'pointer' }}>
          <ArrowLeft size={13}/> Back
        </button>
        <div style={{ width:'1px', height:'18px', background:'var(--border)' }}/>
        <span style={{ fontSize:'16px', fontWeight:700, color:'var(--text)' }}>◈ Add Watermark</span>
      </header>

      <div style={{ display:'flex', flex:1, height:'calc(100vh - 60px)', overflow:'hidden' }}>

        {/* Settings panel */}
        <div style={{ width:'320px', flexShrink:0, borderRight:'1px solid var(--border)', overflowY:'auto', padding:'24px' }}>

          {/* Upload */}
          {!file ? (
            <div {...getRootProps()} style={{ background:isDragActive?'rgba(108,99,255,0.08)':'var(--bg2)', border:`2px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'14px', padding:'40px 24px', textAlign:'center', cursor:'pointer', marginBottom:'20px' }}>
              <input {...getInputProps()}/>
              <Upload size={22} color="var(--accent2)" style={{ margin:'0 auto 12px', display:'block' }}/>
              <p style={{ color:'var(--text)', fontWeight:500, fontSize:'14px' }}>Drop PDF here</p>
              <p style={{ color:'var(--text3)', fontSize:'12px', marginTop:'5px' }}>or click to browse</p>
            </div>
          ) : (
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'10px 14px', marginBottom:'20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:'13px', color:'var(--text)' }}>📄 {file.name}</span>
              <button onClick={() => { setFile(null); setPreview(null); setErrMsg('') }}
                style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:'16px' }}>×</button>
            </div>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:'18px' }}>

            {/* Watermark text */}
            <div>
              <label style={{ fontSize:'12px', color:'var(--text2)', fontWeight:600, display:'block', marginBottom:'8px' }}>Watermark Text</label>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'8px' }}>
                {['CONFIDENTIAL','DRAFT','COPY','SAMPLE','VOID'].map(t => (
                  <button key={t} onClick={() => setText(t)}
                    style={{ fontSize:'11px', padding:'4px 10px', borderRadius:'6px', border:`1px solid ${text===t?'var(--accent)':'var(--border)'}`, background:text===t?'rgba(108,99,255,0.15)':'var(--bg3)', color:text===t?'var(--accent2)':'var(--text2)', cursor:'pointer' }}>
                    {t}
                  </button>
                ))}
              </div>
              <input value={text} onChange={e=>setText(e.target.value)} placeholder="Custom text"
                style={{ width:'100%', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'8px', padding:'8px 12px', fontSize:'13px', outline:'none', boxSizing:'border-box' }}/>
            </div>

            {/* Sliders */}
            {[
              { label:'Opacity', value:opacity,  min:0.05, max:0.6,  step:0.05, set:setOpacity,  fmt: v => `${Math.round(v*100)}%` },
              { label:'Rotation', value:rotation, min:0,    max:90,   step:5,    set:setRotation, fmt: v => `${v}°` },
              { label:'Font Size', value:fontSize, min:24,  max:80,   step:4,    set:setFontSize, fmt: v => `${v}pt` },
            ].map(s => (
              <div key={s.label}>
                <label style={{ fontSize:'12px', color:'var(--text2)', fontWeight:600, display:'block', marginBottom:'6px' }}>
                  {s.label}: <span style={{ color:'var(--accent2)' }}>{s.fmt(s.value)}</span>
                </label>
                <input type="range" min={s.min} max={s.max} step={s.step} value={s.value}
                  onChange={e => s.set(+e.target.value)}
                  style={{ width:'100%', accentColor:'var(--accent)' }}/>
              </div>
            ))}

            {/* Error message */}
            {errMsg && (
              <div style={{ display:'flex', alignItems:'flex-start', gap:'8px', background:'rgba(229,83,75,0.1)', border:'1px solid rgba(229,83,75,0.3)', borderRadius:'8px', padding:'10px 12px', fontSize:'12px', color:'var(--red)', lineHeight:1.5 }}>
                <AlertCircle size={13} style={{ flexShrink:0, marginTop:'1px' }}/>
                {errMsg}
              </div>
            )}

            <button onClick={apply} disabled={!file||!text.trim()||state==='loading'}
              style={{ padding:'12px', background:state==='done'?'var(--green)':'var(--accent)', color:'#fff', border:'none', borderRadius:'10px', cursor:!file?'not-allowed':'pointer', fontWeight:700, fontSize:'14px', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', opacity:!file?0.5:1, boxShadow:'0 4px 16px rgba(108,99,255,0.3)' }}>
              {state==='loading' ? <><Loader2 size={15} className="spin"/> Adding watermark…</>
               : state==='done'  ? <><CheckCircle size={15}/> Downloaded!</>
               :                   <>◈ Add Watermark</>}
            </button>
          </div>
        </div>

        {/* Preview panel */}
        <div style={{ flex:1, background:'#1a1a26', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px', overflowY:'auto' }}>
          {!file ? (
            <div style={{ textAlign:'center', color:'var(--text3)' }}>
              <div style={{ fontSize:'48px', marginBottom:'12px' }}>◈</div>
              <p style={{ fontSize:'14px' }}>Upload a PDF to see live preview</p>
            </div>
          ) : loading ? (
            <div style={{ textAlign:'center', color:'var(--text3)' }}>
              <Loader2 size={28} color="var(--accent)" className="spin" style={{ display:'block', margin:'0 auto 10px' }}/>
              <p style={{ fontSize:'13px' }}>Generating preview…</p>
            </div>
          ) : preview ? (
            <div style={{ textAlign:'center' }}>
              <p style={{ fontSize:'12px', color:'var(--text3)', marginBottom:'12px' }}>
                Live preview — updates as you change settings
              </p>
              <img src={preview} alt="Watermark preview"
                style={{ maxWidth:'100%', maxHeight:'75vh', boxShadow:'0 4px 32px rgba(0,0,0,0.5)', borderRadius:'4px', background:'#fff' }}/>
            </div>
          ) : (
            <div style={{ textAlign:'center', color:'var(--text3)' }}>
              <p style={{ fontSize:'13px' }}>Waiting for preview…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
