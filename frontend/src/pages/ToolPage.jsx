import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Loader2, CheckCircle, AlertCircle, Info, X, Download,
         RotateCw, Trash2, Copy, ZoomIn } from 'lucide-react'
import TopBar from '../components/TopBar'
import * as api from '../utils/api'
import { getThumbnailsProgressive, getFullResPage } from '../utils/thumbCache'
import { clientExtract, clientDuplicatePage, clientDeletePages } from '../utils/pdfClient'
import { clientPdfToImages, clientPdfToJpg } from '../utils/pdfToImageClient'
import axios from 'axios'

const CONFIGS = {
  merge:        { title:'Merge PDFs',        desc:'Combine multiple PDFs into one.',       multi:true,  guide:'Upload 2+ PDFs. Drag arrows to reorder.', fields:[], action:(f)=>api.mergePDFs(f), out:'merged.pdf', clientSide:true },
  split:        { title:'Split PDF',         desc:'Extract a range of pages.',             guide:'Select pages visually or type a range like 1-3,5.', fields:[{id:'pages',label:'Page range',placeholder:'e.g. 1-3,5,7',tip:'Commas and dashes'}], useSelector:true, action:(f,v)=>api.splitPDF(f[0],v.pages||'1'), out:'split.pdf', clientSide:true },
  extract:      { title:'Extract Pages',     desc:'Pull specific pages into a new PDF.',   guide:'Click thumbnails or type page numbers.', fields:[{id:'pages',label:'Pages',placeholder:'e.g. 1,3,5'}], useSelector:true, action:(f,v)=>clientExtract(f[0],v.pages||'1'), out:'extracted.pdf', clientSide:true },
  rotate:       { title:'Rotate Pages',      desc:'Rotate PDF pages.',                     guide:'Select pages and choose angle. Leave blank to rotate all.', fields:[{id:'degrees',label:'Angle',type:'select',options:['90','180','270'],default:'90'},{id:'pages',label:'Pages (blank=all)',placeholder:'all',default:'all'}], useSelector:true, action:(f,v)=>api.rotatePDF(f[0],v.degrees||'90',v.pages||'all'), out:'rotated.pdf', clientSide:true },
  delete:       { title:'Delete Pages',      desc:'Remove unwanted pages.',                guide:'Click thumbnails or type page numbers to delete.', fields:[{id:'pages',label:'Pages to delete',placeholder:'e.g. 1,3'}], useSelector:true, action:(f,v)=>api.deletePages(f[0],v.pages||'1'), out:'output.pdf', clientSide:true },
  duplicate:    { title:'Duplicate Page',    desc:'Duplicate a page.',                     guide:'Enter the page number to duplicate.', fields:[{id:'page',label:'Page number',placeholder:'1',default:'1'}], action:(f,v)=>clientDuplicatePage(f[0],v.page||'1'), out:'duplicated.pdf', clientSide:true },
  compress:     { title:'Compress PDF',      desc:'Reduce file size.',                     guide:'Just upload — no settings needed.', fields:[], action:(f)=>api.compressPDF(f[0]), out:'compressed.pdf', noPreview:true, clientSide:true },
  repair:       { title:'Repair PDF',        desc:'Fix corrupted PDF files.',              guide:'Upload your damaged PDF.', fields:[], action:(f)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/repair',form) }, out:'repaired.pdf', noPreview:true },
  images:       { title:'PDF to Images',     desc:'Convert each page to PNG (ZIP).',       guide:'Each page becomes a PNG.', fields:[], action:(f,v,onP)=>clientPdfToImages(f[0],onP), out:'pdf_images.zip', mime:'application/zip', noPreview:true, clientSide:true },
  'image-to-pdf':{ title:'Images to PDF',   desc:'Convert images to a PDF.',              guide:'Upload images in order.', multi:true, accept:{'image/jpeg':['.jpg','.jpeg'],'image/png':['.png']}, fields:[], action:(f)=>api.imageToPDF(f), out:'from_images.pdf', noPreview:true },
  'pdf-to-word':{ title:'PDF to Word',       desc:'Convert to editable .docx.',            guide:'Upload PDF and download Word.', fields:[], action:(f)=>api.pdfToWord(f[0]), out:'converted.docx', mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', noPreview:true },
  'word-to-pdf':{ title:'Word to PDF',       desc:'Convert .docx to PDF.',                 guide:'Upload your Word file.', accept:{'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx']}, fields:[], action:(f)=>api.wordToPDF(f[0]), out:'converted.pdf', noPreview:true },
  'pptx-to-pdf':{ title:'PowerPoint to PDF', desc:'Convert .pptx to PDF.',                guide:'Each slide becomes a page.', accept:{'application/vnd.openxmlformats-officedocument.presentationml.presentation':['.pptx']}, fields:[], action:(f)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/pptx-to-pdf',form) }, out:'converted.pdf', noPreview:true },
  'xlsx-to-pdf':{ title:'Excel to PDF',      desc:'Convert .xlsx to PDF.',                 guide:'Each sheet becomes a page.', accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}, fields:[], action:(f)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/xlsx-to-pdf',form) }, out:'converted.pdf', noPreview:true },
  'html-to-pdf':{ title:'HTML to PDF',       desc:'Convert HTML file to PDF.',             guide:'Upload your .html file.', accept:{'text/html':['.html','.htm']}, fields:[], action:(f)=>{ const form=new FormData(); form.append('file',f[0]); return api._post('/tools/html-to-pdf',form) }, out:'converted.pdf', noPreview:true },
  'pdf-to-jpg': { title:'PDF to JPG',        desc:'Convert pages to JPG (ZIP).',           guide:'Each page becomes a JPG.', fields:[], action:(f,v,onP)=>clientPdfToJpg(f[0],onP), out:'pdf_images_jpg.zip', mime:'application/zip', noPreview:true, clientSide:true },
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


// ── Tools that get the new unified grid view ───────────────────────────
const GRID_TOOLS = new Set(['split','extract','delete','duplicate'])

// ── MultiFileSidebar ──────────────────────────────────────────────────
function MultiFileSidebar({ files, onReorder, onRemove, dropZoneJSX, onRun, status }) {
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', fontSize:'10px', fontWeight:700, color:'#b0b0cc', textTransform:'uppercase', letterSpacing:'.06em' }}>Files to merge ({files.length})</div>
      <div style={{ flex:1, overflowY:'auto', padding:'10px', display:'flex', flexDirection:'column', gap:'8px' }}>
        {dropZoneJSX}
        {files.length === 0 ? (
          <div style={{ textAlign:'center', padding:'12px', color:'#b0b0cc', fontSize:'12px' }}>
            <div style={{ fontSize:'22px', marginBottom:'5px', opacity:0.2 }}>📄</div>
            Drop 2+ PDFs above to merge
          </div>
        ) : (
          files.map((f, i) => (
            <div key={i} style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'7px', padding:'7px 8px', display:'flex', alignItems:'center', gap:'6px' }}>
              <span style={{ fontSize:'13px' }}>📄</span>
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
          ))
        )}
        {files.length >= 2 && (
          <button onClick={onRun} disabled={status==='loading'}
            style={{ width:'100%', padding:'10px', fontSize:'13px', fontWeight:600, borderRadius:'9px', border:'none',
              cursor:status==='loading'?'not-allowed':'pointer', marginTop:'4px',
              display:'flex', alignItems:'center', justifyContent:'center', gap:'7px',
              background:status==='done'?'var(--green)':status==='loading'?'var(--bg3)':'var(--accent)',
              color:status==='loading'?'#d0d0e8':'#fff',
              boxShadow:status!=='loading'?'0 2px 12px rgba(91,91,214,0.3)':'none' }}>
            {status==='loading'?'Merging…':status==='done'?'✓ Downloaded!':'Merge '+files.length+' PDFs'}
          </button>
        )}
        {files.length === 1 && (
          <p style={{ fontSize:'11px', color:'#b0b0cc', textAlign:'center', margin:0 }}>Add at least one more PDF</p>
        )}
      </div>
    </div>
  )
}

// ── ZoomModal — full-screen high-res page view ─────────────────────────
function ZoomModal({ file, pageNum, onClose }) {
  const [imgSrc,  setImgSrc]  = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!file || !pageNum) return
    setLoading(true)
    getFullResPage(file, pageNum, 1.8)
      .then(t => { setImgSrc(t.img); setLoading(false) })
      .catch(() => setLoading(false))
  }, [file, pageNum])

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.85)',
        display:'flex', alignItems:'center', justifyContent:'center',
        backdropFilter:'blur(4px)', padding:'24px' }}>
      <div style={{ position:'relative', maxWidth:'90vw', maxHeight:'92vh', display:'flex', flexDirection:'column', gap:'10px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:'13px', color:'#b0b0cc', fontWeight:600 }}>Page {pageNum} — Full Resolution</span>
          <button onClick={onClose}
            style={{ background:'#1e1e2e', border:'1px solid #252538', borderRadius:'8px',
              padding:'5px 12px', color:'#9898b8', cursor:'pointer', fontSize:'12px', display:'flex', alignItems:'center', gap:'5px' }}>
            <X size={12}/> Close
          </button>
        </div>
        {loading
          ? <div style={{ width:'500px', height:'600px', display:'flex', alignItems:'center', justifyContent:'center', color:'#b0b0cc' }}>
              <Loader2 size={28} color="var(--accent)" className="spin"/>
            </div>
          : <img src={imgSrc} alt={`Page ${pageNum}`}
              style={{ maxWidth:'85vw', maxHeight:'85vh', objectFit:'contain',
                boxShadow:'0 8px 60px rgba(0,0,0,0.8)', borderRadius:'4px', background:'#fff' }}/>
        }
      </div>
    </div>
  )
}

// ── UnifiedPageGrid — the new combined grid with hover actions ─────────
function UnifiedPageGrid({ file, toolId, selectedPages, onSelectionChange, onPageAction, pageRotations = {}, deletedPages = new Set(), duplicatedAfter = {} }) {
  const [thumbs,  setThumbs]  = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!file) { setThumbs([]); return }
    setLoading(true); setThumbs([])
    let first = true
    getThumbnailsProgressive(file, (thumb) => {
      if (first) { setLoading(false); first = false }
      if (thumb.img) setThumbs(prev => [...prev, thumb])
    }, 5).catch(() => setLoading(false))
  }, [file])

  const toggle = (page) => {
    const s = new Set(selectedPages)
    s.has(page) ? s.delete(page) : s.add(page)
    onSelectionChange(s)
  }
  const selectAll  = () => onSelectionChange(new Set(thumbs.map(t => t.page)))
  const selectNone = () => onSelectionChange(new Set())
  const selectOdd  = () => onSelectionChange(new Set(thumbs.filter(t => t.page % 2 === 1).map(t => t.page)))
  const selectEven = () => onSelectionChange(new Set(thumbs.filter(t => t.page % 2 === 0).map(t => t.page)))

  if (!file) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#b0b0cc' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:'40px', opacity:0.15, marginBottom:'12px' }}>📄</div>
        <p style={{ fontSize:'13px' }}>Upload a PDF to see pages</p>
      </div>
    </div>
  )

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <style>{`
        .pdf-card { transition: transform 0.12s; }
        .pdf-card:hover { transform: translateY(-2px); }

        .pdf-thumb {
          border-radius: 8px;
          overflow: hidden;
          background: var(--bg3);
          border: 2px solid var(--border);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          transition: border-color 0.12s, box-shadow 0.12s;
          position: relative;
        }
        .pdf-card:hover .pdf-thumb {
          border-color: rgba(108,99,255,0.6);
          box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        }
        .pdf-thumb-selected {
          border-color: var(--accent) !important;
          box-shadow: 0 0 0 3px rgba(108,99,255,0.25) !important;
        }

        .pdf-actions {
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.1s;
        }
        .pdf-card:hover .pdf-actions {
          opacity: 1;
          pointer-events: all;
        }
      `}</style>
      {/* Selection toolbar */}
      <div style={{ padding:'8px 16px', borderBottom:'1px solid var(--border)', background:'var(--bg2)',
        display:'flex', alignItems:'center', gap:'6px', flexShrink:0 }}>
        <span style={{ fontSize:'11px', color:'#b0b0cc', fontWeight:600, marginRight:'4px' }}>Select:</span>
        {[['All', selectAll],['None', selectNone],['Odd', selectOdd],['Even', selectEven]].map(([l, fn]) => (
          <button key={l} onClick={fn}
            style={{ fontSize:'11px', padding:'3px 9px', borderRadius:'5px',
              border:'1px solid var(--border)', background:'var(--bg3)', color:'#d0d0e8', cursor:'pointer' }}>
            {l}
          </button>
        ))}
        {selectedPages.size > 0 && (
          <span style={{ fontSize:'11px', color:'var(--accent2)', marginLeft:'auto', fontWeight:600 }}>
            {selectedPages.size} selected
          </span>
        )}
        {loading && <Loader2 size={13} color="var(--accent)" className="spin" style={{ marginLeft:'auto' }}/>}
      </div>

      {/* Scrollable grid */}
      <div style={{ flex:1, overflowY:'auto', padding:'20px',
        display:'flex', flexWrap:'wrap', gap:'14px', alignContent:'flex-start' }}>
        {/* Build visible list: filter deleted, insert duplicates after original */}
        {thumbs
          .filter(t => !deletedPages.has(t.page))
          .flatMap(t => {
            const copies = duplicatedAfter[t.page] || 0
            const dupes  = Array.from({ length: copies }, (_, ci) => ({
              ...t,
              _isDupe: true,
              _dupeKey: `${t.page}-dupe-${ci}`,
              _dupeLabel: `${t.page} (copy ${ci + 1})`,
            }))
            return [t, ...dupes]
          })
          .map((t, i) => {
          const isSelected = !t._isDupe && selectedPages.has(t.page)
          return (
            <div key={t._dupeKey || t.page}
              className="pdf-card"
              style={{ position:'relative', width:'130px', flexShrink:0, cursor:'pointer' }}>

              {/* Thumbnail */}
              <div
                onClick={() => toggle(t.page)}
                className={isSelected ? 'pdf-thumb pdf-thumb-selected' : 'pdf-thumb'}
                style={{ width:'130px', height:'170px' }}>
                <img src={t.img} alt={`Page ${t.page}`} loading="lazy"
                  style={{
                    width:'100%', height:'100%', objectFit:'contain', display:'block',
                    transform: pageRotations[t.page] ? `rotate(${pageRotations[t.page]}deg)` : 'none',
                    transition: 'transform 0.3s ease',
                  }}/>

                {/* Checkbox — always visible, filled when selected */}
                <div style={{
                  position:'absolute', top:'6px', left:'6px',
                  width:'20px', height:'20px', borderRadius:'50%',
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  border: isSelected ? '2px solid #fff' : '2.5px solid #000',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:'11px', color:'#fff', fontWeight:700,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                  transition:'all 0.12s',
                }}>{isSelected ? '✓' : ''}</div>
              </div>

              {/* Hover action icons — shown via CSS, zero JS overhead */}
              <div className="pdf-actions" style={{ position:'absolute', top:'6px', right:'6px',
                display:'flex', flexDirection:'column', gap:'4px', zIndex:10 }}>
                  <ActionIcon
                    title="Zoom — full resolution view"
                    color="rgba(30,30,50,0.9)"
                    border="rgba(108,99,255,0.6)"
                    icon={<ZoomIn size={12}/>}
                    onClick={() => onPageAction('zoom', t.page)}
                  />
                  <ActionIcon
                    title="Rotate 90°"
                    color="rgba(108,99,255,0.85)"
                    icon={<RotateCw size={12}/>}
                    onClick={() => onPageAction('rotate', t.page)}
                  />
                  {!t._isDupe && (
                    <ActionIcon
                      title="Duplicate — adds a copy after this page"
                      color="rgba(16,155,117,0.85)"
                      icon={<Copy size={12}/>}
                      onClick={() => onPageAction('duplicate', t.page)}
                    />
                  )}
                  <ActionIcon
                    title="Delete — removes page from document"
                    color="rgba(229,83,75,0.85)"
                    icon={<Trash2 size={12}/>}
                    onClick={() => t._isDupe
                      ? onPageAction('deleteDupe', t._dupeKey)
                      : onPageAction('delete', t.page)
                    }
                  />
                </div>

              {/* Page label */}
              <div style={{ textAlign:'center', marginTop:'5px' }}>
                <span style={{ fontSize:'11px', color: isSelected ? 'var(--accent2)' : t._isDupe ? 'var(--green)' : '#b0b0cc', fontWeight: isSelected ? 700 : 400 }}>
                  {t._isDupe ? t._dupeLabel : `Page ${t.page}`}
                </span>
                {pageRotations[t.page] > 0 && !t._isDupe && (
                  <span style={{ fontSize:'10px', color:'var(--accent2)', marginLeft:'4px' }}>
                    {pageRotations[t.page]}°
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ActionIcon({ title, color, border, icon, onClick }) {
  return (
    <button
      title={title}
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        width:'26px', height:'26px', borderRadius:'6px', border: border ? `1px solid ${border}` : 'none',
        background: color, color:'#fff', cursor:'pointer',
        display:'flex', alignItems:'center', justifyContent:'center',
        backdropFilter:'blur(4px)', transition:'transform 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.transform='scale(1.1)'}
      onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}
    >
      {icon}
    </button>
  )
}

// ── Main ToolPage ──────────────────────────────────────────────────────
export default function ToolPage({ toolId, onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const cfg = CONFIGS[toolId]

  const [files,         setFiles]         = useState([])
  const [vals,          setVals]          = useState(() => { const d={}; cfg?.fields?.forEach(f=>{ if(f.default) d[f.id]=f.default }); return d })
  const [status,        setStatus]        = useState('idle')
  const [errMsg,        setErrMsg]        = useState('')
  const [guide,         setGuide]         = useState(true)
  const [selectedPages, setSelectedPages] = useState(new Set())
  const [totalPages,    setTotalPages]    = useState(0)
  const [progress,      setProgress]      = useState(null)
  const [zoomPage,      setZoomPage]      = useState(null)   // page num for zoom modal
  // Per-page local rotations (applied client-side before processing)
  const [pageRotations,  setPageRotations]  = useState({})  // { pageNum: degrees }
  const [deletedPages,   setDeletedPages]   = useState(new Set())  // pages removed from grid
  const [duplicatedAfter,setDuplicatedAfter]= useState({})  // { pageNum: count } — pages duplicated

  const accept = cfg?.accept || {'application/pdf':['.pdf']}
  const onDrop = useCallback(a => {
    setFiles(prev => cfg?.multi ? [...prev,...a] : a)
    setSelectedPages(new Set()); setPageRotations({}); setDeletedPages(new Set()); setDuplicatedAfter({})
  }, [cfg])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept, maxFiles: cfg?.multi ? 20 : 1 })

  // Sync selected pages → vals.pages for tools that need it
  useEffect(() => {
    if (!cfg?.useSelector) return
    setVals(v => ({ ...v, pages: [...selectedPages].sort((a,b)=>a-b).join(',') }))
  }, [selectedPages])

  // Handle per-page context menu actions
  const handlePageAction = useCallback((action, pageNum) => {
    if (action === 'zoom') {
      setZoomPage(pageNum)
      return
    }
    if (action === 'rotate') {
      // Just update visual rotation — applied to PDF on final download
      setPageRotations(prev => ({
        ...prev,
        [pageNum]: ((prev[pageNum] || 0) + 90) % 360
      }))
      return
    }
    if (action === 'delete') {
      // Remove page from local grid — user downloads the modified result via main button
      setDeletedPages(prev => new Set([...prev, pageNum]))
      // Also deselect it
      setSelectedPages(prev => {
        const s = new Set(prev); s.delete(pageNum); return s
      })
      return
    }
    if (action === 'duplicate') {
      setDuplicatedAfter(prev => ({ ...prev, [pageNum]: (prev[pageNum] || 0) + 1 }))
      return
    }
    if (action === 'deleteDupe') {
      // pageNum here is actually the _dupeKey e.g. "3-dupe-0"
      // Decrement the duplicate count for that page
      const base = parseInt(String(pageNum).split('-')[0])
      setDuplicatedAfter(prev => {
        const count = (prev[base] || 1) - 1
        if (count <= 0) { const n = {...prev}; delete n[base]; return n }
        return { ...prev, [base]: count }
      })
      return
    }
  }, [])

  const run = async () => {
    if (!files.length) return
    setStatus('loading'); setErrMsg(''); setProgress(null)
    try {
      const onProgress = (current, total) => setProgress({ current, total })
      const res = await cfg.action(files, vals, onProgress)
      if (!cfg.clientSide) {
        api.downloadBlob(res.data, cfg.out, cfg.mime||'application/pdf')
      }
      setProgress(null)
      setStatus('done'); setTimeout(()=>setStatus('idle'), 3500)
    } catch(e) {
      setErrMsg(e.message || e.response?.data?.detail || 'Processing failed')
      setStatus('error'); setProgress(null)
    }
  }

  if (!cfg) return <div style={{ padding:'40px', color:'var(--red)' }}>Unknown tool: {toolId}</div>

  const inputFields    = cfg.fields.filter(f => f.type !== 'checkbox')
  const checkboxFields = cfg.fields.filter(f => f.type === 'checkbox')
  const isMerge        = toolId === 'merge'
  const isGridTool     = GRID_TOOLS.has(toolId)   // tools that get the new unified grid
  const showSplit      = !cfg.noPreview

  const dropZoneJSX = (
    <div {...getRootProps()} style={{ background:isDragActive?'rgba(91,91,214,0.06)':'var(--bg2)', border:`1px dashed ${isDragActive?'var(--accent)':'var(--border)'}`, borderRadius:'10px', padding:'24px 16px', textAlign:'center', cursor:'pointer', transition:'all 0.15s' }}>
      <input {...getInputProps()}/>
      <Upload size={16} color="var(--accent2)" style={{ display:'block', margin:'0 auto 7px'}}/>
      {isDragActive
        ? <p style={{ color:'var(--accent2)', fontWeight:600, fontSize:'13px' }}>Drop it!</p>
        : <><p style={{ color:'#ffffff', fontWeight:500, fontSize:'13px' }}>Drop {cfg.multi?'files':'file'} or <span style={{ color:'var(--accent2)' }}>browse</span></p>
           <p style={{ color:'#b0b0cc', fontSize:'11px', marginTop:'3px' }}>{cfg.multi?'Multiple PDFs':'PDF only'}</p></>}
    </div>
  )

  // ── Controls sidebar (left panel) ──────────────────────────────────
  const controlsJSX = (
    <div style={{ padding:'18px', display:'flex', flexDirection:'column', gap:'12px', overflowY:'auto', height:'100%' }}>
      {guide && cfg.guide && (
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'11px 13px', display:'flex', alignItems:'flex-start', gap:'8px' }}>
          <Info size={13} color="var(--accent2)" style={{ flexShrink:0, marginTop:'1px'}}/>
          <p style={{ fontSize:'12px', color:'#d0d0e8', lineHeight:1.55, flex:1 }}>{cfg.guide}</p>
          <button onClick={()=>setGuide(false)} style={{ background:'none', border:'none', color:'#b0b0cc', cursor:'pointer' }}><X size={12}/></button>
        </div>
      )}
      {dropZoneJSX}
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
      {cfg.useSelector && selectedPages.size>0 && !isGridTool && (
        <div style={{ background:'rgba(108,99,255,0.08)', border:'1px solid rgba(108,99,255,0.2)', borderRadius:'8px', padding:'8px 12px', fontSize:'12px', color:'var(--accent2)' }}>
          Selected: {[...selectedPages].sort((a,b)=>a-b).join(', ')}
        </div>
      )}
      {cfg.useSelector && selectedPages.size>0 && isGridTool && (
        <div style={{ background:'rgba(108,99,255,0.08)', border:'1px solid rgba(108,99,255,0.2)', borderRadius:'8px', padding:'8px 12px', fontSize:'12px', color:'var(--accent2)' }}>
          {selectedPages.size} page{selectedPages.size!==1?'s':''} selected
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
                : <input type={field.type||'text'} value={vals[field.id]||''} placeholder={field.placeholder} onChange={e=>setVals(v=>({...v,[field.id]:e.target.value}))} style={{ width:'100%'}}/>}
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
      {progress && (
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'8px', padding:'12px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
            <span style={{ fontSize:'12px', color:'#d0d0e8', fontWeight:600 }}>Converting pages…</span>
            <span style={{ fontSize:'12px', color:'var(--accent2)', fontWeight:700 }}>{progress.current}/{progress.total}</span>
          </div>
          <div style={{ height:'5px', background:'var(--bg3)', borderRadius:'3px', overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${Math.round((progress.current/progress.total)*100)}%`, background:'var(--accent)', borderRadius:'3px', transition:'width 0.3s ease' }}/>
          </div>
        </div>
      )}
      <button onClick={run} disabled={!files.length||status==='loading'}
        style={{ width:'100%', padding:'10px', fontSize:'13px', fontWeight:600, borderRadius:'9px', border:'none',
          cursor:!files.length?'not-allowed':'pointer', opacity:!files.length?0.45:1,
          display:'flex', alignItems:'center', justifyContent:'center', gap:'7px',
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

      {/* Zoom modal */}
      {zoomPage && <ZoomModal file={files[0]} pageNum={zoomPage} onClose={() => setZoomPage(null)}/>}

      {showSplit ? (
        <div style={{ display:'flex', flex:1, height:'calc(100vh - 52px)', overflow:'hidden' }}>

          {/* ── Left controls panel ── */}
          <div style={{ width:'280px', flexShrink:0, borderRight:'1px solid var(--border)', overflow:'hidden' }}>
            {isMerge
              ? <MultiFileSidebar files={files} onReorder={setFiles} onRemove={i=>setFiles(p=>p.filter((_,j)=>j!==i))} dropZoneJSX={dropZoneJSX} onRun={run} status={status}/>
              : controlsJSX}
          </div>

          {/* ── Right: unified grid for grid tools, classic preview for others ── */}
          {isGridTool ? (
            <UnifiedPageGrid
              file={files[0]}
              toolId={toolId}
              selectedPages={selectedPages}
              onSelectionChange={setSelectedPages}
              onPageAction={handlePageAction}
              pageRotations={pageRotations}
              deletedPages={deletedPages}
              duplicatedAfter={duplicatedAfter}
            />
          ) : (
            /* Classic 2-panel for split/rotate/merge etc */
            <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
              {/* Mini page sidebar */}
              {!isMerge && (
                <div style={{ width:'150px', flexShrink:0, borderRight:'1px solid var(--border)', background:'var(--bg2)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
                  <div style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', fontSize:'10px', fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'#b0b0cc' }}>Pages</div>
                  <div style={{ flex:1, overflow:'hidden' }}>
                    <ClassicPageSidebar file={files[0]} selectedPages={selectedPages} onSelectionChange={setSelectedPages}/>
                  </div>
                </div>
              )}
              {/* Preview */}
              <div style={{ flex:1, overflow:'hidden' }}>
                <ClassicPreviewPanel file={files[0]} selectedPages={selectedPages}/>
              </div>
            </div>
          )}
        </div>

      ) : (
        /* No-preview tools (compress, convert, etc) */
        <div style={{ maxWidth:'560px', margin:'36px auto', padding:'0 24px', width:'100%', display:'flex', flexDirection:'column', gap:'12px' }}>
          {guide && cfg.guide && (
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'12px 16px', display:'flex', alignItems:'flex-start', gap:'10px' }}>
              <Info size={14} color="var(--accent2)" style={{ flexShrink:0, marginTop:'1px'}}/>
              <p style={{ fontSize:'13px', color:'#d0d0e8', lineHeight:1.55, flex:1 }}>{cfg.guide}</p>
              <button onClick={()=>setGuide(false)} style={{ background:'none', border:'none', color:'#b0b0cc', cursor:'pointer' }}><X size={13}/></button>
            </div>
          )}
          {dropZoneJSX}
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
                    : <input type={field.type||'text'} value={vals[field.id]||''} placeholder={field.placeholder} onChange={e=>setVals(v=>({...v,[field.id]:e.target.value}))} style={{ width:'100%'}}/>}
                </div>
              ))}
            </div>
          )}
          {status==='error' && (
            <div style={{ display:'flex', alignItems:'center', gap:'8px', background:'rgba(229,72,77,0.08)', border:'1px solid rgba(229,72,77,0.25)', borderRadius:'8px', padding:'10px 14px', fontSize:'13px', color:'var(--red)' }}>
              <AlertCircle size={13}/> {errMsg}
            </div>
          )}
          {progress && (
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'8px', padding:'12px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
                <span style={{ fontSize:'12px', color:'#d0d0e8', fontWeight:600 }}>Converting pages…</span>
                <span style={{ fontSize:'12px', color:'var(--accent2)', fontWeight:700 }}>{progress.current}/{progress.total}</span>
              </div>
              <div style={{ height:'5px', background:'var(--bg3)', borderRadius:'3px', overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${Math.round((progress.current/progress.total)*100)}%`, background:'var(--accent)', borderRadius:'3px', transition:'width 0.3s ease'}}/>
              </div>
            </div>
          )}
          <button onClick={run} disabled={!files.length||status==='loading'}
            style={{ width:'100%', padding:'11px', fontSize:'14px', fontWeight:600, borderRadius:'9px', border:'none',
              cursor:!files.length?'not-allowed':'pointer', opacity:!files.length?0.45:1,
              display:'flex', alignItems:'center', justifyContent:'center', gap:'8px',
              background:status==='done'?'var(--green)':'var(--accent)', color:'#fff',
              boxShadow:files.length?'0 2px 12px rgba(91,91,214,0.3)':'none' }}>
            {status==='loading'?<><Loader2 size={14} className="spin"/>Processing…</>:status==='done'?<><CheckCircle size={14}/>Downloaded!</>:<><Upload size={14}/>{cfg.title}</>}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Classic sidebar/preview for non-grid tools ─────────────────────────
function ClassicPageSidebar({ file, selectedPages, onSelectionChange }) {
  const [thumbs,  setThumbs]  = useState([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!file) { setThumbs([]); return }
    setLoading(true); setThumbs([])
    let first = true
    getThumbnailsProgressive(file, (thumb) => {
      if (first) { setLoading(false); first = false }
      if (thumb.img) setThumbs(prev => [...prev, thumb])
    }, 5).catch(() => setLoading(false))
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
        {loading ? <div style={{ textAlign:'center', padding:'16px', color:'#b0b0cc', fontSize:'12px' }}><Loader2 size={16} className="spin" style={{ display:'block', margin:'0 auto 6px'}}/>Loading…</div>
        : thumbs.map(t => {
          const sel = selectedPages.has(t.page)
          return (
            <div key={t.page} onClick={()=>toggle(t.page)} style={{ cursor:'pointer', position:'relative', borderRadius:'7px', overflow:'hidden', border:`2px solid ${sel?'var(--accent)':'var(--border)'}`, boxShadow:sel?'0 0 0 2px rgba(108,99,255,0.3)':'none', transition:'all 0.12s' }}>
              <img src={t.img} alt={`p${t.page}`} style={{ width:'100%', display:'block'}}/>
              <div style={{ position:'absolute', top:'3px', right:'3px', width:'16px', height:'16px', borderRadius:'50%', background:sel?'var(--accent)':'rgba(0,0,0,0.55)', border:'2px solid #fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'9px', color:'#fff', fontWeight:700 }}>{sel?'✓':''}</div>
              <div style={{ textAlign:'center', fontSize:'9px', color:'#b0b0cc', padding:'2px 0', background:'var(--bg2)' }}>p.{t.page}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ClassicPreviewPanel({ file, selectedPages }) {
  const [thumbs,      setThumbs]      = useState([])
  const [loading,     setLoading]     = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages,  setTotalPages]  = useState(0)
  useEffect(() => {
    if (!file) { setThumbs([]); setTotalPages(0); return }
    setLoading(true); setThumbs([])
    let first = true
    getThumbnailsProgressive(file, (thumb) => {
      if (first) { setLoading(false); first = false }
      if (thumb.img) { setThumbs(prev => [...prev, thumb]); setTotalPages(thumb.page) }
    }, 5).catch(() => setLoading(false))
  }, [file])
  const thumb = thumbs.find(t => t.page === currentPage)
  if (!file) return <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#b0b0cc', background:'var(--bg3)' }}><div style={{ fontSize:'48px', opacity:0.1, marginBottom:'14px' }}>📄</div><p style={{ fontSize:'14px', fontWeight:600, color:'#d0d0e8' }}>Upload a PDF to preview</p></div>
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column' }}>
      {totalPages>1 && (
        <div style={{ padding:'8px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', gap:'12px', background:'var(--bg2)' }}>
          <button onClick={()=>setCurrentPage(p=>Math.max(1,p-1))} disabled={currentPage<=1} style={{ background:'none', border:'1px solid var(--border)', borderRadius:'6px', padding:'4px 8px', cursor:'pointer', color:'#d0d0e8', opacity:currentPage<=1?0.4:1 }}>‹</button>
          <span style={{ fontSize:'12px', color:'#d0d0e8' }}>Page {currentPage} of {totalPages}</span>
          <button onClick={()=>setCurrentPage(p=>Math.min(totalPages,p+1))} disabled={currentPage>=totalPages} style={{ background:'none', border:'1px solid var(--border)', borderRadius:'6px', padding:'4px 8px', cursor:'pointer', color:'#d0d0e8', opacity:currentPage>=totalPages?0.4:1 }}>›</button>
        </div>
      )}
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'24px', overflowY:'auto', background:'var(--bg3)' }}>
        {loading ? <div style={{ textAlign:'center', color:'#b0b0cc' }}><Loader2 size={24} className="spin" color="var(--accent)" style={{ display:'block', margin:'0 auto 10px'}}/><p style={{ fontSize:'13px' }}>Loading preview…</p></div>
        : thumb ? <img src={thumb.img} alt={`Page ${currentPage}`} style={{ maxWidth:'100%', maxHeight:'100%', boxShadow:'0 4px 32px rgba(0,0,0,0.4)', borderRadius:'3px', background:'#fff'}}/>
        : <p style={{ color:'#b0b0cc', fontSize:'13px' }}>No preview available</p>}
      </div>
    </div>
  )
}
