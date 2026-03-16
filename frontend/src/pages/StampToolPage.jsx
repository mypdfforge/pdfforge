import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Loader2, CheckCircle, RefreshCw } from 'lucide-react'
import TopBar from '../components/TopBar'
import axios from 'axios'
import { downloadBlob } from '../utils/api'

const POSITIONS = [
  ['top-left','top-center','top-right'],
  ['middle-left','middle-center','middle-right'],
  ['bottom-left','bottom-center','bottom-right'],
]

const STAMP_LABELS = ['APPROVED','DRAFT','CONFIDENTIAL','REJECTED','FINAL','COPY']
const STAMP_COLORS = {
  APPROVED:'#1a8a3a', DRAFT:'#cc7700', CONFIDENTIAL:'#cc0000',
  REJECTED:'#dd0000', FINAL:'#0033cc', COPY:'#3333bb',
}

export default function StampToolPage({ onBack, dark, onToggleTheme }) {
  const [file,       setFile]       = useState(null)
  const [label,      setLabel]      = useState('APPROVED')
  const [customText, setCustomText] = useState('')
  const [pages,      setPages]      = useState('all')
  const [position,   setPosition]   = useState('top-right')
  const [fontSize,   setFontSize]   = useState(18)
  const [preview,    setPreview]    = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [state,      setState]      = useState('idle')
  const debounceRef = useRef(null)

  const onDrop = useCallback(accepted => { setFile(accepted[0]); setPreview(null) }, [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept:{'application/pdf':['.pdf']}, maxFiles:1
  })

  // Auto-preview whenever settings change
  useEffect(() => {
    if (!file) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => getPreview(), 600)
    return () => clearTimeout(debounceRef.current)
  }, [file, label, customText, position, fontSize])

  const getPreview = async () => {
    if (!file) return
    setPreviewing(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('label', label)
      form.append('position', position)
      form.append('custom_text', customText)
      form.append('font_size', fontSize)
      const { data } = await axios.post('/api/tools/stamp/preview', form)
      setPreview(data.preview)
    } catch(e) { console.error(e) }
    finally { setPreviewing(false) }
  }

  const apply = async () => {
    if (!file) return
    setState('loading')
    try {
      const form = new FormData()
      form.append('file', file); form.append('label', label)
      form.append('pages', pages); form.append('position', position)
      form.append('custom_text', customText); form.append('font_size', fontSize)
      const { data } = await axios.post('/api/tools/stamp', form, { responseType:'blob' })
      downloadBlob(data, 'stamped.pdf')
      setState('done'); setTimeout(() => setState('idle'), 3000)
    } catch(e) {
      alert('Stamp failed. Check backend.')
      setState('idle')
    }
  }

  const stampColor = STAMP_COLORS[label] || '#333'
  const stampText  = customText.trim() || label

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column' }}>

      <TopBar onBack={onBack} title="◆ Add Stamp" subtitle="Stamp APPROVED, DRAFT, CONFIDENTIAL and more" dark={dark} onToggleTheme={onToggleTheme}/>

      <div style={{ display:'flex', flex:1, height:'calc(100vh - 60px)', overflow:'hidden' }}>

        {/* Left — Settings panel */}
        <div style={{ width:'340px', flexShrink:0, borderRight:'1px solid var(--border)', overflowY:'auto', padding:'24px' }}>

          {/* Upload */}
          {!file ? (
            <div {...getRootProps()} style={{ background: isDragActive?'rgba(108,99,255,0.08)':'var(--bg2)', border:`2px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'14px', padding:'40px 24px', textAlign:'center', cursor:'pointer', marginBottom:'20px' }}>
              <input {...getInputProps()}/>
              <Upload size={22} color="var(--accent2)" style={{ margin:'0 auto 12px', display:'block' }}/>
              <p style={{ color:'var(--text)', fontWeight:500, fontSize:'14px' }}>Drop PDF here</p>
              <p style={{ color:'var(--text3)', fontSize:'12px', marginTop:'5px' }}>or click to browse</p>
            </div>
          ) : (
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'10px 14px', marginBottom:'20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:'13px', color:'var(--text)' }}>📄 {file.name}</span>
              <button onClick={() => { setFile(null); setPreview(null) }} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:'16px' }}>×</button>
            </div>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:'18px' }}>

            {/* Stamp type */}
            <div>
              <label style={{ fontSize:'12px', color:'var(--text2)', fontWeight:600, display:'block', marginBottom:'8px' }}>Stamp Type</label>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                {STAMP_LABELS.map(s => (
                  <button key={s} onClick={() => setLabel(s)}
                    style={{ padding:'6px 12px', borderRadius:'8px', fontSize:'12px', fontWeight:700,
                      background: label===s ? STAMP_COLORS[s]+'22' : 'var(--bg3)',
                      border: `2px solid ${label===s ? STAMP_COLORS[s] : 'var(--border)'}`,
                      color: label===s ? STAMP_COLORS[s] : 'var(--text2)',
                      cursor:'pointer', transition:'all 0.12s'
                    }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom text */}
            <div>
              <label style={{ fontSize:'12px', color:'var(--text2)', fontWeight:600, display:'block', marginBottom:'6px' }}>Custom Text (optional)</label>
              <input value={customText} onChange={e=>setCustomText(e.target.value)}
                placeholder={`Override with custom text…`}
                style={{ width:'100%', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'8px', padding:'8px 12px', fontSize:'13px', outline:'none', boxSizing:'border-box' }}/>
            </div>

            {/* Font size */}
            <div>
              <label style={{ fontSize:'12px', color:'var(--text2)', fontWeight:600, display:'block', marginBottom:'6px' }}>
                Font Size: <span style={{ color:'var(--accent2)' }}>{fontSize}pt</span>
              </label>
              <input type="range" min={12} max={36} value={fontSize} onChange={e=>setFontSize(+e.target.value)}
                style={{ width:'100%', accentColor:'var(--accent)' }}/>
            </div>

            {/* Position grid */}
            <div>
              <label style={{ fontSize:'12px', color:'var(--text2)', fontWeight:600, display:'block', marginBottom:'8px' }}>Position</label>
              <div style={{ display:'inline-grid', gridTemplateColumns:'repeat(3,1fr)', gap:'4px', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'8px' }}>
                {POSITIONS.map(row => row.map(pos => (
                  <button key={pos} onClick={() => setPosition(pos)}
                    style={{
                      width:'44px', height:'32px',
                      borderRadius:'6px',
                      background: position===pos ? 'var(--accent)' : 'var(--bg4)',
                      border: `1px solid ${position===pos ? 'var(--accent)' : 'var(--border)'}`,
                      cursor:'pointer', transition:'all 0.1s',
                      display:'flex', alignItems:'center', justifyContent:'center',
                    }}
                    title={pos}
                  >
                    <div style={{ width:'10px', height:'7px', borderRadius:'2px', background: position===pos ? '#fff' : 'var(--text3)' }}/>
                  </button>
                )))}
              </div>
              <p style={{ fontSize:'11px', color:'var(--text3)', marginTop:'6px' }}>Selected: <span style={{ color:'var(--accent2)' }}>{position.replace('-',' ')}</span></p>
            </div>

            {/* Pages */}
            <div>
              <label style={{ fontSize:'12px', color:'var(--text2)', fontWeight:600, display:'block', marginBottom:'6px' }}>Apply to pages</label>
              <input value={pages} onChange={e=>setPages(e.target.value)}
                placeholder="all or 1,2,3"
                style={{ width:'100%', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'8px', padding:'8px 12px', fontSize:'13px', outline:'none', boxSizing:'border-box' }}/>
            </div>

            {/* Live stamp preview box */}
            <div>
              <label style={{ fontSize:'12px', color:'var(--text2)', fontWeight:600, display:'block', marginBottom:'8px' }}>Stamp Preview</label>
              <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'8px 18px', border:`2.5px solid ${stampColor}`, borderRadius:'6px', background:`${stampColor}15`, minWidth:'120px' }}>
                <span style={{ fontSize:`${Math.max(fontSize * 0.7, 12)}px`, fontWeight:800, color:stampColor, letterSpacing:'0.04em' }}>{stampText}</span>
              </div>
            </div>

            {/* Apply button */}
            <button onClick={apply} disabled={!file || state==='loading'}
              style={{ padding:'12px', background:state==='done'?'var(--green)':'var(--accent)', color:'#fff', border:'none', borderRadius:'10px', cursor:!file?'not-allowed':'pointer', fontWeight:700, fontSize:'14px', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', opacity:!file?0.5:1, boxShadow:'0 4px 16px rgba(108,99,255,0.3)' }}>
              {state==='loading' ? <><Loader2 size={15} className="spin"/> Adding stamp…</>
               : state==='done'  ? <><CheckCircle size={15}/> Downloaded!</>
               :                   <>◆ Add Stamp to PDF</>}
            </button>
          </div>
        </div>

        {/* Right — Page preview */}
        <div style={{ flex:1, background:'#1a1a26', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px', overflowY:'auto' }}>
          {!file ? (
            <div style={{ textAlign:'center', color:'var(--text3)' }}>
              <div style={{ fontSize:'48px', marginBottom:'12px' }}>◆</div>
              <p style={{ fontSize:'14px' }}>Upload a PDF to see live preview</p>
            </div>
          ) : previewing ? (
            <div style={{ textAlign:'center', color:'var(--text3)' }}>
              <Loader2 size={28} color="var(--accent)" className="spin" style={{ marginBottom:'10px' }}/>
              <p style={{ fontSize:'13px' }}>Updating preview…</p>
            </div>
          ) : preview ? (
            <div style={{ textAlign:'center' }}>
              <p style={{ fontSize:'12px', color:'var(--text3)', marginBottom:'12px' }}>Live preview (Page 1)</p>
              <img src={preview} alt="Stamp preview" style={{ maxWidth:'100%', maxHeight:'75vh', boxShadow:'0 4px 32px rgba(0,0,0,0.5)', borderRadius:'4px', background:'#fff' }}/>
              <p style={{ fontSize:'11px', color:'var(--text3)', marginTop:'10px' }}>Preview updates automatically as you change settings</p>
            </div>
          ) : (
            <div style={{ textAlign:'center', color:'var(--text3)' }}>
              <RefreshCw size={24} style={{ marginBottom:'10px' }}/>
              <p style={{ fontSize:'13px' }}>Preview loading…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
