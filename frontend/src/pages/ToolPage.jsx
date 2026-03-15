import React, { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { ArrowLeft, Upload, Loader2, CheckCircle, AlertCircle, Info, X } from 'lucide-react'
import PageSelector from '../components/PageSelector'
import * as api from '../utils/api'

const CONFIGS = {
  merge:        { title:'Merge PDFs',      desc:'Combine multiple PDFs into one document.',            multi:true,  guide:'Upload 2 or more PDFs. They will merge in the order shown.', fields:[], action:(f,v)=>api.mergePDFs(f), out:'merged.pdf' },
  split:        { title:'Split PDF',       desc:'Extract a range of pages into a new PDF.',            guide:'Select pages by clicking thumbnails, or type a range like 1-3,5.', fields:[{id:'pages',label:'Page range',placeholder:'e.g. 1-3,5,7',tip:'Use commas and dashes'}], useSelector:true, action:(f,v)=>api.splitPDF(f[0],v.pages), out:'split.pdf' },
  extract:      { title:'Extract Pages',   desc:'Pull specific pages into a new PDF.',                 guide:'Click the page thumbnails you want to extract.',fields:[{id:'pages',label:'Pages',placeholder:'e.g. 1,3,5'}], useSelector:true, action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); form.append('pages',v.pages); return api._post('/tools/extract',form) }, out:'extracted.pdf' },
  rotate:       { title:'Rotate Pages',    desc:'Rotate PDF pages to any angle.',                      guide:'Select pages to rotate and choose the angle.',fields:[{id:'degrees',label:'Angle',type:'select',options:['90','180','270'],default:'90'},{id:'pages',label:'Pages',placeholder:'all',default:'all'}], useSelector:true, action:(f,v)=>api.rotatePDF(f[0],v.degrees||'90',v.pages||'all'), out:'rotated.pdf' },
  delete:       { title:'Delete Pages',    desc:'Remove unwanted pages from your PDF.',                guide:'Click page thumbnails to mark them for deletion.',fields:[{id:'pages',label:'Pages to delete',placeholder:'e.g. 1,3'}], useSelector:true, action:(f,v)=>api.deletePages(f[0],v.pages), out:'output.pdf' },
  duplicate:    { title:'Duplicate Page',  desc:'Duplicate a page and insert it after the original.', guide:'Enter the page number to duplicate.',fields:[{id:'page',label:'Page number',placeholder:'1',default:'1'}], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); form.append('page',v.page||'1'); return api._post('/tools/duplicate-page',form) }, out:'duplicated.pdf' },
  compress:     { title:'Compress PDF',    desc:'Reduce file size while keeping quality.',             guide:'Just upload and compress — no settings needed.',fields:[], action:(f,v)=>api.compressPDF(f[0]), out:'compressed.pdf' },
  repair:       { title:'Repair PDF',      desc:'Fix corrupted or broken PDF files.',                  guide:'Upload your damaged PDF and download the repaired version.',fields:[], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/repair',form) }, out:'repaired.pdf' },
  images:       { title:'PDF to Images',   desc:'Convert each page to PNG. Downloads as ZIP.',         guide:'Upload your PDF — each page becomes a PNG image.',fields:[], action:(f,v)=>api.pdfToImages(f[0]), out:'pdf_images.zip', mime:'application/zip' },
  'image-to-pdf':{ title:'Images to PDF',  desc:'Convert JPG/PNG images into a PDF.',                 guide:'Upload one or more images. They become pages in order.',multi:true, accept:{'image/jpeg':['.jpg','.jpeg'],'image/png':['.png']}, fields:[], action:(f,v)=>api.imageToPDF(f), out:'from_images.pdf' },
  'pdf-to-word':{ title:'PDF to Word',     desc:'Convert PDF text to an editable .docx file.',        guide:'Upload your PDF and download the Word document.',fields:[], action:(f,v)=>api.pdfToWord(f[0]), out:'converted.docx', mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  'word-to-pdf':{ title:'Word to PDF',     desc:'Convert a .docx document to PDF.',                   guide:'Upload your Word file and download the PDF.',accept:{'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx']}, fields:[], action:(f,v)=>api.wordToPDF(f[0]), out:'converted.pdf' },
  'pptx-to-pdf':{ title:'PowerPoint to PDF', desc:'Convert a .pptx presentation to PDF.',             guide:'Upload your PowerPoint file. Each slide becomes a page.', accept:{'application/vnd.openxmlformats-officedocument.presentationml.presentation':['.pptx']}, fields:[], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/pptx-to-pdf',form) }, out:'converted.pdf' },
  'xlsx-to-pdf':{ title:'Excel to PDF',     desc:'Convert a .xlsx spreadsheet to PDF.',               guide:'Upload your Excel file. Each sheet becomes a page.', accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}, fields:[], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/xlsx-to-pdf',form) }, out:'converted.pdf' },
  'html-to-pdf':{ title:'HTML to PDF',      desc:'Convert an HTML file to PDF.',                      guide:'Upload your .html file. Links and basic styles are preserved.', accept:{'text/html':['.html','.htm']}, fields:[], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/html-to-pdf',form) }, out:'converted.pdf' },
  'pdf-to-jpg':{ title:'PDF to JPG',        desc:'Convert PDF pages to JPG images (ZIP).',            guide:'Each page becomes a JPG. Download as ZIP file.', fields:[], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/pdf-to-jpg',form) }, out:'pdf_images_jpg.zip', mime:'application/zip' },
  'pdf-to-pptx':{ title:'PDF to PowerPoint', desc:'Convert PDF pages to PowerPoint slides.',          guide:'Each PDF page becomes a slide. Download as .pptx.', fields:[], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/pdf-to-pptx',form) }, out:'converted.pptx', mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  'pdf-to-xlsx':{ title:'PDF to Excel',     desc:'Extract PDF content into an Excel spreadsheet.',    guide:'Text is extracted and placed into cells by position.', fields:[], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/pdf-to-xlsx',form) }, out:'converted.xlsx', mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  'pdf-to-pdfa':{ title:'PDF to PDF/A',     desc:'Convert to archive-standard PDF/A format.',         guide:'Creates a PDF/A-1b compliant file for long-term archiving.', fields:[], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/pdf-to-pdfa',form) }, out:'converted_pdfa.pdf' },
  pagenums:     { title:'Add Page Numbers',desc:'Add page numbers to every page.',                    guide:'Choose position and click Add Page Numbers.',fields:[{id:'position',label:'Position',type:'select',options:['bottom-center','bottom-right','top-center','top-right'],default:'bottom-center'}], action:(f,v)=>api.pageNumbersPDF(f[0],v.position||'bottom-center'), out:'numbered.pdf' },
  crop:         { title:'Crop PDF',        desc:'Trim margins from all pages.',                        guide:'Enter margin amounts in points (1pt ≈ 0.35mm).',fields:[{id:'left',label:'Left',placeholder:'0',default:'0'},{id:'top',label:'Top',placeholder:'0',default:'0'},{id:'right',label:'Right',placeholder:'0',default:'0'},{id:'bottom',label:'Bottom',placeholder:'0',default:'0'}], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); Object.entries(v).forEach(([k,val])=>form.append(k,val||'0')); return api._post('/tools/crop',form) }, out:'cropped.pdf' },
  protect:      { title:'Protect PDF',     desc:'Lock your PDF with a password.',                      guide:'Enter a strong password and keep it safe — it cannot be recovered.',fields:[{id:'password',label:'Password',placeholder:'Enter password',type:'password',tip:'Keep this safe — lost passwords cannot be recovered'}], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); form.append('password',v.password); return api._post('/tools/protect',form) }, out:'protected.pdf' },
  unlock:       { title:'Unlock PDF',      desc:'Remove password protection from a PDF.',              guide:'Enter the current password to unlock the file.',fields:[{id:'password',label:'Current password',placeholder:'Enter PDF password',type:'password'}], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); form.append('password',v.password||''); return api._post('/tools/unlock',form) }, out:'unlocked.pdf' },
  redact:       { title:'Redact Text',     desc:'Permanently black out sensitive text.',               guide:'Enter the exact text to redact. All occurrences will be blacked out permanently.',fields:[{id:'text',label:'Text to redact',placeholder:'e.g. John Smith',tip:'This cannot be undone'}], action:(f,v)=>{ const form=new FormData(); form.append('file',f[0]); form.append('text',v.text||''); return api._post('/tools/redact',form) }, out:'redacted.pdf' },
  findreplace:  { title:'Find & Replace',  desc:'Search and replace text across the entire PDF.',      guide:'Enter the text to find and what to replace it with.',fields:[{id:'find',label:'Find',placeholder:'Text to find'},{id:'replace',label:'Replace with',placeholder:'Replacement text'},{id:'match_case',label:'Match case',type:'checkbox'},{id:'whole_word',label:'Whole word only',type:'checkbox'}], action:(f,v)=>api.findReplace(f[0],v.find,v.replace||'',v.match_case||false,v.whole_word||false), out:'replaced.pdf' },
}

export default function ToolPage({ toolId, onBack }) {
  const cfg = CONFIGS[toolId]
  const [files,  setFiles]  = useState([])
  const [vals,   setVals]   = useState(() => { const d={}; cfg?.fields?.forEach(f=>{ if(f.default) d[f.id]=f.default }); return d })
  const [status, setStatus] = useState('idle')
  const [errMsg, setErrMsg] = useState('')
  const [guide,  setGuide]  = useState(true)

  const accept = cfg?.accept || {'application/pdf':['.pdf']}
  const onDrop = useCallback(a => setFiles(prev => cfg?.multi ? [...prev,...a] : a), [cfg])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept, maxFiles:cfg?.multi?20:1 })

  const run = async () => {
    if (!files.length) return
    setStatus('loading'); setErrMsg('')
    try {
      const res = await cfg.action(files, vals)
      api.downloadBlob(res.data, cfg.out, cfg.mime||'application/pdf')
      setStatus('done'); setTimeout(()=>setStatus('idle'),3500)
    } catch(e) {
      const msg = e.response?.data?.detail || e.message || 'Processing failed'
      setErrMsg(msg); setStatus('error')
    }
  }

  if (!cfg) return <div style={{padding:'40px',color:'var(--red)'}}>Unknown tool: {toolId}</div>

  const checkboxFields = cfg.fields.filter(f=>f.type==='checkbox')
  const inputFields    = cfg.fields.filter(f=>f.type!=='checkbox')

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>

      {/* Header */}
      <header style={{ height:'52px', padding:'0 24px', display:'flex', alignItems:'center', gap:'12px', borderBottom:'1px solid var(--border)', background:'rgba(15,15,19,0.98)', backdropFilter:'blur(12px)', position:'sticky', top:0, zIndex:50 }}>
        <button onClick={onBack} className="btn btn-ghost" style={{ padding:'5px 10px' }}>
          <ArrowLeft size={13}/> Back
        </button>
        <div style={{ width:'1px', height:'16px', background:'var(--border)' }}/>
        <span style={{ fontWeight:600, color:'var(--text)' }}>{cfg.title}</span>
        <span style={{ color:'var(--text3)', fontSize:'13px' }}>{cfg.desc}</span>
      </header>

      <div style={{ maxWidth:'600px', margin:'40px auto', padding:'0 24px' }}>

        {/* Guide */}
        {guide && cfg.guide && (
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'12px 16px', marginBottom:'20px', display:'flex', alignItems:'flex-start', gap:'10px' }}>
            <Info size={14} color="var(--accent2)" style={{ flexShrink:0, marginTop:'1px' }}/>
            <p style={{ fontSize:'13px', color:'var(--text2)', lineHeight:1.55, flex:1 }}>{cfg.guide}</p>
            <button onClick={()=>setGuide(false)} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', padding:0, flexShrink:0 }}><X size={13}/></button>
          </div>
        )}

        {/* Drop zone */}
        <div {...getRootProps()} style={{ background:isDragActive?'rgba(91,91,214,0.06)':'var(--bg2)', border:`1px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'10px', padding:'36px 24px', textAlign:'center', cursor:'pointer', transition:'all 0.15s', marginBottom:'16px' }}>
          <input {...getInputProps()}/>
          <div style={{ width:'40px', height:'40px', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px' }}>
            <Upload size={18} color="var(--accent2)"/>
          </div>
          {isDragActive
            ? <p style={{ color:'var(--accent2)', fontWeight:600 }}>Drop it!</p>
            : <><p style={{ color:'var(--text)', fontWeight:500 }}>Drop {cfg.multi?'files':'file'} here or <span style={{ color:'var(--accent2)' }}>browse</span></p>
               <p style={{ color:'var(--text3)', fontSize:'12px', marginTop:'4px' }}>{cfg.multi?'Multiple files':'PDF only'}</p></>}
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'8px 14px', marginBottom:'14px' }}>
            {files.map((f,i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 0', borderBottom:i<files.length-1?'1px solid var(--border)':'none' }}>
                <span style={{ fontSize:'13px', color:'var(--text)' }}>📄 {f.name}</span>
                <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
                  <span style={{ fontSize:'12px', color:'var(--text3)' }}>{(f.size/1024).toFixed(0)} KB</span>
                  <button onClick={()=>setFiles(p=>p.filter((_,j)=>j!==i))} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:'16px', lineHeight:1 }}>×</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Page selector */}
        {cfg.useSelector && files.length > 0 && (
          <div style={{ marginBottom:'14px' }}>
            <p style={{ fontSize:'12px', color:'var(--text2)', fontWeight:500, marginBottom:'8px' }}>Select pages:</p>
            <PageSelector file={files[0]} onChange={sel => setVals(v=>({...v, pages:sel}))}/>
          </div>
        )}

        {/* Input fields */}
        {inputFields.length > 0 && (
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'16px', marginBottom:'14px', display:'flex', flexDirection:'column', gap:'14px' }}>
            {inputFields.map(field => (
              <div key={field.id}>
                <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'5px' }}>
                  <label style={{ fontSize:'12px', color:'var(--text2)', fontWeight:500 }}>{field.label}</label>
                  {field.tip && <span style={{ fontSize:'11px', color:'var(--text3)' }}>— {field.tip}</span>}
                </div>
                {field.type==='select' ? (
                  <select value={vals[field.id]||field.default||''} onChange={e=>setVals(v=>({...v,[field.id]:e.target.value}))}
                    style={{ width:'100%' }}>
                    {field.options.map(o=><option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={field.type||'text'} value={vals[field.id]||''} placeholder={field.placeholder}
                    onChange={e=>setVals(v=>({...v,[field.id]:e.target.value}))}
                    style={{ width:'100%' }}/>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Checkboxes */}
        {checkboxFields.length > 0 && (
          <div style={{ display:'flex', gap:'16px', marginBottom:'14px' }}>
            {checkboxFields.map(f => (
              <label key={f.id} style={{ display:'flex', alignItems:'center', gap:'7px', cursor:'pointer', fontSize:'13px', color:'var(--text2)' }}>
                <input type="checkbox" checked={!!vals[f.id]} onChange={e=>setVals(v=>({...v,[f.id]:e.target.checked}))}
                  style={{ width:'14px', height:'14px', accentColor:'var(--accent)' }}/>
                {f.label}
              </label>
            ))}
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div style={{ display:'flex', alignItems:'center', gap:'8px', background:'rgba(229,72,77,0.08)', border:'1px solid rgba(229,72,77,0.25)', borderRadius:'8px', padding:'10px 14px', marginBottom:'14px', fontSize:'13px', color:'var(--red)' }}>
            <AlertCircle size={13}/> {errMsg}
          </div>
        )}

        {/* Action button */}
        <button onClick={run} disabled={!files.length||status==='loading'}
          className="btn btn-primary"
          style={{ width:'100%', padding:'11px', fontSize:'14px', fontWeight:600, opacity:!files.length?0.45:1, cursor:!files.length?'not-allowed':'pointer', boxShadow:files.length?'0 2px 12px rgba(91,91,214,0.3)':'none' }}>
          {status==='loading' ? <><Loader2 size={14} className="spin"/> Processing…</>
           : status==='done'  ? <><CheckCircle size={14}/> Downloaded!</>
           :                    <><Upload size={14}/> {cfg.title}</>}
        </button>
      </div>
    </div>
  )
}
