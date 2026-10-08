/**
 * FileHistory.jsx
 * Shows recent processed files (last 24h) from localStorage.
 * No login required.
 */
import React, { useState, useEffect } from 'react'
import { getHistory, clearHistory, formatBytes } from '../utils/credits'

const fadeUp = `@keyframes fhFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`

export default function FileHistory({ onClose }) {
  const [items, setItems] = useState([])

  useEffect(() => {
    setItems(getHistory())
  }, [])

  function timeAgo(ts) {
    const diff = Date.now() - ts
    const m    = Math.floor(diff / 60000)
    if (m < 1)  return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    return `${h}h ago`
  }

  function expiresIn(ts) {
    const expiresAt = ts + 24 * 60 * 60 * 1000
    const diff      = expiresAt - Date.now()
    if (diff < 0) return 'expired'
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    return `expires in ${h}h ${m}m`
  }

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:9998,
      background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'flex-end', justifyContent:'flex-end',
      padding:'16px',
    }} onClick={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <style>{fadeUp}</style>

      <div style={{
        background:'var(--bg2)', border:'1px solid var(--border)',
        borderRadius:'20px', width:'360px', maxHeight:'70vh',
        display:'flex', flexDirection:'column',
        animation:'fhFadeUp 0.25s ease',
        overflow:'hidden',
      }}>
        {/* Header */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'16px 18px', borderBottom:'1px solid var(--border)', flexShrink:0,
        }}>
          <div>
            <p style={{ fontSize:'14px', fontWeight:700, color:'#ffffff' }}>Recent Files</p>
            <p style={{ fontSize:'11px', color:'#b0b0cc' }}>Last 24 hours — auto-deleted after</p>
          </div>
          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
            {items.length > 0 && (
              <button onClick={() => { clearHistory(); setItems([]) }}
                style={{ fontSize:'11px', color:'#e5534b', background:'none', border:'none', cursor:'pointer' }}>
                Clear all
              </button>
            )}
            <button onClick={onClose}
              style={{ background:'none', border:'none', color:'#b0b0cc', cursor:'pointer', fontSize:'18px' }}>
              ×
            </button>
          </div>
        </div>

        {/* List */}
        <div style={{ overflowY:'auto', flex:1, padding:'12px' }}>
          {items.length === 0 ? (
            <div style={{ textAlign:'center', padding:'40px 20px' }}>
              <div style={{ fontSize:'32px', marginBottom:'10px' }}>🗂️</div>
              <p style={{ fontSize:'14px', fontWeight:600, color:'#ffffff' }}>No recent files</p>
              <p style={{ fontSize:'12px', color:'#b0b0cc', marginTop:'4px' }}>
                Processed files will appear here for 24 hours
              </p>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {items.map((item, i) => (
                <div key={item.id || i} style={{
                  background:'var(--bg3)', border:'1px solid var(--border)',
                  borderRadius:'12px', padding:'12px 14px',
                  display:'flex', alignItems:'center', gap:'12px',
                }}>
                  <div style={{
                    width:'36px', height:'36px', borderRadius:'8px', flexShrink:0,
                    background:'rgba(108,99,255,0.12)', border:'1px solid rgba(108,99,255,0.2)',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px',
                  }}>📄</div>

                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{
                      fontSize:'13px', fontWeight:600, color:'#ffffff',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    }}>{item.name}</p>
                    <div style={{ display:'flex', gap:'8px', marginTop:'3px', flexWrap:'wrap' }}>
                      <span style={{ fontSize:'11px', color:'#9d97ff' }}>{item.toolLabel}</span>
                      {item.outputSize && item.originalSize && item.outputSize < item.originalSize && (
                        <span style={{ fontSize:'11px', color:'#3ecf8e' }}>
                          {formatBytes(item.originalSize)} → {formatBytes(item.outputSize)}
                        </span>
                      )}
                    </div>
                    <div style={{ display:'flex', gap:'10px', marginTop:'2px' }}>
                      <span style={{ fontSize:'10px', color:'#7070a0' }}>{timeAgo(item.ts)}</span>
                      <span style={{ fontSize:'10px', color:'#555570' }}>{expiresIn(item.ts)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding:'12px 18px', borderTop:'1px solid var(--border)',
          flexShrink:0, display:'flex', alignItems:'center', gap:'6px',
        }}>
          <span style={{ fontSize:'11px', color:'#555570' }}>🔒</span>
          <span style={{ fontSize:'11px', color:'#7070a0' }}>
            Files are stored locally only — never on our servers after processing
          </span>
        </div>
      </div>
    </div>
  )
}
