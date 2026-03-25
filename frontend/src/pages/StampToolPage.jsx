import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Loader2, CheckCircle, AlertCircle, ImageIcon, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import TopBar from '../components/TopBar'
import axios from 'axios'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'

const STAMP_LABELS = ['APPROVED','DRAFT','CONFIDENTIAL','REJECTED','FINAL','COPY','VOID','REVIEWED']
const STAMP_COLORS = { APPROVED:'#1a8a3a', DRAFT:'#cc7700', CONFIDENTIAL:'#cc0000', REJECTED:'#dd0000', FINAL:'#0033cc', COPY:'#3333bb', VOID:'#555', REVIEWED:'#0077aa' }
const POS_ROWS = [['top-left','top-center','top-right'],['middle-left','middle-center','middle-right'],['bottom-left','bottom-center','bottom-right']]

function isPageSelected(n, total, range) {
  const r=(range||'').trim().toLowerCase()
  if (!r||r==='all') return true
  if (r==='first'||r==='1') return n===1
  if (r==='last') return n===total
  if (r==='odd') return n%2===1
  if (r==='even') return n%2===0
  return r.split(',').some(p=>{const t=p.trim();if(t.includes('-')){const[a,b]=t.split('-').map(Number);return n>=a&&n<=b}return Number(t)===n})
}

function drawStamp(imgSrc, stampText, stampColor, position, fontSize, customImageSrc, cvRef) {
  return new Promise(resolve=>{
    const cv=cvRef.current; if(!cv||!imgSrc) return resolve(null)
    const ctx=cv.getContext('2d'); const img=new Image()
    img.onload=()=>{
      cv.width=img.width; cv.height=img.height; ctx.drawImage(img,0,0)
      const W=img.width,H=img.height
      if (customImageSrc) {
        const s=new Image()
        s.onload=()=>{const sw=200,sh=100,mg=20,pm={'top-left':[mg,mg],'top-center':[(W-sw)/2,mg],'top-right':[W-sw-mg,mg],'middle-left':[mg,(H-sh)/2],'middle-center':[(W-sw)/2,(H-sh)/2],'middle-right':[W-sw-mg,(H-sh)/2],'bottom-left':[mg,H-sh-mg],'bottom-center':[(W-sw)/2,H-sh-mg],'bottom-right':[W-sw-mg,H-sh-mg]};const[sx,sy]=pm[position]||pm['top-right'];ctx.globalAlpha=0.8;ctx.drawImage(s,sx,sy,sw,sh);ctx.globalAlpha=1;resolve(cv.toDataURL('image/jpeg',0.85))}
        s.src=customImageSrc
      } else {
        const fs=Math.round(fontSize*(W/595)),pd={x:14,y:10};ctx.font=`bold ${fs}px Arial`
        const tW=ctx.measureText(stampText).width,sW=tW+pd.x*2,sH=fs+pd.y*2,mg=Math.round(20*(W/595))
        const pm={'top-left':[mg,mg],'top-center':[(W-sW)/2,mg],'top-right':[W-sW-mg,mg],'middle-left':[mg,(H-sH)/2],'middle-center':[(W-sW)/2,(H-sH)/2],'middle-right':[W-sW-mg,(H-sH)/2],'bottom-left':[mg,H-sH-mg],'bottom-center':[(W-sW)/2,H-sH-mg],'bottom-right':[W-sW-mg,H-sH-mg]}
        const[sx,sy]=pm[position]||pm['top-right']
        ctx.fillStyle=stampColor+'22';ctx.strokeStyle=stampColor;ctx.lineWidth=Math.max(2,Math.round(2.5*(W/595)))
        ctx.beginPath();ctx.roundRect(sx,sy,sW,sH,4);ctx.fill();ctx.stroke()
        ctx.fillStyle=stampColor;ctx.textBaseline='middle';ctx.fillText(stampText,sx+pd.x,sy+sH/2)
        resolve(cv.toDataURL('image/jpeg',0.85))
      }
    }; img.src=imgSrc
  })
}

export default function StampToolPage({ onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const [file,        setFile]         = useState(null)
  const [pages,       setPages]        = useState([])
  const [activePage,  setActivePage]   = useState(1)
  const [loading,     setLoading]      = useState(false)
  const [label,       setLabel]        = useState('APPROVED')
  const [customText,  setCustomText]   = useState('')
  const [customImage, setCustomImage]  = useState(null)
  const [pagesRange,  setPagesRange]   = useState('1')
  const [position,    setPosition]     = useState('top-right')
  const [fontSize,    setFontSize]     = useState(18)
  const [previewCache,setPreviewCache] = useState({})
  const [previewing,  setPreviewing]   = useState(false)
  const [status,      setStatus]       = useState('idle')
  const [errMsg,      setErrMsg]       = useState('')
  const cvRef  = useRef(null)
  const debRef = useRef(null)

  const stampColor = STAMP_COLORS[label]||'#555'
  const stampText  = customText.trim()||label

  const onDrop=useCallback(accepted=>{
    const f=accepted[0]; setFile(f); setPages([]); setPreviewCache({}); setErrMsg(''); setLoading(true)
    let first=true
    getThumbnailsProgressive(f,(t)=>{if(first){setLoading(false);first=false}if(t.img)setPages(p=>[...p,t])},5)
  },[])
  const {getRootProps,getInputProps,isDragActive}=useDropzone({onDrop,accept:{'application/pdf':['.pdf']},maxFiles:1})

  const onImgDrop=useCallback(accepted=>{const r=new FileReader();r.onload=e=>{setCustomImage(e.target.result);setLabel('')};r.readAsDataURL(accepted[0])},[])
  const {getRootProps:getImgProps,getInputProps:getImgInput}=useDropzone({onDrop:onImgDrop,accept:{'image/*':[]},maxFiles:1})

  const activeThumb=pages.find(p=>p.page===activePage)

  useEffect(()=>{
    if (!activeThumb?.img) return
    if (debRef.current) clearTimeout(debRef.current)
    debRef.current=setTimeout(async()=>{
      setPreviewing(true)
      const apply=isPageSelected(activePage,pages.length,pagesRange)
      const url=apply?await drawStamp(activeThumb.img,stampText,stampColor,position,fontSize,customImage,cvRef):activeThumb.img
      setPreviewCache(p=>({...p,[activePage]:url})); setPreviewing(false)
    },150)
    return()=>clearTimeout(debRef.current)
  },[activeThumb,label,customText,customImage,position,fontSize,pagesRange])

  const apply=async()=>{
    if (!file) return; setStatus('loading'); setErrMsg('')
    try {
      const form=new FormData()
      form.append('file',file);form.append('label',label||'CUSTOM');form.append('pages',pagesRange)
      form.append('position',position);form.append('custom_text',customText);form.append('font_size',fontSize)
      const{data}=await axios.post('/api/tools/stamp',form,{responseType:'blob'})
      downloadBlob(data,'stamped.pdf'); setStatus('done'); setTimeout(()=>setStatus('idle'),3000)
    }catch(e){setErrMsg(e.message||'Stamp failed');setStatus('idle')}
  }

  const preview=previewCache[activePage]

  return (
    <div style={{ height:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <canvas ref={cvRef} style={{ display:'none' }}/>
      <TopBar onBack={onBack} title="◆ Add Stamp" subtitle="Stamp APPROVED, REJECTED, CONFIDENTIAL and more"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory}
        onCategoryChange={onCategoryChange} search={search} onSearch={onSearch}/>

      {!file ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'40px' }}>
          <div style={{ maxWidth:'460px', width:'100%' }}>
            <div {...getRootProps()} style={{ background:isDragActive?'rgba(108,99,255,0.08)':'var(--bg2)', border:`2px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'16px', padding:'56px 40px', textAlign:'center', cursor:'pointer' }}>
              <input {...getInputProps()}/><div style={{ fontSize:'38px', marginBottom:'14px', opacity:0.5 }}>◆</div>
              <p style={{ color:'var(--text)', fontWeight:600, fontSize:'15px', marginBottom:'7px' }}>Drop your PDF here</p>
              <p style={{ color:'var(--text3)', fontSize:'12px' }}>or click to browse</p>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>

          {/* ━━ Panel 1: Settings (255px) ━━ */}
          <div style={{ width:'255px', flexShrink:0, borderRight:'1px solid var(--border)', overflowY:'auto', padding:'12px', display:'flex', flexDirection:'column', gap:'8px', background:'var(--bg2)' }}>
            <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'8px', padding:'6px 10px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:'11px', color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>📄 {file.name}</span>
              <button onClick={()=>{setFile(null);setPages([])}} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:'15px' }}>×</button>
            </div>

            {/* Stamp gallery */}
            <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'11px 12px', display:'flex', flexDirection:'column', gap:'8px' }}>
              <p style={{ fontSize:'10px', fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--text3)', margin:0 }}>Stamp Gallery</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'4px' }}>
                {STAMP_LABELS.map(s=>(
                  <button key={s} onClick={()=>{setLabel(s);setCustomImage(null)}}
                    style={{ padding:'4px 8px', borderRadius:'6px', fontSize:'10px', fontWeight:700, background:label===s?STAMP_COLORS[s]+'22':'var(--bg4)', border:`2px solid ${label===s?STAMP_COLORS[s]:'var(--border)'}`, color:label===s?STAMP_COLORS[s]:'var(--text2)', cursor:'pointer', transition:'all 0.12s' }}>
                    {s}
                  </button>
                ))}
              </div>
              {/* Live badge preview */}
              {!customImage && (
                <div style={{ display:'flex', justifyContent:'center' }}>
                  <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'5px 12px', border:`2.5px solid ${stampColor}`, borderRadius:'5px', background:`${stampColor}15` }}>
                    <span style={{ fontSize:`${Math.max(fontSize*0.55,10)}px`, fontWeight:800, color:stampColor, letterSpacing:'0.05em' }}>{stampText}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Custom text */}
            <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'11px 12px', display:'flex', flexDirection:'column', gap:'6px' }}>
              <p style={{ fontSize:'10px', fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--text3)', margin:0 }}>Custom Text</p>
              <input value={customText} onChange={e=>setCustomText(e.target.value)} placeholder="Override text…"
                style={{ background:'var(--bg4)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'6px', padding:'6px 9px', fontSize:'11px', outline:'none', width:'100%', boxSizing:'border-box' }}/>
            </div>

            {/* Custom image */}
            <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'11px 12px', display:'flex', flexDirection:'column', gap:'6px' }}>
              <p style={{ fontSize:'10px', fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--text3)', margin:0 }}>Custom Image</p>
              {!customImage
                ? <div {...getImgProps()} style={{ background:'var(--bg4)', border:'1px dashed var(--border)', borderRadius:'7px', padding:'12px', textAlign:'center', cursor:'pointer' }}><input {...getImgInput()}/><ImageIcon size={14} color="var(--text3)" style={{ margin:'0 auto 4px', display:'block' }}/><p style={{ fontSize:'10px', color:'var(--text2)' }}>PNG / JPG / SVG</p></div>
                : <div style={{ display:'flex', alignItems:'center', gap:'6px', background:'var(--bg4)', border:'1px solid var(--accent)', borderRadius:'6px', padding:'6px' }}><img src={customImage} alt="s" style={{ height:'22px', objectFit:'contain', background:'#fff', borderRadius:'2px', padding:'2px' }}/><span style={{ fontSize:'10px', color:'var(--text2)', flex:1 }}>Custom image</span><button onClick={()=>{setCustomImage(null);setLabel('APPROVED')}} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer' }}>×</button></div>
              }
            </div>

            {/* Font size */}
            {!customImage && (
              <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'11px 12px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                  <span style={{ fontSize:'11px', color:'var(--text2)', fontWeight:600 }}>Font Size</span>
                  <span style={{ fontSize:'11px', color:'var(--accent2)', fontWeight:700 }}>{fontSize}pt</span>
                </div>
                <input type="range" min={12} max={36} value={fontSize} onChange={e=>setFontSize(+e.target.value)} style={{ width:'100%', accentColor:'var(--accent)' }}/>
              </div>
            )}

            {/* Position grid */}
            <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'11px 12px', display:'flex', flexDirection:'column', gap:'6px' }}>
              <p style={{ fontSize:'10px', fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--text3)', margin:0 }}>Position</p>
              <div style={{ display:'inline-grid', gridTemplateColumns:'repeat(3,1fr)', gap:'3px', background:'var(--bg4)', border:'1px solid var(--border)', borderRadius:'8px', padding:'5px' }}>
                {POS_ROWS.map(row=>row.map(pos=>(
                  <button key={pos} onClick={()=>setPosition(pos)} title={pos}
                    style={{ width:'40px', height:'28px', borderRadius:'5px', background:position===pos?'var(--accent)':'var(--bg3)', border:`1px solid ${position===pos?'var(--accent)':'var(--border)'}`, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <div style={{ width:'8px', height:'5px', borderRadius:'1px', background:position===pos?'#fff':'var(--text3)' }}/>
                  </button>
                )))}
              </div>
              <p style={{ fontSize:'10px', color:'var(--text3)', margin:0 }}>Selected: <span style={{ color:'var(--accent2)' }}>{position.replace('-',' ')}</span></p>
            </div>

            {/* Apply to pages — critical for stamps */}
            <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'10px', padding:'11px 12px', display:'flex', flexDirection:'column', gap:'6px' }}>
              <p style={{ fontSize:'10px', fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--text3)', margin:0 }}>Apply to Pages</p>
              <div style={{ display:'flex', gap:'3px', flexWrap:'wrap' }}>
                {[['all','All'],['1','First'],['last','Last'],['odd','Odd'],['even','Even']].map(([v,l])=>(
                  <button key={v} onClick={()=>setPagesRange(v)} style={{ flex:1, padding:'3px 0', fontSize:'10px', fontWeight:600, borderRadius:'5px', border:`1px solid ${pagesRange===v?'var(--accent)':'var(--border)'}`, background:pagesRange===v?'rgba(108,99,255,0.15)':'var(--bg4)', color:pagesRange===v?'var(--accent2)':'var(--text3)', cursor:'pointer' }}>{l}</button>
                ))}
              </div>
              <input value={pagesRange} onChange={e=>setPagesRange(e.target.value)} placeholder="e.g. 1, 3-5"
                style={{ background:'var(--bg4)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:'6px', padding:'5px 9px', fontSize:'11px', outline:'none', width:'100%', boxSizing:'border-box' }}/>
            </div>

            {errMsg && <div style={{ display:'flex', gap:'6px', background:'rgba(229,83,75,0.1)', border:'1px solid rgba(229,83,75,0.3)', borderRadius:'7px', padding:'8px 10px', fontSize:'10px', color:'var(--red)' }}><AlertCircle size={11} style={{ flexShrink:0, marginTop:'1px' }}/> {errMsg}</div>}
            <div style={{ height:'65px', flexShrink:0 }}/>
          </div>

          {/* ━━ Panel 2: Thumbnail strip (110px) — scrolls independently ━━ */}
          <div style={{ width:'110px', flexShrink:0, borderRight:'1px solid var(--border)', background:'var(--bg2)', overflowY:'auto', display:'flex', flexDirection:'column' }}>
            <div style={{ padding:'6px 8px', borderBottom:'1px solid var(--border)', fontSize:'9px', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.06em', position:'sticky', top:0, background:'var(--bg2)', zIndex:1, display:'flex', alignItems:'center', gap:'4px' }}>
              Pages {loading && <Loader2 size={9} className="spin"/>}
            </div>
            {pages.map(p=>{
              const sel=isPageSelected(p.page,pages.length,pagesRange)
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

          {/* ━━ Panel 3: Large preview workspace ━━ */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#12121c' }}>
            <div style={{ padding:'8px 16px', borderBottom:'1px solid var(--border)', background:'var(--bg2)', display:'flex', alignItems:'center', gap:'10px', flexShrink:0 }}>
              <span style={{ fontSize:'12px', color:'var(--text)', fontWeight:600 }}>Page {activePage} of {pages.length}</span>
              <span style={{ fontSize:'11px', color:isPageSelected(activePage,pages.length,pagesRange)?'var(--green)':'var(--text3)' }}>
                {isPageSelected(activePage,pages.length,pagesRange)?'● stamp applied':'○ no stamp'}
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

            {/* Preview — only this div scrolls */}
            <div style={{ flex:1, overflowY:'auto', padding:'20px', display:'flex', alignItems:'flex-start', justifyContent:'center', minHeight:0 }}>
              {!pages.length ? (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', color:'var(--text3)' }}>
                  <Loader2 size={26} color="var(--accent)" className="spin" style={{ marginBottom:'10px' }}/><p style={{ fontSize:'12px' }}>Loading pages…</p>
                </div>
              ) : (
                <div style={{ textAlign:'center', width:'100%' }}>
                  <p style={{ fontSize:'11px', color:'var(--text3)', marginBottom:'10px' }}>
                    Live preview — page {activePage}
                    {!isPageSelected(activePage,pages.length,pagesRange) && <span style={{ marginLeft:'5px' }}>(no stamp on this page)</span>}
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
        <button onClick={apply} disabled={!file||status==='loading'}
          style={{ position:'fixed', bottom:'20px', right:'20px', zIndex:9000, display:'flex', alignItems:'center', gap:'8px', padding:'11px 20px', borderRadius:'50px', border:'none', background:status==='done'?'var(--green)':status==='loading'?'var(--bg3)':'var(--accent)', color:status==='loading'?'var(--text2)':'#fff', fontWeight:700, fontSize:'13px', cursor:'pointer', boxShadow:'0 4px 18px rgba(108,99,255,0.4),0 2px 6px rgba(0,0,0,0.4)', transition:'all 0.2s', opacity:!file?0.5:1 }}>
          {status==='loading'?<><Loader2 size={13} className="spin"/> Processing…</>:status==='done'?<><CheckCircle size={13}/> Downloaded!</>:<><Download size={13}/> Download Stamped PDF</>}
        </button>
      )}
    </div>
  )
}
