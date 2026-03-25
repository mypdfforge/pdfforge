import React, { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Loader2, CheckCircle, Upload, Download } from 'lucide-react'
import TopBar from '../components/TopBar'
import axios from 'axios'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'

const STAMP_LABELS = ['APPROVED','DRAFT','CONFIDENTIAL','REJECTED','FINAL','COPY','VOID','REVIEWED']
const POS_ROWS = [['top-left','top-center','top-right'],['middle-left','middle-center','middle-right'],['bottom-left','bottom-center','bottom-right']]

export default function StampToolPage() {
  const [file, setFile] = useState(null)
  const [status, setStatus] = useState('idle')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [thumbnails, setThumbnails] = useState([])
  const [range, setRange] = useState('all')
  const [stampText, setStampText] = useState('APPROVED')
  const [pos, setPos] = useState('top-right')
  const [loadingThumb, setLoadingThumb] = useState(false)

  // DEFINED INSIDE TO AVOID VERCEL SCOPING ERRORS
  const isPageSelected = (n) => {
    const r = (range || '').trim().toLowerCase()
    if (!r || r === 'all') return true
    try {
      const parts = r.split(',').map(x => x.trim())
      for (const p of parts) {
        if (p.includes('-')) {
          const [start, end] = p.split('-').map(Number)
          if (n >= start && n <= end) return true
        } else if (Number(p) === n) return true
      }
    } catch (e) {}
    return false
  }

  const onDrop = useCallback(acceptedFiles => {
    if (acceptedFiles?.[0]) {
      const f = acceptedFiles[0]
      setFile(f)
      setLoadingThumb(true)
      getThumbnailsProgressive(f, (ts) => {
        setThumbnails(ts)
        setTotalPages(ts.length)
        setLoadingThumb(false)
      })
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, accept: {'application/pdf':['.pdf']}, multiple: false 
  })

  const handleApply = async () => {
    if (!file) return
    setStatus('loading')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('text', stampText)
      formData.append('position', pos)
      formData.append('range', range)
      // Connects to your 8-space Hugging Face cluster
      const res = await axios.post('https://your-huggingface-mind.hf.space/stamp', formData, { responseType: 'blob' })
      downloadBlob(res.data, 'stamped.pdf')
      setStatus('done')
    } catch (err) { setStatus('error') }
  }

  const currentThumb = thumbnails.find(t => t.page === currentPage)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0b0b18', color: '#fff', overflow: 'hidden' }}>
      <TopBar title="Stamp PDF" />
      
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* SETTINGS */}
        <div style={{ width: '300px', borderRight: '1px solid #252538', padding: '20px', overflowY: 'auto', background: '#121225' }}>
          {!file ? (
            <div {...getRootProps()} style={{ border: '2px dashed #35354a', padding: '40px 20px', textAlign: 'center', borderRadius: '12px', cursor: 'pointer' }}>
              <input {...getInputProps()} />
              <Upload size={32} color="#6c63ff" style={{ marginBottom: '12px' }} />
              <p>Upload PDF</p>
            </div>
          ) : (
            <>
              <h3 style={{ fontSize: '11px', color: '#888', marginBottom: '15px' }}>STAMP TEXT</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '25px' }}>
                {STAMP_LABELS.map(l => (
                  <button key={l} onClick={() => setStampText(l)} style={{ padding: '8px', fontSize: '11px', borderRadius: '6px', border: '1px solid #252538', background: stampText === l ? '#6c63ff' : '#1a1a32', color: '#fff', cursor: 'pointer' }}>{l}</button>
                ))}
              </div>
              <h3 style={{ fontSize: '11px', color: '#888', marginBottom: '15px' }}>PAGE RANGE</h3>
              <input value={range} onChange={e => setRange(e.target.value)} style={{ width: '100%', padding: '10px', background: '#1a1a32', border: '1px solid #252538', borderRadius: '6px', color: '#fff' }} />
            </>
          )}
        </div>

        {/* THUMBNAILS - INDEPENDENT SCROLL */}
        <div style={{ width: '150px', borderRight: '1px solid #252538', overflowY: 'auto', background: '#0f0f20', padding: '15px' }}>
          {loadingThumb && <Loader2 className="spin" size={20} style={{ margin: 'auto' }} />}
          {thumbnails.map((t, i) => (
            <div key={i} onClick={() => setCurrentPage(i + 1)} style={{ marginBottom: '15px', cursor: 'pointer', textAlign: 'center', position: 'relative' }}>
              <img src={t.img} style={{ width: '100%', borderRadius: '4px', border: currentPage === i+1 ? '2px solid #6c63ff' : '1px solid #252538', opacity: isPageSelected(i+1) ? 1 : 0.3 }} alt="" />
              {isPageSelected(i+1) && <CheckCircle size={12} style={{ position:'absolute', top: 5, right: 5, color: '#6c63ff' }} />}
            </div>
          ))}
        </div>

        {/* PREVIEW - INDEPENDENT SCROLL */}
        <div style={{ flex: 1, background: '#080814', overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '40px' }}>
          {currentThumb && (
            <div style={{ position: 'relative' }}>
              <img src={currentThumb.img} style={{ maxWidth: '850px', width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.6)' }} alt="Preview" />
              <button style={{ position: 'absolute', top: '-45px', right: 0, background: '#1a8a3a', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}>
                Done for Page {currentPage}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* FLOATING BUTTON */}
      {file && (
        <button onClick={handleApply} disabled={status === 'loading'} style={{ position: 'fixed', bottom: '30px', right: '30px', background: '#6c63ff', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: '50px', cursor: 'pointer', zIndex: 1000 }}>
          {status === 'loading' ? <Loader2 className="spin" size={18} /> : 'Download Stamped PDF'}
        </button>
      )}
    </div>
  )
}