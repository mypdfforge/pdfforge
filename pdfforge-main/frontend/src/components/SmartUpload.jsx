/**
 * SmartUpload.jsx
 * Drop zone that analyzes the file and shows "Recommended for you" cards.
 * Zero server calls for analysis — pure client-side.
 */
import React, { useState, useCallback, useRef } from 'react'
import { analyzeFile, analyzeMultipleFiles } from '../utils/fileAnalyzer'

const pulse = `@keyframes sgPulse { 0%,100%{opacity:1} 50%{opacity:.5} }`
const spin  = `@keyframes sgSpin  { to{transform:rotate(360deg)} }`
const fadeUp= `@keyframes sgFadeUp{ from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }`

export default function SmartUpload({ onSelectTool, onFilesReady }) {
  const [dragging,     setDragging]     = useState(false)
  const [analyzing,    setAnalyzing]    = useState(false)
  const [suggestions,  setSuggestions]  = useState([])
  const [metadata,     setMetadata]     = useState(null)
  const [files,        setFiles]        = useState([])
  const inputRef = useRef()

  const handleFiles = useCallback(async (fileList) => {
    const arr = Array.from(fileList).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    )
    if (!arr.length) return

    setFiles(arr)
    setAnalyzing(true)
    setSuggestions([])

    try {
      if (arr.length > 1) {
        const multiSug = analyzeMultipleFiles(arr)
        const { suggestions: singleSugs, metadata: meta } = await analyzeFile(arr[0])
        const all = multiSug ? [multiSug, ...singleSugs] : singleSugs
        setSuggestions(all.slice(0, 4))
        setMetadata(meta)
      } else {
        const { suggestions: sugs, metadata: meta } = await analyzeFile(arr[0])
        setSuggestions(sugs)
        setMetadata(meta)
      }
    } catch (e) {
      console.warn('Analysis error', e)
    }
    setAnalyzing(false)

    // Pass files up so tool pages can receive them
    onFilesReady?.(arr)
  }, [onFilesReady])

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleSuggestion = (sug) => {
    if (sug.isWorkflow) {
      onSelectTool?.(sug.id, 'enhance', files)
    } else {
      onSelectTool?.(sug.id, null, files)
    }
  }

  return (
    <div style={{ width:'100%' }}>
      <style>{pulse}{spin}{fadeUp}</style>

      {/* ── Drop Zone ── */}
      <div
        onDragEnter={e => { e.preventDefault(); setDragging(true)  }}
        onDragOver={e  => { e.preventDefault(); setDragging(true)  }}
        onDragLeave={e => { e.preventDefault(); setDragging(false) }}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border:       `2px dashed ${dragging ? '#6c63ff' : 'rgba(108,99,255,0.35)'}`,
          borderRadius: '20px',
          padding:      '52px 32px',
          textAlign:    'center',
          cursor:       'pointer',
          background:   dragging
            ? 'rgba(108,99,255,0.12)'
            : 'linear-gradient(135deg,rgba(108,99,255,0.06),rgba(232,121,249,0.04))',
          transition:   'all 0.2s',
          position:     'relative',
          overflow:     'hidden',
        }}
      >
        {/* Glow orb */}
        <div style={{
          position:'absolute', top:'-40px', left:'50%', transform:'translateX(-50%)',
          width:'200px', height:'200px', borderRadius:'50%',
          background:'radial-gradient(circle,rgba(108,99,255,0.18) 0%,transparent 70%)',
          pointerEvents:'none',
        }}/>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          style={{ display:'none' }}
          onChange={e => handleFiles(e.target.files)}
        />

        {analyzing ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'14px' }}>
            <div style={{
              width:'40px', height:'40px', borderRadius:'50%',
              border:'3px solid rgba(108,99,255,0.2)',
              borderTopColor:'#6c63ff',
              animation:'sgSpin 0.8s linear infinite',
            }}/>
            <p style={{ fontSize:'15px', fontWeight:600, color:'#ffffff' }}>Analyzing your file…</p>
            <p style={{ fontSize:'13px', color:'#b0b0cc' }}>Detecting document type and best tools</p>
          </div>
        ) : files.length > 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'10px' }}>
            <div style={{ fontSize:'32px' }}>📄</div>
            <p style={{ fontSize:'15px', fontWeight:700, color:'#ffffff' }}>
              {files.length === 1 ? files[0].name : `${files.length} files selected`}
            </p>
            {metadata && (
              <div style={{ display:'flex', gap:'12px', flexWrap:'wrap', justifyContent:'center' }}>
                {metadata.sizeLabel && <Chip label={metadata.sizeLabel} />}
                {metadata.pageCount && <Chip label={`${metadata.pageCount} pages`} />}
                {metadata.isResume  && <Chip label="📋 Resume" color="#6c63ff" />}
                {metadata.isScanned && <Chip label="🖨 Scanned" color="#f5a623" />}
                {metadata.isInvoice && <Chip label="🧾 Invoice" color="#3ecf8e" />}
              </div>
            )}
            <p style={{ fontSize:'12px', color:'#9d97ff', marginTop:'4px' }}>
              Click to change file
            </p>
          </div>
        ) : (
          <>
            <div style={{
              width:'56px', height:'56px', borderRadius:'14px',
              background:'linear-gradient(135deg,rgba(108,99,255,0.2),rgba(232,121,249,0.15))',
              border:'1px solid rgba(108,99,255,0.3)',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:'26px', margin:'0 auto 18px',
            }}>📄</div>
            <p style={{ fontSize:'17px', fontWeight:700, color:'#ffffff', marginBottom:'8px' }}>
              Drop your PDF here
            </p>
            <p style={{ fontSize:'13px', color:'#b0b0cc', marginBottom:'16px' }}>
              or click to browse — we'll detect the best tools automatically
            </p>
            <div style={{ display:'flex', gap:'10px', justifyContent:'center', flexWrap:'wrap' }}>
              {['No signup', 'Auto-deleted in 24h', 'No watermark'].map(t => (
                <span key={t} style={{
                  fontSize:'11px', color:'#3ecf8e', background:'rgba(62,207,142,0.1)',
                  border:'1px solid rgba(62,207,142,0.25)', borderRadius:'999px', padding:'3px 10px',
                }}>✓ {t}</span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Suggestions ── */}
      {suggestions.length > 0 && !analyzing && (
        <div style={{ marginTop:'24px', animation:'sgFadeUp 0.35s ease forwards' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'14px' }}>
            <span style={{
              fontSize:'11px', fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase',
              color:'#9d97ff', background:'rgba(108,99,255,0.1)',
              border:'1px solid rgba(108,99,255,0.2)', borderRadius:'999px', padding:'3px 12px',
            }}>✦ Recommended for you</span>
            <div style={{ flex:1, height:'1px', background:'var(--border)' }}/>
          </div>

          <div style={{
            display:'grid',
            gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',
            gap:'12px',
          }}>
            {suggestions.map((sug, i) => (
              <SuggestionCard
                key={sug.id + i}
                sug={sug}
                onClick={() => handleSuggestion(sug)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SuggestionCard({ sug, onClick }) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background:    hov ? `rgba(${hexToRgb(sug.color)},0.15)` : `rgba(${hexToRgb(sug.color)},0.07)`,
        border:        `1px solid ${hov ? sug.color+'88' : sug.color+'33'}`,
        borderRadius:  '14px',
        padding:       '16px',
        cursor:        'pointer',
        transition:    'all 0.18s',
        transform:     hov ? 'translateY(-2px)' : 'none',
        boxShadow:     hov ? `0 8px 24px rgba(${hexToRgb(sug.color)},0.2)` : 'none',
      }}
    >
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
        <span style={{ fontSize:'20px' }}>{sug.icon}</span>
        <span style={{ fontSize:'13px', fontWeight:700, color:'#ffffff' }}>{sug.title}</span>
      </div>
      <p style={{ fontSize:'11px', color:'#b0b0cc', lineHeight:1.6 }}>{sug.reason}</p>
      {sug.isWorkflow && (
        <span style={{
          display:'inline-block', marginTop:'8px',
          fontSize:'10px', fontWeight:700, color:sug.color,
          background:`rgba(${hexToRgb(sug.color)},0.15)`,
          border:`1px solid ${sug.color}44`,
          borderRadius:'999px', padding:'2px 8px',
        }}>⚡ One-click workflow</span>
      )}
    </div>
  )
}

function Chip({ label, color='#9d97ff' }) {
  return (
    <span style={{
      fontSize:'11px', color, background:`rgba(${hexToRgb(color)},0.12)`,
      border:`1px solid ${color}33`, borderRadius:'999px', padding:'2px 10px',
    }}>{label}</span>
  )
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16)
  const g = parseInt(hex.slice(3,5),16)
  const b = parseInt(hex.slice(5,7),16)
  return `${r},${g},${b}`
}
