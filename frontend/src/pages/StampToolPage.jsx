import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Loader2, CheckCircle, AlertCircle, ImageIcon, ChevronLeft, ChevronRight, Download, Upload } from 'lucide-react'
import TopBar from '../components/TopBar'
import axios from 'axios'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'

const STAMP_LABELS = ['APPROVED','DRAFT','CONFIDENTIAL','REJECTED','FINAL','COPY','VOID','REVIEWED']
const STAMP_COLORS = { APPROVED:'#1a8a3a', DRAFT:'#cc7700', CONFIDENTIAL:'#cc0000', REJECTED:'#dd0000', FINAL:'#0033cc', COPY:'#3333bb', VOID:'#555', REVIEWED:'#0077aa' }
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
  const [opacity, setOpacity] = useState(0.6)
  const [rotation, setRotation] = useState(0)

  // 1. FIXED LAYOUT: Independent Scrolling
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg1)', color: 'var(--text1)', overflow: 'hidden' }}>
      <TopBar title="Stamp PDF" />
      
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* LEFT SIDEBAR: Static Settings */}
        <div style={{ width: '280px', borderRight: '1px solid var(--border)', padding: '20px', overflowY: 'auto', background: 'var(--bg2)' }}>
          <h3 style={{ fontSize: '14px', marginBottom: '16px' }}>STAMP SETTINGS</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '20px' }}>
            {STAMP_LABELS.map(l => (
              <button key={l} onClick={() => setStampText(l)} style={{ padding: '8px', fontSize: '11px', borderRadius: '4px', border: '1px solid var(--border)', background: stampText === l ? 'var(--accent)' : 'transparent', color: '#fff', cursor: 'pointer' }}>{l}</button>
            ))}
          </div>
          
          <label style={{ fontSize: '12px', display: 'block', marginBottom: '8px' }}>Page Range</label>
          <input value={range} onChange={e => setRange(e.target.value)} placeholder="e.g. 1-3, 5" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg1)', color: '#fff', marginBottom: '20px' }} />
        </div>

        {/* MIDDLE STRIP: Scrollable Thumbnails */}
        <div style={{ width: '160px', borderRight: '1px solid var(--border)', overflowY: 'auto', background: 'var(--bg2)', padding: '10px' }}>
          {thumbnails.map((t, i) => (
            <div key={i} onClick={() => setCurrentPage(i + 1)} style={{ marginBottom: '12px', cursor: 'pointer', border: currentPage === i + 1 ? '2px solid var(--accent)' : '1px solid transparent', borderRadius: '4px', padding: '4px' }}>
              <img src={t.img} style={{ width: '100%', borderRadius: '2px' }} alt={`p${i+1}`} />
              <p style={{ textAlign: 'center', fontSize: '10px', marginTop: '4px' }}>p.{i + 1}</p>
            </div>
          ))}
        </div>

        {/* RIGHT CONTENT: Large Preview */}
        <div style={{ flex: 1, position: 'relative', overflowY: 'auto', background: 'var(--bg3)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' }}>
          {file ? (
            <div style={{ maxWidth: '90%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
               <div style={{ position: 'relative', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
                  {/* Actual PDF Preview Image would render here */}
                  <div style={{ background: '#fff', width: '600px', height: '800px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000' }}>
                    [ Large Page {currentPage} Preview ]
                  </div>
                  
                  {/* Floating "Done" Button above the preview */}
                  <button style={{ position: 'absolute', top: '-50px', right: '0', background: 'var(--green)', color: '#fff', padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
                    Done for Page {currentPage}
                  </button>
               </div>
            </div>
          ) : (
            <div style={{ marginTop: '100px', textAlign: 'center' }}>
               <Upload size={48} color="var(--accent)" />
               <p>Drop your PDF here to start stamping</p>
            </div>
          )}
        </div>
      </div>

      {/* FIXED FLOATING DOWNLOAD BUTTON */}
      {file && (
        <button onClick={() => {/* apply logic */}} style={{ position: 'fixed', bottom: '30px', right: '30px', background: 'var(--accent)', color: '#fff', padding: '12px 24px', borderRadius: '50px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.4)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
          <Download size={18} /> Download Stamped PDF
        </button>
      )}
    </div>
  )
}