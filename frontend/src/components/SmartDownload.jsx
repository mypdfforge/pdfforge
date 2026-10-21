/**
 * SmartDownload.jsx
 * Post-processing download page with before/after stats and next action suggestions.
 */
import React, { useState, useEffect, useRef } from 'react'
import { formatBytes, pctReduction, addToHistory } from '../utils/credits'

const fadeUp = `@keyframes sdFadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}`
const pop    = `@keyframes sdPop{0%{transform:scale(0.85)}60%{transform:scale(1.06)}100%{transform:scale(1)}}`

const NEXT_ACTIONS = {
  compress:      ['pdf-to-word', 'merge', 'watermark'],
  merge:         ['compress', 'organize', 'sign'],
  split:         ['compress', 'watermark', 'pdf-to-word'],
  watermark:     ['compress', 'sign', 'protect'],
  'pdf-to-word': ['compress', 'merge', 'translate'],
  'word-to-pdf': ['compress', 'sign', 'watermark'],
  ocr:           ['compress', 'translate', 'pdf-to-word'],
  sign:          ['compress', 'protect', 'watermark'],
  default:       ['compress', 'merge', 'sign'],
}

const ACTION_META = {
  compress:      { icon:'⬡', label:'Compress PDF',      color:'var(--gold)' },
  merge:         { icon:'⊕', label:'Merge PDF',         color:'var(--green)' },
  split:         { icon:'⊘', label:'Split PDF',         color:'var(--green)' },
  watermark:     { icon:'◈', label:'Watermark',         color:'var(--accent2)' },
  sign:          { icon:'✍', label:'Sign PDF',          color:'var(--accent2)' },
  protect:       { icon:'🔐', label:'Protect PDF',      color:'var(--accent2)' },
  'pdf-to-word': { icon:'📝', label:'Convert to Word',  color:'var(--accent2)' },
  'word-to-pdf': { icon:'📋', label:'Word → PDF',       color:'var(--gold)' },
  translate:     { icon:'⇄', label:'Translate',         color:'var(--accent2)' },
  organize:      { icon:'⊞', label:'Organize Pages',    color:'var(--green)' },
  ocr:           { icon:'⌕', label:'OCR',               color:'var(--gold)' },
}

export default function SmartDownload({
  toolId,
  originalFile,
  outputBlob,
  outputFilename = 'output.pdf',
  onSelectTool,
  onReset,
}) {
  const [downloaded, setDownloaded] = useState(false)
  const [timeMs,     setTimeMs]     = useState(null)
  const startRef = useRef(Date.now())

  useEffect(() => {
    setTimeMs(Date.now() - startRef.current)
  }, [])

  const origSize = originalFile?.size ?? null
  const outSize  = outputBlob?.size  ?? null
  const pct      = pctReduction(origSize, outSize)

  // Auto-download
  useEffect(() => {
    if (outputBlob && !downloaded) {
      triggerDownload()
    }
  }, [outputBlob])

  function triggerDownload() {
    if (!outputBlob) return
    const url = URL.createObjectURL(outputBlob)
    const a   = document.createElement('a')
    a.href     = url
    a.download = outputFilename
    a.click()
    URL.revokeObjectURL(url)
    setDownloaded(true)

    // Save to history
    addToHistory({
      id:           `${toolId}-${Date.now()}`,
      name:         outputFilename,
      toolLabel:    ACTION_META[toolId]?.label || toolId,
      originalSize: origSize,
      outputSize:   outSize,
      ts:           Date.now(),
    })
  }

  const nextIds = NEXT_ACTIONS[toolId] || NEXT_ACTIONS.default

  return (
    <div style={{ maxWidth:'560px', margin:'0 auto', padding:'24px 16px', textAlign:'center' }}>
      <style>{fadeUp}{pop}</style>

      {/* Success icon */}
      <div style={{
        width:'72px', height:'72px', borderRadius:'50%', margin:'0 auto 20px',
        background:'rgba(21,128,61,0.15)', border:'2px solid rgba(21,128,61,0.4)',
        display:'flex', alignItems:'center', justifyContent:'center', fontSize:'32px',
        animation:'sdPop 0.5s ease forwards',
      }}>✓</div>

      <h2 style={{ fontSize:'22px', fontWeight:800, color:'var(--text)', marginBottom:'6px' }}>
        Done! Your file is ready
      </h2>
      <p style={{ fontSize:'14px', color:'var(--text3)', marginBottom:'28px' }}>
        {downloaded ? 'Download started automatically' : 'Click below to download'}
      </p>

      {/* Stats row */}
      {(origSize || outSize || timeMs) && (
        <div style={{
          display:'flex', gap:'1px', borderRadius:'14px', overflow:'hidden',
          border:'1px solid var(--border)', marginBottom:'24px',
          animation:'sdFadeUp 0.4s ease 0.1s both',
        }}>
          {origSize && (
            <StatBox label="Original size" value={formatBytes(origSize)} />
          )}
          {outSize && (
            <StatBox label="Output size"   value={formatBytes(outSize)}  highlight={pct > 0} />
          )}
          {pct > 0 && (
            <StatBox label="Saved"         value={`${pct}%`}             highlight green />
          )}
          {timeMs && (
            <StatBox label="Time"          value={timeMs < 1000 ? `${timeMs}ms` : `${(timeMs/1000).toFixed(1)}s`} />
          )}
        </div>
      )}

      {/* Download button */}
      <button
        onClick={triggerDownload}
        style={{
          width:'100%', padding:'14px', borderRadius:'12px', border:'none',
          background:'linear-gradient(135deg,var(--accent),#8b83ff)', color:'var(--text)',
          fontSize:'15px', fontWeight:700, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center', gap:'8px',
          marginBottom:'14px', transition:'opacity 0.15s',
          animation:'sdFadeUp 0.4s ease 0.15s both',
        }}
      >
        ⬇ Download {outputFilename}
      </button>

      <button
        onClick={onReset}
        style={{
          width:'100%', padding:'11px', borderRadius:'12px',
          border:'1px solid var(--border)', background:'transparent',
          color:'var(--text3)', fontSize:'13px', fontWeight:500, cursor:'pointer',
          marginBottom:'32px',
        }}
      >Process another file</button>

      {/* Next actions */}
      {onSelectTool && (
        <div style={{ animation:'sdFadeUp 0.4s ease 0.25s both' }}>
          <p style={{
            fontSize:'11px', fontWeight:700, letterSpacing:'.1em',
            textTransform:'uppercase', color:'var(--text3)', marginBottom:'12px',
          }}>What's next?</p>
          <div style={{ display:'flex', gap:'10px', justifyContent:'center', flexWrap:'wrap' }}>
            {nextIds.map(id => {
              const meta = ACTION_META[id]
              if (!meta) return null
              return (
                <button
                  key={id}
                  onClick={() => onSelectTool(id)}
                  style={{
                    display:'flex', alignItems:'center', gap:'6px',
                    padding:'8px 14px', borderRadius:'999px',
                    border:`1px solid ${meta.color}33`,
                    background:`rgba(${hexToRgb(meta.color)},0.08)`,
                    color:'var(--text2)', fontSize:'12px', fontWeight:500,
                    cursor:'pointer', transition:'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = meta.color+'88'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = meta.color+'33'}
                >
                  <span>{meta.icon}</span> {meta.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Trust badges */}
      <div style={{
        display:'flex', gap:'16px', justifyContent:'center', flexWrap:'wrap',
        marginTop:'32px', paddingTop:'24px', borderTop:'1px solid var(--border)',
      }}>
        {['🔒 No watermark','🚫 No signup needed','🗑 Auto-deleted in 24h'].map(b => (
          <span key={b} style={{ fontSize:'11px', color:'var(--text3)' }}>{b}</span>
        ))}
      </div>
    </div>
  )
}

function StatBox({ label, value, highlight, green }) {
  return (
    <div style={{
      flex:1, padding:'14px 10px', background:'var(--bg3)',
      borderRight:'1px solid var(--border)',
    }}>
      <div style={{
        fontSize:'18px', fontWeight:800, lineHeight:1, marginBottom:'4px',
        color: green ? 'var(--green)' : highlight ? 'var(--accent)' : '#ffffff',
      }}>{value}</div>
      <div style={{ fontSize:'11px', color:'var(--text3)' }}>{label}</div>
    </div>
  )
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16)
  const g = parseInt(hex.slice(3,5),16)
  const b = parseInt(hex.slice(5,7),16)
  return `${r},${g},${b}`
}


