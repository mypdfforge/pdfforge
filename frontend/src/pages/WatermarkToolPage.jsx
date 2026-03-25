import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import { Loader2, CheckCircle, AlertCircle, Type, Image as ImageIcon, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import axios from 'axios'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'

const PRESET_TEXTS = ['CONFIDENTIAL','DRAFT','COPY','SAMPLE','VOID','APPROVED']
const FONTS = ['Helvetica','Times New Roman','Courier','Arial','Georgia']
const POSITIONS = ['top-left','top-center','top-right','middle-left','middle-center','middle-right','bottom-left','bottom-center','bottom-right']
const POS_ICONS  = {'top-left':'↖','top-center':'↑','top-right':'↗','middle-left':'←','middle-center':'·','middle-right':'→','bottom-left':'↙','bottom-center':'↓','bottom-right':'↘'}

function Sec({ title, children }) {
  return (
    <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'11px 12px', display:'flex', flexDirection:'column', gap:'8px' }}>
      {title && <p style={{ fontSize:'10px', fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--text3)', margin:0 }}>{title}</p>}
      {children}
    </div>
  )
}
function Slider({ label, value, min, max, step, onChange, fmt }) {
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'3px' }}>
        <label style={{ fontSize:'11px', color:'var(--text2)', fontWeight:600 }}>{label}</label>
        <span style={{ fontSize:'11px', color:'var(--accent2)', fontWeight:700 }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(+e.target.value)} style={{ width:'100%', accentColor:'var(--accent)', cursor:'pointer' }}/>
    </div>
  )
}
function PosGrid({ value, onChange }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'3px' }}>
      {POSITIONS.map(pos=>(
        <button key={pos} onClick={()=>onChange(pos)} title={pos}
          style={{ width:'30px', height:'30px', borderRadius:'5px', border:`1px solid ${value===pos?'var(--accent)':'var(--border)'}`, background:value===pos?'rgba(108,99,255,0.2)':'var(--bg4)', color:value===pos?'var(--accent2)':'var(--text3)', cursor:'pointer', fontSize:'14px', display:'flex', alignItems:'center', justifyContent:'center' }}>
          {POS_ICONS[pos]}
        </button>
      ))}
    </div>
  )
}

function isPageSelected(n, total, range) {
  const r=(range||'').trim().toLowerCase()
  if (!r||r==='all') return true
  if (r==='odd') return n%2===1
  if (r==='even') return n%2===0
  if (r==='first'||r==='1') return n===1
  if (r==='last') return n===total
  return r.split(',').some(p=>{const t=p.trim();if(t.includes('-')){const[a,b]=t.split('-').map(Number);return n>=a&&n<=b}return Number(t)===n})
}

function renderWatermark(imgSrc, s, canvasRef) {
  return new Promise(resolve=>{
    const cv=canvasRef.current; if(!cv||!imgSrc) return resolve(null)
    const ctx=cv.getContext('2d'); const img=new Image()
    img.onload=()=>{
      cv.width=img.width; cv.height=img.height; ctx.drawImage(img,0,0)
      const W=img.width,H=img.height
      if (s.mode==='image'&&s.imageDataUrl) {
        const stamp=new Image()
        stamp.onload=()=>{
          const sw=200,sh=100,mg=40,pm={'top-left':[mg,mg],'top-center':[(W-sw)/2,mg],'top-right':[W-sw-mg,mg],'middle-left':[mg,(H-sh)/2],'middle-center':[(W-sw)/2,(H-sh)/2],'middle-right':[W-sw-mg,(H-sh)/2],'bottom-left':[mg,H-sh-mg],'bottom-center':[(W-sw)/2,H-sh-mg],'bottom-right':[W-sw-mg,H-sh-mg]}
          const[sx,sy]=s.tiled?[(W-sw)/2,(H-sh)/2]:(pm[s.position]||pm['middle-center'])
          ctx.globalAlpha=s.opacity; ctx.drawImage(stamp,sx,sy,sw,sh); ctx.globalAlpha=1
          resolve(cv.toDataURL('image/jpeg',0.85))
        }; stamp.src=s.imageDataUrl
      } else if (s.text.trim()) {
        const fs=Math.round(s.fontSize*(W/595))
        let f=s.bold&&s.italic?`bold italic ${fs}px `:s.bold?`bold ${fs}px `:s.italic?`italic ${fs}px `:`${fs}px `
        f+=(s.font==='Times New Roman'?'serif':s.font==='Courier'?'monospace':'sans-serif')
        ctx.font=f; ctx.fillStyle=s.color; ctx.globalAlpha=s.opacity; ctx.textBaseline='middle'
        const txt=s.text.replace('{{date}}',new Date().toISOString().slice(0,10)).replace('{{page_number}}','?')
        const mg=60,pm={'top-left':[mg,mg+fs/2],'top-center':[W/2,mg+fs/2],'top-right':[W-mg,mg+fs/2],'middle-left':[mg,H/2],'middle-center':[W/2,H/2],'middle-right':[W-mg,H/2],'bottom-left':[mg,H-mg],'bottom-center':[W/2,H-mg],'bottom-right':[W-mg,H-mg]}
        if (s.tiled){ctx.textAlign='center';const spX=W/3,spY=H/4;for(let r=-1;r<5;r++)for(let c=-1;c<4;c++){ctx.save();ctx.translate(c*spX+spX/2,r*spY+spY/2);ctx.rotate(45*Math.PI/180);ctx.fillText(txt,0,0);ctx.restore()}}
        else{const[cx,cy]=pm[s.position]||pm['middle-center'];ctx.textAlign=s.position.includes('center')?'center':s.position.includes('right')?'right':'left';ctx.save();ctx.translate(cx,cy);ctx.rotate(s.rotation*Math.PI/180);ctx.fillText(txt,0,0);ctx.restore()}
        ctx.globalAlpha=1; resolve(cv.toDataURL('image/jpeg',0.85))
      } else resolve(cv.toDataURL('image/jpeg',0.85))
    }; img.src=imgSrc
  })
}

export default function WatermarkToolPage({ onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const [file,        setFile]         = useState(null)
  const [pages,       setPages]        = useState([])       // [{page,img,width,height}]
  const [activePage,  setActivePage]   = useState(1)
  const [loading,     setLoading]      = useState(false)
  const [imageFile,   setImageFile]    = useState(null)
  const [imageDataUrl,setImageDataUrl] = useState(null)
  const [mode,        setMode]         = useState('text')
  const [text,        setText]         = useState('CONFIDENTIAL')
  const [font,        setFont]         = useState('Helvetica')
  const [bold,        setBold]         = useState(false)
  const [italic,      setItalic]       = useState(false)
  const [underline,   setUnderline]    = useState(false)
  const [color,       setColor]        = useState('#a0a0a0')
  const [fontSize,    setFontSize]     = useState(52)
  const [position,    setPosition]     = useState('middle-center')
  const [tiled,       setTiled]        = useState(false)
  const [opacity,     setOpacity]      = useState(0.25)
  const [rotation,    setRotation]     = useState(45)
  const [layer,       setLayer]        = useState('over')
  const [pageRange,   setPageRange]    = useState('all')
  const [previewCache,setPreviewCache] = useState({})
  const [previewing,  setPreviewing]   = useState(false)
  const [status,      setStatus]       = useState('idle')
  const [errMsg,      setErrMsg]       = useState('')
  const cvRef  = useRef(null)
  const debRef = useRef(null)

  const onDrop = useCallback(accepted=>{
    const f=accepted[0]; setFile(f); setPages([]); setPreviewCache({}); setErrMsg(''); setLoading(true)
    let first=true
    getThumbnailsProgressive(f,(t)=>{if(first){setLoading(false);first=false}if(t.img)setPages(p=>[...p,t])},5)
  },[])
  const {getRootProps,getInputProps,isDragActive}=useDropzone({onDrop,accept:{'application/pdf':['.pdf']},maxFiles:1})

  const onImgDrop=useCallback(accepted=>{const f=accepted[0];setImageFile(f);const r=new FileReader();r.onload=e=>setImageDataUrl(e.target.result);r.readAsDataURL(f)},[])
  const {getRootProps:getImgProps,getInputProps:getImgInput}=useDropzone({onDrop:onImgDrop,accept:{'image/*':[]},maxFiles:1})

  const activeThumb=pages.find(p=>p.page===activePage)
  const settings={mode,text,font,bold,italic,color,fontSize,position,tiled,opacity,rotation,imageDataUrl}

  useEffect(()=>{
    if (!activeThumb?.img) return
    if (debRef.current) clearTimeout(debRef.current)
    debRef.current=setTimeout(async()=>{
      setPreviewing(true)
      const apply=isPageSelected(activePage,pages.length,pageRange)
      const url=apply?await renderWatermark(activeThumb.img,settings,cvRef):activeThumb.img
      setPreviewCache(p=>({...p,[activePage]:url})); setPreviewing(false)
    },150)
    return()=>clearTimeout(debRef.current)
  },[activeThumb,mode,text,font,bold,italic,color,fontSize,position,tiled,opacity,rotation,imageDataUrl,pageRange])

  const apply=async()=>{
    if (!file) return; if (mode==='text'&&!text.trim()) return
    setStatus('loading'); setErrMsg('')
    try {
      const form=new FormData()
      form.append('file',file);form.append('mode',mode);form.append('opacity',String(opacity))
      form.append('rotation',String(tiled?45:rotation));form.append('position',tiled?'tile':position)
      form.append('layer',layer);form.append('page_range',pageRange)
      if(mode==='text'){form.append('text',text);form.append('font',font);form.append('bold',String(bold));form.append('italic',String(italic));form.append('underline',String(underline));form.append('color',color);form.append('font_size',String(fontSize))}
      else if(imageFile) form.append('image',imageFile)
      const res=await axios.post('/api/tools/watermark',form,{responseType:'blob',validateStatus:null})
      if(res.status!==200){const t=await res.data.text();let m=`Server error ${res.status}`;try{m=JSON.parse(t).detail||m}catch{};setErrMsg(m);setStatus('idle');return}
      downloadBlob(res.data,'watermarked.pdf'); setStatus('done'); setTimeout(()=>setStatus('idle'),3000)
    }catch(e){setErrMsg(e.response?.data?.detail||e.message);setStatus('idle')}
  }

  const preview=previewCache[activePage]

  return (
    <div style={{ height:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <canvas ref={cvRef} style={{ display:'none' }}/>
      <TopBar onBack={onBack} title="◈ Watermark" subtitle="Add text or image watermark with live preview"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory}
        onCategoryChange={onCategoryChange} search={search} onSearch={onSearch}/>

      {!file ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'40px' }}>
          <div style={{ maxWidth:'460px', width:'100%' }}>
            <div {...getRootProps()} style={{ background:isDragActive?'rgba(108,99,255,0.08)':'var(--bg2)', border:`2px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'16px', padding:'56px 40px', textAlign:'center', cursor:'pointer' }}>
              <input {...getInputProps()}/><div style={{ fontSize:'38px', marginBottom:'14px', opacity:0.5 }}>◈</div>
              <p style={{ color:'var(--text)', fontWeight:600, fontSize:'15px', marginBottom:'7px' }}>Drop your PDF here</p>
              <p style={{ color:'var(--text3)', fontSize:'12px' }}>or click to browse</p>
            </div>
          </div>
        </div>
      ) : (
        /* ── 3-panel layout: settings | thumbnail strip | large preview ── */
        <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>

          {/* ━━ Panel 1: Settings (255px) ━━ */}
          <div style={{ width:'255px', flexShrink:0, borderRight:'1px solid var(--border)', overflowY:'auto', padding:'12px', display:'flex', flexDirection:'column', gap:'8px', background:'var(--bg2)' }}>
            <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'8px', padding:'6px 10px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:'11px', color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>📄 {file.name}</span>
              <button onClick={()=>{setFile(null);setPages([])}} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:'15px', flexShrink:0 }}>×</button>
            </div>

            {/* Mode toggle */}
            <div style={{ display:'flex', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'8px', padding:'3px' }}>
              {[['text',<Type size={11}/>,'Text'],['image',<ImageIcon size={11}/>,'Image']].map(([m,icon,label])=>(
                <button key={m} onClick={()=>setMode(m)} style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:'4px', padding:'6px', borderRadius:'6px', border:'none', cursor:'pointer', fontSize:'11px', fontWeight:600, background:mode===m?'var(--accent)':'transparent', color:mode===m?'#fff':'var(--text2)', transition:'all 0.15s' }}>{icon} {label}</button>
              ))}
            </div>

            {mode==='text' && <>
              <Sec title="Text">
                <div style={{ display:'flex', flexWrap:'wrap', gap:'3px' }}>
                  {PRESET_TEXTS.map(t=><button key={t} onClick={()=>setText(t)} style={{ fontSize:'10px', padding:'2px 7px', borderRadius:'4px', border:`1px solid ${text===t?'var(--accent)':'var(--border)'}`, background:text===t?'rgba(108,99,255,0.15)':'var(--bg4)', color:text===t?'var(--accent2)':'var(--text3)', cursor:'pointer' }}>{t}</button>)}
                </div>
                <input value={text} onChange={e=>setText(e.target.value)} placeholder="Custom text…"
                  style={{ background:'var(--bg4)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'7px', padding:'6px 9px', fontSize:'12px', outline:'none', width:'100%', boxSizing:'border-box' }}/>
              </Sec>
              <Sec title="Font & Style">
                <select value={font} onChange={e=>setFont(e.target.value)} style={{ width:'100%', background:'var(--bg4)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'6px', padding:'5px 9px', fontSize:'11px', outline:'none' }}>
                  {FONTS.map(f=><option key={f} value={f}>{f}</option>)}
                </select>
                <div style={{ display:'flex', gap:'4px', alignItems:'center' }}>
                  {[[bold,setBold,'B'],[italic,setItalic,'I'],[underline,setUnderline,'U']].map(([v,s,k])=>(
                    <button key={k} onClick={()=>s(!v)} style={{ width:'28px', height:'28px', borderRadius:'5px', border:`1px solid ${v?'var(--accent)':'var(--border)'}`, background:v?'rgba(108,99,255,0.2)':'var(--bg4)', color:v?'var(--accent2)':'var(--text2)', cursor:'pointer', fontWeight:700, fontSize:'12px' }}>{k}</button>
                  ))}
                  <div style={{ display:'flex', alignItems:'center', gap:'4px', flex:1, background:'var(--bg4)', border:'1px solid var(--border)', borderRadius:'5px', padding:'0 7px', height:'28px' }}>
                    <span style={{ fontSize:'10px', color:'var(--text3)' }}>Color</span>
                    <input type="color" value={color} onChange={e=>setColor(e.target.value)} style={{ width:'20px', height:'14px', padding:0, border:'none', borderRadius:'2px', cursor:'pointer', background:'none' }}/>
                  </div>
                </div>
                <Slider label="Size" value={fontSize} min={18} max={100} step={2} onChange={setFontSize} fmt={v=>`${v}pt`}/>
              </Sec>
            </>}
            {mode==='image' && (
              <Sec title="Image">
                {!imageFile
                  ? <div {...getImgProps()} style={{ background:'var(--bg4)', border:'1px dashed var(--border)', borderRadius:'8px', padding:'16px', textAlign:'center', cursor:'pointer' }}><input {...getImgInput()}/><ImageIcon size={14} color="var(--text3)" style={{ margin:'0 auto 5px', display:'block' }}/><p style={{ fontSize:'11px', color:'var(--text2)' }}>PNG / JPG / SVG</p></div>
                  : <div style={{ display:'flex', alignItems:'center', gap:'7px', background:'var(--bg4)', border:'1px solid var(--accent)', borderRadius:'7px', padding:'6px' }}><img src={imageDataUrl} alt="wm" style={{ height:'22px', objectFit:'contain', background:'#fff', borderRadius:'3px', padding:'2px' }}/><span style={{ fontSize:'10px', color:'var(--text2)', flex:1, overflow:'hidden', textOverflow:'ellipsis' }}>{imageFile.name}</span><button onClick={()=>{setImageFile(null);setImageDataUrl(null)}} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer' }}>×</button></div>
                }
              </Sec>
            )}
            <Sec title="Position">
              <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}>
                <PosGrid value={tiled?null:position} onChange={p=>{setPosition(p);setTiled(false)}}/>
                <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
                  <label style={{ display:'flex', alignItems:'center', gap:'4px', cursor:'pointer', fontSize:'10px', color:'var(--text2)' }}>
                    <input type="checkbox" checked={tiled} onChange={e=>setTiled(e.target.checked)} style={{ accentColor:'var(--accent)' }}/> Tile
                  </label>
                  <div style={{ display:'flex', gap:'2px' }}>
                    {[['over','↑'],['under','↓']].map(([v,icon])=>(
                      <button key={v} onClick={()=>setLayer(v)} style={{ padding:'2px 5px', fontSize:'9px', borderRadius:'4px', border:`1px solid ${layer===v?'var(--accent)':'var(--border)'}`, background:layer===v?'rgba(108,99,255,0.15)':'var(--bg4)', color:layer===v?'var(--accent2)':'var(--text3)', cursor:'pointer' }}>{icon} {v}</button>
                    ))}
                  </div>
                </div>
              </div>
            </Sec>
            <Sec title="Appearance">
              <Slider label="Opacity" value={opacity} min={0.03} max={0.7} step={0.01} onChange={setOpacity} fmt={v=>`${Math.round(v*100)}%`}/>
              {!tiled && <Slider label="Rotation" value={rotation} min={-90} max={90} step={5} onChange={setRotation} fmt={v=>`${v}°`}/>}
            </Sec>
            <Sec title="Apply to Pages">
              <div style={{ display:'flex', gap:'3px', flexWrap:'wrap' }}>
                {['all','odd','even','first','last'].map(o=>(
                  <button key={o} onClick={()=>setPageRange(o)} style={{ padding:'3px 7px', fontSize:'10px', fontWeight:600, borderRadius:'5px', border:`1px solid ${pageRange===o?'var(--accent)':'var(--border)'}`, background:pageRange===o?'rgba(108,99,255,0.15)':'var(--bg4)', color:pageRange===o?'var(--accent2)':'var(--text3)', cursor:'pointer', textTransform:'capitalize' }}>{o}</button>
                ))}
              </div>
              <input value={pageRange} onChange={e=>setPageRange(e.target.value)} placeholder="e.g. 1-3, 5"
                style={{ background:'var(--bg4)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'6px', padding:'5px 9px', fontSize:'11px', outline:'none', width:'100%', boxSizing:'border-box' }}/>
              <p style={{ fontSize:'10px', color:'var(--text3)', margin:0 }}>Pages outside range show clean in preview</p>
            </Sec>
            {errMsg && <div style={{ display:'flex', gap:'6px', background:'rgba(229,83,75,0.1)', border:'1px solid rgba(229,83,75,0.3)', borderRadius:'7px', padding:'8px 10px', fontSize:'10px', color:'var(--red)' }}><AlertCircle size={11} style={{ flexShrink:0, marginTop:'1px' }}/> {errMsg}</div>}
            <div style={{ height:'65px', flexShrink:0 }}/>
          </div>

          {/* ━━ Panel 2: Thumbnail strip (110px) — scrolls independently ━━ */}
          <div style={{ width:'110px', flexShrink:0, borderRight:'1px solid var(--border)', background:'var(--bg2)', overflowY:'auto', display:'flex', flexDirection:'column' }}>
            <div style={{ padding:'6px 8px', borderBottom:'1px solid var(--border)', fontSize:'9px', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.06em', position:'sticky', top:0, background:'var(--bg2)', zIndex:1, display:'flex', alignItems:'center', gap:'4px' }}>
              Pages {loading && <Loader2 size={9} className="spin"/>}
            </div>
            {pages.map(p=>{
              const sel=isPageSelected(p.page,pages.length,pageRange)
              return (
                <div key={p.page} onClick={()=>setActivePage(p.page)}
                  style={{ padding:'6px', cursor:'pointer', background:activePage===p.page?'rgba(108,99,255,0.12)':'transparent', borderBottom:'1px solid var(--border)', position:'relative', transition:'background 0.1s' }}>
                  <div style={{ border:`2px solid ${activePage===p.page?'var(--accent)':'var(--border)'}`, borderRadius:'4px', overflow:'hidden' }}>
                    <img src={p.img} alt={`p${p.page}`} style={{ width:'100%', display:'block', opacity:sel?1:0.4 }}/>
                  </div>
                  <span style={{ fontSize:'9px', color:activePage===p.page?'var(--accent2)':'var(--text3)', display:'block', textAlign:'center', marginTop:'2px' }}>p.{p.page}</span>
                  {!sel && <div style={{ position:'absolute', top:'8px', right:'8px', background:'rgba(0,0,0,0.6)', color:'#aaa', fontSize:'8px', borderRadius:'2px', padding:'1px 3px' }}>skip</div>}
                </div>
              )
            })}
          </div>

          {/* ━━ Panel 3: Large preview workspace — scrolls independently ━━ */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#12121c' }}>
            {/* Workspace header */}
            <div style={{ padding:'8px 16px', borderBottom:'1px solid var(--border)', background:'var(--bg2)', display:'flex', alignItems:'center', gap:'10px', flexShrink:0 }}>
              <span style={{ fontSize:'12px', color:'var(--text)', fontWeight:600 }}>Page {activePage} of {pages.length}</span>
              <span style={{ fontSize:'11px', color:isPageSelected(activePage,pages.length,pageRange)?'var(--green)':'var(--text3)' }}>
                {isPageSelected(activePage,pages.length,pageRange)?'● watermark applied':'○ no watermark'}
              </span>
              {previewing && <span style={{ fontSize:'11px', color:'var(--accent2)', marginLeft:'auto' }}>● updating…</span>}
              <div style={{ display:'flex', gap:'5px', marginLeft:previewing?'0':'auto' }}>
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

            {/* Preview — only this div scrolls, image constrained to fit screen */}
            <div style={{ flex:1, overflowY:'auto', padding:'20px', display:'flex', alignItems:'flex-start', justifyContent:'center', minHeight:0 }}>
              {!pages.length ? (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', color:'var(--text3)' }}>
                  <Loader2 size={26} color="var(--accent)" className="spin" style={{ marginBottom:'10px' }}/><p style={{ fontSize:'12px' }}>Loading pages…</p>
                </div>
              ) : (
                <div style={{ textAlign:'center', width:'100%' }}>
                  <p style={{ fontSize:'11px', color:'var(--text3)', marginBottom:'10px' }}>
                    Live preview — page {activePage}
                    {!isPageSelected(activePage,pages.length,pageRange) && <span style={{ marginLeft:'5px' }}>(not in range)</span>}
                  </p>
                  {preview
                    ? <img src={preview} alt="preview"
                        style={{ maxWidth:'520px', maxHeight:'calc(100vh - 210px)', width:'100%', objectFit:'contain', boxShadow:'0 6px 40px rgba(0,0,0,0.6)', borderRadius:'4px', background:'#fff', display:'block', margin:'0 auto' }}/>
                    : <div style={{ display:'flex', justifyContent:'center', paddingTop:'40px' }}><Loader2 size={20} className="spin" color="var(--accent2)" style={{ opacity:0.5 }}/></div>
                  }
                  <div style={{ height:'65px' }}/>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating download button */}
      {file && (
        <button onClick={apply}
          disabled={!file||(mode==='text'&&!text.trim())||(mode==='image'&&!imageFile)||status==='loading'}
          style={{ position:'fixed', bottom:'20px', right:'20px', zIndex:9000, display:'flex', alignItems:'center', gap:'8px', padding:'11px 20px', borderRadius:'50px', border:'none', background:status==='done'?'var(--green)':status==='loading'?'var(--bg3)':'var(--accent)', color:status==='loading'?'var(--text2)':'#fff', fontWeight:700, fontSize:'13px', cursor:'pointer', boxShadow:'0 4px 18px rgba(108,99,255,0.4),0 2px 6px rgba(0,0,0,0.4)', transition:'all 0.2s' }}>
          {status==='loading'?<><Loader2 size={13} className="spin"/> Processing…</>:status==='done'?<><CheckCircle size={13}/> Downloaded!</>:<><Download size={13}/> Download Watermarked PDF</>}
        </button>
      )}
    </div>
  )
}
