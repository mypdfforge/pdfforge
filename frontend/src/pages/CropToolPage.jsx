import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import {
  Loader2, CheckCircle, AlertCircle, Download,
  RotateCcw, Crop, ChevronsRight, Maximize2, Check, X, Upload
} from 'lucide-react'
import TopBar from '../components/TopBar'
import axios from 'axios'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'

// ─── YOUR ORIGINAL PDF MATH ─────────────────────────────────────────────────────
function pxToPdfCrop(box, canvasW, canvasH, pdfW, pdfH) {
  const sx = pdfW / canvasW, sy = pdfH / canvasH
  return {
    left:   Math.round(box.x * sx),
    top:    Math.round(box.y * sy),
    right:  Math.round((canvasW - box.x - box.w) * sx),
    bottom: Math.round((canvasH - box.y - box.h) * sy),
  }
}

export default function CropToolPage() {
  const [file, setFile] = useState(null)
  const [status, setStatus] = useState('idle')
  const [pages, setPages] = useState([]) // Your original thumbnails array
  const [loading, setLoading] = useState(false)
  const [activePage, setActivePage] = useState(null)
  const [cropBoxes, setCropBoxes] = useState({}) // {pageNum: {x,y,w,h}}

  // 1. YOUR ORIGINAL DROP LOGIC
  const onDrop = useCallback(acceptedFiles => {
    const f = acceptedFiles?.[0]
    if (!f) return
    setFile(f)
    setLoading(true)
    getThumbnailsProgressive(f, (ts) => {
      setPages(ts)
      // Initialize crop boxes for all pages to "Full Page"
      const initial = {}
      ts.forEach(p => {
        initial[p.page] = { x: 0, y: 0, w: p.width, h: p.height }
      })
      setCropBoxes(initial)
      setLoading(false)
    })
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'application/pdf': ['.pdf'] }, multiple: false
  })

  // 2. YOUR ORIGINAL BACKEND PROCESSING
  const handleApply = async () => {
    if (!file) return
    setStatus('loading')
    try {
      const crops = pages.map(p => {
        const box = cropBoxes[p.page]
        return pxToPdfCrop(box, p.width, p.height, p.pdfW, p.pdfH)
      })

      const formData = new FormData()
      formData.append('file', file)
      formData.append('crops', JSON.stringify(crops))

      const res = await axios.post('https://your-huggingface-mind.hf.space/crop', formData, { responseType: 'blob' })
      downloadBlob(res.data, 'cropped.pdf')
      setStatus('done')
    } catch (err) {
      setStatus('error')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0b0b18', color: '#fff', overflow: 'hidden' }}>
      <TopBar title="Crop PDF" />
      
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* LEFT SETTINGS SIDEBAR (Independent Scroll) */}
        <div style={{ width: '300px', borderRight: '1px solid #252538', padding: '20px', overflowY: 'auto', background: '#121225' }}>
          {!file ? (
            <div {...getRootProps()} style={{ border: '2px dashed #35354a', padding: '40px 20px', textAlign: 'center', borderRadius: '12px', cursor: 'pointer' }}>
              <input {...getInputProps()} />
              <Crop size={32} color="#6c63ff" style={{ marginBottom: '12px' }} />
              <p style={{ fontSize: '13px' }}>{isDragActive ? 'Drop PDF' : 'Upload PDF'}</p>
            </div>
          ) : (
            <>
              <h3 style={{ fontSize: '11px', color: '#888', marginBottom: '15px' }}>CROP CONTROLS</h3>
              <p style={{ fontSize: '12px', color: '#aaa', marginBottom: '20px' }}>
                Select a page from the grid or the sidebar to adjust its crop margins.
              </p>
              <button 
                onClick={() => {
                  const first = cropBoxes[1];
                  const newBoxes = {};
                  pages.forEach(p => newBoxes[p.page] = {...first});
                  setCropBoxes(newBoxes);
                }}
                style={{ width: '100%', padding: '12px', background: '#1a1a32', border: '1px solid #6c63ff', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <ChevronsRight size={16} /> Apply Page 1 to All
              </button>
            </>
          )}
        </div>

        {/* THUMBNAIL NAV (Middle Strip) */}
        <div style={{ width: '160px', borderRight: '1px solid #252538', overflowY: 'auto', background: '#0f0f20', padding: '15px' }}>
          {loading && <Loader2 className="spin" size={20} style={{ margin: 'auto', display: 'block' }} />}
          {pages.map((t) => (
            <div key={t.page} onClick={() => setActivePage(t.page)} style={{ marginBottom: '15px', cursor: 'pointer', textAlign: 'center' }}>
              <img src={t.img} style={{ width: '100%', borderRadius: '4px', border: activePage === t.page ? '2px solid #6c63ff' : '1px solid #252538' }} alt="" />
              <span style={{ fontSize: '10px', color: '#666' }}>Page {t.page}</span>
            </div>
          ))}
        </div>

        {/* MAIN PREVIEW AREA (Large & Independent Scroll) */}
        <div style={{ flex: 1, background: '#080814', overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '40px', position: 'relative' }}>
          {file ? (
            <div style={{ width: '100%', maxWidth: '950px', display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'center' }}>
               {pages.map(p => (
                 <div key={p.page} style={{ position: 'relative', background: '#fff', borderRadius: '4px', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                    <img src={p.img} style={{ display: 'block', width: '300px' }} alt="" />
                    {/* Visual Crop Overlay */}
                    <div style={{ 
                      position: 'absolute', 
                      border: '2px solid #6c63ff', 
                      background: 'rgba(108, 99, 255, 0.1)',
                      top: '10%', bottom: '10%', left: '10%', right: '10%' // Representation of crop
                    }} />
                 </div>
               ))}
            </div>
          ) : (
            <div style={{ marginTop: '100px', textAlign: 'center', color: '#444' }}>
              <Maximize2 size={48} style={{ marginBottom: '10px', opacity: 0.2 }} />
              <p>No document active</p>
            </div>
          )}
        </div>
      </div>

      {/* FLOATING ACTION BUTTON */}
      {file && (
        <button onClick={handleApply} disabled={status === 'loading'} style={{ position: 'fixed', bottom: '30px', right: '30px', background: '#6c63ff', color: '#fff', border: 'none', padding: '12px 30px', borderRadius: '50px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 10px 30px rgba(108,99,255,0.4)', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 1000 }}>
          {status === 'loading' ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
          Download Cropped PDF
        </button>
      )}
    </div>
  )
}