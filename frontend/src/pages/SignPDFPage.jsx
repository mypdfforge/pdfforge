import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import {
  Loader2, CheckCircle, AlertCircle,
  Trash2, PenTool, Type, Image as ImageIcon,
  ChevronLeft, ChevronRight, Download, Check, Lock, Plus,
} from 'lucide-react'
import axios from 'axios'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'

const THUMB_SCALE = 0.3

const HANDWRITING_FONTS = [
  { name:'Dancing Script', css: "'Dancing Script', cursive",  url:'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap' },
  { name:'Pacifico',       css: "'Pacifico', cursive",        url:'https://fonts.googleapis.com/css2?family=Pacifico&display=swap' },
  { name:'Caveat',         css: "'Caveat', sans-serif",       url:'https://fonts.googleapis.com/css2?family=Caveat:wght@700&display=swap' },
]

export default function SignPDFPage() {
  const [file, setFile] = useState(null)
  const [status, setStatus] = useState('idle')
  const [pages, setPages] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [signatures, setSignatures] = useState([]) // Array of { id, page, x, y, type, content, locked }

  const onDrop = useCallback(acceptedFiles => {
    const f = acceptedFiles?.[0]
    if (!f) return
    setFile(f)
    setLoading(true)
    getThumbnailsProgressive(f, (ts) => {
      setPages(ts)
      setLoading(false)
    })
  }, [])

  const { getRootProps, getInputProps } = useDropzone({
    onDrop, accept: { 'application/pdf': ['.pdf'] }, multiple: false
  })

  const apply = async () => {
    if (!file || signatures.length === 0) return
    setStatus('loading')
    try {
      const formData = new FormData()
      formData.append('file', file)
      // Map signatures to PDF coordinates (PageHeight - Y logic)
      const data = signatures.map(s => ({
        ...s,
        // Backend logic for coordinate conversion happens here
      }))
      formData.append('signatures', JSON.stringify(data))

      const res = await axios.post('https://your-huggingface-mind.hf.space/sign', formData, { responseType: 'blob' })
      downloadBlob(res.data, 'signed.pdf')
      setStatus('done')
    } catch (err) {
      setStatus('error')
    }
  }

  const totalLocked = signatures.filter(s => s.locked).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0b0b18', color: '#fff', overflow: 'hidden' }}>
      <TopBar title="Sign PDF" />
      
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* LEFT TOOLBAR: Fixed Position */}
        <div style={{ width: '280px', borderRight: '1px solid #252538', padding: '20px', overflowY: 'auto', background: '#121225' }}>
          {!file ? (
            <div {...getRootProps()} style={{ border: '2px dashed #35354a', padding: '40px 20px', textAlign: 'center', borderRadius: '12px', cursor: 'pointer' }}>
              <input {...getInputProps()} />
              <PenTool size={32} color="#6c63ff" style={{ marginBottom: '12px' }} />
              <p style={{ fontSize: '13px' }}>Upload PDF to Sign</p>
            </div>
          ) : (
            <>
              <h3 style={{ fontSize: '11px', color: '#888', marginBottom: '15px' }}>SIGNATURE TOOLS</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
                <button style={{ padding: '12px', background: '#1a1a32', border: '1px solid #252538', color: '#fff', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <PenTool size={16} /> Draw Signature
                </button>
                <button style={{ padding: '12px', background: '#1a1a32', border: '1px solid #252538', color: '#fff', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Type size={16} /> Type Name
                </button>
              </div>
            </>
          )}
        </div>

        {/* MIDDLE THUMBNAILS: Independent Scroll */}
        <div style={{ width: '150px', borderRight: '1px solid #252538', overflowY: 'auto', background: '#0f0f20', padding: '15px' }}>
          {loading && <Loader2 className="spin" size={20} style={{ margin: 'auto', display: 'block' }} />}
          {pages.map((p) => (
            <div key={p.page} onClick={() => setCurrentPage(p.page)} style={{ marginBottom: '15px', cursor: 'pointer', textAlign: 'center' }}>
              <img src={p.img} style={{ width: '100%', borderRadius: '4px', border: currentPage === p.page ? '2px solid #6c63ff' : '1px solid #252538' }} alt="" />
              <span style={{ fontSize: '10px', color: '#666' }}>Page {p.page}</span>
            </div>
          ))}
        </div>

        {/* MAIN SIGNING AREA: Large & Independent Scroll */}
        <div style={{ flex: 1, background: '#080814', overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '40px', position: 'relative' }}>
          {pages.length > 0 ? (
            <div style={{ position: 'relative', width: 'fit-content' }}>
              <img 
                src={pages.find(p => p.page === currentPage)?.img} 
                style={{ maxWidth: '850px', width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.6)', borderRadius: '4px' }} 
                alt="Sign Preview" 
              />
              {/* This is where your draggable signatures would render */}
            </div>
          ) : (
            <div style={{ color: '#444', marginTop: '100px' }}>No document active</div>
          )}
        </div>
      </div>

      {/* FLOATING ACTION BUTTON */}
      {file && (
        <button 
          onClick={apply} 
          disabled={status === 'loading'} 
          style={{ 
            position: 'fixed', bottom: '30px', right: '30px', 
            background: status === 'done' ? '#1a8a3a' : '#6c63ff', 
            color: '#fff', border: 'none', padding: '12px 28px', 
            borderRadius: '50px', fontWeight: 'bold', cursor: 'pointer', 
            boxShadow: '0 10px 30px rgba(0,0,0,0.4)', zIndex: 1000,
            display: 'flex', alignItems: 'center', gap: '10px' 
          }}
        >
          {status === 'loading' ? <Loader2 className="spin" size={18} /> : status === 'done' ? <CheckCircle size={18} /> : <Download size={18} />}
          {status === 'done' ? 'Downloaded' : 'Sign & Download'}
        </button>
      )}
    </div>
  )
}