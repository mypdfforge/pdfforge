import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import CategoryBar from '../components/CategoryBar'
import {
  Upload, Loader2, CheckCircle, AlertCircle,
  Type, Image as ImageIcon, Bold, Italic, Underline, ChevronDown
} from 'lucide-react'
import axios from 'axios'
import { downloadBlob } from '../utils/api'

const PRESET_TEXTS = ['CONFIDENTIAL', 'DRAFT', 'COPY', 'SAMPLE', 'VOID', 'APPROVED']
const FONTS = ['Helvetica', 'Times New Roman', 'Courier', 'Arial', 'Georgia']
const POSITIONS = [
  'top-left','top-center','top-right',
  'middle-left','middle-center','middle-right',
  'bottom-left','bottom-center','bottom-right',
]
const POS_ICONS = {
  'top-left':'↖','top-center':'↑','top-right':'↗',
  'middle-left':'←','middle-center':'·','middle-right':'→',
  'bottom-left':'↙','bottom-center':'↓','bottom-right':'↘',
}

function PositionGrid({ value, onChange }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'4px' }}>
      {POSITIONS.map(pos => (
        <button key={pos} onClick={() => onChange(pos)} title={pos}
          style={{
            width:'30px', height:'30px', borderRadius:'6px',
            border:`1px solid ${value===pos?'var(--accent)':'var(--border)'}`,
            background: value===pos ? 'rgba(108,99,255,0.25)' : 'var(--bg3)',
            color: value===pos ? 'var(--accent2)' : 'var(--text3)',
            cursor:'pointer', fontSize:'14px', display:'flex',
            alignItems:'center', justifyContent:'center', transition:'all 0.12s',
          }}>{POS_ICONS[pos]}</button>
      ))}
    </div>
  )
}

function SliderRow({ label, value, min, max, step, onChange, fmt }) {
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'5px' }}>
        <label style={{ fontSize:'12px', color:'var(--text2)', fontWeight:600 }}>{label}</label>
        <span style={{ fontSize:'12px', color:'var(--accent2)', fontWeight:600 }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        style={{ width:'100%', accentColor:'var(--accent)' }}/>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'14px 16px', display:'flex', flexDirection:'column', gap:'12px' }}>
      {title && <p style={{ fontSize:'11px', fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--text3)' }}>{title}</p>}
      {children}
    </div>
  )
}

function PageRangeControl({ onChange }) {
  const [mode, setMode] = useState('all')
  const [custom, setCustom] = useState('')
  const handleMode = m => { setMode(m); onChange(m !== 'custom' ? m : custom) }
  const handleCustom = v => { setCustom(v); onChange(v) }
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
      <div style={{ display:'flex', gap:'5px' }}>
        {['all','odd','even','custom'].map(o => (
          <button key={o} onClick={() => handleMode(o)}
            style={{ flex:1, padding:'5px 0', fontSize:'11px', fontWeight:600, borderRadius:'6px',
              border:`1px solid ${mode===o?'var(--accent)':'var(--border)'}`,
              background:mode===o?'rgba(108,99,255,0.15)':'var(--bg3)',
              color:mode===o?'var(--accent2)':'var(--text3)', cursor:'pointer', textTransform:'capitalize' }}>
            {o}
          </button>
        ))}
      </div>
      {mode==='custom' && (
        <input value={custom} onChange={e=>handleCustom(e.target.value)} placeholder="e.g. 1-3, 5, 8"
          style={{ width:'100%', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'8px', padding:'7px 10px', fontSize:'12px', outline:'none', boxSizing:'border-box' }}/>
      )}
    </div>
  )
}

export default function WatermarkToolPage({ onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const [file,       setFile]       = useState(null)
  const [imageFile,  setImageFile]  = useState(null)
  const [mode,       setMode]       = useState('text')
  const [text,       setText]       = useState('CONFIDENTIAL')
  const [font,       setFont]       = useState('Helvetica')
  const [bold,       setBold]       = useState(false)
  const [italic,     setItalic]     = useState(false)
  const [underline,  setUnderline]  = useState(false)
  const [color,      setColor]      = useState('#a0a0a0')
  const [fontSize,   setFontSize]   = useState(52)
  const [position,   setPosition]   = useState('middle-center')
  const [tiled,      setTiled]      = useState(false)
  const [opacity,    setOpacity]    = useState(0.25)
  const [rotation,   setRotation]   = useState(45)
  const [layer,      setLayer]      = useState('over')
  const [pageRange,  setPageRange]  = useState('all')
  const [preview,    setPreview]    = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [state,      setState]      = useState('idle')
  const [errMsg,     setErrMsg]     = useState('')
  const debounceRef = useRef(null)

  const onDrop = useCallback(a => { setFile(a[0]); setPreview(null); setErrMsg('') }, [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept:{'application/pdf':['.pdf']}, maxFiles:1 })
  const onImageDrop = useCallback(a => setImageFile(a[0]), [])
  const { getRootProps: getImgProps, getInputProps: getImgInput } = useDropzone({ onDrop: onImageDrop, accept:{'image/*':['.png','.jpg','.jpeg','.svg']}, maxFiles:1 })

  useEffect(() => {
    if (!file) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(getPreview, 700)
    return () => clearTimeout(debounceRef.current)
  }, [file, mode, text, font, bold, italic, underline, color, fontSize, position, tiled, opacity, rotation, layer, imageFile])

  const buildForm = () => {
    const form = new FormData()
    form.append('file', file)
    form.append('mode', mode)
    form.append('opacity', String(opacity))
    form.append('rotation', String(tiled ? 45 : rotation))
    form.append('position', tiled ? 'tile' : position)
    form.append('layer', layer)
    form.append('page_range', pageRange)
    if (mode === 'text') {
      form.append('text', text)
      form.append('font', font)
      form.append('bold', String(bold))
      form.append('italic', String(italic))
      form.append('underline', String(underline))
      form.append('color', color)
      form.append('font_size', String(fontSize))
    } else if (imageFile) {
      form.append('image', imageFile)
    }
    return form
  }

  const getPreview = async () => {
    if (!file) return
    if (mode === 'text' && !text.trim()) return
    if (mode === 'image' && !imageFile) return
    setLoading(true)
    try {
      const { data } = await axios.post('/api/tools/watermark/preview', buildForm())
      setPreview(data.preview); setErrMsg('')
    } catch(e) { setErrMsg('Preview error: ' + (e.response?.data?.detail || e.message)) }
    finally { setLoading(false) }
  }

  const apply = async () => {
    if (!file) return
    if (mode === 'text' && !text.trim()) return
    setState('loading'); setErrMsg('')
    try {
      const response = await axios.post('/api/tools/watermark', buildForm(), { responseType:'blob', validateStatus:null })
      if (response.status !== 200) {
        const txt = await response.data.text()
        let msg = `Server error ${response.status}`
        try { msg = JSON.parse(txt).detail || msg } catch {}
        setErrMsg(msg); setState('idle'); return
      }
      downloadBlob(response.data, 'watermarked.pdf')
      setState('done'); setTimeout(() => setState('idle'), 3000)
    } catch(e) {
      setErrMsg('Error: ' + (e.response?.data?.detail || e.message)); setState('idle')
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column' }}>
      <TopBar onBack={onBack} title="◈ Add Watermark" subtitle="Text or image watermark with live preview" dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome} showCategories={showCategories} activeCategory={activeCategory} onCategoryChange={onCategoryChange} search={search} onSearch={onSearch}/>

      <div style={{ display:'flex', flex:1, height:'calc(100vh - 52px)', overflow:'hidden' }}>
        <div style={{ width:'340px', flexShrink:0, borderRight:'1px solid var(--border)', overflowY:'auto', padding:'18px', display:'flex', flexDirection:'column', gap:'12px' }}>

          {!file ? (
            <div {...getRootProps()} style={{ background:isDragActive?'rgba(108,99,255,0.08)':'var(--bg2)', border:`2px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'12px', padding:'30px 20px', textAlign:'center', cursor:'pointer' }}>
              <input {...getInputProps()}/>
              <Upload size={20} color="var(--accent2)" style={{ margin:'0 auto 10px', display:'block' }}/>
              <p style={{ color:'var(--text)', fontWeight:500, fontSize:'14px' }}>Drop PDF here</p>
              <p style={{ color:'var(--text3)', fontSize:'12px', marginTop:'4px' }}>or click to browse</p>
            </div>
          ) : (
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'9px 14px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:'13px', color:'var(--text)' }}>📄 {file.name}</span>
              <button onClick={() => { setFile(null); setPreview(null); setErrMsg('') }} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:'18px' }}>×</button>
            </div>
          )}

          {/* Mode toggle */}
          <div style={{ display:'flex', gap:'5px', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'4px' }}>
            {[['text', <Type size={13}/>, 'Text Watermark'], ['image', <ImageIcon size={13}/>, 'Image Watermark']].map(([m, icon, label]) => (
              <button key={m} onClick={() => setMode(m)}
                style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:'6px', padding:'7px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight:600, transition:'all 0.15s',
                  background: mode===m ? 'var(--accent)' : 'transparent',
                  color: mode===m ? '#fff' : 'var(--text2)' }}>
                {icon} {label}
              </button>
            ))}
          </div>

          {mode === 'text' && <>
            <Section title="Text Content">
              <div style={{ display:'flex', flexWrap:'wrap', gap:'5px' }}>
                {PRESET_TEXTS.map(t => (
                  <button key={t} onClick={() => setText(t)}
                    style={{ fontSize:'11px', padding:'3px 9px', borderRadius:'6px', border:`1px solid ${text===t?'var(--accent)':'var(--border)'}`, background:text===t?'rgba(108,99,255,0.15)':'var(--bg3)', color:text===t?'var(--accent2)':'var(--text2)', cursor:'pointer' }}>
                    {t}
                  </button>
                ))}
              </div>
              <input value={text} onChange={e => setText(e.target.value)} placeholder="Custom watermark text"
                style={{ width:'100%', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'8px', padding:'8px 12px', fontSize:'13px', outline:'none', boxSizing:'border-box' }}/>
              <div>
                <p style={{ fontSize:'11px', color:'var(--text3)', marginBottom:'5px' }}>Dynamic placeholders:</p>
                <div style={{ display:'flex', gap:'5px' }}>
                  {['{{date}}', '{{page_number}}'].map(ph => (
                    <button key={ph} onClick={() => setText(p => p + ph)}
                      style={{ fontSize:'11px', padding:'3px 9px', borderRadius:'6px', border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--accent2)', cursor:'pointer', fontFamily:'monospace' }}>
                      {ph}
                    </button>
                  ))}
                </div>
              </div>
            </Section>

            <Section title="Typography">
              <div>
                <label style={{ fontSize:'12px', color:'var(--text2)', fontWeight:600, display:'block', marginBottom:'5px' }}>Font Family</label>
                <div style={{ position:'relative' }}>
                  <select value={font} onChange={e => setFont(e.target.value)}
                    style={{ width:'100%', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'8px', padding:'7px 12px', fontSize:'13px', outline:'none', appearance:'none', cursor:'pointer' }}>
                    {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <ChevronDown size={13} color="var(--text3)" style={{ position:'absolute', right:'10px', top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}/>
                </div>
              </div>
              <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                {[[bold,setBold,<Bold size={14}/>,'B'],[italic,setItalic,<Italic size={14}/>,'I'],[underline,setUnderline,<Underline size={14}/>,'U']].map(([val,set,icon,key]) => (
                  <button key={key} onClick={() => set(!val)}
                    style={{ width:'34px', height:'34px', borderRadius:'7px', border:`1px solid ${val?'var(--accent)':'var(--border)'}`, background:val?'rgba(108,99,255,0.2)':'var(--bg3)', color:val?'var(--accent2)':'var(--text2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {icon}
                  </button>
                ))}
                <div style={{ display:'flex', alignItems:'center', gap:'6px', flex:1, background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'7px', padding:'0 10px', height:'34px' }}>
                  <label style={{ fontSize:'12px', color:'var(--text2)' }}>Color</label>
                  <input type="color" value={color} onChange={e => setColor(e.target.value)}
                    style={{ width:'26px', height:'20px', padding:0, border:'none', borderRadius:'3px', cursor:'pointer', background:'none' }}/>
                </div>
              </div>
              <SliderRow label="Font Size" value={fontSize} min={18} max={100} step={2} onChange={setFontSize} fmt={v=>`${v}pt`}/>
            </Section>
          </>}

          {mode === 'image' && (
            <Section title="Watermark Image">
              {!imageFile ? (
                <div {...getImgProps()} style={{ background:'var(--bg3)', border:'1px dashed var(--border)', borderRadius:'10px', padding:'24px', textAlign:'center', cursor:'pointer' }}>
                  <input {...getImgInput()}/>
                  <ImageIcon size={18} color="var(--text3)" style={{ display:'block', margin:'0 auto 8px' }}/>
                  <p style={{ fontSize:'13px', color:'var(--text2)' }}>Drop PNG / JPG / SVG</p>
                </div>
              ) : (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'8px', padding:'8px 12px' }}>
                  <span style={{ fontSize:'12px', color:'var(--text)' }}>🖼 {imageFile.name}</span>
                  <button onClick={() => setImageFile(null)} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer' }}>×</button>
                </div>
              )}
            </Section>
          )}

          <Section title="Position & Layout">
            <div style={{ display:'flex', gap:'16px', alignItems:'flex-start' }}>
              <div>
                <p style={{ fontSize:'12px', color:'var(--text2)', fontWeight:600, marginBottom:'7px' }}>Position</p>
                <PositionGrid value={tiled ? null : position} onChange={pos => { setPosition(pos); setTiled(false) }}/>
              </div>
              <div style={{ flex:1, display:'flex', flexDirection:'column', gap:'8px' }}>
                <label style={{ display:'flex', alignItems:'center', gap:'7px', cursor:'pointer', fontSize:'13px', color:'var(--text2)', background:'var(--bg3)', border:`1px solid ${tiled?'var(--accent)':'var(--border)'}`, borderRadius:'8px', padding:'8px 10px' }}>
                  <input type="checkbox" checked={tiled} onChange={e => setTiled(e.target.checked)} style={{ accentColor:'var(--accent)', width:'14px', height:'14px' }}/>
                  Tile / Mosaic
                </label>
                <div>
                  <p style={{ fontSize:'11px', color:'var(--text3)', marginBottom:'5px' }}>Layer</p>
                  <div style={{ display:'flex', gap:'4px' }}>
                    {[['over','Above'],['under','Below']].map(([v,l]) => (
                      <button key={v} onClick={() => setLayer(v)}
                        style={{ flex:1, fontSize:'11px', padding:'5px 4px', borderRadius:'6px', border:`1px solid ${layer===v?'var(--accent)':'var(--border)'}`, background:layer===v?'rgba(108,99,255,0.15)':'var(--bg3)', color:layer===v?'var(--accent2)':'var(--text3)', cursor:'pointer' }}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Section>

          <Section title="Appearance">
            <SliderRow label="Opacity" value={opacity} min={0.03} max={0.7} step={0.01} onChange={setOpacity} fmt={v=>`${Math.round(v*100)}%`}/>
            {!tiled && <SliderRow label="Rotation" value={rotation} min={-90} max={90} step={5} onChange={setRotation} fmt={v=>`${v}°`}/>}
          </Section>

          <Section title="Apply to Pages">
            <PageRangeControl onChange={setPageRange}/>
          </Section>

          {errMsg && (
            <div style={{ display:'flex', alignItems:'flex-start', gap:'8px', background:'rgba(229,83,75,0.1)', border:'1px solid rgba(229,83,75,0.3)', borderRadius:'8px', padding:'10px 12px', fontSize:'12px', color:'var(--red)', lineHeight:1.5 }}>
              <AlertCircle size={13} style={{ flexShrink:0, marginTop:'1px' }}/> {errMsg}
            </div>
          )}

          <button onClick={apply}
            disabled={!file||(mode==='text'&&!text.trim())||(mode==='image'&&!imageFile)||state==='loading'}
            style={{ padding:'12px', background:state==='done'?'var(--green)':state==='loading'?'var(--bg3)':'var(--accent)', color:state==='loading'?'var(--text2)':'#fff', border:'none', borderRadius:'10px', cursor:'pointer', fontWeight:700, fontSize:'14px', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', boxShadow:'0 4px 16px rgba(108,99,255,0.25)', opacity:!file?0.5:1 }}>
            {state==='loading'?<><Loader2 size={15} className="spin"/> Adding watermark…</>:state==='done'?<><CheckCircle size={15}/> Downloaded!</>:<>◈ Add Watermark</>}
          </button>
        </div>

        <div style={{ flex:1, background:'#14141f', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px', overflowY:'auto' }}>
          {!file ? (
            <div style={{ textAlign:'center', color:'var(--text3)' }}>
              <div style={{ fontSize:'52px', marginBottom:'14px', opacity:0.25 }}>◈</div>
              <p style={{ fontSize:'15px', fontWeight:600, color:'var(--text2)' }}>Upload a PDF to see live preview</p>
              <p style={{ fontSize:'13px', marginTop:'6px' }}>Changes update automatically as you adjust settings</p>
            </div>
          ) : loading ? (
            <div style={{ textAlign:'center', color:'var(--text3)' }}>
              <Loader2 size={32} color="var(--accent)" className="spin" style={{ display:'block', margin:'0 auto 12px' }}/>
              <p style={{ fontSize:'13px' }}>Generating preview…</p>
            </div>
          ) : preview ? (
            <div style={{ textAlign:'center', width:'100%' }}>
              <p style={{ fontSize:'12px', color:'var(--text3)', marginBottom:'14px' }}>Live preview (page 1) — updates automatically</p>
              <img src={preview} alt="Watermark preview"
                style={{ maxWidth:'100%', maxHeight:'78vh', boxShadow:'0 8px 48px rgba(0,0,0,0.6)', borderRadius:'4px', background:'#fff' }}/>
            </div>
          ) : (
            <div style={{ textAlign:'center', color:'var(--text3)' }}>
              <Loader2 size={20} className="spin" style={{ display:'block', margin:'0 auto 10px', opacity:0.4 }}/>
              <p style={{ fontSize:'13px' }}>Waiting for preview…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
