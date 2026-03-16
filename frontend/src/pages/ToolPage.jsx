import React, { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Loader2, CheckCircle, AlertCircle, Info, X, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import TopBar from '../components/TopBar'
import * as api from '../utils/api'
import axios from 'axios'

const CONFIGS = {
  merge:        { title:'Merge PDFs',        desc:'Combine multiple PDFs into one.',       multi:true,  guide:'Upload 2+ PDFs. Drag arrows to reorder.', fields:[], action:(f)=>api.mergePDFs(f), out:'merged.pdf' },
  split:        { title:'Split PDF',         desc:'Extract a range of pages.',             guide:'Select pages visually or type a range like 1-3,5.', fields:[{id:'pages',label:'Page range',placeholder:'e.g. 1-3,5,7',tip:'Commas and dashes'}], useSelector:true, action:(f,v)=>api.splitPDF(f[0],v.pages||'1'), out:'split.pdf' },
  extract:      { title:'Extract Pages',     desc:'Pull specific pages into a new PDF.',   guide:'Click thumbnails or type page numbers.', fields:[{id:'pages',label:'Pages',placeholder:'e.g. 1,3,5'}], useSelector:true, action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); form.append('pages',v.pages||'1'); return api._post('/tools/extract',form) }, out:'extracted.pdf' },
  rotate:       { title:'Rotate Pages',      desc:'Rotate PDF pages.',                     guide:'Select pages and choose angle. Leave blank to rotate all.', fields:[{id:'degrees',label:'Angle',type:'select',options:['90','180','270'],default:'90'},{id:'pages',label:'Pages (blank=all)',placeholder:'all',default:'all'}], useSelector:true, action:(f,v)=>api.rotatePDF(f[0],v.degrees||'90',v.pages||'all'), out:'rotated.pdf' },
  delete:       { title:'Delete Pages',      desc:'Remove unwanted pages.',                guide:'Click thumbnails or type page numbers to delete.', fields:[{id:'pages',label:'Pages to delete',placeholder:'e.g. 1,3'}], useSelector:true, action:(f,v)=>api.deletePages(f[0],v.pages||'1'), out:'output.pdf' },
  duplicate:    { title:'Duplicate Page',    desc:'Duplicate a page.',                     guide:'Enter the page number to duplicate.', fields:[{id:'page',label:'Page number',placeholder:'1',default:'1'}], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); form.append('page',v.page||'1'); return api._post('/tools/duplicate-page',form) }, out:'duplicated.pdf' },
  compress:     { title:'Compress PDF',      desc:'Reduce file size.',                     guide:'Just upload — no settings needed.', fields:[], action:(f)=>api.compressPDF(f[0]), out:'compressed.pdf', noPreview:true },
  repair:       { title:'Repair PDF',        desc:'Fix corrupted PDF files.',              guide:'Upload your damaged PDF.', fields:[], action:(f)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/repair',form) }, out:'repaired.pdf', noPreview:true },
  images:       { title:'PDF to Images',     desc:'Convert each page to PNG (ZIP).',       guide:'Each page becomes a PNG.', fields:[], action:(f)=>api.pdfToImages(f[0]), out:'pdf_images.zip', mime:'application/zip', noPreview:true },
  'image-to-pdf':{ title:'Images to PDF',   desc:'Convert images to a PDF.',              guide:'Upload images in order.', multi:true, accept:{'image/jpeg':['.jpg','.jpeg'],'image/png':['.png']}, fields:[], action:(f)=>api.imageToPDF(f), out:'from_images.pdf', noPreview:true },
  'pdf-to-word':{ title:'PDF to Word',       desc:'Convert to editable .docx.',            guide:'Upload PDF and download Word.', fields:[], action:(f)=>api.pdfToWord(f[0]), out:'converted.docx', mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', noPreview:true },
  'word-to-pdf':{ title:'Word to PDF',       desc:'Convert .docx to PDF.',                 guide:'Upload your Word file.', accept:{'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx']}, fields:[], action:(f)=>api.wordToPDF(f[0]), out:'converted.pdf', noPreview:true },
  'pptx-to-pdf':{ title:'PowerPoint to PDF', desc:'Convert .pptx to PDF.',                guide:'Each slide becomes a page.', accept:{'application/vnd.openxmlformats-officedocument.presentationml.presentation':['.pptx']}, fields:[], action:(f)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/pptx-to-pdf',form) }, out:'converted.pdf', noPreview:true },
  'xlsx-to-pdf':{ title:'Excel to PDF',      desc:'Convert .xlsx to PDF.',                 guide:'Each sheet becomes a page.', accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}, fields:[], action:(f)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/xlsx-to-pdf',form) }, out:'converted.pdf', noPreview:true },
  'html-to-pdf':{ title:'HTML to PDF',       desc:'Convert HTML file to PDF.',             guide:'Upload your .html file.', accept:{'text/html':['.html','.htm']}, fields:[], action:(f)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/html-to-pdf',form) }, out:'converted.pdf', noPreview:true },
  'pdf-to-jpg': { title:'PDF to JPG',        desc:'Convert pages to JPG (ZIP).',           guide:'Each page becomes a JPG.', fields:[], action:(f)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/pdf-to-jpg',form) }, out:'pdf_images_jpg.zip', mime:'application/zip', noPreview:true },
  'pdf-to-pptx':{ title:'PDF to PowerPoint', desc:'Convert pages to slides.',              guide:'Each page becomes a slide.', fields:[], action:(f)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/pdf-to-pptx',form) }, out:'converted.pptx', mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation', noPreview:true },
  'pdf-to-xlsx':{ title:'PDF to Excel',      desc:'Extract content to spreadsheet.',       guide:'Text placed into cells by position.', fields:[], action:(f)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/pdf-to-xlsx',form) }, out:'converted.xlsx', mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', noPreview:true },
  'pdf-to-pdfa':{ title:'PDF to PDF/A',      desc:'Convert to archive-standard.',          guide:'Creates a PDF/A-1b compliant file.', fields:[], action:(f)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/pdf-to-pdfa',form) }, out:'converted_pdfa.pdf', noPreview:true },
  pagenums:     { title:'Add Page Numbers',  desc:'Add page numbers to every page.',       guide:'Choose position.', fields:[{id:'position',label:'Position',type:'select',options:['bottom-center','bottom-right','top-center','top-right'],default:'bottom-center'}], action:(f,v)=>api.pageNumbersPDF(f[0],v.position||'bottom-center'), out:'numbered.pdf' },
  crop:         { title:'Crop PDF',          desc:'Trim margins from all pages.',          guide:'Enter margin amounts in points (1pt ≈ 0.35mm).', fields:[{id:'left',label:'Left',placeholder:'0',default:'0'},{id:'top',label:'Top',placeholder:'0',default:'0'},{id:'right',label:'Right',placeholder:'0',default:'0'},{id:'bottom',label:'Bottom',placeholder:'0',default:'0'}], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); Object.entries(v).forEach(([k,val])=>form.append(k,val||'0')); return api._post('/tools/crop',form) }, out:'cropped.pdf' },
  protect:      { title:'Protect PDF',       desc:'Lock with a password.',                 guide:'Enter a strong password — cannot be recovered.', fields:[{id:'password',label:'Password',placeholder:'Enter password',type:'password',tip:'Keep this safe'}], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); form.append('password',v.password||''); return api._post('/tools/protect',form) }, out:'protected.pdf', noPreview:true },
  unlock:       { title:'Unlock PDF',        desc:'Remove password protection.',           guide:'Enter the current password to unlock.', fields:[{id:'password',label:'Current password',placeholder:'Enter PDF password',type:'password'}], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); form.append('password',v.password||''); return api._post('/tools/unlock',form) }, out:'unlocked.pdf', noPreview:true },
  redact:       { title:'Redact Text',       desc:'Black out sensitive text permanently.', guide:'All occurrences blacked out permanently.', fields:[{id:'text',label:'Text to redact',placeholder:'e.g. John Smith',tip:'Cannot be undone'}], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); form.append('text',v.text||''); return api._post('/tools/redact',form) }, out:'redacted.pdf' },
  findreplace:  { title:'Find & Replace',    desc:'Search and replace text across PDF.',   guide:'Find and replace across all pages.', fields:[{id:'find',label:'Find',placeholder:'Text to find'},{id:'replace',label:'Replace with',placeholder:'Replacement text'},{id:'match_case',label:'Match case',type:'checkbox'},{id:'whole_word',label:'Whole word only',type:'checkbox'}], action:(f,v)=>api.findReplace(f[0],v.find||'',v.replace||'',v.match_case||false,v.whole_word||false), out:'replaced.pdf', noPreview:true },
}

function PageSidebar({ file, selectedPages, onSelectionChange }) {
  const [thumbs, setThumbs] = useState([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!file) { setThumbs([]); return }
    setLoading(true)
    const form = new FormData(); form.append('file', file)
    axios.post('/api/tools/thumbnails', form)
      .then(r => { setThumbs(r.data.thumbnails); setLoading(false) })
      .catch(() => setLoading(false))
  }, [file])
  const toggle    = n => { const s=new Set(selectedPages); s.has(n)?s.delete(n):s.add(n); onSelectionChange(s) }
  const selectAll  = () => onSelectionChange(new Set(thumbs.map(t=>t.page)))
  const selectNone = () => onSelectionChange(new Set())
  const selectOdd  = () => onSelectionChange(new Set(thumbs.filter(t=>t.page%2===1).map(t=>t.page)))
  const selectEven = () => onSelectionChange(new Set(thumbs.filter(t=>t.page%2===0).map(t=>t.page)))
  if (!file) return <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', color:'#b0b0cc', padding:'20px', textAlign:'center' }}><div style={{ fontSize:'28px', opacity:0.2, marginBottom:'8px' }}>📄</div><p style={{ fontSize:'12px' }}>Upload PDF to see pages</p></div>
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', display:'flex', gap:'4px', flexWrap:'wrap' }}>
        {[['All',selectAll],['None',selectNone],['Odd',selectOdd],['Even',selectEven]].map(([l,fn])=>(
          <button key={l} onClick={fn} style={{ fontSize:'10px', padding:'3px 7px', borderRadius:'5px', border:'1px solid var(--border)', background:'var(--bg3)', color:'#d0d0e8', cursor:'pointer' }}>{l}</button>
        ))}
        {selectedPages.size>0 && <span style={{ fontSize:'10px', color:'var(--accent2)', marginLeft:'auto', alignSelf:'center' }}>{selectedPages.size} sel.</span>}
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'8px', display:'flex', flexDirection:'column', gap:'6px' }}>
        {loading ? <div style={{ textAlign:'center', padding:'16px', color:'#b0b0cc', fontSize:'12px' }}><Loader2 size={16} className="spin" style={{ display:'block', margin:'0 auto 6px' }}/>Loading…</div>
        : thumbs.map(t => {
          const sel = selectedPages.has(t.page)
          return (
            <div key={t.page} onClick={()=>toggle(t.page)} style={{ cursor:'pointer', position:'relative', borderRadius:'7px', overflow:'hidden', border:`2px solid ${sel?'var(--accent)':'var(--border)'}`, boxShadow:sel?'0 0 0 2px rgba(108,99,255,0.3)':'none', transition:'all 0.12s' }}>
              <img src={t.img} alt={`p${t.page}`} style={{ width:'100%', display:'block' }}/>
              <div style={{ position:'absolute', top:'3px', right:'3px', width:'16px', height:'16px', borderRadius:'50%', background:sel?'var(--accent)':'rgba(0,0,0,0.55)', border:'2px solid #fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'9px', color:'#fff', fontWeight:700 }}>{sel?'✓':''}</div>
              <div style={{ textAlign:'center', fontSize:'9px', color:'#b0b0cc', padding:'2px 0', background:'var(--bg2)' }}>p.{t.page}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MultiFileSidebar({ files, onReorder, onRemove }) {
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', fontSize:'10px', fontWeight:700, color:'#b0b0cc', textTransform:'uppercase', letterSpacing:'.06em' }}>Files ({files.length})</div>
      <div style={{ flex:1, overflowY:'auto', padding:'8px', display:'flex', flexDirection:'column', gap:'6px' }}>
        {files.length===0 ? <div style={{ textAlign:'center', padding:'16px', color:'#b0b0cc', fontSize:'12px' }}><div style={{ fontSize:'24px', marginBottom:'6px', opacity:0.2 }}>📄</div>Upload PDFs to merge</div>
        : files.map((f,i) => (
          <div key={i} style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'7px', padding:'7px 8px', display:'flex', alignItems:'center', gap:'6px' }}>
            <span style={{ fontSize:'14px' }}>📄</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:'10px', color:'#ffffff', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</div>
              <div style={{ fontSize:'9px', color:'#b0b0cc' }}>{(f.size/1024).toFixed(0)} KB</div>
            </div>
            <div style={{ display:'flex', flexDirection:'column' }}>
              <button onClick={()=>{ if(i>0){const n=[...files];[n[i-1],n[i]]=[n[i],n[i-1]];onReorder(n)} }} disabled={i===0} style={{ background:'none', border:'none', color:i===0?'var(--border)':'#b0b0cc', cursor:i===0?'default':'pointer', fontSize:'11px', lineHeight:1.2 }}>▲</button>
              <button onClick={()=>{ if(i<files.length-1){const n=[...files];[n[i],n[i+1]]=[n[i+1],n[i]];onReorder(n)} }} disabled={i===files.length-1} style={{ background:'none', border:'none', color:i===files.length-1?'var(--border)':'#b0b0cc', cursor:i===files.length-1?'default':'pointer', fontSize:'11px', lineHeight:1.2 }}>▼</button>
            </div>
            <button onClick={()=>onRemove(i)} style={{ background:'none', border:'none', color:'#b0b0cc', cursor:'pointer', fontSize:'14px', lineHeight:1 }}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function PreviewPanel({ file, currentPage, totalPages, onPageChange, onTotalPages }) {
  const [thumbs, setThumbs] = useState([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!file) { setThumbs([]); onTotalPages?.(0); return }
    setLoading(true)
    const form = new FormData(); form.append('file', file)
    axios.post('/api/tools/thumbnails', form)
      .then(r => { setThumbs(r.data.thumbnails); setLoading(false); onTotalPages?.(r.data.count) })
      .catch(() => setLoading(false))
  }, [file])
  const thumb = thumbs.find(t => t.page === currentPage)
  if (!file) return <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#b0b0cc', background:'var(--bg3)' }}><div style={{ fontSize:'48px', opacity:0.1, marginBottom:'14px' }}>📄</div><p style={{ fontSize:'14px', fontWeight:600, color:'#d0d0e8' }}>Upload a PDF to preview</p></div>
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column' }}>
      {totalPages>1 && (
        <div style={{ padding:'8px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', gap:'12px', background:'var(--bg2)' }}>
          <button onClick={()=>onPageChange(Math.max(1,currentPage-1))} disabled={currentPage<=1} style={{ background:'none', border:'1px solid var(--border)', borderRadius:'6px', padding:'4px 8px', cursor:'pointer', color:'#d0d0e8', opacity:currentPage<=1?0.4:1 }}><ChevronLeft size={13}/></button>
          <span style={{ fontSize:'12px', color:'#d0d0e8' }}>Page {currentPage} of {totalPages}</span>
          <button onClick={()=>onPageChange(Math.min(totalPages,currentPage+1))} disabled={currentPage>=totalPages} style={{ background:'none', border:'1px solid var(--border)', borderRadius:'6px', padding:'4px 8px', cursor:'pointer', color:'#d0d0e8', opacity:currentPage>=totalPages?0.4:1 }}><ChevronRight size={13}/></button>
        </div>
      )}
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'24px', overflowY:'auto', background:'var(--bg3)' }}>
        {loading ? <div style={{ textAlign:'center', color:'#b0b0cc' }}><Loader2 size={24} className="spin" color="var(--accent)" style={{ display:'block', margin:'0 auto 10px' }}/><p style={{ fontSize:'13px' }}>Loading preview…</p></div>
        : thumb ? <img src={thumb.img} alt={`Page ${currentPage}`} style={{ maxWidth:'100%', maxHeight:'100%', boxShadow:'0 4px 32px rgba(0,0,0,0.4)', borderRadius:'3px', background:'#fff' }}/>
        : <p style={{ color:'#b0b0cc', fontSize:'13px' }}>No preview available</p>}
      </div>
    </div>
  )
}

export default function ToolPage({ toolId, onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const cfg = CONFIGS[toolId]
  const [files,         setFiles]         = useState([])
  const [vals,          setVals]          = useState(() => { const d={}; cfg?.fields?.forEach(f=>{ if(f.default) d[f.id]=f.default }); return d })
  const [status,        setStatus]        = useState('idle')
  const [errMsg,        setErrMsg]        = useState('')
  const [guide,         setGuide]         = useState(true)
  const [selectedPages, setSelectedPages] = useState(new Set())
  const [currentPage,   setCurrentPage]   = useState(1)
  const [totalPages,    setTotalPages]    = useState(0)

  const accept = cfg?.accept || {'application/pdf':['.pdf']}
  const onDrop = useCallback(a => { setFiles(prev => cfg?.multi ? [...prev,...a] : a); setSelectedPages(new Set()); setCurrentPage(1) }, [cfg])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept, maxFiles: cfg?.multi ? 20 : 1 })

  useEffect(() => {
    if (!cfg?.useSelector) return
    setVals(v => ({ ...v, pages: [...selectedPages].sort((a,b)=>a-b).join(',') }))
  }, [selectedPages])

  const run = async () => {
    if (!files.length) return
    setStatus('loading'); setErrMsg('')
    try {
      const res = await cfg.action(files, vals)
      api.downloadBlob(res.data, cfg.out, cfg.mime||'application/pdf')
      setStatus('done'); setTimeout(()=>setStatus('idle'), 3500)
    } catch(e) {
      setErrMsg(e.response?.data?.detail || e.message || 'Processing failed')
      setStatus('error')
    }
  }

  if (!cfg) return <div style={{ padding:'40px', color:'var(--red)' }}>Unknown tool: {toolId}</div>

  const inputFields    = cfg.fields.filter(f => f.type !== 'checkbox')
  const checkboxFields = cfg.fields.filter(f => f.type === 'checkbox')
  const isMerge        = toolId === 'merge'
  const showSplit      = !cfg.noPreview

  const DropZone = () => (
    <div {...getRootProps()} style={{ background:isDragActive?'rgba(91,91,214,0.06)':'var(--bg2)', border:`1px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'10px', padding:'24px 16px', textAlign:'center', cursor:'pointer', transition:'all 0.15s' }}>
      <input {...getInputProps()}/>
      <Upload size={16} color="var(--accent2)" style={{ display:'block', margin:'0 auto 7px' }}/>
      {isDragActive ? <p style={{ color:'var(--accent2)', fontWeight:600, fontSize:'13px' }}>Drop it!</p>
        : <><p style={{ color:'#ffffff', fontWeight:500, fontSize:'13px' }}>Drop {cfg.multi?'files':'file'} or <span style={{ color:'var(--accent2)' }}>browse</span></p>
           <p style={{ color:'#b0b0cc', fontSize:'11px', marginTop:'3px' }}>{cfg.multi?'Multiple PDFs':'PDF only'}</p></>}
    </div>
  )

  const Controls = () => (
    <div style={{ padding:'18px', display:'flex', flexDirection:'column', gap:'12px', overflowY:'auto', height:'100%' }}>
      {guide && cfg.guide && (
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'11px 13px', display:'flex', alignItems:'flex-start', gap:'8px' }}>
          <Info size={13} color="var(--accent2)" style={{ flexShrink:0, marginTop:'1px' }}/>
          <p style={{ fontSize:'12px', color:'#d0d0e8', lineHeight:1.55, flex:1 }}>{cfg.guide}</p>
          <button onClick={()=>setGuide(false)} style={{ background:'none', border:'none', color:'#b0b0cc', cursor:'pointer' }}><X size={12}/></button>
        </div>
      )}
      <DropZone/>
      {!isMerge && files.length>0 && (
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'8px 12px' }}>
          {files.map((f,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'5px 0', borderBottom:i<files.length-1?'1px solid var(--border)':'none' }}>
              <span style={{ fontSize:'12px', color:'#ffffff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>📄 {f.name}</span>
              <div style={{ display:'flex', gap:'8px', alignItems:'center', marginLeft:'8px', flexShrink:0 }}>
                <span style={{ fontSize:'11px', color:'#b0b0cc' }}>{(f.size/1024).toFixed(0)}KB</span>
                <button onClick={()=>setFiles(p=>p.filter((_,j)=>j!==i))} style={{ background:'none', border:'none', color:'#b0b0cc', cursor:'pointer', fontSize:'15px', lineHeight:1 }}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {cfg.useSelector && selectedPages.size>0 && (
        <div style={{ background:'rgba(108,99,255,0.08)', border:'1px solid rgba(108,99,255,0.2)', borderRadius:'8px', padding:'8px 12px', fontSize:'12px', color:'var(--accent2)' }}>
          Selected: {[...selectedPages].sort((a,b)=>a-b).join(', ')}
        </div>
      )}
      {inputFields.length>0 && (
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'13px', display:'flex', flexDirection:'column', gap:'11px' }}>
          {inputFields.map(field => (
            <div key={field.id}>
              <div style={{ display:'flex', alignItems:'center', gap:'5px', marginBottom:'4px' }}>
                <label style={{ fontSize:'12px', color:'#d0d0e8', fontWeight:500 }}>{field.label}</label>
                {field.tip && <span style={{ fontSize:'11px', color:'#b0b0cc' }}>— {field.tip}</span>}
              </div>
              {field.type==='select'
                ? <select value={vals[field.id]||field.default||''} onChange={e=>setVals(v=>({...v,[field.id]:e.target.value}))} style={{ width:'100%' }}>{field.options.map(o=><option key={o} value={o}>{o}</option>)}</select>
                : <input type={field.type||'text'} value={vals[field.id]||''} placeholder={field.placeholder} onChange={e=>setVals(v=>({...v,[field.id]:e.target.value}))} style={{ width:'100%' }}/>}
            </div>
          ))}
        </div>
      )}
      {checkboxFields.length>0 && (
        <div style={{ display:'flex', gap:'12px' }}>
          {checkboxFields.map(f => (
            <label key={f.id} style={{ display:'flex', alignItems:'center', gap:'6px', cursor:'pointer', fontSize:'12px', color:'#d0d0e8' }}>
              <input type="checkbox" checked={!!vals[f.id]} onChange={e=>setVals(v=>({...v,[f.id]:e.target.checked}))} style={{ width:'13px', height:'13px', accentColor:'var(--accent)' }}/>
              {f.label}
            </label>
          ))}
        </div>
      )}
      {status==='error' && (
        <div style={{ display:'flex', alignItems:'center', gap:'7px', background:'rgba(229,72,77,0.08)', border:'1px solid rgba(229,72,77,0.25)', borderRadius:'8px', padding:'9px 12px', fontSize:'12px', color:'var(--red)' }}>
          <AlertCircle size={12}/> {errMsg}
        </div>
      )}
      <button onClick={run} disabled={!files.length||status==='loading'}
        style={{ width:'100%', padding:'10px', fontSize:'13px', fontWeight:600, borderRadius:'9px', border:'none', cursor:!files.length?'not-allowed':'pointer', opacity:!files.length?0.45:1, display:'flex', alignItems:'center', justifyContent:'center', gap:'7px',
          background:status==='done'?'var(--green)':status==='loading'?'var(--bg3)':'var(--accent)',
          color:status==='loading'?'#d0d0e8':'#fff', boxShadow:files.length?'0 2px 12px rgba(91,91,214,0.3)':'none' }}>
        {status==='loading'?<><Loader2 size={13} className="spin"/>Processing…</>:status==='done'?<><CheckCircle size={13}/>Downloaded!</>:<><Download size={13}/>{cfg.title}</>}
      </button>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column' }}>
      <TopBar onBack={onBack} title={cfg.title} subtitle={cfg.desc} dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory} onCategoryChange={onCategoryChange}
        search={search} onSearch={onSearch}/>

      {showSplit ? (
        <div style={{ display:'flex', flex:1, height:'calc(100vh - 52px)', overflow:'hidden' }}>
          {/* Left sidebar */}
          <div style={{ width:'150px', flexShrink:0, borderRight:'1px solid var(--border)', background:'var(--bg2)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', fontSize:'10px', fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'#b0b0cc' }}>
              {isMerge ? 'Files' : 'Pages'}
            </div>
            <div style={{ flex:1, overflow:'hidden' }}>
              {isMerge
                ? <MultiFileSidebar files={files} onReorder={setFiles} onRemove={i=>setFiles(p=>p.filter((_,j)=>j!==i))}/>
                : <PageSidebar file={files[0]} selectedPages={selectedPages} onSelectionChange={setSelectedPages}/>}
            </div>
          </div>
          {/* Center controls */}
          <div style={{ width:'300px', flexShrink:0, borderRight:'1px solid var(--border)', overflow:'hidden' }}>
            <Controls/>
          </div>
          {/* Right preview */}
          <div style={{ flex:1, overflow:'hidden' }}>
            <PreviewPanel file={files[0]} currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} onTotalPages={setTotalPages}/>
          </div>
        </div>
      ) : (
        /* Single column for convert/no-preview tools */
        <div style={{ maxWidth:'560px', margin:'36px auto', padding:'0 24px', width:'100%', display:'flex', flexDirection:'column', gap:'12px' }}>
          {guide && cfg.guide && (
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'12px 16px', display:'flex', alignItems:'flex-start', gap:'10px' }}>
              <Info size={14} color="var(--accent2)" style={{ flexShrink:0, marginTop:'1px' }}/>
              <p style={{ fontSize:'13px', color:'#d0d0e8', lineHeight:1.55, flex:1 }}>{cfg.guide}</p>
              <button onClick={()=>setGuide(false)} style={{ background:'none', border:'none', color:'#b0b0cc', cursor:'pointer' }}><X size={13}/></button>
            </div>
          )}
          <DropZone/>
          {files.length>0 && (
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'8px 14px' }}>
              {files.map((f,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 0', borderBottom:i<files.length-1?'1px solid var(--border)':'none' }}>
                  <span style={{ fontSize:'13px', color:'#ffffff' }}>📄 {f.name}</span>
                  <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
                    <span style={{ fontSize:'12px', color:'#b0b0cc' }}>{(f.size/1024).toFixed(0)} KB</span>
                    <button onClick={()=>setFiles(p=>p.filter((_,j)=>j!==i))} style={{ background:'none', border:'none', color:'#b0b0cc', cursor:'pointer', fontSize:'16px' }}>×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {inputFields.length>0 && (
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'16px', display:'flex', flexDirection:'column', gap:'14px' }}>
              {inputFields.map(field => (
                <div key={field.id}>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'5px' }}>
                    <label style={{ fontSize:'12px', color:'#d0d0e8', fontWeight:500 }}>{field.label}</label>
                    {field.tip && <span style={{ fontSize:'11px', color:'#b0b0cc' }}>— {field.tip}</span>}
                  </div>
                  {field.type==='select'
                    ? <select value={vals[field.id]||field.default||''} onChange={e=>setVals(v=>({...v,[field.id]:e.target.value}))} style={{ width:'100%' }}>{field.options.map(o=><option key={o} value={o}>{o}</option>)}</select>
                    : <input type={field.type||'text'} value={vals[field.id]||''} placeholder={field.placeholder} onChange={e=>setVals(v=>({...v,[field.id]:e.target.value}))} style={{ width:'100%' }}/>}
                </div>
              ))}
            </div>
          )}
          {status==='error' && (
            <div style={{ display:'flex', alignItems:'center', gap:'8px', background:'rgba(229,72,77,0.08)', border:'1px solid rgba(229,72,77,0.25)', borderRadius:'8px', padding:'10px 14px', fontSize:'13px', color:'var(--red)' }}>
              <AlertCircle size={13}/> {errMsg}
            </div>
          )}
          <button onClick={run} disabled={!files.length||status==='loading'}
            style={{ width:'100%', padding:'11px', fontSize:'14px', fontWeight:600, borderRadius:'9px', border:'none', cursor:!files.length?'not-allowed':'pointer', opacity:!files.length?0.45:1, display:'flex', alignItems:'center', justifyContent:'center', gap:'8px',
              background:status==='done'?'var(--green)':'var(--accent)', color:'#fff', boxShadow:files.length?'0 2px 12px rgba(91,91,214,0.3)':'none' }}>
            {status==='loading'?<><Loader2 size={14} className="spin"/>Processing…</>:status==='done'?<><CheckCircle size={14}/>Downloaded!</>:<><Upload size={14}/>{cfg.title}</>}
          </button>
        </div>
      )}
    </div>
  )
}
