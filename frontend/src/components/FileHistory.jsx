/**
 * FileHistory.jsx
 * Shows recent processed files (last 24h) from localStorage.
 * Enterprise SaaS audit history feel.
 */
import React, { useState, useEffect } from 'react'
import { X, FileText, FolderArchive, Lock, Clock, Trash2, ArrowRight } from 'lucide-react'
import { getHistory, clearHistory, formatBytes } from '../utils/credits'

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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        padding: '16px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div
        className="fade-up"
        style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          width: 'min(380px, calc(100vw - 32px))',
          maxHeight: '75vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
            background: 'var(--bg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={16} color="var(--brand)" />
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                Recent Documents
              </p>
              <p style={{ fontSize: '11px', color: 'var(--text3)', margin: 0 }}>
                Local session history · Auto-purged after 24h
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {items.length > 0 && (
              <button
                onClick={() => { clearHistory(); setItems([]) }}
                style={{
                  fontSize: '11px',
                  color: 'var(--red)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Trash2 size={12} /> Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="icon-btn"
              style={{ width: '28px', height: '28px', border: 'none', background: 'none' }}
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px' }}>
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px',
                  color: 'var(--text3)',
                }}
              >
                <FolderArchive size={22} />
              </div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                No recent documents
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '4px' }}>
                Files you process will appear here temporarily
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map((item, i) => (
                <div
                  key={item.id || i}
                  style={{
                    background: 'var(--bg3)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '8px',
                      flexShrink: 0,
                      background: 'var(--bg2)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--brand)',
                    }}
                  >
                    <FileText size={16} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        margin: 0,
                      }}
                    >
                      {item.name}
                    </p>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
                      <span className="badge" style={{ fontSize: '10px', height: '18px', padding: '0 6px' }}>
                        {item.toolLabel}
                      </span>
                      {item.outputSize && item.originalSize && item.outputSize < item.originalSize && (
                        <span style={{ fontSize: '11px', color: 'var(--green)' }}>
                          {formatBytes(item.originalSize)} → {formatBytes(item.outputSize)}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '3px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text3)' }}>{timeAgo(item.ts)}</span>
                      <span style={{ fontSize: '10px', color: 'var(--text3)' }}>· {expiresIn(item.ts)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--bg)',
          }}
        >
          <Lock size={12} color="var(--green)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '11px', color: 'var(--text3)', lineHeight: 1.4 }}>
            Local sandbox only. No files are persisted on external infrastructure.
          </span>
        </div>
      </div>
    </div>
  )
}
